import { Ayar, Firma, Paket } from '../types/database';
import { PackageTierKey, detectTierKeyFromName } from './packageCatalog';
import { normalizePackageFeatures } from './packageFeatures';

export type EntitlementPeriodStatus = 'active_trial' | 'active_package' | 'unlimited' | 'expired';

export const EK_PLASIYER_FIYAT = 100;
export const FIRMA_EK_PLASIYER_AYAR_KEY = 'firma_ek_plasiyer_kotalari';

export const TIER_PLASIYER_LIMITS: Record<PackageTierKey, number> = {
  baslangic: 1,
  profesyonel: 3,
  kurumsal: 9,
};

export const TIER_LABELS: Record<PackageTierKey, string> = {
  baslangic: 'Başlangıç (Basic)',
  profesyonel: 'Profesyonel (Plus)',
  kurumsal: 'Kurumsal (Pro)',
};

export interface PackageEntitlements {
  tierKey: PackageTierKey;
  tierLabel: string;
  sourceLabel: string;
  isTrialFullAccess: boolean;
  isUnlimited: boolean;
  includedPlasiyerLimit: number;
  ekPlasiyerSayisi: number;
  totalPlasiyerLimit: number;
  canUsePaymentLink: boolean;
  canUseNfc: boolean;
  canUseUblImport: boolean;
}

export type FirmaEkPlasiyerMap = Record<string, number>;

export function sanitizeEkPlasiyerCount(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(200, Math.floor(num));
}

export function parseFirmaEkPlasiyerMapFromAyarlar(
  ayarlar: Ayar[] | null | undefined
): FirmaEkPlasiyerMap {
  if (!Array.isArray(ayarlar)) return {};
  const row = ayarlar.find((item) => item.anahtar === FIRMA_EK_PLASIYER_AYAR_KEY);
  if (!row?.deger) return {};
  try {
    const parsed = JSON.parse(row.deger);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: FirmaEkPlasiyerMap = {};
    for (const [firmaId, count] of Object.entries(parsed as Record<string, unknown>)) {
      out[firmaId] = sanitizeEkPlasiyerCount(count);
    }
    return out;
  } catch {
    return {};
  }
}

export function getEffectiveEkPlasiyer(
  firma: Pick<Firma, 'id' | 'ek_plasiyer_sayisi'> | null | undefined,
  fallbackMap?: FirmaEkPlasiyerMap
): number {
  if (!firma) return 0;
  if (typeof firma.ek_plasiyer_sayisi === 'number' && Number.isFinite(firma.ek_plasiyer_sayisi)) {
    return sanitizeEkPlasiyerCount(firma.ek_plasiyer_sayisi);
  }
  if (fallbackMap && typeof fallbackMap[firma.id] === 'number') {
    return sanitizeEkPlasiyerCount(fallbackMap[firma.id]);
  }
  return 0;
}

function inferTierFromCustomPaket(paket: Paket | null | undefined): PackageTierKey {
  if (!paket) return 'baslangic';
  const byName = detectTierKeyFromName(paket.ad);
  if (byName) return byName;

  const lines = normalizePackageFeatures(paket.ozellikler).join(' ').toLocaleLowerCase('tr-TR');
  if (lines.includes('ubl') || lines.includes('xml')) {
    return 'kurumsal';
  }
  if (lines.includes('nfc') || lines.includes('link')) {
    return 'profesyonel';
  }
  return 'baslangic';
}

export function resolvePackageEntitlements(params: {
  firma: Firma | null;
  activePaket: Paket | null;
  periodStatus: EntitlementPeriodStatus;
  isSuperAdmin: boolean;
  ekPlasiyerFallback?: number;
}): PackageEntitlements {
  const { firma, activePaket, periodStatus, isSuperAdmin, ekPlasiyerFallback = 0 } = params;
  const ekPlasiyerSayisi = getEffectiveEkPlasiyer(
    firma,
    firma ? { [firma.id]: ekPlasiyerFallback } : undefined
  );

  // Süper Admin veya sınırsız hesaplar: Kurumsal tam yetki + mevcut ek plasiyerler
  if (isSuperAdmin || firma?.sinirsiz === true || periodStatus === 'unlimited') {
    const included = TIER_PLASIYER_LIMITS.kurumsal;
    return {
      tierKey: 'kurumsal',
      tierLabel: TIER_LABELS.kurumsal,
      sourceLabel: 'Sınırsız Tam Erişim',
      isTrialFullAccess: false,
      isUnlimited: true,
      includedPlasiyerLimit: included,
      ekPlasiyerSayisi,
      totalPlasiyerLimit: included + ekPlasiyerSayisi,
      canUsePaymentLink: true,
      canUseNfc: true,
      canUseUblImport: true,
    };
  }

  // 7 Günlük Ücretsiz Deneme: Kurumsal seviye tüm özellikler açık
  if (periodStatus === 'active_trial') {
    const included = TIER_PLASIYER_LIMITS.kurumsal;
    return {
      tierKey: 'kurumsal',
      tierLabel: TIER_LABELS.kurumsal,
      sourceLabel: '7 Günlük Deneme (Kurumsal Seviye)',
      isTrialFullAccess: true,
      isUnlimited: false,
      includedPlasiyerLimit: included,
      ekPlasiyerSayisi,
      totalPlasiyerLimit: included + ekPlasiyerSayisi,
      canUsePaymentLink: true,
      canUseNfc: true,
      canUseUblImport: true,
    };
  }

  const tierKey = inferTierFromCustomPaket(activePaket);
  const included = TIER_PLASIYER_LIMITS[tierKey];

  return {
    tierKey,
    tierLabel: activePaket?.ad || TIER_LABELS[tierKey],
    sourceLabel: activePaket?.ad || TIER_LABELS[tierKey],
    isTrialFullAccess: false,
    isUnlimited: false,
    includedPlasiyerLimit: included,
    ekPlasiyerSayisi,
    totalPlasiyerLimit: included + ekPlasiyerSayisi,
    canUsePaymentLink: tierKey === 'profesyonel' || tierKey === 'kurumsal',
    canUseNfc: tierKey === 'profesyonel' || tierKey === 'kurumsal',
    canUseUblImport: tierKey === 'kurumsal',
  };
}

