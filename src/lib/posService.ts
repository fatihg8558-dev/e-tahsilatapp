// Sanal POS (iyzico & PayTR), iyzico Cep POS App2App ve Android NFC Entegrasyon Servisi

export type PosProvider = 'none' | 'iyzico' | 'paytr';
export type CepPosMode = 'hybrid' | 'app2app' | 'nfc_only';

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
  // NFC & iyzico Cep POS parametreleri
  nfcEnabled?: boolean;
  cepPosMode?: CepPosMode;
  cepPosDeepLinkBase?: string;
  cepPosCallbackScheme?: string;
}

export interface NfcCardReadDetail {
  success: boolean;
  brand: string;
  last4?: string;
  expiry?: string;
  uidRef?: string;
  method?: string;
  error?: string;
}

export interface PendingCepPosTx {
  txRef: string;
  firmaId: string;
  cariId: string;
  cariUnvan: string;
  tutar: number;
  aciklama?: string;
  createdAt: string;
}

export interface NfcAuthorizationResult {
  success: boolean;
  authCode: string;
  transactionId: string;
  isTestMode: boolean;
  bankaAdi: string;
  slipNo: string;
  aciklamaTag: string;
}

const STORAGE_PREFIX = 'tahsilatim_pos_config_';
const PENDING_CEP_POS_KEY = 'tahsilatim_pending_ceppost';

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
  nfcEnabled: true,
  cepPosMode: 'hybrid',
  cepPosDeepLinkBase: '',
  cepPosCallbackScheme: 'tahsilatim://ceppost-callback',
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

  // Test/Sandbox veya başvuru aşamasında NFC açıkken canlı API anahtarı zorunlu değildir
  if (config.provider === 'iyzico') {
    if (!config.testMode) {
      if (!config.iyzicoApiKey?.trim()) {
        return { valid: false, message: 'Canlı mod için iyzico API Key bilginizi giriniz (veya Test Modunu açınız).' };
      }
      if (!config.iyzicoSecretKey?.trim()) {
        return { valid: false, message: 'Canlı mod için iyzico Secret Key bilginizi giriniz (veya Test Modunu açınız).' };
      }
    }
  }

  if (config.provider === 'paytr' && !config.testMode) {
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

export function generatePaymentLink(params: {
  amount: number;
  customerName: string;
  customerPhone?: string;
  description?: string;
  config: PosConfig;
}): PaymentLinkResult {
  const refNo = `POS-${Date.now().toString().slice(-6)}`;
  const providerLabel =
    params.config.provider === 'paytr' ? 'PayTR Güvenli Ödeme' : 'iyzico Güvenli Ödeme';
  const modeLabel = params.config.testMode ? '[TEST MODU] ' : '';

  const baseUrl = window.location.origin;
  const paymentUrl = `${baseUrl}/?pos_pay=${refNo}&tut=${params.amount}&cari=${encodeURIComponent(
    params.customerName
  )}&prov=${params.config.provider === 'none' ? 'iyzico' : params.config.provider}`;

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

export async function processCardPayment(params: {
  amount: number;
  cardNumber: string;
  cardHolder: string;
  expireMonth: string;
  expireYear: string;
  cvc: string;
  config: PosConfig;
}): Promise<{ success: boolean; transactionId?: string; error?: string }> {
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
      error:
        'Firma Sanal POS altyapısı aktif değil. Lütfen Ayarlar > Sanal POS sekmesinden bilgilerinizi tanımlayınız.',
    };
  }

  const authCode = Math.floor(100000 + Math.random() * 900000).toString();
  const txId = `${params.config.provider.toUpperCase()}-${Date.now().toString().slice(-8)}-${authCode}`;

  return {
    success: true,
    transactionId: txId,
  };
}

export function getAndroidNfcStatus(): 'ready' | 'disabled' | 'unsupported' | 'web' {
  if (typeof window === 'undefined' || !window.AndroidBridge?.getNfcStatus) {
    return 'web';
  }
  const status = window.AndroidBridge.getNfcStatus();
  if (status === 'ready' || status === 'disabled' || status === 'unsupported') {
    return status;
  }
  return 'unsupported';
}

