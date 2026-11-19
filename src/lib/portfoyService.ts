import { supabase } from './supabase';
import { GelirGider, Islem, PortfoyDurum } from '../types/database';
import { getTodayIsoLocal, normalizeDateKey } from './formatters';
import {
  deleteGelirGiderWithBalanceSync,
  ensureDefaultKasaForTur,
  insertGelirGiderWithBalanceSync,
} from './kasaSyncService';
import { isMissingKasaTableError } from './kasaSql';
import {
  fetchCariBalanceSnapshot,
  syncCariBalanceAfterInsertIfTriggerMissing,
} from './receiptDeleteHelper';

export const PORTFOY_SETUP_SQL = `-- Opsiyonel: Çek & Senet Portföy durumu alanlarını islemler tablosuna ekler
ALTER TABLE public.islemler ADD COLUMN IF NOT EXISTS portfoy_durumu text DEFAULT 'portfoyde';
ALTER TABLE public.islemler ADD COLUMN IF NOT EXISTS portfoy_not text;
ALTER TABLE public.islemler ADD COLUMN IF NOT EXISTS ciro_cari_id uuid REFERENCES public.cariler(id) ON DELETE SET NULL;
ALTER TABLE public.islemler ADD COLUMN IF NOT EXISTS tahsil_kasa_id uuid REFERENCES public.kasalar(id) ON DELETE SET NULL;
ALTER TABLE public.islemler ADD COLUMN IF NOT EXISTS portfoy_islem_tarihi text;`;

export const PORTFOY_DURUM_LABELS: Record<PortfoyDurum, string> = {
  portfoyde: 'Portföyde',
  tahsilde: 'Tahsilde / Bankada',
  tahsil_edildi: 'Tahsil Edildi',
  ciro_edildi: 'Ciro Edildi',
  karsiliksiz: 'Karşılıksız',
};

export const PORTFOY_TAHSIL_TAG_PREFIX = '[PORTFOY-TAHSIL:';
export const PORTFOY_ODEME_TAG_PREFIX = '[PORTFOY-ODEME:';

const VALID_PORTFOY_DURUMLAR: Set<string> = new Set([
  'portfoyde',
  'tahsilde',
  'tahsil_edildi',
  'ciro_edildi',
  'karsiliksiz',
]);

export function isMissingPortfoyColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string; message?: string; details?: string };
  const code = String(rec.code || '');
  const msg = `${rec.message || ''} ${rec.details || ''}`.toLowerCase();
  if (code === '42703' || code === 'PGRST204') return true;
  if (msg.includes('schema cache') && (msg.includes('portfoy_') || msg.includes('ciro_cari_id') || msg.includes('tahsil_kasa_id'))) {
    return true;
  }
  return (
    msg.includes('portfoy_durumu') ||
    msg.includes('portfoy_not') ||
    msg.includes('portfoy_islem_tarihi') ||
    msg.includes('ciro_cari_id') ||
    msg.includes('tahsil_kasa_id')
  );
}

const escapeTagVal = (val: string): string =>
  val.replace(/\|/g, '/').replace(/\[/g, '(').replace(/\]/g, ')').trim();

export interface PortfoyMeta {
  durum: PortfoyDurum;
  tarih: string | null;
  not: string;
  kasaId: string | null;
  ciroCariId: string | null;
  ciroHedefAd: string | null;
}

export function extractPortfoyTagFields(aciklama?: string | null): {
  durum?: PortfoyDurum;
  tarih?: string;
  not?: string;
  kasaId?: string;
  ciroCariId?: string;
  ciroHedefAd?: string;
} | null {
  if (!aciklama) return null;
  const match = aciklama.match(/\[PORTFOY:([^\]]+)\]/i);
  if (!match) return null;

  const parts = match[1].split('|');
  const rawDurum = (parts[0] || '').trim();
  const result: {
    durum?: PortfoyDurum;
    tarih?: string;
    not?: string;
    kasaId?: string;
    ciroCariId?: string;
    ciroHedefAd?: string;
  } = {};

  if (VALID_PORTFOY_DURUMLAR.has(rawDurum)) {
    result.durum = rawDurum as PortfoyDurum;
  }

  for (const part of parts.slice(1)) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (!val) continue;
    if (key === 'tarih') result.tarih = val;
    else if (key === 'not') result.not = val;
    else if (key === 'kasa') result.kasaId = val;
    else if (key === 'ciroCari') result.ciroCariId = val;
    else if (key === 'ciroAd') result.ciroHedefAd = val;
  }

  return result;
}

