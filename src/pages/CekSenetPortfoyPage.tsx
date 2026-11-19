import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Cari, Islem, Kasa, PortfoyDurum } from '../types/database';
import { formatCurrency, formatDate, getTodayIsoLocal } from '../lib/formatters';
import { useQuery } from '../hooks/useQuery';
import { fetchIslemlerList } from '../lib/receiptQueryService';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import { isMissingKasaTableError } from '../lib/kasaSql';
import { pickBestKasaForTur } from '../lib/kasaSyncService';
import {
  computePortfoySummary,
  computePortfoyVadeInfo,
  extractPortfoyMeta,
  isPortfoyEligibleIslem,
  PORTFOY_DURUM_LABELS,
  PORTFOY_SETUP_SQL,
  resolvePortfoyDurumu,
  updatePortfoyDurumu,
} from '../lib/portfoyService';
import { buildVadeHatirlatmaMesaji } from '../lib/whatsappTemplates';
import { WhatsAppReminderModal } from '../components/common/WhatsAppReminderModal';
import {
  FileCheck2,
  Search,
  RefreshCw,
  FileSpreadsheet,
  Printer,
  MessageCircle,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Landmark,
  Repeat,
  XCircle,
  Wallet,
  X,
  Copy,
  Check,
  Database,
} from 'lucide-react';

interface CekSenetPortfoyPageProps {
  onOpenMakbuz: (islem: Islem) => void;
  onNavigate?: (tab: string, state?: unknown) => void;
  refreshKey?: number;
  onUpdated?: () => void;
}

