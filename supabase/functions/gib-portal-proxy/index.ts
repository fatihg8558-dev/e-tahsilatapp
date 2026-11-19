// Supabase Edge Function: GİB e-Arşiv Portal (earsivportal.gib.gov.tr) Fatura Çekme Proxy Servisi
// Dağıtım: supabase functions deploy gib-portal-proxy
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const GIB_PROD_BASE = 'https://earsivportal.gib.gov.tr';
const GIB_TEST_BASE = 'https://earsivportaltest.gib.gov.tr';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function toGibDate(isoDate: string): string {
  const clean = (isoDate || '').slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return clean;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function gibDateToIso(rawDate?: string): string {
  const clean = (rawDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const slashMatch = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  const dotMatch = clean.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function parseAmount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const str = String(raw ?? '0').trim();
  if (!str) return 0;
  // TR format 1.234,56 veya standart 1234.56
  const normalized = str.includes(',') && str.includes('.')
    ? str.replace(/\./g, '').replace(',', '.')
    : str.includes(',')
    ? str.replace(',', '.')
    : str;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function authenticateCaller(req: Request, firmaId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return { authorized: false, error: 'Sunucu Supabase yapılandırması eksik.' };

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return { authorized: false, error: 'Oturum jetonu eksik. Lütfen tekrar giriş yapınız.' };
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return { authorized: false, error: 'Kullanıcı oturumu doğrulanamadı.' };
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('firma_id, rol, aktif, email')
    .eq('id', userData.user.id)
    .maybeSingle();

  const isSuper =
    profile?.rol === 'superadmin' ||
    String(profile?.email || '').toLowerCase() === 'conqueror58@gmail.com';

  if (!profile || (!isSuper && (profile.firma_id !== firmaId || profile.aktif === false))) {
    return { authorized: false, error: 'Bu firmanın GİB ayarlarına erişim yetkiniz bulunmuyor.' };
  }

  return { authorized: true, admin, userId: userData.user.id };
}

async function gibPostForm(url: string, params: Record<string, string>, referrer: string) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
      Referer: referrer,
      'User-Agent': 'Mozilla/5.0 (compatible; TahsilatimGibClient/1.0)',
    },
    body,
  });

  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(text) as Record<string, unknown>, raw: text };
  } catch {
    return { ok: false, status: res.status, json: null, raw: text };
  }
}

async function loginGibPortal(baseUrl: string, kullaniciKodu: string, sifre: string, ortam: string) {
  const referrer = `${baseUrl}/intragiris.html`;
  const assoscmd = ortam === 'test' ? 'login' : 'anologin';
  const loginRes = await gibPostForm(
    `${baseUrl}/earsiv-services/assos-login`,
    {
      assoscmd,
      rtype: 'json',
      userid: kullaniciKodu,
      sifre,
      sifre2: sifre,
      parola: '1',
    },
    referrer
  );

  const token = String(loginRes.json?.token || '');
  if (!token) {
    const gibMsg =
      String((loginRes.json?.messages as Array<{ text?: string }> | undefined)?.[0]?.text || '') ||
      String(loginRes.json?.error || '');
    return {
      ok: false,
      token: '',
      error:
        gibMsg ||
        'GİB e-Arşiv Portal girişi başarısız oldu. Kullanıcı kodu/şifre hatalı olabilir veya GİB geçici doğrulama istiyor olabilir.',
    };
  }

  return { ok: true, token };
}

async function logoutGibPortal(baseUrl: string, token: string, ortam: string) {
  try {
    await gibPostForm(
      `${baseUrl}/earsiv-services/assos-login`,
      {
        assoscmd: 'logout',
        rtype: 'json',
        token,
      },
      `${baseUrl}/${ortam === 'test' ? 'index.jsp' : 'intragiris.html'}`
    );
  } catch {
    // ignore
  }
}

async function dispatchGib(
  baseUrl: string,
  token: string,
  cmd: string,
  sayfaAdi: string,
  jp: Record<string, unknown>
) {
  return await gibPostForm(
    `${baseUrl}/earsiv-services/dispatch`,
    {
      cmd,
      callid: crypto.randomUUID(),
      pageName: sayfaAdi,
      token,
      jp: JSON.stringify(jp),
    },
    `${baseUrl}/intragiris.html`
  );
}

