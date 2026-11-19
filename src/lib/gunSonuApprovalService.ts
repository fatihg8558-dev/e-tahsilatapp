import { supabase } from './supabase';
import { GunSonuKapanis, Islem, Kasa, Profile } from '../types/database';
import {
  computePlasiyerGunSonuSummary,
  executePlasiyerGunSonuTransfer,
  PlasiyerGunSonuSummary,
  saveGunSonuHistoryEntry,
} from './plasiyerGunSonuService';
import { getTodayIsoLocal } from './formatters';

export const GUN_SONU_APPROVAL_SQL = `-- Opsiyonel: Plasiyer Gün Sonu onay kuyruğu tablosu (cihazlar arası bulut onay geçmişi için)
CREATE TABLE IF NOT EXISTS public.gun_sonu_kapanislari (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  firma_id uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  plasiyer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plasiyer_ad text,
  kapanis_tarihi text NOT NULL,
  beklenen_nakit numeric(14,2) DEFAULT 0,
  sayilan_nakit numeric(14,2),
  kasa_farki numeric(14,2) DEFAULT 0,
  kart_toplam numeric(14,2) DEFAULT 0,
  cek_toplam numeric(14,2) DEFAULT 0,
  senet_toplam numeric(14,2) DEFAULT 0,
  islem_idler jsonb DEFAULT '[]'::jsonb,
  teslim_notu text,
  durum text NOT NULL DEFAULT 'onay_bekliyor',
  red_nedeni text,
  onaylayan_user_id uuid,
  onay_tarihi timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.gun_sonu_kapanislari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gun_sonu_kapanislari_firma_all" ON public.gun_sonu_kapanislari;
CREATE POLICY "gun_sonu_kapanislari_firma_all"
ON public.gun_sonu_kapanislari FOR ALL
USING (
  firma_id IN (SELECT firma_id FROM public.profiles WHERE id = auth.uid())
)
WITH CHECK (
  firma_id IN (SELECT firma_id FROM public.profiles WHERE id = auth.uid())
);`;

export function isMissingGunSonuTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string; message?: string; details?: string };
  const code = String(rec.code || '');
  const msg = `${rec.message || ''} ${rec.details || ''}`.toLowerCase();
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    msg.includes('gun_sonu_kapanislari') &&
    (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found'))
  );
}

const enc = (val: string): string => encodeURIComponent(val).replace(/\]/g, '%5D');
const dec = (val: string): string => {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
};

export interface GsOnayTagData {
  requestId: string;
  sayilanNakit: number | null;
  kasaFarki: number;
  plasiyerAd: string;
  tarih: string;
  not: string;
}

export function buildGsOnayTag(data: GsOnayTagData): string {
  const sayimStr = data.sayilanNakit !== null ? String(data.sayilanNakit) : '';
  return `[GS_ONAY:${enc(data.requestId)}|${sayimStr}|${data.kasaFarki}|${enc(
    data.plasiyerAd
  )}|${enc(data.tarih)}|${enc(data.not)}]`;
}

export function parseGsOnayTag(aciklama?: string | null): GsOnayTagData | null {
  if (!aciklama) return null;
  const m = aciklama.match(/\[GS_ONAY:([^\]]+)\]/);
  if (!m) return null;
  const parts = m[1].split('|');
  if (parts.length < 5) return null;
  const requestId = dec(parts[0] || '');
  const sayimRaw = (parts[1] || '').trim();
  const sayilanNakit = sayimRaw ? Number(sayimRaw) : null;
  const kasaFarki = Number(parts[2] || 0) || 0;
  const plasiyerAd = dec(parts[3] || 'Plasiyer');
  const tarih = dec(parts[4] || getTodayIsoLocal());
  const not = dec(parts[5] || '');
  if (!requestId) return null;
  return {
    requestId,
    sayilanNakit: sayilanNakit !== null && Number.isFinite(sayilanNakit) ? sayilanNakit : null,
    kasaFarki,
    plasiyerAd,
    tarih,
    not,
  };
}

export function parseGsRedTag(aciklama?: string | null): string | null {
  if (!aciklama) return null;
  const m = aciklama.match(/\[GS_RED:([^\]]+)\]/);
  if (!m) return null;
  return dec(m[1] || '').trim() || 'Ana hesap tarafından düzeltme için iade edildi.';
}

export function stripGsTagsFromAciklama(aciklama?: string | null): string {
  if (!aciklama) return '';
  return aciklama
    .replace(/\[GS_ONAY:[^\]]*\]\s*/g, '')
    .replace(/\[GS_RED:[^\]]*\]\s*/g, '')
    .replace(/\[GS_ONAYLANDI:[^\]]*\]\s*/g, '')
    .trim();
}

