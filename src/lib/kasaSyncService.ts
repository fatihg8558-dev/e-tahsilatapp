import { supabase } from './supabase';
import { Islem, IslemTur, Kasa, GelirGider, GelirGiderTip } from '../types/database';
import { isMissingKasaTableError } from './kasaSql';

export const MAKBUZ_TAG_PREFIX = '[MAKBUZ:';

export function buildMakbuzTag(islemId: string): string {
  return `[MAKBUZ:${islemId}]`;
}

export function extractMakbuzIdFromAciklama(aciklama?: string | null): string | null {
  if (!aciklama) return null;
  const m = aciklama.match(/\[MAKBUZ:([^\]]+)\]/);
  return m ? m[1] : null;
}

export function stripMakbuzTagFromAciklama(aciklama?: string | null): string {
  if (!aciklama) return '';
  return aciklama.replace(/\[MAKBUZ:[^\]]+\]\s*/g, '').trim();
}

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function pickBestKasaForTur(kasalar: Kasa[], tur: IslemTur): Kasa | null {
  const active = kasalar.filter((k) => k.aktif);
  if (active.length === 0) return null;

  if (tur === 'nakit') {
    return active.find((k) => k.tur === 'nakit') || active[0];
  }
  if (tur === 'kredi_karti') {
    return (
      active.find((k) => k.tur === 'pos') ||
      active.find((k) => k.tur === 'banka') ||
      active[0]
    );
  }
  return active[0];
}

export async function ensureDefaultKasaForTur(
  firmaId: string,
  tur: IslemTur,
  knownKasalar?: Kasa[]
): Promise<Kasa | null> {
  let list = knownKasalar;
  if (!list) {
    const { data, error } = await supabase
      .from('kasalar')
      .select('*')
      .eq('firma_id', firmaId)
      .order('created_at', { ascending: true });

    if (error) {
      if (isMissingKasaTableError(error)) return null;
      throw error;
    }
    list = (data ?? []) as Kasa[];
  }

  const picked = pickBestKasaForTur(list, tur);
  if (picked) return picked;

  // Firma henüz hiç aktif kasa açmamışsa otomatik bir varsayılan kasa oluştur
  const defaultTur = tur === 'kredi_karti' ? 'pos' : 'nakit';
  const defaultAd = defaultTur === 'pos' ? 'POS / Banka Hesabı' : 'Merkez Nakit Kasa';

  const { data: created, error: createErr } = await supabase
    .from('kasalar')
    .insert({
      firma_id: firmaId,
      ad: defaultAd,
      tur: defaultTur,
      banka_adi: null,
      iban: null,
      acilis_bakiyesi: 0,
      guncel_bakiye: 0,
      aktif: true,
    })
    .select('*')
    .single();

  if (createErr) {
    if (isMissingKasaTableError(createErr)) return null;
    throw createErr;
  }

  return created as Kasa;
}

export async function insertGelirGiderWithBalanceSync(payload: {
  firma_id: string;
  kasa_id: string;
  hedef_kasa_id?: string | null;
  tip: GelirGiderTip;
  kategori: string;
  tutar: number;
  tarih: string;
  aciklama?: string | null;
  belge_no?: string | null;
  yapan_user_id?: string | null;
}): Promise<{ error: any | null }> {
  const { data: srcBefore } = await supabase
    .from('kasalar')
    .select('guncel_bakiye')
    .eq('id', payload.kasa_id)
    .maybeSingle();
  const prevSource = srcBefore ? Number(srcBefore.guncel_bakiye) : null;

  let prevTarget: number | null = null;
  if (payload.tip === 'virman' && payload.hedef_kasa_id) {
    const { data: dstBefore } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', payload.hedef_kasa_id)
      .maybeSingle();
    prevTarget = dstBefore ? Number(dstBefore.guncel_bakiye) : null;
  }

  const { error: insErr } = await supabase.from('gelir_giderler').insert(payload);
  if (insErr) return { error: insErr };

  const tutar = Number(payload.tutar) || 0;
  if (prevSource !== null) {
    const { data: srcAfter } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', payload.kasa_id)
      .maybeSingle();
    if (srcAfter && Math.abs(Number(srcAfter.guncel_bakiye) - prevSource) < 0.001) {
      const nextSource = payload.tip === 'gelir' ? prevSource + tutar : prevSource - tutar;
      await supabase.from('kasalar').update({ guncel_bakiye: nextSource }).eq('id', payload.kasa_id);
    }
  }

  if (payload.tip === 'virman' && payload.hedef_kasa_id && prevTarget !== null) {
    const { data: dstAfter } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', payload.hedef_kasa_id)
      .maybeSingle();
    if (dstAfter && Math.abs(Number(dstAfter.guncel_bakiye) - prevTarget) < 0.001) {
      await supabase
        .from('kasalar')
        .update({ guncel_bakiye: prevTarget + tutar })
        .eq('id', payload.hedef_kasa_id);
    }
  }

  return { error: null };
}

