import { supabase, handleSupabaseError } from './supabase';
import { Islem } from '../types/database';
import { extractKarmaRef } from './karmaReceiptHelper';

export interface ReceiptDeletionInspection {
  mainRows: Islem[];
  linkedCaprazRow: Islem | null;
  isKarma: boolean;
  isCapraz: boolean;
  totalAmount: number;
}

const isCaprazIslem = (islem: Islem): boolean =>
  Boolean(
    islem.aciklama?.includes('[ÇAPRAZ ÖDEME') ||
      islem.belge_no?.startsWith('ÇPZ-') ||
      islem.aciklama?.includes('ÇAPRAZ')
  );

/**
 * Silinmek istenen makbuza bağlı Karma kardeş satırları ve Çapraz karşı işlemi tespit eder.
 */
export async function inspectReceiptDeletionTargets(
  islem: Islem,
  firmaId: string
): Promise<ReceiptDeletionInspection> {
  const karmaRef = extractKarmaRef(islem.aciklama);
  let mainRows: Islem[] = [islem];

  if (karmaRef) {
    const { data: siblings } = await supabase
      .from('islemler')
      .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
      .eq('firma_id', firmaId)
      .eq('iptal', islem.iptal)
      .ilike('aciklama', `%${karmaRef}%`)
      .order('id', { ascending: true });

    if (siblings && siblings.length > 0) {
      mainRows = siblings as Islem[];
    }
  }

  let linkedCaprazRow: Islem | null = null;
  const capraz = isCaprazIslem(islem);
  if (capraz && islem.belge_no) {
    const { data: linked } = await supabase
      .from('islemler')
      .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
      .eq('firma_id', firmaId)
      .eq('belge_no', islem.belge_no)
      .neq('id', islem.id)
      .maybeSingle();

    if (linked) {
      linkedCaprazRow = linked as Islem;
    }
  }

  const totalAmount =
    Math.round(mainRows.reduce((sum, r) => sum + (Number(r.tutar) || 0), 0) * 100) / 100;

  return {
    mainRows,
    linkedCaprazRow,
    isKarma: Boolean(karmaRef) || mainRows.length > 1,
    isCapraz: capraz,
    totalAmount,
  };
}

const syncCariBalancesAfterRemoval = async (
  firmaId: string,
  affectedRows: Islem[],
  beforeBalanceMap: Map<string, number>
) => {
  const expectedDeltaByCari = new Map<string, number>();

  for (const row of affectedRows) {
    if (row.iptal || !row.cari_id) continue;
    const tutar = Number(row.tutar) || 0;
    if (tutar <= 0) continue;

    // Tahsilat cari bakiyesini azaltmıştı (-tutar); silinince/iptal edilince +tutar geri eklenir.
    // Tediye cari bakiyesini artırmıştı (+tutar); silinince/iptal edilince -tutar geri düşülür.
    const reverseDelta = row.tip === 'tahsilat' ? tutar : -tutar;
    expectedDeltaByCari.set(
      row.cari_id,
      (expectedDeltaByCari.get(row.cari_id) || 0) + reverseDelta
    );
  }

  const affectedCariIds = Array.from(expectedDeltaByCari.keys());
  if (affectedCariIds.length === 0) return;

  const { data: afterCaris } = await supabase
    .from('cariler')
    .select('id, bakiye')
    .in('id', affectedCariIds);

  for (const c of (afterCaris || []) as Array<{ id: string; bakiye: number }>) {
    const beforeVal = beforeBalanceMap.get(c.id) ?? 0;
    const afterVal = Number(c.bakiye) || 0;
    const expectedDelta = expectedDeltaByCari.get(c.id) || 0;

    // Veritabanı trigger'ı zaten bakiyeyi değiştirdiyse çift işlem yapma;
    // sadece bakiye değişmeden kaldıysa istemciden düzelt.
    if (Math.abs(afterVal - beforeVal) < 0.005 && Math.abs(expectedDelta) >= 0.005) {
      const nextBakiye = Math.round((beforeVal + expectedDelta) * 100) / 100;
      await supabase
        .from('cariler')
        .update({ bakiye: nextBakiye })
        .eq('id', c.id)
        .eq('firma_id', firmaId);
    }
  }
};

export interface DeleteReceiptResult {
  deletedCount: number;
  isRlsBlocked?: boolean;
  errorMessage?: string;
}

/**
 * Makbuz satırlarını kalıcı olarak siler ve cari bakiyesini tutarlı biçimde düzeltir.
 */
