import { supabase, handleSupabaseError } from './supabase';
import { Cari, Fatura, FaturaYon, Islem } from '../types/database';
import { removeIslemsFromKasa } from './kasaSyncService';
import { removeFaturaFromKasa } from './faturaExpenseService';
import { removeUblInvoiceSnapshotAsync } from './ublInvoiceStore';

export interface CariDeletionInspection {
  faturaCount: number;
  islemCount: number;
  hasLinkedRecords: boolean;
}

export interface DeleteEntityResult {
  deleted: boolean;
  isRlsBlocked?: boolean;
  isForeignKeyBlocked?: boolean;
  rlsTable?: 'cariler' | 'faturalar' | 'islemler';
  errorMessage?: string;
}

export const CARILER_AND_FATURALAR_DELETE_RLS_SQL = `-- Supabase SQL Editor'de çalıştırarak cariler, faturalar ve islemler tablolarında SİLME (DELETE) yetkisini açın:
DROP POLICY IF EXISTS "cariler_firma_delete" ON public.cariler;
CREATE POLICY "cariler_firma_delete" ON public.cariler FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.firma_id = cariler.firma_id AND p.aktif = true)
          OR p.rol = 'superadmin'
          OR lower(p.email) = 'conqueror58@gmail.com'
        )
    )
  );

DROP POLICY IF EXISTS "faturalar_firma_delete" ON public.faturalar;
CREATE POLICY "faturalar_firma_delete" ON public.faturalar FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.firma_id = faturalar.firma_id AND p.aktif = true)
          OR p.rol = 'superadmin'
          OR lower(p.email) = 'conqueror58@gmail.com'
        )
    )
  );

DROP POLICY IF EXISTS "islemler_firma_delete" ON public.islemler;
CREATE POLICY "islemler_firma_delete" ON public.islemler FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.firma_id = islemler.firma_id AND p.aktif = true)
          OR p.rol = 'superadmin'
          OR lower(p.email) = 'conqueror58@gmail.com'
        )
    )
  );`;

function detectRlsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  const lower = (e.message || '').toLowerCase();
  return (
    e.code === '42501' ||
    lower.includes('row-level security') ||
    lower.includes('permission') ||
    lower.includes('policy')
  );
}

function detectForeignKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  const lower = (e.message || '').toLowerCase();
  return e.code === '23503' || lower.includes('foreign key') || lower.includes('violates foreign key');
}

/**
 * Veritabanı trigger'ı fatura silinince cari bakiyeyi zaten değiştirdiyse çift sayımı önler;
 * bakiye değişmeden kaldıysa istemci üzerinden bakiyeyi geri alır.
 */
export function computeFaturaDeleteBalanceUpdate(params: {
  beforeVal: number;
  afterVal: number;
  tutar: number;
  yon: FaturaYon;
}): { shouldUpdateClient: boolean; nextBakiye: number } {
  const { beforeVal, afterVal, tutar, yon } = params;
  const cleanTutar = Math.round((Number(tutar) || 0) * 100) / 100;
  if (cleanTutar <= 0) {
    return { shouldUpdateClient: false, nextBakiye: afterVal };
  }

  // Satış faturası cariyi +tutar borçlandırmıştı -> silinince -tutar düşülür.
  // Alış faturası cariyi -tutar alacaklandırmıştı -> silinince +tutar eklenir.
  const reverseDelta = yon === 'satis' ? -cleanTutar : cleanTutar;
  const triggerDidNotChangeBalance = Math.abs(afterVal - beforeVal) < 0.005;

  if (!triggerDidNotChangeBalance) {
    return { shouldUpdateClient: false, nextBakiye: afterVal };
  }

  const nextBakiye = Math.round((beforeVal + reverseDelta) * 100) / 100;
  return {
    shouldUpdateClient: true,
    nextBakiye: Object.is(nextBakiye, -0) ? 0 : nextBakiye,
  };
}

export async function inspectCariDeletionTargets(
  cariId: string,
  firmaId: string
): Promise<CariDeletionInspection> {
  const [faturaRes, islemRes] = await Promise.all([
    supabase
      .from('faturalar')
      .select('id', { count: 'exact', head: true })
      .eq('cari_id', cariId)
      .eq('firma_id', firmaId),
    supabase
      .from('islemler')
      .select('id', { count: 'exact', head: true })
      .eq('cari_id', cariId)
      .eq('firma_id', firmaId),
  ]);

  const faturaCount = faturaRes.count ?? 0;
  const islemCount = islemRes.count ?? 0;

  return {
    faturaCount,
    islemCount,
    hasLinkedRecords: faturaCount > 0 || islemCount > 0,
  };
}