export async function deleteGelirGiderWithBalanceSync(item: GelirGider): Promise<{ error: any | null }> {
  const { data: srcBefore } = await supabase
    .from('kasalar')
    .select('guncel_bakiye')
    .eq('id', item.kasa_id)
    .maybeSingle();
  const prevSource = srcBefore ? Number(srcBefore.guncel_bakiye) : null;

  let prevTarget: number | null = null;
  if (item.tip === 'virman' && item.hedef_kasa_id) {
    const { data: dstBefore } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', item.hedef_kasa_id)
      .maybeSingle();
    prevTarget = dstBefore ? Number(dstBefore.guncel_bakiye) : null;
  }

  const { error: delErr } = await supabase.from('gelir_giderler').delete().eq('id', item.id);
  if (delErr) return { error: delErr };

  const tutar = Number(item.tutar) || 0;
  if (prevSource !== null) {
    const { data: srcAfter } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', item.kasa_id)
      .maybeSingle();
    if (srcAfter && Math.abs(Number(srcAfter.guncel_bakiye) - prevSource) < 0.001) {
      const nextSource = item.tip === 'gelir' ? prevSource - tutar : prevSource + tutar;
      await supabase.from('kasalar').update({ guncel_bakiye: nextSource }).eq('id', item.kasa_id);
    }
  }

  if (item.tip === 'virman' && item.hedef_kasa_id && prevTarget !== null) {
    const { data: dstAfter } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', item.hedef_kasa_id)
      .maybeSingle();
    if (dstAfter && Math.abs(Number(dstAfter.guncel_bakiye) - prevTarget) < 0.001) {
      await supabase
        .from('kasalar')
        .update({ guncel_bakiye: prevTarget - tutar })
        .eq('id', item.hedef_kasa_id);
    }
  }

  return { error: null };
}

export async function removeIslemsFromKasa(islemIds: string[], firmaId: string): Promise<void> {
  if (!firmaId || islemIds.length === 0) return;

  for (const id of islemIds) {
    if (!id) continue;
    const tag = buildMakbuzTag(id);
    const { data, error } = await supabase
      .from('gelir_giderler')
      .select('*')
      .eq('firma_id', firmaId)
      .ilike('aciklama', `%${tag}%`);

    if (error) {
      if (isMissingKasaTableError(error)) return;
      console.error('removeIslemsFromKasa query error:', error);
      continue;
    }

    for (const row of (data ?? []) as GelirGider[]) {
      await deleteGelirGiderWithBalanceSync(row);
    }
  }
}

export async function fetchSyncedMakbuzMap(
  firmaId: string
): Promise<Map<string, { kasaId: string; gelirGiderId: string }[]>> {
  const map = new Map<string, { kasaId: string; gelirGiderId: string }[]>();
  if (!firmaId) return map;

  const { data, error } = await supabase
    .from('gelir_giderler')
    .select('id, kasa_id, aciklama')
    .eq('firma_id', firmaId)
    .ilike('aciklama', `%${MAKBUZ_TAG_PREFIX}%`);

  if (error || !data) return map;

  for (const row of data as Array<{ id: string; kasa_id: string; aciklama: string | null }>) {
    const islemId = extractMakbuzIdFromAciklama(row.aciklama);
    if (!islemId) continue;
    const existing = map.get(islemId) ?? [];
    existing.push({ kasaId: row.kasa_id, gelirGiderId: row.id });
    map.set(islemId, existing);
  }
  return map;
}

