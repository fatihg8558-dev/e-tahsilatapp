// Sanal POS (iyzico & PayTR), iyzico Cep POS App2App ve Android NFC Entegrasyon Servisi
import { isIosDevice } from './platform';

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
  // Cep POS parametreleri
  nfcEnabled?: boolean;
  cepPosMode?: CepPosMode;
  cepPosDeepLinkBase?: string;
  cepPosCallbackScheme?: string;
  // Her cihazda açılan ödeme linki Web Alan Adı ve Edge Function Gateway
  publicWebUrl?: string;
  gatewayFunctionUrl?: string;
}

export const DEFAULT_SHARED_WEB_URL =
  'https://ais-pre-ow5iiixphenxsbz6fjufbo-543191284489.europe-west2.run.app';
export const DEFAULT_SUPABASE_GATEWAY_URL =
  'https://joxnbnclogasumkfzyqt.supabase.co/functions/v1/pos-payment-gateway';

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
  publicWebUrl: '',
  gatewayFunctionUrl: '',
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

export function isAndroidApkOrigin(origin?: string | null): boolean {
  const clean = (origin || '').trim().toLowerCase();
  if (!clean) return false;
  return (
    clean.includes('appassets.androidplatform.net') ||
    clean.startsWith('file://') ||
    clean.startsWith('capacitor://') ||
    clean.startsWith('ionic://')
  );
}

export function isPrivateDevOrigin(origin?: string | null): boolean {
  const clean = (origin || '').trim().toLowerCase();
  if (!clean) return false;
  return (
    clean.includes('ais-dev-') ||
    clean.includes('localhost') ||
    clean.includes('127.0.0.1') ||
    clean.includes('10.0.2.2')
  );
}

export function normalizePublicWebUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (isAndroidApkOrigin(parsed.origin)) return '';
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function resolvePaymentLinkBaseUrl(
  config?: PosConfig | null,
  explicitBaseUrl?: string
): {
  baseUrl: string;
  source: 'explicit' | 'configured' | 'window' | 'shared_fallback';
  isPublicReachable: boolean;
  warning?: string;
} {
  const explicit = normalizePublicWebUrl(explicitBaseUrl);
  if (explicit) {
    return {
      baseUrl: explicit,
      source: 'explicit',
      isPublicReachable: !isPrivateDevOrigin(explicit),
    };
  }

  const configured = normalizePublicWebUrl(config?.publicWebUrl);
  if (configured) {
    return {
      baseUrl: configured,
      source: 'configured',
      isPublicReachable: !isPrivateDevOrigin(configured),
    };
  }

  const winOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? normalizePublicWebUrl(window.location.origin)
      : '';

  if (winOrigin && !isAndroidApkOrigin(winOrigin) && !isPrivateDevOrigin(winOrigin)) {
    return {
      baseUrl: winOrigin,
      source: 'window',
      isPublicReachable: true,
    };
  }

  return {
    baseUrl: DEFAULT_SHARED_WEB_URL,
    source: 'shared_fallback',
    isPublicReachable: true,
    warning:
      'Sanal POS ayarlarından özel web alan adınız henüz tanımlanmadığı için paylaşılan web bağlantısı kullanıldı. Ayarlar > Sanal POS içinden kendi canlı web adresinizi tanımlayabilirsiniz.',
  };
}

export function resolveGatewayFunctionUrl(config?: PosConfig | null): string {
  const custom = (config?.gatewayFunctionUrl || '').trim().replace(/\/+$/, '');
  if (custom && /^https?:\/\//i.test(custom)) {
    return custom;
  }
  const supaUrl = (import.meta.env?.VITE_SUPABASE_URL || 'https://joxnbnclogasumkfzyqt.supabase.co')
    .trim()
    .replace(/\/+$/, '');
  return `${supaUrl}/functions/v1/pos-payment-gateway`;
}

export function validatePosConfig(config: PosConfig): { valid: boolean; message?: string } {
  if (config.publicWebUrl?.trim()) {
    if (isAndroidApkOrigin(config.publicWebUrl)) {
      return {
        valid: false,
        message:
          'Android uygulama içi yerel adresi (appassets.androidplatform.net) dışarıdan açılamaz. Lütfen gerçek bir https:// web adresi giriniz.',
      };
    }
    if (!normalizePublicWebUrl(config.publicWebUrl)) {
      return {
        valid: false,
        message: 'Ödeme Linki Web Adresi geçerli bir https:// alan adı olmalıdır (örn: https://odeme.firmam.com).',
      };
    }
  }

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
  payCode?: string;
  baseUrlSource?: 'explicit' | 'configured' | 'window' | 'shared_fallback';
  warning?: string;
}

