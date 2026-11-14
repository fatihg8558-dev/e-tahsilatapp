import { createClient } from '@supabase/supabase-js';
import { supabase, handleSupabaseError } from './supabase';
import { Profile } from '../types/database';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://joxnbnclogasumkfzyqt.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_PzJOpsBlvVm9MoxTx_PFkw_X66otRCQ';

/**
 * Ana hesabın aktif oturumunu (localStorage) etkilemeden
 * yeni plasiyer hesabı açmak için bağımsız, oturum saklamayan Supabase istemcisi.
 */
function createIsolatedAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export interface CreatePlasiyerParams {
  ad_soyad: string;
  email: string;
  password: string;
  telefon?: string;
  firma_id: string;
  ana_hesap_id: string;
  firma_unvan?: string;
}

export interface PlasiyerItem extends Profile {
  toplam_islem_sayisi?: number;
}

export interface CreatePlasiyerResult {
  success: boolean;
  plasiyer?: Profile;
  error?: string;
  warning?: string;
  rlsWarning?: boolean;
}

export const PLASIYER_RLS_SQL = `-- ============================================================
-- TAHSİLATIM: PLASİYER GÖRÜNÜRLÜK VE CARİ ERİŞİMİ RLS + ONARIM SQL
-- Supabase Dashboard > SQL Editor kısmına yapıştırıp RUN edin.
-- ============================================================

-- 1. Recursion önleyici güvenli yardımcı fonksiyonlar
CREATE OR REPLACE FUNCTION public.get_my_firma_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT firma_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_rol()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol::text FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- 2. Daha önce trigger yüzünden yanlış firmada 'ana' kalmış plasiyerleri onar
UPDATE public.profiles p
SET
  firma_id = (u.raw_user_meta_data->>'firma_id')::uuid,
  ana_hesap_id = NULLIF(u.raw_user_meta_data->>'ana_hesap_id', '')::uuid,
  rol = 'plasiyer'
FROM auth.users u
WHERE u.id = p.id
  AND u.raw_user_meta_data->>'rol' = 'plasiyer'
  AND NULLIF(u.raw_user_meta_data->>'firma_id', '') IS NOT NULL
  AND (
    p.firma_id IS DISTINCT FROM (u.raw_user_meta_data->>'firma_id')::uuid
    OR p.rol::text <> 'plasiyer'
  );

-- 3. Profiles tablosunda ana hesabın kendi firmasının plasiyerlerini görmesi/yönetmesi
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_same_firma_select" ON public.profiles;
CREATE POLICY "profiles_same_firma_select" ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR firma_id = public.get_my_firma_id()
    OR public.get_my_rol() = 'superadmin'
  );

DROP POLICY IF EXISTS "profiles_self_or_ana_update" ON public.profiles;
CREATE POLICY "profiles_self_or_ana_update" ON public.profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR (public.get_my_rol() = 'ana' AND firma_id = public.get_my_firma_id())
    OR public.get_my_rol() = 'superadmin'
  )
  WITH CHECK (
    id = auth.uid()
    OR (public.get_my_rol() = 'ana' AND firma_id = public.get_my_firma_id())
    OR public.get_my_rol() = 'superadmin'
  );

DROP POLICY IF EXISTS "profiles_ana_or_superadmin_delete" ON public.profiles;
CREATE POLICY "profiles_ana_or_superadmin_delete" ON public.profiles FOR DELETE
  USING (
    id = auth.uid()
    OR (public.get_my_rol() = 'ana' AND firma_id = public.get_my_firma_id())
    OR public.get_my_rol() = 'superadmin'
  );

-- 4. Firmalar ve Cariler tablosunda plasiyerin bağlı olduğu ana firmanın kayıtlarını görmesi
DROP POLICY IF EXISTS "firmalar_plasiyer_select" ON public.firmalar;
CREATE POLICY "firmalar_plasiyer_select" ON public.firmalar FOR SELECT
  USING (
    id = public.get_my_firma_id()
    OR public.get_my_rol() = 'superadmin'
  );

DROP POLICY IF EXISTS "firmalar_ana_or_superadmin_delete" ON public.firmalar;
CREATE POLICY "firmalar_ana_or_superadmin_delete" ON public.firmalar FOR DELETE
  USING (
    (public.get_my_rol() = 'ana' AND id = public.get_my_firma_id())
    OR public.get_my_rol() = 'superadmin'
  );

DROP POLICY IF EXISTS "cariler_firma_select" ON public.cariler;
CREATE POLICY "cariler_firma_select" ON public.cariler FOR SELECT
  USING (
    firma_id = public.get_my_firma_id()
    OR public.get_my_rol() = 'superadmin'
  );

DROP POLICY IF EXISTS "cariler_firma_insert" ON public.cariler;
CREATE POLICY "cariler_firma_insert" ON public.cariler FOR INSERT
  WITH CHECK (
    firma_id = public.get_my_firma_id()
    OR public.get_my_rol() = 'superadmin'
  );

DROP POLICY IF EXISTS "cariler_firma_update" ON public.cariler;
CREATE POLICY "cariler_firma_update" ON public.cariler FOR UPDATE
  USING (
    firma_id = public.get_my_firma_id()
    OR public.get_my_rol() = 'superadmin'
  );
`;

