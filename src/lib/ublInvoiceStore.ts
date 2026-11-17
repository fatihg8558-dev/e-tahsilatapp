import { Cari, FaturaYon, Firma } from '../types/database';
import { ParsedUblInvoice, UblPartyInfo } from './ublParser';

const STORAGE_PREFIX = 'tahsilatim_ubl_snapshots_v1_';
const MAX_SNAPSHOTS_PER_FIRMA = 400;

export interface UblInvoiceSnapshotEntry {
  key: string;
  yon: FaturaYon;
  savedAt: string;
  invoice: ParsedUblInvoice;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function resolveStorage(explicit?: StorageLike | null): StorageLike | null {
  if (explicit) return explicit;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return (globalThis as unknown as { localStorage?: StorageLike }).localStorage ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeSnapshotKey(faturaNo: string, yon: FaturaYon): string {
  return `${yon}:${(faturaNo || '').trim().toUpperCase()}`;
}

function readAllEntries(firmaId: string, storage?: StorageLike | null): UblInvoiceSnapshotEntry[] {
  const store = resolveStorage(storage);
  if (!store || !firmaId) return [];
  try {
    const raw = store.getItem(`${STORAGE_PREFIX}${firmaId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is UblInvoiceSnapshotEntry =>
        Boolean(item && typeof item.key === 'string' && item.invoice && item.invoice.faturaNo)
    );
  } catch {
    return [];
  }
}

function writeEntries(
  firmaId: string,
  entries: UblInvoiceSnapshotEntry[],
  storage?: StorageLike | null
): void {
  const store = resolveStorage(storage);
  if (!store || !firmaId) return;

  const trimmed = entries.slice(0, MAX_SNAPSHOTS_PER_FIRMA);
  try {
    store.setItem(`${STORAGE_PREFIX}${firmaId}`, JSON.stringify(trimmed));
  } catch {
    // Depolama kotası aşılırsa en yeni yarısını tutmayı dene
    try {
      store.setItem(`${STORAGE_PREFIX}${firmaId}`, JSON.stringify(trimmed.slice(0, 100)));
    } catch {
      // Depolama erişilemezse sessizce geç
    }
  }
}

export function saveUblInvoiceSnapshots(
  firmaId: string,
  items: Array<{ yon: FaturaYon; parsed: ParsedUblInvoice }>,
  storage?: StorageLike | null
): void {
  if (!firmaId || items.length === 0) return;

  const existing = readAllEntries(firmaId, storage);
  const byKey = new Map<string, UblInvoiceSnapshotEntry>();
  for (const entry of existing) {
    byKey.set(entry.key, entry);
  }

  const nowIso = new Date().toISOString();
  for (const item of items) {
    if (!item.parsed?.faturaNo) continue;
    const key = normalizeSnapshotKey(item.parsed.faturaNo, item.yon);
    byKey.set(key, {
      key,
      yon: item.yon,
      savedAt: nowIso,
      invoice: item.parsed,
    });
  }

  const sorted = Array.from(byKey.values()).sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt)
  );
  writeEntries(firmaId, sorted, storage);
}

export function getUblInvoiceSnapshot(
  firmaId: string,
  faturaNo: string,
  yon?: FaturaYon,
  storage?: StorageLike | null
): { invoice: ParsedUblInvoice; yon: FaturaYon } | null {
  const cleanNo = (faturaNo || '').trim().toUpperCase();
  if (!firmaId || !cleanNo) return null;

  const entries = readAllEntries(firmaId, storage);
  if (yon) {
    const exactKey = normalizeSnapshotKey(cleanNo, yon);
    const exact = entries.find((e) => e.key === exactKey);
    if (exact) {
      return { invoice: exact.invoice, yon: exact.yon };
    }
  }

  const matched = entries.find(
    (e) => e.invoice.faturaNo.trim().toUpperCase() === cleanNo
  );
  return matched ? { invoice: matched.invoice, yon: matched.yon } : null;
}

export function buildFallbackInvoiceFromRecord(params: {
  faturaNo: string;
  tarih: string;
  tutar: number;
  yon: FaturaYon;
  firma?: Firma | null;
  cari?: Cari | null;
}): ParsedUblInvoice {
  const { faturaNo, tarih, tutar, yon, firma, cari } = params;
  const amount = Math.round((Number(tutar) || 0) * 100) / 100;

  const firmaParty: UblPartyInfo = {
    vkn: firma?.vergi_no || '',
    unvan: firma?.unvan || 'Kendi Firmanız',
    telefon: firma?.telefon || '',
    email: firma?.email || '',
    vergiDairesi: firma?.vergi_dairesi || '',
    adres: firma?.adres || '',
    web: firma?.web || '',
  };

  const cariParty: UblPartyInfo = {
    vkn: cari?.vergi_tc_no || '',
    unvan: cari?.unvan || 'Cari Hesap',
    telefon: cari?.telefon || '',
    email: cari?.email || '',
    vergiDairesi: '',
    adres: '',
    web: '',
  };

  const supplier = yon === 'satis' ? firmaParty : cariParty;
  const customer = yon === 'satis' ? cariParty : firmaParty;

  return {
    fileName: `${faturaNo}.xml`,
    faturaNo: faturaNo || '-',
    uuid: '',
    profileId: 'TICARIFATURA',
    tarih: tarih || new Date().toISOString().split('T')[0],
    issueTime: '',
    invoiceTypeCode: 'SATIS',
    currencyCode: 'TRY',
    exchangeRate: 1,
    originalAmount: amount,
    tutarTL: amount,
    supplier,
    customer,
    detectedYon: yon,
    detectionReason: 'Veritabanı fatura özeti',
    notes: [
      'Bu fatura için orijinal UBL/XML satır detayları tarayıcı önbelleğinde bulunamadı. İsterseniz yukarıdaki "XML Yükle / Eşleştir" butonundan dosyasını seçip tam görüntüyü oluşturabilirsiniz.',
    ],
    lines: [],
    totals: {
      lineExtensionAmount: amount,
      allowanceTotalAmount: 0,
      taxExclusiveAmount: amount,
      taxTotalAmount: 0,
      withholdingTaxAmount: 0,
      taxInclusiveAmount: amount,
      payableAmount: amount,
      taxSubtotals: [],
    },
  };
}