export function resolvePortfoyDurumu(islem: Islem): PortfoyDurum {
  if (islem.portfoy_durumu && VALID_PORTFOY_DURUMLAR.has(islem.portfoy_durumu)) {
    return islem.portfoy_durumu;
  }

  const tag = extractPortfoyTagFields(islem.aciklama);
  if (tag?.durum) return tag.durum;

  if (
    islem.iptal &&
    (islem.iptal_nedeni || '').toLowerCase().includes('karşılıksız')
  ) {
    return 'karsiliksiz';
  }

  const upper = (islem.aciklama || '').toUpperCase();
  if (
    upper.includes('[CİRO EDİLDİ') ||
    upper.includes('[CIRO EDILDI') ||
    (islem.durum as string) === 'ciro'
  ) {
    return 'ciro_edildi';
  }

  return 'portfoyde';
}

export function extractPortfoyMeta(islem: Islem): PortfoyMeta {
  const tag = extractPortfoyTagFields(islem.aciklama);
  const durum = resolvePortfoyDurumu(islem);

  let ciroHedefAd: string | null = tag?.ciroHedefAd || null;
  if (!ciroHedefAd && islem.aciklama) {
    const ciroArrowMatch = islem.aciklama.match(/\[C[İI]RO ED[İI]LD[İI]\s*->\s*([^\]]+)\]/i);
    if (ciroArrowMatch) ciroHedefAd = ciroArrowMatch[1].trim();
  }

  return {
    durum,
    tarih: islem.portfoy_islem_tarihi || tag?.tarih || null,
    not: islem.portfoy_not || tag?.not || '',
    kasaId: islem.tahsil_kasa_id || tag?.kasaId || null,
    ciroCariId: islem.ciro_cari_id || tag?.ciroCariId || null,
    ciroHedefAd,
  };
}

export function buildPortfoyTag(params: {
  durum: PortfoyDurum;
  tarih?: string | null;
  not?: string | null;
  kasaId?: string | null;
  ciroCariId?: string | null;
  ciroHedefAd?: string | null;
}): string {
  const tokens: string[] = [params.durum];
  if (params.tarih) tokens.push(`tarih=${escapeTagVal(params.tarih)}`);
  if (params.kasaId) tokens.push(`kasa=${escapeTagVal(params.kasaId)}`);
  if (params.ciroCariId) tokens.push(`ciroCari=${escapeTagVal(params.ciroCariId)}`);
  if (params.ciroHedefAd) tokens.push(`ciroAd=${escapeTagVal(params.ciroHedefAd)}`);
  if (params.not) tokens.push(`not=${escapeTagVal(params.not)}`);
  return `[PORTFOY:${tokens.join('|')}]`;
}

export function upsertPortfoyTagInAciklama(
  existingAciklama: string | null | undefined,
  params: {
    durum: PortfoyDurum;
    tarih?: string | null;
    not?: string | null;
    kasaId?: string | null;
    ciroCariId?: string | null;
    ciroHedefAd?: string | null;
  }
): string {
  const cleaned = (existingAciklama || '')
    .replace(/\[PORTFOY:[^\]]*\]\s*/g, '')
    .trim();
  const tag = buildPortfoyTag(params);
  return cleaned ? `${cleaned}\n${tag}` : tag;
}

export function isPortfoyEligibleIslem(islem: Islem): boolean {
  if (islem.tur !== 'cek' && islem.tur !== 'senet') return false;
  if (
    islem.aciklama?.includes('[ÇAPRAZ ÖDEME') ||
    islem.belge_no?.startsWith('ÇPZ-')
  ) {
    return false;
  }
  if (islem.iptal) {
    return resolvePortfoyDurumu(islem) === 'karsiliksiz';
  }
  return true;
}

export interface PortfoyVadeInfo {
  diffDays: number | null;
  urgency: 'overdue' | 'today' | 'upcoming' | 'future' | 'none' | 'settled';
  label: string;
  badgeClass: string;
}

