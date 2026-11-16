// Excel (CSV - Türkçe Excel Uyumlu UTF-8 BOM) ve Yazdırılabilir PDF Dışa Aktarma Servisi

export function exportToExcel(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  // Excel'in Türkçe karakterleri (İ, Ş, Ğ, Ü, Ö, Ç) doğru açması için UTF-8 BOM eklenir
  const BOM = '\uFEFF';
  
  // Türkiye bölgesel ayarlarındaki Excel noktalı virgül (;) ayırıcısını doğrudan sütun olarak açar
  const escapeCell = (cell: string | number | null | undefined): string => {
    if (cell === null || cell === undefined) return '""';
    const str = String(cell).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csvContent =
    BOM +
    headers.map(escapeCell).join(';') +
    '\r\n' +
    rows.map((row) => row.map(escapeCell).join(';')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function printPdfReport(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  summary?: { label: string; value: string }[],
  logoUrl?: string | null,
  options?: {
    rightAlignedColumns?: number[];
    compactNumeric?: boolean;
    columnStyles?: Record<number, string>;
  }
) {
  const rightAlignedSet = new Set<number>(
    options?.rightAlignedColumns && options.rightAlignedColumns.length > 0
      ? options.rightAlignedColumns
      : [headers.length - 1]
  );
  const compact = Boolean(options?.compactNumeric);
  const colStyles = options?.columnStyles || {};

  const summaryHtml = summary && summary.length > 0
    ? `
      <div style="display: flex; flex-wrap: wrap; gap: 18px; margin-bottom: 16px; background: #f8fafc; padding: 10px 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
        ${summary.map(s => `
          <div>
            <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase;">${s.label}</div>
            <div style="font-size: ${compact ? '13.5px' : '16px'}; color: #0f172a; font-weight: 800; font-family: monospace;">${s.value}</div>
          </div>
        `).join('')}
      </div>
    `
    : '';

  const tableRowsHtml = rows
    .map(
      (row, idx) => `
      <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}; border-bottom: 1px solid #e2e8f0;">
        ${row
          .map((cell, cellIdx) => {
            const isRight = rightAlignedSet.has(cellIdx);
            const basePadding = compact ? '6px 5px' : '9px 10px';
            const baseFont = compact ? (isRight ? '9.5px' : '10px') : '11px';
            const rightCss = isRight
              ? `text-align: right; font-weight: 700; font-family: monospace; white-space: nowrap;${compact ? ' width: 1%; letter-spacing: -0.2px;' : ''}`
              : '';
            const extraCss = colStyles[cellIdx] || '';
            return `
          <td style="padding: ${basePadding}; font-size: ${baseFont}; color: #1e293b; vertical-align: top; ${rightCss} ${extraCss}">
            ${cell !== null && cell !== undefined ? cell : '-'}
          </td>
        `;
          })
          .join('')}
      </tr>
    `
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="tr">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page {
            size: A4;
            margin: ${compact ? '10mm' : '15mm'};
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: ${compact ? '12px' : '20px'};
            color: #0f172a;
          }
          .header {
            border-bottom: 2px solid #0f766e;
            padding-bottom: 10px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .title {
            font-size: ${compact ? '18px' : '20px'};
            font-weight: 900;
            color: #0f172a;
            margin: 0;
          }
          .subtitle {
            font-size: 11px;
            color: #64748b;
            margin-top: 3px;
          }
          .date {
            font-size: 10.5px;
            color: #64748b;
            text-align: right;
            white-space: nowrap;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
          }
          th {
            background-color: #0f766e;
            color: #ffffff;
            font-size: ${compact ? '9px' : '10.5px'};
            text-transform: uppercase;
            letter-spacing: ${compact ? '0.25px' : '0.4px'};
            padding: ${compact ? '7px 5px' : '9px 10px'};
            font-weight: 700;
          }
          @media print {
            body { padding: 0; }
            button { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div style="margin-bottom: 15px;">
          <button onclick="window.print()" style="background: #0f766e; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">
            🖨️ PDF Olarak Kaydet / Yazdır
          </button>
        </div>
        <div class="header">
          <div style="display: flex; align-items: center; gap: 14px;">
            ${
              logoUrl
                ? `<img src="${logoUrl}" alt="Logo" style="max-height: 48px; max-width: 140px; object-fit: contain;" />`
                : ''
            }
            <div>
              <h1 class="title">${title}</h1>
              <div class="subtitle">${subtitle}</div>
            </div>
          </div>
          <div class="date">
            Rapor Tarihi: ${new Date().toLocaleDateString('tr-TR')} ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        ${summaryHtml}
        <table>
          <thead>
            <tr>
              ${headers
                .map((h, i) => {
                  const isRight = rightAlignedSet.has(i);
                  const rightStyle = isRight
                    ? `text-align: right; white-space: nowrap;${compact ? ' width: 1%;' : ''}`
                    : '';
                  const extraCss = colStyles[i] || '';
                  return `<th style="${rightStyle} ${extraCss}">${h}</th>`;
                })
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
        <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 10px; color: #94a3b8; text-align: center;">
          Tahsilatım Bulut Muhasebe Platformu ile hazırlanmıştır.
        </div>
      </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 300);
    return;
  }

  // iOS Safari / Ana Ekrana Ekle (PWA) modunda pop-up engellendiğinde gizli iframe ile yazdır
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
    alert('Yazdırma penceresi açılamadı. Lütfen tarayıcı ayarlarından açılır pencerelere izin veriniz.');
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  const triggerIframePrint = () => {
    try {
      iframeWin.addEventListener('afterprint', cleanup, { once: true });
      iframeWin.focus();
      iframeWin.print();
    } finally {
      setTimeout(cleanup, 60000);
    }
  };

  setTimeout(triggerIframePrint, 350);
}
