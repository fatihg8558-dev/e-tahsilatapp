import { supabase } from './supabase';
import {
  getPosConfig,
  normalizePublicWebUrl,
  PosConfig,
  resolveGatewayFunctionUrl,
  savePosConfig,
} from './posService';

const CLOUD_POS_AYAR_PREFIX = 'pos_public_cfg_';

export interface CloudPublicPosConfig {
  publicWebUrl?: string;
  gatewayFunctionUrl?: string;
  provider?: PosConfig['provider'];
  enabled?: boolean;
  testMode?: boolean;
  iyzicoBaseUrl?: string;
  updatedAt?: string;
}

export interface PaymentLinkSessionRecord {
  id?: string;
  pay_code: string;
  referans_no: string;
  firma_id?: string | null;
  firma_unvan?: string | null;
  cari_id?: string | null;
  cari_unvan: string;
  tutar: number;
  aciklama?: string | null;
  saglayici: 'iyzico' | 'paytr';
  durum: 'bekliyor' | 'odendi' | 'iptal' | 'hata';
  gateway_token?: string | null;
  odeme_url?: string | null;
  created_at?: string;
}

export interface GatewayCheckoutInitResult {
  ok: boolean;
  provider?: 'iyzico' | 'paytr';
  token?: string;
  paymentPageUrl?: string;
  checkoutFormContent?: string;
  iframeUrl?: string;
  notDeployed?: boolean;
  missingKeys?: boolean;
  error?: string;
}

export const POS_GATEWAY_SQL_SNIPPET = `-- 1) Ödeme Linki Oturumları & Gerçek Sanal POS Tabloları (Supabase SQL Editor)
CREATE TABLE IF NOT EXISTS public.odeme_linkleri (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_code text UNIQUE NOT NULL,
  referans_no text NOT NULL,
  firma_id uuid REFERENCES public.firmalar(id) ON DELETE CASCADE,
  firma_unvan text,
  cari_id uuid REFERENCES public.cariler(id) ON DELETE SET NULL,
  cari_unvan text NOT NULL,
  tutar numeric(14,2) NOT NULL,
  aciklama text,
  saglayici text NOT NULL DEFAULT 'iyzico',
  durum text NOT NULL DEFAULT 'bekliyor',
  gateway_token text,
  odeme_url text,
  odeme_tarihi timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.odeme_linkleri ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Herkes aktif ödeme linkini okuyabilir" ON public.odeme_linkleri;
CREATE POLICY "Herkes aktif ödeme linkini okuyabilir"
  ON public.odeme_linkleri FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Oturum açan firma ödeme linki oluşturabilir" ON public.odeme_linkleri;
CREATE POLICY "Oturum açan firma ödeme linki oluşturabilir"
  ON public.odeme_linkleri FOR INSERT
  TO authenticated
  WITH CHECK (firma_id IN (SELECT firma_id FROM public.profiles WHERE id = auth.uid()));

-- 2) Gizli API Anahtarları (Sadece Edge Function Service Role ve Firma Sahibi erişir)
CREATE TABLE IF NOT EXISTS public.firma_pos_ayarlari (
  firma_id uuid PRIMARY KEY REFERENCES public.firmalar(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'iyzico',
  test_mode boolean NOT NULL DEFAULT true,
  iyzico_api_key text,
  iyzico_secret_key text,
  iyzico_base_url text DEFAULT 'https://sandbox-api.iyzipay.com',
  paytr_merchant_id text,
  paytr_merchant_key text,
  paytr_merchant_salt text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.firma_pos_ayarlari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Firma sahibi kendi POS anahtarlarını yönetir" ON public.firma_pos_ayarlari;
CREATE POLICY "Firma sahibi kendi POS anahtarlarını yönetir"
  ON public.firma_pos_ayarlari FOR ALL
  TO authenticated
  USING (firma_id IN (SELECT firma_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (firma_id IN (SELECT firma_id FROM public.profiles WHERE id = auth.uid()));`;

export const POS_EDGE_DEPLOY_COMMANDS = `# Supabase CLI ile Edge Function Dağıtımı
supabase functions deploy pos-payment-gateway --no-verify-jwt

# İsteğe bağlı: Ortak iyzico / PayTR secret tanımlama (veya firma_pos_ayarlari tablosu kullanılır)
supabase secrets set IYZICO_API_KEY="sandbox-..." IYZICO_SECRET_KEY="sandbox-..."
supabase secrets set PAYTR_MERCHANT_ID="..." PAYTR_MERCHANT_KEY="..." PAYTR_MERCHANT_SALT="..."`;

