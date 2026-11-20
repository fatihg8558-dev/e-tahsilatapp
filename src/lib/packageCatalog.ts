import { Paket } from '../types/database';

export type PackageTierKey = 'baslangic' | 'profesyonel' | 'kurumsal';
export type BillingPeriodKey = 'aylik' | 'alti_aylik' | 'yillik';

export interface BillingPeriodOption {
  key: BillingPeriodKey;
  label: string;
  shortLabel: string;
  sureGun: number;
  giftNote?: string;
}

export interface PackageFeatureCheck {
  label: string;
  included: boolean;
}

export interface PackageTierDefinition {
  key: PackageTierKey;
  title: string;
  badge?: string;
  prices: Record<BillingPeriodKey, number>;
  includedUsers: string;
  includedPlasiyerLimit: number;
  ekPlasiyerLabel: string;
  ekPlasiyerUcreti: number;
  features: PackageFeatureCheck[];
}

export const BILLING_PERIODS: BillingPeriodOption[] = [
  { key: 'aylik', label: 'Aylık', shortLabel: 'Ay', sureGun: 30 },
  { key: 'alti_aylik', label: '6 Aylık', shortLabel: '6 Ay', sureGun: 180, giftNote: '1 Ay Hediye' },
  { key: 'yillik', label: 'Yıllık', shortLabel: 'Yıl', sureGun: 365, giftNote: '3 Ay Hediye' },
];

export const PACKAGE_TIERS: PackageTierDefinition[] = [
  {
    key: 'baslangic',
    title: 'Başlangıç (Basic)',
    prices: {
      aylik: 200,
      alti_aylik: 1000,
      yillik: 1800,
    },
    includedUsers: '1 Ana + 1 Plasiyer',
    includedPlasiyerLimit: 1,
    ekPlasiyerLabel: '+100 TL',
    ekPlasiyerUcreti: 100,
    features: [
      { label: 'Tahsilat & Tediye Makbuzu', included: true },
      { label: 'Elle Alış/Satış Faturası', included: true },
      { label: 'WhatsApp & Mail Gönderimi', included: true },
      { label: 'Çoklu Kasa, Banka & Çek/Senet', included: true },
      { label: 'Link ile Tahsilat (iyzico vb.)', included: false },
      { label: 'NFC ile Temassız Tahsilat', included: false },
      { label: 'UBL / XML Fatura Cari İşleme', included: false },
      { label: 'Cari Mutabakat (A4 PDF & Online Link)', included: false },
    ],
  },
  {
    key: 'profesyonel',
    title: 'Profesyonel (Plus)',
    badge: 'Önerilen',
    prices: {
      aylik: 400,
      alti_aylik: 2000,
      yillik: 3600,
    },
    includedUsers: '1 Ana + 3 Plasiyer',
    includedPlasiyerLimit: 3,
    ekPlasiyerLabel: '+100 TL',
    ekPlasiyerUcreti: 100,
    features: [
      { label: 'Tahsilat & Tediye Makbuzu', included: true },
      { label: 'Elle Alış/Satış Faturası', included: true },
      { label: 'WhatsApp & Mail Gönderimi', included: true },
      { label: 'Çoklu Kasa, Banka & Çek/Senet', included: true },
      { label: 'Link ile Tahsilat (iyzico vb.)', included: true },
      { label: 'NFC ile Temassız Tahsilat', included: true },
      { label: 'UBL / XML Fatura Cari İşleme', included: false },
      { label: 'Cari Mutabakat (A4 PDF & Online Link)', included: false },
    ],
  },
  {
    key: 'kurumsal',
    title: 'Kurumsal (Pro)',
    badge: 'Tam Yetki',
    prices: {
      aylik: 600,
      alti_aylik: 3000,
      yillik: 5400,
    },
    includedUsers: '1 Ana + 9 Plasiyer',
    includedPlasiyerLimit: 9,
    ekPlasiyerLabel: '+100 TL',
    ekPlasiyerUcreti: 100,
    features: [
      { label: 'Tahsilat & Tediye Makbuzu', included: true },
      { label: 'Elle Alış/Satış Faturası', included: true },
      { label: 'WhatsApp & Mail Gönderimi', included: true },
      { label: 'Çoklu Kasa, Banka & Çek/Senet', included: true },
      { label: 'Link ile Tahsilat (iyzico vb.)', included: true },
      { label: 'NFC ile Temassız Tahsilat', included: true },
      { label: 'UBL / XML Fatura Cari İşleme', included: true },
      { label: 'Cari Mutabakat (A4 PDF & Online Link)', included: true },
    ],
  },
];

export interface ComparisonFeatureRow {
  label: string;
  values: Record<PackageTierKey, boolean>;
}

