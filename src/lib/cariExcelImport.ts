import * as XLSX from 'xlsx';
import { Cari, CariTur } from '../types/database';
import { exportToExcel } from './exportService';
import { normalizeTaxId } from './ublParser';

export type CariImportField =
  | 'unvan'
  | 'vergi_tc_no'
  | 'tur'
  | 'telefon'
  | 'email'
  | 'bakiye';

export type CariColumnMapping = Record<CariImportField, string | null>;

export type CariImportRowStatus = 'valid_new' | 'existing_vkn' | 'error';
export type ExistingCariAction = 'skip' | 'update';

export interface ParsedCariImportRow {
  rowIndex: number; // Excel satır numarası (başlık 1 ise veri 2'den başlar)
  unvan: string;
  vergiTcNo: string;
  tur: CariTur;
  telefon: string;
  email: string;
  bakiye: number;
  status: CariImportRowStatus;
  matchedExistingCari: Cari | null;
  existingAction: ExistingCariAction;
  include: boolean;
  errors: string[];
  warnings: string[];
  rawRow: Record<string, string>;
}

const normalizeHeaderKey = (raw: string): string =>
  (raw || '')
    .replace(/\uFEFF/g, '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const FIELD_HEADER_SYNONYMS: Record<CariImportField, string[]> = {
  unvan: [
    'cari unvani',
    'cari unvan',
    'unvan',
    'unvani',
    'cari adi',
    'cari ad',
    'firma unvani',
    'firma adi',
    'firma',
    'musteri adi',
    'musteri',
    'ad soyad',
    'isim',
    'title',
    'company',
    'name',
  ],
  vergi_tc_no: [
    'vkn tckn',
    'vkn/tckn',
    'vergi tckn',
    'vergi tc no',
    'vergi no',
    'vergi kimlik no',
    'vergi kimlik',
    'vkn',
    'tckn',
    'tc kimlik',
    'tc no',
    'tc',
    'tax id',
  ],
  tur: [
    'cari turu',
    'cari tur',
    'tur',
    'turu',
    'tip',
    'hesap turu',
    'cari tipi',
    'alici tedarikci',
    'grup',
    'type',
  ],
  telefon: [
    'telefon',
    'tel',
    'cep telefonu',
    'cep',
    'gsm',
    'mobil',
    'phone',
    'mobile',
  ],
  email: [
    'e posta',
    'eposta',
    'e mail',
    'email',
    'mail',
    'mail adresi',
  ],
  bakiye: [
    'acilis bakiyesi',
    'acilis bakiye',
    'devir bakiyesi',
    'devir bakiye',
    'bakiye',
    'guncel bakiye',
    'net bakiye',
    'devir',
    'opening balance',
    'balance',
  ],
};

export function autoDetectCariColumnMapping(headers: string[]): CariColumnMapping {
  const mapping: CariColumnMapping = {
    unvan: null,
    vergi_tc_no: null,
    tur: null,
    telefon: null,
    email: null,
    bakiye: null,
  };

  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    norm: normalizeHeaderKey(h),
  }));

  const usedHeaders = new Set<string>();

  (Object.keys(FIELD_HEADER_SYNONYMS) as CariImportField[]).forEach((field) => {
    const synonyms = FIELD_HEADER_SYNONYMS[field];

    // 1. Tam eşleşme öncelikli
    for (const syn of synonyms) {
      const exact = normalizedHeaders.find((h) => !usedHeaders.has(h.raw) && h.norm === syn);
      if (exact) {
        mapping[field] = exact.raw;
        usedHeaders.add(exact.raw);
        return;
      }
    }

    // 2. Kısmi kapsama eşleşmesi
    for (const syn of synonyms) {
      if (syn.length < 3) continue;
      const partial = normalizedHeaders.find(
        (h) => !usedHeaders.has(h.raw) && (h.norm.includes(syn) || syn.includes(h.norm))
      );
      if (partial && partial.norm.length >= 2) {
        mapping[field] = partial.raw;
        usedHeaders.add(partial.raw);
        return;
      }
    }
  });

  return mapping;
}