export async function deleteReceiptRows(params: {
  rowsToDelete: Islem[];
  firmaId: string;
  isFirmaUnlimited?: boolean;
}): Promise<DeleteReceiptResult> {
  const { rowsToDelete, firmaId, isFirmaUnlimited } = params;

  const uniqueMap = new Map<string, Islem>();
  for (const r of rowsToDelete) {
    if (r?.id) uniqueMap.set(r.id, r);
  }
  const uniqueRows = Array.from(uniqueMap.values());
  if (uniqueRows.length === 0) {
    return { deletedCount: 0, errorMessage: 'Silinecek makbuz kaydı bulunamadı.' };
  }

  const ids = uniqueRows.map((r) => r.id);
  const affectedCariIds = Array.from(
    new Set(uniqueRows.filter((r) => !r.iptal && r.cari_id).map((r) => r.cari_id))
  );

  // 1. Silme öncesi cari bakiyelerini al
  const beforeBalanceMap = new Map<string, number>();
  if (affectedCariIds.length > 0) {
    const { data: beforeCaris } = await supabase
      .from('cariler')
      .select('id, bakiye')
      .in('id', affectedCariIds);
    (beforeCaris || []).forEach((c: { id: string; bakiye: number }) => {
      beforeBalanceMap.set(c.id, Number(c.bakiye) || 0);
    });
  }

  // 2. Bildirimler tablosunda foreign key varsa bağını kopar
  try {
    await supabase.from('bildirimler').update({ islem_id: null }).in('islem_id', ids);
  } catch {
    // ignore
  }

  // 3. İşlemleri sil
  const { data: deletedRows, error: delErr } = await supabase
    .from('islemler')
    .delete()
    .in('id', ids)
    .eq('firma_id', firmaId)
    .select('id');

  if (delErr) {
    const rawMsg = delErr.message || '';
    const lower = rawMsg.toLowerCase();
    const isRls =
      lower.includes('row-level security') ||
      lower.includes('permission') ||
      lower.includes('policy');
    return {
      deletedCount: 0,
      isRlsBlocked: isRls,
      errorMessage: isRls
        ? 'Veritabanı güvenlik kuralı (RLS) "islemler" tablosunda silme işlemine izin vermedi.'
        : handleSupabaseError(delErr, 'Makbuz silinemedi.', { isFirmaUnlimited }),
    };
  }

  if (!deletedRows || deletedRows.length === 0) {
    return {
      deletedCount: 0,
      isRlsBlocked: true,
      errorMessage:
        'Makbuz veritabanından silinemedi. Supabase "islemler" tablosunda DELETE (Silme) RLS politikası tanımlı değil.',
    };
  }

  // 4. Cari bakiyelerini kontrol et / gerekirse geri al
  await syncCariBalancesAfterRemoval(firmaId, uniqueRows, beforeBalanceMap);

  return { deletedCount: deletedRows.length };
}

/**
 * Veritabanında DELETE politikası henüz açılmamışsa alternatif olarak makbuzu iptal durumuna çeker.
 */
export async function cancelReceiptRowsFallback(params: {
  rowsToCancel: Islem[];
  firmaId: string;
  userId?: string;
  reason?: string;
}): Promise<{ cancelledCount: number; errorMessage?: string }> {
  const { rowsToCancel, firmaId, userId, reason } = params;
  const activeRows = rowsToCancel.filter((r) => !r.iptal);
  if (activeRows.length === 0) {
    return { cancelledCount: 0, errorMessage: 'Makbuz zaten iptal edilmiş.' };
  }

  const ids = activeRows.map((r) => r.id);
  const affectedCariIds = Array.from(
    new Set(activeRows.filter((r) => r.cari_id).map((r) => r.cari_id))
  );

  const beforeBalanceMap = new Map<string, number>();
  if (affectedCariIds.length > 0) {
    const { data: beforeCaris } = await supabase
      .from('cariler')
      .select('id, bakiye')
      .in('id', affectedCariIds);
    (beforeCaris || []).forEach((c: { id: string; bakiye: number }) => {
      beforeBalanceMap.set(c.id, Number(c.bakiye) || 0);
    });
  }

  const { error: updErr } = await supabase
    .from('islemler')
    .update({
      iptal: true,
      iptal_nedeni: reason || 'Kullanıcı tarafından silindi / iptal edildi',
      iptal_tarihi: new Date().toISOString(),
      iptal_eden: userId || null,
    })
    .in('id', ids)
    .eq('firma_id', firmaId);

  if (updErr) {
    return {
      cancelledCount: 0,
      errorMessage: handleSupabaseError(updErr, 'Makbuz iptal edilemedi.'),
    };
  }

  await syncCariBalancesAfterRemoval(firmaId, activeRows, beforeBalanceMap);
  return { cancelledCount: activeRows.length };
}
