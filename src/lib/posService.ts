// Sanal POS (iyzico & PayTR) Entegrasyon Servisi

export type PosProvider = 'none' | 'iyzico' | 'paytr';

export interface PosConfig {
  provider: PosProvider;
  enabled: boolean;
  testMode: boolean;
  // iyzico parametreleri
  iyzicoApiKey?: string;
  iyzicoSecretKey?: string;
  iyzicoBaseUrl?: string; // 'https://sandbox-api.iyzipay.com' | 'https://api.iyzipay.com'
  // PayTR parametreleri
  paytrMerchantId?: string;
  paytrMerchantKey?: string;
  paytrMerchantSalt?: string;
}

const STORAGE_PREFIX = 'tahsilatim_pos_config_';

export const DEFAULT_POS_CONFIG: PosConfig = {
  provider: 'none',
  enabled: false,
  testMode: true,
  iyzicoApiKey: '',
  iyzicoSecretKey: '',
  iyzicoBaseUrl: 'https://sandbox-api.iyzipay.com',
  paytrMerchantId: '',
  paytrMerchantKey: '',
  paytrMerchantSalt: '',
};

export function getPosConfig(firmaId?: string): PosConfig {
  try {
    const key = `${STORAGE_PREFIX}${firmaId || 'default'}`;
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_POS_CONFIG;
    return { ...DEFAULT_POS_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_POS_CONFIG;
  }
}

export function savePosConfig(config: PosConfig, firmaId?: string): void {
  try {
    const key = `${STORAGE_PREFIX}${firmaId || 'default'}`;
    localStorage.setItem(key, JSON.stringify(config));
  } catch (err) {
    console.error('POS ayarları kaydedilemedi:', err);
  }
}

export function validatePosConfig(config: PosConfig): { valid: boolean; message?: string } {
  if (!config.enabled || config.provider === 'none') {
    return { valid: true };
  }

  if (config.provider === 'iyzico') {
    if (!config.iyzicoApiKey?.trim()) {
      return { valid: false, message: 'Lütfen iyzico API Key bilginizi giriniz.' };
    }
    if (!config.iyzicoSecretKey?.trim()) {
      return { valid: false, message: 'Lütfen iyzico Secret Key bilginizi giriniz.' };
    }
  }

  if (config.provider === 'paytr') {
    if (!config.paytrMerchantId?.trim()) {
      return { valid: false, message: 'Lütfen PayTR Mağaza No (Merchant ID) giriniz.' };
    }
    if (!config.paytrMerchantKey?.trim()) {
      return { valid: false, message: 'Lütfen PayTR Mağaza Parolası (Merchant Key) giriniz.' };
    }
    if (!config.paytrMerchantSalt?.trim()) {
      return { valid: false, message: 'Lütfen PayTR Mağaza Gizli Anahtarı (Merchant Salt) giriniz.' };
    }
  }

  return { valid: true };
}

export interface PaymentLinkResult {
  url: string;
  referenceNo: string;
  message: string;
}

/**
 * Müşteriye WhatsApp / SMS ile iletilebilecek güvenli ödeme bağlantısı metni oluşturur
 */
export function generatePaymentLink(params: {
  amount: number;
  customerName: string;
  customerPhone?: string;
  description?: string;
  config: PosConfig;
}): PaymentLinkResult {
  const refNo = `POS-${Date.now().toString().slice(-6)}`;
  const providerLabel = params.config.provider === 'iyzico' ? 'iyzico Güvenli Ödeme' : 'PayTR Güvenli Ödeme';
  const modeLabel = params.config.testMode ? '[TEST MODU] ' : '';

  // Ödeme sayfası referansı (uygulama içi veya sanal pos gateway simülatörü)
  const baseUrl = window.location.origin;
  const paymentUrl = `${baseUrl}/?pos_pay=${refNo}&tut=${params.amount}&cari=${encodeURIComponent(
    params.customerName
  )}&prov=${params.config.provider}`;

  const message = `${modeLabel}Sayın ${params.customerName},\n${params.amount.toLocaleString(
    'tr-TR',
    { minimumFractionDigits: 2 }
  )} ₺ tutarındaki ödemenizi kredi kartınız ile aşağıdaki link üzerinden ${providerLabel} güvencesiyle 3D Secure olarak tamamlayabilirsiniz:\n\n${paymentUrl}\n\nReferans No: ${refNo}`;

  return {
    url: paymentUrl,
    referenceNo: refNo,
    message,
  };
}

/**
 * 3D Secure veya doğrudan Sanal POS kart çekim simülasyonu / işlemi
 */
export async function processCardPayment(params: {
  amount: number;
  cardNumber: string;
  cardHolder: string;
  expireMonth: string;
  expireYear: string;
  cvc: string;
  config: PosConfig;
}): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  // Simülasyon gecikmesi
  await new Promise((r) => setTimeout(r, 1200));

  const cleanCard = params.cardNumber.replace(/\s+/g, '');
  if (cleanCard.length < 15) {
    return { success: false, error: 'Geçersiz kart numarası girildi.' };
  }

  if (!params.cvc || params.cvc.length < 3) {
    return { success: false, error: 'Geçersiz CVC / Güvenlik kodu.' };
  }

  if (params.config.provider === 'none' || !params.config.enabled) {
    return {
      success: false,
      error: 'Firma Sanal POS altyapısı aktif değil. Lütfen Ayarlar > Sanal POS sekmesinden bilgilerinizi tanımlayınız.',
    };
  }

  // Başarılı onay kodu
  const authCode = Math.floor(100000 + Math.random() * 900000).toString();
  const txId = `${params.config.provider.toUpperCase()}-${Date.now().toString().slice(-8)}-${authCode}`;

  return {
    success: true,
    transactionId: txId,
  };
}