async function syncProfileWithClient(
  client: ReturnType<typeof createIsolatedAuthClient> | typeof supabase,
  payload: {
    id: string;
    firma_id: string;
    ana_hesap_id: string;
    rol: 'plasiyer';
    ad_soyad: string;
    telefon: string | null;
    email: string;
    aktif: boolean;
  }
): Promise<{ profile: Profile | null; error: unknown }> {
  // Önce UPDATE dene (trigger satırı zaten oluşturmuşsa firma_id ve rol'ü düzeltir)
  const { data: updated, error: updateErr } = await client
    .from('profiles')
    .update({
      firma_id: payload.firma_id,
      ana_hesap_id: payload.ana_hesap_id,
      rol: payload.rol,
      ad_soyad: payload.ad_soyad,
      telefon: payload.telefon,
      email: payload.email,
      aktif: payload.aktif,
    })
    .eq('id', payload.id)
    .select('*')
    .maybeSingle();

  if (
    !updateErr &&
    updated &&
    updated.firma_id === payload.firma_id &&
    updated.rol === 'plasiyer'
  ) {
    return { profile: updated as Profile, error: null };
  }

  // Trigger satır oluşturmadıysa UPSERT dene
  const { data: upserted, error: upsertErr } = await client
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .maybeSingle();

  if (
    !upsertErr &&
    upserted &&
    upserted.firma_id === payload.firma_id &&
    upserted.rol === 'plasiyer'
  ) {
    return { profile: upserted as Profile, error: null };
  }

  return { profile: null, error: upsertErr || updateErr };
}

/**
 * Ana hesap tarafından yeni bir plasiyer hesabı tanımlar veya mevcut boş hesabı plasiyer olarak bağlar.
 */
