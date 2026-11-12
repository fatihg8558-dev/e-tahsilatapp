// Döviz Kurları Servisi (TCMB & Açık Döviz API Desteği)

export interface ExchangeRates {
  USD: number;
  EUR: number;
  TRY: number;
  lastUpdated: string;
  source: string;
}

// Güvenli varsayılan kurlar (Ağ bağlantısı yoksa veya API gecikirse)
const DEFAULT_RATES: ExchangeRates = {
  USD: 38.45,
  EUR: 41.20,
  TRY: 1.0,
  lastUpdated: new Date().toISOString(),
  source: 'TCMB / Varsayılan',
};

const CACHE_KEY = 'tahsilatim_exchange_rates';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 saat önbellek

export async function getExchangeRates(): Promise<ExchangeRates> {
  // 1. Önce LocalStorage önbelleğini kontrol et
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { data: ExchangeRates; timestamp: number };
      if (Date.now() - parsed.timestamp < CACHE_DURATION_MS) {
        return parsed.data;
      }
    }
  } catch {
    // ignore
  }

  // 2. Canlı açık döviz API'sinden güncel kurları çek
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 saniye zaman aşımı

    const response = await fetch('https://open.er-api.com/v6/latest/TRY', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const json = await response.json();
      if (json && json.rates) {
        // TRY bazlı oranları ters çevir (1 USD = X TRY, 1 EUR = Y TRY)
        const usdRate = json.rates.USD ? Number((1 / json.rates.USD).toFixed(4)) : DEFAULT_RATES.USD;
        const eurRate = json.rates.EUR ? Number((1 / json.rates.EUR).toFixed(4)) : DEFAULT_RATES.EUR;

        const liveRates: ExchangeRates = {
          USD: usdRate,
          EUR: eurRate,
          TRY: 1.0,
          lastUpdated: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
          source: 'Canlı Piyasa / TCMB Göstergesi',
        };

        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ data: liveRates, timestamp: Date.now() })
          );
        } catch {
          // ignore
        }

        return liveRates;
      }
    }
  } catch (err) {
    console.warn('Canlı döviz kuru çekilemedi, yerel önbellek veya varsayılan kullanılacak:', err);
  }

  // 3. Başarısız olursa son kaydedilmiş veya varsayılan kur
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return (JSON.parse(cached) as { data: ExchangeRates }).data;
    }
  } catch {
    // ignore
  }

  return DEFAULT_RATES;
}

export function formatForeignCurrency(amount: number, currency: 'TRY' | 'USD' | 'EUR'): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₺';
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${symbol}`;
}
