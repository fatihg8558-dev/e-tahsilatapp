import { supabase, handleSupabaseError } from './supabase';
import { Cari, Fatura, FaturaYon, Firma, Kasa } from '../types/database';
import {
  normalizeFaturaNoKey,
  postFaturaAsKasaHareket,
} from './faturaExpenseService';
import { ParsedUblInvoice, normalizeTaxId } from './ublParser';
import { saveUblInvoiceSnapshotsAsync, syncUblDetayToSupabase } from './ublInvoiceStore';

export interface CreateManualFaturaParams {
  firmaId: string;
  firma?: Pick<Firma, 'id' | 'unvan' | 'vergi_no' | 'telefon' | 'email' | 'sinirsiz'> | null;
  cari: Cari;
  faturaNo: string;
  tarih: string;
  yon: FaturaYon;
  toplamTutar: number;
  kdvOrani?: number;
  aciklama?: string;
  vadeTarihi?: string;
  syncToKasa?: boolean;
  kasaId?: string | null;
  kasaKategori?: string | null;
  userId?: string | null;
  knownKasalar?: Kasa[];
}

export interface CreateManualFaturaResult {
  success: boolean;
  fatura?: Fatura;
  kasaPosted?: boolean;
  kasaAd?: string;
  kasaWarning?: string;
  error?: string;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export function generateManualFaturaNoSuggestion(yon: FaturaYon): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  const prefix = yon === 'satis' ? 'SAT' : 'ALS';
  return `${prefix}${y}${m}${d}-${rand}`;
}

export function calculateGrossFromNetAndVat(matrah: number, kdvOrani: number): number {
  const cleanMatrah = round2(matrah);
  const cleanKdv = Number(kdvOrani) || 0;
  if (cleanMatrah <= 0) return 0;
  return round2(cleanMatrah * (1 + cleanKdv / 100));
}

export function splitGrossToNetAndVat(
  toplamTutar: number,
  kdvOrani: number
): { matrah: number; kdvTutar: number } {
  const cleanTotal = round2(toplamTutar);
  const rate = Math.max(0, Number(kdvOrani) || 0);
  if (cleanTotal <= 0) return { matrah: 0, kdvTutar: 0 };
  if (rate === 0) return { matrah: cleanTotal, kdvTutar: 0 };
  const matrah = round2(cleanTotal / (1 + rate / 100));
  const kdvTutar = round2(cleanTotal - matrah);
  return { matrah, kdvTutar };
}