export function normalizeExcelTaxId(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let text = String(raw).trim();
  if (!text) return '';

  // Excel sayısal hücrelerde ".0" veya bilimsel gösterim geldiyse düzelt
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    text = Math.trunc(raw).toString();
  } else if (/^\d+[.,]0+$/.test(text)) {
    text = text.replace(/[.,]0+$/, '');
  }

  return normalizeTaxId(text);
}

export function parseCariTurValue(
  raw: unknown,
  defaultTur: CariTur = 'alici'
): { tur: CariTur; valid: boolean } {
  const str = normalizeHeaderKey(String(raw ?? ''));
  if (!str) return { tur: defaultTur, valid: true };

  if (
    str === 'alici' ||
    str === 'musteri' ||
    str === 'satis' ||
    str === 'a' ||
    str.includes('alici') ||
    str.includes('musteri')
  ) {
    return { tur: 'alici', valid: true };
  }

  if (
    str === 'tedarikci' ||
    str === 'satici' ||
    str === 'alis' ||
    str === 't' ||
    str.includes('tedarik') ||
    str.includes('satici')
  ) {
    return { tur: 'tedarikci', valid: true };
  }

  return { tur: defaultTur, valid: false };
}

export function parseFlexibleTurkishNumber(raw: unknown): { value: number; valid: boolean } {
  if (raw === null || raw === undefined) return { value: 0, valid: true };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: 0, valid: false };
    return { value: Math.round(raw * 100) / 100, valid: true };
  }

  let text = String(raw).trim();
  if (!text || text === '-' || text === '—') return { value: 0, valid: true };

  // (B) Borçlu (+), (A) Alacaklı (-) son eklerini destekle
  let signMultiplier = 1;
  if (/\(\s*a\s*\)$/i.test(text) || /\balacak/i.test(text)) {
    signMultiplier = -1;
  } else if (/\(\s*b\s*\)$/i.test(text) || /\bborc/i.test(text)) {
    signMultiplier = 1;
  }

  text = text
    .replace(/\(\s*[ab]\s*\)/gi, '')
    .replace(/(tl|try|usd|eur|₺|\$|€|borç|borc|alacak)/gi, '')
    .replace(/\s+/g, '')
    .trim();

  if (!text) return { value: 0, valid: false };

  if (text.startsWith('-')) {
    signMultiplier *= -1;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  // Sadece rakam, nokta ve virgül içermeli
  if (!/^\d[\d.,]*$/.test(text)) {
    return { value: 0, valid: false };
  }

  let normalized = text;
  if (text.includes(',') && text.includes('.')) {
    // Son ayırıcı ondalık ayracıdır
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    // 12.500 veya 1.250.000 gibi binlik noktalı değerler
    normalized = text.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return { value: 0, valid: false };
  }

  const signed = Math.round(parsed * signMultiplier * 100) / 100;
  return { value: Object.is(signed, -0) ? 0 : signed, valid: true };
}

