import { supabase } from './supabase';
import { Cari, Firma } from '../types/database';
import { formatCurrency, formatDate } from './formatters';
import { PosConfig, resolvePaymentLinkBaseUrl } from './posService';

export type MutabakatDurum = 'bekliyor' | 'mutabik' | 'itiraz';

export interface MutabakatSummaryItem {
  tarih: string;
  tip: string;
  belgeNo: string;
  aciklama?: string;
  borc: number;
  alacak: number;
}

export interface CariMutabakatRecord {
  id: string;
  mutabakat_kodu: string;
  firma_id: string;
  firma_unvan: string;
  firma_vergi_no?: string | null;
  firma_telefon?: string | null;
  cari_id: string;
  cari_unvan: string;
  cari_vergi_no?: string | null;
  mutabakat_tarihi: string;
  donem_baslik?: string | null;
  bakiye: number; // + => Cari borçlu (Bize borçlu), - => Cari alacaklı (Bizden alacaklı)
  fatura_sayisi: number;
  islem_sayisi: number;
  ozet_kalemler?: MutabakatSummaryItem[] | null;
  durum: MutabakatDurum;
  cevaplayan_ad?: string | null;
  itiraz_tutari?: number | null;
  itiraz_notu?: string | null;
  cevap_tarihi?: string | null;
  created_at?: string;
}

export const CARI_MUTABAKAT_SQL_SNIPPET = `-- Online Cari Hesap Mutabakatı & Cevap Linki Tablosu (Supabase SQL Editor)
CREATE TABLE IF NOT EXISTS public.cari_mutabakatlar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mutabakat_kodu text UNIQUE NOT NULL,
  firma_id uuid NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  firma_unvan text NOT NULL,
  firma_vergi_no text,
  firma_telefon text,
  cari_id uuid NOT NULL REFERENCES public.cariler(id) ON DELETE CASCADE,
  cari_unvan text NOT NULL,
  cari_vergi_no text,
  mutabakat_tarihi date NOT NULL,
  donem_baslik text,
  bakiye numeric(14,2) NOT NULL DEFAULT 0,
  fatura_sayisi integer NOT NULL DEFAULT 0,
  islem_sayisi integer NOT NULL DEFAULT 0,
  ozet_kalemler jsonb,
  durum text NOT NULL DEFAULT 'bekliyor',
  cevaplayan_ad text,
  itiraz_tutari numeric(14,2),
  itiraz_notu text,
  cevap_tarihi timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cari_mutabakatlar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Herkes mutabakat linkini okuyabilir" ON public.cari_mutabakatlar;
CREATE POLICY "Herkes mutabakat linkini okuyabilir"
  ON public.cari_mutabakatlar FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Firma yetkilisi mutabakat oluşturabilir" ON public.cari_mutabakatlar;
CREATE POLICY "Firma yetkilisi mutabakat oluşturabilir"
  ON public.cari_mutabakatlar FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.firma_id = cari_mutabakatlar.firma_id AND p.aktif = true)
          OR p.rol = 'superadmin'
          OR lower(p.email) = 'conqueror58@gmail.com'
        )
    )
  );

DROP POLICY IF EXISTS "Karşı taraf bekleyen mutabakata cevap verebilir" ON public.cari_mutabakatlar;
CREATE POLICY "Karşı taraf bekleyen mutabakata cevap verebilir"
  ON public.cari_mutabakatlar FOR UPDATE
  TO anon, authenticated
  USING (durum = 'bekliyor')
  WITH CHECK (durum IN ('mutabik', 'itiraz'));`;

export function createMutabakatCode(): string {
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  const randPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `MTB-${timePart}${randPart}`;
}

export function parseMutabakatCodeFromSearch(search: string): string | null {
  try {
    const query = new URLSearchParams(search || '');
    const code = (query.get('mutabakat') || '').trim();
    return code || null;
  } catch {
    return null;
  }
}

