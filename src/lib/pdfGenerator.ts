import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Belirtilen HTML DOM elemanını (A4 oranlı Makbuz Şablonunu)
 * yüksek kaliteli ve net bir PDF Base64 stringine çevirir.
 */
export async function generateMakbuzPdfBase64(element: HTMLElement): Promise<{ base64: string; blob: Blob }> {
  const canvas = await html2canvas(element, {
    scale: 2, // Retinal / yüksek netlik
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: 900,
    onclone: (_clonedDoc, clonedElement) => {
      clonedElement.style.width = '720px';
      clonedElement.style.minWidth = '720px';
      clonedElement.style.maxWidth = '720px';
      clonedElement.style.padding = '20px';
      clonedElement.style.boxSizing = 'border-box';
      clonedElement.style.margin = '0';

      // PDF içinde hiçbir metnin "..." ile kırpılmaması için truncate sınıflarını aç
      const truncatedNodes = clonedElement.querySelectorAll('.truncate');
      truncatedNodes.forEach((node) => {
        const el = node as HTMLElement;
        el.style.overflow = 'visible';
        el.style.textOverflow = 'clip';
        el.style.whiteSpace = 'normal';
      });
    },
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  const ratio = canvasWidth / canvasHeight;
  let targetWidth = pdfWidth - 20; // 10mm sağ-sol margin
  let targetHeight = targetWidth / ratio;

  if (targetHeight > pdfHeight - 20) {
    targetHeight = pdfHeight - 20;
    targetWidth = targetHeight * ratio;
  }

  const x = (pdfWidth - targetWidth) / 2;
  const y = 10;

  pdf.addImage(imgData, 'JPEG', x, y, targetWidth, targetHeight);

  const blob = pdf.output('blob');
  const base64 = pdf.output('datauristring'); // data:application/pdf;filename=generated.pdf;base64,...

  return { base64, blob };
}

/**
 * Makbuz PDF dosyasını cihaza doğrudan indirir.
 */
export async function downloadMakbuzPdf(element: HTMLElement, fileName: string): Promise<void> {
  const { blob } = await generateMakbuzPdfBase64(element);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.pdf`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 300);
}

/**
 * Makbuz PDF'ini hedef uygulamaya (WhatsApp veya Mail) doğrudan GERÇEK PDF DOSYA EKİ olarak gönderir.
 * 1. Android Uygulamasında: AndroidBridge.sharePdfFile çağrılır -> Dosya yerel depolamada FileProvider ile oluşturulup WhatsApp veya Gmail/Outlook'a direkt PDF eki olarak iliştirilir.
 * 2. Mobil Tarayıcılarda: Web Share API (navigator.share) ile dosya doğrudan paylaşılır.
 * 3. Masaüstü Tarayıcılarda: PDF indirilir ve kullanıcıya bilgi verilir.
 */
export async function shareMakbuzPdfTarget(
  element: HTMLElement,
  fileName: string,
  targetApp: 'whatsapp' | 'mail' | 'all',
  options: {
    phone?: string | null;
    email?: string | null;
    subject?: string;
    caption?: string;
  }
): Promise<{ success: boolean; fallbackNeeded?: boolean; error?: string }> {
  try {
    const { base64, blob } = await generateMakbuzPdfBase64(element);
    const validFileName = `${fileName}.pdf`;

    // 1. Android Uygulama İçi (AndroidBridge): FileProvider ile gerçek PDF eki olarak gönderir
    if (window.AndroidBridge && typeof window.AndroidBridge.sharePdfFile === 'function') {
      const recipient = targetApp === 'mail' ? (options.email || '') : (options.phone || '');
      const handled = window.AndroidBridge.sharePdfFile(
        base64,
        validFileName,
        targetApp,
        recipient,
        options.subject || '',
        options.caption || ''
      );
      if (handled) {
        return { success: true };
      }
    }

    // 2. Mobil Tarayıcılar (Web Share API - dosya paylaşımı)
    const file = new File([blob], validFileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: options.subject || validFileName,
        text: options.caption || '',
      });
      return { success: true };
    }

    // 3. Web / Masaüstü ortamında dosya eki verilemiyorsa dosyayı indir
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = validFileName;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 300);

    return { success: false, fallbackNeeded: true };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: true };
    }
    console.error('PDF target share error:', err);
    return { success: false, error: err?.message };
  }
}