const isCaprazRow = (islem: Islem) =>
  Boolean(
    islem.aciklama?.includes('[ÇAPRAZ ÖDEME') ||
      islem.belge_no?.startsWith('ÇPZ-') ||
      islem.aciklama?.includes('ÇAPRAZ')
  );

const cleanNoteForKasa = (aciklama?: string | null): string => {
  if (!aciklama) return '';
  return aciklama
    .replace(/\[KARMA MAKBUZ[^\]]*\]\s*/gi, '')
    .replace(/\[DÖVİZ:[^\]]*\]\s*-?\s*/gi, '')
    .replace(/\[MAKBUZ:[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export async function syncIslemToKasa(params: {
  islem: Islem;
  firmaId: string;
  userId?: string | null;
  kasaIdOverride?: string | null;
  knownKasalar?: Kasa[];
  skipIfPlasiyerde?: boolean;
  forceTransferFromPlasiyer?: boolean;
}): Promise<{ synced: boolean; kasaAd?: string; reason?: string; error?: string }> {
  const {
    islem,
    firmaId,
    userId,
    kasaIdOverride,
    knownKasalar,
    skipIfPlasiyerde = true,
    forceTransferFromPlasiyer = false,
  } = params;

  try {
    // Önce varsa eski kasa kaydını temizle (güncelleme veya tekrar aktarımda çift kayıt olmasın)
    await removeIslemsFromKasa([islem.id], firmaId);

    if (islem.iptal) return { synced: false, reason: 'iptal' };
    if (islem.tur !== 'nakit' && islem.tur !== 'kredi_karti') {
      return { synced: false, reason: 'non_cash' };
    }
    if (isCaprazRow(islem)) return { synced: false, reason: 'capraz' };
    if (kasaIdOverride === '__none__') return { synced: false, reason: 'skipped' };
    if (skipIfPlasiyerde && islem.durum === 'plasiyerde') {
      return { synced: false, reason: 'plasiyerde' };
    }

    const tutar = Number(islem.tutar) || 0;
    if (!(tutar > 0)) return { synced: false, reason: 'zero_amount' };

    let targetKasa: Kasa | null = null;
    if (kasaIdOverride) {
      const foundInKnown = knownKasalar?.find((k) => k.id === kasaIdOverride);
      if (foundInKnown) {
        targetKasa = foundInKnown;
      } else {
        const { data: kData, error: kErr } = await supabase
          .from('kasalar')
          .select('*')
          .eq('id', kasaIdOverride)
          .eq('firma_id', firmaId)
          .maybeSingle();
        if (kErr && isMissingKasaTableError(kErr)) {
          return { synced: false, reason: 'kasa_table_missing' };
        }
        targetKasa = (kData as Kasa) || null;
      }
    }

    if (!targetKasa) {
      targetKasa = await ensureDefaultKasaForTur(firmaId, islem.tur, knownKasalar);
    }

    if (!targetKasa) {
      return { synced: false, reason: 'kasa_table_missing' };
    }

    if (forceTransferFromPlasiyer && islem.durum === 'plasiyerde') {
      await supabase
        .from('islemler')
        .update({ durum: 'aktarildi' })
        .eq('id', islem.id)
        .eq('firma_id', firmaId);
    }

    const ggTip: GelirGiderTip = islem.tip === 'tahsilat' ? 'gelir' : 'gider';
    const kategori =
      islem.tip === 'tahsilat'
        ? islem.tur === 'nakit'
          ? 'Cari Tahsilat (Nakit)'
          : 'Cari Tahsilat (Kart/POS)'
        : islem.tur === 'nakit'
        ? 'Cari Tediye (Nakit)'
        : 'Cari Tediye (Kart/POS)';

    const cariUnvan = islem.cariler?.unvan || 'Cari Makbuz';
    const cleanNote = cleanNoteForKasa(islem.aciklama);
    const aciklama = `${buildMakbuzTag(islem.id)} ${cariUnvan}${cleanNote ? ` · ${cleanNote}` : ''}`;
    const belgeNo = islem.makbuz_no || islem.belge_no || `MKB-${islem.id.slice(0, 8)}`;
    const tarih = (islem.tarih || '').slice(0, 10) || todayIso();

    const { error: insErr } = await insertGelirGiderWithBalanceSync({
      firma_id: firmaId,
      kasa_id: targetKasa.id,
      hedef_kasa_id: null,
      tip: ggTip,
      kategori,
      tutar,
      tarih,
      aciklama,
      belge_no: belgeNo,
      yapan_user_id: userId || islem.yapan_user_id || null,
    });

    if (insErr) {
      if (isMissingKasaTableError(insErr)) {
        return { synced: false, reason: 'kasa_table_missing' };
      }
      return { synced: false, error: insErr.message || 'Kasa kaydı eklenemedi.' };
    }

    return { synced: true, kasaAd: targetKasa.ad };
  } catch (err: any) {
    if (isMissingKasaTableError(err)) {
      return { synced: false, reason: 'kasa_table_missing' };
    }
    return { synced: false, error: err?.message || 'Kasa senkronizasyonu başarısız.' };
  }
}

export async function syncTekSatirKarmaToKasa(params: {
  islem: Islem;
  firmaId: string;
  userId?: string | null;
  nakitTutar: number;
  kartTutar: number;
  nakitKasaIdOverride?: string | null;
  kartKasaIdOverride?: string | null;
  knownKasalar?: Kasa[];
  skipIfPlasiyerde?: boolean;
}): Promise<void> {
  const {
    islem,
    firmaId,
    userId,
    nakitTutar,
    kartTutar,
    nakitKasaIdOverride,
    kartKasaIdOverride,
    knownKasalar,
    skipIfPlasiyerde = true,
  } = params;

  try {
    await removeIslemsFromKasa([islem.id], firmaId);
    if (islem.iptal) return;
    if (skipIfPlasiyerde && islem.durum === 'plasiyerde') return;

    const cariUnvan = islem.cariler?.unvan || 'Karma Makbuz';
    const belgeNo = islem.makbuz_no || islem.belge_no || `MKB-${islem.id.slice(0, 8)}`;
    const tarih = (islem.tarih || '').slice(0, 10) || todayIso();
    const ggTip: GelirGiderTip = islem.tip === 'tahsilat' ? 'gelir' : 'gider';

    if (nakitTutar > 0 && nakitKasaIdOverride !== '__none__') {
      const kasa =
        (nakitKasaIdOverride && knownKasalar?.find((k) => k.id === nakitKasaIdOverride)) ||
        (await ensureDefaultKasaForTur(firmaId, 'nakit', knownKasalar));
      if (kasa) {
        await insertGelirGiderWithBalanceSync({
          firma_id: firmaId,
          kasa_id: kasa.id,
          hedef_kasa_id: null,
          tip: ggTip,
          kategori: islem.tip === 'tahsilat' ? 'Cari Tahsilat (Nakit)' : 'Cari Tediye (Nakit)',
          tutar: nakitTutar,
          tarih,
          aciklama: `${buildMakbuzTag(islem.id)} ${cariUnvan} · Karma (Nakit)`,
          belge_no: belgeNo,
          yapan_user_id: userId || islem.yapan_user_id || null,
        });
      }
    }

    if (kartTutar > 0 && kartKasaIdOverride !== '__none__') {
      const kasa =
        (kartKasaIdOverride && knownKasalar?.find((k) => k.id === kartKasaIdOverride)) ||
        (await ensureDefaultKasaForTur(firmaId, 'kredi_karti', knownKasalar));
      if (kasa) {
        await insertGelirGiderWithBalanceSync({
          firma_id: firmaId,
          kasa_id: kasa.id,
          hedef_kasa_id: null,
          tip: ggTip,
          kategori: islem.tip === 'tahsilat' ? 'Cari Tahsilat (Kart/POS)' : 'Cari Tediye (Kart/POS)',
          tutar: kartTutar,
          tarih,
          aciklama: `${buildMakbuzTag(islem.id)} ${cariUnvan} · Karma (Kart/POS)`,
          belge_no: belgeNo,
          yapan_user_id: userId || islem.yapan_user_id || null,
        });
      }
    }
  } catch (err) {
    if (!isMissingKasaTableError(err)) {
      console.error('syncTekSatirKarmaToKasa error:', err);
    }
  }
}
