import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://joxnbnclogasumkfzyqt.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_PzJOpsBlvVm9MoxTx_PFkw_X66otRCQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  },
});

export function handleSupabaseError(
  error: unknown,
  userMessage?: string,
  options?: { isFirmaUnlimited?: boolean }
): string {
  console.error('[Supabase Error]:', error);
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const raw = (error as { message: string }).message;
    const lower = raw.toLowerCase();

    if (lower.includes('user already registered')) {
      return 'Bu e-posta adresi zaten kayıtlı! Lütfen "Giriş Yap" sekmesine geçerek şifrenizle giriş yapınız.';
    }
    if (lower.includes('invalid login credentials')) {
      return 'E-posta adresi veya şifre hatalı. Lütfen bilgilerinizi kontrol ediniz.';
    }
    if (lower.includes('email not confirmed')) {
      return 'E-posta adresiniz henüz onaylanmamış. Lütfen e-postanızı kontrol ediniz.';
    }
    if (lower.includes('password should be at least')) {
      return 'Şifreniz en az 6 karakter olmalıdır.';
    }
    if (lower.includes('violates row-level security policy') || lower.includes('row-level security')) {
      if (options?.isFirmaUnlimited) {
        return `Veritabanı güvenlik kuralı (RLS) kayıt işlemine izin vermedi (${raw}). Firma sınırsız yetkili olsa bile Supabase tarafındaki "islemler" tablosu RLS kuralı süper admin rolünü veya sinirsiz alanını kontrol etmiyor olabilir. Süper Admin Paneli > "Veritabanı RLS SQL" bölümündeki SQL kuralını Supabase SQL Editor'de çalıştırıp tekrar deneyiniz.`;
      }
      return 'İşlem kaydetme yetkiniz bulunmamaktadır. Firma deneme veya paket süreniz veritabanında dolmuştur. Kesintisiz devam etmek için lütfen paket satın alınız veya Süper Admin üzerinden yetki tanımlatınız.';
    }
    return raw;
  }
  return userMessage || 'Beklenmeyen bir hata oluştu.';
}