function normalizeNameKey(raw: string): string {
  return (raw || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

function isValidEmailFormat(email: string): boolean {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function evaluateCariImportRows(params: {
  rawRows: Record<string, unknown>[];
  mapping: CariColumnMapping;
  existingCariler: Cari[];
  defaultTur?: CariTur;
}): ParsedCariImportRow[] {
  const { rawRows, mapping, existingCariler, defaultTur = 'alici' } = params;

  const existingByVkn = new Map<string, Cari>();
  const existingByName = new Map<string, Cari>();
  for (const c of existingCariler) {
    const normVkn = normalizeTaxId(c.vergi_tc_no);
    if (normVkn && !existingByVkn.has(normVkn)) {
      existingByVkn.set(normVkn, c);
    }
    const normName = normalizeNameKey(c.unvan);
    if (normName && !existingByName.has(normName)) {
      existingByName.set(normName, c);
    }
  }

  const seenVknInFile = new Map<string, number>();
  const seenNameInFile = new Map<string, number>();

  return rawRows.map((raw, idx) => {
    const excelRowNo = idx + 2;
    const rawStringRow: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      rawStringRow[k] = v === null || v === undefined ? '' : String(v);
    }

    const readCell = (field: CariImportField): unknown => {
      const col = mapping[field];
      return col ? raw[col] : '';
    };

    const unvan = String(readCell('unvan') ?? '').trim();
    const vergiTcNo = normalizeExcelTaxId(readCell('vergi_tc_no'));
    const telefon = String(readCell('telefon') ?? '').trim();
    const email = String(readCell('email') ?? '').trim();
    const turParsed = parseCariTurValue(readCell('tur'), defaultTur);
    const bakiyeParsed = parseFlexibleTurkishNumber(readCell('bakiye'));

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!unvan) {
      errors.push('Cari unvanı boş olamaz.');
    }
    if (!bakiyeParsed.valid) {
      errors.push(`Açılış bakiyesi okunamadı ("${String(readCell('bakiye') ?? '')}").`);
    }
    if (!turParsed.valid) {
      warnings.push(
        `Cari türü tanınamadı ("${String(readCell('tur') ?? '')}"), varsayılan (${
          defaultTur === 'alici' ? 'Alıcı' : 'Tedarikçi'
        }) uygulanacak.`
      );
    }
    if (email && !isValidEmailFormat(email)) {
      errors.push(`Geçersiz e-posta adresi ("${email}").`);
    }
    if (vergiTcNo && vergiTcNo.length !== 10 && vergiTcNo.length !== 11) {
      warnings.push(`VKN 10 veya TCKN 11 hane olmalıdır (girilen: ${vergiTcNo.length} hane).`);
    }

    // Dosya içi mükerrer kontrolü
    if (vergiTcNo) {
      const prevRow = seenVknInFile.get(vergiTcNo);
      if (prevRow !== undefined) {
        errors.push(`Bu VKN/TCKN (${vergiTcNo}) dosya içinde ${prevRow}. satırda tekrar ediyor.`);
      } else {
        seenVknInFile.set(vergiTcNo, excelRowNo);
      }
    } else if (unvan) {
      const nameKey = normalizeNameKey(unvan);
      const prevRow = seenNameInFile.get(nameKey);
      if (prevRow !== undefined) {
        errors.push(`Bu cari unvanı dosya içinde ${prevRow}. satırda tekrar ediyor.`);
      } else {
        seenNameInFile.set(nameKey, excelRowNo);
      }
    }

    // Sistemdeki mevcut cari eşleşmesi
    let matchedExisting: Cari | null = null;
    if (vergiTcNo) {
      matchedExisting = existingByVkn.get(vergiTcNo) || null;
    }
    if (!matchedExisting && unvan) {
      matchedExisting = existingByName.get(normalizeNameKey(unvan)) || null;
    }

    let status: CariImportRowStatus = 'valid_new';
    if (errors.length > 0) {
      status = 'error';
    } else if (matchedExisting) {
      status = 'existing_vkn';
      warnings.push(
        matchedExisting.vergi_tc_no && vergiTcNo
          ? `Sistemde aynı VKN ile kayıtlı: ${matchedExisting.unvan}`
          : `Sistemde aynı unvan ile kayıtlı: ${matchedExisting.unvan}`
      );
    }

    return {
      rowIndex: excelRowNo,
      unvan,
      vergiTcNo,
      tur: turParsed.tur,
      telefon,
      email,
      bakiye: bakiyeParsed.valid ? bakiyeParsed.value : 0,
      status,
      matchedExistingCari: matchedExisting,
      existingAction: 'skip',
      include: status === 'valid_new',
      errors,
      warnings,
      rawRow: rawStringRow,
    };
  });
}

function parseCsvTextToRows(csvText: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const cleaned = csvText.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const firstLine = lines[0];
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter =
    tabCount > semiCount && tabCount > commaCount ? '\t' : semiCount >= commaCount ? ';' : ',';

  const splitCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const rawHeaders = splitCsvLine(lines[0]).map((h, i) => h || `Sütun ${i + 1}`);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    if (vals.every((v) => !v)) continue;
    const obj: Record<string, unknown> = {};
    rawHeaders.forEach((header, idx) => {
      obj[header] = vals[idx] ?? '';
    });
    rows.push(obj);
  }
  return { headers: rawHeaders, rows };
}