export function createShortPayCode(): string {
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  return `THS-${timePart}${randomPart}`;
}

/**
 * Gizli anahtarlar (Secret Key / Merchant Salt) HARİÇ genel POS ayarlarını ve publicWebUrl değerini
 * Supabase `ayarlar` tablosuna senkronize eder. Böylece Android APK cihazları Web'deki web adresini otomatik alır.
 */
export async function syncPublicPosConfigToCloud(
  firmaId: string,
  config: PosConfig
): Promise<{ cloudSaved: boolean; secretsSynced: boolean }> {
  if (!firmaId) return { cloudSaved: false, secretsSynced: false };

  const publicPayload: CloudPublicPosConfig = {
    publicWebUrl: normalizePublicWebUrl(config.publicWebUrl),
    gatewayFunctionUrl: (config.gatewayFunctionUrl || '').trim().replace(/\/+$/, ''),
    provider: config.provider,
    enabled: config.enabled,
    testMode: config.testMode,
    iyzicoBaseUrl: config.iyzicoBaseUrl,
    updatedAt: new Date().toISOString(),
  };

  let cloudSaved = false;
  let secretsSynced = false;

  try {
    const anahtar = `${CLOUD_POS_AYAR_PREFIX}${firmaId}`;
    const serialized = JSON.stringify(publicPayload);
    const { data: existing, error: selErr } = await supabase
      .from('ayarlar')
      .select('id')
      .eq('anahtar', anahtar)
      .maybeSingle();

    if (!selErr) {
      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('ayarlar')
          .update({ deger: serialized })
          .eq('id', existing.id);
        if (!updErr) cloudSaved = true;
      } else {
        const { error: insErr } = await supabase
          .from('ayarlar')
          .insert({ anahtar, deger: serialized });
        if (!insErr) cloudSaved = true;
      }
    }
  } catch {
    cloudSaved = false;
  }

  // Eğer firma_pos_ayarlari tablosu oluşturulduysa anahtarları güvenli RLS tablosuna da kaydet
  try {
    const { error: posTableErr } = await supabase.from('firma_pos_ayarlari').upsert(
      {
        firma_id: firmaId,
        provider: config.provider,
        test_mode: config.testMode,
        iyzico_api_key: config.iyzicoApiKey?.trim() || null,
        iyzico_secret_key: config.iyzicoSecretKey?.trim() || null,
        iyzico_base_url: config.iyzicoBaseUrl || 'https://sandbox-api.iyzipay.com',
        paytr_merchant_id: config.paytrMerchantId?.trim() || null,
        paytr_merchant_key: config.paytrMerchantKey?.trim() || null,
        paytr_merchant_salt: config.paytrMerchantSalt?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firma_id' }
    );
    if (!posTableErr) {
      secretsSynced = true;
    }
  } catch {
    secretsSynced = false;
  }

  return { cloudSaved, secretsSynced };
}

/**
 * Buluttaki `publicWebUrl` ve temel POS ayarlarını okuyup yerel konfigürasyonla birleştirir.
 */
export async function fetchCloudPosConfig(firmaId?: string | null): Promise<PosConfig> {
  const local = getPosConfig(firmaId || undefined);
  if (!firmaId) return local;

  try {
    const { data, error } = await supabase
      .from('ayarlar')
      .select('deger')
      .eq('anahtar', `${CLOUD_POS_AYAR_PREFIX}${firmaId}`)
      .maybeSingle();

    if (error || !data?.deger) return local;

    const parsed = JSON.parse(data.deger) as CloudPublicPosConfig;
    const merged: PosConfig = {
      ...local,
      publicWebUrl: parsed.publicWebUrl || local.publicWebUrl || '',
      gatewayFunctionUrl: parsed.gatewayFunctionUrl || local.gatewayFunctionUrl || '',
      provider: parsed.provider || local.provider,
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : local.enabled,
      testMode: typeof parsed.testMode === 'boolean' ? parsed.testMode : local.testMode,
      iyzicoBaseUrl: parsed.iyzicoBaseUrl || local.iyzicoBaseUrl,
    };
    savePosConfig(merged, firmaId);
    return merged;
  } catch {
    return local;
  }
}

