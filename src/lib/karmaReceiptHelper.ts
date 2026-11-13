import { Islem, IslemTur } from '../types/database';
import { ExchangeRates } from './currencyService';

export type KarmaSaveMode = 'ortak_tur_bazli' | 'tek_satir';

export interface CekRowItem {
  id: string;
  no: string;
  vade: string;
  banka: string;
  durum: 'ciro' | 'keside';
  tutar: string;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  kur?: string;
  existingIslemId?: string;
}

export interface KarmaNakitState {
  tutar: string;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  kur: string;
  existingIslemId?: string;
}

export interface KarmaKartState {
  tutar: string;
  paraBirimi: 'TRY' | 'USD' | 'EUR';
  kur: string;
  bankaAdi: string;
  slipNo: string;
  existingIslemId?: string;
}

export interface KarmaParsedLine {
  tur: IslemTur;
  label: string;
  detay: string;
  tutarTL: number;
  orijinalText?: string;
}

export const KARMA_REF_REGEX = /\[KARMA MAKBUZ\s*-\s*Ref:\s*(KRM-[A-Za-z0-9-]+)(?:\s*\|\s*Genel Toplam:\s*([^\]]+))?\]/i;
export const KARMA_ITEM_PREFIX = '[KARMA-KALEM]';

export const parseAmountInput = (raw: string): number => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 0;
  if (trimmed.includes(',')) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    const n = parseFloat(trimmed.replace(/\./g, ''));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(trimmed);
  return isNaN(n) ? 0 : n;
};

export const formatIsoToDisplay = (iso?: string | null): string => {
  if (!iso) return '';
  const clean = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const [y, m, d] = clean.slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
  }
  return clean;
};

export const parseVadeToIso = (val: string): string | null => {
  if (!val) return null;
  const clean = val.trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('.');
    return `${y}-${m}-${d}`;
  }
  return clean;
};

export const createEmptyCekRow = (): CekRowItem => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  no: '',
  vade: '',
  banka: '',
  durum: 'keside',
  tutar: '',
  paraBirimi: 'TRY',
  kur: '',
});

export const getCurrencyRate = (
  paraBirimi: 'TRY' | 'USD' | 'EUR',
  customKur: string | undefined,
  exchangeRates: ExchangeRates | null
): number => {
  if (paraBirimi === 'TRY') return 1;
  const parsed = parseAmountInput(customKur || '');
  if (parsed > 0) return parsed;
  return paraBirimi === 'USD' ? exchangeRates?.USD || 38.45 : exchangeRates?.EUR || 41.2;
};

export const getRowTlEquivalent = (
  tutarStr: string,
  paraBirimi: 'TRY' | 'USD' | 'EUR',
  customKur: string | undefined,
  exchangeRates: ExchangeRates | null
): number => {
  const raw = parseAmountInput(tutarStr);
  if (raw <= 0) return 0;
  const rate = getCurrencyRate(paraBirimi, customKur, exchangeRates);
  return Math.round(raw * rate * 100) / 100;
};

export const extractKarmaRef = (aciklama?: string | null): string | null => {
  if (!aciklama) return null;
  const match = aciklama.match(KARMA_REF_REGEX);
  return match ? match[1] : null;
};

export const isKarmaAciklama = (aciklama?: string | null): boolean => {
  if (!aciklama) return false;
  return KARMA_REF_REGEX.test(aciklama) || aciklama.includes(KARMA_ITEM_PREFIX);
};

export const formatTrAmount = (val: number): string =>
  val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Tek satır Karma makbuz için yapılandırılmış satır formatlayıcı
 */
export const buildKarmaKalemLine = (
  tur: IslemTur,
  detay: string,
  tutarTL: number,
  orijinalText?: string
): string => {
  const safeDetay = detay.replace(/\|/g, '/').trim() || '-';
  const safeOrig = (orijinalText || '').replace(/\|/g, '/').trim();
  return `${KARMA_ITEM_PREFIX} ${tur}|${safeDetay}|${tutarTL.toFixed(2)}|${safeOrig}`;
};

