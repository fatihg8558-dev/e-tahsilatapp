import { Ayar, Paket } from '../types/database';

export const PAKET_OZELLIKLERI_AYAR_KEY = 'paket_ozellikleri';

export type PaketFeaturesMap = Record<string, string[]>;

export function normalizePackageFeatures(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter((item) => item.length > 0);
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return normalizePackageFeatures(parsed);
        }
      } catch {
        // Fallback to newline split
      }
    }
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  return [];
}

export function parsePaketFeaturesFromAyarlar(ayarlar: Ayar[] | null | undefined): PaketFeaturesMap {
  if (!Array.isArray(ayarlar)) return {};
  const row = ayarlar.find((item) => item.anahtar === PAKET_OZELLIKLERI_AYAR_KEY);
  if (!row?.deger) return {};

  try {
    const parsed = JSON.parse(row.deger);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: PaketFeaturesMap = {};
    for (const [paketId, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[paketId] = normalizePackageFeatures(value);
    }
    return result;
  } catch {
    return {};
  }
}

export function getPackageFeatures(paket: Paket, fallbackMap?: PaketFeaturesMap): string[] {
  if (paket.ozellikler !== undefined && paket.ozellikler !== null) {
    const direct = normalizePackageFeatures(paket.ozellikler);
    if (direct.length > 0) return direct;
    // Column exists and was explicitly set to empty array/string
    if (Array.isArray(paket.ozellikler) || typeof paket.ozellikler === 'string') {
      return fallbackMap?.[paket.id] ?? [];
    }
  }
  return fallbackMap?.[paket.id] ?? [];
}

export function isMissingOzelliklerColumnError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = 'message' in err ? String((err as { message?: unknown }).message ?? '').toLowerCase() : '';
  const details = 'details' in err ? String((err as { details?: unknown }).details ?? '').toLowerCase() : '';
  const combined = `${message} ${details}`;

  return (
    code === 'PGRST204' ||
    code === '42703' ||
    (combined.includes('ozellikler') &&
      (combined.includes('schema cache') ||
        combined.includes('does not exist') ||
        combined.includes('could not find')))
  );
}