export async function deleteCariWithLinkedRecords(params: {
  cari: Cari;
  firmaId: string;
  deleteLinkedRecords: boolean;
  isFirmaUnlimited?: boolean;
}): Promise<DeleteEntityResult> {
  const { cari, firmaId, deleteLinkedRecords, isFirmaUnlimited } = params;

  try {
    if (deleteLinkedRecords) {
      // 1. Bağlı işlemleri çek (bildirim bağlarını ve kasa etkisini temizleyebilmek için)
      const { data: linkedIslems } = await supabase
        .from('islemler')
        .select('id')
        .eq('cari_id', cari.id)
        .eq('firma_id', firmaId);

      const islemIds = ((linkedIslems || []) as Array<Pick<Islem, 'id'>>).map((i) => i.id);

      if (islemIds.length > 0) {
        try {
          await supabase.from('bildirimler').update({ islem_id: null }).in('islem_id', islemIds);
        } catch {
          // ignore
        }

        const { data: delIslems, error: islemDelErr } = await supabase
          .from('islemler')
          .delete()
          .eq('cari_id', cari.id)
          .eq('firma_id', firmaId)
          .select('id');

        if (islemDelErr) {
          const isRls = detectRlsError(islemDelErr);
          return {
            deleted: false,
            isRlsBlocked: isRls,
            rlsTable: isRls ? 'islemler' : undefined,
            errorMessage: isRls
              ? 'Veritabanı güvenlik kuralı (RLS) bu cariye bağlı "islemler" kayıtlarını silmeye izin vermedi.'
              : handleSupabaseError(islemDelErr, 'Cariye bağlı işlemler silinemedi.', {
                  isFirmaUnlimited,
                }),
          };
        }

        if (!delIslems || delIslems.length === 0) {
          return {
            deleted: false,
            isRlsBlocked: true,
            rlsTable: 'islemler',
            errorMessage:
              'Cariye bağlı tahsilat/tediye kayıtları silinemedi. Supabase "islemler" tablosunda DELETE RLS politikası tanımlı değil.',
          };
        }

        await removeIslemsFromKasa(islemIds, firmaId);
      }

      // 2. Bağlı faturaları çek ve sil
      const { data: linkedFaturalar } = await supabase
        .from('faturalar')
        .select('id, fatura_no, yon')
        .eq('cari_id', cari.id)
        .eq('firma_id', firmaId);

      const faturaRows = (linkedFaturalar || []) as Array<Pick<Fatura, 'id' | 'fatura_no' | 'yon'>>;

      if (faturaRows.length > 0) {
        const { data: delFaturalar, error: fatDelErr } = await supabase
          .from('faturalar')
          .delete()
          .eq('cari_id', cari.id)
          .eq('firma_id', firmaId)
          .select('id');

        if (fatDelErr) {
          const isRls = detectRlsError(fatDelErr);
          return {
            deleted: false,
            isRlsBlocked: isRls,
            rlsTable: isRls ? 'faturalar' : undefined,
            errorMessage: isRls
              ? 'Veritabanı güvenlik kuralı (RLS) bu cariye bağlı "faturalar" kayıtlarını silmeye izin vermedi.'
              : handleSupabaseError(fatDelErr, 'Cariye bağlı faturalar silinemedi.', {
                  isFirmaUnlimited,
                }),
          };
        }

        if (!delFaturalar || delFaturalar.length === 0) {
          return {
            deleted: false,
            isRlsBlocked: true,
            rlsTable: 'faturalar',
            errorMessage:
              'Cariye bağlı faturalar veritabanından silinemedi. Supabase "faturalar" tablosunda DELETE RLS politikası tanımlı değil.',
          };
        }

        for (const f of faturaRows) {
          await removeUblInvoiceSnapshotAsync(firmaId, f.fatura_no, f.yon);
          await removeFaturaFromKasa(f.fatura_no, firmaId);
        }
      }
    }

    // 3. Cari kartının kendisini sil ve gerçekten silinen satırı doğrula
    const { data: deletedCaris, error: cariDelErr } = await supabase
      .from('cariler')
      .delete()
      .eq('id', cari.id)
      .eq('firma_id', firmaId)
      .select('id');

    if (cariDelErr) {
      const isRls = detectRlsError(cariDelErr);
      const isFk = detectForeignKeyError(cariDelErr);
      return {
        deleted: false,
        isRlsBlocked: isRls,
        isForeignKeyBlocked: isFk,
        rlsTable: isRls ? 'cariler' : undefined,
        errorMessage: isFk
          ? 'Bu cariye bağlı fatura veya işlem kayıtları bulunduğu için silinemedi. Lütfen "Bağlı fatura ve işlemleri de sil" seçeneğini işaretleyin.'
          : isRls
          ? 'Veritabanı güvenlik kuralı (RLS) "cariler" tablosunda silme işlemine izin vermedi.'
          : handleSupabaseError(cariDelErr, 'Cari kartı silinemedi.', { isFirmaUnlimited }),
      };
    }

    if (!deletedCaris || deletedCaris.length === 0) {
      return {
        deleted: false,
        isRlsBlocked: true,
        rlsTable: 'cariler',
        errorMessage:
          'Cari veritabanından silinemedi. Supabase "cariler" tablosunda DELETE (Silme) RLS politikası tanımlı değil veya yetkiniz yok.',
      };
    }

    return { deleted: true };
  } catch (err: unknown) {
    return {
      deleted: false,
      isRlsBlocked: detectRlsError(err),
      isForeignKeyBlocked: detectForeignKeyError(err),
      errorMessage: handleSupabaseError(err, 'Cari silinirken beklenmeyen bir hata oluştu.', {
        isFirmaUnlimited,
      }),
    };
  }
}