export async function createManualFaturaRecord(
  params: CreateManualFaturaParams
): Promise<CreateManualFaturaResult> {
  const {
    firmaId,
    firma,
    cari,
    faturaNo,
    tarih,
    yon,
    toplamTutar,
    kdvOrani = 20,
    aciklama,
    vadeTarihi,
    syncToKasa = false,
    kasaId,
    kasaKategori,
    userId,
    knownKasalar,
  } = params;

  const cleanNo = faturaNo.trim();
  const cleanTutar = round2(toplamTutar);
  const cleanDate = (tarih || '').slice(0, 10);

  if (!firmaId || !cari?.id) {
    return { success: false, error: 'Firma veya cari bilgisi eksik.' };
  }
  if (!cleanNo) {
    return { success: false, error: 'Lütfen fatura numarasını giriniz.' };
  }
  if (!cleanDate) {
    return { success: false, error: 'Lütfen fatura tarihini seçiniz.' };
  }
  if (!(cleanTutar > 0)) {
    return { success: false, error: 'Fatura tutarı sıfırdan büyük olmalıdır.' };
  }

  try {
    // 1. Mükerrer fatura numarası kontrolü
    const normalizedNo = normalizeFaturaNoKey(cleanNo);
    const { data: existingList } = await supabase
      .from('faturalar')
      .select('id, fatura_no, yon')
      .eq('firma_id', firmaId)
      .eq('yon', yon);

    const dup = ((existingList || []) as Array<{ fatura_no: string; yon: FaturaYon }>).find(
      (f) => normalizeFaturaNoKey(f.fatura_no) === normalizedNo
    );

    if (dup) {
      return {
        success: false,
        error: `${cleanNo} numaralı ${yon === 'satis' ? 'satış' : 'alış'} faturası sistemde zaten kayıtlı.`,
      };
    }

    // 2. İşlem öncesi cari bakiyesini oku (trigger yoksa istemciden güncellemek için)
    const { data: beforeCari } = await supabase
      .from('cariler')
      .select('id, bakiye')
      .eq('id', cari.id)
      .eq('firma_id', firmaId)
      .maybeSingle();

    const beforeVal = beforeCari
      ? Number((beforeCari as { bakiye: number }).bakiye) || 0
      : Number(cari.bakiye) || 0;

    // 3. Fatura kaydını ekle
    const { data: inserted, error: insertErr } = await supabase
      .from('faturalar')
      .insert({
        firma_id: firmaId,
        cari_id: cari.id,
        fatura_no: cleanNo,
        tarih: cleanDate,
        tutar: cleanTutar,
        yon,
      })
      .select('*')
      .single();

    if (insertErr) {
      throw insertErr;
    }

    // 4. Cari bakiyesini trigger değiştirdiyse dokunma; değiştirmediyse güncelle
    const signedDelta = yon === 'satis' ? cleanTutar : -cleanTutar;
    const { data: afterCari } = await supabase
      .from('cariler')
      .select('id, bakiye')
      .eq('id', cari.id)
      .eq('firma_id', firmaId)
      .maybeSingle();

    if (afterCari) {
      const afterVal = Number((afterCari as { bakiye: number }).bakiye) || 0;
      if (Math.abs(afterVal - beforeVal) < 0.005) {
        const nextBakiye = round2(beforeVal + signedDelta);
        await supabase
          .from('cariler')
          .update({ bakiye: Object.is(nextBakiye, -0) ? 0 : nextBakiye })
          .eq('id', cari.id)
          .eq('firma_id', firmaId);
      }
    }

    // 5. Fatura görselleştirme / detay önizleme için özet kalem snapshot'ı sakla
    const { matrah, kdvTutar } = splitGrossToNetAndVat(cleanTutar, kdvOrani);
    const ownParty = {
      vkn: normalizeTaxId(firma?.vergi_no),
      unvan: firma?.unvan || 'Firmamız',
      telefon: firma?.telefon || '',
      email: firma?.email || '',
    };
    const otherParty = {
      vkn: normalizeTaxId(cari.vergi_tc_no),
      unvan: cari.unvan,
      telefon: cari.telefon || '',
      email: cari.email || '',
    };
    const notes: string[] = ['Manuel Web Fatura Girişi'];
    if (vadeTarihi?.trim()) notes.push(`Vade Tarihi: ${vadeTarihi.trim()}`);
    if (aciklama?.trim()) notes.push(aciklama.trim());

    const snapshot: ParsedUblInvoice = {
      fileName: `manuel-${cleanNo}`,
      faturaNo: cleanNo,
      uuid: `manual-${normalizedNo}-${cleanDate}`,
      profileId: 'MANUELFATURA',
      tarih: cleanDate,
      issueTime: '',
      invoiceTypeCode: yon === 'satis' ? 'SATIS' : 'ALIS',
      currencyCode: 'TRY',
      exchangeRate: 1,
      originalAmount: cleanTutar,
      tutarTL: cleanTutar,
      supplier: yon === 'satis' ? ownParty : otherParty,
      customer: yon === 'satis' ? otherParty : ownParty,
      detectedYon: yon,
      detectionReason: 'Elle Fatura Girişi',
      notes,
      lines: [
        {
          lineId: '1',
          name: aciklama?.trim() || (yon === 'satis' ? 'Mal / Hizmet Satışı' : 'Mal / Hizmet Alımı'),
          description: aciklama?.trim() || '',
          sellerCode: '',
          quantity: 1,
          unitCode: 'C62',
          unitLabel: 'Adet',
          unitPrice: matrah,
          discountAmount: 0,
          discountRate: 0,
          kdvRate: Math.max(0, Number(kdvOrani) || 0),
          kdvAmount: kdvTutar,
          lineExtensionAmount: matrah,
        },
      ],
      totals: {
        lineExtensionAmount: matrah,
        allowanceTotalAmount: 0,
        taxExclusiveAmount: matrah,
        taxTotalAmount: kdvTutar,
        withholdingTaxAmount: 0,
        taxInclusiveAmount: cleanTutar,
        payableAmount: cleanTutar,
        taxSubtotals:
          kdvTutar > 0
            ? [{ percent: Math.max(0, Number(kdvOrani) || 0), taxableAmount: matrah, taxAmount: kdvTutar }]
            : [],
      },
    };

    try {
      await saveUblInvoiceSnapshotsAsync(firmaId, [{ yon, parsed: snapshot }]);
      await syncUblDetayToSupabase(firmaId, [{ yon, parsed: snapshot }]);
    } catch {
      // opsiyonel detay önbelleği
    }

    // 6. Opsiyonel: Kasa & Gelir-Gider defterine işle
    let kasaPosted = false;
    let kasaAd: string | undefined;
    let kasaWarning: string | undefined;

    if (syncToKasa) {
      const kasaRes = await postFaturaAsKasaHareket({
        firmaId,
        faturaNo: cleanNo,
        cariUnvan: cari.unvan,
        tutar: cleanTutar,
        tarih: cleanDate,
        tip: yon === 'satis' ? 'gelir' : 'gider',
        kasaId,
        kategori: kasaKategori,
        userId,
        knownKasalar,
      });

      if (kasaRes.posted) {
        kasaPosted = true;
        kasaAd = kasaRes.kasaAd;
      } else if (kasaRes.reason === 'kasa_table_missing') {
        kasaWarning =
          'Fatura cariye işlendi ancak Kasa / Gelir-Gider tablosu veritabanında henüz kurulmadığı için kasaya işlenemedi.';
      } else if (kasaRes.error) {
        kasaWarning = `Fatura cariye işlendi ancak kasaya işlenirken uyarı oluştu: ${kasaRes.error}`;
      }
    }

    return {
      success: true,
      fatura: inserted as Fatura,
      kasaPosted,
      kasaAd,
      kasaWarning,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: handleSupabaseError(err, 'Fatura kaydedilirken hata oluştu.', {
        isFirmaUnlimited: Boolean(firma?.sinirsiz),
      }),
    };
  }
}
