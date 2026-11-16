import { isIosDevice, isIosStandalonePwa } from './platform';

/**
 * WhatsApp Mesaj Gönderme ve Harici Bağlantı Açma Yardımcısı
 * Android WebView (AndroidBridge), iOS Safari/PWA ve Masaüstünde %100 çalışır.
 */

// Türkiye telefon numaralarını uluslararası E.164 formatına çevirir (örn: 05321234567 -> 905321234567)
export const formatWhatsAppPhone = (rawPhone?: string | null): string => {
  if (!rawPhone) return '';
  const cleaned = rawPhone.replace(/\D/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('90') && cleaned.length >= 12) {
    return cleaned;
  }
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return '9' + cleaned;
  }
  if (cleaned.startsWith('5') && cleaned.length === 10) {
    return '90' + cleaned;
  }
  return cleaned;
};

export const buildWhatsAppShareUrl = (
  phone: string | undefined | null,
  message: string,
  preferUniversalWaMe: boolean = false
): string => {
  const formattedPhone = formatWhatsAppPhone(phone);
  const encodedMessage = encodeURIComponent(message || '');
  if (preferUniversalWaMe) {
    return formattedPhone
      ? `https://wa.me/${formattedPhone}?text=${encodedMessage}`
      : `https://wa.me/?text=${encodedMessage}`;
  }
  return formattedPhone
    ? `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedMessage}`
    : `https://api.whatsapp.com/send?text=${encodedMessage}`;
};

/**
 * WhatsApp paylaşımı yapar.
 * 1. Android WebView içindeyse doğrudan Java AndroidBridge.sendWhatsApp tetiklenir.
 * 2. iOS Safari / Standalone PWA'da pop-up engeline takılmadan wa.me Universal Link ile açılır.
 * 3. Masaüstü / diğer tarayıcılarda yeni sekme veya yönlendirme açılır.
 */
export const openWhatsApp = (phone: string | undefined | null, message: string): void => {
  const formattedPhone = formatWhatsAppPhone(phone);
  const cleanMsg = message || '';

  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.sendWhatsApp === 'function') {
      const handled = window.AndroidBridge.sendWhatsApp(formattedPhone, cleanMsg);
      if (handled) return;
    }
  } catch (err) {
    console.warn('AndroidBridge call error:', err);
  }

  const isIos = isIosDevice();
  const targetUrl = buildWhatsAppShareUrl(phone, cleanMsg, isIos);

  if (isIos && isIosStandalonePwa()) {
    window.location.assign(targetUrl);
    return;
  }

  try {
    const win = window.open(targetUrl, '_blank', 'noopener,noreferrer');
    if (win && !win.closed) {
      return;
    }
  } catch {
    // pop-up engellendi; doğrudan yönlendirmeye düş
  }

  window.location.assign(targetUrl);
};

/**
 * Genel harici bağlantı veya e-posta açıcı (Android WebView & iOS Safari PWA dostu)
 */
export const openExternalLink = (url: string): void => {
  if (!url) return;

  try {
    if (window.AndroidBridge && typeof window.AndroidBridge.openExternal === 'function') {
      const handled = window.AndroidBridge.openExternal(url);
      if (handled) return;
    }
  } catch (err) {
    console.warn('AndroidBridge openExternal error:', err);
  }

  if (url.startsWith('mailto:') || url.startsWith('tel:')) {
    window.location.assign(url);
    return;
  }

  if (isIosDevice() && isIosStandalonePwa()) {
    window.location.assign(url);
    return;
  }

  try {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (win && !win.closed) {
      return;
    }
  } catch {
    // pop-up engellendi; doğrudan yönlendirmeye düş
  }

  window.location.assign(url);
};