export function computePortfoyVadeInfo(
  vade?: string | null,
  durum: PortfoyDurum = 'portfoyde',
  now: Date = new Date()
): PortfoyVadeInfo {
  if (durum === 'tahsil_edildi' || durum === 'ciro_edildi' || durum === 'karsiliksiz') {
    return {
      diffDays: null,
      urgency: 'settled',
      label: PORTFOY_DURUM_LABELS[durum],
      badgeClass:
        durum === 'tahsil_edildi'
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : durum === 'ciro_edildi'
          ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
          : 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    };
  }

  const key = normalizeDateKey(vade);
  if (!key) {
    return {
      diffDays: null,
      urgency: 'none',
      label: 'Vadesiz',
      badgeClass: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    };
  }

  const [y, m, d] = key.split('-').map(Number);
  const vDate = new Date(y, m - 1, d);
  vDate.setHours(0, 0, 0, 0);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((vDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      diffDays,
      urgency: 'overdue',
      label: `${Math.abs(diffDays)} Gün Gecikti`,
      badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-bold',
    };
  }
  if (diffDays === 0) {
    return {
      diffDays: 0,
      urgency: 'today',
      label: 'Bugün Vadesi',
      badgeClass: 'bg-amber-500/25 text-amber-300 border-amber-500/50 font-black',
    };
  }
  if (diffDays <= 7) {
    return {
      diffDays,
      urgency: 'upcoming',
      label: `${diffDays} Gün Kaldı`,
      badgeClass: 'bg-teal-500/20 text-teal-300 border-teal-500/35 font-bold',
    };
  }
  return {
    diffDays,
    urgency: 'future',
    label: `${diffDays} Gün Kaldı`,
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  };
}

export interface PortfoySummary {
  totalCount: number;
  portfoydeCount: number;
  portfoydeTotal: number;
  tahsildeCount: number;
  tahsildeTotal: number;
  tahsilEdildiCount: number;
  tahsilEdildiTotal: number;
  ciroEdildiCount: number;
  ciroEdildiTotal: number;
  karsiliksizCount: number;
  karsiliksizTotal: number;
  overdueCount: number;
  overdueTotal: number;
  dueSoonCount: number;
  dueSoonTotal: number;
}

export function computePortfoySummary(
  islemler: Islem[],
  now: Date = new Date()
): PortfoySummary {
  const res: PortfoySummary = {
    totalCount: 0,
    portfoydeCount: 0,
    portfoydeTotal: 0,
    tahsildeCount: 0,
    tahsildeTotal: 0,
    tahsilEdildiCount: 0,
    tahsilEdildiTotal: 0,
    ciroEdildiCount: 0,
    ciroEdildiTotal: 0,
    karsiliksizCount: 0,
    karsiliksizTotal: 0,
    overdueCount: 0,
    overdueTotal: 0,
    dueSoonCount: 0,
    dueSoonTotal: 0,
  };

  for (const item of islemler) {
    if (!isPortfoyEligibleIslem(item)) continue;
    res.totalCount++;
    const tutar = Number(item.tutar) || 0;
    const durum = resolvePortfoyDurumu(item);

    if (durum === 'portfoyde') {
      res.portfoydeCount++;
      res.portfoydeTotal += tutar;
    } else if (durum === 'tahsilde') {
      res.tahsildeCount++;
      res.tahsildeTotal += tutar;
    } else if (durum === 'tahsil_edildi') {
      res.tahsilEdildiCount++;
      res.tahsilEdildiTotal += tutar;
    } else if (durum === 'ciro_edildi') {
      res.ciroEdildiCount++;
      res.ciroEdildiTotal += tutar;
    } else if (durum === 'karsiliksiz') {
      res.karsiliksizCount++;
      res.karsiliksizTotal += tutar;
    }

    const vadeInfo = computePortfoyVadeInfo(item.vade, durum, now);
    if (vadeInfo.urgency === 'overdue') {
      res.overdueCount++;
      res.overdueTotal += tutar;
    } else if (vadeInfo.urgency === 'today' || vadeInfo.urgency === 'upcoming') {
      res.dueSoonCount++;
      res.dueSoonTotal += tutar;
    }
  }

  return res;
}

async function removePortfoyKasaEntries(islemId: string, firmaId: string): Promise<void> {
  if (!islemId || !firmaId) return;
  for (const prefix of [PORTFOY_TAHSIL_TAG_PREFIX, PORTFOY_ODEME_TAG_PREFIX]) {
    const tag = `${prefix}${islemId}]`;
    const { data, error } = await supabase
      .from('gelir_giderler')
      .select('*')
      .eq('firma_id', firmaId)
      .ilike('aciklama', `%${tag}%`);

    if (error) {
      if (isMissingKasaTableError(error)) return;
      continue;
    }

    for (const row of (data ?? []) as GelirGider[]) {
      await deleteGelirGiderWithBalanceSync(row);
    }
  }
}

export interface UpdatePortfoyDurumParams {
  islem: Islem;
  firmaId: string;
  userId?: string | null;
  newDurum: PortfoyDurum;
  note?: string;
  targetKasaId?: string | null;
  ciroTargetCariId?: string | null;
  ciroTargetCariUnvan?: string | null;
  createTediyeForCiro?: boolean;
  reverseCariOnKarsiliksiz?: boolean;
  islemTarihi?: string;
}