export async function deleteFaturaRecord(params: {
  fatura: Fatura;
  firmaId: string;
  isFirmaUnlimited?: boolean;
}): Promise<DeleteEntityResult> {
  const { fatura, firmaId, isFirmaUnlimited } = params;

  try {
    // 1. Silme öncesi cari bakiyesini oku
    let beforeVal = 0;
    let hasCari = false;
    if (fatura.cari_id) {
      const { data: beforeCari } = await supabase
        .from('cariler')
        .select('id, bakiye')
        .eq('id', fatura.cari_id)
        .eq('firma_id', firmaId)
        .maybeSingle();

      if (beforeCari) {
        hasCari = true;
        beforeVal = Number((beforeCari as { bakiye: number }).bakiye) || 0;
      }
    }

    // 2. Faturayı sil ve silindiğini doğrula
    const { data: deletedRows, error: delErr } = await supabase
      .from('faturalar')
      .delete()
      .eq('id', fatura.id)
      .eq('firma_id', firmaId)
      .select('id');

    if (delErr) {
      const isRls = detectRlsError(delErr);
      return {
        deleted: false,
        isRlsBlocked: isRls,
        rlsTable: isRls ? 'faturalar' : undefined,
        errorMessage: isRls
          ? 'Veritabanı güvenlik kuralı (RLS) "faturalar" tablosunda silme işlemine izin vermedi.'
          : handleSupabaseError(delErr, 'Fatura silinemedi.', { isFirmaUnlimited }),
      };
    }

    if (!deletedRows || deletedRows.length === 0) {
      return {
        deleted: false,
        isRlsBlocked: true,
        rlsTable: 'faturalar',
        errorMessage:
          'Fatura veritabanından silinemedi. Supabase "faturalar" tablosunda DELETE (Silme) RLS politikası tanımlı değil.',
      };
    }

    // 3. Cari bakiyesini kontrol et; DB trigger değiştirmediyse istemciden güncelle
    if (hasCari && fatura.cari_id) {
      const { data: afterCari } = await supabase
        .from('cariler')
        .select('id, bakiye')
        .eq('id', fatura.cari_id)
        .eq('firma_id', firmaId)
        .maybeSingle();

      if (afterCari) {
        const afterVal = Number((afterCari as { bakiye: number }).bakiye) || 0;
        const balanceUpdate = computeFaturaDeleteBalanceUpdate({
          beforeVal,
          afterVal,
          tutar: Number(fatura.tutar) || 0,
          yon: fatura.yon,
        });

        if (balanceUpdate.shouldUpdateClient) {
          await supabase
            .from('cariler')
            .update({ bakiye: balanceUpdate.nextBakiye })
            .eq('id', fatura.cari_id)
            .eq('firma_id', firmaId);
        }
      }
    }

    // 4. Tarayıcı önbelleğindeki UBL görsel kaydını ve varsa kasadaki fatura giderini temizle
    await removeUblInvoiceSnapshotAsync(firmaId, fatura.fatura_no, fatura.yon);
    await removeFaturaFromKasa(fatura.fatura_no, firmaId);

    return { deleted: true };
  } catch (err: unknown) {
    return {
      deleted: false,
      isRlsBlocked: detectRlsError(err),
      errorMessage: handleSupabaseError(err, 'Fatura silinirken beklenmeyen bir hata oluştu.', {
        isFirmaUnlimited,
      }),
    };
  }
}
