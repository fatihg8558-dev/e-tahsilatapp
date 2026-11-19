import { supabase } from './supabase';
import { Islem, Kasa, Profile } from '../types/database';
import { syncIslemToKasa } from './kasaSyncService';
import { isMissingKasaTableError } from './kasaSql';
import { formatCurrency, formatDate } from './formatters';
import { printPdfReport } from './exportService';

export interface TurPendingSummary {
  count: number;
  tahsilat: number;
  tediye: number;
  net: number;
}

export interface PerPlasiyerGunSonuItem {
  plasiyerId: string;
  plasiyerAd: string;
  pendingCount: number;
  pendingNetNakit: number;
  pendingKart: number;
  pendingCek: number;
  pendingSenet: number;
  pendingTotal: number;
  transferredCount: number;
}

export interface PlasiyerGunSonuSummary {
  validCount: number;
  iptalCount: number;
  iptalTotal: number;
  pendingCount: number;
  pendingTotal: number;
  transferredCount: number;
  transferredTotal: number;
  totalTahsilat: number;
  totalTediye: number;
  netTotal: number;
  nakitTahsilat: number;
  nakitTediye: number;
  netNakit: number;
  kartTahsilat: number;
  kartTediye: number;
  netKart: number;
  cekTahsilat: number;
  cekTediye: number;
  netCek: number;
  senetTahsilat: number;
  senetTediye: number;
  netSenet: number;
  pendingNetNakit: number;
  pendingByTur: {
    nakit: TurPendingSummary;
    kredi_karti: TurPendingSummary;
    cek: TurPendingSummary;
    senet: TurPendingSummary;
  };
  perPlasiyer: PerPlasiyerGunSonuItem[];
}

export interface CashCountReconciliation {
  parsedCounted: number | null;
  expectedNetNakit: number;
  difference: number;
  status: 'empty' | 'match' | 'surplus' | 'shortage';
}

export interface GunSonuHistoryEntry {
  id: string;
  closedAt: string;
  firmaId: string;
  plasiyerId: string;
  plasiyerName: string;
  closedByName: string;
  dateLabel: string;
  transferredCount: number;
  kasaSyncedCount: number;
  evrakTransferredCount: number;
  expectedNetNakit: number;
  countedNakit: number | null;
  cashDifference: number;
  kartNet: number;
  cekNet: number;
  senetNet: number;
  note: string;
}

export interface ExecuteGunSonuTransferParams {
  firmaId: string;
  userId?: string | null;
  items: Islem[];
  targetNakitKasaId?: string | null;
  targetKartKasaId?: string | null;
  knownKasalar?: Kasa[];
  syncToKasa?: boolean;
}

export interface ExecuteGunSonuTransferResult {
  transferredCount: number;
  kasaSyncedCount: number;
  evrakTransferredCount: number;
  failedCount: number;
  kasaTableMissing: boolean;
  error?: string;
}

const isExcludedShadowRow = (i: Islem): boolean =>
  Boolean(i.aciklama?.includes('[ÇAPRAZ ÖDEME') || i.belge_no?.startsWith('ÇPZ-'));