export function upsertGsOnayTagInAciklama(
  aciklama: string | null | undefined,
  tagData: GsOnayTagData
): string {
  const base = stripGsTagsFromAciklama(aciklama);
  const tag = buildGsOnayTag(tagData);
  return base ? `${base}\n${tag}` : tag;
}

export function upsertGsRedTagInAciklama(
  aciklama: string | null | undefined,
  reason: string
): string {
  const base = stripGsTagsFromAciklama(aciklama);
  const tag = `[GS_RED:${enc(reason.trim() || 'Düzeltme istendi')}]`;
  return base ? `${base}\n${tag}` : tag;
}

export interface PendingGunSonuApproval {
  id: string;
  source: 'table' | 'tag';
  firmaId: string;
  plasiyerUserId: string;
  plasiyerAd: string;
  kapanisTarihi: string;
  beklenenNakit: number;
  sayilanNakit: number | null;
  kasaFarki: number;
  kartToplam: number;
  cekToplam: number;
  senetToplam: number;
  teslimNotu: string;
  islemIds: string[];
  items: Islem[];
  createdAt?: string;
}

export async function submitPlasiyerGunSonuForApproval(params: {
  firmaId: string;
  plasiyerUserId: string;
  plasiyerAd: string;
  items: Islem[];
  summary: PlasiyerGunSonuSummary;
  expectedNetNakit: number;
  countedNakit: number | null;
  cashDifference: number;
  note?: string;
}): Promise<{
  success: boolean;
  requestId?: string;
  submittedCount: number;
  tableMissing: boolean;
  error?: string;
}> {
  const pendingItems = params.items.filter(
    (i) =>
      !i.iptal &&
      i.durum === 'plasiyerde' &&
      !i.aciklama?.includes('[ÇAPRAZ ÖDEME') &&
      !i.belge_no?.startsWith('ÇPZ-')
  );

  if (pendingItems.length === 0) {
    return {
      success: false,
      submittedCount: 0,
      tableMissing: false,
      error: 'Onaya gönderilecek bekleyen makbuz bulunamadı.',
    };
  }

  const todayIso = getTodayIsoLocal();
  const cleanNote = (params.note || '').trim();
  const itemIds = pendingItems.map((i) => i.id);
  let requestId = `gs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let tableMissing = false;

  const { data: insertedRow, error: insErr } = await supabase
    .from('gun_sonu_kapanislari')
    .insert({
      firma_id: params.firmaId,
      plasiyer_user_id: params.plasiyerUserId,
      plasiyer_ad: params.plasiyerAd,
      kapanis_tarihi: todayIso,
      beklenen_nakit: params.expectedNetNakit,
      sayilan_nakit: params.countedNakit,
      kasa_farki: params.cashDifference,
      kart_toplam: params.summary.pendingByTur.kredi_karti.net,
      cek_toplam: params.summary.pendingByTur.cek.net,
      senet_toplam: params.summary.pendingByTur.senet.net,
      islem_idler: itemIds,
      teslim_notu: cleanNote || null,
      durum: 'onay_bekliyor',
    })
    .select('id')
    .single();

  if (insErr) {
    if (isMissingGunSonuTableError(insErr)) {
      tableMissing = true;
    } else {
      console.warn('gun_sonu_kapanislari insert warning:', insErr.message);
    }
  } else if (insertedRow?.id) {
    requestId = String(insertedRow.id);
  }

  // Cihazlar arası yedek ve rozet görünürlüğü için işlemleri [GS_ONAY:...] ile etiketle
  const tagData: GsOnayTagData = {
    requestId,
    sayilanNakit: params.countedNakit,
    kasaFarki: params.cashDifference,
    plasiyerAd: params.plasiyerAd,
    tarih: todayIso,
    not: cleanNote,
  };

  let updatedTags = 0;
  for (const item of pendingItems) {
    const nextAciklama = upsertGsOnayTagInAciklama(item.aciklama, tagData);
    const { error: updErr } = await supabase
      .from('islemler')
      .update({ aciklama: nextAciklama })
      .eq('id', item.id)
      .eq('firma_id', params.firmaId);
    if (!updErr) updatedTags++;
  }

  if (updatedTags === 0 && tableMissing) {
    return {
      success: false,
      submittedCount: 0,
      tableMissing: true,
      error: 'Onay talebi kaydedilemedi. Lütfen Supabase izinlerini kontrol ediniz.',
    };
  }

  return {
    success: true,
    requestId,
    submittedCount: pendingItems.length,
    tableMissing,
  };
}

export async function fetchPendingGunSonuApprovals(
  firmaId: string,
  plasiyerList: Profile[] = []
): Promise<{ approvals: PendingGunSonuApproval[]; tableMissing: boolean }> {
  if (!firmaId) return { approvals: [], tableMissing: false };

  let tableMissing = false;
  let tableRows: GunSonuKapanis[] = [];

  const { data: kapanisData, error: kapanisErr } = await supabase
    .from('gun_sonu_kapanislari')
    .select('*')
    .eq('firma_id', firmaId)
    .eq('durum', 'onay_bekliyor')
    .order('created_at', { ascending: false });

  if (kapanisErr) {
    if (isMissingGunSonuTableError(kapanisErr)) {
      tableMissing = true;
    }
  } else if (kapanisData) {
    tableRows = kapanisData as GunSonuKapanis[];
  }

  // Firma içindeki tüm plasiyerde bekleyen işlemleri çek
  const { data: pendingIslemData } = await supabase
    .from('islemler')
    .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
    .eq('firma_id', firmaId)
    .eq('durum', 'plasiyerde')
    .eq('iptal', false)
    .order('tarih', { ascending: false });

  const pendingIslemler = ((pendingIslemData as unknown) as Islem[]) || [];
  const islemById = new Map<string, Islem>();
  pendingIslemler.forEach((i) => islemById.set(i.id, i));

  const nameById = new Map<string, string>();
  plasiyerList.forEach((p) => {
    if (p.id && p.ad_soyad) nameById.set(p.id, p.ad_soyad);
  });

  const approvals: PendingGunSonuApproval[] = [];
  const consumedIslemIds = new Set<string>();
  const seenRequestIds = new Set<string>();

  for (const row of tableRows) {
    const idList = Array.isArray(row.islem_idler) ? row.islem_idler.map(String) : [];
    const matchedItems = idList
      .map((id) => islemById.get(id))
      .filter((x): x is Islem => Boolean(x));

    // Eğer işlem listesi boşsa aynı plasiyerin plasiyerde kalmış işlemlerini bağla
    const finalItems =
      matchedItems.length > 0
        ? matchedItems
        : pendingIslemler.filter((i) => i.yapan_user_id === row.plasiyer_user_id);

    if (finalItems.length === 0) continue;

    finalItems.forEach((i) => consumedIslemIds.add(i.id));
    seenRequestIds.add(row.id);

    approvals.push({
      id: row.id,
      source: 'table',
      firmaId: row.firma_id,
      plasiyerUserId: row.plasiyer_user_id,
      plasiyerAd:
        row.plasiyer_ad || nameById.get(row.plasiyer_user_id) || 'Plasiyer',
      kapanisTarihi: row.kapanis_tarihi,
      beklenenNakit: Number(row.beklenen_nakit) || 0,
      sayilanNakit:
        row.sayilan_nakit !== null && row.sayilan_nakit !== undefined
          ? Number(row.sayilan_nakit)
          : null,
      kasaFarki: Number(row.kasa_farki) || 0,
      kartToplam: Number(row.kart_toplam) || 0,
      cekToplam: Number(row.cek_toplam) || 0,
      senetToplam: Number(row.senet_toplam) || 0,
      teslimNotu: row.teslim_notu || '',
      islemIds: finalItems.map((i) => i.id),
      items: finalItems,
      createdAt: row.created_at,
    });
  }

  // Tabloda olmayan veya [GS_ONAY:...] etiketiyle gelen talepleri grupla
  const tagGroups = new Map<string, { meta: GsOnayTagData; items: Islem[] }>();
  for (const item of pendingIslemler) {
    if (consumedIslemIds.has(item.id)) continue;
    const tag = parseGsOnayTag(item.aciklama);
    if (!tag || seenRequestIds.has(tag.requestId)) continue;
    const existing = tagGroups.get(tag.requestId);
    if (existing) {
      existing.items.push(item);
    } else {
      tagGroups.set(tag.requestId, { meta: tag, items: [item] });
    }
  }

  for (const [reqId, grp] of tagGroups.entries()) {
    const subSummary = computePlasiyerGunSonuSummary(grp.items, plasiyerList);
    const plasiyerUid = grp.items[0]?.yapan_user_id || '';
    approvals.push({
      id: reqId,
      source: 'tag',
      firmaId,
      plasiyerUserId: plasiyerUid,
      plasiyerAd:
        grp.meta.plasiyerAd ||
        grp.items[0]?.profiles?.ad_soyad ||
        nameById.get(plasiyerUid) ||
        'Plasiyer',
      kapanisTarihi: grp.meta.tarih,
      beklenenNakit: subSummary.pendingNetNakit,
      sayilanNakit: grp.meta.sayilanNakit,
      kasaFarki: grp.meta.kasaFarki,
      kartToplam: subSummary.pendingByTur.kredi_karti.net,
      cekToplam: subSummary.pendingByTur.cek.net,
      senetToplam: subSummary.pendingByTur.senet.net,
      teslimNotu: grp.meta.not,
      islemIds: grp.items.map((i) => i.id),
      items: grp.items,
    });
  }

  return { approvals, tableMissing };
}

export async function fetchPendingGunSonuApprovalCount(firmaId: string): Promise<number> {
  if (!firmaId) return 0;
  const { approvals } = await fetchPendingGunSonuApprovals(firmaId);
  return approvals.length;
}

export async function approveGunSonuRequest(params: {
  approval: PendingGunSonuApproval;
  approverUserId?: string | null;
  approverName: string;
  targetNakitKasaId?: string | null;
  targetKartKasaId?: string | null;
  knownKasalar?: Kasa[];
  syncToKasa?: boolean;
}): Promise<{
  success: boolean;
  transferredCount: number;
  kasaSyncedCount: number;
  evrakTransferredCount: number;
  error?: string;
}> {
  const { approval } = params;

  const res = await executePlasiyerGunSonuTransfer({
    firmaId: approval.firmaId,
    userId: params.approverUserId,
    items: approval.items,
    targetNakitKasaId: params.targetNakitKasaId,
    targetKartKasaId: params.targetKartKasaId,
    knownKasalar: params.knownKasalar,
    syncToKasa: params.syncToKasa ?? true,
  });

  if (res.failedCount > 0 && res.transferredCount === 0) {
    return {
      success: false,
      transferredCount: 0,
      kasaSyncedCount: 0,
      evrakTransferredCount: 0,
      error: res.error || 'Onaylanan makbuzlar merkeze aktarılamadı.',
    };
  }

  // Onay/red etiketlerini makbuz açıklamalarından temizle
  for (const item of approval.items) {
    const cleaned = stripGsTagsFromAciklama(item.aciklama);
    if (cleaned !== (item.aciklama || '').trim()) {
      await supabase
        .from('islemler')
        .update({ aciklama: cleaned || null })
        .eq('id', item.id)
        .eq('firma_id', approval.firmaId);
    }
  }

  if (approval.source === 'table') {
    await supabase
      .from('gun_sonu_kapanislari')
      .update({
        durum: 'onaylandi',
        onaylayan_user_id: params.approverUserId || null,
        onay_tarihi: new Date().toISOString(),
      })
      .eq('id', approval.id)
      .eq('firma_id', approval.firmaId);
  }

  saveGunSonuHistoryEntry(approval.firmaId, {
    id: approval.id,
    closedAt: new Date().toISOString(),
    firmaId: approval.firmaId,
    plasiyerId: approval.plasiyerUserId,
    plasiyerName: approval.plasiyerAd,
    closedByName: `${params.approverName} (Onayladı)`,
    dateLabel: approval.kapanisTarihi,
    transferredCount: res.transferredCount,
    kasaSyncedCount: res.kasaSyncedCount,
    evrakTransferredCount: res.evrakTransferredCount,
    expectedNetNakit: approval.beklenenNakit,
    countedNakit: approval.sayilanNakit,
    cashDifference: approval.kasaFarki,
    kartNet: approval.kartToplam,
    cekNet: approval.cekToplam,
    senetNet: approval.senetToplam,
    note: approval.teslimNotu,
  });

  return {
    success: true,
    transferredCount: res.transferredCount,
    kasaSyncedCount: res.kasaSyncedCount,
    evrakTransferredCount: res.evrakTransferredCount,
  };
}

export async function rejectGunSonuRequest(params: {
  approval: PendingGunSonuApproval;
  approverUserId?: string | null;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  const cleanReason = params.reason.trim() || 'Ana hesap tarafından düzeltme için iade edildi.';

  if (params.approval.source === 'table') {
    const { error } = await supabase
      .from('gun_sonu_kapanislari')
      .update({
        durum: 'reddedildi',
        red_nedeni: cleanReason,
        onaylayan_user_id: params.approverUserId || null,
        onay_tarihi: new Date().toISOString(),
      })
      .eq('id', params.approval.id)
      .eq('firma_id', params.approval.firmaId);

    if (error && !isMissingGunSonuTableError(error)) {
      return { success: false, error: error.message || 'Reddetme işlemi kaydedilemedi.' };
    }
  }

  for (const item of params.approval.items) {
    const nextAciklama = upsertGsRedTagInAciklama(item.aciklama, cleanReason);
    await supabase
      .from('islemler')
      .update({ aciklama: nextAciklama })
      .eq('id', item.id)
      .eq('firma_id', params.approval.firmaId);
  }

  return { success: true };
}
