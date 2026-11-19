import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Islem, Kasa, Profile } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import { useQuery } from '../hooks/useQuery';
import { fetchIslemlerList } from '../lib/receiptQueryService';
import { pickBestKasaForTur } from '../lib/kasaSyncService';
import { isMissingKasaTableError } from '../lib/kasaSql';
import {
  buildGunSonuShareSummary,
  computeCashCountReconciliation,
  computePlasiyerGunSonuSummary,
  executePlasiyerGunSonuTransfer,
  GunSonuHistoryEntry,
  loadGunSonuHistory,
  printGunSonuZReport,
  saveGunSonuHistoryEntry,
} from '../lib/plasiyerGunSonuService';
import {
  approveGunSonuRequest,
  fetchPendingGunSonuApprovals,
  GUN_SONU_APPROVAL_SQL,
  parseGsOnayTag,
  parseGsRedTag,
  PendingGunSonuApproval,
  rejectGunSonuRequest,
  submitPlasiyerGunSonuForApproval,
} from '../lib/gunSonuApprovalService';
import {
  ClipboardCheck,
  Banknote,
  CreditCard,
  FileCheck2,
  Wallet,
  Printer,
  Copy,
  Check,
  ArrowRight,
  RefreshCw,
  Calendar,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ReceiptText,
  History,
  Send,
  ShieldCheck,
  XCircle,
  Database,
  X,
} from 'lucide-react';

interface PlasiyerGunSonuPageProps {
  onOpenMakbuz: (islem: Islem) => void;
  onNavigate: (tab: string, state?: unknown) => void;
  refreshKey?: number;
  onTransferSuccess?: () => void;
}

type GunSonuDateScope = 'active_gun_sonu' | 'today' | 'week' | 'custom';
type GunSonuStatusFilter = 'all' | 'plasiyerde' | 'aktarildi';

