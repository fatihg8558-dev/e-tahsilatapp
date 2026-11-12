import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Profile, Firma } from '../types/database';

export type PeriodStatus = 'active_trial' | 'active_package' | 'unlimited' | 'expired';

interface PeriodInfo {
  isExpired: boolean;
  status: PeriodStatus;
  kalanGun: number;
  bitisTarihi: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  firma: Firma | null;
  loading: boolean;
  error: string | null;
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

  const [user, setUser] = useState<User | null>(cachedUser);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [firma, setFirma] = useState<Firma | null>(cachedFirma);
  // Önbellekte profil varsa bekleme yapmadan hemen aç
  const [loading, setLoading] = useState<boolean>(!cachedProfile && !cachedUser);
  const [error, setError] = useState<string | null>(null);

  // Süre ve abonelik hesaplayıcı
  const calculatePeriodInfo = (
    f: Firma | null,
    p: Profile | null,
    u: User | null
  ): PeriodInfo => {
    // Süper Admin ve Sınırsız kontrolleri
    const isSuperAdmin =
      p?.rol === 'superadmin' ||
      u?.email?.toLowerCase() === 'conqueror58@gmail.com' ||
      u?.email?.toLowerCase() === 'fatihgtakim85@gmail.com' ||
      f?.sinirsiz === true;

    if (isSuperAdmin) {
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

        if (!profileData) {
          setProfile(null);
          setFirma(null);
          setCachedData('tahsilatim_profile', null);
          setCachedData('tahsilatim_firma', null);
          return;
        }

        // Kural: profiles.aktif === false olan kullanıcıyı çıkış yaptır, "Hesabınız pasif" göster.
        if (profileData.aktif === false) {
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          setProfile(null);
          setFirma(null);
          setCachedData('tahsilatim_user', null);
          setCachedData('tahsilatim_profile', null);
          setCachedData('tahsilatim_firma', null);
          setError('Hesabınız pasif durumdadır. Lütfen şirket yöneticiniz ile iletişime geçiniz.');
          return;
        }

        // Plasiyer profilinde firma_id eksikse veya yeni hesap açıldığında Supabase Auth metadata'dan firma_id'yi kurtar
        const { data: authUserData } = await supabase.auth.getUser();
        const authUserMeta = authUserData?.user?.user_metadata;

        if (profileData && (!profileData.firma_id || profileData.rol === 'plasiyer')) {
          const metaFirmaId = authUserMeta?.firma_id;
          const metaRol = authUserMeta?.rol;
          const metaAnaHesapId = authUserMeta?.ana_hesap_id;
          const metaAdSoyad = authUserMeta?.ad_soyad;

          let needsUpdate = false;
          const updates: Partial<Profile> = {};

          if (metaFirmaId && profileData.firma_id !== metaFirmaId) {
            updates.firma_id = metaFirmaId;
            profileData.firma_id = metaFirmaId;
            needsUpdate = true;
          }
          if (metaRol && profileData.rol !== metaRol) {
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

          if (needsUpdate) {
            await supabase.from('profiles').update(updates).eq('id', profileData.id);
          }
        }

        // Süper Admin kontrolü: conqueror58@gmail.com, fatihgtakim85@gmail.com veya ADMİN firması
        const userEmail = (profileData.email || '').toLowerCase();
        const isSuperAdminEmail =
          userEmail === 'conqueror58@gmail.com' ||
          userEmail === 'fatihgtakim85@gmail.com' ||
          profileData.rol === 'superadmin';

        if (isSuperAdminEmail) {
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
        if (profileData.firma_id) {
          let { data: firmaData, error: firmaErr } = await supabase
            .from('firmalar')
            .select('*')
            .eq('id', profileData.firma_id)
            .maybeSingle();

          // Eğer firma kaydı yoksa veya adı boş/geçersizse ana hesabın firmasından veya metadata'dan düzelt
          if (!firmaData && authUserMeta?.ana_hesap_id) {
            const { data: anaProfile } = await supabase
              .from('profiles')
              .select('firma_id')
              .eq('id', authUserMeta.ana_hesap_id)
              .maybeSingle();

            if (anaProfile?.firma_id) {
              profileData.firma_id = anaProfile.firma_id;
              await supabase.from('profiles').update({ firma_id: anaProfile.firma_id }).eq('id', profileData.id);
              const { data: refirma } = await supabase
                .from('firmalar')
                .select('*')
                .eq('id', anaProfile.firma_id)
                .maybeSingle();
              firmaData = refirma;
            }
          }

          if (firmaErr) {
            throw firmaErr;
          }

          const f = (firmaData as Firma) || null;
          if (f) {
            const isFirmaAdmin =
              isSuperAdminEmail ||
              f.unvan?.trim().toUpperCase() === 'ADMİN' ||
              f.unvan?.trim().toUpperCase() === 'ADMIN';

            if (isFirmaAdmin) {
              f.sinirsiz = true;
              profileData.rol = 'superadmin';
              setProfile({ ...profileData, rol: 'superadmin' });
              setCachedData('tahsilatim_profile', { ...profileData, rol: 'superadmin' });
              // Veritabanını da güncelle
              supabase
                .from('firmalar')
                .update({ sinirsiz: true })
                .eq('id', f.id)
                .then(() => {}, () => {});
            }
          }
          setFirma(f);
          setCachedData('tahsilatim_firma', f);
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

    // Mevcut oturumu al
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
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
          setProfile(null);
          setFirma(null);
          setUser(null);
        }
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
        setProfile(null);
        setFirma(null);
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
      setUser(null);
      setSession(null);
      setProfile(null);
      setFirma(null);
      setError(null);
    }
  };

  const isSuper =
    profile?.rol === 'superadmin' ||
    user?.email?.toLowerCase() === 'conqueror58@gmail.com' ||
    user?.email?.toLowerCase() === 'fatihgtakim85@gmail.com' ||
    firma?.sinirsiz === true ||
    firma?.unvan?.trim().toUpperCase() === 'ADMİN' ||
    firma?.unvan?.trim().toUpperCase() === 'ADMIN';

  const periodInfo = isSuper
    ? { isExpired: false, status: 'unlimited' as const, kalanGun: 9999, bitisTarihi: null }
    : calculatePeriodInfo(firma, profile, user);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        firma,
        loading,
        error,
        isPeriodExpired: periodInfo.isExpired,
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
