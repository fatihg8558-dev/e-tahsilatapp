import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoDetectCariColumnMapping,
  buildSampleCariTemplateWorkbookBytes,
  evaluateCariImportRows,
  normalizeExcelTaxId,
  parseCariTurValue,
  parseFlexibleTurkishNumber,
  readCariSpreadsheetBuffer,
} from '../src/lib/cariExcelImport.ts';
import { Cari } from '../src/types/database.ts';

test('autoDetectCariColumnMapping recognizes Turkish and English headers', () => {
  const mapping1 = autoDetectCariColumnMapping([
    'Cari Unvanı',
    'VKN / TCKN',
    'Cari Türü',
    'Telefon',
    'E-posta',
    'Açılış Bakiyesi',
  ]);
  assert.deepEqual(mapping1, {
    unvan: 'Cari Unvanı',
    vergi_tc_no: 'VKN / TCKN',
    tur: 'Cari Türü',
    telefon: 'Telefon',
    email: 'E-posta',
    bakiye: 'Açılış Bakiyesi',
  });

  const mapping2 = autoDetectCariColumnMapping([
    'Firma Adı',
    'Vergi Kimlik No',
    'Tip',
    'GSM',
    'Mail',
    'Devir',
  ]);
  assert.deepEqual(mapping2, {
    unvan: 'Firma Adı',
    vergi_tc_no: 'Vergi Kimlik No',
    tur: 'Tip',
    telefon: 'GSM',
    email: 'Mail',
    bakiye: 'Devir',
  });
});