export function readCariSpreadsheetBuffer(
  buffer: ArrayBuffer,
  fileName: string
): { headers: string[]; rows: Record<string, unknown>[] } {
  const lower = (fileName || '').toLowerCase();

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const bytes = new Uint8Array(buffer);
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    // UTF-8 decode bozuk karakter ürettiyse Türkçe Windows-1254 dene
    if (text.includes('\uFFFD')) {
      try {
        text = new TextDecoder('windows-1254', { fatal: false }).decode(bytes);
      } catch {
        // UTF-8 çıktıyla devam et
      }
    }
    return parseCsvTextToRows(text);
  }

  const workbook = XLSX.read(buffer, { type: 'array', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { headers: [], rows: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  const nonEmptyMatrix = matrix.filter(
    (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim() !== '')
  );

  if (nonEmptyMatrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerRow = nonEmptyMatrix[0].map((cell, idx) => {
    const text = String(cell ?? '').trim();
    return text || `Sütun ${idx + 1}`;
  });

  // Yinelenen başlık adlarını benzersizleştir
  const seenHeaders = new Map<string, number>();
  const uniqueHeaders = headerRow.map((h) => {
    const count = seenHeaders.get(h) || 0;
    seenHeaders.set(h, count + 1);
    return count === 0 ? h : `${h} (${count + 1})`;
  });

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < nonEmptyMatrix.length; i++) {
    const rowArr = nonEmptyMatrix[i];
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    uniqueHeaders.forEach((h, colIdx) => {
      const val = rowArr[colIdx] ?? '';
      if (String(val).trim() !== '') hasValue = true;
      obj[h] = val;
    });
    if (hasValue) {
      rows.push(obj);
    }
  }

  return { headers: uniqueHeaders, rows };
}

export function buildSampleCariTemplateWorkbookBytes(): Uint8Array {
  const sampleData = [
    {
      'Cari Unvanı': 'Örnek Müşteri Ticaret A.Ş.',
      'VKN / TCKN': '1234567890',
      'Cari Türü': 'Alıcı',
      Telefon: '05321112233',
      'E-posta': 'muhasebe@ornekmusteri.com',
      'Açılış Bakiyesi': '12.500,00',
    },
    {
      'Cari Unvanı': 'Anadolu Tedarik Ltd. Şti.',
      'VKN / TCKN': '9876543210',
      'Cari Türü': 'Tedarikçi',
      Telefon: '02124445566',
      'E-posta': 'finans@anadolutedarik.com',
      'Açılış Bakiyesi': '-4.750,50',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  worksheet['!cols'] = [
    { wch: 32 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 28 },
    { wch: 18 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Cariler');
  const rawOutput = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayLike<number>;
  return new Uint8Array(rawOutput);
}

export function downloadCariExcelTemplate(): void {
  const bytes = buildSampleCariTemplateWorkbookBytes();
  const blob = new Blob([bytes.slice().buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ornek_cari_yukleme_sablonu.xlsx';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 1000);
}

export function exportCariImportErrorReport(errorRows: ParsedCariImportRow[]): void {
  if (errorRows.length === 0) return;
  const headers = [
    'Excel Satır No',
    'Cari Unvanı',
    'VKN / TCKN',
    'Cari Türü',
    'Telefon',
    'E-posta',
    'Açılış Bakiyesi',
    'Hata Nedeni',
  ];
  const rows = errorRows.map((r) => [
    r.rowIndex,
    r.unvan || '-',
    r.vergiTcNo || '-',
    r.tur === 'alici' ? 'Alıcı' : 'Tedarikçi',
    r.telefon || '-',
    r.email || '-',
    r.bakiye,
    r.errors.join(' | '),
  ]);
  exportToExcel(
    `cari_yukleme_hatali_satirlar_${new Date().toISOString().slice(0, 10)}`,
    headers,
    rows
  );
}
