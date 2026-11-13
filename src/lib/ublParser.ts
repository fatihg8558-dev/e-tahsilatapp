import { Cari, FaturaYon } from '../types/database';

export interface UblPartyInfo {
  vkn: string;
  unvan: string;
  telefon: string;
  email: string;
}

export interface ParsedUblInvoice {
  fileName: string;
  faturaNo: string;
  tarih: string; // YYYY-MM-DD
  invoiceTypeCode: string;
  currencyCode: string;
  exchangeRate: number;
  originalAmount: number;
  tutarTL: number;
  supplier: UblPartyInfo;
  customer: UblPartyInfo;
  detectedYon: FaturaYon;
  detectionReason: string;
}

export const normalizeTaxId = (raw?: string | null): string =>
  (raw || '').replace(/\D/g, '').trim();

const getDirectChildrenByLocalName = (parent: Element, localName: string): Element[] => {
  const result: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) {
      result.push(child);
    }
  }
  return result;
};

const getFirstDirectChild = (parent: Element | null, localName: string): Element | null => {
  if (!parent) return null;
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) {
      return child;
    }
  }
  return null;
};

const getFirstDescendant = (parent: Element | null, localName: string): Element | null => {
  if (!parent) return null;
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) {
      return all[i];
    }
  }
  return null;
};

const getDirectChildText = (parent: Element | null, localName: string): string => {
  const el = getFirstDirectChild(parent, localName);
  return el?.textContent?.trim() || '';
};

const getDescendantText = (parent: Element | null, localName: string): string => {
  const el = getFirstDescendant(parent, localName);
  return el?.textContent?.trim() || '';
};

const parsePartyInfo = (partyWrapper: Element | null): UblPartyInfo => {
  const party = getFirstDirectChild(partyWrapper, 'Party') || partyWrapper;
  if (!party) {
    return { vkn: '', unvan: '', telefon: '', email: '' };
  }

  // VKN / TCKN bul
  let vkn = '';
  const partyIdentifications = getDirectChildrenByLocalName(party, 'PartyIdentification');
  for (const pid of partyIdentifications) {
    const idEl = getFirstDirectChild(pid, 'ID');
    if (!idEl) continue;
    const scheme = (idEl.getAttribute('schemeID') || '').toUpperCase();
    const val = normalizeTaxId(idEl.textContent);
    if (scheme === 'VKN' || scheme === 'TCKN') {
      vkn = val;
      break;
    }
    if (!vkn && (val.length === 10 || val.length === 11)) {
      vkn = val;
    }
  }

  // Fallback: tüm Party altındaki ilk 10/11 haneli VKN/TCKN ID
  if (!vkn) {
    const allIds = party.getElementsByTagName('*');
    for (let i = 0; i < allIds.length; i++) {
      const el = allIds[i];
      if (el.localName === 'ID') {
        const scheme = (el.getAttribute('schemeID') || '').toUpperCase();
        const val = normalizeTaxId(el.textContent);
        if (scheme === 'VKN' || scheme === 'TCKN') {
          vkn = val;
          break;
        }
      }
    }
  }

  // Unvan: önce PartyName > Name, yoksa şahıs firmaları için Person > FirstName + FamilyName
  const partyNameEl = getFirstDirectChild(party, 'PartyName');
  let unvan = getDirectChildText(partyNameEl, 'Name');
  if (!unvan) {
    const personEl = getFirstDirectChild(party, 'Person');
    const first = getDirectChildText(personEl, 'FirstName');
    const middle = getDirectChildText(personEl, 'MiddleName');
    const family = getDirectChildText(personEl, 'FamilyName');
    unvan = [first, middle, family].filter(Boolean).join(' ').trim();
  }
  if (!unvan) {
    unvan = getDescendantText(party, 'RegistrationName') || getDescendantText(party, 'Name');
  }

  // İletişim bilgileri
  const contactEl = getFirstDirectChild(party, 'Contact');
  const telefon = getDirectChildText(contactEl, 'Telephone');
  const email = getDirectChildText(contactEl, 'ElectronicMail');

  return {
    vkn,
    unvan: unvan || 'Bilinmeyen Cari',
    telefon,
    email,
  };
};