test('parseFlexibleTurkishNumber handles Turkish formats, (B)/(A) suffixes, and invalid strings', () => {
  assert.deepEqual(parseFlexibleTurkishNumber('12.500,50'), { value: 12500.5, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber('-4.750,00'), { value: -4750, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber('5.000 (A)'), { value: -5000, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber('3.000 (B)'), { value: 3000, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber('1.250,75 TL'), { value: 1250.75, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber(8420.125), { value: 8420.13, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber(''), { value: 0, valid: true });
  assert.deepEqual(parseFlexibleTurkishNumber('-'), { value: 0, valid: true });

  const invalid = parseFlexibleTurkishNumber('on bin tl');
  assert.equal(invalid.valid, false);
});

test('parseCariTurValue and normalizeExcelTaxId handle variations cleanly', () => {
  assert.deepEqual(parseCariTurValue('Alıcı'), { tur: 'alici', valid: true });
  assert.deepEqual(parseCariTurValue('Müşteri'), { tur: 'alici', valid: true });
  assert.deepEqual(parseCariTurValue('Tedarikçi'), { tur: 'tedarikci', valid: true });
  assert.deepEqual(parseCariTurValue('Satıcı Firma'), { tur: 'tedarikci', valid: true });
  assert.deepEqual(parseCariTurValue('', 'tedarikci'), { tur: 'tedarikci', valid: true });
  assert.deepEqual(parseCariTurValue('Diğer', 'alici'), { tur: 'alici', valid: false });

  assert.equal(normalizeExcelTaxId(1234567890), '1234567890');
  assert.equal(normalizeExcelTaxId('1234567890.0'), '1234567890');
  assert.equal(normalizeExcelTaxId(' 987 654 3210 '), '9876543210');
});

test('readCariSpreadsheetBuffer round-trips sample XLSX workbook and parses UTF-8 BOM semicolon CSV', () => {
  const xlsxBytes = buildSampleCariTemplateWorkbookBytes();
  const xlsxBuffer = xlsxBytes.buffer.slice(
    xlsxBytes.byteOffset,
    xlsxBytes.byteOffset + xlsxBytes.byteLength
  );
  const parsedXlsx = readCariSpreadsheetBuffer(xlsxBuffer, 'ornek_cari_yukleme_sablonu.xlsx');
  assert.equal(parsedXlsx.headers.length, 6);
  assert.equal(parsedXlsx.rows.length, 2);
  assert.equal(parsedXlsx.rows[0]['Cari Unvanı'], 'Örnek Müşteri Ticaret A.Ş.');
  assert.equal(parsedXlsx.rows[1]['VKN / TCKN'], '9876543210');

  const csvContent =
    '\uFEFFCari Unvanı;VKN / TCKN;Cari Türü;Telefon;E-posta;Açılış Bakiyesi\n' +
    '"Marmara Gıda Ltd. Şti.";1112223334;Alıcı;05320001122;info@marmara.com;"7.250,40"\n' +
    '"Ege Lojistik A.Ş.";5556667778;Tedarikçi;02321112233;finans@egelojistik.com;"-2.100,00"\n';
  const encoded = new TextEncoder().encode(csvContent);
  const parsedCsv = readCariSpreadsheetBuffer(encoded.buffer, 'cariler.csv');
  assert.equal(parsedCsv.headers[0], 'Cari Unvanı');
  assert.equal(parsedCsv.rows.length, 2);
  assert.equal(parsedCsv.rows[0]['Cari Unvanı'], 'Marmara Gıda Ltd. Şti.');
  assert.equal(parsedCsv.rows[0]['Açılış Bakiyesi'], '7.250,40');
  assert.equal(parsedCsv.rows[1]['Cari Türü'], 'Tedarikçi');
});

test('evaluateCariImportRows validates errors, file duplicates, and existing DB matches', () => {
  const existingCariler: Cari[] = [
    {
      id: 'c-existing',
      firma_id: 'f-1',
      unvan: 'Mevcut Kayıt A.Ş.',
      vergi_tc_no: '1234567890',
      telefon: '02120000000',
      email: 'mevcut@firma.com',
      bakiye: 5000,
      tur: 'alici',
    },
  ];

  const headers = [
    'Cari Unvanı',
    'VKN / TCKN',
    'Cari Türü',
    'Telefon',
    'E-posta',
    'Açılış Bakiyesi',
  ];
  const mapping = autoDetectCariColumnMapping(headers);

  const rawRows = [
    // 1. Geçerli yeni cari
    {
      'Cari Unvanı': 'Yeni Müşteri Ltd.',
      'VKN / TCKN': '2223334445',
      'Cari Türü': 'Alıcı',
      Telefon: '05331234567',
      'E-posta': 'yeni@musteri.com',
      'Açılış Bakiyesi': '1.500,25',
    },
    // 2. DB'de mevcut VKN -> existing_vkn, varsayılan skip
    {
      'Cari Unvanı': 'Mevcut Kayıt A.Ş. (Güncel)',
      'VKN / TCKN': '1234567890',
      'Cari Türü': 'Alıcı',
      Telefon: '02129998877',
      'E-posta': 'yeni@firma.com',
      'Açılış Bakiyesi': '9.000',
    },
    // 3. Dosya içi VKN tekrarı -> error
    {
      'Cari Unvanı': 'Tekrar VKN Şirketi',
      'VKN / TCKN': '2223334445',
      'Cari Türü': 'Tedarikçi',
      Telefon: '',
      'E-posta': '',
      'Açılış Bakiyesi': '0',
    },
    // 4. Unvan boş + bakiye hatalı + e-posta hatalı -> error
    {
      'Cari Unvanı': '   ',
      'VKN / TCKN': '9998887776',
      'Cari Türü': 'Tedarikçi',
      Telefon: '',
      'E-posta': 'hatali-mail',
      'Açılış Bakiyesi': 'abc',
    },
  ];

  const evaluated = evaluateCariImportRows({
    rawRows,
    mapping,
    existingCariler,
    defaultTur: 'alici',
  });

  assert.equal(evaluated.length, 4);

  // Row 1
  assert.equal(evaluated[0].rowIndex, 2);
  assert.equal(evaluated[0].status, 'valid_new');
  assert.equal(evaluated[0].include, true);
  assert.equal(evaluated[0].bakiye, 1500.25);

  // Row 2
  assert.equal(evaluated[1].rowIndex, 3);
  assert.equal(evaluated[1].status, 'existing_vkn');
  assert.equal(evaluated[1].existingAction, 'skip');
  assert.equal(evaluated[1].include, false);
  assert.equal(evaluated[1].matchedExistingCari?.id, 'c-existing');

  // Row 3 (dosya içi tekrar VKN)
  assert.equal(evaluated[2].rowIndex, 4);
  assert.equal(evaluated[2].status, 'error');
  assert.equal(evaluated[2].include, false);
  assert.ok(evaluated[2].errors.some((e) => e.includes('tekrar ediyor')));

  // Row 4 (boş unvan, geçersiz bakiye, geçersiz email)
  assert.equal(evaluated[3].rowIndex, 5);
  assert.equal(evaluated[3].status, 'error');
  assert.equal(evaluated[3].include, false);
  assert.equal(evaluated[3].errors.length, 3);
});
