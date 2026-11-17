import { Cari, Fatura, FaturaYon, Firma } from '../types/database';
import { supabase } from './supabase';
import { ParsedUblInvoice, UblPartyInfo } from './ublParser';

const STORAGE_PREFIX = 'tahsilatim_ubl_snapshots_v1_';
const MAX_LOCALSTORAGE_SNAPSHOTS = 150;
const IDB_NAME = 'tahsilatim_ubl_db';
const IDB_VERSION = 1;
const IDB_STORE = 'snapshots';

export interface UblInvoiceSnapshotEntry {
  key: string;
  yon: FaturaYon;
  savedAt: string;
  invoice: ParsedUblInvoice;
}

export interface CompactUblDetay {
  v: 1;
  uuid: string;
  profileId: string;
  issueTime: string;
  invoiceTypeCode: string;
  currencyCode: string;
  exchangeRate: number;
  originalAmount: number;
  tutarTL: number;
  supplier: UblPartyInfo;
  customer: UblPartyInfo;
  notes: string[];
  lines: ParsedUblInvoice['lines'];
  totals: ParsedUblInvoice['totals'];
  hasEmbeddedXslt?: boolean;
}

export type FaturaWithDetay = Fatura & {
  ubl_detay?: CompactUblDetay | null;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

let cloudColumnSupport: 'unknown' | 'supported' | 'unsupported' = 'unknown';

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

function buildIdbRecordKey(firmaId: string, faturaNo: string, yon: FaturaYon): string {
  return `${firmaId}::${normalizeSnapshotKey(faturaNo, yon)}`;
}

function stripHeavyGibHtml(invoice: ParsedUblInvoice): ParsedUblInvoice {
  if (!invoice.renderedGibHtml) return invoice;
  const { renderedGibHtml: _omitted, ...rest } = invoice;
  return rest;
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

  // localStorage 5MB sınırını korumak için en yeni 150 kayıt tutulur; kota dolarsa renderedGibHtml sadeleştirilir
  const trimmed = entries.slice(0, MAX_LOCALSTORAGE_SNAPSHOTS);
  try {
    store.setItem(`${STORAGE_PREFIX}${firmaId}`, JSON.stringify(trimmed));
  } catch {
    const compact = trimmed.slice(0, 80).map((e) => ({
      ...e,
      invoice: stripHeavyGibHtml(e.invoice),
    }));
    try {
      store.setItem(`${STORAGE_PREFIX}${firmaId}`, JSON.stringify(compact));
    } catch {
      // Depolama erişilemezse sessizce geç
    }
  }
}

function openUblIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveToIndexedDb(
  firmaId: string,
  items: Array<{ yon: FaturaYon; parsed: ParsedUblInvoice }>,
  savedAt: string
): Promise<void> {
  const db = await openUblIdb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (const item of items) {
        if (!item.parsed?.faturaNo) continue;
        store.put({
          id: buildIdbRecordKey(firmaId, item.parsed.faturaNo, item.yon),
          firmaId,
          faturaNoUpper: item.parsed.faturaNo.trim().toUpperCase(),
          yon: item.yon,
          savedAt,
          invoice: item.parsed,
        });
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        resolve();
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve();
    }
  });
}