const parseDecimalSafe = (raw?: string | null): number => {
  if (!raw) return 0;
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (!cleaned) return 0;
  // UBL XML standartta nokta ondalık ayırıcısıdır (örn: 12500.50); yine de virgül gelirse düzelt
  const normalized =
    cleaned.includes(',') && !cleaned.includes('.')
      ? cleaned.replace(',', '.')
      : cleaned.includes(',') && cleaned.includes('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
};

/**
 * Tek bir UBL-TR XML / Zarf XML dosya metnini ayrıştırır.
 */
export const parseUblInvoiceXml = (
  xmlText: string,
  fileName: string,
  firmaVergiNo?: string | null,
  existingCariler: Cari[] = []
): ParsedUblInvoice => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parserError = doc.getElementsByTagName('parsererror');
  if (parserError && parserError.length > 0) {
    throw new Error(`${fileName}: Geçerli bir XML / UBL dosyası değil.`);
  }

  // Doğrudan <Invoice> veya GİB Zarfı içindeki <Invoice> düğümünü bul
  let invoiceEl: Element | null = null;
  if (doc.documentElement?.localName === 'Invoice') {
    invoiceEl = doc.documentElement;
  } else {
    invoiceEl = getFirstDescendant(doc.documentElement, 'Invoice');
  }

  if (!invoiceEl) {
    throw new Error(`${fileName}: Dosya içinde UBL Fatura (<Invoice>) etiketi bulunamadı.`);
  }

  const faturaNo = getDirectChildText(invoiceEl, 'ID') || fileName.replace(/\.(xml|ubl)$/i, '');
  const rawDate = getDirectChildText(invoiceEl, 'IssueDate');
  const tarih = /^\d{4}-\d{2}-\d{2}/.test(rawDate)
    ? rawDate.slice(0, 10)
    : new Date().toISOString().split('T')[0];

  const invoiceTypeCode = (getDirectChildText(invoiceEl, 'InvoiceTypeCode') || 'SATIS').toUpperCase();

  // Satıcı ve Alıcı taraflar
  const supplierPartyEl = getFirstDirectChild(invoiceEl, 'AccountingSupplierParty');
  const customerPartyEl = getFirstDirectChild(invoiceEl, 'AccountingCustomerParty');
  const supplier = parsePartyInfo(supplierPartyEl);
  const customer = parsePartyInfo(customerPartyEl);

  // Tutar & Para Birimi
  const monetaryEl = getFirstDirectChild(invoiceEl, 'LegalMonetaryTotal');
  const payableEl =
    getFirstDirectChild(monetaryEl, 'PayableAmount') ||
    getFirstDirectChild(monetaryEl, 'TaxInclusiveAmount') ||
    getFirstDescendant(invoiceEl, 'PayableAmount') ||
    getFirstDescendant(invoiceEl, 'TaxInclusiveAmount');

  const originalAmount = parseDecimalSafe(payableEl?.textContent);
  const currencyCode = (
    payableEl?.getAttribute('currencyID') ||
    getDirectChildText(invoiceEl, 'DocumentCurrencyCode') ||
    'TRY'
  ).toUpperCase();

  // Dövizli fatura ise UBL içindeki PricingExchangeRate > CalculationRate değerini oku
  let exchangeRate = 1;
  if (currencyCode !== 'TRY' && currencyCode !== 'TL') {
    const rateWrapper =
      getFirstDirectChild(invoiceEl, 'PricingExchangeRate') ||
      getFirstDirectChild(invoiceEl, 'PaymentExchangeRate');
    const calcRate = parseDecimalSafe(getDirectChildText(rateWrapper, 'CalculationRate'));
    if (calcRate > 0) {
      exchangeRate = calcRate;
    }
  }

  const tutarTL = Math.round(originalAmount * exchangeRate * 100) / 100;

  // Fatura Yönü Tespiti (Satış mı Alış mı?)
  const normFirmaVkn = normalizeTaxId(firmaVergiNo);
  let detectedYon: FaturaYon = 'alis';
  let detectionReason = 'Varsayılan olarak Alış Faturası seçildi (kontrol ediniz)';

  if (normFirmaVkn && supplier.vkn && normFirmaVkn === supplier.vkn) {
    detectedYon = 'satis';
    detectionReason = 'Satıcı VKN firmanızla eşleştiği için Satış Faturası';
  } else if (normFirmaVkn && customer.vkn && normFirmaVkn === customer.vkn) {
    detectedYon = 'alis';
    detectionReason = 'Alıcı VKN firmanızla eşleştiği için Alış Faturası';
  } else {
    // Firma VKN XML ile uyuşmazsa mevcut cariler arasında ara
    const matchedCustomer = existingCariler.find(
      (c) => customer.vkn && normalizeTaxId(c.vergi_tc_no) === customer.vkn
    );
    const matchedSupplier = existingCariler.find(
      (c) => supplier.vkn && normalizeTaxId(c.vergi_tc_no) === supplier.vkn
    );

    if (matchedCustomer && !matchedSupplier) {
      detectedYon = 'satis';
      detectionReason = 'Alıcı VKN kayıtlı carinizle eşleşti (Satış)';
    } else if (matchedSupplier && !matchedCustomer) {
      detectedYon = 'alis';
      detectionReason = 'Satıcı VKN kayıtlı carinizle eşleşti (Alış)';
    } else if (matchedCustomer && matchedCustomer.tur === 'alici') {
      detectedYon = 'satis';
      detectionReason = 'Alıcı carisi mevcut';
    }
  }

  return {
    fileName,
    faturaNo,
    tarih,
    invoiceTypeCode,
    currencyCode,
    exchangeRate,
    originalAmount,
    tutarTL,
    supplier,
    customer,
    detectedYon,
    detectionReason,
  };
};