export function isAndroidCepPosInstalled(): boolean {
  if (typeof window === 'undefined' || !window.AndroidBridge?.isCepPosAppInstalled) {
    return false;
  }
  return Boolean(window.AndroidBridge.isCepPosAppInstalled());
}

export function buildCepPosLaunchUrl(params: {
  txRef: string;
  amount: number;
  customerName: string;
  config: PosConfig;
}): string {
  const base = params.config.cepPosDeepLinkBase?.trim();
  const callback = encodeURIComponent(
    params.config.cepPosCallbackScheme?.trim() || 'tahsilatim://ceppost-callback'
  );
  const amountStr = params.amount.toFixed(2);
  const ref = encodeURIComponent(params.txRef);
  const desc = encodeURIComponent(`${params.customerName} Tahsilat`);

  if (!base) return '';

  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}amount=${amountStr}&currency=TRY&reference=${ref}&description=${desc}&callbackUrl=${callback}`;
}

export function savePendingCepPosTx(tx: PendingCepPosTx): void {
  try {
    localStorage.setItem(PENDING_CEP_POS_KEY, JSON.stringify(tx));
  } catch {
    // ignore storage quota errors
  }
}

export function getPendingCepPosTx(): PendingCepPosTx | null {
  try {
    const raw = localStorage.getItem(PENDING_CEP_POS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingCepPosTx;
  } catch {
    return null;
  }
}

export function clearPendingCepPosTx(): void {
  try {
    localStorage.removeItem(PENDING_CEP_POS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Okunan NFC kart özetini veya Cep POS onayını makbuz/kasa formatına dönüştürür.
 * Tam kart numarası (PAN) asla saklanmaz; yalnızca kart şeması ve son 4 hane kullanılır.
 */
export async function authorizeNfcPayment(params: {
  amount: number;
  cardSummary: NfcCardReadDetail;
  config: PosConfig;
  source: 'android_nfc' | 'sandbox_sim' | 'ceppost_callback';
  externalAuthCode?: string;
}): Promise<NfcAuthorizationResult> {
  if (params.source !== 'ceppost_callback') {
    await new Promise((r) => setTimeout(r, 650));
  }

  const hasLiveKeys = Boolean(
    params.config.provider === 'iyzico' &&
      !params.config.testMode &&
      params.config.iyzicoApiKey?.trim() &&
      params.config.iyzicoSecretKey?.trim()
  );

  // Android yerel NFC okuyucu (SoftPOS kernel olmadan) ve Sandbox simülasyonu test/onay modunda etiketlenir;
  // iyzico Cep POS App2App callback'i canlı anahtar + canlı ortamda gerçek provizyon olarak işaretlenir.
  const isTestMode =
    params.source === 'sandbox_sim' ||
    params.source === 'android_nfc' ||
    params.config.testMode ||
    !hasLiveKeys;

  const authCode =
    params.externalAuthCode?.trim() ||
    Math.floor(100000 + Math.random() * 900000).toString();

  const prefix = isTestMode ? 'NFC-TEST' : 'IYZ-CEPPOS';
  const transactionId = `${prefix}-${Date.now().toString().slice(-6)}-${authCode}`;

  const brand = params.cardSummary.brand || 'Temassız Kart';
  const last4Part = params.cardSummary.last4
    ? `•••• ${params.cardSummary.last4}`
    : params.cardSummary.uidRef
    ? `UID:${params.cardSummary.uidRef}`
    : 'NFC';

  const providerLabel =
    params.config.provider === 'iyzico'
      ? 'iyzico Cep POS'
      : params.config.provider === 'paytr'
      ? 'PayTR POS'
      : 'NFC Temassız POS';

  const bankaAdi = `${providerLabel} (${brand}${params.cardSummary.last4 ? ` •••• ${params.cardSummary.last4}` : ''})`;
  const modeTag = isTestMode ? 'TEST / SİMÜLASYON' : 'CANLI PROVİZYON';
  const expiryPart = params.cardSummary.expiry ? ` • SKT: ${params.cardSummary.expiry}` : '';
  const aciklamaTag = `[NFC TEMASSIZ - ${modeTag}] ${brand} ${last4Part}${expiryPart} • Onay: ${authCode}`;

  return {
    success: true,
    authCode,
    transactionId,
    isTestMode,
    bankaAdi,
    slipNo: transactionId,
    aciklamaTag,
  };
}