export async function createPlasiyer(
  params: CreatePlasiyerParams
): Promise<CreatePlasiyerResult> {
  const isolatedClient = createIsolatedAuthClient();

  try {
    const cleanEmail = params.email.trim().toLowerCase();
    const cleanPassword = params.password.trim();
    const cleanAdSoyad = params.ad_soyad.trim();
    const cleanTelefon = params.telefon?.trim() || null;

    if (!cleanEmail || !cleanPassword || !cleanAdSoyad) {
      return { success: false, error: 'Ad soyad, e-posta ve şifre zorunludur.' };
    }

    if (cleanPassword.length < 6) {
      return { success: false, error: 'Plasiyer şifresi en az 6 karakter olmalıdır.' };
    }

    const userMetaData = {
      ad_soyad: cleanAdSoyad,
      telefon: cleanTelefon,
      rol: 'plasiyer',
      firma_id: params.firma_id,
      ana_hesap_id: params.ana_hesap_id,
      firma_unvan: params.firma_unvan || undefined,
    };

    // 1. İzole istemci ile Supabase Auth kullanıcısı oluştur
    const { data: signUpData, error: authErr } = await isolatedClient.auth.signUp({
      email: cleanEmail,
      password: cleanPassword,
      options: {
        data: userMetaData,
      },
    });

    let userId: string | null = signUpData.user?.id || null;
    let isolatedHasSession = Boolean(signUpData.session);

    const isExistingUser =
      (authErr &&
        (authErr.message.toLowerCase().includes('already registered') ||
          authErr.message.toLowerCase().includes('already exists'))) ||
      (signUpData.user &&
        Array.isArray(signUpData.user.identities) &&
        signUpData.user.identities.length === 0);

    if (isExistingUser) {
      // Kullanıcı daha önce kayıt olmuş olabilir — verilen şifre ile izole oturum açıp kontrol et
      const { data: signInData, error: signInErr } =
        await isolatedClient.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

      if (signInErr || !signInData.user) {
        return {
          success: false,
          error:
            'Bu e-posta adresi sistemde zaten kayıtlı. Mevcut hesabın doğru şifresini girerek firmanıza plasiyer olarak bağlayabilir veya yeni bir e-posta adresi kullanabilirsiniz.',
        };
      }

      userId = signInData.user.id;
      isolatedHasSession = Boolean(signInData.session);

      // Eğer bu hesap başka bir firmada ise ve o firmada gerçek cari/işlem varsa üzerine yazma
      const { data: existingProf } = await isolatedClient
        .from('profiles')
        .select('firma_id, rol')
        .eq('id', userId)
        .maybeSingle();

      if (existingProf?.firma_id && existingProf.firma_id !== params.firma_id) {
        const [{ count: cariCount }, { count: islemCount }] = await Promise.all([
          isolatedClient
            .from('cariler')
            .select('id', { count: 'exact', head: true })
            .eq('firma_id', existingProf.firma_id),
          isolatedClient
            .from('islemler')
            .select('id', { count: 'exact', head: true })
            .eq('firma_id', existingProf.firma_id),
        ]);

        if ((cariCount || 0) > 0 || (islemCount || 0) > 0) {
          return {
            success: false,
            error:
              'Bu e-posta adresi içerisinde cari veya makbuz kayıtları bulunan başka bir aktif firmaya bağlı. Veri kaybını önlemek için plasiyerinize farklı bir e-posta adresi tanımlayınız.',
          };
        }
      }

      // Auth metadata'yı plasiyer ve doğru firma_id olarak güncelle
      await isolatedClient.auth.updateUser({
        data: userMetaData,
      });
    } else if (authErr) {
      return { success: false, error: handleSupabaseError(authErr) };
    }

    if (!userId) {
      return { success: false, error: 'Kullanıcı kaydı oluşturulamadı.' };
    }

    // DB trigger'ının (handle_new_user) bitmesini bekle ki ardından yaptığımız update'i ezmesin
    if (!isExistingUser) {
      await new Promise((r) => setTimeout(r, 450));
    }

    const profilePayload = {
      id: userId,
      firma_id: params.firma_id,
      ana_hesap_id: params.ana_hesap_id,
      rol: 'plasiyer' as const,
      ad_soyad: cleanAdSoyad,
      telefon: cleanTelefon,
      email: cleanEmail,
      aktif: true,
    };

    // 2. Önce plasiyerin kendi izole oturumuyla (auth.uid() = userId) profiles satırını güncelle
    let isolatedSaved: Profile | null = null;
    let lastWriteError: unknown = null;

    if (isolatedHasSession) {
      const res = await syncProfileWithClient(isolatedClient, profilePayload);
      isolatedSaved = res.profile;
      if (res.error) lastWriteError = res.error;
    }

    // 3. İzole oturum yoksa (ör. e-posta onayı açıksa) veya yazma başarısız olduysa ana hesap oturumuyla dene
    let anaSaved: Profile | null = null;
    if (!isolatedSaved) {
      const res = await syncProfileWithClient(supabase, profilePayload);
      anaSaved = res.profile;
      if (res.error) lastWriteError = res.error;
    }

    // 4. Ana hesap oturumuyla bu plasiyerin listede görünüp görünemediğini DOĞRULA
    const { data: verifiedByAna, error: verifyErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .eq('firma_id', params.firma_id)
      .eq('rol', 'plasiyer')
      .maybeSingle();

    if (verifiedByAna) {
      return {
        success: true,
        plasiyer: verifiedByAna as Profile,
      };
    }

    // Plasiyer kendi oturumuyla yazıldı ama ana hesap SELECT RLS yüzünden göremiyorsa
    if (isolatedSaved || anaSaved) {
      return {
        success: true,
        plasiyer: (isolatedSaved || anaSaved) as Profile,
        rlsWarning: true,
        warning:
          'Plasiyer hesabı oluşturuldu ancak Supabase veritabanı RLS politikası ana hesabın firma personellerini listelemesini veya güncellemesini kısıtlıyor olabilir. Listede görünmüyorsa aşağıdaki SQL kodunu Supabase SQL Editor’de bir kez çalıştırınız.',
      };
    }

    const errMsg = lastWriteError
      ? handleSupabaseError(lastWriteError)
      : verifyErr
      ? handleSupabaseError(verifyErr)
      : 'Plasiyer profili firmanıza bağlanamadı (Supabase profiles RLS veya e-posta onay ayarı engelliyor olabilir).';

    return {
      success: false,
      rlsWarning: true,
      error: `${errMsg} — Veritabanı tarafında plasiyer kaydı trigger tarafından farklı firmaya atanmış ve RLS güncellemeyi engellemiş olabilir. Aşağıdaki SQL kodunu Supabase SQL Editor'de bir kez çalıştırıp tekrar deneyiniz.`,
    };
  } catch (err: unknown) {
    const msg = handleSupabaseError(err, 'Plasiyer oluşturulurken bir hata oluştu.');
    return { success: false, error: msg };
  } finally {
    try {
      await isolatedClient.auth.signOut();
    } catch {
      // ignore
    }
  }
}

/**
 * Firmanın kayıtlı plasiyerlerini listeler.
 */
export async function fetchPlasiyerler(
  firmaId: string
): Promise<{ plasiyerler: PlasiyerItem[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('firma_id', firmaId)
      .eq('rol', 'plasiyer')
      .order('ad_soyad', { ascending: true });

    if (error) {
      return { plasiyerler: [], error: handleSupabaseError(error) };
    }

    const plasiyerler = (data as Profile[]) || [];

    // Her plasiyerin kestiği işlem sayısını da getir
    const { data: islemler } = await supabase
      .from('islemler')
      .select('yapan_user_id')
      .eq('firma_id', firmaId);

    const counts: Record<string, number> = {};
    if (islemler) {
      islemler.forEach((i) => {
        if (i.yapan_user_id) {
          counts[i.yapan_user_id] = (counts[i.yapan_user_id] || 0) + 1;
        }
      });
    }

    const items: PlasiyerItem[] = plasiyerler.map((p) => ({
      ...p,
      toplam_islem_sayisi: counts[p.id] || 0,
    }));

    return { plasiyerler: items };
  } catch (err: unknown) {
    return { plasiyerler: [], error: handleSupabaseError(err) };
  }
}

/**
 * Plasiyerin aktif/pasif durumunu günceller.
 */
export async function togglePlasiyerAktif(
  plasiyerId: string,
  yeniDurum: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ aktif: yeniDurum })
      .eq('id', plasiyerId);

    if (error) {
      return { success: false, error: handleSupabaseError(error) };
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: handleSupabaseError(err) };
  }
}

