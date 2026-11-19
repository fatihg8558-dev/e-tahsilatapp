import { supabase } from './supabase';
import { FaturaYon } from '../types/database';

export type GibEnvironment = 'prod' | 'test';
export type GibDirectionFilter = 'all' | 'alis' | 'satis';

export interface GibSettings {
  kullaniciKodu: string;
  sifreSet: boolean;
  ortam: GibEnvironment;
  varsayilanGiderKasaId: string;
  varsayilanGiderKategori: string;
  edgeFunctionUrl?: string;
  sonBaglantiDurumu?: 'basarili' | 'hata' | null;
  sonBaglantiMesaji?: string | null;
  updatedAt?: string;
}

export interface GibFetchedInvoice {
  ettn: string;
  belgeNumarasi: string;
  tarih: string; // YYYY-MM-DD
  yon: FaturaYon;
  tip: string;
  unvan: string;
  vkn: string;
  toplamTutar: number;
  paraBirimi: string;
  onayDurumu?: string;
  xmlContent?: string | null;
  htmlContent?: string | null;
}

const DEFAULT_GIB_SETTINGS: GibSettings = {
  kullaniciKodu: '',
  sifreSet: false,
  ortam: 'prod',
  varsayilanGiderKasaId: '',
  varsayilanGiderKategori: 'Mal / Hizmet Alımı',
  edgeFunctionUrl: '',
  sonBaglantiDurumu: null,
  sonBaglantiMesaji: null,
};

const CLOUD_GIB_AYAR_PREFIX = 'gib_public_cfg_';
const LOCAL_GIB_STORAGE_PREFIX = 'tahsilatim_gib_cfg_';

export const GIB_PORTAL_SQL_SNIPPET = `-- GİB e-Arşiv / e-Fatura Firma Kimlik Bilgileri Tablosu (Supabase SQL Editor)
CREATE TABLE IF NOT EXISTS public.firma_gib_ayarlari (
  firma_id uuid PRIMARY KEY REFERENCES public.firmalar(id) ON DELETE CASCADE,
  gib_kullanici_kodu text NOT NULL,
  gib_sifre text,
  ortam text NOT NULL DEFAULT 'prod',
  varsayilan_gider_kasa_id uuid,
  varsayilan_gider_kategori text DEFAULT 'Mal / Hizmet Alımı',
  son_baglanti_durumu text,
  son_baglanti_mesaji text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.firma_gib_ayarlari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firma yetkilisi kendi GİB ayarlarını yönetir" ON public.firma_gib_ayarlari;
CREATE POLICY "Firma yetkilisi kendi GİB ayarlarını yönetir"
  ON public.firma_gib_ayarlari FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.firma_id = firma_gib_ayarlari.firma_id AND p.aktif = true AND p.rol IN ('ana', 'muhasebeci', 'superadmin'))
          OR p.rol = 'superadmin'
          OR lower(p.email) = 'conqueror58@gmail.com'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          (p.firma_id = firma_gib_ayarlari.firma_id AND p.aktif = true AND p.rol IN ('ana', 'muhasebeci', 'superadmin'))
          OR p.rol = 'superadmin'
          OR lower(p.email) = 'conqueror58@gmail.com'
        )
    )
  );`;

export const GIB_EDGE_DEPLOY_COMMANDS = `# Supabase CLI ile GİB Portal Proxy Edge Function Dağıtımı
supabase functions deploy gib-portal-proxy`;

