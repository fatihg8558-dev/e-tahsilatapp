import { Cari, FaturaYon } from '../types/database';

export interface UblPartyInfo {
  vkn: string;
  unvan: string;
  telefon: string;
  email: string;
  vergiDairesi?: string;
  adres?: string;
  web?: string;
}

export interface UblInvoiceLine {
  lineId: string;
  name: string;
  description: string;
  sellerCode: string;
  quantity: number;
  unitCode: string;
  unitLabel: string;
  unitPrice: number;
  discountAmount: number;
  discountRate: number;
  kdvRate: number;
  kdvAmount: number;
  lineExtensionAmount: number;
}

export interface UblTaxSubtotal {
  percent: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface UblInvoiceTotals {
  lineExtensionAmount: number;
  allowanceTotalAmount: number;
  taxExclusiveAmount: number;
  taxTotalAmount: number;
  withholdingTaxAmount: number;
  taxInclusiveAmount: number;
  payableAmount: number;
  taxSubtotals: UblTaxSubtotal[];
}

export interface ParsedUblInvoice {
  fileName: string;
  faturaNo: string;
  uuid: string;
  profileId: string;
  tarih: string; // YYYY-MM-DD
  issueTime: string;
  invoiceTypeCode: string;
  currencyCode: string;
  exchangeRate: number;
  originalAmount: number;
  tutarTL: number;
  supplier: UblPartyInfo;
  customer: UblPartyInfo;
  detectedYon: FaturaYon;
  detectionReason: string;
  notes: string[];
  lines: UblInvoiceLine[];
  totals: UblInvoiceTotals;
  hasEmbeddedXslt?: boolean;
  renderedGibHtml?: string;
}

const INVOICE_TYPE_LABELS: Record<string, string> = {
  SATIS: 'SATIŞ',
  IADE: 'İADE',
  TEVKIFAT: 'TEVKİFAT',
  ISTISNA: 'İSTİSNA',
  OZELMATRAH: 'ÖZEL MATRAH',
  IHRACKAYITLI: 'İHRAÇ KAYITLI',
  SGK: 'SGK',
  KOMISYONCU: 'KOMİSYONCU',
  TEVKIFATIADE: 'TEVKİFAT İADE',
};

const INVOICE_SCENARIO_LABELS: Record<string, string> = {
  TICARIFATURA: 'TİCARİ FATURA',
  TEMELFATURA: 'TEMEL FATURA',
  EARSIVFATURA: 'E-ARŞİV FATURA',
  IHRACAT: 'İHRACAT',
  YOLCUBERABERFATURA: 'YOLCU BERABER',
  KAMU: 'KAMU',
  HKS: 'HAL KAYIT SİSTEMİ',
  ILAC_TIBBICIHAZ: 'İLAÇ / TIBBİ CİHAZ',
};

export function formatInvoiceTypeLabel(code?: string | null): string {
  const clean = (code || 'SATIS').trim().toUpperCase();
  return INVOICE_TYPE_LABELS[clean] || clean;
}

export function formatInvoiceScenarioLabel(profileId?: string | null): string {
  const clean = (profileId || 'TICARIFATURA').trim().toUpperCase();
  return INVOICE_SCENARIO_LABELS[clean] || clean;
}

export const normalizeTaxId = (raw?: string | null): string =>
  (raw || '').replace(/\D/g, '').trim();

const UBL_UNIT_LABELS: Record<string, string> = {
  C62: 'Adet',
  NIU: 'Adet',
  EA: 'Adet',
  PCE: 'Adet',
  KGM: 'Kg',
  GRM: 'Gr',
  TNE: 'Ton',
  LTR: 'Lt',
  MLT: 'Ml',
  MTR: 'Mt',
  CMT: 'Cm',
  MMT: 'Mm',
  MTK: 'm²',
  MTQ: 'm³',
  BX: 'Kutu',
  PK: 'Paket',
  SET: 'Set',
  PR: 'Çift',
  DZN: 'Düzine',
  DAY: 'Gün',
  HUR: 'Saat',
  MON: 'Ay',
  ANN: 'Yıl',
  KWH: 'kWh',
};

export function mapUblUnitCode(unitCode?: string | null): string {
  const code = (unitCode || '').trim().toUpperCase();
  if (!code) return 'Adet';
  return UBL_UNIT_LABELS[code] || code;
}

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

const parsePartyAddress = (party: Element): string => {
  const addrEl = getFirstDirectChild(party, 'PostalAddress');
  if (!addrEl) return '';

  const street = getDirectChildText(addrEl, 'StreetName');
  const buildingName = getDirectChildText(addrEl, 'BuildingName');
  const buildingNo = getDirectChildText(addrEl, 'BuildingNumber');
  const room = getDirectChildText(addrEl, 'Room');
  const district = getDirectChildText(addrEl, 'CitySubdivisionName');
  const city = getDirectChildText(addrEl, 'CityName');
  const countryEl = getFirstDirectChild(addrEl, 'Country');
  const country = getDirectChildText(countryEl, 'Name');

  const buildingPart = [buildingName, buildingNo ? `No:${buildingNo}` : '', room ? `D:${room}` : '']
    .filter(Boolean)
    .join(' ');
  const cityPart = [district, city].filter(Boolean).join(' / ');

  return [street, buildingPart, cityPart, country].filter(Boolean).join(', ');
};

const parsePartyInfo = (partyWrapper: Element | null): UblPartyInfo => {
  const party = getFirstDirectChild(partyWrapper, 'Party') || partyWrapper;
  if (!party) {
    return { vkn: '', unvan: '', telefon: '', email: '', vergiDairesi: '', adres: '', web: '' };
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

  // Vergi dairesi, Adres, Web ve İletişim bilgileri
  const partyTaxEl = getFirstDirectChild(party, 'PartyTaxScheme');
  const taxSchemeEl = getFirstDirectChild(partyTaxEl, 'TaxScheme');
  const vergiDairesi = getDirectChildText(taxSchemeEl, 'Name');
  const adres = parsePartyAddress(party);
  const web = getDirectChildText(party, 'WebsiteURI');

  const contactEl = getFirstDirectChild(party, 'Contact');
  const telefon = getDirectChildText(contactEl, 'Telephone');
  const email = getDirectChildText(contactEl, 'ElectronicMail');

  return {
    vkn,
    unvan: unvan || 'Bilinmeyen Cari',
    telefon,
    email,
    vergiDairesi,
    adres,
    web,
  };
};

const parseInvoiceLines = (invoiceEl: Element): UblInvoiceLine[] => {
  const lineEls = getDirectChildrenByLocalName(invoiceEl, 'InvoiceLine');
  return lineEls.map((lineEl, index) => {
    const lineId = getDirectChildText(lineEl, 'ID') || String(index + 1);
    const qtyEl = getFirstDirectChild(lineEl, 'InvoicedQuantity');
    const quantity = parseDecimalSafe(qtyEl?.textContent);
    const unitCode = (qtyEl?.getAttribute('unitCode') || 'C62').trim().toUpperCase();
    const unitLabel = mapUblUnitCode(unitCode);

    const lineExtensionAmount = parseDecimalSafe(getDirectChildText(lineEl, 'LineExtensionAmount'));

    const itemEl = getFirstDirectChild(lineEl, 'Item');
    const name = getDirectChildText(itemEl, 'Name') || `Kalem #${index + 1}`;
    const description = getDirectChildText(itemEl, 'Description');
    const sellerIdentEl = getFirstDirectChild(itemEl, 'SellersItemIdentification');
    const sellerCode = getDirectChildText(sellerIdentEl, 'ID');

    const priceEl = getFirstDirectChild(lineEl, 'Price');
    const unitPrice = parseDecimalSafe(getDirectChildText(priceEl, 'PriceAmount'));

    // İskonto (AllowanceCharge[ChargeIndicator=false])
    let discountAmount = 0;
    let discountRate = 0;
    const allowances = getDirectChildrenByLocalName(lineEl, 'AllowanceCharge');
    for (const ac of allowances) {
      const isCharge = getDirectChildText(ac, 'ChargeIndicator').toLowerCase() === 'true';
      if (isCharge) continue;
      discountAmount += parseDecimalSafe(getDirectChildText(ac, 'Amount'));
      const factor = parseDecimalSafe(getDirectChildText(ac, 'MultiplierFactorNumeric'));
      if (factor > 0) {
        discountRate = factor <= 1 ? Math.round(factor * 10000) / 100 : factor;
      }
    }

    // KDV Bilgisi
    const taxTotalEl = getFirstDirectChild(lineEl, 'TaxTotal');
    const taxSubtotalEl = getFirstDirectChild(taxTotalEl, 'TaxSubtotal');
    const taxCategoryEl =
      getFirstDirectChild(taxSubtotalEl, 'TaxCategory') ||
      getFirstDirectChild(itemEl, 'ClassifiedTaxCategory');

    const kdvRate = parseDecimalSafe(
      getDirectChildText(taxSubtotalEl, 'Percent') ||
        getDirectChildText(taxCategoryEl, 'Percent')
    );
    const kdvAmount = parseDecimalSafe(
      getDirectChildText(taxSubtotalEl, 'TaxAmount') ||
        getDirectChildText(taxTotalEl, 'TaxAmount')
    );

    return {
      lineId,
      name,
      description,
      sellerCode,
      quantity,
      unitCode,
      unitLabel,
      unitPrice,
      discountAmount: Math.round(discountAmount * 100) / 100,
      discountRate,
      kdvRate,
      kdvAmount: Math.round(kdvAmount * 100) / 100,
      lineExtensionAmount: Math.round(lineExtensionAmount * 100) / 100,
    };
  });
};

const parseInvoiceTotals = (
  invoiceEl: Element,
  payableAmountFallback: number
): UblInvoiceTotals => {
  const monetaryEl = getFirstDirectChild(invoiceEl, 'LegalMonetaryTotal');
  const lineExtensionAmount = parseDecimalSafe(
    getDirectChildText(monetaryEl, 'LineExtensionAmount')
  );
  const allowanceTotalAmount = parseDecimalSafe(
    getDirectChildText(monetaryEl, 'AllowanceTotalAmount')
  );
  const taxExclusiveAmount = parseDecimalSafe(
    getDirectChildText(monetaryEl, 'TaxExclusiveAmount')
  );
  const taxInclusiveAmount = parseDecimalSafe(
    getDirectChildText(monetaryEl, 'TaxInclusiveAmount')
  );
  const payableAmount =
    parseDecimalSafe(getDirectChildText(monetaryEl, 'PayableAmount')) || payableAmountFallback;

  let taxTotalAmount = 0;
  const taxSubtotalsMap = new Map<number, UblTaxSubtotal>();
  const taxTotals = getDirectChildrenByLocalName(invoiceEl, 'TaxTotal');
  for (const tt of taxTotals) {
    taxTotalAmount += parseDecimalSafe(getDirectChildText(tt, 'TaxAmount'));
    const subs = getDirectChildrenByLocalName(tt, 'TaxSubtotal');
    for (const sub of subs) {
      const taxCat = getFirstDirectChild(sub, 'TaxCategory');
      const percent = parseDecimalSafe(
        getDirectChildText(sub, 'Percent') || getDirectChildText(taxCat, 'Percent')
      );
      const taxableAmount = parseDecimalSafe(getDirectChildText(sub, 'TaxableAmount'));
      const taxAmount = parseDecimalSafe(getDirectChildText(sub, 'TaxAmount'));
      const existing = taxSubtotalsMap.get(percent);
      if (existing) {
        existing.taxableAmount = Math.round((existing.taxableAmount + taxableAmount) * 100) / 100;
        existing.taxAmount = Math.round((existing.taxAmount + taxAmount) * 100) / 100;
      } else {
        taxSubtotalsMap.set(percent, {
          percent,
          taxableAmount: Math.round(taxableAmount * 100) / 100,
          taxAmount: Math.round(taxAmount * 100) / 100,
        });
      }
    }
  }

  let withholdingTaxAmount = 0;
  const withholdingEls = getDirectChildrenByLocalName(invoiceEl, 'WithholdingTaxTotal');
  for (const wt of withholdingEls) {
    withholdingTaxAmount += parseDecimalSafe(getDirectChildText(wt, 'TaxAmount'));
  }

  return {
    lineExtensionAmount: Math.round(lineExtensionAmount * 100) / 100,
    allowanceTotalAmount: Math.round(allowanceTotalAmount * 100) / 100,
    taxExclusiveAmount: Math.round(taxExclusiveAmount * 100) / 100,
    taxTotalAmount: Math.round(taxTotalAmount * 100) / 100,
    withholdingTaxAmount: Math.round(withholdingTaxAmount * 100) / 100,
    taxInclusiveAmount: Math.round(taxInclusiveAmount * 100) / 100,
    payableAmount: Math.round(payableAmount * 100) / 100,
    taxSubtotals: Array.from(taxSubtotalsMap.values()).sort((a, b) => b.percent - a.percent),
  };
};

export function decodeBase64Utf8(rawBase64: string): string {
  const cleaned = (rawBase64 || '').replace(/\s+/g, '');
  if (!cleaned) return '';

  let bytes: Uint8Array;
  const nodeBuffer = (
    globalThis as unknown as {
      Buffer?: { from(input: string, encoding: string): Uint8Array };
    }
  ).Buffer;
  if (typeof atob === 'function') {
    const binary = atob(cleaned);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else if (nodeBuffer) {
    bytes = Uint8Array.from(nodeBuffer.from(cleaned, 'base64'));
  } else {
    return '';
  }

  const decoded =
    typeof TextDecoder !== 'undefined'
      ? new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      : Array.from(bytes, (b) => String.fromCharCode(b)).join('');

  return decoded.replace(/^\uFEFF/, '').trim();
}

export function sanitizeRenderedGibHtml(rawHtml: string): string {
  if (!rawHtml) return '';

  // XSS önlemi: XSLT çıktısından olası script ve inline event handler'ları temizle
  let sanitized = rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');

  if (!/<meta[^>]+charset/i.test(sanitized) && /<head\b[^>]*>/i.test(sanitized)) {
    sanitized = sanitized.replace(/<head\b[^>]*>/i, (m) => `${m}<meta charset="utf-8" />`);
  }

  const printOverrideStyle = `<style id="tahsilatim-gib-print-fix">
    @page { size: A4; margin: 6mm; }
    html, body { background: #ffffff !important; margin: 0 auto; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>`;

  if (/<\/head>/i.test(sanitized)) {
    sanitized = sanitized.replace(/<\/head>/i, `${printOverrideStyle}</head>`);
  } else if (/<body\b[^>]*>/i.test(sanitized)) {
    sanitized = `<head><meta charset="utf-8" />${printOverrideStyle}</head>${sanitized}`;
  } else {
    sanitized = `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8" />${printOverrideStyle}</head><body>${sanitized}</body></html>`;
  }

  return sanitized;
}

export function extractEmbeddedXsltFromElement(invoiceEl: Element): string | null {
  const docRefs = getDirectChildrenByLocalName(invoiceEl, 'AdditionalDocumentReference');
  for (const ref of docRefs) {
    const docTypeCode = getDirectChildText(ref, 'DocumentTypeCode').toUpperCase();
    const docType = getDirectChildText(ref, 'DocumentType').toUpperCase();
    const attachment = getFirstDirectChild(ref, 'Attachment');
    const embedded = getFirstDirectChild(attachment, 'EmbeddedDocumentBinaryObject');
    if (!embedded?.textContent) continue;

    const filename = (embedded.getAttribute('filename') || '').toLowerCase();
    const mime = (embedded.getAttribute('mimeCode') || '').toLowerCase();
    const isExplicitXslt =
      docTypeCode.includes('XSLT') ||
      docType.includes('XSLT') ||
      filename.endsWith('.xslt') ||
      filename.endsWith('.xsl') ||
      mime.includes('xslt') ||
      mime.includes('xsl');

    const decoded = decodeBase64Utf8(embedded.textContent);
    if (!decoded) continue;

    const looksLikeXslt =
      decoded.includes('http://www.w3.org/1999/XSL/Transform') ||
      /<([a-z0-9_-]+:)?stylesheet\b/i.test(decoded) ||
      /<([a-z0-9_-]+:)?transform\b/i.test(decoded);

    if (isExplicitXslt || looksLikeXslt) {
      return decoded;
    }
  }
  return null;
}

function renderUblWithEmbeddedXslt(
  doc: Document,
  invoiceEl: Element,
  xsltText: string
): string | null {
  if (typeof DOMParser === 'undefined' || typeof XSLTProcessor === 'undefined') {
    return null;
  }

  try {
    const parser = new DOMParser();
    const xsltDoc = parser.parseFromString(xsltText, 'text/xml');
    const xsltParseErr = xsltDoc.getElementsByTagName('parsererror');
    if (xsltParseErr && xsltParseErr.length > 0) {
      return null;
    }

    // Zarf XML (<ef:Envelope> / <StandardBusinessDocument>) içinde gelen <Invoice> düğümünü kök yap
    let targetXmlDoc: Document = doc;
    if (doc.documentElement?.localName !== 'Invoice') {
      const standaloneDoc = document.implementation.createDocument(null, null, null);
      const imported = standaloneDoc.importNode(invoiceEl, true);
      standaloneDoc.appendChild(imported);
      targetXmlDoc = standaloneDoc;
    }

    const processor = new XSLTProcessor();
    processor.importStylesheet(xsltDoc);
    const resultDoc = processor.transformToDocument(targetXmlDoc);
    if (!resultDoc || !resultDoc.documentElement) {
      return null;
    }

    const serialized = new XMLSerializer().serializeToString(resultDoc);
    if (!serialized || serialized.trim().length < 100) {
      return null;
    }

    // Hata sayfası / boş çıktı kontrolü
    const plainTextLen = (resultDoc.body?.textContent || resultDoc.documentElement.textContent || '')
      .replace(/\s+/g, '')
      .length;
    if (plainTextLen < 20) {
      return null;
    }

    return sanitizeRenderedGibHtml(serialized);
  } catch {
    return null;
  }
}

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
  const uuid = getDirectChildText(invoiceEl, 'UUID');
  const profileId = (getDirectChildText(invoiceEl, 'ProfileID') || 'TICARIFATURA').toUpperCase();
  const rawDate = getDirectChildText(invoiceEl, 'IssueDate');
  const tarih = /^\d{4}-\d{2}-\d{2}/.test(rawDate)
    ? rawDate.slice(0, 10)
    : new Date().toISOString().split('T')[0];
  const issueTime = getDirectChildText(invoiceEl, 'IssueTime');

  const invoiceTypeCode = (getDirectChildText(invoiceEl, 'InvoiceTypeCode') || 'SATIS').toUpperCase();

  // Notlar
  const notes = getDirectChildrenByLocalName(invoiceEl, 'Note')
    .map((el) => el.textContent?.trim() || '')
    .filter(Boolean);

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
  const lines = parseInvoiceLines(invoiceEl);
  const totals = parseInvoiceTotals(invoiceEl, originalAmount);

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

  const embeddedXslt = extractEmbeddedXsltFromElement(invoiceEl);
  const renderedGibHtml = embeddedXslt
    ? renderUblWithEmbeddedXslt(doc, invoiceEl, embeddedXslt) || undefined
    : undefined;

  return {
    fileName,
    faturaNo,
    uuid,
    profileId,
    tarih,
    issueTime,
    invoiceTypeCode,
    currencyCode,
    exchangeRate,
    originalAmount,
    tutarTL,
    supplier,
    customer,
    detectedYon,
    detectionReason,
    notes,
    lines,
    totals,
    hasEmbeddedXslt: Boolean(embeddedXslt),
    renderedGibHtml,
  };
};
