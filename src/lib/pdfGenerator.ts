import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { isIosDevice } from './platform';

/**
 * Belirtilen HTML DOM elemanını (A4 oranlı Makbuz Şablonunu)
 * yüksek kaliteli ve net bir PDF Base64 stringine çevirir.
 */
export async function generateMakbuzPdfBase64(element: HTMLElement): Promise<{ base64: string; blob: Blob }> {
  const canvas = await html2canvas(element, {
    scale: isIosDevice() ? 1.5 : 2, // iOS Safari Web Share zaman aşımını önlemek için optimize edilmiş netlik
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

function triggerBlobDownload(blob: Blob, fileNameWithExt: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameWithExt;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    if (document.body.contains(link)) {
      document.body.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }, 1000);
}

function openPdfBlobInIosSafari(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win || win.closed) {
    window.location.assign(url);
  }
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}

/**
 * Makbuz PDF dosyasını cihaza doğrudan indirir.
 * iOS Safari / PWA modunda Web Share (Dosyalara Kaydet) veya dahili PDF önizlemesi kullanılır.
 */
export async function downloadMakbuzPdf(element: HTMLElement, fileName: string): Promise<void> {
  const { blob } = await generateMakbuzPdfBase64(element);
  const validFileName = `${fileName}.pdf`;

  if (isIosDevice()) {
    const file = new File([blob], validFileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: validFileName,
        });
        return;
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          return;
        }
        // NotAllowedError vb. durumda PDF önizlemesine düş
      }
    }
    openPdfBlobInIosSafari(blob);
    return;
  }

  triggerBlobDownload(blob, validFileName);
}

/**
 * Makbuz PDF'ini hedef uygulamaya (WhatsApp veya Mail) doğrudan GERÇEK PDF DOSYA EKİ olarak gönderir.
 * 1. Android Uygulamasında: AndroidBridge.sharePdfFile çağrılır.
 * 2. iOS & Mobil Tarayıcılarda: Web Share API (navigator.share) ile iOS paylaşım sayfası açılır.
 * 3. Desteklenmiyorsa veya iOS paylaşım zaman aşımında PDF önizleme/indirme + fallback yönlendirmesi yapılır.
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

    // 2. iOS & Mobil Tarayıcılar (Web Share API - dosya paylaşımı)
    const file = new File([blob], validFileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: options.subject || validFileName,
          text: options.caption || '',
        });
        return { success: true };
      } catch (shareErr: unknown) {
        const errName = (shareErr as { name?: string })?.name;
        if (errName === 'AbortError') {
          return { success: true };
        }
        // Safari gesture timeout (NotAllowedError) durumunda aşağıdaki fallback'e devam et
      }
    }

    // 3. Web / Masaüstü veya iOS share fallback: Masaüstünde indir, iOS'ta PDF sekmesi/fallback'e geç
    if (!isIosDevice()) {
      triggerBlobDownload(blob, validFileName);
    }

    return { success: false, fallbackNeeded: true };
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') {
      return { success: true };
    }
    console.error('PDF target share error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'PDF paylaşımı başarısız oldu.',
    };
  }
}