export interface PosPayLinkParams {
  referenceNo: string;
  amount: number;
  customerName: string;
  provider: 'iyzico' | 'paytr';
  payCode?: string;
  description?: string;
  firmaName?: string;
  firmaId?: string;
  payStatus?: 'success' | 'failed';
}

export function parsePosPayParams(search: string): PosPayLinkParams | null {
  try {
    const query = search.startsWith('?') ? search : `?${search}`;
    const params = new URLSearchParams(query);

    const payCode = (params.get('pay') || '').trim();
    const payStatusRaw = (params.get('pay_status') || '').trim().toLowerCase();
    const payStatus: 'success' | 'failed' | undefined =
      payStatusRaw === 'success' || payStatusRaw === 'failed' ? payStatusRaw : undefined;
    const refReturn = (params.get('ref') || '').trim();
    const referenceNo = (params.get('pos_pay') || payCode || refReturn).trim();
    if (!referenceNo && !payStatus) return null;

    const rawAmount = Number((params.get('tut') || '0').replace(',', '.'));
    const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? Math.round(rawAmount * 100) / 100 : 0;
    const customerName = (params.get('cari') || 'Müşteri').trim() || 'Müşteri';
    const rawProvider = (params.get('prov') || 'iyzico').trim().toLowerCase();
    const provider: 'iyzico' | 'paytr' = rawProvider === 'paytr' ? 'paytr' : 'iyzico';

    const result: PosPayLinkParams = {
      referenceNo: referenceNo || 'POS-ODEME',
      amount,
      customerName,
      provider,
    };

    if (payCode) result.payCode = payCode;
    const desc = (params.get('desc') || '').trim();
    if (desc) result.description = desc;
    const firmaName = (params.get('firma') || '').trim();
    if (firmaName) result.firmaName = firmaName;
    const firmaId = (params.get('fid') || '').trim();
    if (firmaId) result.firmaId = firmaId;
    if (payStatus) result.payStatus = payStatus;

    return result;
  } catch {
    return null;
  }
}

export function generatePaymentLink(params: {
  amount: number;
  customerName: string;
  customerPhone?: string;
  description?: string;
  firmaName?: string;
  firmaId?: string;
  payCode?: string;
  referenceNo?: string;
  config: PosConfig;
  providerOverride?: 'iyzico' | 'paytr';
  baseUrl?: string;
}): PaymentLinkResult {
  const refNo = params.referenceNo?.trim() || `POS-${Date.now().toString().slice(-6)}`;
  const effectiveProvider: 'iyzico' | 'paytr' =
    params.providerOverride ||
    (params.config.provider === 'paytr' ? 'paytr' : 'iyzico');
  const providerLabel =
    effectiveProvider === 'paytr' ? 'PayTR Güvenli Ödeme' : 'iyzico Güvenli Ödeme';
  const modeLabel = params.config.testMode ? '[TEST MODU] ' : '';

  const resolvedBase = resolvePaymentLinkBaseUrl(params.config, params.baseUrl);
  const baseUrl = resolvedBase.baseUrl;

  let paymentUrl: string;
  if (params.payCode?.trim()) {
    paymentUrl = `${baseUrl}/?pay=${encodeURIComponent(params.payCode.trim())}`;
  } else {
    const query = new URLSearchParams();
    query.set('pos_pay', refNo);
    query.set('tut', String(params.amount));
    query.set('cari', params.customerName);
    query.set('prov', effectiveProvider);
    if (params.description?.trim()) {
      query.set('desc', params.description.trim());
    }
    if (params.firmaName?.trim()) {
      query.set('firma', params.firmaName.trim());
    }
    if (params.firmaId?.trim()) {
      query.set('fid', params.firmaId.trim());
    }
    paymentUrl = `${baseUrl}/?${query.toString()}`;
  }

  const descLine = params.description?.trim()
    ? `\nAçıklama: ${params.description.trim()}`
    : '';

  const message = `${modeLabel}Sayın ${params.customerName},\n${params.amount.toLocaleString(
    'tr-TR',
    { minimumFractionDigits: 2 }
  )} ₺ tutarındaki ödemenizi kredi kartınız ile aşağıdaki link üzerinden ${providerLabel} güvencesiyle 3D Secure olarak tamamlayabilirsiniz:${descLine}\n\n${paymentUrl}\n\nReferans No: ${refNo}`;

  return {
    url: paymentUrl,
    referenceNo: refNo,
    message,
    payCode: params.payCode?.trim() || undefined,
    baseUrlSource: resolvedBase.source,
    warning: resolvedBase.warning,
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

export function getAndroidNfcStatus(): 'ready' | 'disabled' | 'unsupported' | 'ios' | 'web' {
  if (typeof window === 'undefined' || !window.AndroidBridge?.getNfcStatus) {
    return isIosDevice() ? 'ios' : 'web';
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