export function resolveGibFunctionUrl(customUrl?: string | null): string {
  const cleanCustom = (customUrl || '').trim().replace(/\/+$/, '');
  if (cleanCustom) return cleanCustom;
  const baseUrl =
    (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ||
    'https://joxnbnclogasumkfzyqt.supabase.co';
  return `${baseUrl.replace(/\/+$/, '')}/functions/v1/gib-portal-proxy`;
}

export function getLocalGibSettings(firmaId?: string | null): GibSettings {
  if (!firmaId || typeof localStorage === 'undefined') return { ...DEFAULT_GIB_SETTINGS };
  try {
    const raw = localStorage.getItem(`${LOCAL_GIB_STORAGE_PREFIX}${firmaId}`);
    if (!raw) return { ...DEFAULT_GIB_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GibSettings>;
    return { ...DEFAULT_GIB_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_GIB_SETTINGS };
  }
}

export function saveLocalGibSettings(firmaId: string, settings: GibSettings): void {
  if (!firmaId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${LOCAL_GIB_STORAGE_PREFIX}${firmaId}`, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export async function fetchCloudGibSettings(firmaId?: string | null): Promise<GibSettings> {
  const local = getLocalGibSettings(firmaId);
  if (!firmaId) return local;

  let merged: GibSettings = { ...local };

  try {
    const { data: ayarRow } = await supabase
      .from('ayarlar')
      .select('deger')
      .eq('anahtar', `${CLOUD_GIB_AYAR_PREFIX}${firmaId}`)
      .maybeSingle();

    if (ayarRow?.deger) {
      const parsed = JSON.parse(ayarRow.deger) as Partial<GibSettings>;
      merged = { ...merged, ...parsed };
    }
  } catch {
    // ignore
  }

  try {
    const { data: gibRow, error } = await supabase
      .from('firma_gib_ayarlari')
      .select(
        'gib_kullanici_kodu, gib_sifre, ortam, varsayilan_gider_kasa_id, varsayilan_gider_kategori, son_baglanti_durumu, son_baglanti_mesaji, updated_at'
      )
      .eq('firma_id', firmaId)
      .maybeSingle();

    if (!error && gibRow) {
      merged = {
        ...merged,
        kullaniciKodu: gibRow.gib_kullanici_kodu || merged.kullaniciKodu,
        sifreSet: Boolean(gibRow.gib_sifre) || merged.sifreSet,
        ortam: gibRow.ortam === 'test' ? 'test' : 'prod',
        varsayilanGiderKasaId: gibRow.varsayilan_gider_kasa_id || merged.varsayilanGiderKasaId,
        varsayilanGiderKategori:
          gibRow.varsayilan_gider_kategori || merged.varsayilanGiderKategori,
        sonBaglantiDurumu:
          gibRow.son_baglanti_durumu === 'basarili' || gibRow.son_baglanti_durumu === 'hata'
            ? gibRow.son_baglanti_durumu
            : merged.sonBaglantiDurumu,
        sonBaglantiMesaji: gibRow.son_baglanti_mesaji || merged.sonBaglantiMesaji,
        updatedAt: gibRow.updated_at || merged.updatedAt,
      };
    }
  } catch {
    // table may not exist yet
  }

  saveLocalGibSettings(firmaId, merged);
  return merged;
}

export async function saveCloudGibSettings(params: {
  firmaId: string;
  settings: GibSettings;
  rawPassword?: string;
}): Promise<{
  publicSaved: boolean;
  credentialsSaved: boolean;
  missingCredentialsTable?: boolean;
  error?: string;
}> {
  const { firmaId, settings, rawPassword } = params;
  if (!firmaId) return { publicSaved: false, credentialsSaved: false, error: 'Firma bulunamadı.' };

  const cleanKullanici = settings.kullaniciKodu.trim();
  const cleanPassword = (rawPassword || '').trim();
  const nextSettings: GibSettings = {
    ...settings,
    kullaniciKodu: cleanKullanici,
    sifreSet: Boolean(cleanPassword) || settings.sifreSet,
    updatedAt: new Date().toISOString(),
  };

  saveLocalGibSettings(firmaId, nextSettings);

  let publicSaved = false;
  let credentialsSaved = false;
  let missingCredentialsTable = false;

  // 1. Şifresiz tercihleri ayarlar tablosuna kaydet
  try {
    const anahtar = `${CLOUD_GIB_AYAR_PREFIX}${firmaId}`;
    const serialized = JSON.stringify({
      kullaniciKodu: nextSettings.kullaniciKodu,
      sifreSet: nextSettings.sifreSet,
      ortam: nextSettings.ortam,
      varsayilanGiderKasaId: nextSettings.varsayilanGiderKasaId,
      varsayilanGiderKategori: nextSettings.varsayilanGiderKategori,
      edgeFunctionUrl: (nextSettings.edgeFunctionUrl || '').trim(),
      sonBaglantiDurumu: nextSettings.sonBaglantiDurumu || null,
      sonBaglantiMesaji: nextSettings.sonBaglantiMesaji || null,
      updatedAt: nextSettings.updatedAt,
    });

    const { data: existing } = await supabase
      .from('ayarlar')
      .select('id')
      .eq('anahtar', anahtar)
      .maybeSingle();

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from('ayarlar')
        .update({ deger: serialized })
        .eq('id', existing.id);
      if (!updErr) publicSaved = true;
    } else {
      const { error: insErr } = await supabase
        .from('ayarlar')
        .insert({ anahtar, deger: serialized });
      if (!insErr) publicSaved = true;
    }
  } catch {
    publicSaved = false;
  }

  // 2. Kullanıcı adı ve şifreyi RLS korumalı firma_gib_ayarlari tablosuna yaz
  try {
    const upsertPayload: Record<string, unknown> = {
      firma_id: firmaId,
      gib_kullanici_kodu: cleanKullanici,
      ortam: nextSettings.ortam,
      varsayilan_gider_kasa_id: nextSettings.varsayilanGiderKasaId || null,
      varsayilan_gider_kategori: nextSettings.varsayilanGiderKategori || 'Mal / Hizmet Alımı',
      updated_at: nextSettings.updatedAt,
    };

    if (cleanPassword) {
      upsertPayload.gib_sifre = cleanPassword;
    }

    const { error: gibErr } = await supabase
      .from('firma_gib_ayarlari')
      .upsert(upsertPayload, { onConflict: 'firma_id' });

    if (!gibErr) {
      credentialsSaved = true;
    } else if (
      gibErr.code === '42P01' ||
      gibErr.code === 'PGRST205' ||
      /does not exist|schema cache/i.test(gibErr.message || '')
    ) {
      missingCredentialsTable = true;
    } else {
      return {
        publicSaved,
        credentialsSaved: false,
        error: gibErr.message,
      };
    }
  } catch {
    missingCredentialsTable = true;
  }

  return { publicSaved, credentialsSaved, missingCredentialsTable };
}

async function callGibProxy(params: {
  action: 'health' | 'test_login' | 'fetch_invoices';
  firmaId: string;
  settings?: GibSettings;
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const endpoint = resolveGibFunctionUrl(params.settings?.edgeFunctionUrl);
  const anonKey =
    (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    'sb_publishable_PzJOpsBlvVm9MoxTx_PFkw_X66otRCQ';

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token || anonKey;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: params.action,
      firmaId: params.firmaId,
      ...params.body,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && data?.ok === true, status: res.status, data };
}

export async function testGibConnection(params: {
  firmaId: string;
  settings: GibSettings;
  overrideKullaniciKodu?: string;
  overrideSifre?: string;
}): Promise<{ ok: boolean; message: string; notDeployed?: boolean }> {
  try {
    const res = await callGibProxy({
      action: 'test_login',
      firmaId: params.firmaId,
      settings: params.settings,
      body: {
        ortam: params.settings.ortam,
        kullaniciKodu: params.overrideKullaniciKodu?.trim() || undefined,
        sifre: params.overrideSifre?.trim() || undefined,
      },
    });

    if (res.status === 404 || res.status === 502 || res.status === 503) {
      return {
        ok: false,
        notDeployed: true,
        message:
          'GİB Proxy Edge Function (gib-portal-proxy) henüz Supabase üzerine dağıtılmamış görünüyor. Kurulum adımlarından deploy edebilirsiniz.',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        message: String(res.data?.error || 'GİB Portal bağlantısı doğrulanamadı.'),
      };
    }

    return {
      ok: true,
      message: String(res.data?.message || 'GİB Portal giriş doğrulaması başarılı!'),
    };
  } catch {
    return {
      ok: false,
      notDeployed: true,
      message: 'GİB Proxy servisine ulaşılamadı. Edge Function dağıtımını veya internet bağlantınızı kontrol edin.',
    };
  }
}

export async function fetchGibInvoices(params: {
  firmaId: string;
  settings: GibSettings;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  direction: GibDirectionFilter;
  includeXml?: boolean;
}): Promise<{
  ok: boolean;
  invoices: GibFetchedInvoice[];
  warnings?: string[];
  fallbackSuggested?: boolean;
  notDeployed?: boolean;
  error?: string;
}> {
  try {
    const res = await callGibProxy({
      action: 'fetch_invoices',
      firmaId: params.firmaId,
      settings: params.settings,
      body: {
        ortam: params.settings.ortam,
        startDate: params.startDate,
        endDate: params.endDate,
        direction: params.direction,
        includeXml: params.includeXml !== false,
      },
    });

    if (res.status === 404 || res.status === 502 || res.status === 503) {
      return {
        ok: false,
        invoices: [],
        notDeployed: true,
        fallbackSuggested: true,
        error:
          'GİB Proxy Edge Function (gib-portal-proxy) henüz dağıtılmamış. Dilerseniz GİB Portaldan indirdiğiniz .zip / .xml faturaları doğrudan yükleyebilirsiniz.',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        invoices: [],
        fallbackSuggested: Boolean(res.data?.fallbackSuggested ?? true),
        error: String(res.data?.error || 'GİB Portaldan faturalar çekilemedi.'),
      };
    }

    const invoices = Array.isArray(res.data?.invoices)
      ? (res.data.invoices as GibFetchedInvoice[])
      : [];
    const warnings = Array.isArray(res.data?.warnings)
      ? (res.data.warnings as string[])
      : undefined;

    return { ok: true, invoices, warnings };
  } catch {
    return {
      ok: false,
      invoices: [],
      notDeployed: true,
      fallbackSuggested: true,
      error:
        'GİB Portal proxy servisine bağlanılamadı. GİB Portaldan toplu indirdiğiniz .zip veya .xml dosyalarını yükleyerek devam edebilirsiniz.',
    };
  }
}
