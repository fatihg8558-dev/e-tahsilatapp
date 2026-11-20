import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  FileCheck2,
  Download,
  Share2,
  Copy,
  Check,
  MessageCircle,
  ExternalLink,
  RefreshCw,
  Code2,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Cari } from '../../types/database';
import { RawEkstreMovement, buildCariEkstre } from '../../lib/cariEkstreHelper';
import { formatCurrency, formatDate, getTodayIsoLocal } from '../../lib/formatters';
import { downloadMakbuzPdf, shareMakbuzPdfTarget } from '../../lib/pdfGenerator';
import { openExternalLink, openWhatsApp } from '../../lib/linkHelper';
import { getPosConfig } from '../../lib/posService';
import { fetchCloudPosConfig } from '../../lib/posGatewayService';
import {
  buildMutabakatPublicUrl,
  buildMutabakatWhatsAppMessage,
  CARI_MUTABAKAT_SQL_SNIPPET,
  CariMutabakatRecord,
  createCloudMutabakatRecord,
  describeMutabakatBalance,
  fetchMutabakatHistoryForCari,
  MutabakatSummaryItem,
} from '../../lib/mutabakatService';

interface MutabakatMektubuModalProps {
  isOpen: boolean;
  onClose: () => void;
  cari: Cari | null;
  movements: RawEkstreMovement[];
  initialEndDate?: string;
  initialRecord?: CariMutabakatRecord | null;
  onPreviewLink?: (code: string) => void;
  onMutabakatChanged?: () => void;
}

