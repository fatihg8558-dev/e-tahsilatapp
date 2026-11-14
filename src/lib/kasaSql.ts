export const GELIR_KATEGORILERI = [
  'Peşin Satış',
  'Hizmet Geliri',
  'Faiz / Nemalandırma',
  'Kira Geliri',
  'Kur Farkı Geliri',
  'Ortak Sermaye Girişi',
  'Diğer Gelir',
];

export const GIDER_KATEGORILERI = [
  'Kira',
  'Maaş & Personel',
  'Elektrik / Su / Doğalgaz',
  'İnternet & Telefon',
  'Yakıt & Ulaşım',
  'Yemek & İkram',
  'Vergi & SGK',
  'Kargo & Nakliye',
  'Bakım & Onarım',
  'Reklam & Pazarlama',
  'Kırtasiye & Ofis',
  'Banka Masrafı',
  'Diğer Gider',
];

export const KASA_TUR_LABELS: Record<'nakit' | 'banka' | 'pos', string> = {
  nakit: 'Nakit Kasa',
  banka: 'Banka Hesabı',
  pos: 'POS / Kredi Kartı',
};

export function isMissingKasaTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; details?: string; hint?: string };
  const msg = `${e.message || ''} ${e.details || ''} ${e.hint || ''}`.toLowerCase();
  return (
    e.code === '42P01' ||
    e.code === 'PGRST205' ||
    msg.includes('kasalar') && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found')) ||
    msg.includes('gelir_giderler') && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found'))
  );
}

export const KASA_SETUP_SQL = `-- ============================================================
-- TAHSİLATIM: KASA & GELİR-GİDER TAKİBİ MODÜLÜ SQL KURULUMU
-- Supabase Dashboard > SQL Editor kısmına yapıştırıp RUN edin.
-- ============================================================

-- 1. KASALAR & BANKA / POS HESAPLARI TABLOSU
CREATE TABLE IF NOT EXISTS public.kasalar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  ad TEXT NOT NULL,
  tur TEXT NOT NULL CHECK (tur IN ('nakit', 'banka', 'pos')),
  banka_adi TEXT,
  iban TEXT,
  acilis_bakiyesi NUMERIC(14,2) NOT NULL DEFAULT 0,
  guncel_bakiye NUMERIC(14,2) NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kasalar_firma_id ON public.kasalar(firma_id);

-- 2. ŞİRKET İÇİ GELİR / GİDER / VİRMAN KAYITLARI TABLOSU
CREATE TABLE IF NOT EXISTS public.gelir_giderler (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id UUID NOT NULL REFERENCES public.firmalar(id) ON DELETE CASCADE,
  kasa_id UUID NOT NULL REFERENCES public.kasalar(id) ON DELETE RESTRICT,
  hedef_kasa_id UUID REFERENCES public.kasalar(id) ON DELETE RESTRICT,
  tip TEXT NOT NULL CHECK (tip IN ('gelir', 'gider', 'virman')),
  kategori TEXT NOT NULL,
  tutar NUMERIC(14,2) NOT NULL CHECK (tutar > 0),
  tarih DATE NOT NULL DEFAULT CURRENT_DATE,
  aciklama TEXT,
  belge_no TEXT,
  yapan_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gelir_giderler_firma_tarih ON public.gelir_giderler(firma_id, tarih DESC);
CREATE INDEX IF NOT EXISTS idx_gelir_giderler_kasa_id ON public.gelir_giderler(kasa_id);

-- 3. OTOMATİK KASA BAKİYESİ GÜNCELLEME TRİGGER'I
CREATE OR REPLACE FUNCTION public.fn_gelir_gider_kasa_bakiye()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    IF NEW.tip = 'gelir' THEN
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye + NEW.tutar WHERE id = NEW.kasa_id;
    ELSIF NEW.tip = 'gider' THEN
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye - NEW.tutar WHERE id = NEW.kasa_id;
    ELSIF NEW.tip = 'virman' AND NEW.hedef_kasa_id IS NOT NULL THEN
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye - NEW.tutar WHERE id = NEW.kasa_id;
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye + NEW.tutar WHERE id = NEW.hedef_kasa_id;
    END IF;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    IF OLD.tip = 'gelir' THEN
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye - OLD.tutar WHERE id = OLD.kasa_id;
    ELSIF OLD.tip = 'gider' THEN
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye + OLD.tutar WHERE id = OLD.kasa_id;
    ELSIF OLD.tip = 'virman' AND OLD.hedef_kasa_id IS NOT NULL THEN
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye + OLD.tutar WHERE id = OLD.kasa_id;
      UPDATE public.kasalar SET guncel_bakiye = guncel_bakiye - OLD.tutar WHERE id = OLD.hedef_kasa_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gelir_gider_kasa_bakiye ON public.gelir_giderler;
CREATE TRIGGER trg_gelir_gider_kasa_bakiye
AFTER INSERT OR DELETE ON public.gelir_giderler
FOR EACH ROW EXECUTE FUNCTION public.fn_gelir_gider_kasa_bakiye();

-- 4. RLS (ROW LEVEL SECURITY) POLİTİKALARI
ALTER TABLE public.kasalar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gelir_giderler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kasalar_firma_select" ON public.kasalar;
CREATE POLICY "kasalar_firma_select" ON public.kasalar FOR SELECT
  USING (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "kasalar_firma_insert" ON public.kasalar;
CREATE POLICY "kasalar_firma_insert" ON public.kasalar FOR INSERT
  WITH CHECK (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "kasalar_firma_update" ON public.kasalar;
CREATE POLICY "kasalar_firma_update" ON public.kasalar FOR UPDATE
  USING (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "kasalar_firma_delete" ON public.kasalar;
CREATE POLICY "kasalar_firma_delete" ON public.kasalar FOR DELETE
  USING (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "gelir_giderler_firma_select" ON public.gelir_giderler;
CREATE POLICY "gelir_giderler_firma_select" ON public.gelir_giderler FOR SELECT
  USING (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "gelir_giderler_firma_insert" ON public.gelir_giderler;
CREATE POLICY "gelir_giderler_firma_insert" ON public.gelir_giderler FOR INSERT
  WITH CHECK (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "gelir_giderler_firma_update" ON public.gelir_giderler;
CREATE POLICY "gelir_giderler_firma_update" ON public.gelir_giderler FOR UPDATE
  USING (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "gelir_giderler_firma_delete" ON public.gelir_giderler;
CREATE POLICY "gelir_giderler_firma_delete" ON public.gelir_giderler FOR DELETE
  USING (firma_id IN (SELECT p.firma_id FROM public.profiles p WHERE p.id = auth.uid()));
`;
