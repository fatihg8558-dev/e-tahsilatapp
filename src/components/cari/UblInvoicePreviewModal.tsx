import React, { useEffect, useRef, useState } from 'react';
import { X, Printer, Upload, FileText, AlertCircle, Sparkles, LayoutTemplate } from 'lucide-react';
import { FaturaYon } from '../../types/database';
import { formatCurrency, formatDate, numberToTurkishWords } from '../../lib/formatters';
import {
  formatInvoiceScenarioLabel,
  formatInvoiceTypeLabel,
  ParsedUblInvoice,
  parseUblInvoiceXml,
} from '../../lib/ublParser';
import { isWebPlatform } from '../../lib/platform';

interface UblInvoicePreviewModalProps {
  isOpen: boolean;
  invoice: ParsedUblInvoice | null;
  yon: FaturaYon;
  isSummaryFallback?: boolean;
  firmaVergiNo?: string | null;
  onClose: () => void;
  onXmlAttached?: (parsed: ParsedUblInvoice) => void;
}

function escapeHtml(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInvoiceMoney(amount: number, currencyCode: string = 'TRY'): string {
  const code = (currencyCode || 'TRY').toUpperCase();
  const val = Number(amount) || 0;
  if (code === 'TRY' || code === 'TL') {
    return formatCurrency(val, true);
  }
  const formatted = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
  return `${formatted} ${code}`;
}

function formatQuantity(qty: number): string {
  const val = Number(qty) || 0;
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: Number.isInteger(val) ? 0 : 2,
    maximumFractionDigits: 4,
  }).format(val);
}

function getInvoiceBadgeTitle(profileId?: string): string {
  const pid = (profileId || '').toUpperCase();
  if (pid.includes('EARSIV')) return 'E-ARŞİV FATURA';
  if (pid.includes('IHRACAT')) return 'İHRACAT e-FATURA';
  if (pid.includes('YOLCUBERABER')) return 'YOLCU BERABER e-FATURA';
  return 'e-FATURA';
}

function buildAmountInWordsText(invoice: ParsedUblInvoice): string {
  const code = (invoice.currencyCode || 'TRY').toUpperCase();
  const payable = invoice.totals?.payableAmount ?? invoice.originalAmount;
  if (code === 'TRY' || code === 'TL') {
    return numberToTurkishWords(payable);
  }
  return `${formatInvoiceMoney(payable, code)} (TL Karşılığı: ${numberToTurkishWords(
    invoice.tutarTL
  )})`;
}

function printHtmlDocument(html: string): void {
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 300);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 1500);
  };

  const iframeWin = iframe.contentWindow;
  const iframeDoc = iframe.contentDocument || iframeWin?.document;
  if (!iframeWin || !iframeDoc) {
    cleanup();
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();
  setTimeout(() => {
    try {
      iframeWin.addEventListener('afterprint', cleanup, { once: true });
      iframeWin.focus();
      iframeWin.print();
    } finally {
      setTimeout(cleanup, 60000);
    }
  }, 350);
}

/**
 * Standart GİB e-Fatura / e-Arşiv görünümünde yazdırılabilir A4 HTML üretir.
 */
