/**
 * WhatsApp Mesaj Gönderme ve Harici Bağlantı Açma Yardımcısı
 * Android WebView (AndroidBridge), Mobil Tarayıcılar ve Masaüstünde %100 çalışır.
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

/**
 * WhatsApp paylaşımı yapar.
 * 1. Eğer Android WebView içindeyse doğrudan Java AndroidBridge.sendWhatsApp tetiklenir.
 * 2. Tarayıcıda ise api.whatsapp.com linki güvenli bir şekilde açılır.
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

  const encodedMessage = encodeURIComponent(cleanMsg);
  const targetUrl = formattedPhone
    ? `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodedMessage}`
    : `https://api.whatsapp.com/send?text=${encodedMessage}`;

  try {
    const link = document.createElement('a');
    link.href = targetUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
    }, 200);
  } catch {
    window.location.href = targetUrl;
  }
};

/**
 * Genel harici bağlantı veya e-posta açıcı (Android WebView dostu)
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

  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
    }, 200);
  } catch {
    window.location.href = url;
  }
};
