// Supabase Edge Function: Gerçek iyzico (CheckoutForm IYZWSv2) & PayTR (iFrame API get-token) Gateway
// Dağıtım: supabase functions deploy pos-payment-gateway --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(sig);
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toBase64(sig);
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName || 'Sayın Müşteri').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] || 'Müşteri', lastName: 'Firma' };
  }
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  return { firstName, lastName };
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

interface FirmaPosSecrets {
  provider?: string;
  testMode?: boolean;
  iyzicoApiKey?: string;
  iyzicoSecretKey?: string;
  iyzicoBaseUrl?: string;
  paytrMerchantId?: string;
  paytrMerchantKey?: string;
  paytrMerchantSalt?: string;
}

async function resolveFirmaPosSecrets(firmaId?: string): Promise<FirmaPosSecrets> {
  const envDefaults: FirmaPosSecrets = {
    iyzicoApiKey: Deno.env.get('IYZICO_API_KEY') || '',
    iyzicoSecretKey: Deno.env.get('IYZICO_SECRET_KEY') || '',
    iyzicoBaseUrl: Deno.env.get('IYZICO_BASE_URL') || 'https://sandbox-api.iyzipay.com',
    paytrMerchantId: Deno.env.get('PAYTR_MERCHANT_ID') || '',
    paytrMerchantKey: Deno.env.get('PAYTR_MERCHANT_KEY') || '',
    paytrMerchantSalt: Deno.env.get('PAYTR_MERCHANT_SALT') || '',
  };

  if (!firmaId) return envDefaults;

  const admin = getSupabaseAdmin();
  if (!admin) return envDefaults;

  try {
    const { data } = await admin
      .from('firma_pos_ayarlari')
      .select('*')
      .eq('firma_id', firmaId)
      .maybeSingle();

    if (!data) return envDefaults;
    return {
      provider: data.provider || envDefaults.provider,
      testMode: typeof data.test_mode === 'boolean' ? data.test_mode : true,
      iyzicoApiKey: data.iyzico_api_key || envDefaults.iyzicoApiKey,
      iyzicoSecretKey: data.iyzico_secret_key || envDefaults.iyzicoSecretKey,
      iyzicoBaseUrl: data.iyzico_base_url || envDefaults.iyzicoBaseUrl,
      paytrMerchantId: data.paytr_merchant_id || envDefaults.paytrMerchantId,
      paytrMerchantKey: data.paytr_merchant_key || envDefaults.paytrMerchantKey,
      paytrMerchantSalt: data.paytr_merchant_salt || envDefaults.paytrMerchantSalt,
    };
  } catch {
    return envDefaults;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const contentType = req.headers.get('content-type') || '';

    // 1. iyzico / PayTR Callback Webhook (POST form-urlencoded)
    const callbackType = url.searchParams.get('callback');
    if (callbackType === 'iyzico' && req.method === 'POST') {
      const form = await req.formData();
      const token = String(form.get('token') || '');
      const payCode = url.searchParams.get('pay_code') || '';
      const refNo = url.searchParams.get('ref') || '';
      const firmaId = url.searchParams.get('firma_id') || '';
      const returnBase = url.searchParams.get('return_base') || '';

      const secrets = await resolveFirmaPosSecrets(firmaId);
      const iyzBase = (secrets.iyzicoBaseUrl || 'https://sandbox-api.iyzipay.com').replace(/\/+$/, '');
      const uriPath = '/payment/iyzipos/checkoutform/auth/ecom/detail';
      const bodyStr = JSON.stringify({ locale: 'tr', conversationId: refNo || payCode, token });
      const randomKey = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const signature = await hmacSha256Hex(
        secrets.iyzicoSecretKey || '',
        `${randomKey}${uriPath}${bodyStr}`
      );
      const authPlain = `apiKey:${secrets.iyzicoApiKey}&randomKey:${randomKey}&signature:${signature}`;
      const authHeader = `IYZWSv2 ${btoa(authPlain)}`;

      const verifyRes = await fetch(`${iyzBase}${uriPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: bodyStr,
      });
      const verifyJson = await verifyRes.json();
      const isSuccess =
        verifyJson?.status === 'success' && verifyJson?.paymentStatus === 'SUCCESS';

      const admin = getSupabaseAdmin();
      if (admin && payCode) {
        await admin
          .from('odeme_linkleri')
          .update({
            durum: isSuccess ? 'odendi' : 'hata',
            gateway_token: token,
            odeme_tarihi: isSuccess ? new Date().toISOString() : null,
          })
          .eq('pay_code', payCode);
      }

      if (returnBase) {
        const redirectTarget = `${returnBase}/?pay_status=${isSuccess ? 'success' : 'failed'}&ref=${encodeURIComponent(
          refNo || payCode
        )}&prov=iyzico`;
        return Response.redirect(redirectTarget, 302);
      }

      return jsonResponse({ status: isSuccess ? 'success' : 'failed', detail: verifyJson });
    }

    if (callbackType === 'paytr' && req.method === 'POST') {
      const form = await req.formData();
      const merchantOid = String(form.get('merchant_oid') || '');
      const status = String(form.get('status') || '');
      const totalAmount = String(form.get('total_amount') || '');
      const hash = String(form.get('hash') || '');
      const firmaId = url.searchParams.get('firma_id') || '';

      const secrets = await resolveFirmaPosSecrets(firmaId);
      const expectedHash = await hmacSha256Base64(
        secrets.paytrMerchantKey || '',
        `${merchantOid}${secrets.paytrMerchantSalt || ''}${status}${totalAmount}`
      );

      if (hash !== expectedHash) {
        return new Response('PAYTR notification failed: bad hash', { status: 400 });
      }

      const admin = getSupabaseAdmin();
      if (admin && merchantOid) {
        await admin
          .from('odeme_linkleri')
          .update({
            durum: status === 'success' ? 'odendi' : 'hata',
            odeme_tarihi: status === 'success' ? new Date().toISOString() : null,
          })
          .eq('referans_no', merchantOid);
      }

      return new Response('OK', { status: 200 });
    }

    // 2. JSON API Çağrıları (health / initialize_checkout)
    const body = contentType.includes('application/json') ? await req.json() : {};
    const action = String(body?.action || url.searchParams.get('action') || 'health');

    if (action === 'health') {
      const hasIyzicoEnv = Boolean(Deno.env.get('IYZICO_API_KEY') && Deno.env.get('IYZICO_SECRET_KEY'));
      const hasPaytrEnv = Boolean(
        Deno.env.get('PAYTR_MERCHANT_ID') &&
          Deno.env.get('PAYTR_MERCHANT_KEY') &&
          Deno.env.get('PAYTR_MERCHANT_SALT')
      );
      return jsonResponse({
        ok: true,
        service: 'pos-payment-gateway',
        hasIyzicoEnv,
        hasPaytrEnv,
      });
    }

    if (action === 'initialize_checkout') {
      const provider = body?.provider === 'paytr' ? 'paytr' : 'iyzico';
      const amount = Number(body?.amount) || 0;
      const referenceNo = String(body?.referenceNo || `POS-${Date.now().toString().slice(-6)}`);
      const payCode = String(body?.payCode || '');
      const firmaId = String(body?.firmaId || '');
      const customerName = String(body?.customerName || 'Müşteri');
      const customerEmail = String(body?.customerEmail || 'tahsilat@musteri.com');
      const customerPhone = String(body?.customerPhone || '+905550000000');
      const returnBaseUrl = String(body?.returnBaseUrl || '').replace(/\/+$/, '');
      const clientIp =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('cf-connecting-ip') ||
        '85.34.78.112';

      if (!amount || amount <= 0) {
        return jsonResponse({ ok: false, error: 'Geçersiz ödeme tutarı.' }, 400);
      }

      const secrets = await resolveFirmaPosSecrets(firmaId);
      const functionBase = `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/pos-payment-gateway`;

      if (provider === 'iyzico') {
        if (!secrets.iyzicoApiKey || !secrets.iyzicoSecretKey) {
          return jsonResponse(
            {
              ok: false,
              code: 'MISSING_KEYS',
              error: 'iyzico API Key / Secret Key tanımlı değil.',
            },
            400
          );
        }

        const { firstName, lastName } = splitName(customerName);
        const priceStr = amount.toFixed(2);
        const iyzBase = (secrets.iyzicoBaseUrl || 'https://sandbox-api.iyzipay.com').replace(/\/+$/, '');
        const uriPath = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
        const callbackUrl = `${functionBase}?callback=iyzico&pay_code=${encodeURIComponent(
          payCode
        )}&ref=${encodeURIComponent(referenceNo)}&firma_id=${encodeURIComponent(
          firmaId
        )}&return_base=${encodeURIComponent(returnBaseUrl)}`;

        const iyzPayload = {
          locale: 'tr',
          conversationId: referenceNo,
          price: priceStr,
          paidPrice: priceStr,
          currency: 'TRY',
          basketId: referenceNo,
          paymentGroup: 'PRODUCT',
          callbackUrl,
          buyer: {
            id: payCode || referenceNo,
            name: firstName,
            surname: lastName,
            gsmNumber: customerPhone,
            email: customerEmail,
            identityNumber: '11111111110',
            registrationAddress: 'Türkiye',
            ip: clientIp,
            city: 'Istanbul',
            country: 'Turkey',
          },
          shippingAddress: {
            contactName: customerName,
            city: 'Istanbul',
            country: 'Turkey',
            address: 'Türkiye',
          },
          billingAddress: {
            contactName: customerName,
            city: 'Istanbul',
            country: 'Turkey',
            address: 'Türkiye',
          },
          basketItems: [
            {
              id: referenceNo,
              name: String(body?.description || `${customerName} Cari Tahsilatı`).slice(0, 100),
              category1: 'Tahsilat',
              itemType: 'VIRTUAL',
              price: priceStr,
            },
          ],
        };

        const bodyStr = JSON.stringify(iyzPayload);
        const randomKey = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
        const signature = await hmacSha256Hex(
          secrets.iyzicoSecretKey,
          `${randomKey}${uriPath}${bodyStr}`
        );
        const authPlain = `apiKey:${secrets.iyzicoApiKey}&randomKey:${randomKey}&signature:${signature}`;

        const iyzRes = await fetch(`${iyzBase}${uriPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `IYZWSv2 ${btoa(authPlain)}`,
          },
          body: bodyStr,
        });

        const iyzData = await iyzRes.json();
        if (iyzData?.status !== 'success') {
          return jsonResponse(
            {
              ok: false,
              error: iyzData?.errorMessage || 'iyzico ödeme oturumu başlatılamadı.',
              detail: iyzData,
            },
            400
          );
        }

        return jsonResponse({
          ok: true,
          provider: 'iyzico',
          token: iyzData.token,
          paymentPageUrl: iyzData.paymentPageUrl,
          checkoutFormContent: iyzData.checkoutFormContent,
        });
      }

      // PayTR iFrame API (get-token)
      if (!secrets.paytrMerchantId || !secrets.paytrMerchantKey || !secrets.paytrMerchantSalt) {
        return jsonResponse(
          {
            ok: false,
            code: 'MISSING_KEYS',
            error: 'PayTR Mağaza No / Key / Salt bilgileri tanımlı değil.',
          },
          400
        );
      }

      const merchantOid = referenceNo.replace(/[^a-zA-Z0-9]/g, '').slice(0, 64);
      const paymentAmount = Math.round(amount * 100);
      const currency = 'TL';
      const noInstallment = '0';
      const maxInstallment = '0';
      const testModeFlag = secrets.testMode ? '1' : '0';
      const basketArr = [[String(body?.description || 'Cari Tahsilat').slice(0, 80), amount.toFixed(2), 1]];
      const userBasket = btoa(unescape(encodeURIComponent(JSON.stringify(basketArr))));

      const hashStr = `${secrets.paytrMerchantId}${clientIp}${merchantOid}${customerEmail}${paymentAmount}${userBasket}${noInstallment}${maxInstallment}${currency}${testModeFlag}`;
      const paytrToken = await hmacSha256Base64(
        secrets.paytrMerchantKey,
        `${hashStr}${secrets.paytrMerchantSalt}`
      );

      const okUrl = returnBaseUrl
        ? `${returnBaseUrl}/?pay_status=success&ref=${encodeURIComponent(merchantOid)}&prov=paytr`
        : 'https://www.paytr.com';
      const failUrl = returnBaseUrl
        ? `${returnBaseUrl}/?pay_status=failed&ref=${encodeURIComponent(merchantOid)}&prov=paytr`
        : 'https://www.paytr.com';

      const formBody = new URLSearchParams({
        merchant_id: secrets.paytrMerchantId,
        user_ip: clientIp,
        merchant_oid: merchantOid,
        email: customerEmail,
        payment_amount: String(paymentAmount),
        paytr_token: paytrToken,
        user_basket: userBasket,
        debug_on: testModeFlag,
        no_installment: noInstallment,
        max_installment: maxInstallment,
        user_name: customerName,
        user_address: 'Türkiye',
        user_phone: customerPhone,
        merchant_ok_url: okUrl,
        merchant_fail_url: failUrl,
        timeout_limit: '30',
        currency,
        test_mode: testModeFlag,
        iframe_v2: '1',
      });

      const paytrRes = await fetch('https://www.paytr.com/odeme/api/get-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody.toString(),
      });
      const paytrData = await paytrRes.json();
      if (paytrData?.status !== 'success' || !paytrData?.token) {
        return jsonResponse(
          {
            ok: false,
            error: paytrData?.reason || 'PayTR ödeme oturumu başlatılamadı.',
          },
          400
        );
      }

      return jsonResponse({
        ok: true,
        provider: 'paytr',
        token: paytrData.token,
        iframeUrl: `https://www.paytr.com/odeme/guvenli/${paytrData.token}`,
      });
    }

    return jsonResponse({ ok: false, error: 'Desteklenmeyen işlem.' }, 400);
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Sunucu hatası oluştu.' },
      500
    );
  }
});
