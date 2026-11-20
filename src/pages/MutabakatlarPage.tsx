import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Crown,
  ExternalLink,
  FileCheck2,
  Layers,
  Lock,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Cari, Fatura, Islem } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import { RawEkstreMovement } from '../lib/cariEkstreHelper';
import { getPosConfig, PosConfig } from '../lib/posService';
import { fetchCloudPosConfig } from '../lib/posGatewayService';
import { openWhatsApp } from '../lib/linkHelper';
import {
  buildMutabakatPublicUrl,
  buildMutabakatWhatsAppMessage,
  CARI_MUTABAKAT_SQL_SNIPPET,
  CariMutabakatRecord,
  computeItirazDiscrepancy,
  computeMutabakatStats,
  describeMutabakatBalance,
  fetchAllMutabakatlarForFirma,
  filterMutabakatRecords,
  MutabakatStatusFilter,
} from '../lib/mutabakatService';
import { MutabakatMektubuModal } from '../components/cari/MutabakatMektubuModal';

interface MutabakatlarPageProps {
  onNavigate: (tab: string, state?: unknown) => void;
  onPreviewMutabakatLink?: (code: string) => void;
  refreshKey?: number;
}

export const MutabakatlarPage: React.FC<MutabakatlarPageProps> = ({
  onNavigate,
  onPreviewMutabakatLink,
  refreshKey = 0,
}) => {
  const { firma, profile, entitlements } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id || '';

  const [records, setRecords] = useState<CariMutabakatRecord[]>([]);
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingTable, setMissingTable] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [posConfig, setPosConfig] = useState<PosConfig>(() => getPosConfig(effectiveFirmaId));

  const [statusFilter, setStatusFilter] = useState<MutabakatStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Yeni mutabakat cari seçimi & modalı
  const [isCariPickerOpen, setIsCariPickerOpen] = useState(false);
  const [cariPickerSearch, setCariPickerSearch] = useState('');
  const [loadingModalCari, setLoadingModalCari] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalCari, setModalCari] = useState<Cari | null>(null);
  const [modalMovements, setModalMovements] = useState<RawEkstreMovement[]>([]);
  const [modalInitialRecord, setModalInitialRecord] = useState<CariMutabakatRecord | null>(null);

  const loadData = useCallback(async () => {
    if (!effectiveFirmaId || !entitlements.canUseMutabakat) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);
    try {
      const [mutRes, carilerRes, cloudPos] = await Promise.all([
        fetchAllMutabakatlarForFirma(effectiveFirmaId),
        supabase
          .from('cariler')
          .select('*')
          .eq('firma_id', effectiveFirmaId)
          .order('unvan', { ascending: true }),
        fetchCloudPosConfig(effectiveFirmaId),
      ]);

      setPosConfig(cloudPos);
      setRecords(mutRes.records);
      if (mutRes.missingTable) {
        setMissingTable(true);
        setShowSql(true);
      } else {
        setMissingTable(false);
      }
      if (mutRes.error) {
        setErrorText(mutRes.error);
      }
      if (carilerRes.data) {
        setCariler(carilerRes.data as Cari[]);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveFirmaId, entitlements.canUseMutabakat]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshKey]);

  const stats = useMemo(() => computeMutabakatStats(records), [records]);

  const filteredRecords = useMemo(
    () => filterMutabakatRecords(records, statusFilter, searchQuery),
    [records, statusFilter, searchQuery]
  );

  const filteredCarilerForPicker = useMemo(() => {
    const q = cariPickerSearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) return cariler;
    return cariler.filter((c) => {
      const hay = `${c.unvan} ${c.vergi_tc_no || ''} ${c.telefon || ''}`.toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
  }, [cariler, cariPickerSearch]);

  const cariByIdMap = useMemo(() => {
    const map = new Map<string, Cari>();
    for (const c of cariler) map.set(c.id, c);
    return map;
  }, [cariler]);

  const openModalForCari = async (
    targetCari: Cari,
    existingRecord: CariMutabakatRecord | null = null
  ) => {
    if (!effectiveFirmaId) return;
    setLoadingModalCari(true);
    setIsCariPickerOpen(false);
    try {
      const [{ data: fatData }, { data: islData }] = await Promise.all([
        supabase
          .from('faturalar')
          .select('*')
          .eq('firma_id', effectiveFirmaId)
          .eq('cari_id', targetCari.id),
        supabase
          .from('islemler')
          .select('*, profiles(ad_soyad)')
          .eq('firma_id', effectiveFirmaId)
          .eq('cari_id', targetCari.id),
      ]);

      const combined: RawEkstreMovement[] = [
        ...((fatData as Fatura[]) || []),
        ...((islData as Islem[]) || []),
      ];

      setModalCari(targetCari);
      setModalMovements(combined);
      setModalInitialRecord(existingRecord);
      setModalOpen(true);
    } finally {
      setLoadingModalCari(false);
    }
  };

  const handleOpenRowDetail = async (rec: CariMutabakatRecord) => {
    const existingCari = cariByIdMap.get(rec.cari_id);
    if (existingCari) {
      await openModalForCari(existingCari, rec);
      return;
    }

    const { data: singleCari } = await supabase
      .from('cariler')
      .select('*')
      .eq('id', rec.cari_id)
      .maybeSingle();

    const fallbackCari: Cari = (singleCari as Cari | null) || {
      id: rec.cari_id,
      firma_id: rec.firma_id,
      unvan: rec.cari_unvan,
      vergi_tc_no: rec.cari_vergi_no || null,
      tur: Number(rec.bakiye) >= 0 ? 'alici' : 'tedarikci',
      bakiye: Number(rec.bakiye) || 0,
    };

    await openModalForCari(fallbackCari, rec);
  };

  const handleCopyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      // ignore
    }
  };

  const handleResendWhatsApp = (rec: CariMutabakatRecord) => {
    const url = buildMutabakatPublicUrl(rec.mutabakat_kodu, posConfig);
    const cariObj = cariByIdMap.get(rec.cari_id);
    const msg = buildMutabakatWhatsAppMessage({
      firmaUnvan: rec.firma_unvan || firma?.unvan,
      cariUnvan: rec.cari_unvan,
      mutabakatTarihi: rec.mutabakat_tarihi,
      bakiye: Number(rec.bakiye),
      mutabakatUrl: url,
      mutabakatKodu: rec.mutabakat_kodu,
      donemBaslik: rec.donem_baslik,
    });
    openWhatsApp(cariObj?.telefon || '', msg);
  };

  // KURUMSAL PAKET KİLİDİ
  if (!entitlements.canUseMutabakat) {
    return (
      <div
        className="max-w-3xl mx-auto py-8 animate-fade-in"
        data-testid="mutabakat_kurumsal_lock_screen"
      >
        <div className="bg-[#111820] border border-amber-400/35 rounded-3xl p-6 sm:p-10 text-center shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-amber-400/15 border border-amber-400/35 text-amber-300 flex items-center justify-center mx-auto shadow-[0_0_25px_rgba(251,191,36,0.18)]">
            <Lock className="w-8 h-8" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-300 text-[11px] font-extrabold uppercase tracking-wider">
            <Crown className="w-3.5 h-3.5" />
            <span>Kurumsal (Pro) Paket Özelliği</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Cari Hesap Mutabakat Merkezi
          </h1>
          <p className="text-sm text-gray-300 max-w-xl mx-auto leading-relaxed">
            Resmi <strong>A4 PDF Mutabakat Mektubu</strong> oluşturma, müşterilere giriş gerektirmeyen{' '}
            <strong>Online Mutabakat Linki</strong> gönderme ve olumsuz/itiraz cevaplarını tek tıkla filtreleyip takip etme özelliği{' '}
            <strong className="text-amber-300">Kurumsal (Pro)</strong> pakete dahildir.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left text-xs pt-2">
            <div className="p-3.5 rounded-2xl bg-black/30 border border-white/[0.07]">
              <div className="font-bold text-white mb-1 flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-teal-400" />
                <span>A4 PDF Mektup</span>
              </div>
              <p className="text-gray-400 text-[11px]">
                Dönem bakiyesi ve son hareket özetiyle kurumsal PDF mutabakat formu.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-black/30 border border-white/[0.07]">
              <div className="font-bold text-white mb-1 flex items-center gap-1.5">
                <ExternalLink className="w-4 h-4 text-purple-400" />
                <span>Tek Tık Online Cevap</span>
              </div>
              <p className="text-gray-400 text-[11px]">
                Karşı taraf şifre girmeden &quot;Mutabıkım&quot; veya &quot;İtiraz&quot; yanıtı verir.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-black/30 border border-white/[0.07]">
              <div className="font-bold text-white mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span>Olumsuzlar Tek Tıkta</span>
              </div>
              <p className="text-gray-400 text-[11px]">
                Fark tutarı ve itiraz notu bildiren carileri anında süzün ve çözün.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => onNavigate('paketler')}
              data-testid="mutabakat_upgrade_btn"
              className="min-h-[48px] px-6 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm inline-flex items-center gap-2 shadow-lg transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Kurumsal Pakete Yükselt</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in" data-testid="mutabakatlar_page">
      {/* ÜST BAŞLIK VE ANA AKSİYONLAR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/30 text-purple-200 text-[10px] font-extrabold uppercase tracking-wider mb-1.5">
            <Crown className="w-3 h-3 text-amber-300" />
            <span>Kurumsal Mutabakat Merkezi</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <FileCheck2 className="w-7 h-7 text-teal-400 shrink-0" />
            <span>Cari Hesap Mutabakatları</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Gönderilen tüm mutabakatları topluca izleyin, olumsuz (itiraz) yanıtları tek tıkla filtreleyin ve yeni PDF/link oluşturun.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            data-testid="mutabakat_refresh_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#111820] hover:bg-white/[0.06] border border-white/10 text-gray-200 text-xs font-bold flex items-center gap-2 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-teal-400 ${loading ? 'animate-spin' : ''}`} />
            <span>Yenile</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSql((v) => !v)}
            data-testid="mutabakat_toggle_sql_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#111820] hover:bg-white/[0.06] border border-amber-400/30 text-amber-300 text-xs font-bold flex items-center gap-2 transition"
          >
            <Code2 className="w-4 h-4" />
            <span>{showSql ? 'SQL Gizle' : 'SQL Kurulum'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCariPickerSearch('');
              setIsCariPickerOpen(true);
            }}
            disabled={loadingModalCari}
            data-testid="mutabakat_create_new_btn"
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] text-xs font-extrabold flex items-center gap-2 shadow-[0_0_20px_rgba(45,212,191,0.3)] transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{loadingModalCari ? 'Yükleniyor...' : 'Yeni Mutabakat Oluştur'}</span>
          </button>
        </div>
      </div>

      {/* 4 TIKLANABİLİR ÖZET & TEK TIK FİLTRE KARTLARI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. TEK TIKLA OLUMSUZ / İTİRAZLAR */}
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === 'itiraz' ? 'all' : 'itiraz'))}
          data-testid="mutabakat_filter_itiraz"
          className={`text-left p-4 rounded-2xl border transition relative overflow-hidden ${
            statusFilter === 'itiraz'
              ? 'bg-red-500/20 border-red-400 shadow-[0_0_25px_rgba(239,68,68,0.22)] ring-2 ring-red-400/40'
              : 'bg-[#111820] border-red-500/30 hover:border-red-400/60 hover:bg-red-500/[0.08]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-red-300">
              Olumsuz / İtiraz
            </span>
            <span className="w-8 h-8 rounded-xl bg-red-500/20 border border-red-400/30 text-red-300 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white">
            {stats.itirazCount}
          </div>
          <div className="text-[11px] text-red-200/80 mt-1 flex items-center justify-between gap-1">
            <span>
              {statusFilter === 'itiraz' ? 'Filtre aktif (Tümü için tıkla)' : 'Tek tıkla olumsuzları gör'}
            </span>
          </div>
          {stats.totalItirazDiscrepancy > 0 && (
            <div className="mt-1.5 text-[10.5px] font-mono font-bold text-red-300 bg-black/30 px-2 py-0.5 rounded inline-block">
              Toplam Fark: {formatCurrency(stats.totalItirazDiscrepancy)}
            </div>
          )}
        </button>

        {/* 2. MUTABIK (ONAYLANDI) */}
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === 'mutabik' ? 'all' : 'mutabik'))}
          data-testid="mutabakat_filter_mutabik"
          className={`text-left p-4 rounded-2xl border transition ${
            statusFilter === 'mutabik'
              ? 'bg-emerald-500/20 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.2)] ring-2 ring-emerald-400/35'
              : 'bg-[#111820] border-white/[0.08] hover:border-emerald-400/40'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300">
              Mutabık (Onaylı)
            </span>
            <span className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white">
            {stats.mutabikCount}
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Karşı tarafça onaylananlar</div>
        </button>

        {/* 3. CEVAP BEKLEYENLER */}
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === 'bekliyor' ? 'all' : 'bekliyor'))}
          data-testid="mutabakat_filter_bekliyor"
          className={`text-left p-4 rounded-2xl border transition ${
            statusFilter === 'bekliyor'
              ? 'bg-amber-500/20 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)] ring-2 ring-amber-400/35'
              : 'bg-[#111820] border-white/[0.08] hover:border-amber-400/40'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
              Cevap Bekliyor
            </span>
            <span className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-400/30 text-amber-300 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white">
            {stats.bekliyorCount}
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Henüz yanıtlanmamış linkler</div>
        </button>

        {/* 4. TÜM MUTABAKATLAR */}
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          data-testid="mutabakat_filter_all"
          className={`text-left p-4 rounded-2xl border transition ${
            statusFilter === 'all'
              ? 'bg-teal-500/15 border-teal-400 shadow-[0_0_20px_rgba(45,212,191,0.18)] ring-2 ring-teal-400/30'
              : 'bg-[#111820] border-white/[0.08] hover:border-teal-400/40'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-teal-300">
              Toplam Gönderim
            </span>
            <span className="w-8 h-8 rounded-xl bg-teal-500/15 border border-teal-400/30 text-teal-300 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-white">
            {stats.total}
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Tüm mutabakat kayıtları</div>
        </button>
      </div>

      {/* ARAMA + TEK TIKLA OLUMSUZLARI GÖSTER ÇUBUĞU */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-3.5 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="mutabakat_search_input"
            placeholder="Cari ünvanı, mutabakat kodu (MTB-...), cevaplayan veya itiraz notu ile ara..."
            className="w-full min-h-[42px] bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter((prev) => (prev === 'itiraz' ? 'all' : 'itiraz'))}
            data-testid="mutabakat_quick_negative_btn"
            className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 border transition ${
              statusFilter === 'itiraz'
                ? 'bg-red-500 text-white border-red-400 shadow-lg'
                : 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border-red-500/40'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>
              {statusFilter === 'itiraz'
                ? `Olumsuzlar Gösteriliyor (${stats.itirazCount}) — Tümünü Aç`
                : `Tek Tıkla Olumsuzları Gör (${stats.itirazCount})`}
            </span>
          </button>

          {statusFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className="min-h-[42px] px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition"
            >
              Filtreyi Temizle
            </button>
          )}
        </div>
      </div>

      {/* SQL KURULUM YARDIMCISI */}
      {(missingTable || showSql) && (
        <div className="p-4 rounded-2xl bg-[#111820] border border-amber-400/35 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                <Code2 className="w-4 h-4" />
                <span>Supabase Online Mutabakat Tablosu SQL Kurulumu</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {missingTable
                  ? 'cari_mutabakatlar tablosu henüz oluşturulmamış. Aşağıdaki SQL kodunu Supabase SQL Editor üzerinde bir kez çalıştırın.'
                  : 'İhtiyaç halinde tabloyu ve RLS kurallarını yeniden doğrulamak için SQL kodunu kopyalayabilirsiniz.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyText(CARI_MUTABAKAT_SQL_SNIPPET, 'sql-main')}
              className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
            >
              {copiedId === 'sql-main' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId === 'sql-main' ? 'Kopyalandı' : 'SQL Kopyala'}</span>
            </button>
          </div>
          <pre className="p-3 rounded-xl bg-[#070b10] border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto max-h-44">
            {CARI_MUTABAKAT_SQL_SNIPPET}
          </pre>
        </div>
      )}

      {errorText && !missingTable && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorText}</span>
        </div>
      )}

      {/* TOPLU CEVAPLAR LİSTESİ */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center text-gray-400 gap-3">
            <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Mutabakat yanıtları yükleniyor...</span>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-14 px-6 text-center space-y-3" data-testid="mutabakat_empty_state">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.05] text-gray-400 flex items-center justify-center mx-auto">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-extrabold text-white">
              {statusFilter === 'itiraz'
                ? 'Olumsuz / itiraz bildirilen mutabakat kaydı yok'
                : records.length === 0
                ? 'Henüz mutabakat kaydı oluşturulmadı'
                : 'Aramanıza veya seçili filtreye uygun kayıt bulunamadı'}
            </h3>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              {statusFilter === 'itiraz'
                ? 'Tüm yanıtlar mutabık veya beklemede görünüyor. Tüm kayıtları görmek için filtreyi temizleyebilirsiniz.'
                : 'Yeni Mutabakat Oluştur butonuna basıp cari seçerek A4 PDF ve online cevap linki oluşturabilirsiniz.'}
            </p>
            {statusFilter !== 'all' ? (
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold"
              >
                Tüm Mutabakatları Göster
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsCariPickerOpen(true)}
                className="px-4 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] text-xs font-extrabold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>İlk Mutabakatı Oluştur</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* MASAÜSTÜ TABLO */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-black/25 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    <th className="py-3.5 px-4">Cari / Mutabakat No</th>
                    <th className="py-3.5 px-4">Tarih &amp; Dönem</th>
                    <th className="py-3.5 px-4 text-right">Bizim Bakiyemiz</th>
                    <th className="py-3.5 px-4">Durum</th>
                    <th className="py-3.5 px-4">Karşı Taraf Yanıtı &amp; İtiraz Detayı</th>
                    <th className="py-3.5 px-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] text-xs">
                  {filteredRecords.map((rec) => {
                    const balInfo = describeMutabakatBalance(Number(rec.bakiye));
                    const discrepancy = computeItirazDiscrepancy(rec);
                    const publicUrl = buildMutabakatPublicUrl(rec.mutabakat_kodu, posConfig);
                    const isDisputed = rec.durum === 'itiraz';

                    return (
                      <tr
                        key={rec.id}
                        data-testid={`mutabakat_row_${rec.mutabakat_kodu}`}
                        className={`transition ${
                          isDisputed
                            ? 'bg-red-500/[0.06] hover:bg-red-500/[0.1]'
                            : 'hover:bg-white/[0.025]'
                        }`}
                      >
                        <td className="py-3.5 px-4 align-top">
                          <div className="font-bold text-white text-[13px]">{rec.cari_unvan}</div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="font-mono text-[11px] font-bold text-teal-300">
                              {rec.mutabakat_kodu}
                            </span>
                            {rec.cari_vergi_no && (
                              <span className="text-[10.5px] text-gray-500">VKN: {rec.cari_vergi_no}</span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          <div className="font-semibold text-gray-200">{formatDate(rec.mutabakat_tarihi)}</div>
                          {rec.donem_baslik && (
                            <div className="text-[11px] text-gray-400 mt-0.5 max-w-[180px] truncate" title={rec.donem_baslik}>
                              {rec.donem_baslik}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                          <div className="font-mono font-extrabold text-white text-[13px]">
                            {formatCurrency(balInfo.absAmount)}
                          </div>
                          <div
                            className={`text-[10.5px] font-semibold mt-0.5 ${
                              Number(rec.bakiye) > 0
                                ? 'text-teal-300'
                                : Number(rec.bakiye) < 0
                                ? 'text-orange-300'
                                : 'text-gray-400'
                            }`}
                          >
                            {Number(rec.bakiye) > 0
                              ? 'Cari Borçlu (Alacağımız)'
                              : Number(rec.bakiye) < 0
                              ? 'Cari Alacaklı (Borcumuz)'
                              : 'Sıfır Bakiye'}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 align-top whitespace-nowrap">
                          {rec.durum === 'mutabik' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-bold text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Mutabık</span>
                            </span>
                          ) : rec.durum === 'itiraz' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/20 border border-red-500/45 text-red-200 font-extrabold text-[11px]">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                              <span>Olumsuz / İtiraz</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/35 text-amber-300 font-bold text-[11px]">
                              <Clock className="w-3.5 h-3.5" />
                              <span>Bekliyor</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 align-top max-w-sm">
                          {rec.durum === 'bekliyor' ? (
                            <span className="text-gray-500 text-[11px]">
                              Karşı tarafın onayı veya itirazı bekleniyor
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-gray-200 font-semibold">
                                {rec.cevaplayan_ad || 'Belirtilmedi'}
                                {rec.cevap_tarihi && (
                                  <span className="text-gray-500 font-normal ml-1.5">
                                    • {formatDate(rec.cevap_tarihi)}
                                  </span>
                                )}
                              </div>

                              {isDisputed && (
                                <div className="p-2 rounded-lg bg-red-950/50 border border-red-500/30 space-y-1">
                                  {rec.itiraz_tutari !== null && rec.itiraz_tutari !== undefined && (
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                      <span className="text-red-200 font-bold">
                                        Karşı Bakiye: {formatCurrency(Number(rec.itiraz_tutari))}
                                      </span>
                                      {discrepancy !== null && discrepancy !== 0 && (
                                        <span className="px-1.5 py-0.5 rounded bg-red-500/25 text-red-200 font-mono text-[10px] font-extrabold">
                                          Fark: {discrepancy > 0 ? '+' : ''}
                                          {formatCurrency(discrepancy)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {rec.itiraz_notu && (
                                    <p className="text-[11px] text-red-100/90 leading-snug">
                                      {rec.itiraz_notu}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleCopyText(publicUrl, rec.id)}
                              title="Online mutabakat linkini kopyala"
                              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                            >
                              {copiedId === rec.id ? (
                                <Check className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleResendWhatsApp(rec)}
                              title="WhatsApp ile mutabakat linki gönder"
                              className="p-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 transition"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>

                            {onPreviewMutabakatLink && (
                              <button
                                type="button"
                                onClick={() => onPreviewMutabakatLink(rec.mutabakat_kodu)}
                                title="Karşı taraf onay sayfasını önizle"
                                className="p-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 transition"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleOpenRowDetail(rec)}
                              title="A4 PDF Mektup & Detay"
                              className="px-2.5 py-1.5 rounded-lg bg-teal-400/15 hover:bg-teal-400/25 border border-teal-400/30 text-teal-300 font-bold text-[11px] inline-flex items-center gap-1 transition"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>PDF / Detay</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* MOBİL KART LİSTESİ */}
            <div className="lg:hidden divide-y divide-white/[0.06]">
              {filteredRecords.map((rec) => {
                const balInfo = describeMutabakatBalance(Number(rec.bakiye));
                const discrepancy = computeItirazDiscrepancy(rec);
                const publicUrl = buildMutabakatPublicUrl(rec.mutabakat_kodu, posConfig);
                const isDisputed = rec.durum === 'itiraz';

                return (
                  <div
                    key={rec.id}
                    className={`p-4 space-y-2.5 ${isDisputed ? 'bg-red-500/[0.06]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-white text-sm truncate">{rec.cari_unvan}</div>
                        <div className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-teal-300 font-bold">{rec.mutabakat_kodu}</span>
                          <span>• {formatDate(rec.mutabakat_tarihi)}</span>
                        </div>
                      </div>
                      {rec.durum === 'mutabik' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-bold text-[10px] shrink-0">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Mutabık</span>
                        </span>
                      ) : rec.durum === 'itiraz' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/45 text-red-200 font-extrabold text-[10px] shrink-0">
                          <AlertTriangle className="w-3 h-3 text-red-400" />
                          <span>Olumsuz / İtiraz</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/35 text-amber-300 font-bold text-[10px] shrink-0">
                          <Clock className="w-3 h-3" />
                          <span>Bekliyor</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs bg-black/25 px-3 py-2 rounded-xl border border-white/[0.05]">
                      <span className="text-gray-400">Bizim Bakiyemiz</span>
                      <span className="font-mono font-extrabold text-white">
                        {formatCurrency(balInfo.absAmount)}{' '}
                        <span className="text-[10px] font-sans text-gray-400">
                          ({Number(rec.bakiye) >= 0 ? 'Borç' : 'Alacak'})
                        </span>
                      </span>
                    </div>

                    {rec.durum !== 'bekliyor' && (
                      <div
                        className={`p-2.5 rounded-xl border text-[11px] space-y-1 ${
                          isDisputed
                            ? 'bg-red-950/45 border-red-500/35 text-red-100'
                            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                        }`}
                      >
                        <div className="font-bold">
                          Yanıtlayan: {rec.cevaplayan_ad || '-'}
                          {rec.cevap_tarihi ? ` (${formatDate(rec.cevap_tarihi)})` : ''}
                        </div>
                        {isDisputed && rec.itiraz_tutari !== null && rec.itiraz_tutari !== undefined && (
                          <div className="font-mono font-bold text-red-200">
                            Karşı Bakiye: {formatCurrency(Number(rec.itiraz_tutari))}
                            {discrepancy !== null && discrepancy !== 0
                              ? ` • Fark: ${discrepancy > 0 ? '+' : ''}${formatCurrency(discrepancy)}`
                              : ''}
                          </div>
                        )}
                        {isDisputed && rec.itiraz_notu && <p className="text-red-100/90">{rec.itiraz_notu}</p>}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleCopyText(publicUrl, rec.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-white/5 text-gray-200 text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        {copiedId === rec.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId === rec.id ? 'Kopyalandı' : 'Link'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResendWhatsApp(rec)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>WhatsApp</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenRowDetail(rec)}
                        className="px-2.5 py-1.5 rounded-lg bg-teal-400/15 border border-teal-400/30 text-teal-300 text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" />
                        <span>PDF / Detay</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* YENİ MUTABAKAT İÇİN CARİ SEÇİM MODALI */}
      {isCariPickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="mutabakat_cari_picker_modal"
        >
          <div className="bg-[#111820] border border-white/15 rounded-2xl w-full max-w-lg max-h-[85dvh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-white">Mutabakat İçin Cari Seçin</h3>
                <p className="text-[11px] text-gray-400">
                  Seçtiğiniz cari için A4 PDF mutabakat mektubu ve online cevap linki hazırlanacak.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCariPickerOpen(false)}
                className="p-2 text-gray-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 border-b border-white/[0.06]">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={cariPickerSearch}
                  onChange={(e) => setCariPickerSearch(e.target.value)}
                  data-testid="mutabakat_cari_picker_search"
                  placeholder="Cari ünvanı veya vergi no ara..."
                  className="w-full min-h-[40px] bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05]">
              {filteredCarilerForPicker.length === 0 ? (
                <div className="py-10 text-center text-xs text-gray-400">
                  Eşleşen cari bulunamadı.
                </div>
              ) : (
                filteredCarilerForPicker.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openModalForCari(c, null)}
                    className="w-full text-left px-4 py-3 hover:bg-white/[0.04] flex items-center justify-between gap-3 transition"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-white text-xs sm:text-sm truncate">{c.unvan}</div>
                      <div className="text-[11px] text-gray-400">
                        {c.tur === 'tedarikci' ? 'Tedarikçi' : 'Alıcı / Müşteri'}
                        {c.vergi_tc_no ? ` • VKN: ${c.vergi_tc_no}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-xs text-teal-300">
                        {formatCurrency(Math.abs(Number(c.bakiye) || 0))}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {Number(c.bakiye) > 0 ? 'Borçlu' : Number(c.bakiye) < 0 ? 'Alacaklı' : 'Sıfır'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* A4 PDF & ONLINE LİNK MODALI */}
      <MutabakatMektubuModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        cari={modalCari}
        movements={modalMovements}
        initialRecord={modalInitialRecord}
        onPreviewLink={onPreviewMutabakatLink}
        onMutabakatChanged={() => void loadData()}
      />
    </div>
  );
};