export function parseTrCurrencyInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let cleaned = trimmed.replace(/\s+/g, '').replace(/₺|TL/gi, '');
  if (!cleaned) return null;

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    // Örn: 1.250,75 -> 1250.75
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    cleaned = cleaned.replace(',', '.');
  } else if (hasDot) {
    // Örn: 1.250 veya 1.250.000 (binlik ayırıcı) vs 1250.50
    const parts = cleaned.split('.');
    const looksLikeThousands =
      parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    if (looksLikeThousands) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

export function computePlasiyerGunSonuSummary(
  islemler: Islem[],
  plasiyerList: Profile[] = []
): PlasiyerGunSonuSummary {
  const nameById = new Map<string, string>();
  plasiyerList.forEach((p) => {
    if (p.id && p.ad_soyad) nameById.set(p.id, p.ad_soyad);
  });

  const emptyTur = (): TurPendingSummary => ({ count: 0, tahsilat: 0, tediye: 0, net: 0 });
  const pendingByTur = {
    nakit: emptyTur(),
    kredi_karti: emptyTur(),
    cek: emptyTur(),
    senet: emptyTur(),
  };

  let validCount = 0;
  let iptalCount = 0;
  let iptalTotal = 0;
  let pendingCount = 0;
  let pendingTotal = 0;
  let transferredCount = 0;
  let transferredTotal = 0;

  let totalTahsilat = 0;
  let totalTediye = 0;
  let nakitTahsilat = 0;
  let nakitTediye = 0;
  let kartTahsilat = 0;
  let kartTediye = 0;
  let cekTahsilat = 0;
  let cekTediye = 0;
  let senetTahsilat = 0;
  let senetTediye = 0;

  const perPlasiyerMap = new Map<string, PerPlasiyerGunSonuItem>();

  for (const item of islemler) {
    if (isExcludedShadowRow(item)) continue;
    const tutar = Number(item.tutar) || 0;

    if (item.iptal) {
      iptalCount++;
      iptalTotal += tutar;
      continue;
    }

    validCount++;
    const isTahsilat = item.tip === 'tahsilat';
    const signed = isTahsilat ? tutar : -tutar;

    if (isTahsilat) {
      totalTahsilat += tutar;
    } else {
      totalTediye += tutar;
    }

    if (item.tur === 'nakit') {
      if (isTahsilat) nakitTahsilat += tutar;
      else nakitTediye += tutar;
    } else if (item.tur === 'kredi_karti') {
      if (isTahsilat) kartTahsilat += tutar;
      else kartTediye += tutar;
    } else if (item.tur === 'cek') {
      if (isTahsilat) cekTahsilat += tutar;
      else cekTediye += tutar;
    } else if (item.tur === 'senet') {
      if (isTahsilat) senetTahsilat += tutar;
      else senetTediye += tutar;
    }

    const pId = item.yapan_user_id || '__unassigned__';
    const pName =
      item.profiles?.ad_soyad ||
      nameById.get(pId) ||
      (pId === '__unassigned__' ? 'Merkez / Belirtilmemiş' : 'Plasiyer');

    if (!perPlasiyerMap.has(pId)) {
      perPlasiyerMap.set(pId, {
        plasiyerId: pId,
        plasiyerAd: pName,
        pendingCount: 0,
        pendingNetNakit: 0,
        pendingKart: 0,
        pendingCek: 0,
        pendingSenet: 0,
        pendingTotal: 0,
        transferredCount: 0,
      });
    }
    const pRow = perPlasiyerMap.get(pId)!;

    if (item.durum === 'plasiyerde') {
      pendingCount++;
      pendingTotal += signed;
      pRow.pendingCount++;
      pRow.pendingTotal += signed;

      const bucket = pendingByTur[item.tur];
      if (bucket) {
        bucket.count++;
        if (isTahsilat) bucket.tahsilat += tutar;
        else bucket.tediye += tutar;
        bucket.net += signed;
      }

      if (item.tur === 'nakit') pRow.pendingNetNakit += signed;
      else if (item.tur === 'kredi_karti') pRow.pendingKart += signed;
      else if (item.tur === 'cek') pRow.pendingCek += signed;
      else if (item.tur === 'senet') pRow.pendingSenet += signed;
    } else {
      transferredCount++;
      transferredTotal += signed;
      pRow.transferredCount++;
    }
  }

  const perPlasiyer = Array.from(perPlasiyerMap.values()).sort(
    (a, b) => b.pendingCount - a.pendingCount || b.pendingTotal - a.pendingTotal
  );

  return {
    validCount,
    iptalCount,
    iptalTotal,
    pendingCount,
    pendingTotal,
    transferredCount,
    transferredTotal,
    totalTahsilat,
    totalTediye,
    netTotal: totalTahsilat - totalTediye,
    nakitTahsilat,
    nakitTediye,
    netNakit: nakitTahsilat - nakitTediye,
    kartTahsilat,
    kartTediye,
    netKart: kartTahsilat - kartTediye,
    cekTahsilat,
    cekTediye,
    netCek: cekTahsilat - cekTediye,
    senetTahsilat,
    senetTediye,
    netSenet: senetTahsilat - senetTediye,
    pendingNetNakit: pendingByTur.nakit.net,
    pendingByTur,
    perPlasiyer,
  };
}

export function computeCashCountReconciliation(
  expectedNetNakit: number,
  countedCashInput: string
): CashCountReconciliation {
  const parsed = parseTrCurrencyInput(countedCashInput);
  if (parsed === null) {
    return {
      parsedCounted: null,
      expectedNetNakit,
      difference: 0,
      status: 'empty',
    };
  }

  const diff = Math.round((parsed - expectedNetNakit) * 100) / 100;
  if (Math.abs(diff) < 0.01) {
    return {
      parsedCounted: parsed,
      expectedNetNakit,
      difference: 0,
      status: 'match',
    };
  }

  return {
    parsedCounted: parsed,
    expectedNetNakit,
    difference: diff,
    status: diff > 0 ? 'surplus' : 'shortage',
  };
}

export async function executePlasiyerGunSonuTransfer(
  params: ExecuteGunSonuTransferParams
): Promise<ExecuteGunSonuTransferResult> {
  const {
    firmaId,
    userId,
    items,
    targetNakitKasaId,
    targetKartKasaId,
    knownKasalar,
    syncToKasa = true,
  } = params;

  const pendingItems = items.filter(
    (i) => !i.iptal && i.durum === 'plasiyerde' && !isExcludedShadowRow(i)
  );

  if (pendingItems.length === 0) {
    return {
      transferredCount: 0,
      kasaSyncedCount: 0,
      evrakTransferredCount: 0,
      failedCount: 0,
      kasaTableMissing: false,
    };
  }

  let transferredCount = 0;
  let kasaSyncedCount = 0;
  let evrakTransferredCount = 0;
  let failedCount = 0;
  let kasaTableMissing = false;
  let firstError: string | undefined;

  for (const item of pendingItems) {
    const isCashOrCard = item.tur === 'nakit' || item.tur === 'kredi_karti';

    if (isCashOrCard && syncToKasa && !kasaTableMissing) {
      const overrideId =
        item.tur === 'kredi_karti' ? targetKartKasaId || null : targetNakitKasaId || null;

      const syncRes = await syncIslemToKasa({
        islem: item,
        firmaId,
        userId,
        kasaIdOverride: overrideId,
        knownKasalar,
        skipIfPlasiyerde: false,
        forceTransferFromPlasiyer: true,
      });

      if (syncRes.synced) {
        kasaSyncedCount++;
        transferredCount++;
        continue;
      }

      if (syncRes.reason === 'kasa_table_missing') {
        kasaTableMissing = true;
      } else if (syncRes.error) {
        failedCount++;
        if (!firstError) firstError = syncRes.error;
        continue;
      }
    }

    // Çek/Senet, kasa modülü kapalıysa veya kasa tablosu yoksa doğrudan durum='aktarildi' yap
    const { error: updateErr } = await supabase
      .from('islemler')
      .update({ durum: 'aktarildi' })
      .eq('id', item.id)
      .eq('firma_id', firmaId);

    if (updateErr) {
      if (isMissingKasaTableError(updateErr)) {
        kasaTableMissing = true;
      }
      failedCount++;
      if (!firstError) firstError = updateErr.message || 'Makbuz durumu güncellenemedi.';
    } else {
      transferredCount++;
      if (!isCashOrCard) {
        evrakTransferredCount++;
      }
    }
  }

  return {
    transferredCount,
    kasaSyncedCount,
    evrakTransferredCount,
    failedCount,
    kasaTableMissing,
    error: firstError,
  };
}

export function buildGunSonuShareSummary(params: {
  firmaUnvan: string;
  plasiyerAd: string;
  dateLabel: string;
  summary: PlasiyerGunSonuSummary;
  reconciliation: CashCountReconciliation;
  note?: string;
}): string {
  const { firmaUnvan, plasiyerAd, dateLabel, summary, reconciliation, note } = params;
  const farkText =
    reconciliation.status === 'empty'
      ? 'Sayım girilmedi'
      : reconciliation.status === 'match'
      ? 'Tam Mutabakat (0,00 TL)'
      : reconciliation.status === 'surplus'
      ? `+${formatCurrency(reconciliation.difference)} (Kasa Fazlası)`
      : `${formatCurrency(reconciliation.difference)} (Kasa Eksiği)`;

  const lines = [
    `📋 PLASİYER GÜN SONU Z-RAPORU`,
    `Firma: ${firmaUnvan}`,
    `Plasiyer: ${plasiyerAd}`,
    `Dönem: ${dateLabel}`,
    `─────────────────────────`,
    `Toplam Makbuz: ${summary.validCount} adet (Bekleyen: ${summary.pendingCount}, Aktarılan: ${summary.transferredCount})`,
    `• Net Nakit: ${formatCurrency(summary.netNakit)} (Tahsilat: ${formatCurrency(summary.nakitTahsilat)} / Tediye: ${formatCurrency(summary.nakitTediye)})`,
    `• Kredi Kartı / POS: ${formatCurrency(summary.netKart)}`,
    `• Müşteri Çeki: ${formatCurrency(summary.netCek)}`,
    `• Müşteri Senedi: ${formatCurrency(summary.netSenet)}`,
    `• Genel Net Toplam: ${formatCurrency(summary.netTotal)}`,
    `─────────────────────────`,
    `Fiziki Nakit Sayım: ${
      reconciliation.parsedCounted !== null ? formatCurrency(reconciliation.parsedCounted) : '-'
    }`,
    `Kasa Mutabakat Farkı: ${farkText}`,
  ];

  if (note?.trim()) {
    lines.push(`Not: ${note.trim()}`);
  }

  return lines.join('\n');
}

export function printGunSonuZReport(params: {
  firmaUnvan: string;
  logoUrl?: string | null;
  plasiyerAd: string;
  dateLabel: string;
  summary: PlasiyerGunSonuSummary;
  reconciliation: CashCountReconciliation;
  items: Islem[];
  note?: string;
}): void {
  const { firmaUnvan, logoUrl, plasiyerAd, dateLabel, summary, reconciliation, items, note } = params;

  const validItems = items.filter((i) => !i.iptal && !isExcludedShadowRow(i));

  const farkLabel =
    reconciliation.status === 'empty'
      ? 'Sayım Girilmedi'
      : reconciliation.status === 'match'
      ? 'Tam Mutabakat'
      : reconciliation.status === 'surplus'
      ? `+${formatCurrency(reconciliation.difference)} Fazla`
      : `${formatCurrency(reconciliation.difference)} Eksik`;

  const reportSummary = [
    { label: 'Plasiyer', value: plasiyerAd },
    { label: 'Bekleyen / Toplam', value: `${summary.pendingCount} / ${summary.validCount} Makbuz` },
    { label: 'Net Nakit', value: formatCurrency(summary.netNakit) },
    {
      label: 'Fiziki Sayım',
      value:
        reconciliation.parsedCounted !== null
          ? formatCurrency(reconciliation.parsedCounted)
          : '-',
    },
    { label: 'Sayım Farkı', value: farkLabel },
    { label: 'Kredi Kartı', value: formatCurrency(summary.netKart) },
    { label: 'Çek & Senet', value: formatCurrency(summary.netCek + summary.netSenet) },
    { label: 'Genel Net Toplam', value: formatCurrency(summary.netTotal) },
  ];

  const headers = ['Tarih', 'Makbuz No', 'Cari', 'Plasiyer', 'Tip', 'Tür', 'Durum', 'Tutar'];
  const rows = validItems.map((i) => [
    formatDate(i.tarih),
    i.makbuz_no || `#${i.id.slice(0, 8)}`,
    i.cariler?.unvan || '-',
    i.profiles?.ad_soyad || plasiyerAd,
    i.tip === 'tahsilat' ? 'Tahsilat' : 'Tediye',
    i.tur === 'kredi_karti'
      ? 'Kredi Kartı'
      : i.tur === 'nakit'
      ? 'Nakit'
      : i.tur === 'cek'
      ? 'Çek'
      : 'Senet',
    i.durum === 'plasiyerde' ? 'Plasiyerde' : 'Merkezde',
    formatCurrency(i.tutar),
  ]);

  const noteSuffix = note?.trim() ? ` | Teslim Notu: ${note.trim()}` : '';
  printPdfReport(
    `PLASİYER GÜN SONU Z-RAPORU`,
    `Firma: ${firmaUnvan} | Dönem: ${dateLabel}${noteSuffix}`,
    headers,
    rows,
    reportSummary,
    logoUrl,
    { compactNumeric: true, rightAlignedColumns: [7] }
  );
}

const HISTORY_STORAGE_KEY_PREFIX = 'tahsilatim_gun_sonu_history_';

export function loadGunSonuHistory(firmaId: string): GunSonuHistoryEntry[] {
  if (!firmaId || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${HISTORY_STORAGE_KEY_PREFIX}${firmaId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GunSonuHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveGunSonuHistoryEntry(
  firmaId: string,
  entry: GunSonuHistoryEntry
): GunSonuHistoryEntry[] {
  const existing = loadGunSonuHistory(firmaId);
  const next = [entry, ...existing].slice(0, 20);
  if (firmaId && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(`${HISTORY_STORAGE_KEY_PREFIX}${firmaId}`, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }
  return next;
}