/**
 * Açıklama metninden [KARMA-KALEM] satırlarını ayrıştırır ve temiz kullanıcı notunu döner.
 */
export const parseKarmaFromAciklama = (aciklama?: string | null): {
  karmaRef: string | null;
  kalemler: KarmaParsedLine[];
  cleanNote: string;
} => {
  if (!aciklama) return { karmaRef: null, kalemler: [], cleanNote: '' };

  const karmaRef = extractKarmaRef(aciklama);
  const kalemler: KarmaParsedLine[] = [];
  const otherLines: string[] = [];

  const turLabels: Record<IslemTur, string> = {
    nakit: 'Nakit',
    kredi_karti: 'Kredi Kartı',
    cek: 'Çek',
    senet: 'Senet',
  };

  for (const rawLine of aciklama.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith(KARMA_ITEM_PREFIX)) {
      const payload = line.slice(KARMA_ITEM_PREFIX.length).trim();
      const parts = payload.split('|');
      const turKey = (parts[0] || 'nakit').trim() as IslemTur;
      const validTur: IslemTur =
        turKey === 'kredi_karti' || turKey === 'cek' || turKey === 'senet' ? turKey : 'nakit';
      const detay = (parts[1] || '-').trim();
      const tutarTL = parseFloat((parts[2] || '0').replace(',', '.')) || 0;
      const orijinalText = (parts[3] || '').trim() || undefined;
      kalemler.push({
        tur: validTur,
        label: turLabels[validTur],
        detay,
        tutarTL,
        orijinalText,
      });
      continue;
    }

    // [KARMA MAKBUZ - Ref: ...] başlığını temiz nottan ayır
    const withoutHeader = line.replace(KARMA_REF_REGEX, '').trim();
    if (withoutHeader) {
      otherLines.push(withoutHeader);
    }
  }

  return {
    karmaRef,
    kalemler,
    cleanNote: otherLines.join('\n').trim(),
  };
};

/**
 * Bağlı Karma kardeş işlemlerini özet kalemlere dönüştürür (MakbuzModal & Düzenleme için).
 */
export const buildKarmaLinesFromSiblingIslemler = (rows: Islem[]): KarmaParsedLine[] => {
  const turOrder: Record<IslemTur, number> = {
    nakit: 1,
    kredi_karti: 2,
    cek: 3,
    senet: 4,
  };
  const turLabels: Record<IslemTur, string> = {
    nakit: 'Nakit',
    kredi_karti: 'Kredi Kartı',
    cek: 'Çek',
    senet: 'Senet',
  };

  return [...rows]
    .sort((a, b) => (turOrder[a.tur] || 9) - (turOrder[b.tur] || 9))
    .map((item) => {
      const acik = item.aciklama || '';
      const dovizMatch = acik.match(/\[DÖVİZ:\s*([\d.,]+)\s*(USD|EUR)\s*\(Kur:\s*([\d.,]+)\s*TL\)\]/i);
      const orijinalText = dovizMatch
        ? `${dovizMatch[1]} ${dovizMatch[2]} (Kur: ${dovizMatch[3]} TL)`
        : undefined;

      const detayParts: string[] = [];
      if (item.tur === 'kredi_karti') {
        if (item.banka_adi) detayParts.push(`Banka/POS: ${item.banka_adi}`);
        if (item.belge_no) detayParts.push(`Slip: ${item.belge_no}`);
      } else if (item.tur === 'cek' || item.tur === 'senet') {
        if (item.belge_no) detayParts.push(`No: ${item.belge_no}`);
        if (item.vade) detayParts.push(`Vade: ${formatIsoToDisplay(item.vade)}`);
        if (item.banka_adi) detayParts.push(`Banka: ${item.banka_adi}`);
        if (acik.toLowerCase().includes('ciro')) detayParts.push('Ciro');
        else detayParts.push('Keşide');
      } else {
        detayParts.push('Peşin / Kasa');
      }

      return {
        tur: item.tur,
        label: turLabels[item.tur],
        detay: detayParts.join(' • ') || '-',
        tutarTL: Number(item.tutar) || 0,
        orijinalText,
      };
    });
};
