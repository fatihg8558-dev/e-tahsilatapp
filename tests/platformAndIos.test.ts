import assert from 'node:assert/strict';
import test from 'node:test';
import { isIosUserAgent } from '../src/lib/platform.ts';
import { buildWhatsAppShareUrl, formatWhatsAppPhone } from '../src/lib/linkHelper.ts';
import {
  DEFAULT_POS_CONFIG,
  DEFAULT_SHARED_WEB_URL,
  generatePaymentLink,
  isAndroidApkOrigin,
  isPrivateDevOrigin,
  normalizePublicWebUrl,
  parsePosPayParams,
  resolvePaymentLinkBaseUrl,
} from '../src/lib/posService.ts';

test('isIosUserAgent detects iPhone, iPad, iPod, and iPadOS Macintosh touch devices', () => {
  assert.equal(
    isIosUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15', 5),
    true
  );
  assert.equal(
    isIosUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 5),
    true
  );
  assert.equal(
    isIosUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5),
    true
  );
  assert.equal(
    isIosUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0),
    false
  );
  assert.equal(
    isIosUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 5),
    false
  );
});

test('formatWhatsAppPhone normalizes Turkish phone numbers to E.164', () => {
  assert.equal(formatWhatsAppPhone('0532 123 45 67'), '905321234567');
  assert.equal(formatWhatsAppPhone('5321234567'), '905321234567');
  assert.equal(formatWhatsAppPhone('+90 (532) 123-4567'), '905321234567');
  assert.equal(formatWhatsAppPhone(''), '');
});

test('buildWhatsAppShareUrl uses wa.me Universal Links for iOS and api.whatsapp.com for desktop/web', () => {
  const iosUrl = buildWhatsAppShareUrl('0532 123 45 67', 'Merhaba Tahsilatım', true);
  assert.equal(
    iosUrl,
    'https://wa.me/905321234567?text=Merhaba%20Tahsilat%C4%B1m'
  );

  const iosNoPhone = buildWhatsAppShareUrl(null, 'Makbuz', true);
  assert.equal(iosNoPhone, 'https://wa.me/?text=Makbuz');

  const webUrl = buildWhatsAppShareUrl('0532 123 45 67', 'Merhaba', false);
  assert.equal(
    webUrl,
    'https://api.whatsapp.com/send?phone=905321234567&text=Merhaba'
  );
});

test('parsePosPayParams parses ?pos_pay=..., short ?pay=..., and callback ?pay_status=... query strings', () => {
  const parsed = parsePosPayParams('?pos_pay=POS-123456&tut=1500.50&cari=Test%20Firma&prov=paytr');
  assert.deepEqual(parsed, {
    referenceNo: 'POS-123456',
    amount: 1500.5,
    customerName: 'Test Firma',
    provider: 'paytr',
  });

  const fallbackProv = parsePosPayParams('pos_pay=POS-999&tut=250');
  assert.deepEqual(fallbackProv, {
    referenceNo: 'POS-999',
    amount: 250,
    customerName: 'Müşteri',
    provider: 'iyzico',
  });

  const shortPay = parsePosPayParams('?pay=THS-ABC123&tut=750&prov=iyzico');
  assert.deepEqual(shortPay, {
    payCode: 'THS-ABC123',
    referenceNo: 'THS-ABC123',
    amount: 750,
    customerName: 'Müşteri',
    provider: 'iyzico',
  });

  const callbackSuccess = parsePosPayParams('?pay_status=success&ref=POS-888&prov=paytr&tut=320');
  assert.deepEqual(callbackSuccess, {
    referenceNo: 'POS-888',
    amount: 320,
    customerName: 'Müşteri',
    provider: 'paytr',
    payStatus: 'success',
  });

  assert.equal(parsePosPayParams('?tab=dashboard'), null);
});