export function buildPrintableUblInvoiceHtml(
  invoice: ParsedUblInvoice,
  yon: FaturaYon
): string {
  const code = (invoice.currencyCode || 'TRY').toUpperCase();
  const isForeign = code !== 'TRY' && code !== 'TL';
  const badgeTitle = getInvoiceBadgeTitle(invoice.profileId);
  const scenarioLabel = formatInvoiceScenarioLabel(invoice.profileId);
  const typeLabel = formatInvoiceTypeLabel(invoice.invoiceTypeCode);
  const totals = invoice.totals;
  const wordsText = buildAmountInWordsText(invoice);

  const linesHtml =
    invoice.lines.length > 0
      ? invoice.lines
          .map(
            (line, idx) => `
          <tr>
            <td style="text-align: center; width: 32px;">${escapeHtml(line.lineId || idx + 1)}</td>
            <td>
              <div style="font-weight: 700; color: #0f172a;">${escapeHtml(line.name)}</div>
              ${
                line.sellerCode
                  ? `<div style="font-size: 9px; color: #475569;">Stok Kodu: ${escapeHtml(
                      line.sellerCode
                    )}</div>`
                  : ''
              }
              ${
                line.description
                  ? `<div style="font-size: 9.5px; color: #334155; margin-top: 2px;">${escapeHtml(
                      line.description
                    )}</div>`
                  : ''
              }
            </td>
            <td style="text-align: right; white-space: nowrap;">${escapeHtml(
              formatQuantity(line.quantity)
            )} ${escapeHtml(line.unitLabel)}</td>
            <td style="text-align: right; white-space: nowrap;">${escapeHtml(
              formatInvoiceMoney(line.unitPrice, code)
            )}</td>
            <td style="text-align: right; white-space: nowrap;">${
              line.discountAmount > 0
                ? `${escapeHtml(formatInvoiceMoney(line.discountAmount, code))}${
                    line.discountRate > 0 ? ` (%${escapeHtml(line.discountRate)})` : ''
                  }`
                : '-'
            }</td>
            <td style="text-align: center; white-space: nowrap;">%${escapeHtml(line.kdvRate)}</td>
            <td style="text-align: right; white-space: nowrap;">${escapeHtml(
              formatInvoiceMoney(line.kdvAmount, code)
            )}</td>
            <td style="text-align: right; font-weight: 700; white-space: nowrap;">${escapeHtml(
              formatInvoiceMoney(line.lineExtensionAmount, code)
            )}</td>
          </tr>
        `
          )
          .join('')
      : `
        <tr>
          <td style="text-align: center;">1</td>
          <td>
            <div style="font-weight: 700;">Fatura Toplam Tutarı (Özet Kayıt)</div>
            <div style="font-size: 9.5px; color: #475569;">Detaylı satır kalemleri için orijinal UBL/XML dosyasını yükleyebilirsiniz.</div>
          </td>
          <td style="text-align: right;">1 Adet</td>
          <td style="text-align: right;">${escapeHtml(
            formatInvoiceMoney(invoice.originalAmount, code)
          )}</td>
          <td style="text-align: right;">-</td>
          <td style="text-align: center;">-</td>
          <td style="text-align: right;">-</td>
          <td style="text-align: right; font-weight: 700;">${escapeHtml(
            formatInvoiceMoney(invoice.originalAmount, code)
          )}</td>
        </tr>
      `;

  const taxSubtotalsHtml =
    totals.taxSubtotals.length > 0
      ? totals.taxSubtotals
          .map(
            (sub) => `
          <tr>
            <td>Hesaplanan KDV (%${escapeHtml(sub.percent)})</td>
            <td style="text-align: right; font-weight: 600;">${escapeHtml(
              formatInvoiceMoney(sub.taxAmount, code)
            )}</td>
          </tr>
        `
          )
          .join('')
      : `
        <tr>
          <td>Hesaplanan KDV</td>
          <td style="text-align: right; font-weight: 600;">${escapeHtml(
            formatInvoiceMoney(totals.taxTotalAmount, code)
          )}</td>
        </tr>
      `;

  const notesHtml =
    invoice.notes.length > 0
      ? invoice.notes
          .map((n) => `<div style="margin-bottom: 3px;">• ${escapeHtml(n)}</div>`)
          .join('')
      : '<div style="color: #64748b;">Fatura üzerinde ek not bulunmamaktadır.</div>';

  return `
    <!DOCTYPE html>
    <html lang="tr">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(invoice.faturaNo)} - ${escapeHtml(badgeTitle)}</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { box-sizing: border-box; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 16px;
            font-size: 11px;
            background: #ffffff;
          }
          .sheet {
            max-width: 820px;
            margin: 0 auto;
            border: 1.5px solid #334155;
            padding: 16px;
          }
          .header-grid {
            display: table;
            width: 100%;
            table-layout: fixed;
            border-bottom: 1.5px solid #334155;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }
          .header-col {
            display: table-cell;
            vertical-align: top;
          }
          .party-box {
            border: 1px solid #94a3b8;
            padding: 8px 10px;
            background: #f8fafc;
          }
          .meta-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
          }
          .meta-table td {
            border: 1px solid #94a3b8;
            padding: 4px 6px;
          }
          .meta-label {
            font-weight: 700;
            background: #f1f5f9;
            width: 44%;
          }
          .lines-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            font-size: 10px;
          }
          .lines-table th {
            background: #1e293b;
            color: #ffffff;
            border: 1px solid #334155;
            padding: 6px 5px;
            font-size: 9.5px;
            text-align: left;
          }
          .lines-table td {
            border: 1px solid #cbd5e1;
            padding: 5px;
            vertical-align: top;
          }
          .bottom-grid {
            display: table;
            width: 100%;
            table-layout: fixed;
            margin-top: 12px;
          }
          .bottom-left {
            display: table-cell;
            width: 55%;
            vertical-align: top;
            padding-right: 12px;
          }
          .bottom-right {
            display: table-cell;
            width: 45%;
            vertical-align: top;
          }
          .totals-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
          }
          .totals-table td {
            border: 1px solid #94a3b8;
            padding: 5px 8px;
          }
          .payable-row td {
            background: #0f172a;
            color: #ffffff;
            font-weight: 800;
            font-size: 11.5px;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
            .sheet { border: 1.5px solid #000000; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="max-width: 820px; margin: 0 auto 12px auto;">
          <button onclick="window.print()" style="background: #0f766e; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer;">
            PDF Olarak Kaydet / Yazdır
          </button>
        </div>
        <div class="sheet">
          <div class="header-grid">
            <div class="header-col" style="width: 39%; padding-right: 10px;">
              <div style="font-size: 9px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">
                Satıcı Bilgileri
              </div>
              <div style="font-size: 12px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">
                ${escapeHtml(invoice.supplier.unvan)}
              </div>
              ${
                invoice.supplier.adres
                  ? `<div style="font-size: 10px; color: #334155; margin-bottom: 3px;">${escapeHtml(
                      invoice.supplier.adres
                    )}</div>`
                  : ''
              }
              <div style="font-size: 10px; color: #1e293b; line-height: 1.45;">
                ${
                  invoice.supplier.vergiDairesi
                    ? `<div><strong>Vergi Dairesi:</strong> ${escapeHtml(
                        invoice.supplier.vergiDairesi
                      )}</div>`
                    : ''
                }
                <div><strong>VKN/TCKN:</strong> ${escapeHtml(invoice.supplier.vkn || '-')}</div>
                ${
                  invoice.supplier.telefon
                    ? `<div><strong>Tel:</strong> ${escapeHtml(invoice.supplier.telefon)}</div>`
                    : ''
                }
                ${
                  invoice.supplier.email
                    ? `<div><strong>E-Posta:</strong> ${escapeHtml(invoice.supplier.email)}</div>`
                    : ''
                }
                ${
                  invoice.supplier.web
                    ? `<div><strong>Web:</strong> ${escapeHtml(invoice.supplier.web)}</div>`
                    : ''
                }
              </div>
            </div>

            <div class="header-col" style="width: 24%; text-align: center; padding: 6px 8px;">
              <div style="display: inline-block; border: 2px solid #0f172a; padding: 6px 10px; font-weight: 900; font-size: 13px; letter-spacing: 0.4px;">
                ${escapeHtml(badgeTitle)}
              </div>
              <div style="margin-top: 6px; font-size: 9.5px; color: #334155;">
                <div><strong>Özelleştirme No:</strong> TR1.2</div>
                <div><strong>Senaryo:</strong> ${escapeHtml(scenarioLabel)}</div>
                <div style="margin-top: 4px; font-weight: 700; color: ${
                  yon === 'satis' ? '#0f766e' : '#c2410c'
                };">
                  ${yon === 'satis' ? 'SATIŞ FATURASI' : 'ALIŞ FATURASI'}
                </div>
              </div>
            </div>

            <div class="header-col" style="width: 37%; padding-left: 10px;">
              <table class="meta-table">
                <tr>
                  <td class="meta-label">Fatura No</td>
                  <td style="font-weight: 800; font-family: monospace;">${escapeHtml(
                    invoice.faturaNo
                  )}</td>
                </tr>
                <tr>
                  <td class="meta-label">Fatura Tarihi</td>
                  <td>${escapeHtml(formatDate(invoice.tarih))}</td>
                </tr>
                ${
                  invoice.issueTime
                    ? `<tr><td class="meta-label">Düzenleme Saati</td><td>${escapeHtml(
                        invoice.issueTime.slice(0, 8)
                      )}</td></tr>`
                    : ''
                }
                <tr>
                  <td class="meta-label">Fatura Tipi</td>
                  <td>${escapeHtml(typeLabel)}</td>
                </tr>
                <tr>
                  <td class="meta-label">Para Birimi</td>
                  <td>${escapeHtml(code)}${
    isForeign ? ` (Kur: ${escapeHtml(invoice.exchangeRate)})` : ''
  }</td>
                </tr>
              </table>
              ${
                invoice.uuid
                  ? `<div style="margin-top: 6px; font-size: 9px; font-family: monospace; color: #334155; word-break: break-all;">
                      <strong>ETTN:</strong> ${escapeHtml(invoice.uuid)}
                    </div>`
                  : ''
              }
            </div>
          </div>

          <div class="party-box">
            <div style="font-size: 9px; font-weight: 800; color: #475569; text-transform: uppercase;">
              SAYIN (ALICI BİLGİLERİ)
            </div>
            <div style="font-size: 12px; font-weight: 800; color: #0f172a; margin-top: 2px;">
              ${escapeHtml(invoice.customer.unvan)}
            </div>
            <div style="font-size: 10px; color: #334155; margin-top: 3px; line-height: 1.45;">
              ${
                invoice.customer.adres
                  ? `<div>${escapeHtml(invoice.customer.adres)}</div>`
                  : ''
              }
              <div>
                ${
                  invoice.customer.vergiDairesi
                    ? `<strong>Vergi Dairesi:</strong> ${escapeHtml(
                        invoice.customer.vergiDairesi
                      )} &nbsp;|&nbsp; `
                    : ''
                }
                <strong>VKN/TCKN:</strong> ${escapeHtml(invoice.customer.vkn || '-')}
                ${
                  invoice.customer.telefon
                    ? ` &nbsp;|&nbsp; <strong>Tel:</strong> ${escapeHtml(
                        invoice.customer.telefon
                      )}`
                    : ''
                }
                ${
                  invoice.customer.email
                    ? ` &nbsp;|&nbsp; <strong>E-Posta:</strong> ${escapeHtml(
                        invoice.customer.email
                      )}`
                    : ''
                }
              </div>
            </div>
          </div>

          <table class="lines-table">
            <thead>
              <tr>
                <th style="text-align: center;">Sıra</th>
                <th>Mal / Hizmet</th>
                <th style="text-align: right;">Miktar</th>
                <th style="text-align: right;">Birim Fiyat</th>
                <th style="text-align: right;">İskonto</th>
                <th style="text-align: center;">KDV</th>
                <th style="text-align: right;">KDV Tutarı</th>
                <th style="text-align: right;">Mal Hizmet Tutarı</th>
              </tr>
            </thead>
            <tbody>
              ${linesHtml}
            </tbody>
          </table>

          <div class="bottom-grid">
            <div class="bottom-left">
              <div style="border: 1px solid #94a3b8; padding: 8px; min-height: 82px; font-size: 10px;">
                <div style="font-weight: 800; text-transform: uppercase; font-size: 9px; color: #475569; margin-bottom: 4px;">
                  Notlar &amp; Açıklama
                </div>
                ${notesHtml}
                <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #cbd5e1; font-weight: 700; color: #0f172a;">
                  Yalnız: ${escapeHtml(wordsText)}
                </div>
              </div>
            </div>

            <div class="bottom-right">
              <table class="totals-table">
                <tr>
                  <td>Mal Hizmet Toplam Tutarı</td>
                  <td style="text-align: right; font-weight: 600;">${escapeHtml(
                    formatInvoiceMoney(totals.lineExtensionAmount, code)
                  )}</td>
                </tr>
                <tr>
                  <td>Toplam İskonto</td>
                  <td style="text-align: right; font-weight: 600;">${escapeHtml(
                    formatInvoiceMoney(totals.allowanceTotalAmount, code)
                  )}</td>
                </tr>
                ${
                  totals.taxExclusiveAmount > 0
                    ? `<tr>
                        <td>KDV Matrahı</td>
                        <td style="text-align: right; font-weight: 600;">${escapeHtml(
                          formatInvoiceMoney(totals.taxExclusiveAmount, code)
                        )}</td>
                      </tr>`
                    : ''
                }
                ${taxSubtotalsHtml}
                ${
                  totals.withholdingTaxAmount > 0
                    ? `<tr>
                        <td>Tevkifat Tutarı</td>
                        <td style="text-align: right; font-weight: 600;">-${escapeHtml(
                          formatInvoiceMoney(totals.withholdingTaxAmount, code)
                        )}</td>
                      </tr>`
                    : ''
                }
                <tr>
                  <td>Vergiler Dahil Toplam Tutar</td>
                  <td style="text-align: right; font-weight: 700;">${escapeHtml(
                    formatInvoiceMoney(totals.taxInclusiveAmount || totals.payableAmount, code)
                  )}</td>
                </tr>
                <tr class="payable-row">
                  <td>Ödenecek Tutar</td>
                  <td style="text-align: right;">${escapeHtml(
                    formatInvoiceMoney(totals.payableAmount, code)
                  )}</td>
                </tr>
                ${
                  isForeign
                    ? `<tr>
                        <td style="font-weight: 700;">TL Karşılığı</td>
                        <td style="text-align: right; font-weight: 800;">${escapeHtml(
                          formatCurrency(invoice.tutarTL, true)
                        )}</td>
                      </tr>`
                    : ''
                }
              </table>
            </div>
          </div>

          <div style="margin-top: 12px; font-size: 9px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 6px;">
            Tahsilatım Web • UBL-TR Fatura Görselleştirme Önizlemesi
          </div>
        </div>
      </body>
    </html>
  `;
}

