import assert from 'node:assert/strict';
import test from 'node:test';
import { isIosUserAgent } from '../src/lib/platform.ts';
import { buildWhatsAppShareUrl, formatWhatsAppPhone } from '../src/lib/linkHelper.ts';
import { parsePosPayParams } from '../src/lib/posService.ts';

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

test('parsePosPayParams parses ?pos_pay=... iyzico and PayTR payment link query strings', () => {
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

  assert.equal(parsePosPayParams('?tab=dashboard'), null);
});