/**
 * Plasiyer hesabını firmadan ve profiles tablosundan kalıcı olarak siler.
 * Önce ilişkili işlem/gelir-gider kayıtlarındaki yapan_user_id referansını güvenli şekilde ayırır.
 */
export async function deletePlasiyer(
  plasiyerId: string,
  anaHesapId?: string | null
): Promise<{ success: boolean; error?: string; rlsWarning?: boolean }> {
  try {
    // FK ihlali olmaması için yapan_user_id referanslarını ana hesaba veya null'a çek
    await supabase
      .from('islemler')
      .update({ yapan_user_id: anaHesapId || null })
      .eq('yapan_user_id', plasiyerId);

    await supabase
      .from('gelir_giderler')
      .update({ yapan_user_id: anaHesapId || null })
      .eq('yapan_user_id', plasiyerId);

    const { error } = await supabase
      .from('profiles')
      .delete()
      .eq('id', plasiyerId);

    if (error) {
      const msg = handleSupabaseError(error, 'Plasiyer hesabı silinemedi.');
      const lower = msg.toLowerCase();
      return {
        success: false,
        error: msg,
        rlsWarning: lower.includes('rls') || lower.includes('row-level') || lower.includes('yetki'),
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: handleSupabaseError(err, 'Plasiyer silinirken hata oluştu.') };
  }
}
