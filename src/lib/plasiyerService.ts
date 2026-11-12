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
}

export interface PlasiyerItem extends Profile {
  toplam_islem_sayisi?: number;
}

/**
 * Ana hesap tarafından yeni bir plasiyer hesabı tanımlar.
 */
export async function createPlasiyer(
  params: CreatePlasiyerParams
): Promise<{ success: boolean; plasiyer?: Profile; error?: string }> {
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

    // 1. İzole istemci ile Supabase Auth kullanıcısı oluştur
    const isolatedClient = createIsolatedAuthClient();
    const { data: authData, error: authErr } = await isolatedClient.auth.signUp({
      email: cleanEmail,
      password: cleanPassword,
      options: {
        data: {
          ad_soyad: cleanAdSoyad,
          telefon: cleanTelefon,
          rol: 'plasiyer',
          firma_id: params.firma_id,
          ana_hesap_id: params.ana_hesap_id,
        },
      },
    });

    if (authErr) {
      return { success: false, error: handleSupabaseError(authErr) };
    }

    if (!authData.user) {
      return { success: false, error: 'Kullanıcı kaydı oluşturulamadı.' };
    }

    const userId = authData.user.id;

    // 2. Ana hesabın yetkili oturumuyla profiles tablosuna plasiyer kaydını garantiye al
    const profilePayload: Partial<Profile> = {
      id: userId,
      firma_id: params.firma_id,
      ana_hesap_id: params.ana_hesap_id,
      rol: 'plasiyer',
      ad_soyad: cleanAdSoyad,
      telefon: cleanTelefon,
      email: cleanEmail,
      aktif: true,
    };

    const { data: savedProfile, error: profileErr } = await supabase
      .from('profiles')
      .upsert(profilePayload)
      .select()
      .maybeSingle();

    if (profileErr) {
      console.warn('Profile upsert warning:', profileErr);
      // Trigger zaten oluşturmuş olabilir, çekmeyi dene
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (existingProfile) {
        return { success: true, plasiyer: existingProfile as Profile };
      }
    }

    return {
      success: true,
      plasiyer: (savedProfile as Profile) || (profilePayload as Profile),
    };
  } catch (err: unknown) {
    const msg = handleSupabaseError(err, 'Plasiyer oluşturulurken bir hata oluştu.');
    return { success: false, error: msg };
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
