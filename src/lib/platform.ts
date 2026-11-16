export type ClientPlatform = 'android_app' | 'ios_pwa' | 'ios_safari' | 'web';

export function isAndroidNativeBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.AndroidBridge);
}

export function isIosUserAgent(userAgent?: string, maxTouchPoints: number = 0): boolean {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return true;
  }
  // iPadOS 13+ Safari Masaüstü modu: Macintosh UA + dokunmatik ekran (>1 nokta)
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) {
    return true;
  }
  return false;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isIosUserAgent(navigator.userAgent, navigator.maxTouchPoints || 0);
}

export function isIosStandalonePwa(): boolean {
  if (typeof window === 'undefined' || !isIosDevice()) return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    return false;
  }
}

export function getClientPlatform(): ClientPlatform {
  if (isAndroidNativeBridge()) return 'android_app';
  if (isIosStandalonePwa()) return 'ios_pwa';
  if (isIosDevice()) return 'ios_safari';
  return 'web';
}