async function fetchGibInvoiceHtmlAndXml(
  baseUrl: string,
  token: string,
  ettn: string,
  onayDurumu: string
): Promise<{ htmlContent?: string | null; xmlContent?: string | null }> {
  let htmlContent: string | null = null;
  let xmlContent: string | null = null;

  try {
    const htmlRes = await dispatchGib(baseUrl, token, 'EARSIV_PORTAL_FATURA_GOSTER', 'RG_BASITFATURA', {
      ettn,
      onayDurumu: onayDurumu || 'Onaylandı',
    });
    if (typeof htmlRes.json?.data === 'string' && htmlRes.json.data.trim()) {
      htmlContent = htmlRes.json.data;
    }
  } catch {
    // ignore
  }

  try {
    const downloadUrl = `${baseUrl}/earsiv-services/download?token=${encodeURIComponent(
      token
    )}&ettn=${encodeURIComponent(ettn)}&belgeTip=FATURA&onayDurumu=${encodeURIComponent(
      onayDurumu || 'Onaylandı'
    )}&cmd=EARSIV_PORTAL_BELGE_INDIR`;
    const res = await fetch(downloadUrl, {
      headers: { Referer: `${baseUrl}/intragiris.html` },
    });
    if (res.ok) {
      const cType = (res.headers.get('content-type') || '').toLowerCase();
      if (cType.includes('xml') || cType.includes('text')) {
        const txt = await res.text();
        if (txt.includes('<Invoice') || txt.includes(':Invoice')) {
          xmlContent = txt;
        }
      }
    }
  } catch {
    // ignore
  }

  return { htmlContent, xmlContent };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || 'health');

    if (action === 'health') {
      return jsonResponse({ ok: true, service: 'gib-portal-proxy', version: '1.0.0' });
    }

    const firmaId = String(body.firmaId || '').trim();
    if (!firmaId) {
      return jsonResponse({ ok: false, error: 'firmaId alanı zorunludur.' }, 400);
    }

    const auth = await authenticateCaller(req, firmaId);
    if (!auth.authorized || !auth.admin) {
      return jsonResponse({ ok: false, error: auth.error }, 401);
    }

    let kullaniciKodu = String(body.kullaniciKodu || '').trim();
    let sifre = String(body.sifre || '').trim();
    let ortam = String(body.ortam || 'prod') === 'test' ? 'test' : 'prod';

    if (!kullaniciKodu || !sifre) {
      const { data: cfg } = await auth.admin
        .from('firma_gib_ayarlari')
        .select('gib_kullanici_kodu, gib_sifre, ortam')
        .eq('firma_id', firmaId)
        .maybeSingle();

      if (cfg) {
        kullaniciKodu = kullaniciKodu || String(cfg.gib_kullanici_kodu || '').trim();
        sifre = sifre || String(cfg.gib_sifre || '').trim();
        if (!body.ortam && cfg.ortam === 'test') ortam = 'test';
      }
    }

    if (!kullaniciKodu || !sifre) {
      return jsonResponse(
        {
          ok: false,
          fallbackSuggested: true,
          error:
            'Kayıtlı GİB kullanıcı kodu veya şifresi bulunamadı. Lütfen Ayarlar > GİB E-Fatura sekmesinden giriş bilgilerinizi kaydediniz.',
        },
        400
      );
    }

    const baseUrl = ortam === 'test' ? GIB_TEST_BASE : GIB_PROD_BASE;
    const login = await loginGibPortal(baseUrl, kullaniciKodu, sifre, ortam);

    if (!login.ok) {
      try {
        await auth.admin
          .from('firma_gib_ayarlari')
          .update({
            son_baglanti_durumu: 'hata',
            son_baglanti_mesaji: login.error,
            updated_at: new Date().toISOString(),
          })
          .eq('firma_id', firmaId);
      } catch {
        // ignore
      }
      return jsonResponse({ ok: false, fallbackSuggested: true, error: login.error }, 400);
    }

    try {
      await auth.admin
        .from('firma_gib_ayarlari')
        .update({
          son_baglanti_durumu: 'basarili',
          son_baglanti_mesaji: 'GİB e-Arşiv Portal bağlantısı doğrulandı.',
          updated_at: new Date().toISOString(),
        })
        .eq('firma_id', firmaId);
    } catch {
      // ignore
    }

    if (action === 'test_login') {
      await logoutGibPortal(baseUrl, login.token, ortam);
      return jsonResponse({
        ok: true,
        message: `GİB e-Arşiv Portal (${ortam === 'test' ? 'Test' : 'Canlı'}) bağlantısı başarıyla doğrulandı!`,
      });
    }

    if (action === 'fetch_invoices') {
      const startDate = toGibDate(String(body.startDate || ''));
      const endDate = toGibDate(String(body.endDate || ''));
      const direction = String(body.direction || 'all');
      const includeXml = body.includeXml !== false;
      const warnings: string[] = [];
      const invoices: Array<Record<string, unknown>> = [];

      // 1) Adıma Kesilen / Gelen Faturalar (Alış)
      if (direction === 'all' || direction === 'alis') {
        const incomingRes = await dispatchGib(
          baseUrl,
          login.token,
          'EARSIV_PORTAL_ADIMA_KESILEN_BELGELERI_GETIR',
          'RG_ALICI_TASLAKLAR',
          {
            baslangic: startDate,
            bitis: endDate,
          }
        );

        const list = Array.isArray(incomingRes.json?.data)
          ? (incomingRes.json?.data as Array<Record<string, unknown>>)
          : [];

        if (!incomingRes.ok && list.length === 0) {
          warnings.push('Adınıza kesilen e-Arşiv belgeleri GİB servisinden okunamadı.');
        }

        for (const item of list.slice(0, 40)) {
          const ettn = String(item.ettn || '');
          const onayDurumu = String(item.onayDurumu || 'Onaylandı');
          const detail =
            includeXml && ettn
              ? await fetchGibInvoiceHtmlAndXml(baseUrl, login.token, ettn, onayDurumu)
              : {};

          invoices.push({
            ettn,
            belgeNumarasi: String(item.belgeNumarasi || ettn),
            tarih: gibDateToIso(String(item.belgeTarihi || '')),
            yon: 'alis',
            tip: String(item.belgeTuru || 'EARSIVFATURA'),
            unvan: String(item.saticiUnvanAdSoyad || item.unvan || 'GİB Satıcı'),
            vkn: String(item.saticiVknTckn || item.vknTckn || ''),
            toplamTutar: parseAmount(item.odenecekTutar ?? item.toplamTutar ?? item.malHizmetToplamTutari),
            paraBirimi: String(item.paraBirimi || 'TRY'),
            onayDurumu,
            xmlContent: detail.xmlContent || null,
            htmlContent: detail.htmlContent || null,
          });
        }
      }

      // 2) Düzenlediğim / Kesilen Faturalar (Satış)
      if (direction === 'all' || direction === 'satis') {
        const issuedRes = await dispatchGib(
          baseUrl,
          login.token,
          'EARSIV_PORTAL_TASLAKLARI_GETIR',
          'RG_BASITFATURA',
          {
            baslangic: startDate,
            bitis: endDate,
            hangiTip: '5000/30000',
          }
        );

        const list = Array.isArray(issuedRes.json?.data)
          ? (issuedRes.json?.data as Array<Record<string, unknown>>)
          : [];

        if (!issuedRes.ok && list.length === 0) {
          warnings.push('Düzenlediğiniz e-Arşiv belgeleri GİB servisinden okunamadı.');
        }

        for (const item of list.slice(0, 40)) {
          const ettn = String(item.ettn || '');
          const onayDurumu = String(item.onayDurumu || 'Onaylandı');
          const detail =
            includeXml && ettn
              ? await fetchGibInvoiceHtmlAndXml(baseUrl, login.token, ettn, onayDurumu)
              : {};

          invoices.push({
            ettn,
            belgeNumarasi: String(item.belgeNumarasi || ettn),
            tarih: gibDateToIso(String(item.belgeTarihi || '')),
            yon: 'satis',
            tip: String(item.belgeTuru || 'EARSIVFATURA'),
            unvan: String(item.aliciUnvanAdSoyad || item.unvan || 'GİB Alıcı'),
            vkn: String(item.aliciVknTckn || item.vknTckn || ''),
            toplamTutar: parseAmount(item.odenecekTutar ?? item.toplamTutar ?? item.malHizmetToplamTutari),
            paraBirimi: String(item.paraBirimi || 'TRY'),
            onayDurumu,
            xmlContent: detail.xmlContent || null,
            htmlContent: detail.htmlContent || null,
          });
        }
      }

      await logoutGibPortal(baseUrl, login.token, ortam);

      return jsonResponse({
        ok: true,
        invoices,
        warnings,
      });
    }

    await logoutGibPortal(baseUrl, login.token, ortam);
    return jsonResponse({ ok: false, error: `Bilinmeyen aksiyon: ${action}` }, 400);
  } catch (err: unknown) {
    return jsonResponse(
      {
        ok: false,
        fallbackSuggested: true,
        error: err instanceof Error ? err.message : 'GİB proxy işleminde beklenmeyen hata.',
      },
      500
    );
  }
});