export const COMPARISON_FEATURE_ROWS: ComparisonFeatureRow[] = [
  {
    label: 'Tahsilat & Tediye Makbuzu',
    values: { baslangic: true, profesyonel: true, kurumsal: true },
  },
  {
    label: 'Elle Alış/Satış Faturası',
    values: { baslangic: true, profesyonel: true, kurumsal: true },
  },
  {
    label: 'WhatsApp & Mail Gönderimi',
    values: { baslangic: true, profesyonel: true, kurumsal: true },
  },
  {
    label: 'Çoklu Kasa, Banka & Çek/Senet',
    values: { baslangic: true, profesyonel: true, kurumsal: true },
  },
  {
    label: 'Link ile Tahsilat (iyzico vb.)',
    values: { baslangic: false, profesyonel: true, kurumsal: true },
  },
  {
    label: 'NFC ile Temassız Tahsilat',
    values: { baslangic: false, profesyonel: true, kurumsal: true },
  },
  {
    label: 'UBL / XML Fatura Cari İşleme',
    values: { baslangic: false, profesyonel: false, kurumsal: true },
  },
  {
    label: 'Cari Mutabakat (A4 PDF & Online Link)',
    values: { baslangic: false, profesyonel: false, kurumsal: true },
  },
];

export function formatTlInteger(amount: number): string {
  return `${Math.round(amount).toLocaleString('tr-TR')} TL`;
}

export function detectTierKeyFromName(name: string): PackageTierKey | null {
  const lower = (name || '').toLocaleLowerCase('tr-TR');
  if (lower.includes('başlangıç') || lower.includes('baslangic') || lower.includes('basic')) {
    return 'baslangic';
  }
  if (lower.includes('profesyonel') || lower.includes('plus')) {
    return 'profesyonel';
  }
  if (lower.includes('kurumsal') || lower.includes('pro')) {
    return 'kurumsal';
  }
  return null;
}

export function detectPeriodKey(paket: Pick<Paket, 'ad' | 'sure_gun'>): BillingPeriodKey {
  const lower = (paket.ad || '').toLocaleLowerCase('tr-TR');
  if (lower.includes('yıllık') || lower.includes('yillik') || paket.sure_gun >= 330) {
    return 'yillik';
  }
  if (lower.includes('6 aylık') || lower.includes('6 aylik') || paket.sure_gun >= 150) {
    return 'alti_aylik';
  }
  return 'aylik';
}

export function findMatchingPaket(
  paketler: Paket[],
  tierKey: PackageTierKey,
  periodKey: BillingPeriodKey
): Paket | null {
  const periodOption = BILLING_PERIODS.find((p) => p.key === periodKey);
  const targetDays = periodOption?.sureGun ?? 30;

  // 1. Tam tier + dönem eşleşmesi
  const exact = paketler.find(
    (p) => detectTierKeyFromName(p.ad) === tierKey && detectPeriodKey(p) === periodKey
  );
  if (exact) return exact;

  // 2. Aynı tier için süreye en yakın paket
  const sameTier = paketler
    .filter((p) => detectTierKeyFromName(p.ad) === tierKey)
    .sort((a, b) => Math.abs(a.sure_gun - targetDays) - Math.abs(b.sure_gun - targetDays));
  if (sameTier.length > 0) return sameTier[0];

  // 3. Aynı süreye sahip herhangi bir paket
  const samePeriod = paketler.find((p) => detectPeriodKey(p) === periodKey);
  if (samePeriod) return samePeriod;

  return paketler[0] ?? null;
}

export interface StandardPaketSeedItem {
  tierKey: PackageTierKey;
  periodKey: BillingPeriodKey;
  ad: string;
  sure_gun: number;
  fiyat: number;
  ek_plasiyer_ucreti: number;
  aktif: boolean;
  ozellikler: string[];
}

export function buildStandardPackageSeedList(): StandardPaketSeedItem[] {
  const list: StandardPaketSeedItem[] = [];
  for (const tier of PACKAGE_TIERS) {
    for (const period of BILLING_PERIODS) {
      const featureLines = [
        `Dahil Kullanıcı: ${tier.includedUsers}`,
        `Ek Plasiyer Ücreti: ${tier.ekPlasiyerLabel}`,
        ...tier.features.filter((f) => f.included).map((f) => f.label),
      ];
      list.push({
        tierKey: tier.key,
        periodKey: period.key,
        ad: `${tier.title} - ${period.label}`,
        sure_gun: period.sureGun,
        fiyat: tier.prices[period.key],
        ek_plasiyer_ucreti: tier.ekPlasiyerUcreti,
        aktif: true,
        ozellikler: featureLines,
      });
    }
  }
  return list;
}
