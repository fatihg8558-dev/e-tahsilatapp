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
  Pencil,
  Trash2,
} from 'lucide-react';
import { openWhatsApp, openExternalLink, formatWhatsAppPhone } from '../../lib/linkHelper';
import { downloadMakbuzPdf, shareMakbuzPdfTarget } from '../../lib/pdfGenerator';
import {
  KarmaParsedLine,
  buildKarmaLinesFromSiblingIslemler,
  extractKarmaRef,
  parseKarmaFromAciklama,
} from '../../lib/karmaReceiptHelper';
import { DeleteReceiptConfirmModal } from './DeleteReceiptConfirmModal';

interface MakbuzModalProps {
  islem: Islem | null;
  onClose: () => void;
  onEdit?: (islem: Islem) => void;
  onDeleted?: () => void;
}

export const MakbuzModal: React.FC<MakbuzModalProps> = ({ islem, onClose, onEdit, onDeleted }) => {
  const { firma, profile } = useAuth();
  const [nusha, setNusha] = useState<'1' | '2'>('2');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfSuccessMsg, setPdfSuccessMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Islem | null>(null);
  const makbuzContainerRef = useRef<HTMLDivElement>(null);

  // Çapraz İşlem Eşleşmesi (Müşteri Tahsilatı <-> Tedarikçi Tediyesi)
  const isCapraz =
    !!islem?.aciklama?.includes('[ÇAPRAZ ÖDEME') ||
    !!islem?.belge_no?.startsWith('ÇPZ-') ||
    !!islem?.aciklama?.includes('ÇAPRAZ');
  const [linkedIslem, setLinkedIslem] = useState<Islem | null>(null);
  const [karmaSiblings, setKarmaSiblings] = useState<Islem[]>([]);
  const [activeTab, setActiveTab] = useState<'current' | 'linked'>('current');
  const [cariContact, setCariContact] = useState<{
    unvan?: string;
    vergi_tc_no?: string | null;
    telefon?: string | null;
    email?: string | null;
  } | null>(null);

  const currentCariId =
    activeTab === 'linked' && linkedIslem ? linkedIslem.cari_id : islem?.cari_id;

  useEffect(() => {
    setActiveTab('current');
    setLinkedIslem(null);
    setKarmaSiblings([]);
  }, [islem?.id]);

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

  // Karma Makbuz (aynı Ref etiketini paylaşan kardeş satırları getir)
  const islemKarmaRef = extractKarmaRef(islem?.aciklama);
  useEffect(() => {
    if (!islemKarmaRef || !firma?.id || !islem) {
      setKarmaSiblings([]);
      return;
    }
    let cancelled = false;
    supabase
      .from('islemler')
      .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
      .eq('firma_id', firma.id)
      .eq('iptal', islem.iptal)
      .ilike('aciklama', `%${islemKarmaRef}%`)
      .order('id', { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data && data.length > 0) {
          setKarmaSiblings(data as Islem[]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [islem?.id, islem?.iptal, islemKarmaRef, firma?.id]);

  // Carinin güncel telefon, e-posta ve VKN bilgilerini her durumda garantiye al
  useEffect(() => {
    if (!currentCariId) {
      setCariContact(null);
      return;
    }
    let cancelled = false;
    supabase
      .from('cariler')
      .select('unvan, vergi_tc_no, telefon, email')
      .eq('id', currentCariId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setCariContact(data);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentCariId]);

  if (!islem) return null;

  // Hangi işlem gösteriliyor: Ana seçilen mi yoksa eşleşen çapraz işlem mi?
  const displayIslem = activeTab === 'linked' && linkedIslem ? linkedIslem : islem;
  const resolvedCariUnvan = cariContact?.unvan || displayIslem.cariler?.unvan || 'Müşterimiz';
  const resolvedCariVkn = cariContact?.vergi_tc_no ?? displayIslem.cariler?.vergi_tc_no ?? '-';
  const resolvedCariTelefon = cariContact?.telefon ?? displayIslem.cariler?.telefon ?? '';
  const resolvedCariEmail = cariContact?.email ?? displayIslem.cariler?.email ?? '';

  // Karma Makbuz hesaplamaları (kardeş satırlar veya tek-satır [KARMA-KALEM] dökümü)
  const parsedKarmaFromSingle = parseKarmaFromAciklama(displayIslem.aciklama);
  const karmaItems: KarmaParsedLine[] =
    activeTab === 'current' && karmaSiblings.length > 0
      ? buildKarmaLinesFromSiblingIslemler(karmaSiblings)
      : parsedKarmaFromSingle.kalemler;
  const isKarmaMakbuz = karmaItems.length > 0;

  const effectiveToplamTutar =
    activeTab === 'current' && karmaSiblings.length > 0
      ? Math.round(karmaSiblings.reduce((acc, r) => acc + (Number(r.tutar) || 0), 0) * 100) / 100
      : Number(displayIslem.tutar) || 0;

  const uniqueMakbuzNolar =
    activeTab === 'current' && karmaSiblings.length > 0
      ? Array.from(
          new Set(
            karmaSiblings.map((r) => r.makbuz_no || `#${r.id.slice(0, 8)}`).filter(Boolean)
          )
        )
      : [displayIslem.makbuz_no || `#${displayIslem.id.slice(0, 8)}`];

  const effectiveMakbuzNoLabel = uniqueMakbuzNolar.join(', ');
  const activeKarmaTypeLabels = Array.from(new Set(karmaItems.map((k) => k.label.toUpperCase()))).join(' + ');

  const isTahsilat = displayIslem.tip === 'tahsilat';
  const baslik = isTahsilat ? 'TAHSİLAT MAKBUZU' : 'TEDİYE MAKBUZU';
  const tutarYazi = numberToTurkishWords(effectiveToplamTutar);
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
      const formattedPhone = formatWhatsAppPhone(resolvedCariTelefon);
      const caption = `Sayın ${resolvedCariUnvan},\n\n${formatDate(displayIslem.tarih)} tarihli, ${effectiveMakbuzNoLabel} numaralı ve ${formatCurrency(effectiveToplamTutar)} tutarındaki ${baslik} PDF belgesi ektedir.\n\nBilgilerinize sunarız.\n${firma?.unvan || ''}`;

      const res = await shareMakbuzPdfTarget(
        makbuzContainerRef.current,
        makbuzDosyaAdi,
        'whatsapp',
        {
          phone: formattedPhone,
          caption,
        }
      );

      if (res.fallbackNeeded) {
        setPdfSuccessMsg('PDF indirildi! WhatsApp sohbetine ekleyebilirsiniz.');
        setTimeout(() => setPdfSuccessMsg(null), 4000);
        openWhatsApp(resolvedCariTelefon, caption);
      } else if (!formattedPhone) {
        setPdfSuccessMsg('Caride telefon numarası kayıtlı olmadığı için WhatsApp kişi seçimi açıldı.');
        setTimeout(() => setPdfSuccessMsg(null), 4000);
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
   * Android uygulamasında doğrudan Gmail / Outlook uygulamasına PDF dosyasını EK (attachment) olarak iliştirir
   * ve carideki e-posta adresini alıcı ("Kime") alanına otomatik yazar.
   */
  const handleMailPdfShare = async () => {
    if (!makbuzContainerRef.current) return;
    try {
      setPdfLoading(true);
      const email = (resolvedCariEmail || '').trim();
      const subject = `${baslik} - ${effectiveMakbuzNoLabel}`;
      const caption = `Sayın ${resolvedCariUnvan},\n\n${formatDate(displayIslem.tarih)} tarihli ve ${formatCurrency(effectiveToplamTutar)} tutarındaki ${baslik} PDF formatında ekte bilgilerinize sunulmuştur.\n\nSaygılarımızla,\n${firma?.unvan || ''}`;

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
      } else if (!email) {
        setPdfSuccessMsg('Caride e-posta adresi kayıtlı olmadığı için alıcı alanı boş açıldı.');
        setTimeout(() => setPdfSuccessMsg(null), 4000);
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
    const karmaTextDetay = isKarmaMakbuz
      ? `\nÖdeme Kalemleri:\n${karmaItems.map((k) => `- ${k.label}: ${formatCurrency(k.tutarTL)} (${k.detay})`).join('\n')}`
      : '';
    const msg = `Sayın ${resolvedCariUnvan},\n\n${formatDate(displayIslem.tarih)} tarihli, ${effectiveMakbuzNoLabel} numaralı ve ${formatCurrency(effectiveToplamTutar)} tutarındaki ${baslik} düzenlenmiştir.\n\nİşlem Türü: ${isKarmaMakbuz ? `KARMA (${activeKarmaTypeLabels})` : displayIslem.tur?.toUpperCase() || ''}${karmaTextDetay}\nDetay: ${plainAciklama || '-'}\n\nBilgilerinize sunarız.\n${firma?.unvan || ''}`;
    openWhatsApp(resolvedCariTelefon, msg);
  };

  // Çek/Senet satırı tespiti (tekrar göstermemek için büyük/küçük harf duyarsız)
  const isCheckDetailLine = (line: string): boolean => {
    const lower = line.toLowerCase().trim();
    return (
      lower.startsWith('[çek satırı]') ||
      lower.startsWith('[cek satiri]') ||
      (lower.includes('nl.') && lower.includes('vd.'))
    );
  };

  // Çoklu çek satırlarını tespit et
  const parseCekSatirlari = (aciklamaStr?: string | null) => {
    if (!aciklamaStr) return [];
    const lines = aciklamaStr.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.filter(isCheckDetailLine);
  };

  const cekSatirlari = isKarmaMakbuz ? [] : parseCekSatirlari(displayIslem.aciklama);
  const plainAciklama = isKarmaMakbuz
    ? parsedKarmaFromSingle.cleanNote
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('[DÖVİZ:') && !l.startsWith('[CİRO]') && !isCheckDetailLine(l))
        .join('\n')
        .trim()
    : displayIslem.aciklama
    ? displayIslem.aciklama
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !isCheckDetailLine(l))
        .join('\n')
    : '';

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
          {firma?.adres && <div className="text-[10px] text-gray-600 break-words">{firma.adres}</div>}
          {firma?.telefon && <div className="text-[10px] text-gray-600">Tel: {firma.telefon}</div>}
        </div>

        {/* SAĞ: Çapraz / Karma / Nüsha Etiketi & Başlık & Makbuz No */}
        <div className="text-right">
          <div className="flex items-center justify-end gap-1 mb-1">
            {isCapraz && (
              <span className="inline-block px-2 py-0.5 border border-purple-400 bg-purple-50 font-bold text-[8.5px] uppercase tracking-wider text-purple-700 rounded">
                Çapraz İşlem
              </span>
            )}
            {isKarmaMakbuz && (
              <span className="inline-block px-2 py-0.5 border border-teal-500 bg-teal-50 font-bold text-[8.5px] uppercase tracking-wider text-teal-800 rounded">
                Karma Makbuz
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
            Makbuz No: <span className="text-gray-900 font-bold">{effectiveMakbuzNoLabel}</span>
          </div>
          <div className="text-[10px] text-gray-500">
            Düzenleme Tarihi: <span className="text-gray-900 font-bold">{formatDate(displayIslem.tarih)}</span>
          </div>
        </div>
      </div>

      {/* 2. MUHATTAP (CARİ BİLGİLERİ) & İŞLEM DETAYLARI KARTI */}
      <div className="grid grid-cols-2 gap-3 bg-gray-50/90 p-3 rounded-lg border border-gray-200">
        {/* SOL: ÖDEMEYİ YAPAN (MÜŞTERİ / ALICI) */}
        <div>
          <span className="text-gray-500 block text-[9px] uppercase font-bold tracking-wider">
            {isTahsilat ? 'ÖDEMEYİ YAPAN (MÜŞTERİ / ALICI)' : 'ÖDEMEYİ ALAN (TEDARİKÇİ)'}
          </span>
          <div className="font-bold text-gray-900 text-xs sm:text-sm mt-0.5 break-words">
            {displayIslem.cariler?.unvan || cariContact?.unvan || 'Cari Belirtilmemiş'}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            VKN / TCKN: {resolvedCariVkn}
          </div>
          {resolvedCariTelefon && (
            <div className="text-[10px] text-gray-600">Tel: {resolvedCariTelefon}</div>
          )}
        </div>

        {/* SAĞ: İŞLEM DETAYLARI */}
        <div className="space-y-0.5">
          <span className="text-gray-500 block text-[9px] uppercase font-bold tracking-wider">
            İŞLEM DETAYLARI
          </span>
          <div className="text-[10px] text-gray-700">
            Ödeme Türü:{' '}
            <strong className="uppercase text-gray-900">
              {isKarmaMakbuz ? `KARMA (${activeKarmaTypeLabels})` : displayIslem.tur.replace('_', ' ')}
            </strong>
          </div>
          {!isKarmaMakbuz && displayIslem.belge_no && (
            <div className="text-[10px] text-gray-700">
              Belge/Evrak No: <strong className="font-mono text-gray-900">{displayIslem.belge_no}</strong>
            </div>
          )}
          {!isKarmaMakbuz && displayIslem.banka_adi && (
            <div className="text-[10px] text-gray-700">
              Banka: <strong className="text-gray-900">{displayIslem.banka_adi}</strong>
            </div>
          )}
          {!isKarmaMakbuz && displayIslem.vade && (
            <div className="text-[10px] text-gray-700">
              Vade Tarihi: <strong className="text-gray-900">{formatDate(displayIslem.vade)}</strong>
            </div>
          )}
          {isKarmaMakbuz && (islemKarmaRef || karmaItems.length > 0) && (
            <div className="text-[10px] text-gray-700">
              Kalem Sayısı: <strong className="text-gray-900">{karmaItems.length} Adet Ödeme</strong>
              {islemKarmaRef ? <span className="ml-1 font-mono text-gray-500">({islemKarmaRef})</span> : null}
            </div>
          )}
        </div>
      </div>

      {/* 3A. KARMA MAKBUZ KALEMLERİ DÖKÜMÜ */}
      {isKarmaMakbuz && (
        <div className="border border-teal-200 bg-teal-50/40 rounded-lg p-2.5">
          <span className="text-teal-900 font-bold block text-[9px] uppercase tracking-wider mb-1">
            Karma Ödeme Kalemleri Dökümü ({karmaItems.length} Kalem):
          </span>
          <div className="divide-y divide-teal-100 text-[9.5px] text-gray-800">
            {karmaItems.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 py-1">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-gray-900 uppercase mr-1.5">[{item.label}]</span>
                  <span className="text-gray-700 break-words">{item.detay}</span>
                  {item.orijinalText && (
                    <span className="ml-1.5 text-[9px] text-teal-800 font-mono">
                      ({item.orijinalText})
                    </span>
                  )}
                </div>
                <div className="font-mono font-bold text-gray-900 shrink-0">
                  {formatCurrency(item.tutarTL)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3B. BİRDEN FAZLA ÇEK TABLOSU (Varsa özel formatlı çek dökümü) */}
      {cekSatirlari.length > 0 && (
        <div className="border border-teal-200 bg-teal-50/50 rounded-lg p-2.5">
          <span className="text-teal-900 font-bold block text-[9px] uppercase tracking-wider mb-1">
            Tahsil Edilen Çek / Senet Detayları ({cekSatirlari.length} Adet):
          </span>
          <div className="space-y-1 font-mono text-[10px] text-gray-800">
            {cekSatirlari.map((satir, idx) => (
              <div key={idx} className="py-0.5 border-b border-teal-100 last:border-b-0">
                <span className="whitespace-normal break-words block">
                  {satir.replace(/^\[ÇEK SATIRI\]\s*/i, '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. AÇIKLAMA / NOT (Sarı tonlu resimdeki kutu) */}
      {plainAciklama && (
        <div className="bg-amber-50/60 p-2.5 rounded-lg border border-amber-200/70">
          <span className="text-amber-800 font-bold block text-[9.5px] uppercase tracking-wider">
            AÇIKLAMA / NOT:
          </span>
          <div className="text-gray-800 text-[10.5px] mt-0.5 whitespace-pre-line leading-relaxed">
            {plainAciklama}
          </div>
        </div>
      )}

      {/* 5. TUTAR ALANI (Yalnızca + Toplam Tutar) */}
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
            {formatCurrency(effectiveToplamTutar)}
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
                {effectiveMakbuzNoLabel}
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

            {/* Makbuzu Güncelle */}
            {onEdit && !displayIslem.iptal && profile?.rol !== 'muhasebeci' && (
              <button
                type="button"
                onClick={() => onEdit(displayIslem)}
                title="Makbuzu Güncelle / Düzenle"
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 text-xs font-bold flex items-center gap-1.5 border border-amber-500/40 shadow-sm transition"
              >
                <Pencil className="w-3.5 h-3.5 text-amber-400" />
                <span>Güncelle</span>
              </button>
            )}

            {/* Makbuzu Sil */}
            {profile?.rol !== 'muhasebeci' && (
              <button
                type="button"
                onClick={() => setDeleteTarget(displayIslem)}
                data-testid="makbuz_modal_delete_button"
                title="Makbuzu Kalıcı Olarak Sil"
                className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/35 text-red-200 text-xs font-bold flex items-center gap-1.5 border border-red-500/40 shadow-sm transition"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span>Sil</span>
              </button>
            )}

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

        {/* KAĞIT ÖNİZLEME ALANI (BEYAZ A4 ORANLI - Telefon ekranına sıkıştırılmaz, yatay kaydırmalı ve tam yazdırılabilir) */}
        <div className="flex-1 overflow-auto p-3 sm:p-8 bg-slate-950/80 flex justify-start md:justify-center print:p-0 print:bg-white print:overflow-visible">
          <div ref={makbuzContainerRef} className="w-[680px] min-w-[680px] space-y-6 print:space-y-4 print:w-full print:min-w-0 bg-white p-5 rounded-xl">
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

      {/* MAKBUZ SİLME ONAY MODALI */}
      <DeleteReceiptConfirmModal
        islem={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          if (onDeleted) onDeleted();
          else onClose();
        }}
      />
    </div>
  );
};
