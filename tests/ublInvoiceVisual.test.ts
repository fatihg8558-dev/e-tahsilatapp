import assert from 'node:assert/strict';
import test from 'node:test';
import { mapUblUnitCode, ParsedUblInvoice } from '../src/lib/ublParser.ts';
import {
  buildFallbackInvoiceFromRecord,
  getUblInvoiceSnapshot,
  saveUblInvoiceSnapshots,
  StorageLike,
} from '../src/lib/ublInvoiceStore.ts';
import { buildPrintableUblInvoiceHtml } from '../src/components/cari/UblInvoicePreviewModal.tsx';
import { isWebPlatform } from '../src/lib/platform.ts';

function createMemoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

function makeSampleInvoice(overrides: Partial<ParsedUblInvoice> = {}): ParsedUblInvoice {
  return {
    fileName: 'GIB2026000000101.xml',
    faturaNo: 'GIB2026000000101',
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    profileId: 'TICARIFATURA',
    tarih: '2026-11-15',
    issueTime: '14:35:10',
    invoiceTypeCode: 'SATIS',
    currencyCode: 'TRY',
    exchangeRate: 1,
    originalAmount: 11800,
    tutarTL: 11800,
    supplier: {
      vkn: '1234567890',
      unvan: 'Atlas Toptan Gıda A.Ş.',
      telefon: '0212 555 00 11',
      email: 'efatura@atlasgida.com',
      vergiDairesi: 'Büyük Mükellefler',
      adres: 'Atatürk Cad. No:42, Kadıköy / İstanbul, Türkiye',
      web: 'https://atlasgida.com',
    },
    customer: {
      vkn: '9876543210',
      unvan: 'Anadolu Market Ltd. Şti.',
      telefon: '0312 444 22 33',
      email: 'muhasebe@anadolumarket.com',
      vergiDairesi: 'Çankaya',
      adres: 'Tunalı Hilmi Cad. No:15, Çankaya / Ankara, Türkiye',
      web: '',
    },
    detectedYon: 'satis',
    detectionReason: 'Satıcı VKN eşleşti',
    notes: ['İrsaliye No: IRS-2026-44', 'Vade: 30 Gün'],
    lines: [
      {
        lineId: '1',
        name: 'Endüstriyel Zeytinyağı 18L',
        description: 'Soğuk sıkım natürel sızma',
        sellerCode: 'ZY-18L',
        quantity: 2,
        unitCode: 'C62',
        unitLabel: 'Adet',
        unitPrice: 5000,
        discountAmount: 0,
        discountRate: 0,
        kdvRate: 18,
        kdvAmount: 1800,
        lineExtensionAmount: 10000,
      },
    ],
    totals: {
      lineExtensionAmount: 10000,
      allowanceTotalAmount: 0,
      taxExclusiveAmount: 10000,
      taxTotalAmount: 1800,
      withholdingTaxAmount: 0,
      taxInclusiveAmount: 11800,
      payableAmount: 11800,
      taxSubtotals: [
        {
          percent: 18,
          taxableAmount: 10000,
          taxAmount: 1800,
        },
      ],
    },
    ...overrides,
  };
}

test('mapUblUnitCode converts UBL standard unit codes to Turkish labels', () => {
  assert.equal(mapUblUnitCode('C62'), 'Adet');
  assert.equal(mapUblUnitCode('kgm'), 'Kg');
  assert.equal(mapUblUnitCode('MTR'), 'Mt');
  assert.equal(mapUblUnitCode('LTR'), 'Lt');
  assert.equal(mapUblUnitCode('CUSTOM'), 'CUSTOM');
  assert.equal(mapUblUnitCode(''), 'Adet');
});

test('ublInvoiceStore saves, retrieves by firmaId + faturaNo + yon, and isolates firms', () => {
  const storage = createMemoryStorage();
  const sample = makeSampleInvoice();

  saveUblInvoiceSnapshots('firma-1', [{ yon: 'satis', parsed: sample }], storage);

  const hit = getUblInvoiceSnapshot('firma-1', ' gib2026000000101 ', 'satis', storage);
  assert.ok(hit);
  assert.equal(hit.invoice.uuid, sample.uuid);
  assert.equal(hit.invoice.lines.length, 1);
  assert.equal(hit.yon, 'satis');

  const otherFirmaMiss = getUblInvoiceSnapshot('firma-2', 'GIB2026000000101', 'satis', storage);
  assert.equal(otherFirmaMiss, null);
});

test('buildFallbackInvoiceFromRecord creates a safe summary invoice for older DB entries', () => {
  const fallback = buildFallbackInvoiceFromRecord({
    faturaNo: 'FAT-2026-09',
    tarih: '2026-10-15',
    tutar: 4520.5,
    yon: 'alis',
    firma: {
      id: 'firma-1',
      unvan: 'Benim Firmam Ltd.',
      vergi_no: '1111111111',
    },
    cari: {
      id: 'cari-1',
      firma_id: 'firma-1',
      unvan: 'Tedarikçi A.Ş.',
      vergi_tc_no: '2222222222',
      bakiye: -4520.5,
      tur: 'tedarikci',
    },
  });

  assert.equal(fallback.faturaNo, 'FAT-2026-09');
  assert.equal(fallback.supplier.unvan, 'Tedarikçi A.Ş.');
  assert.equal(fallback.customer.unvan, 'Benim Firmam Ltd.');
  assert.equal(fallback.totals.payableAmount, 4520.5);
  assert.equal(fallback.lines.length, 0);
});

test('buildPrintableUblInvoiceHtml generates complete e-Fatura / e-Arşiv visual HTML', () => {
  const sample = makeSampleInvoice({
    profileId: 'EARSIVFATURA',
    supplier: {
      vkn: '1234567890',
      unvan: 'Atlas <Test> & Co.',
      telefon: '0212 555 00 11',
      email: 'efatura@atlasgida.com',
      vergiDairesi: 'Büyük Mükellefler',
      adres: 'Kadıköy / İstanbul',
      web: '',
    },
  });

  const html = buildPrintableUblInvoiceHtml(sample, 'satis');
  assert.ok(html.includes('E-ARŞİV FATURA'));
  assert.ok(html.includes('GIB2026000000101'));
  assert.ok(html.includes('550e8400-e29b-41d4-a716-446655440000'));
  assert.ok(html.includes('Atlas &lt;Test&gt; &amp; Co.'));
  assert.ok(html.includes('Endüstriyel Zeytinyağı 18L'));
  assert.ok(html.includes('Hesaplanan KDV (%18)'));
  assert.ok(html.includes('Yalnızca On Bir Bin Sekiz Yüz Türk Lirası'));
});

test('isWebPlatform returns false when AndroidBridge is present and true on Web', () => {
  const g = globalThis as unknown as { window?: { AndroidBridge?: unknown } };
  const prevWindow = g.window;

  try {
    g.window = {};
    assert.equal(isWebPlatform(), true);

    g.window = { AndroidBridge: {} };
    assert.equal(isWebPlatform(), false);
  } finally {
    g.window = prevWindow;
  }
});