export interface UpdatePortfoyDurumResult {
  success: boolean;
  schemaColumnMissing: boolean;
  kasaSynced: boolean;
  tediyeCreated: boolean;
  balanceReversed: boolean;
  error?: string;
}

export async function updatePortfoyDurumu(
  params: UpdatePortfoyDurumParams
): Promise<UpdatePortfoyDurumResult> {
  const {
    islem,
    firmaId,
    userId,
    newDurum,
    note = '',
    targetKasaId = null,
    ciroTargetCariId = null,
    ciroTargetCariUnvan = null,
    createTediyeForCiro = false,
    reverseCariOnKarsiliksiz = true,
    islemTarihi = getTodayIsoLocal(),
  } = params;

  const prevDurum = resolvePortfoyDurumu(islem);
  const cleanNote = note.trim();
  const nextAciklama = upsertPortfoyTagInAciklama(islem.aciklama, {
    durum: newDurum,
    tarih: islemTarihi,
    not: cleanNote,
    kasaId: newDurum === 'tahsil_edildi' ? targetKasaId : null,
    ciroCariId: newDurum === 'ciro_edildi' ? ciroTargetCariId : null,
    ciroHedefAd: newDurum === 'ciro_edildi' ? ciroTargetCariUnvan : null,
  });

  const tutar = Number(islem.tutar) || 0;
  const shouldReverseForKarsiliksiz =
    newDurum === 'karsiliksiz' &&
    islem.tip === 'tahsilat' &&
    reverseCariOnKarsiliksiz &&
    !islem.iptal;

  const shouldRestoreFromKarsiliksiz =
    prevDurum === 'karsiliksiz' &&
    newDurum !== 'karsiliksiz' &&
    islem.iptal &&
    (islem.iptal_nedeni || '').toLowerCase().includes('karşılıksız');

  let beforeCariBalance: number | null = null;
  if ((shouldReverseForKarsiliksiz || shouldRestoreFromKarsiliksiz) && islem.cari_id) {
    beforeCariBalance = await fetchCariBalanceSnapshot(islem.cari_id);
  }

  const fullPatch: Record<string, unknown> = {
    aciklama: nextAciklama,
    portfoy_durumu: newDurum,
    portfoy_not: cleanNote || null,
    ciro_cari_id: newDurum === 'ciro_edildi' ? ciroTargetCariId || null : null,
    tahsil_kasa_id:
      newDurum === 'tahsil_edildi' && targetKasaId !== '__none__' ? targetKasaId || null : null,
    portfoy_islem_tarihi: islemTarihi,
  };

  const fallbackPatch: Record<string, unknown> = {
    aciklama: nextAciklama,
  };

  if (shouldReverseForKarsiliksiz) {
    const cancelFields = {
      iptal: true,
      iptal_nedeni: 'Karşılıksız Çek/Senet',
      iptal_tarihi: new Date().toISOString(),
      iptal_eden: userId || null,
    };
    Object.assign(fullPatch, cancelFields);
    Object.assign(fallbackPatch, cancelFields);
  } else if (shouldRestoreFromKarsiliksiz) {
    const restoreFields = {
      iptal: false,
      iptal_nedeni: null,
      iptal_tarihi: null,
      iptal_eden: null,
    };
    Object.assign(fullPatch, restoreFields);
    Object.assign(fallbackPatch, restoreFields);
  }

  let schemaColumnMissing = false;
  const { error: fullErr } = await supabase
    .from('islemler')
    .update(fullPatch)
    .eq('id', islem.id)
    .eq('firma_id', firmaId);

  if (fullErr) {
    if (!isMissingPortfoyColumnError(fullErr)) {
      return {
        success: false,
        schemaColumnMissing: false,
        kasaSynced: false,
        tediyeCreated: false,
        balanceReversed: false,
        error: fullErr.message || 'Portföy durumu güncellenemedi.',
      };
    }

    schemaColumnMissing = true;
    const { error: fbErr } = await supabase
      .from('islemler')
      .update(fallbackPatch)
      .eq('id', islem.id)
      .eq('firma_id', firmaId);

    if (fbErr) {
      return {
        success: false,
        schemaColumnMissing: true,
        kasaSynced: false,
        tediyeCreated: false,
        balanceReversed: false,
        error: fbErr.message || 'Portföy durumu güncellenemedi.',
      };
    }
  }

  // Bakiye senkronizasyonu (Karşılıksız -> İptal veya Geri Alma)
  let balanceReversed = false;
  if (
    (shouldReverseForKarsiliksiz || shouldRestoreFromKarsiliksiz) &&
    islem.cari_id &&
    beforeCariBalance !== null &&
    tutar > 0
  ) {
    const afterVal = await fetchCariBalanceSnapshot(islem.cari_id);
    if (afterVal !== null && Math.abs(afterVal - beforeCariBalance) < 0.005) {
      // Tahsilat iptal edilince müşteri borcu +tutar geri artar; iade edilince -tutar düşer
      const delta = shouldReverseForKarsiliksiz ? tutar : -tutar;
      const nextBakiye = Math.round((beforeCariBalance + delta) * 100) / 100;
      await supabase
        .from('cariler')
        .update({ bakiye: nextBakiye })
        .eq('id', islem.cari_id)
        .eq('firma_id', firmaId);
      balanceReversed = true;
    } else if (afterVal !== null) {
      balanceReversed = true;
    }
  }

  // Kasa senkronizasyonu: her değişiklikte eski portföy tahsil/ödeme kasa satırını temizle
  await removePortfoyKasaEntries(islem.id, firmaId);

  let kasaSynced = false;
  if (newDurum === 'tahsil_edildi' && targetKasaId !== '__none__' && tutar > 0) {
    let kasaObj = null;
    if (targetKasaId) {
      const { data: kData, error: kErr } = await supabase
        .from('kasalar')
        .select('*')
        .eq('id', targetKasaId)
        .eq('firma_id', firmaId)
        .maybeSingle();
      if (!kErr && kData) {
        kasaObj = kData;
      }
    }
    if (!kasaObj) {
      try {
        kasaObj = await ensureDefaultKasaForTur(firmaId, 'nakit');
      } catch {
        kasaObj = null;
      }
    }

    if (kasaObj) {
      const isTahsilat = islem.tip === 'tahsilat';
      const tag = `${isTahsilat ? PORTFOY_TAHSIL_TAG_PREFIX : PORTFOY_ODEME_TAG_PREFIX}${islem.id}]`;
      const cariAd = islem.cariler?.unvan || 'Cari';
      const turLabel = islem.tur === 'cek' ? 'Çek' : 'Senet';
      const docPart = islem.belge_no ? ` (${islem.belge_no})` : '';
      const ggAciklama = `${tag} ${cariAd} · ${turLabel}${docPart}${cleanNote ? ` · ${cleanNote}` : ''}`;

      const { error: ggErr } = await insertGelirGiderWithBalanceSync({
        firma_id: firmaId,
        kasa_id: kasaObj.id,
        hedef_kasa_id: null,
        tip: isTahsilat ? 'gelir' : 'gider',
        kategori: isTahsilat ? `${turLabel} Tahsilatı` : `${turLabel} Ödemesi`,
        tutar,
        tarih: islemTarihi,
        aciklama: ggAciklama,
        belge_no: islem.belge_no || islem.makbuz_no || `PRT-${islem.id.slice(0, 6)}`,
        yapan_user_id: userId || null,
      });

      if (!ggErr) {
        kasaSynced = true;
      }
    }
  }

  // Opsiyonel: Ciro edildiğinde seçilen tedarikçiye tediye makbuzu kes
  let tediyeCreated = false;
  if (
    newDurum === 'ciro_edildi' &&
    createTediyeForCiro &&
    ciroTargetCariId &&
    prevDurum !== 'ciro_edildi' &&
    islem.tip === 'tahsilat' &&
    tutar > 0
  ) {
    const beforeTargetBal = await fetchCariBalanceSnapshot(ciroTargetCariId);
    const asilBorclu = islem.cariler?.unvan || 'Müşteri';
    const ciroNote = `[CİRO EDİLDİ - Asıl Borçlu: ${asilBorclu}, Belge No: ${islem.belge_no || '-'}]${
      cleanNote ? ` ${cleanNote}` : ''
    }`;

    const { error: tediyeErr } = await supabase.from('islemler').insert({
      firma_id: firmaId,
      cari_id: ciroTargetCariId,
      tip: 'tediye',
      tur: islem.tur,
      tutar,
      tarih: islemTarihi,
      belge_no: islem.belge_no || null,
      vade: islem.vade || null,
      banka_adi: islem.banka_adi || null,
      aciklama: ciroNote,
    });

    if (!tediyeErr) {
      tediyeCreated = true;
      await syncCariBalanceAfterInsertIfTriggerMissing({
        firmaId,
        cariId: ciroTargetCariId,
        tip: 'tediye',
        tutar,
        beforeVal: beforeTargetBal,
      });
    }
  }

  return {
    success: true,
    schemaColumnMissing,
    kasaSynced,
    tediyeCreated,
    balanceReversed,
  };
}