export function buildMutabakatPublicUrl(
  mutabakatKodu: string,
  posConfig?: PosConfig | null,
  explicitBaseUrl?: string
): string {
  const resolved = explicitBaseUrl?.trim()
    ? explicitBaseUrl.trim().replace(/\/+$/, '')
    : resolvePaymentLinkBaseUrl(posConfig).baseUrl;
  return `${resolved}/?mutabakat=${encodeURIComponent(mutabakatKodu.trim())}`;
}

export function describeMutabakatBalance(bakiye: number): {
  yonLabel: string;
  summaryText: string;
  absAmount: number;
} {
  const clean = Math.round((Number(bakiye) || 0) * 100) / 100;
  const absAmount = Math.abs(clean);
  if (absAmount < 0.01) {
    return {
      yonLabel: 'Sıfır Bakiye (Mutabık)',
      summaryText: 'bakiyesi sıfır (0,00 ₺)',
      absAmount: 0,
    };
  }
  if (clean > 0) {
    return {
      yonLabel: 'Borç Bakiyeniz (Firmamıza Borcunuz)',
      summaryText: `${formatCurrency(absAmount)} BORÇ bakiyesi`,
      absAmount,
    };
  }
  return {
    yonLabel: 'Alacak Bakiyeniz (Firmamızdan Alacağınız)',
    summaryText: `${formatCurrency(absAmount)} ALACAK bakiyesi`,
    absAmount,
  };
}

export function buildMutabakatWhatsAppMessage(params: {
  firmaUnvan?: string | null;
  cariUnvan?: string | null;
  mutabakatTarihi: string;
  bakiye: number;
  mutabakatUrl: string;
  mutabakatKodu: string;
  donemBaslik?: string | null;
}): string {
  const {
    firmaUnvan,
    cariUnvan,
    mutabakatTarihi,
    bakiye,
    mutabakatUrl,
    mutabakatKodu,
    donemBaslik,
  } = params;

  const musteri = cariUnvan?.trim() || 'Değerli İş Ortağımız';
  const gonderen = firmaUnvan?.trim() || 'Firmamız';
  const tarihText = formatDate(mutabakatTarihi);
  const { summaryText } = describeMutabakatBalance(bakiye);

  return [
    `Sayın ${musteri},`,
    '',
    `${donemBaslik ? `${donemBaslik} — ` : ''}${tarihText} tarihi itibarıyla cari hesabınızda ${summaryText} görünmektedir.`,
    `Mutabakat No: ${mutabakatKodu}`,
    '',
    'Aşağıdaki bağlantıya tıklayarak tek tıkla "Mutabıkım" onayı verebilir veya fark varsa itiraz notunuzu iletebilirsiniz:',
    mutabakatUrl,
    '',
    'Saygılarımızla,',
    gonderen,
  ].join('\n');
}

export function isMissingMutabakatTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string; message?: string; details?: string };
  const code = String(rec.code || '');
  const msg = `${rec.message || ''} ${rec.details || ''}`.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('cari_mutabakatlar') ||
    msg.includes('schema cache') ||
    msg.includes('does not exist')
  );
}

