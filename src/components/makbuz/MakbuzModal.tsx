import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Islem } from '../../types/database';
import { formatCurrency, formatDate, numberToTurkishWords } from '../../lib/formatters';
import {
  X,
  Printer,
  Share2,
  Mail,
  MessageCircle,
  FileText,
  CheckCircle2,
  ArrowRightLeft,
  ArrowLeft,
  Loader2,
  FileDown,
} from 'lucide-react';
import { openWhatsApp, openExternalLink } from '../../lib/linkHelper';
import { downloadMakbuzPdf, shareMakbuzPdfTarget } from '../../lib/pdfGenerator';

interface MakbuzModalProps {
  islem: Islem | null;
  onClose: () => void;
}

export const MakbuzModal: React.FC<MakbuzModalProps> = ({ islem, onClose }) => {
  const { firma } = useAuth();
  const [nusha, setNusha] = useState<'1' | '2'>('2');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfSuccessMsg, setPdfSuccessMsg] = useState<string | null>(null);
  const makbuzContainerRef = useRef<HTMLDivElement>(null);

  // Çapraz İşlem Eşleşmesi (Müşteri Tahsilatı <-> Tedarikçi Tediyesi)
  const isCapraz =
    !!islem?.aciklama?.includes('[ÇAPRAZ ÖDEME') ||
    !!islem?.belge_no?.startsWith('ÇPZ-') ||
    !!islem?.aciklama?.includes('ÇAPRAZ');
  const [linkedIslem, setLinkedIslem] = useState<Islem | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'linked'>('current');

  useEffect(() => {
    if (isCapraz && islem?.belge_no && firma?.id) {
      supabase
        .from('islemler')
        .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
        .eq('firma_id', firma.id)
        .eq('belge_no', islem.belge_no)
        .neq('id', islem.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setLinkedIslem(data as Islem);
        });
    }
  }, [islem?.id, islem?.belge_no, isCapraz, firma?.id]);

  if (!islem) return null;

  // Hangi işlem gösteriliyor: Ana seçilen mi yoksa eşleşen çapraz işlem mi?
  const displayIslem = activeTab === 'linked' && linkedIslem ? linkedIslem : islem;
  const isTahsilat = displayIslem.tip === 'tahsilat';
  const baslik = isTahsilat ? 'TAHSİLAT MAKBUZU' : 'TEDİYE MAKBUZU';
  const tutarYazi = numberToTurkishWords(displayIslem.tutar);
  const makbuzDosyaAdi = `${baslik.toLowerCase().replace(/\s+/g, '_')}_${displayIslem.makbuz_no || displayIslem.id.slice(0, 8)}`;

  const handlePrint = () => {
    window.print();
  };

  /**
   * PDF İndirme (Telefon veya bilgisayara PDF belgesi olarak kaydeder)
   */
  const handleDownloadPdf = async () => {
    if (!makbuzContainerRef.current) return;
    try {
      setPdfLoading(true);
      await downloadMakbuzPdf(makbuzContainerRef.current, makbuzDosyaAdi);
      setPdfSuccessMsg('Makbuz PDF olarak cihazınıza indirildi!');
      setTimeout(() => setPdfSuccessMsg(null), 3000);
    } catch (err) {
      console.error(err);
      alert('PDF oluşturulurken bir hata oluştu.');
    } finally {
      setPdfLoading(false);
    }
  };

  /**
   * WhatsApp ile PDF Eki Gönderme:
   * Android uygulamasında doğrudan PDF dosyası (FileProvider) ile WhatsApp'ı açar.
   */
  const handleWhatsAppPdfShare = async () => {
    if (!makbuzContainerRef.current) return;
    try {
      setPdfLoading(true);
      const rawPhone = displayIslem.cariler?.telefon;
      const caption = `Sayın ${displayIslem.cariler?.unvan || 'Müşterimiz'},\n\n${formatDate(displayIslem.tarih)} tarihli, ${displayIslem.makbuz_no || ''} numaralı ve ${formatCurrency(displayIslem.tutar)} tutarındaki ${baslik} PDF belgesi ektedir.\n\nBilgilerinize sunarız.\n${firma?.unvan || ''}`;

      const res = await shareMakbuzPdfTarget(
        makbuzContainerRef.current,
        makbuzDosyaAdi,
        'whatsapp',
        {
          phone: rawPhone,
          caption,
        }
      );

      if (res.fallbackNeeded) {
        setPdfSuccessMsg('PDF indirildi! WhatsApp sohbetine ekleyebilirsiniz.');
        setTimeout(() => setPdfSuccessMsg(null), 4000);
        openWhatsApp(rawPhone, caption);
      }
    } catch (err) {
      console.error(err);
      alert('PDF paylaşılırken hata oluştu.');
    } finally {
      setPdfLoading(false);
    }
  };

  /**
   * E-posta ile PDF Eki Gönderme:
   * Android uygulamasında doğrudan Gmail / Outlook uygulamasına PDF dosyasını EK (attachment) olarak iliştirir.
   */
  const handleMailPdfShare = async () => {
    if (!makbuzContainerRef.current) return;
    try {
      setPdfLoading(true);
      const email = displayIslem.cariler?.email || '';
      const subject = `${baslik} - ${displayIslem.makbuz_no || displayIslem.id.slice(0, 8)}`;
      const caption = `Sayın ${displayIslem.cariler?.unvan || 'Müşterimiz'},\n\n${formatDate(displayIslem.tarih)} tarihli ve ${formatCurrency(displayIslem.tutar)} tutarındaki ${baslik} PDF formatında ekte bilgilerinize sunulmuştur.\n\nSaygılarımızla,\n${firma?.unvan || ''}`;

      const res = await shareMakbuzPdfTarget(
        makbuzContainerRef.current,
        makbuzDosyaAdi,
        'mail',
        {
          email,
          subject,
          caption,
        }
      );

      if (res.fallbackNeeded) {
        setPdfSuccessMsg('PDF indirildi! E-posta iletinize ekleyebilirsiniz.');
        setTimeout(() => setPdfSuccessMsg(null), 4000);
        openExternalLink(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(caption)}`);
      }
    } catch (err) {
      console.error(err);
      alert('E-posta paylaşımı sırasında hata oluştu.');
    } finally {
      setPdfLoading(false);
    }
  };

  /**
   * Standart WhatsApp Metin Mesajı (Dosyasız)
   */
  const handleWhatsAppText = () => {
    const rawPhone = displayIslem.cariler?.telefon;
    const msg = `Sayın ${displayIslem.cariler?.unvan || 'Müşterimiz'},\n\n${formatDate(displayIslem.tarih)} tarihli, ${displayIslem.makbuz_no || ''} numaralı ve ${formatCurrency(displayIslem.tutar)} tutarındaki ${baslik} düzenlenmiştir.\n\nİşlem Türü: ${displayIslem.tur?.toUpperCase() || ''}\nDetay: ${displayIslem.aciklama || '-'}\n\nBilgilerinize sunarız.\n${firma?.unvan || ''}`;
    openWhatsApp(rawPhone, msg);
  };

  // Çoklu çek satırlarını tespit et
  const parseCekSatirlari = (aciklamaStr?: string | null) => {
    if (!aciklamaStr) return [];
    const lines = aciklamaStr.split('\n').map(l => l.trim()).filter(Boolean);
    // [ÇEK SATIRI] veya "nl." içeren satırları çek satırı olarak kabul et
    return lines.filter(l => l.includes('nl.') && l.includes('vd.'));
  };

  const cekSatirlari = parseCekSatirlari(displayIslem.aciklama);

  const renderSingleMakbuz = (nushaTipi: string) => (
    <div className="relative border border-gray-300 p-5 sm:p-6 bg-white text-gray-900 rounded-lg shadow-sm text-[11px] leading-relaxed space-y-3 font-sans">
      {/* İPTAL EDİLDİ DAMGASI */}
      {displayIslem.iptal && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="border-4 border-red-500 text-red-500 font-black text-2xl sm:text-3xl px-6 py-3 uppercase tracking-widest rotate-[-15deg] opacity-70 bg-white/70 rounded-xl shadow-lg text-center">
            İPTAL EDİLDİ
            {displayIslem.iptal_nedeni && (
              <div className="text-[10px] font-normal text-red-600 mt-0.5 capitalize">
                Neden: {displayIslem.iptal_nedeni}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1. ÜST BİLGİ: FİRMA (SOL) & BAŞLIK / MAKBUZ NO (SAĞ) */}
      <div className="flex justify-between items-start border-b border-gray-300 pb-3">
        {/* SOL: Firma Bilgileri */}
        <div className="max-w-[50%]">
          {firma?.logo_data ? (
            <img
              src={firma.logo_data}
              alt="Firma Logosu"
              className="max-h-11 max-w-[200px] object-contain mb-1.5"
            />
          ) : (
            <div className="font-extrabold text-sm sm:text-base text-gray-900 tracking-tight leading-snug">
              {firma?.unvan || 'FİRMA UNVANI'}
            </div>
          )}
          <div className="text-[10px] text-gray-600 leading-tight">
            VKN/TCKN: {firma?.vergi_no || '-'} {firma?.vergi_dairesi ? `(${firma.vergi_dairesi} V.D.)` : ''}
          </div>
          {firma?.adres && <div className="text-[10px] text-gray-600 truncate">{firma.adres}</div>}
          {firma?.telefon && <div className="text-[10px] text-gray-600">Tel: {firma.telefon}</div>}
        </div>

        {/* SAĞ: Çapraz İşlem / Nüsha Etiketi & Başlık & Makbuz No */}
        <div className="text-right">
          <div className="flex items-center justify-end gap-1 mb-1">
            {isCapraz && (
              <span className="inline-block px-2 py-0.5 border border-purple-400 bg-purple-50 font-bold text-[8.5px] uppercase tracking-wider text-purple-700 rounded">
                Çapraz İşlem
              </span>
            )}
            <span className="inline-block px-2 py-0.5 border border-gray-400 font-bold text-[8.5px] uppercase tracking-wider text-gray-600 rounded">
              {nushaTipi}
            </span>
          </div>
          <div className="font-black text-base sm:text-lg text-gray-900 tracking-tight leading-tight">
            {baslik}
          </div>
          <div className="text-[10px] font-mono text-gray-500 mt-1">
            Makbuz No: <span className="text-gray-900 font-bold">{displayIslem.makbuz_no || `#${displayIslem.id.slice(0, 8)}`}</span>
          </div>
          <div className="text-[10px] text-gray-500">
            Düzenleme Tarihi: <span className="text-gray-900 font-bold">{formatDate(displayIslem.tarih)}</span>
          </div>
        </div>
      </div>

      {/* 2. MUHATTAP (CARİ BİLGİLERİ) & İŞLEM DETAYLARI KARTI (Resimdeki tam 2 kolonlu tasarım) */}
      <div className="grid grid-cols-2 gap-3 bg-gray-50/90 p-3 rounded-lg border border-gray-200">
        {/* SOL: ÖDEMEYİ YAPAN (MÜŞTERİ / ALICI) */}
        <div>
          <span className="text-gray-500 block text-[9px] uppercase font-bold tracking-wider">
            {isTahsilat ? 'ÖDEMEYİ YAPAN (MÜŞTERİ / ALICI)' : 'ÖDEMEYİ ALAN (TEDARİKÇİ)'}
          </span>
          <div className="font-bold text-gray-900 text-xs sm:text-sm mt-0.5 break-words">
            {displayIslem.cariler?.unvan || 'Cari Belirtilmemiş'}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            VKN / TCKN: {displayIslem.cariler?.vergi_tc_no || '-'}
          </div>
          {displayIslem.cariler?.telefon && (
            <div className="text-[10px] text-gray-600">Tel: {displayIslem.cariler.telefon}</div>
          )}
        </div>

        {/* SAĞ: İŞLEM DETAYLARI */}
        <div className="space-y-0.5">
          <span className="text-gray-500 block text-[9px] uppercase font-bold tracking-wider">
            İŞLEM DETAYLARI
          </span>
          <div className="text-[10px] text-gray-700">
            Ödeme Türü: <strong className="uppercase text-gray-900">{displayIslem.tur.replace('_', ' ')}</strong>
          </div>
          {displayIslem.belge_no && (
            <div className="text-[10px] text-gray-700">
              Belge/Evrak No: <strong className="font-mono text-gray-900">{displayIslem.belge_no}</strong>
            </div>
          )}
          {displayIslem.banka_adi && (
            <div className="text-[10px] text-gray-700">
              Banka: <strong className="text-gray-900">{displayIslem.banka_adi}</strong>
            </div>
          )}
          {displayIslem.vade && (
            <div className="text-[10px] text-gray-700">
              Vade Tarihi: <strong className="text-gray-900">{formatDate(displayIslem.vade)}</strong>
            </div>
          )}
        </div>
      </div>

      {/* 3. BİRDEN FAZLA ÇEK TABLOSU (Varsa özel formatlı çek dökümü) */}
      {cekSatirlari.length > 0 && (
        <div className="border border-teal-200 bg-teal-50/50 rounded-lg p-2.5">
          <span className="text-teal-900 font-bold block text-[9px] uppercase tracking-wider mb-1">
            Tahsil Edilen Çek / Senet Detayları ({cekSatirlari.length} Adet):
          </span>
          <div className="space-y-1 font-mono text-[9.5px] text-gray-800">
            {cekSatirlari.map((satir, idx) => (
              <div key={idx} className="flex items-center justify-between py-0.5 border-b border-teal-100 last:border-b-0">
                <span className="truncate pr-2">{satir.replace('[ÇEK SATIRI] ', '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. AÇIKLAMA / NOT (Sarı tonlu resimdeki kutu) */}
      {displayIslem.aciklama && (
        <div className="bg-amber-50/60 p-2.5 rounded-lg border border-amber-200/70">
          <span className="text-amber-800 font-bold block text-[9.5px] uppercase tracking-wider">
            AÇIKLAMA / NOT:
          </span>
          <div className="text-gray-800 text-[10.5px] mt-0.5 whitespace-pre-line leading-relaxed">
            {displayIslem.aciklama}
          </div>
        </div>
      )}

      {/* 5. TUTAR ALANI (Yalnızca + Toplam Tutar, Resimdeki gibi) */}
      <div className="border-t-2 border-b-2 border-gray-900 py-2.5 flex items-center justify-between">
        <div>
          <span className="text-gray-500 text-[9px] uppercase font-bold block tracking-wider">
            YALNIZCA:
          </span>
          <span className="italic font-medium text-gray-800 text-[11px]">
            #{tutarYazi}#
          </span>
        </div>
        <div className="text-right">
          <span className="text-gray-500 text-[9px] uppercase font-bold block tracking-wider">
            TOPLAM TUTAR:
          </span>
          <span className="text-lg sm:text-xl font-black text-gray-900 font-mono tracking-tight">
            {formatCurrency(displayIslem.tutar)}
          </span>
        </div>
      </div>

      {/* 6. İMZA ALANLARI */}
      <div className="grid grid-cols-2 gap-4 pt-2">
        <div className="text-center">
          <div className="text-gray-600 font-semibold mb-8 text-[10px]">
            {isTahsilat ? 'Tahsil Eden' : 'Tediye Eden (Yetkili)'}
          </div>
          <div className="border-t border-gray-400 mx-auto w-32 pt-1 text-[9px] text-gray-500">
            {displayIslem.profiles?.ad_soyad || 'Firma Yetkilisi'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-gray-600 font-semibold mb-8 text-[10px]">Teslim Alan</div>
          <div className="border-t border-gray-400 mx-auto w-32 pt-1 text-[9px] text-gray-500">
            İmza / Kaşe
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[96vh] flex flex-col shadow-2xl overflow-hidden my-auto print:max-h-none print:shadow-none print:border-none print:w-full print:m-0 print:rounded-none">
        {/* ÜST EYLEM ÇUBUĞU (Yazıcıda gizlenir) */}
        <div className="no-print p-3.5 sm:p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-900/95 sticky top-0 z-30 shadow-md">
          <div className="flex items-center gap-2.5">
            {/* HER EKRANDA KESİN ÇALIŞAN GERİ / KAPAT BUTONU */}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-teal-300 hover:text-white border border-teal-500/30 shadow-md flex items-center gap-1.5 text-xs font-bold transition"
              title="Geri Dön / Makbuzu Kapat"
            >
              <ArrowLeft className="w-4 h-4 text-teal-400" />
              <span>Geri</span>
            </button>

            <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 border border-teal-500/30 flex items-center justify-center font-bold">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base tracking-tight">{baslik} Önizleme</h3>
              <span className="text-xs text-slate-400 font-mono">
                {displayIslem.makbuz_no || `#${displayIslem.id.slice(0, 8)}`}
              </span>
            </div>
          </div>

          {/* NÜSHA SEÇİMİ VE AKSİYONLAR */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Çapraz İşlem Eşleşmesi Geçişi */}
            {isCapraz && linkedIslem && (
              <div className="flex rounded-xl bg-purple-500/15 p-1 border border-purple-500/30 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('current')}
                  className={`px-2.5 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                    activeTab === 'current'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-purple-300 hover:text-white'
                  }`}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>{islem.tip === 'tahsilat' ? 'Müşteri Tahsilatı' : 'Tedarikçi Tediyesi'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('linked')}
                  className={`px-2.5 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                    activeTab === 'linked'
                      ? 'bg-purple-600 text-white shadow'
                      : 'text-purple-300 hover:text-white'
                  }`}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>{linkedIslem.tip === 'tahsilat' ? 'Müşteri Tahsilatı' : 'Tedarikçi Tediyesi'}</span>
                </button>
              </div>
            )}

            {/* Nüsha Segment */}
            <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-700/80 text-xs">
              <button
                type="button"
                onClick={() => setNusha('1')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  nusha === '1' ? 'bg-teal-400 text-slate-950 shadow font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                1 Nüsha
              </button>
              <button
                type="button"
                onClick={() => setNusha('2')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  nusha === '2' ? 'bg-teal-400 text-slate-950 shadow font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                2 Nüsha
              </button>
            </div>

            {/* PDF İndir */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfLoading}
              title="Makbuzu PDF dosyası olarak cihaza kaydet"
              className="px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 border border-indigo-500/40 shadow-sm transition disabled:opacity-50"
            >
              {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4 text-indigo-400" />}
              <span>PDF İndir</span>
            </button>

            {/* WhatsApp PDF Paylaş (Gerçek PDF Eki) */}
            <button
              type="button"
              onClick={handleWhatsAppPdfShare}
              disabled={pdfLoading}
              title="Makbuzu PDF eki olarak WhatsApp ile paylaş"
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
            >
              {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              <span>WhatsApp PDF</span>
            </button>

            {/* Mail ile PDF Eki Gönder */}
            <button
              type="button"
              onClick={handleMailPdfShare}
              disabled={pdfLoading}
              title="Makbuzu PDF eki olarak Gmail/E-posta ile gönder"
              className="px-3 py-1.5 rounded-xl bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 text-xs font-semibold flex items-center gap-1.5 border border-sky-500/40 transition disabled:opacity-50"
            >
              {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              <span>Mail PDF</span>
            </button>

            {/* WhatsApp Metin Mesajı */}
            <button
              type="button"
              onClick={handleWhatsAppText}
              title="Sadece metin özeti olarak WhatsApp'tan gönder"
              className="px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1 border border-slate-700 transition"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Metin</span>
            </button>

            {/* Yazdır */}
            <button
              type="button"
              onClick={handlePrint}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 border border-slate-600 shadow-sm transition"
            >
              <Printer className="w-4 h-4 text-teal-400" />
              <span>Yazdır</span>
            </button>

            {/* Kapat Butonu */}
            <button
              type="button"
              onClick={onClose}
              title="Kapat"
              className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-bold flex items-center gap-1 transition ml-1"
            >
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">Kapat</span>
            </button>
          </div>
        </div>

        {/* BİLDİRİM BANNERI */}
        {pdfSuccessMsg && (
          <div className="bg-emerald-500/20 border-b border-emerald-500/30 px-4 py-2 text-xs text-emerald-300 flex items-center justify-center gap-2 animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{pdfSuccessMsg}</span>
          </div>
        )}

        {/* KAĞIT ÖNİZLEME ALANI (BEYAZ A4 ORANLI - PDF Buradan Render Edilir) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-950/80 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          <div ref={makbuzContainerRef} className="w-full max-w-2xl space-y-6 print:space-y-4 print:max-w-none bg-white p-4 rounded-xl">
            {/* ÜST NÜSHA: MÜŞTERİ NÜSHASI */}
            {renderSingleMakbuz(nusha === '2' ? 'MÜŞTERİ NÜSHASI' : 'ASIL')}

            {/* 2 NÜSHA SEÇİLİYSE ORTADA KESİK ÇİZGİ VE İKİNCİ FİRMA NÜSHASI */}
            {nusha === '2' && (
              <>
                <div className="relative py-2 flex items-center justify-center no-print">
                  <div className="border-t-2 border-dashed border-slate-400 w-full" />
                  <span className="absolute bg-white px-3 text-[10px] text-gray-500 font-mono tracking-widest uppercase">
                    ✂ Kesim Çizgisi
                  </span>
                </div>
                {renderSingleMakbuz('FİRMA NÜSHASI')}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