const todayIsoLocal = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const PlasiyerGunSonuPage: React.FC<PlasiyerGunSonuPageProps> = ({
  onOpenMakbuz,
  onNavigate,
  refreshKey = 0,
  onTransferSuccess,
}) => {
  const { profile, firma } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id || '';
  const isPlasiyer = profile?.rol === 'plasiyer';

  const [allPlasiyerler, setAllPlasiyerler] = useState<Profile[]>([]);
  const [selectedPlasiyerId, setSelectedPlasiyerId] = useState<string>(() =>
    isPlasiyer && profile?.id ? profile.id : 'all'
  );
  const [dateScope, setDateScope] = useState<GunSonuDateScope>('active_gun_sonu');
  const [customStartDate, setCustomStartDate] = useState<string>(todayIsoLocal);
  const [customEndDate, setCustomEndDate] = useState<string>(todayIsoLocal);
  const [statusFilter, setStatusFilter] = useState<GunSonuStatusFilter>('all');

  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [kasaAvailable, setKasaAvailable] = useState<boolean>(true);
  const [syncToKasa, setSyncToKasa] = useState<boolean>(true);
  const [targetNakitKasaId, setTargetNakitKasaId] = useState<string>('');
  const [targetKartKasaId, setTargetKartKasaId] = useState<string>('');

  const [countedCashInput, setCountedCashInput] = useState<string>('');
  const [handoverNote, setHandoverNote] = useState<string>('');

  const [transferring, setTransferring] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [history, setHistory] = useState<GunSonuHistoryEntry[]>([]);

  // Onay kuyruğu state
  const [pendingApprovals, setPendingApprovals] = useState<PendingGunSonuApproval[]>([]);
  const [approvalTableMissing, setApprovalTableMissing] = useState<boolean>(false);
  const [showApprovalSql, setShowApprovalSql] = useState<boolean>(false);
  const [copiedApprovalSql, setCopiedApprovalSql] = useState<boolean>(false);
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  useEffect(() => {
    if (isPlasiyer && profile?.id) {
      setSelectedPlasiyerId(profile.id);
    }
  }, [isPlasiyer, profile?.id]);

  useEffect(() => {
    if (effectiveFirmaId) {
      setHistory(loadGunSonuHistory(effectiveFirmaId));
    }
  }, [effectiveFirmaId]);

  const loadPlasiyerAndKasalar = useCallback(async () => {
    if (!effectiveFirmaId) return;

    if (!isPlasiyer) {
      const { data: plData } = await supabase
        .from('profiles')
        .select('*')
        .eq('firma_id', effectiveFirmaId)
        .eq('rol', 'plasiyer')
        .order('ad_soyad', { ascending: true });
      if (plData) {
        setAllPlasiyerler(plData as Profile[]);
      }
    }

    const { data: kasaData, error: kasaErr } = await supabase
      .from('kasalar')
      .select('*')
      .eq('firma_id', effectiveFirmaId)
      .eq('aktif', true)
      .order('created_at', { ascending: true });

    if (kasaErr) {
      if (isMissingKasaTableError(kasaErr)) {
        setKasaAvailable(false);
        setSyncToKasa(false);
      }
      return;
    }

    const activeKasalar = (kasaData as Kasa[]) || [];
    setKasaAvailable(true);
    setKasalar(activeKasalar);

    if (activeKasalar.length > 0) {
      setTargetNakitKasaId(
        (prev) => prev || pickBestKasaForTur(activeKasalar, 'nakit')?.id || activeKasalar[0].id
      );
      setTargetKartKasaId(
        (prev) => prev || pickBestKasaForTur(activeKasalar, 'kredi_karti')?.id || activeKasalar[0].id
      );
    }
  }, [effectiveFirmaId, isPlasiyer]);

  const loadApprovals = useCallback(async () => {
    if (!effectiveFirmaId || isPlasiyer) {
      setPendingApprovals([]);
      return;
    }
    const res = await fetchPendingGunSonuApprovals(effectiveFirmaId, allPlasiyerler);
    setPendingApprovals(res.approvals);
    if (res.tableMissing) {
      setApprovalTableMissing(true);
    }
  }, [effectiveFirmaId, isPlasiyer, allPlasiyerler]);

  useEffect(() => {
    loadPlasiyerAndKasalar();
  }, [loadPlasiyerAndKasalar]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals, refreshKey]);

  const {
    data: islemler,
    isLoading: loading,
    error: queryError,
    refetchCount,
  } = useQuery<Islem[]>({
    queryKey: [
      'plasiyer-gun-sonu',
      effectiveFirmaId,
      isPlasiyer,
      profile?.id || null,
      selectedPlasiyerId,
      refreshKey,
    ],
    enabled: Boolean(effectiveFirmaId),
    initialData: [],
    queryFn: () =>
      fetchIslemlerList({
        firmaId: effectiveFirmaId,
        userId: profile?.id,
        rol: profile?.rol,
        filterUserId: selectedPlasiyerId,
      }),
  });

  // Tarih ve durum filtresi uygulanmış gün sonu kapsamı
  const scopedIslemler = useMemo(() => {
    const todayStr = todayIsoLocal();
    const now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const weekStartStr = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(
      weekStart.getDate()
    )}`;

    return islemler.filter((i) => {
      const tarihStr = (i.tarih || '').slice(0, 10);

      if (dateScope === 'today') {
        if (tarihStr !== todayStr) return false;
      } else if (dateScope === 'active_gun_sonu') {
        const isToday = tarihStr === todayStr;
        const isUnclosedPending = i.durum === 'plasiyerde' && !i.iptal;
        if (!isToday && !isUnclosedPending) return false;
      } else if (dateScope === 'week') {
        if (tarihStr < weekStartStr || tarihStr > todayStr) return false;
      } else if (dateScope === 'custom') {
        if (customStartDate && tarihStr < customStartDate) return false;
        if (customEndDate && tarihStr > customEndDate) return false;
      }

      if (statusFilter === 'plasiyerde' && i.durum !== 'plasiyerde') return false;
      if (statusFilter === 'aktarildi' && i.durum === 'plasiyerde') return false;

      return true;
    });
  }, [islemler, dateScope, customStartDate, customEndDate, statusFilter]);

  const summary = useMemo(
    () => computePlasiyerGunSonuSummary(scopedIslemler, allPlasiyerler),
    [scopedIslemler, allPlasiyerler]
  );

  // Bekleyen (Plasiyerde) nakit varsa öncelikle bekleyen net nakti sayım hedefi yap; yoksa dönemin toplam net nakdini göster
  const expectedCashForCount =
    summary.pendingCount > 0 ? summary.pendingNetNakit : summary.netNakit;

  const reconciliation = useMemo(
    () => computeCashCountReconciliation(expectedCashForCount, countedCashInput),
    [expectedCashForCount, countedCashInput]
  );

  const activePlasiyerName = useMemo(() => {
    if (isPlasiyer) return profile?.ad_soyad || 'Plasiyer';
    if (selectedPlasiyerId === 'all') return 'Tüm Firma Plasiyerleri';
    return allPlasiyerler.find((p) => p.id === selectedPlasiyerId)?.ad_soyad || 'Seçili Plasiyer';
  }, [isPlasiyer, profile?.ad_soyad, selectedPlasiyerId, allPlasiyerler]);

  const plasiyerPendingMeta = useMemo(() => {
    const pending = scopedIslemler.filter((i) => !i.iptal && i.durum === 'plasiyerde');
    let submittedCount = 0;
    let rejectedReason: string | null = null;
    for (const item of pending) {
      if (parseGsOnayTag(item.aciklama)) submittedCount++;
      const red = parseGsRedTag(item.aciklama);
      if (red && !rejectedReason) rejectedReason = red;
    }
    return {
      submittedCount,
      allSubmitted: pending.length > 0 && submittedCount === pending.length,
      rejectedReason,
    };
  }, [scopedIslemler]);

  const dateLabel = useMemo(() => {
    if (dateScope === 'active_gun_sonu') return `Bugün (${formatDate(todayIsoLocal())}) + Bekleyenler`;
    if (dateScope === 'today') return `Bugün (${formatDate(todayIsoLocal())})`;
    if (dateScope === 'week') return 'Bu Hafta';
    return `${customStartDate ? formatDate(customStartDate) : '...'} - ${
      customEndDate ? formatDate(customEndDate) : '...'
    }`;
  }, [dateScope, customStartDate, customEndDate]);

  const handleCopySummary = async () => {
    const text = buildGunSonuShareSummary({
      firmaUnvan: firma?.unvan || 'Firma',
      plasiyerAd: activePlasiyerName,
      dateLabel,
      summary,
      reconciliation,
      note: handoverNote,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      setFeedback({ type: 'error', text: 'Özet metni panoya kopyalanamadı.' });
    }
  };

  const handlePrintZReport = () => {
    printGunSonuZReport({
      firmaUnvan: firma?.unvan || 'Firma',
      logoUrl: firma?.logo_data,
      plasiyerAd: activePlasiyerName,
      dateLabel,
      summary,
      reconciliation,
      items: scopedIslemler,
      note: handoverNote,
    });
  };

  const handleCloseDayTransfer = async () => {
    if (!effectiveFirmaId || summary.pendingCount === 0) return;

    const confirmMsg = `${activePlasiyerName} için bekleyen ${summary.pendingCount} adet makbuzu (Net Nakit: ${formatCurrency(
      summary.pendingNetNakit
    )}) merkeze devredip gün sonunu kapatmak istediğinize emin misiniz?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setTransferring(true);
      setFeedback(null);

      const res = await executePlasiyerGunSonuTransfer({
        firmaId: effectiveFirmaId,
        userId: profile?.id,
        items: scopedIslemler,
        targetNakitKasaId,
        targetKartKasaId,
        knownKasalar: kasalar,
        syncToKasa: kasaAvailable && syncToKasa,
      });

      if (res.transferredCount > 0) {
        const entry: GunSonuHistoryEntry = {
          id: `${Date.now()}`,
          closedAt: new Date().toISOString(),
          firmaId: effectiveFirmaId,
          plasiyerId: selectedPlasiyerId,
          plasiyerName: activePlasiyerName,
          closedByName: profile?.ad_soyad || profile?.email || 'Kullanıcı',
          dateLabel,
          transferredCount: res.transferredCount,
          kasaSyncedCount: res.kasaSyncedCount,
          evrakTransferredCount: res.evrakTransferredCount,
          expectedNetNakit: expectedCashForCount,
          countedNakit: reconciliation.parsedCounted,
          cashDifference: reconciliation.difference,
          kartNet: summary.pendingByTur.kredi_karti.net,
          cekNet: summary.pendingByTur.cek.net,
          senetNet: summary.pendingByTur.senet.net,
          note: handoverNote.trim(),
        };
        setHistory(saveGunSonuHistoryEntry(effectiveFirmaId, entry));
      }

      if (res.failedCount > 0 && res.transferredCount === 0) {
        setFeedback({
          type: 'error',
          text: res.error || 'Gün sonu devri gerçekleştirilemedi.',
        });
      } else if (res.failedCount > 0) {
        setFeedback({
          type: 'error',
          text: `${res.transferredCount} makbuz aktarıldı ancak ${res.failedCount} makbuz aktarılamadı (${res.error || 'Yetki hatası'}).`,
        });
      } else {
        const detailParts = [];
        if (res.kasaSyncedCount > 0) detailParts.push(`${res.kasaSyncedCount} makbuz merkez kasalara işlendi`);
        if (res.evrakTransferredCount > 0)
          detailParts.push(`${res.evrakTransferredCount} çek/senet merkeze devredildi`);
        setFeedback({
          type: 'success',
          text: `Gün sonu tamamlandı! Toplam ${res.transferredCount} makbuz merkeze aktarıldı${
            detailParts.length > 0 ? ` (${detailParts.join(', ')})` : ''
          }.`,
        });
      }

      onTransferSuccess?.();
      await loadApprovals();
    } finally {
      setTransferring(false);
    }
  };

  const handlePlasiyerSubmitForApproval = async () => {
    if (!effectiveFirmaId || !profile?.id || summary.pendingCount === 0) return;

    const confirmMsg = `${summary.pendingCount} adet bekleyen makbuzunuzu (Net Nakit: ${formatCurrency(
      expectedCashForCount
    )}) Ana Hesap onayına göndermek istiyor musunuz?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setTransferring(true);
      setFeedback(null);

      const res = await submitPlasiyerGunSonuForApproval({
        firmaId: effectiveFirmaId,
        plasiyerUserId: profile.id,
        plasiyerAd: profile.ad_soyad || profile.email || 'Plasiyer',
        items: scopedIslemler,
        summary,
        expectedNetNakit: expectedCashForCount,
        countedNakit: reconciliation.parsedCounted,
        cashDifference: reconciliation.difference,
        note: handoverNote,
      });

      if (!res.success) {
        setFeedback({
          type: 'error',
          text: res.error || 'Gün sonu onay talebi gönderilemedi.',
        });
        return;
      }

      if (res.tableMissing) {
        setApprovalTableMissing(true);
      }

      setFeedback({
        type: 'success',
        text: `${res.submittedCount} makbuz için gün sonu sayımınız Ana Hesap onayına gönderildi. Onaylandığında merkez kasaya devredilecektir.`,
      });
      onTransferSuccess?.();
    } finally {
      setTransferring(false);
    }
  };

  const handleApproveRequest = async (approval: PendingGunSonuApproval) => {
    if (!effectiveFirmaId) return;
    setProcessingApprovalId(approval.id);
    setFeedback(null);

    try {
      const res = await approveGunSonuRequest({
        approval,
        approverUserId: profile?.id,
        approverName: profile?.ad_soyad || profile?.email || 'Ana Hesap',
        targetNakitKasaId,
        targetKartKasaId,
        knownKasalar: kasalar,
        syncToKasa: kasaAvailable && syncToKasa,
      });

      if (!res.success) {
        setFeedback({
          type: 'error',
          text: res.error || 'Onay işlemi tamamlanamadı.',
        });
        return;
      }

      setHistory(loadGunSonuHistory(effectiveFirmaId));
      const detailParts = [];
      if (res.kasaSyncedCount > 0) detailParts.push(`${res.kasaSyncedCount} makbuz kasaya işlendi`);
      if (res.evrakTransferredCount > 0) detailParts.push(`${res.evrakTransferredCount} çek/senet devredildi`);
      setFeedback({
        type: 'success',
        text: `${approval.plasiyerAd} gün sonu onaylandı ve ${res.transferredCount} makbuz merkeze aktarıldı${
          detailParts.length > 0 ? ` (${detailParts.join(', ')})` : ''
        }.`,
      });
      onTransferSuccess?.();
      await loadApprovals();
    } finally {
      setProcessingApprovalId(null);
    }
  };

  const handleConfirmRejectRequest = async (approval: PendingGunSonuApproval) => {
    if (!rejectReason.trim()) {
      setFeedback({
        type: 'error',
        text: 'Lütfen plasiyere gösterilecek iade / düzeltme nedenini yazınız.',
      });
      return;
    }

    setProcessingApprovalId(approval.id);
    setFeedback(null);
    try {
      const res = await rejectGunSonuRequest({
        approval,
        approverUserId: profile?.id,
        reason: rejectReason,
      });

      if (!res.success) {
        setFeedback({ type: 'error', text: res.error || 'İade işlemi kaydedilemedi.' });
        return;
      }

      setRejectTargetId(null);
      setRejectReason('');
      setFeedback({
        type: 'success',
        text: `${approval.plasiyerAd} gün sonu talebi düzeltme için iade edildi.`,
      });
      onTransferSuccess?.();
      await loadApprovals();
    } finally {
      setProcessingApprovalId(null);
    }
  };

  const handleCopyApprovalSql = async () => {
    try {
      await navigator.clipboard.writeText(GUN_SONU_APPROVAL_SQL);
      setCopiedApprovalSql(true);
      setTimeout(() => setCopiedApprovalSql(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="space-y-6"
      data-testid="plasiyer_gun_sonu_page"
      data-receipt-refresh-key={refreshKey}
      data-query-refetch-count={refetchCount}
    >
      {/* BAŞLIK & ÜST AKSİYONLAR */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Gün Sonu Hesaplaşma &amp; Devir</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5 flex-wrap">
            <span>Plasiyer Gün Sonu</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-teal-500/15 text-teal-300 border border-teal-500/30 font-mono">
              {activePlasiyerName}
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isPlasiyer
              ? 'Gün içinde kestiğiniz makbuzları sayıp mutabakat yapın, tek tuşla merkeze devredin ve Z-Raporu alın.'
              : 'Plasiyerlerin sahada bekleyen makbuzlarını kontrol edin, nakit sayım mutabakatı yapıp merkez kasalara aktarın.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              onTransferSuccess?.();
              loadPlasiyerAndKasalar();
            }}
            data-testid="gun_sonu_refresh_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Yenile</span>
          </button>

          <button
            type="button"
            onClick={handleCopySummary}
            data-testid="gun_sonu_copy_summary_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            {copiedSummary ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copiedSummary ? 'Özet Kopyalandı' : 'Özeti Kopyala'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrintZReport}
            data-testid="gun_sonu_print_z_report_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Z-Raporu PDF</span>
          </button>

          {!isPlasiyer && (
            <button
              type="button"
              onClick={() => onNavigate('kasa')}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600/50 text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span>Kasaya Git</span>
            </button>
          )}
        </div>
      </div>

      {/* GERİ BİLDİRİM BANNERLARI */}
      {(feedback || queryError) && (
        <div
          className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            feedback?.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback?.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 text-red-400" />
            )}
            <span className="font-semibold">{feedback?.text || queryError}</span>
          </div>
          {feedback?.type === 'success' && (
            <button
              type="button"
              onClick={handlePrintZReport}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-400 text-slate-950 font-extrabold text-xs inline-flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Z-Raporunu Yazdır</span>
            </button>
          )}
        </div>
      )}

      {/* PLASİYER İÇİN İADE / ONAY DURUM BANNERLARI */}
      {isPlasiyer && plasiyerPendingMeta.rejectedReason && (
        <div
          data-testid="gun_sonu_rejected_banner"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/35 text-rose-200 text-xs flex items-start gap-3"
        >
          <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-extrabold text-rose-300">
              Gün Sonu Talebiniz Ana Hesap Tarafından İade Edildi
            </div>
            <p className="mt-1 text-rose-200/90">
              Açıklama: <strong>{plasiyerPendingMeta.rejectedReason}</strong>
            </p>
            <p className="mt-0.5 text-[11px] text-rose-300/80">
              Sayımı ve makbuzları kontrol ettikten sonra tekrar onay için gönderebilirsiniz.
            </p>
          </div>
        </div>
      )}

      {isPlasiyer && plasiyerPendingMeta.submittedCount > 0 && (
        <div
          data-testid="gun_sonu_waiting_approval_banner"
          className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs flex items-center gap-3"
        >
          <Clock className="w-5 h-5 text-sky-400 shrink-0" />
          <div>
            <span className="font-bold text-sky-300">
              {plasiyerPendingMeta.submittedCount} makbuzunuz Ana Hesap onayı bekliyor.
            </span>{' '}
            Güncelleme yaparsanız tekrar gönderebilirsiniz.
          </div>
        </div>
      )}

      {/* ANA HESAP İÇİN ONAY BEKLEYEN PLASİYER DEVİR KUYRUĞU */}
      {!isPlasiyer && pendingApprovals.length > 0 && (
        <div
          data-testid="gun_sonu_approval_queue"
          className="bg-gradient-to-br from-amber-500/10 via-[#111820] to-teal-500/5 border border-amber-400/35 rounded-2xl overflow-hidden shadow-2xl"
        >
          <div className="p-4 sm:p-5 border-b border-amber-400/20 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                  <span>Onay Bekleyen Plasiyer Devirleri</span>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-400 text-slate-950">
                    {pendingApprovals.length} Talep
                  </span>
                </h2>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Plasiyerlerin gönderdiği nakit sayım ve gün sonu devirlerini kontrol edip kasaya onaylayın.
                </p>
              </div>
            </div>

            {approvalTableMissing && (
              <button
                type="button"
                onClick={() => setShowApprovalSql((s) => !s)}
                className="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-bold inline-flex items-center gap-1.5"
              >
                <Database className="w-3.5 h-3.5" />
                <span>{showApprovalSql ? 'SQL Gizle' : 'Opsiyonel SQL Kurulumu'}</span>
              </button>
            )}
          </div>

          {showApprovalSql && (
            <div className="p-4 bg-black/40 border-b border-white/10 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-amber-200 font-semibold">
                  gun_sonu_kapanislari tablosunu Supabase&apos;te oluşturmak için isteğe bağlı SQL:
                </span>
                <button
                  type="button"
                  onClick={() => setShowApprovalSql(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <pre className="p-2.5 rounded-xl bg-black/60 border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto">
                {GUN_SONU_APPROVAL_SQL}
              </pre>
              <button
                type="button"
                onClick={handleCopyApprovalSql}
                className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-[11px] inline-flex items-center gap-1.5"
              >
                {copiedApprovalSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedApprovalSql ? 'SQL Kopyalandı' : 'SQL Kodunu Kopyala'}</span>
              </button>
            </div>
          )}

          <div className="divide-y divide-white/[0.06]">
            {pendingApprovals.map((ap) => {
              const isBusy = processingApprovalId === ap.id;
              const isRejecting = rejectTargetId === ap.id;
              const hasDiff = Math.abs(ap.kasaFarki) >= 0.01;

              return (
                <div key={ap.id} className="p-4 sm:p-5 space-y-3" data-testid={`approval_card_${ap.id}`}>
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-extrabold text-white">{ap.plasiyerAd}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35">
                          {ap.items.length} Makbuz Onay Bekliyor
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatDate(ap.kapanisTarihi)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                        <span>
                          Beklenen Nakit:{' '}
                          <strong className="font-mono text-white">
                            {formatCurrency(ap.beklenenNakit)}
                          </strong>
                        </span>
                        <span>
                          Sayılan:{' '}
                          <strong className="font-mono text-teal-300">
                            {ap.sayilanNakit !== null ? formatCurrency(ap.sayilanNakit) : 'Girilmedi'}
                          </strong>
                        </span>
                        {ap.sayilanNakit !== null && (
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              !hasDiff
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : ap.kasaFarki > 0
                                ? 'bg-blue-500/15 text-blue-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {!hasDiff
                              ? 'Tam Mutabakat'
                              : `Fark: ${ap.kasaFarki > 0 ? '+' : ''}${formatCurrency(ap.kasaFarki)}`}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3">
                        <span>Kart: {formatCurrency(ap.kartToplam)}</span>
                        <span>Çek: {formatCurrency(ap.cekToplam)}</span>
                        <span>Senet: {formatCurrency(ap.senetToplam)}</span>
                      </div>

                      {ap.teslimNotu && (
                        <div className="text-[11px] text-amber-200/90 bg-black/30 px-2.5 py-1.5 rounded-lg border border-white/5 inline-block mt-1">
                          Plasiyer Notu: {ap.teslimNotu}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleApproveRequest(ap)}
                        data-testid={`approve_gun_sonu_${ap.id}`}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 text-slate-950 font-extrabold text-xs inline-flex items-center gap-1.5 transition shadow-lg"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isBusy ? 'İşleniyor...' : 'Onayla & Kasaya Devret'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setRejectTargetId(isRejecting ? null : ap.id);
                          setRejectReason('');
                        }}
                        data-testid={`reject_gun_sonu_${ap.id}`}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 font-bold text-xs inline-flex items-center gap-1.5 transition"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>İade Et / Reddet</span>
                      </button>
                    </div>
                  </div>

                  {isRejecting && (
                    <div className="p-3 rounded-xl bg-black/40 border border-rose-500/30 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="İade nedenini yazın (Örn: Nakit sayım tutarı eksik, kontrol ediniz)..."
                        className="flex-1 min-h-[40px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-400"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleConfirmRejectRequest(ap)}
                          className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-extrabold"
                        >
                          İadeyi Onayla
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectTargetId(null)}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-white/5 text-slate-300 text-xs font-semibold"
                        >
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FİLTRE VE KAPSAM ÇUBUĞU */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-teal-400" />
              <span>Kapsam:</span>
            </span>
            {[
              { id: 'active_gun_sonu', label: 'Bugün + Bekleyenler' },
              { id: 'today', label: 'Sadece Bugün' },
              { id: 'week', label: 'Bu Hafta' },
              { id: 'custom', label: 'Özel Tarih' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDateScope(item.id as GunSonuDateScope)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  dateScope === item.id
                    ? 'bg-teal-400 text-[#0a0e13]'
                    : 'bg-black/30 text-slate-300 hover:text-white border border-white/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {!isPlasiyer && (
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-teal-400" />
                <select
                  value={selectedPlasiyerId}
                  onChange={(e) => setSelectedPlasiyerId(e.target.value)}
                  data-testid="gun_sonu_plasiyer_select"
                  className="bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
                >
                  <option value="all">Tüm Plasiyerler</option>
                  {allPlasiyerler.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.ad_soyad}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as GunSonuStatusFilter)}
              data-testid="gun_sonu_status_select"
              className="bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
            >
              <option value="all">Tüm Durumlar</option>
              <option value="plasiyerde">Sadece Bekleyen (Plasiyerde)</option>
              <option value="aktarildi">Merkeze Aktarılanlar</option>
            </select>
          </div>
        </div>

        {dateScope === 'custom' && (
          <div className="pt-3 border-t border-white/[0.06] flex items-center gap-2.5 flex-wrap text-xs">
            <span className="text-slate-400">Tarih Aralığı:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="bg-[#0a0e13] border border-white/10 rounded-lg px-2.5 py-1.5 text-white"
            />
            <span className="text-slate-500">-</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="bg-[#0a0e13] border border-white/10 rounded-lg px-2.5 py-1.5 text-white"
            />
          </div>
        )}
      </div>

      {/* 4 ÖZET KARTI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111820] border border-emerald-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              {summary.pendingCount > 0 ? 'Bekleyen Net Nakit' : 'Dönem Net Nakit'}
            </span>
            <Banknote className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums">
            {loading ? '...' : formatCurrency(expectedCashForCount)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Tahsilat {formatCurrency(summary.nakitTahsilat)} · Tediye {formatCurrency(summary.nakitTediye)}
          </div>
        </div>

        <div className="bg-[#111820] border border-blue-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-300">
              Kredi Kartı / POS
            </span>
            <CreditCard className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums">
            {loading ? '...' : formatCurrency(summary.netKart)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Bekleyen: {summary.pendingByTur.kredi_karti.count} işlem (
            {formatCurrency(summary.pendingByTur.kredi_karti.net)})
          </div>
        </div>

        <div className="bg-[#111820] border border-purple-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-purple-300">
              Çek &amp; Senet Evrak
            </span>
            <FileCheck2 className="w-5 h-5 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums">
            {loading ? '...' : formatCurrency(summary.netCek + summary.netSenet)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Çek {formatCurrency(summary.netCek)} · Senet {formatCurrency(summary.netSenet)}
          </div>
        </div>

        <div className="bg-[#111820] border border-amber-500/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
              Devir Bekleyen Makbuz
            </span>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white font-mono tabular-nums">
            {loading ? '...' : `${summary.pendingCount} Adet`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Bekleyen: {formatCurrency(summary.pendingTotal)} · Aktarılan: {summary.transferredCount}
          </div>
        </div>
      </div>

      {/* ANA HESAPLAMA: SAYIM & MERKEZE DEVİR KARTLARI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SOL: FİZİKİ NAKİT SAYIM & MUTABAKAT */}
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
              <Banknote className="w-4 h-4 text-emerald-400" />
              <span>Fiziki Nakit Sayım ve Kasa Farkı</span>
            </h2>
            <button
              type="button"
              onClick={() =>
                setCountedCashInput(
                  expectedCashForCount > 0 ? expectedCashForCount.toFixed(2).replace('.', ',') : '0'
                )
              }
              data-testid="gun_sonu_fill_expected_cash_btn"
              className="text-[11px] font-bold text-teal-300 hover:text-teal-200 underline"
            >
              Beklenen Tutarı Doldur
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between">
            <span className="text-xs text-slate-300">Sistemdeki Beklenen Net Nakit:</span>
            <span className="text-sm font-black font-mono text-white">
              {formatCurrency(expectedCashForCount)}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Elinizdeki Sayılan Fiziki Nakit (₺)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={countedCashInput}
              onChange={(e) => setCountedCashInput(e.target.value)}
              data-testid="gun_sonu_counted_cash_input"
              placeholder="Örn: 12.500,00"
              className="w-full min-h-[46px] bg-[#0a0e13] border border-white/15 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-teal-400"
            />
          </div>

          {reconciliation.status !== 'empty' && (
            <div
              data-testid="gun_sonu_variance_badge"
              className={`p-3.5 rounded-xl border text-xs font-bold flex items-center justify-between ${
                reconciliation.status === 'match'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : reconciliation.status === 'surplus'
                  ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                  : 'bg-red-500/15 border-red-500/30 text-red-300'
              }`}
            >
              <span>
                {reconciliation.status === 'match'
                  ? 'Tam Mutabakat (Sayım Birebir Eşleşti)'
                  : reconciliation.status === 'surplus'
                  ? 'Kasa Fazlası Tespit Edildi'
                  : 'Kasa Eksiği Tespit Edildi'}
              </span>
              <span className="font-mono text-sm font-black">
                {reconciliation.difference > 0 ? '+' : ''}
                {formatCurrency(reconciliation.difference)}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Gün Sonu / Teslim Notu (Opsiyonel)
            </label>
            <textarea
              rows={2}
              value={handoverNote}
              onChange={(e) => setHandoverNote(e.target.value)}
              data-testid="gun_sonu_note_input"
              placeholder="Örn: Merkez nakit kasaya elden teslim edildi, 2 adet müşteri çeki muhasebeye verildi."
              className="w-full bg-[#0a0e13] border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
            />
          </div>
        </div>

        {/* SAĞ: HEDEF KASALAR & TEK TUŞLA MERKEZE DEVİR */}
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-xl">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-teal-400" />
                <span>Merkeze ve Kasalara Toplu Devir</span>
              </h2>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/25">
                {summary.pendingCount} Bekleyen
              </span>
            </div>

            {isPlasiyer ? (
              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/25 text-[11px] text-sky-200 leading-relaxed">
                Gönderdiğiniz gün sonu sayımı <strong>Ana Hesap onay kuyruğuna</strong> düşer. Ana hesap onayladığında makbuzlarınız merkez kasaya aktarılır.
              </div>
            ) : kasaAvailable && kasalar.length > 0 ? (
              <>
                <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={syncToKasa}
                    onChange={(e) => setSyncToKasa(e.target.checked)}
                    className="w-4 h-4 accent-teal-400 rounded"
                  />
                  <span>Nakit ve Kredi Kartı makbuzlarını seçili merkez kasalara da aktar</span>
                </label>

                {syncToKasa && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block text-[11px] text-slate-400">
                      Hedef Nakit Kasa
                      <select
                        value={targetNakitKasaId}
                        onChange={(e) => setTargetNakitKasaId(e.target.value)}
                        className="w-full mt-1 min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
                      >
                        {kasalar.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.ad} ({formatCurrency(Number(k.guncel_bakiye))})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-[11px] text-slate-400">
                      Hedef POS / Kart Kasası
                      <select
                        value={targetKartKasaId}
                        onChange={(e) => setTargetKartKasaId(e.target.value)}
                        className="w-full mt-1 min-h-[42px] bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
                      >
                        {kasalar.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.ad} ({formatCurrency(Number(k.guncel_bakiye))})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </>
            ) : (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200 leading-relaxed">
                Henüz aktif bir merkez kasa tanımlanmamış veya Kasa modülü kurulmamış görünüyor. Gün sonu yaptığınızda makbuzlar doğrudan{' '}
                <strong>Merkeze Aktarıldı</strong> durumuna geçirilir.
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-black/30 border border-white/5 text-[11px] text-slate-300 space-y-1">
              <div>
                • <strong>Nakit ({summary.pendingByTur.nakit.count}):</strong>{' '}
                {formatCurrency(summary.pendingByTur.nakit.net)}
              </div>
              <div>
                • <strong>Kredi Kartı ({summary.pendingByTur.kredi_karti.count}):</strong>{' '}
                {formatCurrency(summary.pendingByTur.kredi_karti.net)}
              </div>
              <div>
                • <strong>Çek &amp; Senet ({summary.pendingByTur.cek.count + summary.pendingByTur.senet.count}):</strong>{' '}
                {formatCurrency(summary.pendingByTur.cek.net + summary.pendingByTur.senet.net)} (Merkeze teslim onaylanır)
              </div>
            </div>
          </div>

          {isPlasiyer ? (
            <button
              type="button"
              disabled={transferring || summary.pendingCount === 0}
              onClick={handlePlasiyerSubmitForApproval}
              data-testid="gun_sonu_submit_approval_btn"
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-700 disabled:text-slate-400 text-[#0a0e13] font-extrabold text-sm flex items-center justify-center gap-2 transition shadow-lg"
            >
              {transferring ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Onaya Gönderiliyor...</span>
                </>
              ) : summary.pendingCount === 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Bekleyen Makbuz Yok (Gün Sonu Güncel)</span>
                </>
              ) : plasiyerPendingMeta.allSubmitted ? (
                <>
                  <Send className="w-4 h-4" />
                  <span>Sayımı Güncelle ve Tekrar Gönder ({summary.pendingCount} Makbuz)</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Ana Hesap Onayına Gönder ({summary.pendingCount} Makbuz)</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={transferring || summary.pendingCount === 0}
              onClick={handleCloseDayTransfer}
              data-testid="gun_sonu_transfer_btn"
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:bg-slate-700 disabled:text-slate-400 text-[#0a0e13] font-extrabold text-sm flex items-center justify-center gap-2 transition shadow-lg"
            >
              {transferring ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Gün Sonu Devri Yapılıyor...</span>
                </>
              ) : summary.pendingCount === 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Bekleyen Makbuz Yok (Gün Sonu Güncel)</span>
                </>
              ) : (
                <>
                  <ArrowRight className="w-4 h-4" />
                  <span>Gün Sonunu Kapat ve Merkeze Aktar ({summary.pendingCount} Makbuz)</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ANA HESAP İÇİN PLASİYER BAZLI BEKLEYEN ÖZETİ */}
      {!isPlasiyer && selectedPlasiyerId === 'all' && summary.perPlasiyer.length > 0 && (
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-400" />
              <span>Plasiyer Bazlı Gün Sonu Dağılımı</span>
            </h3>
            <span className="text-[11px] text-slate-400">Tek plasiyer kapatmak için “Seç”e dokunun</span>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {summary.perPlasiyer.map((row) => (
              <div
                key={row.plasiyerId}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02]"
              >
                <div>
                  <div className="font-bold text-sm text-white flex items-center gap-2">
                    <span>{row.plasiyerAd}</span>
                    {row.pendingCount > 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        {row.pendingCount} Bekleyen
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Devredildi ({row.transferredCount})
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>Nakit: {formatCurrency(row.pendingNetNakit)}</span>
                    <span>Kart: {formatCurrency(row.pendingKart)}</span>
                    <span>Çek/Senet: {formatCurrency(row.pendingCek + row.pendingSenet)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <span className="font-mono font-black text-sm text-teal-300">
                    {formatCurrency(row.pendingTotal)}
                  </span>
                  {row.plasiyerId !== '__unassigned__' && (
                    <button
                      type="button"
                      onClick={() => setSelectedPlasiyerId(row.plasiyerId)}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 text-xs font-bold transition"
                    >
                      Seç &amp; Hesaplaş
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KAPSAMDAKİ MAKBUZ LİSTESİ */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-teal-400" />
            <span>Gün Sonu Makbuzları ({scopedIslemler.length} Kayıt)</span>
          </h3>
          <span className="text-[11px] text-slate-400">Detay için makbuza dokunun</span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-slate-400">Makbuzlar yükleniyor...</div>
        ) : scopedIslemler.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Seçili gün sonu kapsamında makbuz kaydı bulunmuyor.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {scopedIslemler.map((islem) => (
              <div
                key={islem.id}
                onClick={() => onOpenMakbuz(islem)}
                className="p-4 hover:bg-white/[0.03] transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-teal-400">
                      {islem.makbuz_no || `#${islem.id.slice(0, 8)}`}
                    </span>
                    <span className="text-xs font-bold text-white truncate">
                      {islem.cariler?.unvan || 'Cari'}
                    </span>
                    {islem.iptal ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-300">
                        İptal
                      </span>
                    ) : islem.durum === 'plasiyerde' ? (
                      parseGsOnayTag(islem.aciklama) ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          Onay Bekliyor
                        </span>
                      ) : parseGsRedTag(islem.aciklama) ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          İade Edildi
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          Plasiyerde
                        </span>
                      )
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Merkeze Aktarıldı
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                    <span>{formatDate(islem.tarih)}</span>
                    <span>·</span>
                    <span className="uppercase">{islem.tip}</span>
                    <span>·</span>
                    <span className="capitalize">{islem.tur.replace('_', ' ')}</span>
                    {islem.profiles?.ad_soyad && (
                      <>
                        <span>·</span>
                        <span>{islem.profiles.ad_soyad}</span>
                      </>
                    )}
                  </div>
                </div>

                <div
                  className={`font-mono font-black text-sm whitespace-nowrap ${
                    islem.iptal
                      ? 'line-through text-slate-500'
                      : islem.tip === 'tahsilat'
                      ? 'text-teal-300'
                      : 'text-orange-300'
                  }`}
                >
                  {formatCurrency(Number(islem.tutar))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SON GÜN SONU KAPANIŞLARI GEÇMİŞİ */}
      {history.length > 0 && (
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-teal-400" />
              <span>Son Gün Sonu Kapanış Geçmişi ({history.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {history.slice(0, 6).map((h) => (
              <div
                key={h.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <div className="font-bold text-white">
                    {h.plasiyerName} · {h.transferredCount} Makbuz Devredildi
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {new Date(h.closedAt).toLocaleString('tr-TR')} · Kapanış: {h.closedByName}
                    {h.note ? ` · Not: ${h.note}` : ''}
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="font-bold text-teal-300">
                    Net Nakit: {formatCurrency(h.expectedNetNakit)}
                  </div>
                  {h.countedNakit !== null && (
                    <div className="text-[11px] text-slate-400">
                      Sayım: {formatCurrency(h.countedNakit)} (Fark:{' '}
                      {h.cashDifference > 0 ? '+' : ''}
                      {formatCurrency(h.cashDifference)})
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