export async function createCloudMutabakatRecord(params: {
  firma: Pick<Firma, 'id' | 'unvan' | 'vergi_no' | 'telefon'>;
  cari: Pick<Cari, 'id' | 'unvan' | 'vergi_tc_no'>;
  mutabakatTarihi: string;
  donemBaslik?: string;
  bakiye: number;
  faturaSayisi: number;
  islemSayisi: number;
  ozetKalemler?: MutabakatSummaryItem[];
}): Promise<{
  record?: CariMutabakatRecord;
  missingTable?: boolean;
  error?: string;
}> {
  const {
    firma,
    cari,
    mutabakatTarihi,
    donemBaslik,
    bakiye,
    faturaSayisi,
    islemSayisi,
    ozetKalemler,
  } = params;

  const mutabakatKodu = createMutabakatCode();
  const cleanBakiye = Math.round((Number(bakiye) || 0) * 100) / 100;

  const payload = {
    mutabakat_kodu: mutabakatKodu,
    firma_id: firma.id,
    firma_unvan: firma.unvan || 'Firmamız',
    firma_vergi_no: firma.vergi_no || null,
    firma_telefon: firma.telefon || null,
    cari_id: cari.id,
    cari_unvan: cari.unvan,
    cari_vergi_no: cari.vergi_tc_no || null,
    mutabakat_tarihi: (mutabakatTarihi || '').slice(0, 10),
    donem_baslik: donemBaslik?.trim() || null,
    bakiye: Object.is(cleanBakiye, -0) ? 0 : cleanBakiye,
    fatura_sayisi: faturaSayisi,
    islem_sayisi: islemSayisi,
    ozet_kalemler: (ozetKalemler || []).slice(0, 15),
    durum: 'bekliyor' as MutabakatDurum,
  };

  try {
    const { data, error } = await supabase
      .from('cari_mutabakatlar')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (isMissingMutabakatTableError(error)) {
        return { missingTable: true, error: 'cari_mutabakatlar tablosu veritabanında henüz kurulmamış.' };
      }
      return { error: error.message || 'Mutabakat kaydı oluşturulamadı.' };
    }

    return { record: data as CariMutabakatRecord };
  } catch (err: unknown) {
    if (isMissingMutabakatTableError(err)) {
      return { missingTable: true, error: 'cari_mutabakatlar tablosu veritabanında henüz kurulmamış.' };
    }
    return {
      error: err instanceof Error ? err.message : 'Mutabakat kaydı oluşturulamadı.',
    };
  }
}

export async function fetchMutabakatByCode(
  mutabakatKodu: string
): Promise<{ record: CariMutabakatRecord | null; missingTable?: boolean; error?: string }> {
  const clean = (mutabakatKodu || '').trim();
  if (!clean) return { record: null };

  try {
    const { data, error } = await supabase
      .from('cari_mutabakatlar')
      .select('*')
      .eq('mutabakat_kodu', clean)
      .maybeSingle();

    if (error) {
      if (isMissingMutabakatTableError(error)) {
        return { record: null, missingTable: true };
      }
      return { record: null, error: error.message };
    }

    return { record: (data as CariMutabakatRecord) || null };
  } catch {
    return { record: null };
  }
}

export async function fetchMutabakatHistoryForCari(
  firmaId: string,
  cariId: string
): Promise<{ records: CariMutabakatRecord[]; missingTable?: boolean }> {
  if (!firmaId || !cariId) return { records: [] };

  try {
    const { data, error } = await supabase
      .from('cari_mutabakatlar')
      .select('*')
      .eq('firma_id', firmaId)
      .eq('cari_id', cariId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      if (isMissingMutabakatTableError(error)) {
        return { records: [], missingTable: true };
      }
      return { records: [] };
    }

    return { records: (data as CariMutabakatRecord[]) || [] };
  } catch {
    return { records: [] };
  }
}

export async function submitCounterpartyMutabakatResponse(params: {
  mutabakatKodu: string;
  durum: Extract<MutabakatDurum, 'mutabik' | 'itiraz'>;
  cevaplayanAd: string;
  itirazTutari?: number | null;
  itirazNotu?: string;
}): Promise<{ ok: boolean; record?: CariMutabakatRecord; error?: string }> {
  const { mutabakatKodu, durum, cevaplayanAd, itirazTutari, itirazNotu } = params;
  const cleanCode = (mutabakatKodu || '').trim();
  const cleanName = (cevaplayanAd || '').trim();

  if (!cleanCode) return { ok: false, error: 'Mutabakat kodu eksik.' };
  if (!cleanName) return { ok: false, error: 'Lütfen adınızı ve soyadınızı veya ünvanınızı giriniz.' };
  if (durum === 'itiraz' && !(itirazNotu || '').trim()) {
    return { ok: false, error: 'Lütfen itiraz veya fark açıklamanızı kısaca yazınız.' };
  }

  const nowIso = new Date().toISOString();
  const cleanItirazTutar =
    durum === 'itiraz' && itirazTutari !== undefined && itirazTutari !== null && Number.isFinite(itirazTutari)
      ? Math.round(Number(itirazTutari) * 100) / 100
      : null;

  try {
    const { data, error } = await supabase
      .from('cari_mutabakatlar')
      .update({
        durum,
        cevaplayan_ad: cleanName,
        itiraz_tutari: cleanItirazTutar,
        itiraz_notu: durum === 'itiraz' ? (itirazNotu || '').trim() : null,
        cevap_tarihi: nowIso,
      })
      .eq('mutabakat_kodu', cleanCode)
      .eq('durum', 'bekliyor')
      .select('*')
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message || 'Mutabakat cevabı kaydedilemedi.' };
    }

    if (!data) {
      return {
        ok: false,
        error: 'Bu mutabakat kaydı daha önce cevaplanmış veya bulunamadı.',
      };
    }

    return { ok: true, record: data as CariMutabakatRecord };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Mutabakat cevabı gönderilemedi.',
    };
  }
}