const PORTFOY_STATUS_STYLE: Record<PortfoyDurum, string> = {
  portfoyde: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  tahsilde: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  tahsil_edildi: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ciro_edildi: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  karsiliksiz: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export const CekSenetPortfoyPage: React.FC<CekSenetPortfoyPageProps> = ({
  onOpenMakbuz,
  refreshKey = 0,
  onUpdated,
}) => {
  const { profile, firma } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id || '';
  const isPlasiyer = profile?.rol === 'plasiyer';

  const [durumFilter, setDurumFilter] = useState<'all' | PortfoyDurum>('all');
  const [tipFilter, setTipFilter] = useState<'all' | 'tahsilat' | 'tediye'>('all');
  const [turFilter, setTurFilter] = useState<'all' | 'cek' | 'senet'>('all');
  const [vadeScope, setVadeScope] = useState<'all' | 'overdue' | 'due_soon'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [kasaAvailable, setKasaAvailable] = useState(true);

  const [showSchemaNotice, setShowSchemaNotice] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Durum Değiştir Modalı
  const [editingIslem, setEditingIslem] = useState<Islem | null>(null);
  const [targetDurum, setTargetDurum] = useState<PortfoyDurum>('portfoyde');
  const [targetKasaId, setTargetKasaId] = useState<string>('');
  const [ciroTargetCariId, setCiroTargetCariId] = useState<string>('');
  const [createTediyeForCiro, setCreateTediyeForCiro] = useState<boolean>(false);
  const [reverseCariOnKarsiliksiz, setReverseCariOnKarsiliksiz] = useState<boolean>(true);
  const [statusDate, setStatusDate] = useState<string>(getTodayIsoLocal);
  const [statusNote, setStatusNote] = useState<string>('');
  const [savingStatus, setSavingStatus] = useState<boolean>(false);

  // WhatsApp Hatırlatma Modalı
  const [waModalTarget, setWaModalTarget] = useState<{
    islem: Islem;
    defaultMessage: string;
    badgeText?: string;
  } | null>(null);

  const loadAuxData = useCallback(async () => {
    if (!effectiveFirmaId) return;
    const [{ data: kasaData, error: kasaErr }, { data: cariData }] = await Promise.all([
      supabase
        .from('kasalar')
        .select('*')
        .eq('firma_id', effectiveFirmaId)
        .eq('aktif', true)
        .order('created_at', { ascending: true }),
      supabase
        .from('cariler')
        .select('*')
        .eq('firma_id', effectiveFirmaId)
        .order('unvan', { ascending: true }),
    ]);

    if (kasaErr) {
      if (isMissingKasaTableError(kasaErr)) {
        setKasaAvailable(false);
      }
    } else {
      const list = (kasaData as Kasa[]) || [];
      setKasaAvailable(true);
      setKasalar(list);
      if (list.length > 0 && !targetKasaId) {
        setTargetKasaId(pickBestKasaForTur(list, 'nakit')?.id || list[0].id);
      }
    }

    if (cariData) {
      setCariler(cariData as Cari[]);
    }
  }, [effectiveFirmaId, targetKasaId]);

  useEffect(() => {
    void loadAuxData();
  }, [loadAuxData]);

  const {
    data: allIslemler,
    isLoading: loading,
    isFetching,
    refetch,
  } = useQuery<Islem[]>({
    queryKey: ['cek-senet-portfoy', effectiveFirmaId, profile?.id || null, profile?.rol || null, refreshKey],
    enabled: Boolean(effectiveFirmaId),
    initialData: [],
    queryFn: () =>
      fetchIslemlerList({
        firmaId: effectiveFirmaId,
        userId: profile?.id,
        rol: profile?.rol,
      }),
  });

  const portfoyItems = useMemo(
    () => allIslemler.filter(isPortfoyEligibleIslem),
    [allIslemler]
  );

  const summary = useMemo(() => computePortfoySummary(portfoyItems), [portfoyItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return portfoyItems.filter((item) => {
      const durum = resolvePortfoyDurumu(item);
      if (durumFilter !== 'all' && durum !== durumFilter) return false;
      if (tipFilter !== 'all' && item.tip !== tipFilter) return false;
      if (turFilter !== 'all' && item.tur !== turFilter) return false;

      if (vadeScope !== 'all') {
        const vadeInfo = computePortfoyVadeInfo(item.vade, durum);
        if (vadeScope === 'overdue' && vadeInfo.urgency !== 'overdue') return false;
        if (
          vadeScope === 'due_soon' &&
          vadeInfo.urgency !== 'today' &&
          vadeInfo.urgency !== 'upcoming'
        ) {
          return false;
        }
      }

      if (q) {
        const meta = extractPortfoyMeta(item);
        const haystack = [
          item.cariler?.unvan,
          item.belge_no,
          item.makbuz_no,
          item.banka_adi,
          meta.not,
          meta.ciroHedefAd,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [portfoyItems, durumFilter, tipFilter, turFilter, vadeScope, searchQuery]);

  const openStatusModal = (islem: Islem) => {
    const meta = extractPortfoyMeta(islem);
    setEditingIslem(islem);
    setTargetDurum(meta.durum);
    setStatusNote(meta.not || '');
    setStatusDate(getTodayIsoLocal());
    setCiroTargetCariId(meta.ciroCariId || '');
    setCreateTediyeForCiro(false);
    setReverseCariOnKarsiliksiz(true);
    if (meta.kasaId) {
      setTargetKasaId(meta.kasaId);
    } else if (kasalar.length > 0) {
      setTargetKasaId(pickBestKasaForTur(kasalar, 'nakit')?.id || kasalar[0].id);
    } else {
      setTargetKasaId('__none__');
    }
  };

  const handleSavePortfoyDurum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIslem || !effectiveFirmaId) return;

    if (targetDurum === 'ciro_edildi' && createTediyeForCiro && !ciroTargetCariId) {
      setFeedback({
        type: 'error',
        text: 'Tediye fişi kesebilmek için ciro edilen tedarikçi/cari seçmelisiniz.',
      });
      return;
    }

    setSavingStatus(true);
    setFeedback(null);

    try {
      const targetCari = cariler.find((c) => c.id === ciroTargetCariId);
      const res = await updatePortfoyDurumu({
        islem: editingIslem,
        firmaId: effectiveFirmaId,
        userId: profile?.id,
        newDurum: targetDurum,
        note: statusNote,
        targetKasaId: kasaAvailable ? targetKasaId || '__none__' : '__none__',
        ciroTargetCariId: targetDurum === 'ciro_edildi' ? ciroTargetCariId || null : null,
        ciroTargetCariUnvan: targetDurum === 'ciro_edildi' ? targetCari?.unvan || null : null,
        createTediyeForCiro,
        reverseCariOnKarsiliksiz,
        islemTarihi: statusDate || getTodayIsoLocal(),
      });

      if (!res.success) {
        setFeedback({ type: 'error', text: res.error || 'Durum güncellenemedi.' });
        return;
      }

      if (res.schemaColumnMissing) {
        setShowSchemaNotice(true);
      }

      const extras: string[] = [];
      if (res.kasaSynced) extras.push('kasa bakiyesi güncellendi');
      if (res.tediyeCreated) extras.push('tediye makbuzu kesildi');
      if (res.balanceReversed) extras.push('cari bakiyesi güncellendi');

      setFeedback({
        type: 'success',
        text: `Evrak durumu "${PORTFOY_DURUM_LABELS[targetDurum]}" olarak güncellendi${
          extras.length > 0 ? ` (${extras.join(', ')})` : ''
        }.`,
      });
      setEditingIslem(null);
      await refetch();
      onUpdated?.();
    } finally {
      setSavingStatus(false);
    }
  };

  const handleOpenWhatsAppForIslem = (islem: Islem) => {
    const durum = resolvePortfoyDurumu(islem);
    const vadeInfo = computePortfoyVadeInfo(islem.vade, durum);
    const msg = buildVadeHatirlatmaMesaji({
      firmaUnvan: firma?.unvan,
      cariUnvan: islem.cariler?.unvan,
      evrakTur: islem.tur === 'senet' ? 'senet' : 'cek',
      belgeNo: islem.belge_no,
      tutar: Number(islem.tutar) || 0,
      vadeTarihi: islem.vade,
      diffDays: vadeInfo.diffDays,
      portfoyDurumu: durum,
    });
    setWaModalTarget({
      islem,
      defaultMessage: msg,
      badgeText: vadeInfo.label,
    });
  };

  const handleExportExcel = () => {
    const headers = [
      'Tür',
      'Tip',
      'Cari Unvan',
      'Belge / Evrak No',
      'Banka',
      'Vade Tarihi',
      'Vade Durumu',
      'Portföy Durumu',
      'Tutar (TL)',
      'Not',
    ];
    const rows = filteredItems.map((i) => {
      const durum = resolvePortfoyDurumu(i);
      const vadeInfo = computePortfoyVadeInfo(i.vade, durum);
      const meta = extractPortfoyMeta(i);
      return [
        i.tur === 'cek' ? 'Çek' : 'Senet',
        i.tip === 'tahsilat' ? 'Müşteri Evrakı (Tahsilat)' : 'Verilen Evrak (Tediye)',
        i.cariler?.unvan || '-',
        i.belge_no || '-',
        i.banka_adi || '-',
        formatDate(i.vade),
        vadeInfo.label,
        PORTFOY_DURUM_LABELS[durum],
        Number(i.tutar) || 0,
        meta.ciroHedefAd ? `Ciro: ${meta.ciroHedefAd}${meta.not ? ' - ' + meta.not : ''}` : meta.not || '-',
      ];
    });
    exportToExcel(`cek_senet_portfoyu_${getTodayIsoLocal()}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Evrak', 'Cari', 'Belge No', 'Vade', 'Portföy Durumu', 'Tutar'];
    const rows = filteredItems.map((i) => {
      const durum = resolvePortfoyDurumu(i);
      return [
        `${i.tur === 'cek' ? 'Çek' : 'Senet'} (${i.tip === 'tahsilat' ? 'Alınan' : 'Verilen'})`,
        i.cariler?.unvan || '-',
        i.belge_no || '-',
        formatDate(i.vade),
        PORTFOY_DURUM_LABELS[durum],
        formatCurrency(Number(i.tutar) || 0),
      ];
    });
    printPdfReport(
      'ÇEK VE SENET PORTFÖY RAPORU',
      `${firma?.unvan || 'Firma'} · Toplam ${filteredItems.length} Evrak`,
      headers,
      rows,
      [
        { label: 'Portföyde', value: `${summary.portfoydeCount} (${formatCurrency(summary.portfoydeTotal)})` },
        { label: 'Tahsilde', value: `${summary.tahsildeCount} (${formatCurrency(summary.tahsildeTotal)})` },
        { label: 'Tahsil Edildi', value: `${summary.tahsilEdildiCount} (${formatCurrency(summary.tahsilEdildiTotal)})` },
        { label: 'Vadesi Geçmiş', value: `${summary.overdueCount} (${formatCurrency(summary.overdueTotal)})` },
      ],
      firma?.logo_data || null
    );
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(PORTFOY_SETUP_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6" data-testid="cek_senet_portfoy_page">
      {/* BAŞLIK VE ÜST AKSİYONLAR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/25 text-teal-300 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Evrak &amp; Vade Yönetimi</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Çek &amp; Senet Portföyü
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Portföyde bekleyen, bankada tahsilde olan, ciro edilen ve karşılıksız çıkan tüm evrakların yaşam döngüsünü yönetin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            data-testid="portfoy_refresh_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-teal-400' : ''}`} />
            <span>Yenile</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            data-testid="portfoy_export_excel_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            data-testid="portfoy_export_pdf_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <Printer className="w-4 h-4" />
            <span>PDF Rapor</span>
          </button>
        </div>
      </div>

      {/* OPSİYONEL SQL KURULUM BİLGİSİ */}
      {showSchemaNotice && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 text-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Database className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-200">
                  Evrak durumu kaydedildi (Etiket uyumluluk modu aktif)
                </div>
                <p className="text-[11px] text-amber-200/80 mt-0.5">
                  Veritabanınızda portföy sütunları henüz yoksa bile durumunuz güvenli şekilde saklandı. Sütunları kalıcı olarak açmak için aşağıdaki SQL&apos;i Supabase SQL Editor&apos;da bir kez çalıştırabilirsiniz.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSchemaNotice(false)}
              className="text-amber-300 hover:text-white p-1"
              aria-label="Uyarıyı kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className="p-2.5 rounded-xl bg-black/50 border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto">
            {PORTFOY_SETUP_SQL}
          </pre>
          <button
            type="button"
            onClick={handleCopySql}
            className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-[11px] inline-flex items-center gap-1.5"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'SQL Kopyalandı' : 'SQL Kodunu Kopyala'}</span>
          </button>
        </div>
      )}

      {/* GERİ BİLDİRİM BANNERI */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="font-semibold">{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 KPI KARTI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111820] border border-teal-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-300">
              Portföyde Bekleyen
            </span>
            <FileCheck2 className="w-5 h-5 text-teal-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums">
            {loading ? '...' : formatCurrency(summary.portfoydeTotal)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summary.portfoydeCount} adet evrak kasada/elde
          </div>
        </div>

        <div className="bg-[#111820] border border-blue-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-300">
              Bankada / Tahsilde
            </span>
            <Landmark className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums">
            {loading ? '...' : formatCurrency(summary.tahsildeTotal)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summary.tahsildeCount} adet · Tahsil Edilen: {summary.tahsilEdildiCount}
          </div>
        </div>

        <div className="bg-[#111820] border border-amber-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
              Vadesi Geçmiş (Açık)
            </span>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-300 font-mono tabular-nums">
            {loading ? '...' : formatCurrency(summary.overdueTotal)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summary.overdueCount} adet gecikmiş · {summary.dueSoonCount} yaklaşan (7 gün)
          </div>
        </div>

        <div className="bg-[#111820] border border-rose-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-300">
              Karşılıksız / İade
            </span>
            <XCircle className="w-5 h-5 text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-300 font-mono tabular-nums">
            {loading ? '...' : formatCurrency(summary.karsiliksizTotal)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {summary.karsiliksizCount} karşılıksız · {summary.ciroEdildiCount} ciro edildi
          </div>
        </div>
      </div>

      {/* FİLTRE ÇUBUĞU */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-xl">
        {/* Durum Hapları */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: `Tümü (${summary.totalCount})` },
            { id: 'portfoyde', label: `Portföyde (${summary.portfoydeCount})` },
            { id: 'tahsilde', label: `Tahsilde (${summary.tahsildeCount})` },
            { id: 'tahsil_edildi', label: `Tahsil Edildi (${summary.tahsilEdildiCount})` },
            { id: 'ciro_edildi', label: `Ciro Edildi (${summary.ciroEdildiCount})` },
            { id: 'karsiliksiz', label: `Karşılıksız (${summary.karsiliksizCount})` },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setDurumFilter(pill.id as 'all' | PortfoyDurum)}
              data-testid={`portfoy_filter_${pill.id}`}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                durumFilter === pill.id
                  ? 'bg-teal-400 text-[#0a0e13]'
                  : 'bg-black/35 text-slate-300 hover:text-white border border-white/10'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Arama ve İkincil Filtreler */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari, evrak no, banka ara..."
              className="w-full min-h-[40px] bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-400"
            />
          </div>

          <select
            value={turFilter}
            onChange={(e) => setTurFilter(e.target.value as 'all' | 'cek' | 'senet')}
            className="min-h-[40px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
          >
            <option value="all">Tüm Evrak Türleri (Çek + Senet)</option>
            <option value="cek">Sadece Çekler</option>
            <option value="senet">Sadece Senetler</option>
          </select>

          <select
            value={tipFilter}
            onChange={(e) => setTipFilter(e.target.value as 'all' | 'tahsilat' | 'tediye')}
            className="min-h-[40px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
          >
            <option value="all">Alınan &amp; Verilen Tümü</option>
            <option value="tahsilat">Müşteriden Alınan (Tahsilat)</option>
            <option value="tediye">Tedarikçiye Verilen (Tediye)</option>
          </select>

          <select
            value={vadeScope}
            onChange={(e) => setVadeScope(e.target.value as 'all' | 'overdue' | 'due_soon')}
            className="min-h-[40px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
          >
            <option value="all">Tüm Vadeler</option>
            <option value="overdue">Sadece Vadesi Geçmiş</option>
            <option value="due_soon">Bugün / 7 Gün İçinde Vadesi</option>
          </select>
        </div>
      </div>

      {/* EVRAK LİSTESİ */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Çek ve senet portföyü yükleniyor...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <FileCheck2 className="w-10 h-10 text-slate-600 mx-auto" />
            <div className="text-xs font-bold text-slate-300">
              Seçili kriterlere uygun çek veya senet kaydı bulunmuyor.
            </div>
            <p className="text-[11px] text-slate-500">
              Tahsilat veya Tediye makbuzundan Çek/Senet girdiğinizde otomatik olarak burada listelenir.
            </p>
          </div>
        ) : (
          <>
            {/* MASAÜSTÜ TABLO */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/25 text-slate-400 text-[11px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-4">Evrak / Belge No</th>
                    <th className="py-3 px-4">Cari Hesap</th>
                    <th className="py-3 px-4">Banka</th>
                    <th className="py-3 px-4">Vade &amp; Aciliyet</th>
                    <th className="py-3 px-4">Portföy Durumu</th>
                    <th className="py-3 px-4 text-right">Tutar</th>
                    <th className="py-3 px-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredItems.map((item) => {
                    const durum = resolvePortfoyDurumu(item);
                    const meta = extractPortfoyMeta(item);
                    const vadeInfo = computePortfoyVadeInfo(item.vade, durum);

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-white/[0.03] transition"
                        data-testid={`portfoy_row_${item.id}`}
                      >
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                item.tur === 'cek'
                                  ? 'bg-teal-500/15 text-teal-300'
                                  : 'bg-purple-500/15 text-purple-300'
                              }`}
                            >
                              {item.tur === 'cek' ? 'ÇEK' : 'SENET'}
                            </span>
                            <span className="font-mono font-bold text-white">
                              {item.belge_no || item.makbuz_no || `#${item.id.slice(0, 6)}`}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {item.tip === 'tahsilat' ? 'Alınan Evrak' : 'Verilen Evrak'} ·{' '}
                            {formatDate(item.tarih)}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white max-w-[200px] truncate">
                            {item.cariler?.unvan || 'Cari Belirtilmemiş'}
                          </div>
                          {meta.ciroHedefAd && (
                            <div className="text-[10px] text-sky-300 mt-0.5">
                              Ciro Hedefi: {meta.ciroHedefAd}
                            </div>
                          )}
                          {meta.not && (
                            <div className="text-[10px] text-slate-400 mt-0.5 max-w-[220px] truncate">
                              Not: {meta.not}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-slate-300">{item.banka_adi || '-'}</td>

                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-white">{formatDate(item.vade)}</div>
                          <span
                            className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] border ${vadeInfo.badgeClass}`}
                          >
                            {vadeInfo.label}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${PORTFOY_STATUS_STYLE[durum]}`}
                          >
                            {PORTFOY_DURUM_LABELS[durum]}
                          </span>
                        </td>

                        <td
                          className={`py-3.5 px-4 text-right font-mono font-black text-sm whitespace-nowrap ${
                            durum === 'karsiliksiz'
                              ? 'text-rose-400 line-through'
                              : item.tip === 'tahsilat'
                              ? 'text-teal-300'
                              : 'text-orange-300'
                          }`}
                        >
                          {formatCurrency(Number(item.tutar) || 0)}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {!isPlasiyer && (
                              <button
                                type="button"
                                onClick={() => openStatusModal(item)}
                                data-testid={`portfoy_status_btn_${item.id}`}
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition"
                              >
                                <Repeat className="w-3 h-3" />
                                <span>Durum</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenWhatsAppForIslem(item)}
                              data-testid={`portfoy_wa_btn_${item.id}`}
                              title="WhatsApp Vade Hatırlatma"
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold inline-flex items-center gap-1 transition"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>Hatırlat</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onOpenMakbuz(item)}
                              title="Makbuzu Aç"
                              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-[11px] font-bold inline-flex items-center gap-1 transition"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBİL KART GÖRÜNÜMÜ */}
            <div className="md:hidden divide-y divide-white/[0.05]">
              {filteredItems.map((item) => {
                const durum = resolvePortfoyDurumu(item);
                const meta = extractPortfoyMeta(item);
                const vadeInfo = computePortfoyVadeInfo(item.vade, durum);

                return (
                  <div key={item.id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.tur === 'cek'
                                ? 'bg-teal-500/15 text-teal-300'
                                : 'bg-purple-500/15 text-purple-300'
                            }`}
                          >
                            {item.tur === 'cek' ? 'Çek' : 'Senet'}
                          </span>
                          <span className="font-mono text-xs font-bold text-white">
                            {item.belge_no || item.makbuz_no || '-'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${PORTFOY_STATUS_STYLE[durum]}`}
                          >
                            {PORTFOY_DURUM_LABELS[durum]}
                          </span>
                        </div>
                        <div className="font-bold text-sm text-white mt-1 truncate">
                          {item.cariler?.unvan || 'Cari Belirtilmemiş'}
                        </div>
                      </div>
                      <div
                        className={`font-mono font-black text-sm whitespace-nowrap ${
                          durum === 'karsiliksiz' ? 'text-rose-400 line-through' : 'text-teal-300'
                        }`}
                      >
                        {formatCurrency(Number(item.tutar) || 0)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2">
                      <span>
                        Vade: <strong className="text-white">{formatDate(item.vade)}</strong>{' '}
                        {item.banka_adi ? `· ${item.banka_adi}` : ''}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] border ${vadeInfo.badgeClass}`}
                      >
                        {vadeInfo.label}
                      </span>
                    </div>

                    {meta.not && (
                      <div className="text-[11px] text-slate-400 bg-black/25 px-2.5 py-1.5 rounded-lg">
                        Not: {meta.not}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {!isPlasiyer ? (
                        <button
                          type="button"
                          onClick={() => openStatusModal(item)}
                          className="min-h-[44px] px-2.5 py-2 rounded-xl bg-teal-500/15 text-teal-300 border border-teal-500/30 text-xs font-bold inline-flex items-center justify-center gap-1"
                        >
                          <Repeat className="w-3.5 h-3.5" />
                          <span>Durum</span>
                        </button>
                      ) : (
                        <div />
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenWhatsAppForIslem(item)}
                        className="min-h-[44px] px-2.5 py-2 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-bold inline-flex items-center justify-center gap-1"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Hatırlat</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenMakbuz(item)}
                        className="min-h-[44px] px-2.5 py-2 rounded-xl bg-white/5 text-slate-200 border border-white/10 text-xs font-bold inline-flex items-center justify-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Makbuz</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* PORTFÖY DURUM DEĞİŞTİRME MODALI */}
      {editingIslem && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="portfoy_status_modal"
        >
          <div className="bg-[#111820] border border-white/15 rounded-2xl w-full max-w-lg max-h-[90dvh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/[0.07] flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-teal-400">
                  Evrak Portföy Güncellemesi
                </div>
                <h3 className="text-base font-extrabold text-white">
                  {editingIslem.cariler?.unvan || 'Cari'} ·{' '}
                  {formatCurrency(Number(editingIslem.tutar) || 0)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingIslem(null)}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePortfoyDurum} className="p-4 sm:p-5 space-y-4 overflow-y-auto text-xs">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-2">
                  Yeni Portföy Durumu
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(PORTFOY_DURUM_LABELS) as PortfoyDurum[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTargetDurum(key)}
                      data-testid={`portfoy_target_${key}`}
                      className={`min-h-[44px] px-3 py-2 rounded-xl border text-left font-bold transition flex items-center justify-between ${
                        targetDurum === key
                          ? 'bg-teal-400 text-[#0a0e13] border-teal-400'
                          : 'bg-[#0a0e13] text-slate-300 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <span>{PORTFOY_DURUM_LABELS[key]}</span>
                      {targetDurum === key && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {targetDurum === 'tahsil_edildi' && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-2">
                  <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <Wallet className="w-4 h-4" />
                    <span>Tahsil Edilecek Kasa / Banka Hesabı</span>
                  </div>
                  <select
                    value={targetKasaId}
                    onChange={(e) => setTargetKasaId(e.target.value)}
                    className="w-full min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400"
                  >
                    {kasalar.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.ad} ({formatCurrency(Number(k.guncel_bakiye))})
                      </option>
                    ))}
                    <option value="__none__">Kasaya otomatik gelir/gider satırı işleme</option>
                  </select>
                </div>
              )}

              {targetDurum === 'ciro_edildi' && (
                <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/25 space-y-2.5">
                  <div className="font-bold text-sky-300">Ciro Edilen Cari / Tedarikçi</div>
                  <select
                    value={ciroTargetCariId}
                    onChange={(e) => setCiroTargetCariId(e.target.value)}
                    className="w-full min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-400"
                  >
                    <option value="">-- Tedarikçi / Cari Seçiniz (Opsiyonel) --</option>
                    {cariler
                      .filter((c) => c.id !== editingIslem.cari_id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          [{c.tur === 'tedarikci' ? 'TEDARİKÇİ' : 'ALICI'}] {c.unvan}
                        </option>
                      ))}
                  </select>

                  {editingIslem.tip === 'tahsilat' && (
                    <label className="flex items-start gap-2 text-[11px] text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createTediyeForCiro}
                        onChange={(e) => setCreateTediyeForCiro(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-sky-400"
                      />
                      <span>Seçilen cariye aynı tutarda tediye makbuzu da kes</span>
                    </label>
                  )}
                </div>
              )}

              {targetDurum === 'karsiliksiz' && editingIslem.tip === 'tahsilat' && !editingIslem.iptal && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
                  <label className="flex items-start gap-2 text-[11px] text-rose-200 cursor-pointer font-semibold">
                    <input
                      type="checkbox"
                      checked={reverseCariOnKarsiliksiz}
                      onChange={(e) => setReverseCariOnKarsiliksiz(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-rose-500"
                    />
                    <span>
                      Makbuzu iptal et ve carinin borç bakiyesini geri yükle (Karşılıksız evrak tutarı cari borcuna geri eklenir)
                    </span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    İşlem Tarihi
                  </label>
                  <input
                    type="date"
                    value={statusDate}
                    onChange={(e) => setStatusDate(e.target.value)}
                    className="w-full min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Açıklama / Banka Notu
                  </label>
                  <input
                    type="text"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="Örn: Garanti takasa verildi"
                    className="w-full min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingIslem(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 font-semibold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingStatus}
                  data-testid="portfoy_save_status_btn"
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-[#0a0e13] font-extrabold"
                >
                  {savingStatus ? 'Kaydediliyor...' : 'Durumu Güncelle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WHATSAPP VADE HATIRLATMA MODALI */}
      <WhatsAppReminderModal
        isOpen={Boolean(waModalTarget)}
        onClose={() => setWaModalTarget(null)}
        title={`Vade Hatırlatma: ${waModalTarget?.islem.cariler?.unvan || 'Cari'}`}
        subtitle={`${waModalTarget?.islem.tur === 'cek' ? 'Çek' : 'Senet'} ${
          waModalTarget?.islem.belge_no || ''
        } · ${formatCurrency(Number(waModalTarget?.islem.tutar) || 0)}`}
        initialPhone={waModalTarget?.islem.cariler?.telefon}
        defaultMessage={waModalTarget?.defaultMessage || ''}
        badgeText={waModalTarget?.badgeText}
      />
    </div>
  );
};
