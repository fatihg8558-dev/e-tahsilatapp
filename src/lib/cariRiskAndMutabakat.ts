import { supabase } from './supabase';
import { Cari, Fatura, Islem } from '../types/database';

export const CARI_RISK_SETUP_SQL = `-- Opsiyonel: Cari kartlarına risk limiti alanı ekler
ALTER TABLE public.cariler ADD COLUMN IF NOT EXISTS risk_limiti numeric(14,2) DEFAULT NULL;`;

const LOCAL_RISK_STORAGE_PREFIX = 'tahsilatim_cari_risk_limits_';
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export function isMissingRiskLimitColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string; message?: string; details?: string };
  const code = String(rec.code || '');
  const msg = `${rec.message || ''} ${rec.details || ''}`.toLowerCase();
  if (code === '42703' || code === 'PGRST204') return true;
  return msg.includes('risk_limiti');
}

export function loadLocalCariRiskLimitMap(firmaId: string): Record<string, number> {
  if (!firmaId || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(`${LOCAL_RISK_STORAGE_PREFIX}${firmaId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) result[k] = round2(n);
    }
    return result;
  } catch {
    return {};
  }
}

export function setLocalCariRiskLimit(
  firmaId: string,
  cariId: string,
  limit: number | null
): void {
  if (!firmaId || !cariId || typeof window === 'undefined') return;
  try {
    const current = loadLocalCariRiskLimitMap(firmaId);
    if (limit !== null && Number.isFinite(limit) && limit > 0) {
      current[cariId] = round2(limit);
    } else {
      delete current[cariId];
    }
    window.localStorage.setItem(`${LOCAL_RISK_STORAGE_PREFIX}${firmaId}`, JSON.stringify(current));
  } catch {
    // ignore storage quota errors
  }
}

export function getEffectiveCariRiskLimit(
  cari: Pick<Cari, 'id' | 'risk_limiti'> | null | undefined,
  firmaId?: string
): number | null {
  if (!cari) return null;
  if (cari.risk_limiti !== undefined && cari.risk_limiti !== null) {
    const n = Number(cari.risk_limiti);
    if (Number.isFinite(n) && n > 0) return round2(n);
  }
  if (firmaId) {
    const localMap = loadLocalCariRiskLimitMap(firmaId);
    if (localMap[cari.id] && localMap[cari.id] > 0) {
      return localMap[cari.id];
    }
  }
  return null;
}

export interface CariRiskEvaluation {
  hasLimit: boolean;
  riskLimit: number;
  currentBakiye: number;
  projectedBakiye: number;
  usedAmount: number;
  percent: number;
  remainingLimit: number;
  overageAmount: number;
  level: 'none' | 'ok' | 'warning' | 'exceeded';
}

export function evaluateCariRiskStatus(params: {
  currentBakiye: number;
  pendingDelta?: number;
  riskLimit: number | null | undefined;
}): CariRiskEvaluation {
  const currentBakiye = round2(params.currentBakiye);
  const pendingDelta = round2(params.pendingDelta || 0);
  const projectedBakiye = round2(currentBakiye + pendingDelta);
  const limit = Number(params.riskLimit) || 0;

  if (limit <= 0) {
    return {
      hasLimit: false,
      riskLimit: 0,
      currentBakiye,
      projectedBakiye,
      usedAmount: Math.max(0, projectedBakiye),
      percent: 0,
      remainingLimit: 0,
      overageAmount: 0,
      level: 'none',
    };
  }

  const usedAmount = Math.max(0, projectedBakiye);
  const rawRatio = usedAmount / limit;
  const percent = Math.round(rawRatio * 100);
  const remainingLimit = round2(Math.max(0, limit - usedAmount));
  const overageAmount = round2(Math.max(0, usedAmount - limit));

  let level: 'ok' | 'warning' | 'exceeded' = 'ok';
  if (usedAmount >= limit && overageAmount > 0) {
    level = 'exceeded';
  } else if (usedAmount >= limit) {
    level = 'exceeded';
  } else if (rawRatio >= 0.8) {
    level = 'warning';
  }

  return {
    hasLimit: true,
    riskLimit: round2(limit),
    currentBakiye,
    projectedBakiye,
    usedAmount,
    percent,
    remainingLimit,
    overageAmount,
    level,
  };
}

export interface CariBalanceVerification {
  cariId: string;
  cariUnvan: string;
  cariTur: Cari['tur'];
  recordedBakiye: number;
  calculatedBakiye: number;
  faturaNet: number;
  islemNet: number;
  faturaCount: number;
  islemCount: number;
  diff: number;
  hasDiscrepancy: boolean;
}

export function computeCariBalanceVerification(params: {
  cari: Pick<Cari, 'id' | 'unvan' | 'tur' | 'bakiye'>;
  islemler: Array<Pick<Islem, 'cari_id' | 'tip' | 'tutar' | 'iptal'>>;
  faturalar: Array<Pick<Fatura, 'cari_id' | 'yon' | 'tutar'> & { iptal?: boolean }>;
}): CariBalanceVerification {
  const { cari, islemler, faturalar } = params;

  let faturaNet = 0;
  let faturaCount = 0;
  for (const f of faturalar) {
    if (f.cari_id !== cari.id || f.iptal) continue;
    const amt = Math.abs(Number(f.tutar) || 0);
    faturaCount++;
    // Satış faturası cari borcunu artırır (+), alış faturası azaltır (-)
    faturaNet = round2(faturaNet + (f.yon === 'alis' ? -amt : amt));
  }

  let islemNet = 0;
  let islemCount = 0;
  for (const i of islemler) {
    if (i.cari_id !== cari.id || i.iptal) continue;
    const amt = Math.abs(Number(i.tutar) || 0);
    islemCount++;
    // Tahsilat cari borcunu azaltır (-), tediye artırır (+)
    islemNet = round2(islemNet + (i.tip === 'tediye' ? amt : -amt));
  }

  const calculatedBakiye = round2(faturaNet + islemNet);
  const recordedBakiye = round2(Number(cari.bakiye) || 0);
  const diff = round2(recordedBakiye - calculatedBakiye);
  const hasDiscrepancy = Math.abs(diff) >= 0.01;

  return {
    cariId: cari.id,
    cariUnvan: cari.unvan,
    cariTur: cari.tur,
    recordedBakiye,
    calculatedBakiye,
    faturaNet,
    islemNet,
    faturaCount,
    islemCount,
    diff,
    hasDiscrepancy,
  };
}

export async function syncCariBalanceToCalculated(params: {
  firmaId: string;
  cariId: string;
  calculatedBakiye: number;
}): Promise<{ error: string | null }> {
  const cleanBalance = round2(params.calculatedBakiye);
  const { error } = await supabase
    .from('cariler')
    .update({ bakiye: Object.is(cleanBalance, -0) ? 0 : cleanBalance })
    .eq('id', params.cariId)
    .eq('firma_id', params.firmaId);

  if (error) {
    return { error: error.message || 'Cari bakiyesi eşitlenemedi.' };
  }
  return { error: null };
}

export async function auditAllCarilerBalances(params: {
  firmaId: string;
  cariler: Cari[];
}): Promise<CariBalanceVerification[]> {
  const [{ data: islemlerData }, { data: faturalarData }] = await Promise.all([
    supabase
      .from('islemler')
      .select('cari_id, tip, tutar, iptal')
      .eq('firma_id', params.firmaId),
    supabase
      .from('faturalar')
      .select('cari_id, yon, tutar')
      .eq('firma_id', params.firmaId),
  ]);

  const islemler = (islemlerData || []) as Array<Pick<Islem, 'cari_id' | 'tip' | 'tutar' | 'iptal'>>;
  const faturalar = (faturalarData || []) as Array<Pick<Fatura, 'cari_id' | 'yon' | 'tutar'>>;

  const results = params.cariler.map((cari) =>
    computeCariBalanceVerification({ cari, islemler, faturalar })
  );

  return results.sort((a, b) => {
    if (a.hasDiscrepancy !== b.hasDiscrepancy) return a.hasDiscrepancy ? -1 : 1;
    return Math.abs(b.diff) - Math.abs(a.diff);
  });
}
