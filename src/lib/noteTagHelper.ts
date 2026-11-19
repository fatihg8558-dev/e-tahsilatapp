/**
 * Sistem metadata etiketlerini insan tarafından okunabilir açıklamalardan temizler.
 * Çek satırı, döviz veya karma ödeme kalemi gibi kullanıcı/makbuz bilgilerine dokunmaz.
 */
export function stripInternalSystemTags(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/\[PORTFOY:[^\]]*\]\s*/g, '')
    .replace(/\[GS_ONAY:[^\]]*\]\s*/g, '')
    .replace(/\[GS_ONAYLANDI:[^\]]*\]\s*/g, '')
    .replace(/\[GS_RED:[^\]]*\]\s*/g, '')
    .replace(/\[PORTFOY-TAHSIL:[^\]]*\]\s*/g, '')
    .replace(/\[PORTFOY-ODEME:[^\]]*\]\s*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
