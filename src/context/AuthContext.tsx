import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { isAnaHesapForeignKeyError } from '../lib/plasiyerService';
import { Profile, Firma, Paket, Ayar } from '../types/database';
import {
  FIRMA_EK_PLASIYER_AYAR_KEY,
  PackageEntitlements,
  parseFirmaEkPlasiyerMapFromAyarlar,
  resolvePackageEntitlements,
} from '../lib/packageEntitlements';

export type PeriodStatus = 'active_trial' | 'active_package' | 'unlimited' | 'expired';

interface PeriodInfo {
  isExpired: boolean;
  status: PeriodStatus;
  kalanGun: number;
  bitisTarihi: string | null;
}

export const SUPER_ADMIN_EMAIL = 'conqueror58@gmail.com';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  firma: Firma | null;
  activePaket: Paket | null;
  entitlements: PackageEntitlements;
  loading: boolean;
  error: string | null;
  isSuperAdmin: boolean;
  isPeriodExpired: boolean;
  periodInfo: PeriodInfo;
  signIn: (email: string, pass: string) => Promise<{ error?: string }>;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signInWithApple: () => Promise<{ error?: string }>;
  signUp: (data: {
    unvan: string;
    vergi_no: string;
    ad_soyad: string;
    telefon: string;
    email: string;
    pass: string;
  }) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfileAndFirma: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// LocalStorage önbellek yardımcıları
const getCachedData = <T,>(key: string): T | null => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch {
    return null;
  }
};

