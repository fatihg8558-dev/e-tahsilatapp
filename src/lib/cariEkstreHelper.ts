import { Fatura, Islem } from '../types/database';
import { formatCurrency, formatDate } from './formatters';
import { stripInternalSystemTags } from './noteTagHelper';

export type RawEkstreMovement = Islem | (Fatura & { tip?: string; iptal?: boolean; aciklama?: string | null; belge_no?: string | null; makbuz_no?: string | null; profiles?: { ad_soyad: string } | null; created_at?: string | null });

export interface CariEkstreRow {
  key: string;
  isOpeningRow: boolean;
  isInvoice: boolean;
  isPayment: boolean;
  isCancelled: boolean;
  dateKey: string;
  formattedDate: string;
  belgeNo: string;
  tipLabel: string;
  rawTip: string;
  aciklama: string;
  yapan: string;
  borc: number;
  alacak: number;
  netDelta: number;
  bakiye: number;
  rawMovement: RawEkstreMovement | null;
}

export interface CariEkstreSummary {
  openingBalance: number;
  hasOpeningRow: boolean;
  totalBorc: number;
  totalAlacak: number;
  closingBalance: number;
  movementCount: number;
}

export interface BuildCariEkstreResult {
  rows: CariEkstreRow[];
  summary: CariEkstreSummary;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export function extractDateKey(dateValue?: string | null): string {
  const raw = (dateValue || '').trim();
  if (!raw) return '1970-01-01';
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return '1970-01-01';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isInvoiceMovement(m: RawEkstreMovement): boolean {
  const rec = m as unknown as Record<string, unknown>;
  const tip = String(rec.tip || '').toLowerCase();
  if (tip.includes('fatura')) return true;
  if ('yon' in rec && (rec.yon === 'satis' || rec.yon === 'alis')) return true;
  if ('fatura_no' in rec && Boolean(rec.fatura_no)) return true;
  return false;
}

export function classifyMovementAmounts(m: RawEkstreMovement): {
  isInvoice: boolean;
  isPayment: boolean;
  isCancelled: boolean;
  borc: number;
  alacak: number;
  netDelta: number;
  tipLabel: string;
  rawTip: string;
} {
  const rec = m as unknown as Record<string, unknown>;
  const isInvoice = isInvoiceMovement(m);
  const isCancelled = Boolean(rec.iptal);
  const rawAmount = round2(Math.abs(Number(rec.tutar) || 0));

  let rawTip = String(rec.tip || '').toLowerCase();
  if (!rawTip && isInvoice) {
    rawTip = rec.yon === 'alis' ? 'alış faturası' : 'satış faturası';
  }

  let tipLabel = rawTip.toUpperCase() || 'İŞLEM';
  let borc = 0;
  let alacak = 0;

  if (isInvoice) {
    const isAlis = rec.yon === 'alis' || rawTip.includes('alış') || rawTip.includes('alis');
    tipLabel = isAlis ? 'ALIŞ FATURASI' : 'SATIŞ FATURASI';
    if (!isCancelled) {
      if (isAlis) {
        alacak = rawAmount;
      } else {
        borc = rawAmount;
      }
    }
  } else {
    const isTediye = rawTip === 'tediye';
    tipLabel = isTediye ? 'TEDİYE' : 'TAHSİLAT';
    if (!isCancelled) {
      if (isTediye) {
        borc = rawAmount;
      } else {
        alacak = rawAmount;
      }
    }
  }

  if (isCancelled) {
    tipLabel = `${tipLabel} (İPTAL)`;
  }

  return {
    isInvoice,
    isPayment: !isInvoice,
    isCancelled,
    borc,
    alacak,
    netDelta: round2(borc - alacak),
    tipLabel,
    rawTip,
  };
}

export function sortMovementsChronologically(
  movements: RawEkstreMovement[]
): RawEkstreMovement[] {
  return [...movements].sort((a, b) => {
    const recA = a as unknown as Record<string, unknown>;
    const recB = b as unknown as Record<string, unknown>;

    const dateKeyA = extractDateKey(String(recA.tarih || ''));
    const dateKeyB = extractDateKey(String(recB.tarih || ''));
    if (dateKeyA !== dateKeyB) {
      return dateKeyA.localeCompare(dateKeyB);
    }

    // Aynı tarihte fatura üst satırda (1), ödeme alt satırda (2) yer alır
    const priorityA = isInvoiceMovement(a) ? 1 : 2;
    const priorityB = isInvoiceMovement(b) ? 1 : 2;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    const createdA = String(recA.created_at || recA.tarih || '');
    const createdB = String(recB.created_at || recB.tarih || '');
    if (createdA && createdB && createdA !== createdB) {
      return createdA.localeCompare(createdB);
    }

    const docA = String(recA.fatura_no || recA.makbuz_no || recA.belge_no || '');
    const docB = String(recB.fatura_no || recB.makbuz_no || recB.belge_no || '');
    if (docA !== docB) {
      return docA.localeCompare(docB, 'tr', { numeric: true });
    }

    return String(recA.id || '').localeCompare(String(recB.id || ''));
  });
}

export function buildCariEkstre(params: {
  movements: RawEkstreMovement[];
  startDate?: string;
  endDate?: string;
  currentCariBakiye?: number | null;
}): BuildCariEkstreResult {
  const startKey = params.startDate ? extractDateKey(params.startDate) : '';
  const endKey = params.endDate ? extractDateKey(params.endDate) : '';

  const sorted = sortMovementsChronologically(params.movements);

  let totalRecordedNet = 0;
  const classified = sorted.map((m) => {
    const info = classifyMovementAmounts(m);
    totalRecordedNet = round2(totalRecordedNet + info.netDelta);
    const rec = m as unknown as Record<string, unknown>;
    return {
      movement: m,
      rec,
      dateKey: extractDateKey(String(rec.tarih || '')),
      ...info,
    };
  });

  const untrackedBaseBalance =
    params.currentCariBakiye !== undefined && params.currentCariBakiye !== null
      ? round2(Number(params.currentCariBakiye) - totalRecordedNet)
      : 0;
  const effectiveBase = Math.abs(untrackedBaseBalance) >= 0.01 ? untrackedBaseBalance : 0;

  let openingBalance = effectiveBase;
  let hasPriorMovements = false;

  if (startKey) {
    for (const item of classified) {
      if (item.dateKey < startKey) {
        openingBalance = round2(openingBalance + item.netDelta);
        hasPriorMovements = true;
      }
    }
  }

  const filtered = classified.filter((item) => {
    if (startKey && item.dateKey < startKey) return false;
    if (endKey && item.dateKey > endKey) return false;
    return true;
  });

  const rows: CariEkstreRow[] = [];
  let runningBalance = openingBalance;

  const shouldAddOpeningRow =
    (Boolean(startKey) && (hasPriorMovements || Math.abs(openingBalance) >= 0.01)) ||
    (!startKey && Math.abs(effectiveBase) >= 0.01);

  if (shouldAddOpeningRow) {
    const openDateDisplay = startKey ? formatDate(startKey) : '-';
    rows.push({
      key: `opening-${startKey || 'base'}`,
      isOpeningRow: true,
      isInvoice: false,
      isPayment: false,
      isCancelled: false,
      dateKey: startKey || '1970-01-01',
      formattedDate: openDateDisplay,
      belgeNo: 'DEVİR',
      tipLabel: startKey ? 'DEVREDEN BAKİYE' : 'AÇILIŞ BAKİYESİ',
      rawTip: 'devir',
      aciklama: startKey
        ? `${formatDate(startKey)} öncesi dönem devir bakiyesi`
        : 'Kayıt öncesi açılış / devir bakiyesi',
      yapan: '-',
      borc: openingBalance > 0 ? openingBalance : 0,
      alacak: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      netDelta: openingBalance,
      bakiye: openingBalance,
      rawMovement: null,
    });
  }

  let totalBorc = 0;
  let totalAlacak = 0;

  filtered.forEach((item, idx) => {
    runningBalance = round2(runningBalance + item.netDelta);
    totalBorc = round2(totalBorc + item.borc);
    totalAlacak = round2(totalAlacak + item.alacak);

    const rec = item.rec;
    const belgeNo = String(rec.makbuz_no || rec.fatura_no || rec.belge_no || '-');
    const profilesObj = rec.profiles as { ad_soyad?: string } | null | undefined;
    const yapan = profilesObj?.ad_soyad || (item.isPayment ? 'Yönetici' : '-');
    const aciklama = stripInternalSystemTags(String(rec.aciklama || '')) || '-';

    rows.push({
      key: `${String(rec.id || idx)}-${item.dateKey}-${idx}`,
      isOpeningRow: false,
      isInvoice: item.isInvoice,
      isPayment: item.isPayment,
      isCancelled: item.isCancelled,
      dateKey: item.dateKey,
      formattedDate: formatDate(String(rec.tarih || '')),
      belgeNo,
      tipLabel: item.tipLabel,
      rawTip: item.rawTip,
      aciklama,
      yapan,
      borc: item.borc,
      alacak: item.alacak,
      netDelta: item.netDelta,
      bakiye: runningBalance,
      rawMovement: item.movement,
    });
  });

  return {
    rows,
    summary: {
      openingBalance,
      hasOpeningRow: shouldAddOpeningRow,
      totalBorc,
      totalAlacak,
      closingBalance: runningBalance,
      movementCount: filtered.length,
    },
  };
}

export function formatEkstreBakiye(bakiye: number): string {
  const rounded = round2(bakiye);
  if (Math.abs(rounded) < 0.005) return formatCurrency(0);
  const tag = rounded > 0 ? ' (B)' : ' (A)';
  return `${formatCurrency(Math.abs(rounded))}${tag}`;
}