export async function createCloudPaymentLinkSession(params: {
  firmaId?: string | null;
  firmaUnvan?: string | null;
  cariId?: string | null;
  cariUnvan: string;
  tutar: number;
  aciklama?: string | null;
  provider: 'iyzico' | 'paytr';
  referenceNo: string;
}): Promise<{ payCode?: string; persisted: boolean }> {
  if (!params.firmaId) return { persisted: false };
  const payCode = createShortPayCode();

  try {
    const { error } = await supabase.from('odeme_linkleri').insert({
      pay_code: payCode,
      referans_no: params.referenceNo,
      firma_id: params.firmaId,
      firma_unvan: params.firmaUnvan || null,
      cari_id: params.cariId || null,
      cari_unvan: params.cariUnvan || 'Müşteri',
      tutar: Math.round(params.tutar * 100) / 100,
      aciklama: params.aciklama?.trim() || null,
      saglayici: params.provider,
      durum: 'bekliyor',
    });

    if (error) {
      return { persisted: false };
    }
    return { payCode, persisted: true };
  } catch {
    return { persisted: false };
  }
}

export async function fetchPaymentLinkSession(
  payCode: string
): Promise<PaymentLinkSessionRecord | null> {
  const clean = (payCode || '').trim();
  if (!clean) return null;
  try {
    const { data, error } = await supabase
      .from('odeme_linkleri')
      .select('*')
      .eq('pay_code', clean)
      .maybeSingle();

    if (error || !data) return null;
    return data as PaymentLinkSessionRecord;
  } catch {
    return null;
  }
}

export async function checkGatewayHealth(
  config?: PosConfig | null
): Promise<{
  reachable: boolean;
  hasIyzicoEnv?: boolean;
  hasPaytrEnv?: boolean;
  message: string;
}> {
  const endpoint = resolveGatewayFunctionUrl(config);
  try {
    const anonKey =
      import.meta.env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_PzJOpsBlvVm9MoxTx_PFkw_X66otRCQ';
    const res = await fetch(`${endpoint}?action=health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ action: 'health' }),
    });

    if (!res.ok) {
      return {
        reachable: false,
        message: `Gateway yanıt vermedi (HTTP ${res.status}). Edge Function dağıtılmamış olabilir.`,
      };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      hasIyzicoEnv?: boolean;
      hasPaytrEnv?: boolean;
    };
    if (!data?.ok) {
      return {
        reachable: false,
        message: 'Gateway geçerli yanıt döndürmedi.',
      };
    }

    return {
      reachable: true,
      hasIyzicoEnv: Boolean(data.hasIyzicoEnv),
      hasPaytrEnv: Boolean(data.hasPaytrEnv),
      message: 'Edge Function ödeme gateway bağlantısı aktif!',
    };
  } catch {
    return {
      reachable: false,
      message: 'Edge Function uç noktasına ulaşılamadı (henüz deploy edilmemiş olabilir).',
    };
  }
}

export async function initializeRealGatewayCheckout(params: {
  provider: 'iyzico' | 'paytr';
  amount: number;
  referenceNo: string;
  payCode?: string;
  firmaId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  description?: string;
  returnBaseUrl?: string;
  gatewayUrl?: string;
}): Promise<GatewayCheckoutInitResult> {
  const endpoint =
    params.gatewayUrl?.trim().replace(/\/+$/, '') || resolveGatewayFunctionUrl(null);
  const anonKey =
    import.meta.env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_PzJOpsBlvVm9MoxTx_PFkw_X66otRCQ';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        action: 'initialize_checkout',
        provider: params.provider,
        amount: params.amount,
        referenceNo: params.referenceNo,
        payCode: params.payCode || '',
        firmaId: params.firmaId || '',
        customerName: params.customerName,
        customerEmail: params.customerEmail || 'tahsilat@musteri.com',
        customerPhone: params.customerPhone || '+905550000000',
        description: params.description || '',
        returnBaseUrl: params.returnBaseUrl || '',
      }),
    });

    if (res.status === 404 || res.status === 502 || res.status === 503) {
      return {
        ok: false,
        notDeployed: true,
        error: 'Canlı Sanal POS gateway servisi (Edge Function) henüz dağıtılmamış.',
      };
    }

    const data = (await res.json()) as GatewayCheckoutInitResult & { code?: string };
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        missingKeys: data?.code === 'MISSING_KEYS',
        error: data?.error || 'Sanal POS ödeme oturumu başlatılamadı.',
      };
    }

    return data;
  } catch {
    return {
      ok: false,
      notDeployed: true,
      error: 'Sanal POS sunucusuna bağlanılamadı.',
    };
  }
}