test('origin guards and normalizePublicWebUrl reject Android APK WebView and flag private dev origins', () => {
  assert.equal(isAndroidApkOrigin('https://appassets.androidplatform.net/assets/index.html'), true);
  assert.equal(isAndroidApkOrigin('capacitor://localhost'), true);
  assert.equal(isAndroidApkOrigin('https://tahsilatim.com'), false);

  assert.equal(
    isPrivateDevOrigin('https://ais-dev-ow5iiixphenxsbz6fjufbo-543191284489.europe-west2.run.app'),
    true
  );
  assert.equal(isPrivateDevOrigin('http://localhost:5173'), true);
  assert.equal(isPrivateDevOrigin(DEFAULT_SHARED_WEB_URL), false);

  assert.equal(normalizePublicWebUrl('https://appassets.androidplatform.net'), '');
  assert.equal(normalizePublicWebUrl('odeme.tahsilatim.com/'), 'https://odeme.tahsilatim.com');
  assert.equal(normalizePublicWebUrl('https://odeme.tahsilatim.com/?x=1'), 'https://odeme.tahsilatim.com');
});

test('resolvePaymentLinkBaseUrl never leaks Android APK origin and uses configured publicWebUrl first', () => {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  try {
    (globalThis as Record<string, unknown>).window = {
      location: { origin: 'https://appassets.androidplatform.net' },
    };

    const withConfigured = resolvePaymentLinkBaseUrl({
      ...DEFAULT_POS_CONFIG,
      publicWebUrl: 'https://pos.ornekfirma.com/',
    });
    assert.equal(withConfigured.baseUrl, 'https://pos.ornekfirma.com');
    assert.equal(withConfigured.source, 'configured');
    assert.equal(withConfigured.warning, undefined);

    const apkFallback = resolvePaymentLinkBaseUrl(DEFAULT_POS_CONFIG);
    assert.equal(apkFallback.baseUrl, DEFAULT_SHARED_WEB_URL);
    assert.equal(apkFallback.source, 'shared_fallback');
    assert.ok(apkFallback.warning && apkFallback.warning.includes('Ayarlar > Sanal POS'));

    (globalThis as Record<string, unknown>).window = {
      location: { origin: 'https://ais-dev-ow5iiixphenxsbz6fjufbo-543191284489.europe-west2.run.app' },
    };
    const devFallback = resolvePaymentLinkBaseUrl(DEFAULT_POS_CONFIG);
    assert.equal(devFallback.baseUrl, DEFAULT_SHARED_WEB_URL);
    assert.equal(devFallback.source, 'shared_fallback');

    (globalThis as Record<string, unknown>).window = {
      location: { origin: 'https://app.gercekfirma.com' },
    };
    const publicBrowser = resolvePaymentLinkBaseUrl(DEFAULT_POS_CONFIG);
    assert.equal(publicBrowser.baseUrl, 'https://app.gercekfirma.com');
    assert.equal(publicBrowser.source, 'window');
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  }
});

test('generatePaymentLink builds iyzico, PayTR, and short ?pay= links even when posConfig provider is none', () => {
  const iyzicoRes = generatePaymentLink({
    amount: 1250.5,
    customerName: 'Deneme Müşteri',
    description: 'Fatura 102',
    config: DEFAULT_POS_CONFIG,
    providerOverride: 'iyzico',
    baseUrl: 'https://app.tahsilatim.com',
  });

  assert.ok(iyzicoRes.url.startsWith('https://app.tahsilatim.com/?pos_pay=POS-'));
  assert.ok(iyzicoRes.url.includes('&tut=1250.5&'));
  assert.ok(iyzicoRes.url.includes('&prov=iyzico'));
  assert.ok(iyzicoRes.message.includes('iyzico Güvenli Ödeme'));
  assert.ok(iyzicoRes.message.includes('Açıklama: Fatura 102'));

  const paytrRes = generatePaymentLink({
    amount: 500,
    customerName: 'Deneme 2',
    config: DEFAULT_POS_CONFIG,
    providerOverride: 'paytr',
    baseUrl: 'https://app.tahsilatim.com/',
  });

  assert.ok(paytrRes.url.includes('&prov=paytr'));
  assert.ok(paytrRes.message.includes('PayTR Güvenli Ödeme'));

  const shortCloudRes = generatePaymentLink({
    amount: 900,
    customerName: 'Bulut Cari',
    firmaName: 'Örnek Ticaret',
    payCode: 'THS-998877',
    config: { ...DEFAULT_POS_CONFIG, publicWebUrl: 'https://odeme.ornekticaret.com' },
    providerOverride: 'paytr',
  });
  assert.equal(shortCloudRes.url, 'https://odeme.ornekticaret.com/?pay=THS-998877');
  assert.equal(shortCloudRes.baseUrlSource, 'configured');
});

