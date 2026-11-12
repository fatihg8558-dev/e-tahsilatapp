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
  logoUrl?: string | null
) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Yazdırma penceresi açılamadı. Lütfen açılır pencerelere (pop-up) izin veriniz.');
    return;
  }

  const summaryHtml = summary && summary.length > 0
    ? `
      <div style="display: flex; gap: 20px; margin-bottom: 20px; background: #f8fafc; padding: 12px 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
        ${summary.map(s => `
          <div>
            <div style="font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase;">${s.label}</div>
            <div style="font-size: 16px; color: #0f172a; font-weight: 800; font-family: monospace;">${s.value}</div>
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
          .map(
            (cell, cellIdx) => `
          <td style="padding: 10px 12px; font-size: 12px; color: #1e293b; ${
            cellIdx === row.length - 1 ? 'text-align: right; font-weight: 700; font-family: monospace;' : ''
          }">
            ${cell !== null && cell !== undefined ? cell : '-'}
          </td>
        `
          )
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
            margin: 15mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 20px;
            color: #0f172a;
          }
          .header {
            border-bottom: 2px solid #0f766e;
            padding-bottom: 12px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }
          .title {
            font-size: 20px;
            font-weight: 900;
            color: #0f172a;
            margin: 0;
          }
          .subtitle {
            font-size: 12px;
            color: #64748b;
            margin-top: 4px;
          }
          .date {
            font-size: 11px;
            color: #64748b;
            text-align: right;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
          }
          th {
            background-color: #0f766e;
            color: #ffffff;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 10px 12px;
            font-weight: 700;
          }
          th:last-child {
            text-align: right;
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
              ${headers.map((h, i) => `<th style="${i === headers.length - 1 ? 'text-align: right;' : ''}">${h}</th>`).join('')}
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

  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 300);
}