export type MutabakatStatusFilter = 'all' | 'itiraz' | 'mutabik' | 'bekliyor';

export interface MutabakatStats {
  total: number;
  itirazCount: number;
  mutabikCount: number;
  bekliyorCount: number;
  totalItirazDiscrepancy: number;
}

export async function fetchAllMutabakatlarForFirma(
  firmaId: string,
  limitCount: number = 250
): Promise<{ records: CariMutabakatRecord[]; missingTable?: boolean; error?: string }> {
  if (!firmaId) return { records: [] };

  try {
    const { data, error } = await supabase
      .from('cari_mutabakatlar')
      .select('*')
      .eq('firma_id', firmaId)
      .order('created_at', { ascending: false })
      .limit(limitCount);

    if (error) {
      if (isMissingMutabakatTableError(error)) {
        return { records: [], missingTable: true };
      }
      return { records: [], error: error.message };
    }

    return { records: (data as CariMutabakatRecord[]) || [] };
  } catch (err: unknown) {
    return {
      records: [],
      error: err instanceof Error ? err.message : 'Mutabakat kayıtları yüklenemedi.',
    };
  }
}

export function computeItirazDiscrepancy(
  record: Pick<CariMutabakatRecord, 'bakiye' | 'itiraz_tutari'>
): number | null {
  if (record.itiraz_tutari === null || record.itiraz_tutari === undefined) return null;
  const rawItiraz = Number(record.itiraz_tutari);
  if (!Number.isFinite(rawItiraz)) return null;
  const oursAbs = Math.abs(Number(record.bakiye) || 0);
  const diff = Math.round((rawItiraz - oursAbs) * 100) / 100;
  return Object.is(diff, -0) ? 0 : diff;
}

export function computeMutabakatStats(records: CariMutabakatRecord[]): MutabakatStats {
  let itirazCount = 0;
  let mutabikCount = 0;
  let bekliyorCount = 0;
  let totalItirazDiscrepancy = 0;

  for (const rec of records) {
    if (rec.durum === 'itiraz') {
      itirazCount += 1;
      const diff = computeItirazDiscrepancy(rec);
      if (diff !== null) {
        totalItirazDiscrepancy += Math.abs(diff);
      }
    } else if (rec.durum === 'mutabik') {
      mutabikCount += 1;
    } else {
      bekliyorCount += 1;
    }
  }

  return {
    total: records.length,
    itirazCount,
    mutabikCount,
    bekliyorCount,
    totalItirazDiscrepancy: Math.round(totalItirazDiscrepancy * 100) / 100,
  };
}

export function filterMutabakatRecords(
  records: CariMutabakatRecord[],
  statusFilter: MutabakatStatusFilter,
  searchQuery: string = ''
): CariMutabakatRecord[] {
  const q = (searchQuery || '').trim().toLocaleLowerCase('tr-TR');

  return records.filter((rec) => {
    if (statusFilter !== 'all' && rec.durum !== statusFilter) {
      return false;
    }
    if (!q) return true;
    const haystack = [
      rec.cari_unvan,
      rec.mutabakat_kodu,
      rec.donem_baslik,
      rec.cevaplayan_ad,
      rec.itiraz_notu,
      rec.cari_vergi_no,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('tr-TR');
    return haystack.includes(q);
  });
}

