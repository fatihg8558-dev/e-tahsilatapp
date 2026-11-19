import { supabase } from './supabase';
import { Kasa } from '../types/database';
import { isMissingKasaTableError } from './kasaSql';
import {
  deleteGelirGiderWithBalanceSync,
  ensureDefaultKasaForTur,
  insertGelirGiderWithBalanceSync,
} from './kasaSyncService';
import { getTodayIsoLocal } from './formatters';

export const FATURA_KASA_TAG_PREFIX = '[FATURA:';

export const GIB_GIDER_KATEGORILERI = [
  'Mal / Hizmet Alımı',
  'Fatura Gideri',
  'Kira',
  'Elektrik/Su/Doğalgaz',
  'İnternet & Telefon',
  'Yakıt & Ulaşım',
  'Yemek & İkram',
  'Kargo & Nakliye',
  'Bakım & Onarım',
  'Reklam & Pazarlama',
  'Kırtasiye & Ofis',
  'Demirbaş & Ekipman',
  'Maaş & Personel',
  'Vergi & SGK',
  'Banka Masrafı',
  'Diğer Gider',
];

export function normalizeFaturaNoKey(faturaNo?: string | null): string {
  return (faturaNo || '').trim().toUpperCase();
}

export function buildFaturaKasaTag(faturaNo: string): string {
  return `[FATURA:${normalizeFaturaNoKey(faturaNo)}]`;
}

export function extractFaturaNoFromAciklama(aciklama?: string | null): string | null {
  if (!aciklama) return null;
  const match = aciklama.match(/\[FATURA:([^\]]+)\]/i);
  return match ? normalizeFaturaNoKey(match[1]) : null;
}

/**
 * Kasaya "Giderleştir" ile zaten aktarılmış fatura numaralarını döndürür (mükerrer gider düşümünü önler).
 */
export async function fetchExpenseSyncedFaturaNos(firmaId: string): Promise<Set<string>> {
  const result = new Set<string>();
  if (!firmaId) return result;

  try {
    const { data, error } = await supabase
      .from('gelir_giderler')
      .select('aciklama, belge_no')
      .eq('firma_id', firmaId)
      .eq('tip', 'gider')
      .ilike('aciklama', `%${FATURA_KASA_TAG_PREFIX}%`);

    if (error || !data) return result;

    for (const row of data as Array<{ aciklama?: string | null; belge_no?: string | null }>) {
      const fromTag = extractFaturaNoFromAciklama(row.aciklama);
      if (fromTag) result.add(fromTag);
      else if (row.belge_no) result.add(normalizeFaturaNoKey(row.belge_no));
    }
  } catch {
    // ignore
  }

  return result;
}

export async function postFaturaAsKasaGider(params: {
  firmaId: string;
  faturaNo: string;
  cariUnvan: string;
  tutar: number;
  tarih: string;
  kasaId?: string | null;
  kategori?: string | null;
  userId?: string | null;
  knownKasalar?: Kasa[];
}): Promise<{
  posted: boolean;
  skippedDuplicate?: boolean;
  kasaAd?: string;
  reason?: string;
  error?: string;
}> {
  const {
    firmaId,
    faturaNo,
    cariUnvan,
    tutar,
    tarih,
    kasaId,
    kategori,
    userId,
    knownKasalar,
  } = params;

  const cleanNo = normalizeFaturaNoKey(faturaNo);
  const cleanTutar = Math.round((Number(tutar) || 0) * 100) / 100;
  if (!firmaId || !cleanNo || !(cleanTutar > 0)) {
    return { posted: false, reason: 'invalid_payload' };
  }

  try {
    const tag = buildFaturaKasaTag(cleanNo);

    // Mükerrer gider kontrolü
    const { data: existingRows, error: checkErr } = await supabase
      .from('gelir_giderler')
      .select('id')
      .eq('firma_id', firmaId)
      .eq('tip', 'gider')
      .ilike('aciklama', `%${tag}%`)
      .limit(1);

    if (checkErr) {
      if (isMissingKasaTableError(checkErr)) {
        return { posted: false, reason: 'kasa_table_missing' };
      }
      return { posted: false, error: checkErr.message || 'Gider kontrolü yapılamadı.' };
    }

    if (existingRows && existingRows.length > 0) {
      return { posted: false, skippedDuplicate: true, reason: 'already_posted' };
    }

    let targetKasa: Kasa | null = null;
    if (kasaId) {
      targetKasa = knownKasalar?.find((k) => k.id === kasaId) || null;
      if (!targetKasa) {
        const { data: kData, error: kErr } = await supabase
          .from('kasalar')
          .select('*')
          .eq('id', kasaId)
          .eq('firma_id', firmaId)
          .maybeSingle();
        if (kErr && isMissingKasaTableError(kErr)) {
          return { posted: false, reason: 'kasa_table_missing' };
        }
        targetKasa = (kData as Kasa) || null;
      }
    }

    if (!targetKasa) {
      targetKasa = await ensureDefaultKasaForTur(firmaId, 'nakit', knownKasalar);
    }

    if (!targetKasa) {
      return { posted: false, reason: 'kasa_table_missing' };
    }

    const cleanDate = (tarih || '').slice(0, 10) || getTodayIsoLocal();
    const cleanKat = (kategori || '').trim() || 'Mal / Hizmet Alımı';
    const cleanCari = (cariUnvan || 'Tedarikçi').trim();

    const { error: insErr } = await insertGelirGiderWithBalanceSync({
      firma_id: firmaId,
      kasa_id: targetKasa.id,
      hedef_kasa_id: null,
      tip: 'gider',
      kategori: cleanKat,
      tutar: cleanTutar,
      tarih: cleanDate,
      aciklama: `${tag} ${cleanCari} · Fatura Giderleştirme`,
      belge_no: faturaNo.trim(),
      yapan_user_id: userId || null,
    });

    if (insErr) {
      if (isMissingKasaTableError(insErr)) {
        return { posted: false, reason: 'kasa_table_missing' };
      }
      return { posted: false, error: insErr.message || 'Kasaya gider eklenemedi.' };
    }

    return { posted: true, kasaAd: targetKasa.ad };
  } catch (err: unknown) {
    if (isMissingKasaTableError(err)) {
      return { posted: false, reason: 'kasa_table_missing' };
    }
    return {
      posted: false,
      error: err instanceof Error ? err.message : 'Fatura kasaya gider olarak işlenemedi.',
    };
  }
}

/**
 * Bir fatura cari ekstrelerinden silindiğinde, varsa kasaya [FATURA:NO] ile işlenmiş gider kaydını da geri alır.
 */
export async function removeFaturaFromKasa(faturaNo: string, firmaId: string): Promise<void> {
  const cleanNo = normalizeFaturaNoKey(faturaNo);
  if (!firmaId || !cleanNo) return;

  try {
    const tag = buildFaturaKasaTag(cleanNo);
    const { data, error } = await supabase
      .from('gelir_giderler')
      .select('*')
      .eq('firma_id', firmaId)
      .eq('tip', 'gider')
      .ilike('aciklama', `%${tag}%`);

    if (error || !data) return;

    for (const row of data) {
      await deleteGelirGiderWithBalanceSync(row);
    }
  } catch {
    // ignore
  }
}