export const MutabakatMektubuModal: React.FC<MutabakatMektubuModalProps> = ({
  isOpen,
  onClose,
  cari,
  movements,
  initialEndDate,
  initialRecord = null,
  onPreviewLink,
  onMutabakatChanged,
}) => {
  const { firma } = useAuth();
  const letterRef = useRef<HTMLDivElement | null>(null);

  const [mutabakatTarihi, setMutabakatTarihi] = useState(initialEndDate || getTodayIsoLocal());
  const [donemBaslik, setDonemBaslik] = useState('');
  const [posConfig, setPosConfig] = useState(() => getPosConfig(firma?.id));

  const [activeRecord, setActiveRecord] = useState<CariMutabakatRecord | null>(null);
  const [historyRecords, setHistoryRecords] = useState<CariMutabakatRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [missingTable, setMissingTable] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [copiedKey, setCopiedKey] = useState<'link' | 'sql' | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen || !cari || !firma?.id) return;
    setMutabakatTarihi(initialRecord?.mutabakat_tarihi || initialEndDate || getTodayIsoLocal());
    const d = new Date();
    const monthName = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
    setDonemBaslik(
      initialRecord?.donem_baslik ||
        `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} Cari Mutabakatı`
    );
    setActiveRecord(initialRecord || null);
    setFeedback(null);
    setMissingTable(false);
    setShowSql(false);

    void fetchCloudPosConfig(firma.id).then((cfg) => setPosConfig(cfg));
    void loadHistory(initialRecord);
  }, [isOpen, cari?.id, firma?.id, initialEndDate, initialRecord?.id]);

  const loadHistory = async (preferredRecord?: CariMutabakatRecord | null) => {
    if (!firma?.id || !cari?.id) return;
    setLoadingHistory(true);
    try {
      const res = await fetchMutabakatHistoryForCari(firma.id, cari.id);
      setHistoryRecords(res.records);
      if (res.missingTable) {
        setMissingTable(true);
        setShowSql(true);
      }
      if (preferredRecord) {
        const refreshed = res.records.find((r) => r.id === preferredRecord.id);
        setActiveRecord(refreshed || preferredRecord);
      } else if (res.records.length > 0 && !activeRecord) {
        setActiveRecord(res.records[0]);
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  const calculatedSnapshot = useMemo(() => {
    const ekstreResult = buildCariEkstre({
      movements,
      endDate: mutabakatTarihi || undefined,
      currentCariBakiye: cari?.bakiye,
    });
    const ekstreRows = ekstreResult.rows;
    const netBakiye =
      ekstreRows.length > 0
        ? ekstreResult.summary.closingBalance
        : Number(cari?.bakiye) || 0;

    const nonOpeningRows = ekstreRows.filter((r) => !r.isOpeningRow);
    const faturaCount = nonOpeningRows.filter((r) => r.isInvoice).length;
    const islemCount = nonOpeningRows.length - faturaCount;

    const ozetKalemler: MutabakatSummaryItem[] = ekstreRows.slice(-10).map((r) => ({
      tarih: r.dateKey || r.formattedDate,
      tip: r.tipLabel,
      belgeNo: r.belgeNo,
      aciklama: r.aciklama,
      borc: r.borc,
      alacak: r.alacak,
    }));

    return { netBakiye, faturaCount, islemCount, ozetKalemler };
  }, [movements, mutabakatTarihi, cari?.bakiye]);

  const activeUrl = useMemo(() => {
    if (!activeRecord) return '';
    return buildMutabakatPublicUrl(activeRecord.mutabakat_kodu, posConfig);
  }, [activeRecord, posConfig]);

  if (!isOpen || !cari || !firma) return null;

  const displayBakiye = activeRecord ? Number(activeRecord.bakiye) : calculatedSnapshot.netBakiye;
  const displayTarih = activeRecord ? activeRecord.mutabakat_tarihi : mutabakatTarihi;
  const displayDonem = activeRecord ? activeRecord.donem_baslik || '' : donemBaslik;
  const displayKalemler = activeRecord?.ozet_kalemler?.length
    ? activeRecord.ozet_kalemler
    : calculatedSnapshot.ozetKalemler;
  const balanceInfo = describeMutabakatBalance(displayBakiye);

  const ensureRecordOrCreate = async (): Promise<CariMutabakatRecord | null> => {
    if (activeRecord) return activeRecord;
    setCreatingLink(true);
    setFeedback(null);
    try {
      const res = await createCloudMutabakatRecord({
        firma: {
          id: firma.id,
          unvan: firma.unvan,
          vergi_no: firma.vergi_no,
          telefon: firma.telefon,
        },
        cari,
        mutabakatTarihi,
        donemBaslik,
        bakiye: calculatedSnapshot.netBakiye,
        faturaSayisi: calculatedSnapshot.faturaCount,
        islemSayisi: calculatedSnapshot.islemCount,
        ozetKalemler: calculatedSnapshot.ozetKalemler,
      });

      if (res.missingTable) {
        setMissingTable(true);
        setShowSql(true);
        setFeedback({
          type: 'error',
          text: 'Online mutabakat linki oluşturmak için aşağıdaki "cari_mutabakatlar" SQL kodunu Supabase SQL Editor üzerinde bir kez çalıştırmanız gerekiyor.',
        });
        return null;
      }

      if (res.error || !res.record) {
        setFeedback({ type: 'error', text: res.error || 'Mutabakat linki oluşturulamadı.' });
        return null;
      }

      setActiveRecord(res.record);
      setHistoryRecords((prev) => [res.record!, ...prev.filter((r) => r.id !== res.record!.id)]);
      onMutabakatChanged?.();
      setFeedback({
        type: 'success',
        text: `Mutabakat kaydı ve online cevap linki oluşturuldu (${res.record.mutabakat_kodu}).`,
      });
      return res.record;
    } finally {
      setCreatingLink(false);
    }
  };

  const handleCreateNewLink = async () => {
    setCreatingLink(true);
    setFeedback(null);
    try {
      const res = await createCloudMutabakatRecord({
        firma: {
          id: firma.id,
          unvan: firma.unvan,
          vergi_no: firma.vergi_no,
          telefon: firma.telefon,
        },
        cari,
        mutabakatTarihi,
        donemBaslik,
        bakiye: calculatedSnapshot.netBakiye,
        faturaSayisi: calculatedSnapshot.faturaCount,
        islemSayisi: calculatedSnapshot.islemCount,
        ozetKalemler: calculatedSnapshot.ozetKalemler,
      });

      if (res.missingTable) {
        setMissingTable(true);
        setShowSql(true);
        setFeedback({
          type: 'error',
          text: 'Online mutabakat tablosu henüz oluşturulmamış. Aşağıdaki SQL kodunu Supabase SQL Editor üzerinde bir kez çalıştırınız.',
        });
        return;
      }

      if (res.error || !res.record) {
        setFeedback({ type: 'error', text: res.error || 'Mutabakat linki oluşturulamadı.' });
        return;
      }

      setActiveRecord(res.record);
      setHistoryRecords((prev) => [res.record!, ...prev]);
      onMutabakatChanged?.();
      setFeedback({
        type: 'success',
        text: `Yeni mutabakat linki hazır: ${res.record.mutabakat_kodu}`,
      });
    } finally {
      setCreatingLink(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!letterRef.current) return;
    setPdfBusy(true);
    setFeedback(null);
    try {
      const cleanName = cari.unvan
        .replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s]/g, '')
        .trim()
        .replace(/\s+/g, '_');
      const codeSuffix = activeRecord?.mutabakat_kodu || mutabakatTarihi;
      await downloadMakbuzPdf(letterRef.current, `Mutabakat_${cleanName}_${codeSuffix}`);
      setFeedback({ type: 'success', text: 'A4 Mutabakat Mektubu PDF olarak indirildi.' });
    } catch {
      setFeedback({ type: 'error', text: 'PDF hazırlanırken hata oluştu.' });
    } finally {
      setPdfBusy(false);
    }
  };

  const handleSharePdfOrLink = async (target: 'whatsapp' | 'mail') => {
    if (!letterRef.current) return;
    setPdfBusy(true);
    setFeedback(null);
    try {
      const rec = await ensureRecordOrCreate();
      const linkUrl = rec ? buildMutabakatPublicUrl(rec.mutabakat_kodu, posConfig) : '';
      const message = rec
        ? buildMutabakatWhatsAppMessage({
            firmaUnvan: firma.unvan,
            cariUnvan: cari.unvan,
            mutabakatTarihi: rec.mutabakat_tarihi,
            bakiye: Number(rec.bakiye),
            mutabakatUrl: linkUrl,
            mutabakatKodu: rec.mutabakat_kodu,
            donemBaslik: rec.donem_baslik,
          })
        : `Sayın ${cari.unvan}, ${formatDate(mutabakatTarihi)} tarihli mutabakat mektubunuz ektedir.`;

      const cleanName = cari.unvan
        .replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s]/g, '')
        .trim()
        .replace(/\s+/g, '_');

      const shareRes = await shareMakbuzPdfTarget(
        letterRef.current,
        `Mutabakat_${cleanName}_${rec?.mutabakat_kodu || mutabakatTarihi}`,
        target,
        {
          phone: cari.telefon,
          email: cari.email,
          subject: `${firma.unvan} - Cari Hesap Mutabakat Mektubu`,
          caption: message,
        }
      );

      if (shareRes.fallbackNeeded && target === 'whatsapp') {
        openWhatsApp(cari.telefon, message);
      } else if (shareRes.fallbackNeeded && target === 'mail') {
        const subject = encodeURIComponent(`${firma.unvan} - Cari Hesap Mutabakat Mektubu`);
        const body = encodeURIComponent(message);
        openExternalLink(`mailto:${cari.email || ''}?subject=${subject}&body=${body}`);
      }
    } finally {
      setPdfBusy(false);
    }
  };

  const handleCopy = (val: string, key: 'link' | 'sql') => {
    void navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderStatusBadge = (durum: CariMutabakatRecord['durum']) => {
    if (durum === 'mutabik') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          Mutabıkım
        </span>
      );
    }
    if (durum === 'itiraz') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-500/20 text-red-300 border border-red-500/30">
          <AlertTriangle className="w-3 h-3" />
          Mutabık Değil (İtiraz)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <Clock className="w-3 h-3" />
        Cevap Bekleniyor
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[74] bg-black/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      data-testid="mutabakat_mektubu_modal"
    >
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* ÜST BAŞLIK */}
        <div className="p-4 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shrink-0">
              <FileCheck2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                Cari Mutabakat Mektubu (A4 PDF) &amp; Online Cevap Linki
              </h3>
              <p className="text-[11px] text-gray-400">
                {cari.unvan} • Karşı taraf giriş yapmadan tek tıkla &quot;Mutabıkım&quot; veya &quot;İtiraz&quot; bildirebilir
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* GÖVDE */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* SOL: A4 RESMİ MUTABAKAT MEKTUBU ÖNİZLEMESİ */}
          <div className="lg:col-span-7 bg-[#090d12] border border-white/[0.06] rounded-xl p-3 sm:p-4 overflow-x-auto">
            <div
              ref={letterRef}
              className="bg-white text-slate-900 rounded-lg shadow-lg p-6 sm:p-8 mx-auto max-w-[720px] space-y-5 text-[12px] leading-relaxed"
            >
              {/* Firma Üst Başlık */}
              <div className="flex items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
                <div className="flex items-start gap-3">
                  {firma.logo_data && (
                    <img
                      src={firma.logo_data}
                      alt="Firma Logosu"
                      className="h-12 w-auto object-contain rounded"
                    />
                  )}
                  <div>
                    <div className="text-base font-black text-slate-900 tracking-tight">
                      {firma.unvan}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      VKN / TCKN: <span className="font-mono font-semibold">{firma.vergi_no}</span>
                      {firma.vergi_dairesi ? ` · ${firma.vergi_dairesi}` : ''}
                    </div>
                    {firma.adres && <div className="text-[10.5px] text-slate-500">{firma.adres}</div>}
                    {firma.telefon && (
                      <div className="text-[10.5px] text-slate-500">Tel: {firma.telefon}</div>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="inline-block px-2.5 py-1 rounded bg-slate-900 text-white text-[10px] font-extrabold uppercase tracking-wider">
                    CARİ HESAP MUTABAKATI
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-600">
                    Tarih: <strong className="text-slate-900">{formatDate(displayTarih)}</strong>
                  </div>
                  {activeRecord?.mutabakat_kodu && (
                    <div className="text-[10.5px] font-mono font-bold text-teal-700">
                      Ref: {activeRecord.mutabakat_kodu}
                    </div>
                  )}
                </div>
              </div>

              {/* Muhatap Bilgisi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Sayın Muhatap Firma / Cari
                  </div>
                  <div className="text-sm font-extrabold text-slate-900 mt-0.5">{cari.unvan}</div>
                  {cari.vergi_tc_no && (
                    <div className="text-[11px] text-slate-600 font-mono">
                      VKN / TCKN: {cari.vergi_tc_no}
                    </div>
                  )}
                </div>
                <div className="sm:text-right">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Dönem / Konu</div>
                  <div className="text-xs font-bold text-slate-800 mt-0.5">
                    {displayDonem || 'Cari Bakiye Mutabakat Mektubu'}
                  </div>
                  <div className="text-[10.5px] text-slate-500">
                    {calculatedSnapshot.faturaCount} Fatura · {calculatedSnapshot.islemCount} Makbuz
                  </div>
                </div>
              </div>

              {/* Resmi Mutabakat Metni & Net Bakiye Kutusu */}
              <div className="space-y-3">
                <p className="text-slate-700">
                  Sayın Yetkili, şirketimiz kayıtlarına göre{' '}
                  <strong className="text-slate-900">{formatDate(displayTarih)}</strong> tarihi
                  itibarıyla cari hesabınızın net bakiye durumu aşağıda bilgilerinize sunulmuştur:
                </p>

                <div className="border-2 border-slate-900 rounded-lg p-4 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Mutabakat Bakiyesi Durumu
                    </div>
                    <div className="text-sm font-extrabold text-slate-900 mt-0.5">
                      {balanceInfo.yonLabel}
                    </div>
                  </div>
                  <div className="text-2xl font-black font-mono text-slate-900 sm:text-right">
                    {formatCurrency(balanceInfo.absAmount)}
                  </div>
                </div>
              </div>

              {/* Son Hareket Özeti Tablosu */}
              {displayKalemler.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Son Cari Hesap Hareket Özeti
                  </div>
                  <table className="w-full border-collapse text-[10.5px]">
                    <thead>
                      <tr className="bg-slate-100 border-y border-slate-300 text-slate-700">
                        <th className="py-1.5 px-2 text-left">Tarih</th>
                        <th className="py-1.5 px-2 text-left">Tür / Belge</th>
                        <th className="py-1.5 px-2 text-right">Borç</th>
                        <th className="py-1.5 px-2 text-right">Alacak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayKalemler.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-200">
                          <td className="py-1 px-2 whitespace-nowrap">{formatDate(row.tarih)}</td>
                          <td className="py-1 px-2">
                            <span className="capitalize font-semibold">{row.tip}</span>
                            {row.belgeNo ? ` (${row.belgeNo})` : ''}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {row.borc > 0 ? formatCurrency(row.borc) : '-'}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {row.alacak > 0 ? formatCurrency(row.alacak) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Online Cevap Linki Kutusu */}
              {activeUrl && (
                <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 space-y-1">
                  <div className="text-[10px] font-extrabold uppercase text-teal-800">
                    Online Hızlı Cevap Linki (Mutabıkım / İtiraz Bildir)
                  </div>
                  <div className="text-[10.5px] font-mono text-teal-900 break-all">{activeUrl}</div>
                </div>
              )}

              {/* Kaşe & İmza Alanı */}
              <div className="grid grid-cols-2 gap-6 pt-3 border-t border-slate-200 text-[10.5px]">
                <div>
                  <div className="font-bold text-slate-800">{firma.unvan}</div>
                  <div className="text-slate-500 mt-6 border-t border-dashed border-slate-300 pt-1">
                    Düzenleyen Kaşe / İmza
                  </div>
                </div>
                <div>
                  <div className="font-bold text-slate-800">{cari.unvan}</div>
                  <div className="text-slate-500 mt-6 border-t border-dashed border-slate-300 pt-1">
                    Mutabıkım Kaşe / İmza (veya Online Onay)
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SAĞ: KONTROL, PAYLAŞIM & CEVAP GEÇMİŞİ */}
          <div className="lg:col-span-5 space-y-4 text-xs">
            {feedback && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2 ${
                  feedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{feedback.text}</span>
              </div>
            )}

            {/* PARAMETRELER & LİNK ÜRETME */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/[0.08] space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Mutabakat Tarihi
                  </label>
                  <input
                    type="date"
                    value={mutabakatTarihi}
                    onChange={(e) => {
                      setMutabakatTarihi(e.target.value);
                      setActiveRecord(null);
                    }}
                    className="w-full min-h-[38px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                    Dönem / Açıklama
                  </label>
                  <input
                    type="text"
                    value={donemBaslik}
                    onChange={(e) => {
                      setDonemBaslik(e.target.value);
                      setActiveRecord(null);
                    }}
                    placeholder="Kasım 2026 Mutabakatı"
                    className="w-full min-h-[38px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={creatingLink}
                onClick={handleCreateNewLink}
                data-testid="mutabakat_create_link_btn"
                className="w-full min-h-[42px] px-4 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-extrabold flex items-center justify-center gap-2 shadow-lg transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${creatingLink ? 'animate-spin' : ''}`} />
                <span>
                  {creatingLink
                    ? 'Mutabakat Linki Oluşturuluyor...'
                    : activeRecord
                    ? 'Yeni Tarih/Bakiye İçin Yeni Link Oluştur'
                    : 'Mutabakat Linki Oluştur & Kaydet'}
                </span>
              </button>

              {activeRecord && activeUrl && (
                <div className="p-3 rounded-xl bg-[#0a0e13] border border-teal-500/30 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-teal-300 text-[11px]">
                      {activeRecord.mutabakat_kodu}
                    </span>
                    {renderStatusBadge(activeRecord.durum)}
                  </div>
                  <div className="text-[10.5px] font-mono text-gray-300 break-all bg-black/40 p-2 rounded-lg border border-white/5">
                    {activeUrl}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(activeUrl, 'link')}
                      data-testid="mutabakat_copy_link_btn"
                      className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold flex items-center justify-center gap-1.5 transition"
                    >
                      {copiedKey === 'link' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'link' ? 'Kopyalandı' : 'Linki Kopyala'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (onPreviewLink) {
                          onPreviewLink(activeRecord.mutabakat_kodu);
                        } else {
                          openExternalLink(activeUrl);
                        }
                      }}
                      data-testid="mutabakat_preview_link_btn"
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/30 text-indigo-200 font-bold flex items-center justify-center gap-1.5 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Linki Aç</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* PDF & PAYLAŞIM BUTONLARI */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/[0.08] space-y-2.5">
              <div className="font-bold text-white text-xs">A4 PDF ve Karşı Tarafa Gönderim</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={pdfBusy}
                  onClick={handleDownloadPdf}
                  data-testid="mutabakat_download_pdf_btn"
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  <Download className="w-4 h-4 text-teal-400" />
                  <span>PDF İndir</span>
                </button>
                <button
                  type="button"
                  disabled={pdfBusy || creatingLink}
                  onClick={() => void handleSharePdfOrLink('whatsapp')}
                  data-testid="mutabakat_whatsapp_share_btn"
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/35 text-emerald-300 font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>WhatsApp</span>
                </button>
                <button
                  type="button"
                  disabled={pdfBusy || creatingLink}
                  onClick={() => void handleSharePdfOrLink('mail')}
                  data-testid="mutabakat_mail_share_btn"
                  className="min-h-[42px] px-3 py-2 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/35 text-blue-300 font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
                >
                  <Share2 className="w-4 h-4" />
                  <span>E-posta</span>
                </button>
              </div>
            </div>

            {/* SQL KURULUM YARDIMCISI (TABLO EKSİKSE VEYA İSTENİRSE) */}
            {(missingTable || showSql) && (
              <div className="p-3.5 rounded-xl bg-black/40 border border-amber-400/35 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5" />
                    <span>Supabase Mutabakat Tablosu SQL</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(CARI_MUTABAKAT_SQL_SNIPPET, 'sql')}
                    className="px-2.5 py-1 rounded bg-amber-400 text-slate-950 text-[10px] font-extrabold flex items-center gap-1"
                  >
                    {copiedKey === 'sql' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey === 'sql' ? 'Kopyalandı' : 'SQL Kopyala'}</span>
                  </button>
                </div>
                <pre className="p-2.5 rounded-lg bg-[#070b10] border border-white/10 text-[9.5px] font-mono text-teal-300 overflow-x-auto max-h-36">
                  {CARI_MUTABAKAT_SQL_SNIPPET}
                </pre>
              </div>
            )}

            {/* GÖNDERİLEN MUTABAKATLAR VE GELEN CEVAPLAR */}
            <div className="p-4 rounded-xl bg-black/30 border border-white/[0.08] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white">Mutabakat Cevapları ({historyRecords.length})</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSql((v) => !v)}
                    className="text-[10.5px] text-amber-300/80 hover:text-amber-300 font-semibold"
                  >
                    {showSql ? 'SQL Gizle' : 'SQL Kurulum'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadHistory()}
                    disabled={loadingHistory}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                    title="Cevapları Yenile"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {historyRecords.length === 0 ? (
                <p className="text-[11px] text-gray-500">
                  Bu cari için henüz online mutabakat linki oluşturulmadı.
                </p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {historyRecords.map((rec) => (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => setActiveRecord(rec)}
                      className={`w-full text-left p-2.5 rounded-xl border transition space-y-1 ${
                        activeRecord?.id === rec.id
                          ? 'bg-teal-500/10 border-teal-400/40'
                          : 'bg-[#0a0e13] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-teal-300 text-[11px]">
                          {rec.mutabakat_kodu}
                        </span>
                        {renderStatusBadge(rec.durum)}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-gray-300">
                        <span>{formatDate(rec.mutabakat_tarihi)}</span>
                        <span className="font-mono font-bold">
                          {formatCurrency(Math.abs(Number(rec.bakiye)))}
                        </span>
                      </div>
                      {rec.durum !== 'bekliyor' && (
                        <div className="text-[10.5px] text-gray-300 pt-1 border-t border-white/5">
                          <div>
                            Yanıtlayan: <strong className="text-white">{rec.cevaplayan_ad}</strong>
                            {rec.cevap_tarihi ? ` (${formatDate(rec.cevap_tarihi)})` : ''}
                          </div>
                          {rec.durum === 'itiraz' && (
                            <div className="text-red-300 mt-0.5">
                              {rec.itiraz_tutari !== null && rec.itiraz_tutari !== undefined
                                ? `Karşı Bakiye: ${formatCurrency(Number(rec.itiraz_tutari))} — `
                                : ''}
                              {rec.itiraz_notu}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