const setCachedData = (key: string, data: any) => {
  try {
    if (data) {
      localStorage.setItem(key, JSON.stringify(data));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cachedUser = getCachedData<User>('tahsilatim_user');
  const cachedProfile = getCachedData<Profile>('tahsilatim_profile');
  const cachedFirma = getCachedData<Firma>('tahsilatim_firma');
  const cachedActivePaket = getCachedData<Paket>('tahsilatim_active_paket');
  const cachedEkPlasiyer = getCachedData<{ firmaId: string; count: number }>('tahsilatim_ek_plasiyer');

  const [user, setUser] = useState<User | null>(cachedUser);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [firma, setFirma] = useState<Firma | null>(cachedFirma);
  const [activePaket, setActivePaket] = useState<Paket | null>(cachedActivePaket);
  const [ekPlasiyerFallback, setEkPlasiyerFallback] = useState<number>(
    cachedFirma && cachedEkPlasiyer?.firmaId === cachedFirma.id ? cachedEkPlasiyer.count : 0
  );
  // Önbellekte profil varsa bekleme yapmadan hemen aç
  const [loading, setLoading] = useState<boolean>(!cachedProfile && !cachedUser);
  const [error, setError] = useState<string | null>(null);

  // Süre ve abonelik hesaplayıcı (Yalnızca veritabanındaki gerçek firma değerlerine göre hesaplanır)
  const calculatePeriodInfo = (
    f: Firma | null,
    _p: Profile | null,
    u: User | null
  ): PeriodInfo => {
    const userEmail = (u?.email || _p?.email || '').trim().toLowerCase();
    // Sadece gerçek firma.sinirsiz === true veya ana Süper Admin hesabı (kilitlenmemesi için)
    if (f?.sinirsiz === true || userEmail === SUPER_ADMIN_EMAIL) {
      return { isExpired: false, status: 'unlimited', kalanGun: 9999, bitisTarihi: null };
    }

    if (!f) {
      return { isExpired: false, status: 'active_trial', kalanGun: 7, bitisTarihi: null };
    }

    const now = Date.now();
    const oneDayMs = 1000 * 60 * 60 * 24;

    // 1. Paket süresi kontrolü
    if (f.paket_bitis) {
      const paketDate = new Date(f.paket_bitis);
      if (f.paket_bitis.length <= 10) paketDate.setHours(23, 59, 59, 999);
      const paketBitisMs = paketDate.getTime();
      if (paketBitisMs >= now) {
        const kalan = Math.max(1, Math.ceil((paketBitisMs - now) / oneDayMs));
        return {
          isExpired: false,
          status: 'active_package',
          kalanGun: kalan,
          bitisTarihi: f.paket_bitis,
        };
      }
    }

    // 2. Deneme süresi kontrolü
    if (f.deneme_bitis) {
      const denemeDate = new Date(f.deneme_bitis);
      if (f.deneme_bitis.length <= 10) denemeDate.setHours(23, 59, 59, 999);
      const denemeBitisMs = denemeDate.getTime();
      if (denemeBitisMs >= now) {
        const kalan = Math.max(1, Math.ceil((denemeBitisMs - now) / oneDayMs));
        return {
          isExpired: false,
          status: 'active_trial',
          kalanGun: kalan,
          bitisTarihi: f.deneme_bitis,
        };
      }
    }

    // Hem paket hem de deneme süresi geçmişse: Kilitli
    return {
      isExpired: true,
      status: 'expired',
      kalanGun: 0,
      bitisTarihi: f.paket_bitis || f.deneme_bitis || null,
    };
  };

  // Profil ve Firma Verilerini Çekme (Yeniden deneme destekli)
  const fetchProfileAndFirma = useCallback(
    async (userId: string, retries: number = 3): Promise<void> => {
      try {
        setError(null);

        // 1. Profil çek (profiles tablosu)
        let profileData: Profile | null = null;
        let profileErr: any = null;

        for (let i = 0; i < retries; i++) {
          const res = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

          profileData = res.data as Profile | null;
          profileErr = res.error;

          if (profileData) break;
          // Trigger profil oluşturana kadar kısa bekleme
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }

        if (profileErr) {
          throw profileErr;
        }

        // Auth metadata'yı çek (plasiyer kurtarma / süperadmin kontrolü için)
        const { data: authUserData } = await supabase.auth.getUser();
        const authUserMeta = authUserData?.user?.user_metadata;
        const authEmail = (authUserData?.user?.email || '').trim().toLowerCase();

        if (!profileData) {
          if (authUserMeta?.firma_id) {
            const recoveredPayload: Partial<Profile> = {
              id: userId,
              firma_id: authUserMeta.firma_id,
              ana_hesap_id: authUserMeta.ana_hesap_id || null,
              rol: authUserMeta.rol || 'plasiyer',
              ad_soyad: authUserMeta.ad_soyad || authEmail || 'Plasiyer',
              telefon: authUserMeta.telefon || null,
              email: authEmail,
              aktif: true,
            };
            let { data: createdProf, error: recoverErr } = await supabase
              .from('profiles')
              .upsert(recoveredPayload, { onConflict: 'id' })
              .select('*')
              .maybeSingle();

            if (!createdProf && recoveredPayload.ana_hesap_id && isAnaHesapForeignKeyError(recoverErr)) {
              const fallbackPayload = { ...recoveredPayload, ana_hesap_id: null };
              const retryRes = await supabase
                .from('profiles')
                .upsert(fallbackPayload, { onConflict: 'id' })
                .select('*')
                .maybeSingle();
              createdProf = retryRes.data;
              recoveredPayload.ana_hesap_id = null;
            }
            profileData = (createdProf as Profile) || (recoveredPayload as Profile);
          } else {
            setProfile(null);
            setFirma(null);
            setActivePaket(null);
            setEkPlasiyerFallback(0);
            setCachedData('tahsilatim_profile', null);
            setCachedData('tahsilatim_firma', null);
            setCachedData('tahsilatim_active_paket', null);
            setCachedData('tahsilatim_ek_plasiyer', null);
            return;
          }
        }

        // Kural: profiles.aktif === false olan kullanıcıyı çıkış yaptır, "Hesabınız pasif" göster.
        if (profileData.aktif === false) {
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          setProfile(null);
          setFirma(null);
          setActivePaket(null);
          setEkPlasiyerFallback(0);
          setCachedData('tahsilatim_user', null);
          setCachedData('tahsilatim_profile', null);
          setCachedData('tahsilatim_firma', null);
          setCachedData('tahsilatim_active_paket', null);
          setCachedData('tahsilatim_ek_plasiyer', null);
          setError('Hesabınız pasif durumdadır. Lütfen şirket yöneticiniz ile iletişime geçiniz.');
          return;
        }

        // Plasiyer profilinde firma_id/rol eksikse veya trigger yanlış firmaya 'ana' açtıysa metadata'dan kurtar
        const metaFirmaId = authUserMeta?.firma_id as string | undefined;
        const metaRol = authUserMeta?.rol;
        const metaAnaHesapId = authUserMeta?.ana_hesap_id as string | undefined;
        const metaAdSoyad = authUserMeta?.ad_soyad as string | undefined;
        const metaTelefon = authUserMeta?.telefon as string | undefined;

        const isPlasiyerMetaMismatch =
          metaRol === 'plasiyer' &&
          !!metaFirmaId &&
          (profileData.firma_id !== metaFirmaId || profileData.rol !== 'plasiyer');

        if (
          profileData &&
          (!profileData.firma_id || profileData.rol === 'plasiyer' || isPlasiyerMetaMismatch)
        ) {
          let needsUpdate = false;
          const updates: Partial<Profile> = {};

          if (metaFirmaId && profileData.firma_id !== metaFirmaId) {
            updates.firma_id = metaFirmaId;
            profileData.firma_id = metaFirmaId;
            needsUpdate = true;
          }
          if (
            metaRol &&
            profileData.rol !== metaRol &&
            (!profileData.rol || isPlasiyerMetaMismatch)
          ) {
            updates.rol = metaRol;
            profileData.rol = metaRol;
            needsUpdate = true;
          }
          if (metaAnaHesapId && profileData.ana_hesap_id !== metaAnaHesapId) {
            updates.ana_hesap_id = metaAnaHesapId;
            profileData.ana_hesap_id = metaAnaHesapId;
            needsUpdate = true;
          }
          if (metaAdSoyad && !profileData.ad_soyad) {
            updates.ad_soyad = metaAdSoyad;
            profileData.ad_soyad = metaAdSoyad;
            needsUpdate = true;
          }
          if (metaTelefon && !profileData.telefon) {
            updates.telefon = metaTelefon;
            profileData.telefon = metaTelefon;
            needsUpdate = true;
          }

          if (needsUpdate) {
            let { error: healErr } = await supabase
              .from('profiles')
              .update(updates)
              .eq('id', profileData.id);

            if (healErr && updates.ana_hesap_id && isAnaHesapForeignKeyError(healErr)) {
              const safeUpdates = { ...updates, ana_hesap_id: null };
              profileData.ana_hesap_id = null;
              const retryHeal = await supabase
                .from('profiles')
                .update(safeUpdates)
                .eq('id', profileData.id);
              healErr = retryHeal.error;
            }

            if (healErr) {
              console.warn('Profile self-heal warning:', healErr);
            }
          }
        }

        // Süper Admin kontrolü: yalnızca conqueror58@gmail.com otomatik süper admin olur (veya DB'de rol='superadmin' atanmış hesaplar)
        const profileEmail = (profileData.email || '').trim().toLowerCase();
        const isDesignatedSuperAdmin =
          authEmail === SUPER_ADMIN_EMAIL || profileEmail === SUPER_ADMIN_EMAIL;
        const isSuperAdminAccount = isDesignatedSuperAdmin || profileData.rol === 'superadmin';

        if (isDesignatedSuperAdmin && profileData.rol !== 'superadmin') {
          profileData.rol = 'superadmin';
          supabase
            .from('profiles')
            .update({ rol: 'superadmin' })
            .eq('id', profileData.id)
            .then(() => {}, () => {});
        }

        setProfile(profileData);
        setCachedData('tahsilatim_profile', profileData);

        // 2. Firma çek (firmalar tablosu)
        const fallbackAnaId = profileData.ana_hesap_id || (authUserMeta?.ana_hesap_id as string | undefined);
        if (!profileData.firma_id && fallbackAnaId) {
          const { data: anaProfile } = await supabase
            .from('profiles')
            .select('firma_id')
            .eq('id', fallbackAnaId)
            .maybeSingle();

          if (anaProfile?.firma_id) {
            profileData.firma_id = anaProfile.firma_id;
            await supabase.from('profiles').update({ firma_id: anaProfile.firma_id }).eq('id', profileData.id);
            setProfile({ ...profileData });
            setCachedData('tahsilatim_profile', { ...profileData });
          }
        }

        if (profileData.firma_id) {
          let { data: firmaData, error: firmaErr } = await supabase
            .from('firmalar')
            .select('*')
            .eq('id', profileData.firma_id)
            .maybeSingle();

          // Eğer firma kaydı yoksa veya RLS yüzünden gelmediyse ana hesabın firmasından kurtar
          if (!firmaData && fallbackAnaId) {
            const { data: anaProfile } = await supabase
              .from('profiles')
              .select('firma_id')
              .eq('id', fallbackAnaId)
              .maybeSingle();

            if (anaProfile?.firma_id && anaProfile.firma_id !== profileData.firma_id) {
              profileData.firma_id = anaProfile.firma_id;
              await supabase.from('profiles').update({ firma_id: anaProfile.firma_id }).eq('id', profileData.id);
              setProfile({ ...profileData });
              setCachedData('tahsilatim_profile', { ...profileData });
              const { data: refirma } = await supabase
                .from('firmalar')
                .select('*')
                .eq('id', anaProfile.firma_id)
                .maybeSingle();
              firmaData = refirma;
            }
          }

          if (firmaErr) {
            console.warn('Firma fetch warning:', firmaErr);
          }

          let f = (firmaData as Firma) || null;
          if (!f && profileData.firma_id) {
            // firmalar tablosu RLS plasiyer okumasını kısıtlasa bile firma.id korunmalı ki cariler/işlemler çalışsın
            f = {
              id: profileData.firma_id,
              unvan: (authUserMeta?.firma_unvan as string) || 'Firma Hesabı',
              vergi_no: '',
            } as Firma;
          }

          if (f && isDesignatedSuperAdmin) {
            if (!f.sinirsiz || !f.paket_bitis) {
              // Veritabanında güncellemeyi dene; yalnızca DB gerçekten onaylarsa state'e yansıt
              const { data: updatedFirma } = await supabase
                .from('firmalar')
                .update({ sinirsiz: true, paket_bitis: f.paket_bitis || '2099-12-31' })
                .eq('id', f.id)
                .select('*')
                .maybeSingle();

              if (updatedFirma) {
                f = updatedFirma as Firma;
              }
            }
          }
          setFirma(f);
          setCachedData('tahsilatim_firma', f);

          // Firmanın aktif paketini ve ayarlar yedek ek plasiyer kotasını yükle
          const [paketRes, ekQuotaRes] = await Promise.all([
            f?.paket_id
              ? supabase.from('paketler').select('*').eq('id', f.paket_id).maybeSingle()
              : Promise.resolve({ data: null }),
            supabase
              .from('ayarlar')
              .select('anahtar, deger')
              .eq('anahtar', FIRMA_EK_PLASIYER_AYAR_KEY)
              .maybeSingle(),
          ]);

          const resolvedPaket = (paketRes.data as Paket | null) || null;
          setActivePaket(resolvedPaket);
          setCachedData('tahsilatim_active_paket', resolvedPaket);

          const ekQuotaMap = ekQuotaRes.data
            ? parseFirmaEkPlasiyerMapFromAyarlar([ekQuotaRes.data as Ayar])
            : {};
          const fallbackCount = f?.id ? ekQuotaMap[f.id] ?? 0 : 0;
          setEkPlasiyerFallback(fallbackCount);
          setCachedData(
            'tahsilatim_ek_plasiyer',
            f?.id ? { firmaId: f.id, count: fallbackCount } : null
          );
        } else {
          setFirma(null);
          setActivePaket(null);
          setEkPlasiyerFallback(0);
          setCachedData('tahsilatim_firma', null);
          setCachedData('tahsilatim_active_paket', null);
          setCachedData('tahsilatim_ek_plasiyer', null);
        }
      } catch (err: unknown) {
        const msg = handleSupabaseError(err, 'Kullanıcı veya firma bilgileri alınamadı.');
        setError(msg);
      }
    },
    []
  );

  // Oturum ve State Dinleme
  useEffect(() => {
    let mounted = true;

    const safetyTimer = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 4500);

    // Mevcut oturumu al
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        window.clearTimeout(safetyTimer);
        setSession(session);
        const currentUser = session?.user ?? null;

        if (currentUser) {
          setUser(currentUser);
          setCachedData('tahsilatim_user', currentUser);
          if (currentUser.email) {
            try {
              localStorage.setItem('tahsilatim_remembered_email', currentUser.email);
            } catch {}
          }
          const hasCachedData = !!localStorage.getItem('tahsilatim_profile');
          if (hasCachedData) {
            // Önbellek zaten varsa ekranı bekletme, anında göster ve arka planda güncelle
            setLoading(false);
            fetchProfileAndFirma(currentUser.id);
          } else {
            fetchProfileAndFirma(currentUser.id).finally(() => {
              if (mounted) setLoading(false);
            });
          }
        } else {
          // Eğer yerel depolamada önceden oturum açmış kullanıcı varsa ve henüz açıkça çıkış yapılmamışsa,
          // geçici bir bağlantı kopmasında oturumu hemen silme; sadece session yoksa ve cache yoksa temizle
          const storedUser = getCachedData<User>('tahsilatim_user');
          if (!storedUser) {
            setCachedData('tahsilatim_user', null);
            setCachedData('tahsilatim_profile', null);
            setCachedData('tahsilatim_firma', null);
            setCachedData('tahsilatim_active_paket', null);
            setCachedData('tahsilatim_ek_plasiyer', null);
            setProfile(null);
            setFirma(null);
            setActivePaket(null);
            setEkPlasiyerFallback(0);
            setUser(null);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          window.clearTimeout(safetyTimer);
          setLoading(false);
        }
      });

    // Oturum değişikliklerini dinle
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      const currentUser = newSession?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        setCachedData('tahsilatim_user', currentUser);
        await fetchProfileAndFirma(currentUser.id);
      } else {
        setCachedData('tahsilatim_user', null);
        setCachedData('tahsilatim_profile', null);
        setCachedData('tahsilatim_firma', null);
        setCachedData('tahsilatim_active_paket', null);
        setCachedData('tahsilatim_ek_plasiyer', null);
        setProfile(null);
        setFirma(null);
        setActivePaket(null);
        setEkPlasiyerFallback(0);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfileAndFirma]);

  const refreshProfileAndFirma = async () => {
    if (user?.id) {
      await fetchProfileAndFirma(user.id);
    }
  };

  const clearError = () => setError(null);

  // Giriş Yap (E-posta & Şifre)
  const signIn = async (email: string, pass: string): Promise<{ error?: string }> => {
    try {
      setError(null);
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: pass,
      });

      if (authError) {
        const msg = handleSupabaseError(authError);
        setError(msg);
        return { error: msg };
      }

      if (data.user) {
        setCachedData('tahsilatim_profile', null);
        setCachedData('tahsilatim_firma', null);
        if (email.trim()) {
          try {
            localStorage.setItem('tahsilatim_remembered_email', email.trim());
          } catch {}
        }
        await fetchProfileAndFirma(data.user.id);
      }
      return {};
    } catch (err: unknown) {
      const msg = handleSupabaseError(err, 'Giriş yapılamadı.');
      setError(msg);
      return { error: msg };
    }
  };

  // Google ile Giriş Yap (Gmail)
  const signInWithGoogle = async (): Promise<{ error?: string }> => {
    try {
      setError(null);
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (oauthErr) {
        const msg = handleSupabaseError(oauthErr);
        setError(msg);
        return { error: msg };
      }
      return {};
    } catch (err: unknown) {
      const msg = handleSupabaseError(err, 'Google ile giriş başlatılamadı.');
      setError(msg);
      return { error: msg };
    }
  };

  // Apple ile Giriş Yap (iOS Hesabı)
  const signInWithApple = async (): Promise<{ error?: string }> => {
    try {
      setError(null);
      const { error: oauthErr } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (oauthErr) {
        const msg = handleSupabaseError(oauthErr);
        setError(msg);
        return { error: msg };
      }
      return {};
    } catch (err: unknown) {
      const msg = handleSupabaseError(err, 'Apple ile giriş başlatılamadı.');
      setError(msg);
      return { error: msg };
    }
  };

  // Kayıt Ol (Trigger otomatik firma ve profil oluşturur, 7 gün deneme)
  const signUp = async (data: {
    unvan: string;
    vergi_no: string;
    ad_soyad: string;
    telefon: string;
    email: string;
    pass: string;
  }): Promise<{ error?: string }> => {
    try {
      setError(null);

      // options.data: { unvan, vergi_no, ad_soyad, telefon } gönder
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: data.email.trim(),
        password: data.pass,
        options: {
          data: {
            unvan: data.unvan.trim(),
            vergi_no: data.vergi_no.trim(),
            ad_soyad: data.ad_soyad.trim(),
            telefon: data.telefon.trim(),
          },
        },
      });

      if (authErr) {
        const msg = handleSupabaseError(authErr);
        setError(msg);
        return { error: msg };
      }

      if (authData.user) {
        // Trigger'ın firma ve profili oluşturmasını bekle ve çek
        await new Promise((r) => setTimeout(r, 800));
        await fetchProfileAndFirma(authData.user.id, 4);
      }
      return {};
    } catch (err: unknown) {
      const msg = handleSupabaseError(err, 'Kayıt işlemi başarısız oldu.');
      setError(msg);
      return { error: msg };
    }
  };

  // Çıkış Yap
  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('SignOut error:', err);
    } finally {
      setCachedData('tahsilatim_user', null);
      setCachedData('tahsilatim_profile', null);
      setCachedData('tahsilatim_firma', null);
      setCachedData('tahsilatim_active_paket', null);
      setCachedData('tahsilatim_ek_plasiyer', null);
      setUser(null);
      setSession(null);
      setProfile(null);
      setFirma(null);
      setActivePaket(null);
      setEkPlasiyerFallback(0);
      setError(null);
    }
  };

  const currentEmail = (user?.email || profile?.email || '').trim().toLowerCase();
  const isSuperAdmin =
    currentEmail === SUPER_ADMIN_EMAIL || profile?.rol === 'superadmin';

  const periodInfo = calculatePeriodInfo(firma, profile, user);
  const effectiveIsPeriodExpired = isSuperAdmin ? false : periodInfo.isExpired;

  const entitlements = resolvePackageEntitlements({
    firma,
    activePaket,
    periodStatus: periodInfo.status,
    isSuperAdmin,
    ekPlasiyerFallback,
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        firma,
        activePaket,
        entitlements,
        loading,
        error,
        isSuperAdmin,
        isPeriodExpired: effectiveIsPeriodExpired,
        periodInfo,
        signIn,
        signInWithGoogle,
        signInWithApple,
        signUp,
        signOut,
        refreshProfileAndFirma,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
