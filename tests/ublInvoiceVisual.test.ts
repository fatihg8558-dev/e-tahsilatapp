import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeBase64Utf8,
  formatInvoiceScenarioLabel,
  formatInvoiceTypeLabel,
  mapUblUnitCode,
  ParsedUblInvoice,
  sanitizeRenderedGibHtml,
} from '../src/lib/ublParser.ts';
import {
  buildFallbackInvoiceFromRecord,
  createCompactCloudDetay,
  getUblInvoiceSnapshot,
  hydrateParsedFromCompactDetay,
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

test('decodeBase64Utf8 accurately decodes UTF-8 Base64 containing Turkish characters', () => {
  const original = '<xsl:stylesheet>İADE ŞİRKETİ ĞÜÖÇ</xsl:stylesheet>';
  const b64 = Buffer.from(original, 'utf-8').toString('base64');
  // Satır sonları ve BOM simülasyonu ile dene
  const spaced = `  ${b64.slice(0, 12)}\n${b64.slice(12)}  `;
  assert.equal(decodeBase64Utf8(spaced), original);
});

test('sanitizeRenderedGibHtml strips scripts and inline handlers while preserving styles and tables', () => {
  const rawHtml =
    '<html><head><style>.gib-box{border:1px solid #000}</style><script>alert("xss")</script></head>' +
    '<body onload="evil()"><table onclick="steal()"><tr><td>Fatura Tutarı</td></tr></table>' +
    '<a href="javascript:alert(1)">Link</a></body></html>';

  const clean = sanitizeRenderedGibHtml(rawHtml);
  assert.ok(!clean.includes('<script'));
  assert.ok(!clean.includes('onload='));
  assert.ok(!clean.includes('onclick='));
  assert.ok(!clean.includes('javascript:alert'));
  assert.ok(clean.includes('.gib-box{border:1px solid #000}'));
  assert.ok(clean.includes('<table><tr><td>Fatura Tutarı</td></tr></table>'));
});

test('formatInvoiceTypeLabel and formatInvoiceScenarioLabel convert UBL codes to Turkish labels', () => {
  assert.equal(formatInvoiceTypeLabel('SATIS'), 'SATIŞ');
  assert.equal(formatInvoiceTypeLabel('TEVKIFAT'), 'TEVKİFAT');
  assert.equal(formatInvoiceTypeLabel('iade'), 'İADE');
  assert.equal(formatInvoiceScenarioLabel('TICARIFATURA'), 'TİCARİ FATURA');
  assert.equal(formatInvoiceScenarioLabel('EARSIVFATURA'), 'E-ARŞİV FATURA');
  assert.equal(formatInvoiceScenarioLabel('TEMELFATURA'), 'TEMEL FATURA');
});

test('createCompactCloudDetay omits heavy renderedGibHtml and hydrateParsedFromCompactDetay restores invoice details', () => {
  const sample = makeSampleInvoice({
    invoiceTypeCode: 'TEVKIFAT',
    hasEmbeddedXslt: true,
    renderedGibHtml: '<html><body><div>' + 'X'.repeat(40000) + '</div></body></html>',
  });

  const compact = createCompactCloudDetay(sample);
  const jsonText = JSON.stringify(compact);
  assert.ok(jsonText.length < 3000, `Compact JSON too large: ${jsonText.length}`);
  assert.equal('renderedGibHtml' in compact, false);
  assert.equal(compact.hasEmbeddedXslt, true);
  assert.equal(compact.lines.length, 1);

  const hydrated = hydrateParsedFromCompactDetay({
    fatura: {
      id: 'f-1',
      firma_id: 'firma-1',
      cari_id: 'cari-1',
      fatura_no: 'ACE2026000000189',
      tarih: '2026-10-15',
      tutar: 11800,
      yon: 'satis',
    },
    detay: compact,
  });

  assert.equal(hydrated.faturaNo, 'ACE2026000000189');
  assert.equal(hydrated.invoiceTypeCode, 'TEVKIFAT');
  assert.equal(hydrated.lines.length, 1);
  assert.equal(hydrated.lines[0].name, 'Endüstriyel Zeytinyağı 18L');
  assert.equal(hydrated.supplier.unvan, 'Atlas Toptan Gıda A.Ş.');
  assert.equal(hydrated.hasEmbeddedXslt, true);
  assert.equal(hydrated.renderedGibHtml, undefined);
});