async function getFromIndexedDb(
  firmaId: string,
  faturaNo: string,
  yon?: FaturaYon
): Promise<{ invoice: ParsedUblInvoice; yon: FaturaYon } | null> {
  const db = await openUblIdb();
  if (!db) return null;

  const cleanNo = (faturaNo || '').trim().toUpperCase();
  if (!cleanNo) {
    db.close();
    return null;
  }

  const candidateKeys: Array<{ key: string; yon: FaturaYon }> = yon
    ? [{ key: buildIdbRecordKey(firmaId, cleanNo, yon), yon }]
    : [
        { key: buildIdbRecordKey(firmaId, cleanNo, 'satis'), yon: 'satis' },
        { key: buildIdbRecordKey(firmaId, cleanNo, 'alis'), yon: 'alis' },
      ];

  try {
    for (const candidate of candidateKeys) {
      const found = await new Promise<{ invoice: ParsedUblInvoice; yon: FaturaYon } | null>(
        (resolve) => {
          try {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const store = tx.objectStore(IDB_STORE);
            const req = store.get(candidate.key);
            req.onsuccess = () => {
              const rec = req.result as { invoice?: ParsedUblInvoice; yon?: FaturaYon } | undefined;
              if (rec?.invoice) {
                resolve({ invoice: rec.invoice, yon: rec.yon || candidate.yon });
              } else {
                resolve(null);
              }
            };
            req.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        }
      );
      if (found) {
        return found;
      }
    }
    return null;
  } finally {
    try {
      db.close();
    } catch {
      // ignore
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

  // Tarayıcı ortamındaysa tam görseli (GİB XSLT dahil) arka planda IndexedDB'ye de yaz
  if (!storage && typeof indexedDB !== 'undefined') {
    void saveToIndexedDb(firmaId, items, nowIso);
  }
}

export async function saveUblInvoiceSnapshotsAsync(
  firmaId: string,
  items: Array<{ yon: FaturaYon; parsed: ParsedUblInvoice }>,
  storage?: StorageLike | null
): Promise<void> {
  if (!firmaId || items.length === 0) return;
  const nowIso = new Date().toISOString();
  saveUblInvoiceSnapshots(firmaId, items, storage);
  if (!storage && typeof indexedDB !== 'undefined') {
    await saveToIndexedDb(firmaId, items, nowIso);
  }
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

export async function getUblInvoiceSnapshotAsync(
  firmaId: string,
  faturaNo: string,
  yon?: FaturaYon,
  storage?: StorageLike | null
): Promise<{ invoice: ParsedUblInvoice; yon: FaturaYon } | null> {
  if (!firmaId || !faturaNo) return null;

  if (!storage && typeof indexedDB !== 'undefined') {
    const idbMatch = await getFromIndexedDb(firmaId, faturaNo, yon);
    if (idbMatch) {
      return idbMatch;
    }
  }

  return getUblInvoiceSnapshot(firmaId, faturaNo, yon, storage);
}

/**
 * Veritabanı kotasını şişirmemek için yalnızca ~1.5-3 KB boyutunda kompakt JSON özeti üretir (ham XSLT HTML dahil edilmez).
 */
export function createCompactCloudDetay(parsed: ParsedUblInvoice): CompactUblDetay {
  return {
    v: 1,
    uuid: parsed.uuid || '',
    profileId: parsed.profileId || 'TICARIFATURA',
    issueTime: parsed.issueTime || '',
    invoiceTypeCode: parsed.invoiceTypeCode || 'SATIS',
    currencyCode: parsed.currencyCode || 'TRY',
    exchangeRate: parsed.exchangeRate || 1,
    originalAmount: parsed.originalAmount || 0,
    tutarTL: parsed.tutarTL || 0,
    supplier: parsed.supplier,
    customer: parsed.customer,
    notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 12) : [],
    lines: Array.isArray(parsed.lines) ? parsed.lines : [],
    totals: parsed.totals,
    hasEmbeddedXslt: Boolean(parsed.hasEmbeddedXslt),
  };
}

export function hydrateParsedFromCompactDetay(params: {
  fatura: Fatura;
  detay: CompactUblDetay;
}): ParsedUblInvoice {
  const { fatura, detay } = params;
  return {
    fileName: `${fatura.fatura_no}.xml`,
    faturaNo: fatura.fatura_no,
    uuid: detay.uuid || '',
    profileId: detay.profileId || 'TICARIFATURA',
    tarih: fatura.tarih,
    issueTime: detay.issueTime || '',
    invoiceTypeCode: detay.invoiceTypeCode || 'SATIS',
    currencyCode: detay.currencyCode || 'TRY',
    exchangeRate: detay.exchangeRate || 1,
    originalAmount: detay.originalAmount || Number(fatura.tutar) || 0,
    tutarTL: detay.tutarTL || Number(fatura.tutar) || 0,
    supplier: detay.supplier,
    customer: detay.customer,
    detectedYon: fatura.yon,
    detectionReason: 'Bulut fatura detayı',
    notes: Array.isArray(detay.notes) ? detay.notes : [],
    lines: Array.isArray(detay.lines) ? detay.lines : [],
    totals: detay.totals,
    hasEmbeddedXslt: Boolean(detay.hasEmbeddedXslt),
  };
}

function isMissingDetayColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const obj = err as { code?: string; message?: string; details?: string };
  const code = String(obj.code || '').toUpperCase();
  const text = `${obj.message || ''} ${obj.details || ''}`.toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    text.includes('ubl_detay')
  );
}

/**
 * Supabase `faturalar.ubl_detay` kolonu mevcutsa kompakt JSON detayını (~2 KB/fatura) buluta eşitler.
 * Kolon yoksa sessizce atlar, hata fırlatmaz.
 */
export async function syncUblDetayToSupabase(
  firmaId: string,
  items: Array<{ yon: FaturaYon; parsed: ParsedUblInvoice }>
): Promise<{ syncedCount: number; supported: boolean }> {
  if (!firmaId || items.length === 0 || cloudColumnSupport === 'unsupported') {
    return { syncedCount: 0, supported: cloudColumnSupport !== 'unsupported' };
  }

  let syncedCount = 0;
  for (const item of items) {
    if (!item.parsed?.faturaNo) continue;
    try {
      const compactDetay = createCompactCloudDetay(item.parsed);
      const { error } = await supabase
        .from('faturalar')
        .update({ ubl_detay: compactDetay })
        .eq('firma_id', firmaId)
        .eq('fatura_no', item.parsed.faturaNo.trim())
        .eq('yon', item.yon);

      if (error) {
        if (isMissingDetayColumnError(error)) {
          cloudColumnSupport = 'unsupported';
          return { syncedCount, supported: false };
        }
        continue;
      }

      cloudColumnSupport = 'supported';
      syncedCount++;
    } catch {
      return { syncedCount, supported: cloudColumnSupport !== 'unsupported' };
    }
  }

  return { syncedCount, supported: true };
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
      'Bu fatura için orijinal UBL/XML satır detayları bu cihazın önbelleğinde bulunamadı. Yukarıdaki "XML Yükle / Eşleştir" veya Ekstredeki "Toplu XML Eşleştir" butonundan dosyasını seçip tam GİB görüntüsünü oluşturabilirsiniz.',
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