export const UblInvoicePreviewModal: React.FC<UblInvoicePreviewModalProps> = ({
  isOpen,
  invoice,
  yon,
  isSummaryFallback = false,
  firmaVergiNo,
  onClose,
  onXmlAttached,
}) => {
  const xmlAttachInputRef = useRef<HTMLInputElement | null>(null);
  const gibIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'gib' | 'standard'>(() =>
    invoice?.renderedGibHtml ? 'gib' : 'standard'
  );
  const [iframeHeight, setIframeHeight] = useState<number>(1120);

  useEffect(() => {
    if (invoice?.renderedGibHtml) {
      setViewMode('gib');
    } else {
      setViewMode('standard');
    }
    setAttachError(null);
    setIframeHeight(1120);
  }, [invoice?.faturaNo, invoice?.renderedGibHtml]);

  if (!isOpen || !invoice || !isWebPlatform()) return null;

  const hasGibXsltView = Boolean(invoice.renderedGibHtml);
  const code = (invoice.currencyCode || 'TRY').toUpperCase();
  const isForeign = code !== 'TRY' && code !== 'TL';
  const badgeTitle = getInvoiceBadgeTitle(invoice.profileId);
  const scenarioLabel = formatInvoiceScenarioLabel(invoice.profileId);
  const typeLabel = formatInvoiceTypeLabel(invoice.invoiceTypeCode);
  const totals = invoice.totals;
  const wordsText = buildAmountInWordsText(invoice);

  const handlePrint = () => {
    if (viewMode === 'gib' && invoice.renderedGibHtml) {
      printHtmlDocument(invoice.renderedGibHtml);
      return;
    }
    printHtmlDocument(buildPrintableUblInvoiceHtml(invoice, yon));
  };

  const handleIframeLoad = () => {
    try {
      const doc = gibIframeRef.current?.contentDocument;
      if (!doc) return;
      const bodyH = doc.body?.scrollHeight || 0;
      const docH = doc.documentElement?.scrollHeight || 0;
      const measured = Math.max(bodyH, docH, 900);
      setIframeHeight(Math.min(measured + 32, 4200));
    } catch {
      // Cross-origin or restricted env fallback
    }
  };

  const handleXmlAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onXmlAttached) return;
    setAttachError(null);
    try {
      const text = await file.text();
      const parsed = parseUblInvoiceXml(text, file.name, firmaVergiNo, []);
      onXmlAttached(parsed);
    } catch (err: unknown) {
      setAttachError(
        err instanceof Error ? err.message : 'XML dosyası okunamadı. Lütfen geçerli UBL/XML seçin.'
      );
    } finally {
      if (xmlAttachInputRef.current) {
        xmlAttachInputRef.current.value = '';
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      data-testid="ubl_invoice_preview_modal"
    >
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[94dvh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* ÜST ARAÇ ÇUBUĞU */}
        <div className="px-4 py-3 border-b border-white/[0.08] bg-black/30 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-extrabold text-white font-mono truncate">
                  {invoice.faturaNo}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    yon === 'satis'
                      ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                      : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                  }`}
                >
                  {yon === 'satis' ? 'Satış Faturası' : 'Alış Faturası'}
                </span>
                {hasGibXsltView && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>GİB XSLT</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 truncate">
                {badgeTitle} • {formatDate(invoice.tarih)} • {scenarioLabel} • {typeLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasGibXsltView && (
              <div
                className="inline-flex rounded-lg bg-black/50 p-0.5 border border-white/10"
                data-testid="ubl_preview_view_toggle"
              >
                <button
                  type="button"
                  data-testid="ubl_preview_mode_gib"
                  onClick={() => setViewMode('gib')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                    viewMode === 'gib'
                      ? 'bg-emerald-400 text-[#0a0e13]'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Orijinal GİB</span>
                </button>
                <button
                  type="button"
                  data-testid="ubl_preview_mode_standard"
                  onClick={() => setViewMode('standard')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                    viewMode === 'standard'
                      ? 'bg-teal-400 text-[#0a0e13]'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <LayoutTemplate className="w-3 h-3" />
                  <span>Standart Görünüm</span>
                </button>
              </div>
            )}

            {onXmlAttached && (
              <>
                <input
                  ref={xmlAttachInputRef}
                  type="file"
                  accept=".xml,.ubl,text/xml,application/xml"
                  onChange={handleXmlAttachChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => xmlAttachInputRef.current?.click()}
                  data-testid="ubl_preview_attach_xml_btn"
                  className="px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 text-xs font-bold flex items-center gap-1.5 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isSummaryFallback ? 'XML Yükle / Eşleştir' : 'XML Güncelle'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handlePrint}
              data-testid="ubl_preview_print_btn"
              className="px-3.5 py-1.5 rounded-lg bg-teal-400 hover:bg-teal-300 text-[#0a0e13] text-xs font-extrabold flex items-center gap-1.5 transition shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Yazdır / PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fatura görüntüsünü kapat"
              data-testid="ubl_preview_close_btn"
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {isSummaryFallback && onXmlAttached && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 text-[11px] text-amber-200 flex items-center justify-between gap-2 flex-wrap">
            <span>
              Bu kayıt önceki bir yüklemeden geldiği için veritabanında yalnızca fatura özeti tutuluyor. Orijinal GİB görünümü ve satırlar için faturanın{' '}
              <strong className="text-white">.xml / .ubl</strong> dosyasını seçebilirsiniz.
            </span>
          </div>
        )}

        {attachError && (
          <div className="px-4 py-2 bg-red-500/15 border-b border-red-500/30 text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{attachError}</span>
          </div>
        )}

        {/* FATURA GÖRÜNÜM ALANI */}
        <div className="flex-1 overflow-y-auto bg-slate-300/90 p-3 sm:p-6">
          {viewMode === 'gib' && invoice.renderedGibHtml ? (
            <div className="max-w-[860px] mx-auto bg-white shadow-2xl border border-slate-400 rounded-sm overflow-hidden">
              <iframe
                ref={gibIframeRef}
                title={`${invoice.faturaNo} Orijinal GİB Fatura Görüntüsü`}
                sandbox="allow-same-origin allow-modals"
                srcDoc={invoice.renderedGibHtml}
                onLoad={handleIframeLoad}
                style={{ height: `${iframeHeight}px` }}
                className="w-full bg-white border-0 block"
                data-testid="ubl_preview_gib_iframe"
              />
            </div>
          ) : (
            <div className="bg-white text-slate-900 max-w-[820px] mx-auto border-2 border-slate-700 shadow-2xl p-4 sm:p-7 text-[11px] leading-snug">
              {/* ÜST BÖLÜM: SATICI | e-FATURA ROZETİ | KÜNYE + ETTN */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pb-4 border-b-2 border-slate-700">
                <div className="md:col-span-5 space-y-1">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Satıcı Bilgileri
                  </div>
                  <div className="text-xs font-extrabold text-slate-900">
                    {invoice.supplier.unvan}
                  </div>
                  {invoice.supplier.adres && (
                    <div className="text-[10.5px] text-slate-700">{invoice.supplier.adres}</div>
                  )}
                  <div className="text-[10.5px] text-slate-800 space-y-0.5 pt-0.5">
                    {invoice.supplier.vergiDairesi && (
                      <div>
                        <span className="font-bold">Vergi Dairesi:</span>{' '}
                        {invoice.supplier.vergiDairesi}
                      </div>
                    )}
                    <div>
                      <span className="font-bold">VKN/TCKN:</span>{' '}
                      <span className="font-mono">{invoice.supplier.vkn || '-'}</span>
                    </div>
                    {invoice.supplier.telefon && (
                      <div>
                        <span className="font-bold">Tel:</span> {invoice.supplier.telefon}
                      </div>
                    )}
                    {invoice.supplier.email && (
                      <div>
                        <span className="font-bold">E-Posta:</span> {invoice.supplier.email}
                      </div>
                    )}
                    {invoice.supplier.web && (
                      <div>
                        <span className="font-bold">Web:</span> {invoice.supplier.web}
                      </div>
                    )}
                  </div>
                </div>

                <div className="md:col-span-3 flex flex-col items-center justify-start text-center py-1">
                  <div className="border-2 border-slate-900 px-3 py-1.5 font-black text-xs tracking-wide text-slate-900">
                    {badgeTitle}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-700 space-y-0.5">
                    <div>
                      <span className="font-bold">Özelleştirme:</span> TR1.2
                    </div>
                    <div>
                      <span className="font-bold">Senaryo:</span> {scenarioLabel}
                    </div>
                    <div
                      className={`mt-1 font-extrabold ${
                        yon === 'satis' ? 'text-teal-700' : 'text-orange-700'
                      }`}
                    >
                      {yon === 'satis' ? 'SATIŞ FATURASI' : 'ALIŞ FATURASI'}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-4 space-y-1.5">
                  <table className="w-full border-collapse text-[10px]">
                    <tbody>
                      <tr>
                        <td className="border border-slate-400 bg-slate-100 px-2 py-1 font-bold w-[44%]">
                          Fatura No
                        </td>
                        <td className="border border-slate-400 px-2 py-1 font-mono font-extrabold">
                          {invoice.faturaNo}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-400 bg-slate-100 px-2 py-1 font-bold">
                          Fatura Tarihi
                        </td>
                        <td className="border border-slate-400 px-2 py-1">
                          {formatDate(invoice.tarih)}
                        </td>
                      </tr>
                      {invoice.issueTime && (
                        <tr>
                          <td className="border border-slate-400 bg-slate-100 px-2 py-1 font-bold">
                            Saat
                          </td>
                          <td className="border border-slate-400 px-2 py-1 font-mono">
                            {invoice.issueTime.slice(0, 8)}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="border border-slate-400 bg-slate-100 px-2 py-1 font-bold">
                          Fatura Tipi
                        </td>
                        <td className="border border-slate-400 px-2 py-1 font-semibold">
                          {typeLabel}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-400 bg-slate-100 px-2 py-1 font-bold">
                          Para Birimi
                        </td>
                        <td className="border border-slate-400 px-2 py-1">
                          {code}
                          {isForeign ? ` (Kur: ${invoice.exchangeRate})` : ''}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {invoice.uuid && (
                    <div className="text-[9.5px] font-mono text-slate-700 break-all bg-slate-50 border border-slate-300 px-2 py-1">
                      <span className="font-bold">ETTN:</span> {invoice.uuid}
                    </div>
                  )}
                </div>
              </div>

              {/* ALICI BİLGİLERİ */}
              <div className="mt-3 border border-slate-400 bg-slate-50 p-2.5 sm:p-3">
                <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">
                  Sayın (Alıcı Bilgileri)
                </div>
                <div className="text-xs font-extrabold text-slate-900 mt-0.5">
                  {invoice.customer.unvan}
                </div>
                {invoice.customer.adres && (
                  <div className="text-[10.5px] text-slate-700 mt-0.5">{invoice.customer.adres}</div>
                )}
                <div className="text-[10.5px] text-slate-800 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                  {invoice.customer.vergiDairesi && (
                    <span>
                      <strong>Vergi Dairesi:</strong> {invoice.customer.vergiDairesi}
                    </span>
                  )}
                  <span>
                    <strong>VKN/TCKN:</strong>{' '}
                    <span className="font-mono">{invoice.customer.vkn || '-'}</span>
                  </span>
                  {invoice.customer.telefon && (
                    <span>
                      <strong>Tel:</strong> {invoice.customer.telefon}
                    </span>
                  )}
                  {invoice.customer.email && (
                    <span>
                      <strong>E-Posta:</strong> {invoice.customer.email}
                    </span>
                  )}
                </div>
              </div>

              {/* FATURA KALEMLERİ TABLOSU */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[10px]">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="border border-slate-700 px-1.5 py-1.5 text-center w-9">Sıra</th>
                      <th className="border border-slate-700 px-2 py-1.5 text-left">Mal / Hizmet</th>
                      <th className="border border-slate-700 px-2 py-1.5 text-right whitespace-nowrap">
                        Miktar
                      </th>
                      <th className="border border-slate-700 px-2 py-1.5 text-right whitespace-nowrap">
                        Birim Fiyat
                      </th>
                      <th className="border border-slate-700 px-2 py-1.5 text-right whitespace-nowrap">
                        İskonto
                      </th>
                      <th className="border border-slate-700 px-1.5 py-1.5 text-center whitespace-nowrap">
                        KDV
                      </th>
                      <th className="border border-slate-700 px-2 py-1.5 text-right whitespace-nowrap">
                        KDV Tutarı
                      </th>
                      <th className="border border-slate-700 px-2 py-1.5 text-right whitespace-nowrap">
                        Mal Hizmet Tutarı
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.length > 0 ? (
                      invoice.lines.map((line, idx) => (
                        <tr key={`${line.lineId}-${idx}`} className="even:bg-slate-50/70">
                          <td className="border border-slate-300 px-1.5 py-1.5 text-center font-mono align-top">
                            {line.lineId || idx + 1}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 align-top">
                            <div className="font-bold text-slate-900">{line.name}</div>
                            {line.sellerCode && (
                              <div className="text-[9px] text-slate-500">
                                Kod: {line.sellerCode}
                              </div>
                            )}
                            {line.description && (
                              <div className="text-[9.5px] text-slate-600 mt-0.5">
                                {line.description}
                              </div>
                            )}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono whitespace-nowrap align-top">
                            {formatQuantity(line.quantity)} {line.unitLabel}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono whitespace-nowrap align-top">
                            {formatInvoiceMoney(line.unitPrice, code)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono whitespace-nowrap align-top">
                            {line.discountAmount > 0
                              ? `${formatInvoiceMoney(line.discountAmount, code)}${
                                  line.discountRate > 0 ? ` (%${line.discountRate})` : ''
                                }`
                              : '-'}
                          </td>
                          <td className="border border-slate-300 px-1.5 py-1.5 text-center font-mono whitespace-nowrap align-top">
                            %{line.kdvRate}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono whitespace-nowrap align-top">
                            {formatInvoiceMoney(line.kdvAmount, code)}
                          </td>
                          <td className="border border-slate-300 px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap align-top">
                            {formatInvoiceMoney(line.lineExtensionAmount, code)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="border border-slate-300 px-1.5 py-2 text-center font-mono">
                          1
                        </td>
                        <td className="border border-slate-300 px-2 py-2">
                          <div className="font-bold text-slate-900">
                            Fatura Toplam Tutarı (Özet Kayıt)
                          </div>
                          <div className="text-[9.5px] text-slate-600">
                            Kalem bazlı detaylar için yukarıdaki &quot;XML Yükle / Eşleştir&quot; butonunu
                            kullanabilirsiniz.
                          </div>
                        </td>
                        <td className="border border-slate-300 px-2 py-2 text-right font-mono">
                          1 Adet
                        </td>
                        <td className="border border-slate-300 px-2 py-2 text-right font-mono">
                          {formatInvoiceMoney(invoice.originalAmount, code)}
                        </td>
                        <td className="border border-slate-300 px-2 py-2 text-right">-</td>
                        <td className="border border-slate-300 px-1.5 py-2 text-center">-</td>
                        <td className="border border-slate-300 px-2 py-2 text-right">-</td>
                        <td className="border border-slate-300 px-2 py-2 text-right font-mono font-bold">
                          {formatInvoiceMoney(invoice.originalAmount, code)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* ALT BÖLÜM: NOTLAR + YAZIYLA TUTAR & TOPLAMLAR TABLOSU */}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-7 border border-slate-400 p-2.5 flex flex-col justify-between bg-slate-50/50">
                  <div>
                    <div className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">
                      Notlar &amp; Açıklamalar
                    </div>
                    {invoice.notes.length > 0 ? (
                      <ul className="space-y-1 text-[10px] text-slate-800">
                        {invoice.notes.map((note, idx) => (
                          <li key={idx}>• {note}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[10px] text-slate-500">
                        Fatura üzerinde ek not bulunmamaktadır.
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-2 border-t border-dashed border-slate-300 text-[10.5px] font-bold text-slate-900">
                    Yalnız: {wordsText}
                  </div>
                </div>

                <div className="md:col-span-5">
                  <table className="w-full border-collapse text-[10.5px]">
                    <tbody>
                      <tr>
                        <td className="border border-slate-400 px-2.5 py-1">
                          Mal Hizmet Toplam Tutarı
                        </td>
                        <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-semibold">
                          {formatInvoiceMoney(totals.lineExtensionAmount, code)}
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-400 px-2.5 py-1">Toplam İskonto</td>
                        <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-semibold">
                          {formatInvoiceMoney(totals.allowanceTotalAmount, code)}
                        </td>
                      </tr>
                      {totals.taxExclusiveAmount > 0 && (
                        <tr>
                          <td className="border border-slate-400 px-2.5 py-1">KDV Matrahı</td>
                          <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-semibold">
                            {formatInvoiceMoney(totals.taxExclusiveAmount, code)}
                          </td>
                        </tr>
                      )}
                      {totals.taxSubtotals.length > 0 ? (
                        totals.taxSubtotals.map((sub) => (
                          <tr key={sub.percent}>
                            <td className="border border-slate-400 px-2.5 py-1">
                              Hesaplanan KDV (%{sub.percent})
                            </td>
                            <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-semibold">
                              {formatInvoiceMoney(sub.taxAmount, code)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="border border-slate-400 px-2.5 py-1">Hesaplanan KDV</td>
                          <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-semibold">
                            {formatInvoiceMoney(totals.taxTotalAmount, code)}
                          </td>
                        </tr>
                      )}
                      {totals.withholdingTaxAmount > 0 && (
                        <tr>
                          <td className="border border-slate-400 px-2.5 py-1">Tevkifat Tutarı</td>
                          <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-semibold">
                            -{formatInvoiceMoney(totals.withholdingTaxAmount, code)}
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="border border-slate-400 px-2.5 py-1">
                          Vergiler Dahil Toplam Tutar
                        </td>
                        <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-bold">
                          {formatInvoiceMoney(
                            totals.taxInclusiveAmount || totals.payableAmount,
                            code
                          )}
                        </td>
                      </tr>
                      <tr className="bg-slate-900 text-white">
                        <td className="border border-slate-900 px-2.5 py-1.5 font-extrabold">
                          Ödenecek Tutar
                        </td>
                        <td className="border border-slate-900 px-2.5 py-1.5 text-right font-mono font-black">
                          {formatInvoiceMoney(totals.payableAmount, code)}
                        </td>
                      </tr>
                      {isForeign && (
                        <tr className="bg-amber-50">
                          <td className="border border-slate-400 px-2.5 py-1 font-bold text-slate-900">
                            TL Karşılığı
                          </td>
                          <td className="border border-slate-400 px-2.5 py-1 text-right font-mono font-extrabold text-slate-900">
                            {formatCurrency(invoice.tutarTL, true)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-slate-200 text-[9.5px] text-slate-500 text-center">
                Tahsilatım Web • UBL-TR Fatura Görselleştirme Önizlemesi
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