export const STANDALONE_EK_PLASIYER_TAG = 'Sadece Ek Plasiyer Ekleme';

export interface PaymentRequestMeta {
  isStandaloneEkPlasiyer: boolean;
  ekPlasiyerAdet: number | null;
}

export function calculatePackageTotalAmount(
  basePrice: number,
  ekPlasiyerAdet: number,
  ekPlasiyerUnitPrice: number = EK_PLASIYER_FIYAT
): number {
  const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : 0;
  const safeCount = sanitizeEkPlasiyerCount(ekPlasiyerAdet);
  const safeUnit =
    Number.isFinite(ekPlasiyerUnitPrice) && ekPlasiyerUnitPrice > 0
      ? ekPlasiyerUnitPrice
      : EK_PLASIYER_FIYAT;
  return safeBase + safeCount * safeUnit;
}

export function calculateStandaloneEkPlasiyerAmount(
  ekPlasiyerAdet: number,
  ekPlasiyerUnitPrice: number = EK_PLASIYER_FIYAT
): number {
  const safeCount = sanitizeEkPlasiyerCount(ekPlasiyerAdet);
  const safeUnit =
    Number.isFinite(ekPlasiyerUnitPrice) && ekPlasiyerUnitPrice > 0
      ? ekPlasiyerUnitPrice
      : EK_PLASIYER_FIYAT;
  return safeCount * safeUnit;
}

export function formatOdemeNoteWithEkPlasiyer(
  ekPlasiyerAdet: number,
  userNote?: string | null,
  selectedTitle?: string | null
): string | null {
  const safeCount = sanitizeEkPlasiyerCount(ekPlasiyerAdet);
  const cleanNote = (userNote || '').trim();
  const parts: string[] = [];

  if (selectedTitle) {
    parts.push(`Paket: ${selectedTitle.trim()}`);
  }
  parts.push(`Ek Plasiyer: ${safeCount} Adet`);
  if (safeCount > 0) {
    parts.push(`Ek Plasiyer Tutarı: +${safeCount * EK_PLASIYER_FIYAT} TL`);
  }

  const headerLine = parts.join(' | ');
  if (cleanNote) {
    return `${headerLine}\n${cleanNote}`;
  }
  return headerLine;
}

export function formatStandaloneEkPlasiyerNote(
  ekPlasiyerAdet: number,
  userNote?: string | null,
  currentPackageLabel?: string | null
): string {
  const safeCount = Math.max(1, sanitizeEkPlasiyerCount(ekPlasiyerAdet));
  const totalAmount = calculateStandaloneEkPlasiyerAmount(safeCount);
  const cleanNote = (userNote || '').trim();
  const parts: string[] = [
    `Talep: ${STANDALONE_EK_PLASIYER_TAG}`,
    `Ek Plasiyer: +${safeCount} Adet`,
    `Tutar: ${totalAmount} TL`,
  ];
  if (currentPackageLabel) {
    parts.push(`Mevcut Paket: ${currentPackageLabel.trim()}`);
  }

  const headerLine = parts.join(' | ');
  if (cleanNote) {
    return `${headerLine}\n${cleanNote}`;
  }
  return headerLine;
}

export function parseEkPlasiyerFromNote(note: string | null | undefined): number | null {
  if (!note || typeof note !== 'string') return null;
  const match = note.match(/Ek\s*Plasiyer\s*:\s*\+?(\d+)/i);
  if (!match) return null;
  return sanitizeEkPlasiyerCount(parseInt(match[1], 10));
}

export function parsePaymentRequestMeta(note: string | null | undefined): PaymentRequestMeta {
  if (!note || typeof note !== 'string') {
    return { isStandaloneEkPlasiyer: false, ekPlasiyerAdet: null };
  }
  const isStandaloneEkPlasiyer =
    /Sadece\s*Ek\s*Plasiyer/i.test(note) || /standalone_ek_plasiyer/i.test(note);
  const ekPlasiyerAdet = parseEkPlasiyerFromNote(note);
  return {
    isStandaloneEkPlasiyer,
    ekPlasiyerAdet,
  };
}

export function isMissingEkPlasiyerColumnError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message =
    'message' in err ? String((err as { message?: unknown }).message ?? '').toLowerCase() : '';
  const details =
    'details' in err ? String((err as { details?: unknown }).details ?? '').toLowerCase() : '';
  const combined = `${message} ${details}`;

  return (
    code === 'PGRST204' ||
    code === '42703' ||
    (combined.includes('ek_plasiyer_sayisi') &&
      (combined.includes('schema cache') ||
        combined.includes('does not exist') ||
        combined.includes('could not find')))
  );
}
