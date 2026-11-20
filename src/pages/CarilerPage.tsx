import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Cari, CariTur, Islem, Fatura, FaturaYon } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import {
  Users,
  Search,
  Plus,
  Edit2,
  Trash2,
  Phone,
  Mail,
  FileText,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  AlertCircle,
  X,
  FileSpreadsheet,
  CheckCircle2,
  ExternalLink,
  Printer,
  Download,
  Upload,
  Lock,
  Calendar,
  Eye,
  RefreshCw,
  MessageCircle,
  ShieldAlert,
  Scale,
  Database,
  Copy,
  Check,
  FileCheck2,
} from 'lucide-react';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import {
  buildCariEkstre,
  CariEkstreRow,
  formatEkstreBakiye,
  RawEkstreMovement,
} from '../lib/cariEkstreHelper';
import { UblImportModal } from '../components/cari/UblImportModal';
import { ManualFaturaModal } from '../components/cari/ManualFaturaModal';
import { MutabakatMektubuModal } from '../components/cari/MutabakatMektubuModal';
import { CariExcelImportModal } from '../components/cari/CariExcelImportModal';
import { UblInvoicePreviewModal } from '../components/cari/UblInvoicePreviewModal';
import {
  DeleteCariConfirmModal,
  DeleteFaturaConfirmModal,
} from '../components/cari/CariDeleteModals';
import { isWebPlatform } from '../lib/platform';
import { ParsedUblInvoice, parseUblInvoiceXml } from '../lib/ublParser';
import {
  buildFallbackInvoiceFromRecord,
  FaturaWithDetay,
  getUblInvoiceSnapshotAsync,
  hydrateParsedFromCompactDetay,
  saveUblInvoiceSnapshotsAsync,
  syncUblDetayToSupabase,
} from '../lib/ublInvoiceStore';
import {
  auditAllCarilerBalances,
  CARI_RISK_SETUP_SQL,
  CariBalanceVerification,
  computeCariBalanceVerification,
  evaluateCariRiskStatus,
  getEffectiveCariRiskLimit,
  isMissingRiskLimitColumnError,
  setLocalCariRiskLimit,
  syncCariBalanceToCalculated,
} from '../lib/cariRiskAndMutabakat';
import { buildCariBorcHatirlatmaMesaji } from '../lib/whatsappTemplates';
import { WhatsAppReminderModal } from '../components/common/WhatsAppReminderModal';

interface CarilerPageProps {
  onNavigate: (tab: string, state?: unknown) => void;
  openNewModalInitially?: boolean;
  onOpenMakbuz?: (islem: Islem) => void;
  refreshKey?: number;
  onPreviewMutabakatLink?: (code: string) => void;
}

export const CarilerPage: React.FC<CarilerPageProps> = ({
  onNavigate,
  openNewModalInitially = false,
  onOpenMakbuz,
  refreshKey = 0,
  onPreviewMutabakatLink,
}) => {
  const { firma, profile, entitlements } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id;
  const [cariler, setCariler] = useState<Cari[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [turFilter, setTurFilter] = useState<'all' | CariTur>('all');
  const [error, setError] = useState<string | null>(null);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(openNewModalInitially);
  const [isUblModalOpen, setIsUblModalOpen] = useState(false);
  const [isManualFaturaOpen, setIsManualFaturaOpen] = useState(false);
  const [manualFaturaInitialCari, setManualFaturaInitialCari] = useState<Cari | null>(null);
  const [manualFaturaLockCari, setManualFaturaLockCari] = useState(false);
  const [isMutabakatModalOpen, setIsMutabakatModalOpen] = useState(false);
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState(false);
  const [editingCari, setEditingCari] = useState<Cari | null>(null);
  const [selectedCariForDetail, setSelectedCariForDetail] = useState<Cari | null>(null);
  const [detailMovements, setDetailMovements] = useState<RawEkstreMovement[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailStartDate, setDetailStartDate] = useState('');
  const [detailEndDate, setDetailEndDate] = useState('');
  const [previewFaturaState, setPreviewFaturaState] = useState<{
    invoice: ParsedUblInvoice;
    yon: FaturaYon;
    isSummaryFallback: boolean;
    sourceFatura?: Fatura;
  } | null>(null);
  const bulkXmlInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkXmlSyncing, setBulkXmlSyncing] = useState(false);
  const [bulkXmlFeedback, setBulkXmlFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const canPreviewUblInvoice = isWebPlatform();

  // Form Fields
  const [formUnvan, setFormUnvan] = useState('');
  const [formVergiTcNo, setFormVergiTcNo] = useState('');
  const [formTelefon, setFormTelefon] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formTur, setFormTur] = useState<CariTur>('alici');
  const [formRiskLimiti, setFormRiskLimiti] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Risk Limiti & Mutabakat & WhatsApp State
  const [showRiskSqlBanner, setShowRiskSqlBanner] = useState(false);
  const [copiedRiskSql, setCopiedRiskSql] = useState(false);
  const [waCariTarget, setWaCariTarget] = useState<{
    cari: Cari;
    defaultMessage: string;
  } | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResults, setAuditResults] = useState<CariBalanceVerification[]>([]);
  const [syncingAuditCariId, setSyncingAuditCariId] = useState<string | null>(null);
  const [syncingDetailBalance, setSyncingDetailBalance] = useState(false);
  const [detailVerifyFeedback, setDetailVerifyFeedback] = useState<string | null>(null);

  // Delete State
  const [cariToDelete, setCariToDelete] = useState<Cari | null>(null);
  const [faturaToDelete, setFaturaToDelete] = useState<Fatura | null>(null);

  const fetchCariler = async () => {
    if (!effectiveFirmaId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchErr } = await supabase
        .from('cariler')
        .select('*')
        .eq('firma_id', effectiveFirmaId)
        .order('unvan', { ascending: true });

      if (fetchErr) throw fetchErr;
      setCariler((data as Cari[]) || []);
    } catch (err: unknown) {
      setError(handleSupabaseError(err, 'Cariler yüklenirken hata oluştu.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCariler();
    if (selectedCariForDetail) {
      openDetail(selectedCariForDetail);
    }
  }, [effectiveFirmaId, refreshKey]);

  const openAddModal = () => {
    setEditingCari(null);
    setFormUnvan('');
    setFormVergiTcNo('');
    setFormTelefon('');
    setFormEmail('');
    setFormTur('alici');
    setFormRiskLimiti('');
    setIsModalOpen(true);
  };

  const openEditModal = (cari: Cari) => {
    setEditingCari(cari);
    setFormUnvan(cari.unvan);
    setFormVergiTcNo(cari.vergi_tc_no || '');
    setFormTelefon(cari.telefon || '');
    setFormEmail(cari.email || '');
    setFormTur(cari.tur);
    const existingLimit = getEffectiveCariRiskLimit(cari, effectiveFirmaId);
    setFormRiskLimiti(existingLimit ? String(existingLimit) : '');
    setIsModalOpen(true);
  };

  const parseRiskLimitInput = (raw: string): number | null => {
    const cleaned = raw.trim().replace(/\./g, '').replace(',', '.');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  const handleSaveCari = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFirmaId) return;
    if (!formUnvan.trim()) {
      setError('Cari unvanı zorunludur.');
      return;
    }

    const parsedRisk = parseRiskLimitInput(formRiskLimiti);
    setFormLoading(true);
    setError(null);

    try {
      if (editingCari) {
        // Düzenle (bakiye güncellenmez!)
        const basePatch = {
          unvan: formUnvan.trim(),
          vergi_tc_no: formVergiTcNo.trim() || null,
          telefon: formTelefon.trim() || null,
          email: formEmail.trim() || null,
          tur: formTur,
        };
        const { error: updateErr } = await supabase
          .from('cariler')
          .update({
            ...basePatch,
            risk_limiti: parsedRisk,
          })
          .eq('id', editingCari.id)
          .eq('firma_id', effectiveFirmaId);

        if (updateErr) {
          if (!isMissingRiskLimitColumnError(updateErr)) throw updateErr;
          const { error: fbErr } = await supabase
            .from('cariler')
            .update(basePatch)
            .eq('id', editingCari.id)
            .eq('firma_id', effectiveFirmaId);
          if (fbErr) throw fbErr;
          if (parsedRisk !== null) setShowRiskSqlBanner(true);
        }
        setLocalCariRiskLimit(effectiveFirmaId, editingCari.id, parsedRisk);
      } else {
        // Ekle (bakiye 0 başlar, trigger yönetir)
        const baseInsert = {
          firma_id: effectiveFirmaId,
          unvan: formUnvan.trim(),
          vergi_tc_no: formVergiTcNo.trim() || null,
          telefon: formTelefon.trim() || null,
          email: formEmail.trim() || null,
          tur: formTur,
          bakiye: 0,
        };
        const { data: insertedRow, error: insertErr } = await supabase
          .from('cariler')
          .insert({
            ...baseInsert,
            risk_limiti: parsedRisk,
          })
          .select('id')
          .single();

        let createdId = insertedRow?.id ? String(insertedRow.id) : '';
        if (insertErr) {
          if (!isMissingRiskLimitColumnError(insertErr)) throw insertErr;
          const { data: fbRow, error: fbErr } = await supabase
            .from('cariler')
            .insert(baseInsert)
            .select('id')
            .single();
          if (fbErr) throw fbErr;
          if (fbRow?.id) createdId = String(fbRow.id);
          if (parsedRisk !== null) setShowRiskSqlBanner(true);
        }
        if (createdId) {
          setLocalCariRiskLimit(effectiveFirmaId, createdId, parsedRisk);
        }
      }

      setIsModalOpen(false);
      await fetchCariler();
    } catch (err: unknown) {
      setError(handleSupabaseError(err, 'Cari kaydedilirken hata oluştu.'));
    } finally {
      setFormLoading(false);
    }
  };

  const handleOpenWhatsAppForCari = (cari: Cari) => {
    const msg = buildCariBorcHatirlatmaMesaji({
      firmaUnvan: firma?.unvan,
      cariUnvan: cari.unvan,
      bakiye: Number(cari.bakiye) || 0,
    });
    setWaCariTarget({ cari, defaultMessage: msg });
  };

  const handleRunFirmBalanceAudit = async () => {
    if (!effectiveFirmaId) return;
    setIsAuditModalOpen(true);
    setAuditLoading(true);
    try {
      const results = await auditAllCarilerBalances({
        firmaId: effectiveFirmaId,
        cariler,
      });
      setAuditResults(results);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleSyncAuditRow = async (row: CariBalanceVerification) => {
    if (!effectiveFirmaId) return;
    setSyncingAuditCariId(row.cariId);
    try {
      const { error: syncErr } = await syncCariBalanceToCalculated({
        firmaId: effectiveFirmaId,
        cariId: row.cariId,
        calculatedBakiye: row.calculatedBakiye,
      });
      if (syncErr) {
        setError(syncErr);
        return;
      }
      setAuditResults((prev) =>
        prev.map((item) =>
          item.cariId === row.cariId
            ? {
                ...item,
                recordedBakiye: item.calculatedBakiye,
                diff: 0,
                hasDiscrepancy: false,
              }
            : item
        )
      );
      await fetchCariler();
    } finally {
      setSyncingAuditCariId(null);
    }
  };

  const handleSyncAllDiscrepancies = async () => {
    if (!effectiveFirmaId) return;
    const mismatched = auditResults.filter((r) => r.hasDiscrepancy);
    if (mismatched.length === 0) return;
    setAuditLoading(true);
    try {
      for (const item of mismatched) {
        await syncCariBalanceToCalculated({
          firmaId: effectiveFirmaId,
          cariId: item.cariId,
          calculatedBakiye: item.calculatedBakiye,
        });
      }
      setAuditResults((prev) =>
        prev.map((item) => ({
          ...item,
          recordedBakiye: item.calculatedBakiye,
          diff: 0,
          hasDiscrepancy: false,
        }))
      );
      await fetchCariler();
    } finally {
      setAuditLoading(false);
    }
  };

  const handleCopyRiskSql = async () => {
    try {
      await navigator.clipboard.writeText(CARI_RISK_SETUP_SQL);
      setCopiedRiskSql(true);
      setTimeout(() => setCopiedRiskSql(false), 2000);
    } catch {
      // ignore
    }
  };

  // Cari Detay ve Hareketleri Yükle
  const openDetail = async (cari: Cari) => {
    const isDifferentCari = selectedCariForDetail?.id !== cari.id;
    setSelectedCariForDetail(cari);
    if (isDifferentCari) {
      setDetailStartDate('');
      setDetailEndDate('');
      setBulkXmlFeedback(null);
      setDetailVerifyFeedback(null);
    }
    setLoadingDetail(true);

    try {
      const { data: freshCari } = await supabase
        .from('cariler')
        .select('*')
        .eq('id', cari.id)
        .maybeSingle();
      if (freshCari) {
        setSelectedCariForDetail(freshCari as Cari);
      }

      // 1. İşlemleri getir (yapan kullanıcı profili ile, hata durumunda yedek sorgu)
      let { data: islemlerData, error: islemlerErr } = await supabase
        .from('islemler')
        .select('*, profiles:yapan_user_id(ad_soyad)')
        .eq('cari_id', cari.id)
        .order('tarih', { ascending: true });

      if (islemlerErr) {
        const fallback = await supabase
          .from('islemler')
          .select('*')
          .eq('cari_id', cari.id)
          .order('tarih', { ascending: true });
        islemlerData = fallback.data;
      }

      // 2. Faturaları getir
      const { data: faturalarData } = await supabase
        .from('faturalar')
        .select('*')
        .eq('cari_id', cari.id)
        .order('tarih', { ascending: true });

      // Birleştir (kronolojik ve aynı tarihte fatura üstte sıralaması buildCariEkstre içinde yapılır)
      const combined: RawEkstreMovement[] = [
        ...((islemlerData as Islem[]) || []),
        ...(((faturalarData as Fatura[]) || []).map((f) => ({
          ...f,
          tip: f.yon === 'satis' ? 'satış faturası' : 'alış faturası',
        }))),
      ];

      setDetailMovements(combined);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleOpenFaturaPreview = async (r: CariEkstreRow) => {
    if (!r.rawMovement) return;
    const rawFatura = r.rawMovement as FaturaWithDetay;
    const yon: FaturaYon = rawFatura.yon === 'satis' ? 'satis' : 'alis';
    const faturaNo = rawFatura.fatura_no || r.belgeNo;
    const snapshot = effectiveFirmaId
      ? await getUblInvoiceSnapshotAsync(effectiveFirmaId, faturaNo, yon)
      : null;

    if (snapshot) {
      setPreviewFaturaState({
        invoice: snapshot.invoice,
        yon: snapshot.yon,
        isSummaryFallback: false,
        sourceFatura: rawFatura,
      });
      return;
    }

    if (rawFatura.ubl_detay && typeof rawFatura.ubl_detay === 'object') {
      setPreviewFaturaState({
        invoice: hydrateParsedFromCompactDetay({
          fatura: rawFatura,
          detay: rawFatura.ubl_detay,
        }),
        yon,
        isSummaryFallback: false,
        sourceFatura: rawFatura,
      });
      return;
    }

    setPreviewFaturaState({
      invoice: buildFallbackInvoiceFromRecord({
        faturaNo,
        tarih: rawFatura.tarih || r.dateKey,
        tutar: Number(rawFatura.tutar) || 0,
        yon,
        firma,
        cari: selectedCariForDetail,
      }),
      yon,
      isSummaryFallback: true,
      sourceFatura: rawFatura,
    });
  };

  const handleBulkXmlMatch = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !effectiveFirmaId) return;

    setBulkXmlSyncing(true);
    setBulkXmlFeedback(null);

    try {
      const files = Array.from(fileList);
      const detailInvoiceYonMap = new Map<string, FaturaYon>();
      for (const movement of detailMovements) {
        if ('fatura_no' in movement && movement.fatura_no) {
          detailInvoiceYonMap.set(
            String(movement.fatura_no).trim().toUpperCase(),
            movement.yon === 'satis' ? 'satis' : 'alis'
          );
        }
      }

      const parsedItems: Array<{ yon: FaturaYon; parsed: ParsedUblInvoice }> = [];
      let matchedInCurrentCari = 0;
      let gibXsltCount = 0;
      let failedCount = 0;

      for (const file of files) {
        try {
          const text = await file.text();
          const parsed = parseUblInvoiceXml(text, file.name, firma?.vergi_no, cariler);
          const cleanNo = parsed.faturaNo.trim().toUpperCase();
          const dbYon = detailInvoiceYonMap.get(cleanNo);
          const yon = dbYon || parsed.detectedYon;
          parsedItems.push({ yon, parsed });
          if (detailInvoiceYonMap.has(cleanNo)) {
            matchedInCurrentCari += 1;
          }
          if (parsed.renderedGibHtml) {
            gibXsltCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }

      if (parsedItems.length === 0) {
        setBulkXmlFeedback({
          type: 'error',
          text: 'Seçilen dosyalardan geçerli bir UBL / XML faturası okunamadı.',
        });
        return;
      }

      await saveUblInvoiceSnapshotsAsync(effectiveFirmaId, parsedItems);
      const cloudRes = await syncUblDetayToSupabase(effectiveFirmaId, parsedItems);

      const parts = [
        `${parsedItems.length} XML faturası önbelleğe işlendi`,
        matchedInCurrentCari > 0 ? `bu caride ${matchedInCurrentCari} fatura eşleşti` : '',
        gibXsltCount > 0 ? `${gibXsltCount} adedinde Orijinal GİB XSLT görünümü hazır` : '',
        cloudRes.syncedCount > 0 ? `${cloudRes.syncedCount} kayıt buluta eşitlendi` : '',
      ].filter(Boolean);

      setBulkXmlFeedback({
        type: 'success',
        text: `${parts.join(' • ')}.${failedCount > 0 ? ` (${failedCount} dosya okunamadı)` : ''}`,
      });
    } catch (err: unknown) {
      setBulkXmlFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Toplu XML eşleştirme sırasında hata oluştu.',
      });
    } finally {
      setBulkXmlSyncing(false);
      if (bulkXmlInputRef.current) {
        bulkXmlInputRef.current.value = '';
      }
    }
  };

  const toLocalDateInputValue = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const applyEkstreQuickRange = (preset: 'all' | 'this_month' | 'last_30' | 'this_year') => {
    const now = new Date();
    const todayStr = toLocalDateInputValue(now);
    if (preset === 'all') {
      setDetailStartDate('');
      setDetailEndDate('');
      return;
    }
    if (preset === 'this_month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      setDetailStartDate(toLocalDateInputValue(startOfMonth));
      setDetailEndDate(todayStr);
      return;
    }
    if (preset === 'last_30') {
      const thirtyAgo = new Date(now);
      thirtyAgo.setDate(thirtyAgo.getDate() - 30);
      setDetailStartDate(toLocalDateInputValue(thirtyAgo));
      setDetailEndDate(todayStr);
      return;
    }
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    setDetailStartDate(toLocalDateInputValue(startOfYear));
    setDetailEndDate(todayStr);
  };

  const isDateRangeInvalid = Boolean(
    detailStartDate && detailEndDate && detailStartDate > detailEndDate
  );

  const ekstreResult = useMemo(
    () =>
      buildCariEkstre({
        movements: detailMovements,
        startDate: isDateRangeInvalid ? '' : detailStartDate,
        endDate: isDateRangeInvalid ? '' : detailEndDate,
        currentCariBakiye: selectedCariForDetail?.bakiye,
      }),
    [detailMovements, detailStartDate, detailEndDate, isDateRangeInvalid, selectedCariForDetail?.bakiye]
  );

  const detailBalanceVerification = useMemo(() => {
    if (!selectedCariForDetail || loadingDetail) return null;
    const islemler: Array<Pick<Islem, 'cari_id' | 'tip' | 'tutar' | 'iptal'>> = [];
    const faturalar: Array<Pick<Fatura, 'cari_id' | 'yon' | 'tutar'>> = [];
    for (const m of detailMovements) {
      if ('fatura_no' in m) {
        faturalar.push(m as Fatura);
      } else {
        islemler.push(m as Islem);
      }
    }
    return computeCariBalanceVerification({
      cari: selectedCariForDetail,
      islemler,
      faturalar,
    });
  }, [selectedCariForDetail, detailMovements, loadingDetail]);

  const handleSyncDetailBalance = async () => {
    if (!effectiveFirmaId || !selectedCariForDetail || !detailBalanceVerification) return;
    setSyncingDetailBalance(true);
    setDetailVerifyFeedback(null);
    try {
      const { error: syncErr } = await syncCariBalanceToCalculated({
        firmaId: effectiveFirmaId,
        cariId: selectedCariForDetail.id,
        calculatedBakiye: detailBalanceVerification.calculatedBakiye,
      });
      if (syncErr) {
        setDetailVerifyFeedback(syncErr);
        return;
      }
      setDetailVerifyFeedback('Cari bakiyesi ekstre toplamı ile eşitlendi.');
      await fetchCariler();
      await openDetail(selectedCariForDetail);
    } finally {
      setSyncingDetailBalance(false);
    }
  };

  const ekstrePeriodLabel = useMemo(() => {
    if (detailStartDate && detailEndDate) {
      return `${formatDate(detailStartDate)} - ${formatDate(detailEndDate)}`;
    }
    if (detailStartDate) {
      return `${formatDate(detailStartDate)} sonrası`;
    }
    if (detailEndDate) {
      return `${formatDate(detailEndDate)} tarihine kadar`;
    }
    return 'Tüm Tarihler';
  }, [detailStartDate, detailEndDate]);

  const handleExportCariEkstresiExcel = () => {
    if (!selectedCariForDetail) return;
    const headers = [
      'Tarih',
      'Belge No / Makbuz',
      'İşlem Tipi',
      'Açıklama',
      'Durum',
      'Borç (TL)',
      'Alacak (TL)',
      'Bakiye (TL)',
    ];
    const rows = ekstreResult.rows.map((r) => [
      r.formattedDate,
      r.belgeNo,
      r.tipLabel,
      r.aciklama,
      r.isCancelled ? 'İPTAL' : r.isOpeningRow ? 'DEVİR' : 'AKTİF',
      r.borc,
      r.alacak,
      r.bakiye,
    ]);
    const cleanName = selectedCariForDetail.unvan.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const rangeSuffix =
      detailStartDate || detailEndDate
        ? `_${detailStartDate || 'bas'}_${detailEndDate || 'son'}`
        : '';
    exportToExcel(`cari_ekstre_${cleanName}${rangeSuffix}`, headers, rows);
  };

  const handleExportCariEkstresiPdf = () => {
    if (!selectedCariForDetail) return;
    const headers = [
      'Tarih',
      'Belge No',
      'İşlem Tipi',
      'Açıklama',
      'Borç',
      'Alacak',
      'Bakiye',
    ];
    const rows = ekstreResult.rows.map((r) => [
      r.formattedDate,
      r.belgeNo,
      r.tipLabel,
      r.aciklama,
      r.borc > 0 ? formatCurrency(r.borc) : '-',
      r.alacak > 0 ? formatCurrency(r.alacak) : '-',
      formatEkstreBakiye(r.bakiye),
    ]);

    const summary = [
      { label: 'Cari Türü', value: selectedCariForDetail.tur === 'alici' ? 'Alıcı (Müşteri)' : 'Tedarikçi' },
      { label: 'Tarih Aralığı', value: ekstrePeriodLabel },
      { label: 'Toplam Borç', value: formatCurrency(ekstreResult.summary.totalBorc) },
      { label: 'Toplam Alacak', value: formatCurrency(ekstreResult.summary.totalAlacak) },
      {
        label: detailStartDate || detailEndDate ? 'Dönem Sonu Bakiye' : 'Net Bakiye',
        value: formatEkstreBakiye(ekstreResult.summary.closingBalance),
      },
    ];

    printPdfReport(
      `CARİ HESAP EKSTRESİ: ${selectedCariForDetail.unvan}`,
      `VKN/TCKN: ${selectedCariForDetail.vergi_tc_no || '-'} | Tel: ${selectedCariForDetail.telefon || '-'} | Dönem: ${ekstrePeriodLabel}`,
      headers,
      rows,
      summary,
      firma?.logo_data || null,
      {
        rightAlignedColumns: [4, 5, 6],
        compactNumeric: true,
        columnStyles: {
          0: 'width: 1%; white-space: nowrap; font-size: 9.5px;',
          1: 'width: 1%; white-space: nowrap; font-size: 9.5px; font-family: monospace;',
          2: 'width: 1%; white-space: nowrap; font-size: 9px;',
          3: 'width: auto; min-width: 170px; font-size: 10px; line-height: 1.35; word-break: break-word;',
        },
      }
    );
  };

  // Filtreleme
  const filteredCariler = cariler.filter((c) => {
    const matchesTur = turFilter === 'all' || c.tur === turFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      c.unvan.toLowerCase().includes(q) ||
      (c.vergi_tc_no && c.vergi_tc_no.toLowerCase().includes(q)) ||
      (c.telefon && c.telefon.includes(q));
    return matchesTur && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* BAŞLIK & EYEBROW */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <Users className="w-3 h-3" />
            <span>Müşteri ve Tedarikçiler</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Cari Hesaplar</h1>
          <p className="text-xs text-gray-400 mt-1">
            Alıcı ve tedarikçi firmalarınızın bakiye durumları ve işlem hareketleri
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {isWebPlatform() && profile?.rol !== 'plasiyer' && (
            <button
              type="button"
              onClick={() => {
                setManualFaturaInitialCari(null);
                setManualFaturaLockCari(false);
                setIsManualFaturaOpen(true);
              }}
              data-testid="open_manual_fatura_button"
              title="Alış veya satış faturasını elle cariye (ve isterseniz kasaya) işleyin (Tüm Paketler · Web)"
              className="font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2 border bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-400/35 text-indigo-200"
            >
              <FileText className="w-4 h-4" />
              <span>Alış / Satış Faturası Gir</span>
            </button>
          )}

          {isWebPlatform() && (
            <button
              type="button"
              onClick={() => {
                if (!entitlements.canUseUblImport) {
                  onNavigate('paketler');
                  return;
                }
                setIsUblModalOpen(true);
              }}
              data-testid="open_ubl_import_button"
              title={
                entitlements.canUseUblImport
                  ? 'UBL / XML / ZIP Fatura Yükle'
                  : 'Kurumsal (Pro) pakette açılır — yükseltmek için tıklayın'
              }
              className={`font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2 border ${
                entitlements.canUseUblImport
                  ? 'bg-amber-400/15 hover:bg-amber-400/25 border-amber-400/35 text-amber-300'
                  : 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-400/40 text-amber-200'
              }`}
            >
              {entitlements.canUseUblImport ? (
                <Upload className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4 text-amber-300" />
              )}
              <span>UBL / XML Fatura Yükle</span>
              {!entitlements.canUseUblImport && (
                <span
                  data-testid="ubl_lock_badge"
                  className="px-1.5 py-0.5 rounded-md bg-amber-400/20 border border-amber-400/40 text-amber-300 text-[10px] font-extrabold"
                >
                  Kurumsal
                </span>
              )}
            </button>
          )}

          {isWebPlatform() && (
            <button
              type="button"
              onClick={() => setIsExcelImportModalOpen(true)}
              data-testid="open_cari_excel_import_button"
              title="Excel (.xlsx/.xls/.csv) dosyasından toplu cari yükle"
              className="font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2 border bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/35 text-emerald-300"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Excel&apos;den Cari Yükle</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleRunFirmBalanceAudit()}
            data-testid="cariler_audit_balances_btn"
            className="font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2 border bg-sky-500/15 hover:bg-sky-500/25 border-sky-400/35 text-sky-300"
          >
            <Scale className="w-4 h-4" />
            <span>Bakiye Doğrula &amp; Onar</span>
          </button>

          <button
            onClick={openAddModal}
            className="bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-[0_0_20px_rgba(45,212,191,0.25)] flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Cari Ekle</span>
          </button>
        </div>
      </div>

      {showRiskSqlBanner && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Database className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-200">
                  Risk limiti kaydedildi (Cihaz içi yedek mod aktif)
                </div>
                <p className="text-[11px] text-amber-200/80 mt-0.5">
                  Risk limitlerini bulutta tüm cihazlarla eşitlemek için aşağıdaki SQL&apos;i Supabase SQL Editor&apos;da bir kez çalıştırabilirsiniz.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRiskSqlBanner(false)}
              className="text-amber-300 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <pre className="p-2.5 rounded-xl bg-black/50 border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto">
            {CARI_RISK_SETUP_SQL}
          </pre>
          <button
            type="button"
            onClick={handleCopyRiskSql}
            className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-extrabold text-[11px] inline-flex items-center gap-1.5"
          >
            {copiedRiskSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedRiskSql ? 'SQL Kopyalandı' : 'SQL Kodunu Kopyala'}</span>
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* FİLTRE & ARAMA ÇUBUĞU */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Arama Inputu */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Unvan, VKN veya telefon ile ara..."
            className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
          />
        </div>

        {/* Tümü / Alıcı / Tedarikçi Sekmeleri */}
        <div className="flex items-center rounded-xl bg-black/40 p-1 border border-white/[0.05] w-full sm:w-auto">
          <button
            onClick={() => setTurFilter('all')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
              turFilter === 'all'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Tümü ({cariler.length})
          </button>
          <button
            onClick={() => setTurFilter('alici')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
              turFilter === 'alici'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Alıcılar
          </button>
          <button
            onClick={() => setTurFilter('tedarikci')}
            className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
              turFilter === 'tedarikci'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Tedarikçiler
          </button>
        </div>
      </div>

      {/* CARİ LİSTESİ TABLOSU / MOBİL KARTLAR */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-xs text-gray-400">Cariler yükleniyor...</div>
        ) : filteredCariler.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Kriterlere uygun cari bulunamadı.</p>
          </div>
        ) : (
          <div>
            {/* MASAÜSTÜ TABLO */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/20 text-gray-400 text-[11px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-5">Cari Unvanı</th>
                    <th className="py-3 px-4">Tür</th>
                    <th className="py-3 px-4">Vergi / TCKN</th>
                    <th className="py-3 px-4">İletişim</th>
                    <th className="py-3 px-4 text-right">Güncel Bakiye (₺)</th>
                    <th className="py-3 px-5 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredCariler.map((c) => {
                    const bakiye = Number(c.bakiye) || 0;
                    const riskLimit = getEffectiveCariRiskLimit(c, effectiveFirmaId);
                    const riskEval = evaluateCariRiskStatus({
                      currentBakiye: bakiye,
                      riskLimit,
                    });
                    return (
                      <tr
                        key={c.id}
                        className="hover:bg-white/[0.03] transition group cursor-pointer"
                        onClick={() => openDetail(c)}
                      >
                        <td className="py-3.5 px-5">
                          <div className="font-bold text-white group-hover:text-teal-300 transition flex items-center gap-2 flex-wrap">
                            <span>{c.unvan}</span>
                            {riskEval.hasLimit && (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                  riskEval.level === 'exceeded'
                                    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                    : riskEval.level === 'warning'
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                }`}
                              >
                                Risk %{riskEval.percent}
                              </span>
                            )}
                          </div>
                          {c.email && <div className="text-[11px] text-gray-500 mt-0.5">{c.email}</div>}
                          {riskEval.hasLimit && (
                            <div className="mt-1.5 max-w-[200px]">
                              <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    riskEval.level === 'exceeded'
                                      ? 'bg-rose-500'
                                      : riskEval.level === 'warning'
                                      ? 'bg-amber-400'
                                      : 'bg-emerald-400'
                                  }`}
                                  style={{ width: `${Math.min(100, riskEval.percent)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              c.tur === 'alici'
                                ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                                : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                            }`}
                          >
                            {c.tur === 'alici' ? 'Alıcı' : 'Tedarikçi'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-gray-300">{c.vergi_tc_no || '-'}</td>
                        <td className="py-3.5 px-4 text-gray-400">{c.telefon || '-'}</td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <span
                            className={`font-bold text-sm ${
                              bakiye > 0
                                ? 'text-teal-400'
                                : bakiye < 0
                                ? 'text-red-400'
                                : 'text-gray-400'
                            }`}
                          >
                            {formatCurrency(bakiye)}
                          </span>
                          <div className="text-[10px] text-gray-500">
                            {bakiye > 0 ? '(Bize Borçlu)' : bakiye < 0 ? '(Biz Borçluyuz)' : '(Bakiye Sıfır)'}
                          </div>
                        </td>
                        <td
                          className="py-3.5 px-5 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenWhatsAppForCari(c)}
                              data-testid={`cari_wa_btn_${c.id}`}
                              title="WhatsApp Borç / Mutabakat Hatırlat"
                              className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15 rounded-lg transition"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEditModal(c)}
                              title="Düzenle"
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setCariToDelete(c)}
                              title="Sil"
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                            >
                              <Trash2 className="w-4 h-4" />
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
            <div className="md:hidden divide-y divide-white/[0.04]">
              {filteredCariler.map((c) => {
                const bakiye = Number(c.bakiye) || 0;
                const riskLimit = getEffectiveCariRiskLimit(c, effectiveFirmaId);
                const riskEval = evaluateCariRiskStatus({
                  currentBakiye: bakiye,
                  riskLimit,
                });
                return (
                  <div
                    key={c.id}
                    onClick={() => openDetail(c)}
                    className="p-4 hover:bg-white/[0.03] transition cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-bold text-white text-sm">{c.unvan}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              c.tur === 'alici'
                                ? 'bg-teal-500/10 text-teal-400'
                                : 'bg-orange-500/10 text-orange-400'
                            }`}
                          >
                            {c.tur === 'alici' ? 'Alıcı' : 'Tedarikçi'}
                          </span>
                          {c.vergi_tc_no && (
                            <span className="font-mono text-[11px] text-gray-400">{c.vergi_tc_no}</span>
                          )}
                          {riskEval.hasLimit && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                riskEval.level === 'exceeded'
                                  ? 'bg-rose-500/15 text-rose-300'
                                  : riskEval.level === 'warning'
                                  ? 'bg-amber-500/15 text-amber-300'
                                  : 'bg-emerald-500/15 text-emerald-300'
                              }`}
                            >
                              Risk %{riskEval.percent}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <div
                          className={`font-bold text-sm ${
                            bakiye > 0
                              ? 'text-teal-400'
                              : bakiye < 0
                              ? 'text-red-400'
                              : 'text-gray-400'
                          }`}
                        >
                          {formatCurrency(bakiye)}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {bakiye > 0 ? 'Borçlu' : bakiye < 0 ? 'Alacaklı' : '0 ₺'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-white/[0.04]">
                      <div className="flex items-center gap-3">
                        {c.telefon && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {c.telefon}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleOpenWhatsAppForCari(c)}
                          title="WhatsApp Hatırlat"
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300"
                        >
                          <MessageCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditModal(c)}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-gray-400 hover:text-white"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setCariToDelete(c)}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center text-gray-400 hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* CARİ DETAY VE EKSTRE MODALI */}
      {selectedCariForDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[92dvh] flex flex-col shadow-2xl overflow-hidden">
            {/* Başlık */}
            <div className="p-4 sm:p-5 border-b border-white/[0.07] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400">
                  Cari Hesap Ekstresi &amp; Hareketler
                </span>
                <h3 className="text-base sm:text-lg font-bold text-white truncate">
                  {selectedCariForDetail.unvan}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedCariForDetail(null);
                  setPreviewFaturaState(null);
                  setBulkXmlFeedback(null);
                }}
                aria-label="Ekstreyi kapat"
                className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Özet ve Bakiye Kartı */}
            <div className="p-4 sm:p-5 bg-black/20 border-b border-white/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Cari Türü &amp; VKN</div>
                <div className="text-xs font-semibold text-white mt-1 capitalize">
                  {selectedCariForDetail.tur === 'alici' ? 'Alıcı (Müşteri)' : 'Tedarikçi'}
                </div>
                <div className="text-xs text-gray-400 font-mono mt-0.5">
                  {selectedCariForDetail.vergi_tc_no || 'VKN Belirtilmemiş'}
                </div>
              </div>

              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">İletişim Bilgileri</div>
                <div className="text-xs text-white mt-1">{selectedCariForDetail.telefon || '-'}</div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">{selectedCariForDetail.email || '-'}</div>
              </div>

              <div className="sm:text-right">
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Güncel Cari Bakiye</div>
                <div
                  className={`text-xl font-black mt-1 ${
                    Number(selectedCariForDetail.bakiye) > 0
                      ? 'text-teal-400'
                      : Number(selectedCariForDetail.bakiye) < 0
                      ? 'text-red-400'
                      : 'text-gray-400'
                  }`}
                >
                  {formatCurrency(selectedCariForDetail.bakiye)}
                </div>
                <div className="text-[10px] text-gray-500">
                  {Number(selectedCariForDetail.bakiye) > 0
                    ? '+ Cari Bize Borçlu (B)'
                    : Number(selectedCariForDetail.bakiye) < 0
                    ? '- Biz Borçluyuz (A)'
                    : 'Bakiye Sıfır'}
                </div>
              </div>
            </div>

            {/* RİSK LİMİTİ VE BAKİYE DOĞRULAMA ÇUBUĞU */}
            {(() => {
              const limit = getEffectiveCariRiskLimit(selectedCariForDetail, effectiveFirmaId);
              const riskEval = limit
                ? evaluateCariRiskStatus({
                    currentBakiye: Number(selectedCariForDetail.bakiye) || 0,
                    riskLimit: limit,
                  })
                : null;
              if (!riskEval && !detailBalanceVerification) return null;
              return (
                <div className="px-4 sm:px-5 py-3 border-b border-white/[0.06] bg-[#0d141c] flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                  {riskEval && (
                    <div className="flex-1 space-y-1.5 min-w-[220px]">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-bold text-slate-300 flex items-center gap-1.5">
                          <ShieldAlert
                            className={`w-3.5 h-3.5 ${
                              riskEval.level === 'exceeded'
                                ? 'text-rose-400'
                                : riskEval.level === 'warning'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          />
                          <span>Risk Limiti: {formatCurrency(riskEval.riskLimit)}</span>
                        </span>
                        <span
                          className={`font-bold ${
                            riskEval.level === 'exceeded'
                              ? 'text-rose-300'
                              : riskEval.level === 'warning'
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                          }`}
                        >
                          %{riskEval.percent} Kullanıldı (Kalan: {formatCurrency(riskEval.remainingLimit)})
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            riskEval.level === 'exceeded'
                              ? 'bg-rose-500'
                              : riskEval.level === 'warning'
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          }`}
                          style={{ width: `${Math.min(100, riskEval.percent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {detailBalanceVerification && (
                    <div
                      data-testid="ekstre_balance_verification_strip"
                      className={`px-3 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 ${
                        detailBalanceVerification.hasDiscrepancy
                          ? 'bg-amber-500/10 border-amber-500/35 text-amber-200'
                          : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[11px]">
                        {detailBalanceVerification.hasDiscrepancy ? (
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        {detailBalanceVerification.hasDiscrepancy ? (
                          <span>
                            Sapma tespit edildi: Kayıtlı{' '}
                            <strong>{formatCurrency(detailBalanceVerification.recordedBakiye)}</strong> ·
                            Hesaplanan{' '}
                            <strong>{formatCurrency(detailBalanceVerification.calculatedBakiye)}</strong>
                          </span>
                        ) : (
                          <span className="font-semibold">
                            Bakiye Doğrulandı (Ekstre = {formatCurrency(detailBalanceVerification.calculatedBakiye)})
                          </span>
                        )}
                      </div>
                      {detailBalanceVerification.hasDiscrepancy && (
                        <button
                          type="button"
                          disabled={syncingDetailBalance}
                          onClick={() => void handleSyncDetailBalance()}
                          data-testid="ekstre_sync_balance_btn"
                          className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-extrabold text-[11px] transition"
                        >
                          {syncingDetailBalance ? 'Eşitleniyor...' : 'Bakiyeyi Eşitle'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {detailVerifyFeedback && (
              <div className="mx-4 sm:mx-5 mt-3 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                {detailVerifyFeedback}
              </div>
            )}

            {/* Hızlı Aksiyon & Dışa Aktarma Butonları */}
            <div className="px-4 sm:px-5 py-3 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2.5 bg-black/10">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const cid = selectedCariForDetail.id;
                    setSelectedCariForDetail(null);
                    onNavigate('tahsilat', { cariId: cid });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-teal-400 text-[#0a0e13] font-bold text-xs flex items-center gap-1.5 hover:bg-teal-300 transition"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Tahsilat Gir</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cid = selectedCariForDetail.id;
                    setSelectedCariForDetail(null);
                    onNavigate('tediye', { cariId: cid });
                  }}
                  className="px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold text-xs flex items-center gap-1.5 hover:bg-orange-500/30 transition"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Tediye Gir</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenWhatsAppForCari(selectedCariForDetail)}
                  data-testid="ekstre_whatsapp_reminder_btn"
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 font-bold text-xs flex items-center gap-1.5 hover:bg-emerald-500/30 transition"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>WhatsApp Borç Hatırlat</span>
                </button>
                {isWebPlatform() && profile?.rol !== 'plasiyer' && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualFaturaInitialCari(selectedCariForDetail);
                      setManualFaturaLockCari(true);
                      setIsManualFaturaOpen(true);
                    }}
                    data-testid="ekstre_manual_fatura_btn"
                    className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-200 border border-indigo-400/35 font-bold text-xs flex items-center gap-1.5 hover:bg-indigo-500/30 transition"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>+ Alış / Satış Faturası</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsMutabakatModalOpen(true)}
                  data-testid="ekstre_mutabakat_modal_btn"
                  className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/35 font-bold text-xs flex items-center gap-1.5 hover:bg-purple-500/30 transition"
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Mutabakat PDF &amp; Link</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canPreviewUblInvoice && (
                  <>
                    <input
                      ref={bulkXmlInputRef}
                      type="file"
                      accept=".xml,.ubl,text/xml,application/xml"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleBulkXmlMatch(e.target.files);
                      }}
                    />
                    <button
                      type="button"
                      data-testid="ekstre_bulk_xml_match_btn"
                      disabled={bulkXmlSyncing}
                      onClick={() => bulkXmlInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs font-semibold flex items-center gap-1.5 border border-blue-500/30 transition disabled:opacity-50"
                      title="Eski faturalar için XML / UBL dosyalarını tekrar kayıt oluşturmadan toplu eşleştir (Sadece Web)"
                    >
                      {bulkXmlSyncing ? (
                        <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 text-blue-400" />
                      )}
                      <span>{bulkXmlSyncing ? 'Eşleştiriliyor...' : 'Toplu XML Eşleştir'}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  data-testid="ekstre_export_excel_btn"
                  onClick={handleExportCariEkstresiExcel}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 border border-emerald-500/30 transition"
                  title="Excel (CSV) Olarak İndir"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Excel&apos;e Aktar</span>
                </button>
                <button
                  type="button"
                  data-testid="ekstre_export_pdf_btn"
                  onClick={handleExportCariEkstresiPdf}
                  className="px-3 py-1.5 rounded-lg bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 text-xs font-semibold flex items-center gap-1.5 border border-teal-500/30 transition"
                  title="A4 PDF Ekstre Yazdır / Paylaş"
                >
                  <Printer className="w-3.5 h-3.5 text-teal-400" />
                  <span>PDF Ekstre</span>
                </button>
              </div>
            </div>

            {canPreviewUblInvoice && bulkXmlFeedback && (
              <div
                className={`mx-4 sm:mx-5 mt-3 px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                  bulkXmlFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {bulkXmlFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  )}
                  <span className="leading-snug">{bulkXmlFeedback.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkXmlFeedback(null)}
                  aria-label="Bildirimi kapat"
                  className="text-gray-400 hover:text-white shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Tarih Aralığı Çekme & Dönem Özeti */}
            <div className="px-4 sm:px-5 py-3 border-b border-white/[0.06] bg-[#0d141c] space-y-2.5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5">
                    <label
                      htmlFor="ekstre-start-date"
                      className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1"
                    >
                      <Calendar className="w-3 h-3 text-teal-400" />
                      <span>Başlangıç</span>
                    </label>
                    <input
                      id="ekstre-start-date"
                      data-testid="ekstre_start_date"
                      type="date"
                      value={detailStartDate}
                      onChange={(e) => setDetailStartDate(e.target.value)}
                      className="bg-[#0a0e13] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5">
                    <label
                      htmlFor="ekstre-end-date"
                      className="text-[10px] font-bold uppercase tracking-wider text-gray-400"
                    >
                      Bitiş
                    </label>
                    <input
                      id="ekstre-end-date"
                      data-testid="ekstre_end_date"
                      type="date"
                      value={detailEndDate}
                      onChange={(e) => setDetailEndDate(e.target.value)}
                      className="bg-[#0a0e13] border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyEkstreQuickRange('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                      !detailStartDate && !detailEndDate
                        ? 'bg-teal-400 text-[#0a0e13] border-teal-400'
                        : 'bg-black/30 text-gray-300 border-white/10 hover:bg-white/5'
                    }`}
                  >
                    Tümü
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEkstreQuickRange('this_month')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-black/30 text-gray-300 border border-white/10 hover:bg-white/5 transition"
                  >
                    Bu Ay
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEkstreQuickRange('last_30')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-black/30 text-gray-300 border border-white/10 hover:bg-white/5 transition"
                  >
                    Son 30 Gün
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEkstreQuickRange('this_year')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-black/30 text-gray-300 border border-white/10 hover:bg-white/5 transition"
                  >
                    Bu Yıl
                  </button>
                </div>
              </div>

              {isDateRangeInvalid && (
                <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5">
                  Başlangıç tarihi bitiş tarihinden büyük olamaz. Lütfen tarih aralığını düzeltiniz.
                </div>
              )}

              {/* Dönem Borç / Alacak / Bakiye Özeti */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="px-2.5 py-2 rounded-xl bg-black/30 border border-white/[0.06]">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Dönem Borç</div>
                  <div className="text-xs sm:text-sm font-mono font-bold text-rose-300 mt-0.5">
                    {formatCurrency(ekstreResult.summary.totalBorc)}
                  </div>
                </div>
                <div className="px-2.5 py-2 rounded-xl bg-black/30 border border-white/[0.06]">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Dönem Alacak</div>
                  <div className="text-xs sm:text-sm font-mono font-bold text-emerald-300 mt-0.5">
                    {formatCurrency(ekstreResult.summary.totalAlacak)}
                  </div>
                </div>
                <div className="px-2.5 py-2 rounded-xl bg-black/30 border border-white/[0.06]">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">
                    {detailStartDate || detailEndDate ? 'Dönem Bakiye' : 'Net Bakiye'}
                  </div>
                  <div
                    className={`text-xs sm:text-sm font-mono font-black mt-0.5 ${
                      ekstreResult.summary.closingBalance > 0
                        ? 'text-teal-300'
                        : ekstreResult.summary.closingBalance < 0
                        ? 'text-red-300'
                        : 'text-gray-300'
                    }`}
                  >
                    {formatEkstreBakiye(ekstreResult.summary.closingBalance)}
                  </div>
                </div>
              </div>
            </div>

            {/* Hareketler Listesi (Kronolojik: Eski -> Yeni, Aynı Günde Fatura Üstte) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Hesap Ekstresi ({ekstrePeriodLabel})
                </h4>
                <span className="text-[11px] text-gray-500">
                  Tarih sıralı • Aynı günde fatura üstte, ödeme altta
                </span>
              </div>

              {loadingDetail ? (
                <div className="py-8 text-center text-xs text-gray-400">Hareketler yükleniyor...</div>
              ) : ekstreResult.rows.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-500">
                  Seçili tarih aralığında bu cariye ait işlem veya fatura hareketi bulunmuyor.
                </div>
              ) : (
                <>
                  {/* MASAÜSTÜ & TABLET TABLOSU */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-gray-400 text-[10px] uppercase font-semibold">
                          <th className="py-2 pr-2 w-[1%] whitespace-nowrap">Tarih</th>
                          <th className="py-2 pr-2 w-[1%] whitespace-nowrap">Belge No</th>
                          <th className="py-2 pr-2 w-[1%] whitespace-nowrap">İşlem Türü</th>
                          <th className="py-2 pr-3">Açıklama / İşlemi Yapan</th>
                          <th className="py-2 px-1.5 w-[1%] text-right whitespace-nowrap">Borç</th>
                          <th className="py-2 px-1.5 w-[1%] text-right whitespace-nowrap">Alacak</th>
                          <th className="py-2 px-1.5 w-[1%] text-right whitespace-nowrap">Bakiye</th>
                          <th className="py-2 pl-2 w-[1%] text-right whitespace-nowrap">İşlem</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {ekstreResult.rows.map((r) => {
                          const badgeClass = r.isOpeningRow
                            ? 'bg-slate-500/20 text-slate-200 border border-slate-400/30'
                            : r.isInvoice
                            ? 'bg-blue-500/15 text-blue-300 border border-blue-500/25'
                            : r.rawTip === 'tahsilat'
                            ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                            : 'bg-orange-500/10 text-orange-400 border border-orange-500/20';

                          return (
                            <tr
                              key={r.key}
                              className={
                                r.isOpeningRow
                                  ? 'bg-white/[0.03] font-semibold'
                                  : 'hover:bg-white/[0.02]'
                              }
                            >
                              <td className="py-2 pr-2 text-[11px] text-gray-300 whitespace-nowrap align-top">
                                {r.formattedDate}
                              </td>
                              <td className="py-2 pr-2 text-[11px] font-mono text-teal-400 whitespace-nowrap align-top">
                                {r.belgeNo}
                              </td>
                              <td className="py-2 pr-2 whitespace-nowrap align-top">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase ${badgeClass}`}
                                >
                                  {r.tipLabel}
                                </span>
                              </td>
                              <td className="py-2 pr-3 min-w-[200px] align-top">
                                <div className="text-[11px] text-gray-200 leading-snug break-words">
                                  {r.aciklama}
                                </div>
                                {r.yapan && r.yapan !== '-' && (
                                  <div className="text-[10px] text-gray-500 mt-0.5">
                                    İşlemi Yapan: <span className="text-gray-400 font-medium">{r.yapan}</span>
                                  </div>
                                )}
                              </td>
                              <td
                                className={`py-2 px-1.5 text-right font-mono tabular-nums text-[10.5px] font-bold whitespace-nowrap align-top ${
                                  r.isCancelled
                                    ? 'line-through text-gray-500'
                                    : r.borc > 0
                                    ? 'text-rose-300'
                                    : 'text-gray-600'
                                }`}
                              >
                                {r.borc > 0 ? formatCurrency(r.borc) : '-'}
                              </td>
                              <td
                                className={`py-2 px-1.5 text-right font-mono tabular-nums text-[10.5px] font-bold whitespace-nowrap align-top ${
                                  r.isCancelled
                                    ? 'line-through text-gray-500'
                                    : r.alacak > 0
                                    ? 'text-emerald-300'
                                    : 'text-gray-600'
                                }`}
                              >
                                {r.alacak > 0 ? formatCurrency(r.alacak) : '-'}
                              </td>
                              <td
                                className={`py-2 px-1.5 text-right font-mono tabular-nums text-[10.5px] font-black whitespace-nowrap align-top ${
                                  r.bakiye > 0
                                    ? 'text-teal-300'
                                    : r.bakiye < 0
                                    ? 'text-red-300'
                                    : 'text-gray-400'
                                }`}
                              >
                                {formatEkstreBakiye(r.bakiye)}
                              </td>
                              <td className="py-2 pl-2 text-right whitespace-nowrap align-top">
                                {r.isPayment && !r.isOpeningRow && r.rawMovement && onOpenMakbuz ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onOpenMakbuz({
                                        ...(r.rawMovement as Islem),
                                        cariler: selectedCariForDetail,
                                      });
                                    }}
                                    className="px-2 py-1 rounded-lg bg-teal-500/15 hover:bg-teal-500/30 text-teal-300 border border-teal-500/30 text-[10.5px] font-bold inline-flex items-center gap-1 transition"
                                    title="Makbuzu Görüntüle ve Yazdır / Paylaş"
                                  >
                                    <ExternalLink className="w-3 h-3 text-teal-400" />
                                    <span>Makbuz</span>
                                  </button>
                                ) : r.isInvoice && !r.isOpeningRow && r.rawMovement ? (
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    {canPreviewUblInvoice && (
                                      <button
                                        type="button"
                                        data-testid="ekstre_view_invoice_btn"
                                        onClick={() => {
                                          void handleOpenFaturaPreview(r);
                                        }}
                                        className="px-2 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 text-[10.5px] font-bold inline-flex items-center gap-1 transition"
                                        title="Fatura Görüntüsünü Aç (Sadece Web)"
                                      >
                                        <Eye className="w-3 h-3 text-blue-400" />
                                        <span>Fatura</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      data-testid="ekstre_delete_invoice_btn"
                                      onClick={() => setFaturaToDelete(r.rawMovement as Fatura)}
                                      className="px-2 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-[10.5px] font-bold inline-flex items-center gap-1 transition"
                                      title="Faturayı Sil"
                                    >
                                      <Trash2 className="w-3 h-3 text-red-400" />
                                      <span>Sil</span>
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-gray-500 text-[10px]">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* MOBİL KART GÖRÜNÜMÜ */}
                  <div className="md:hidden space-y-2.5">
                    {ekstreResult.rows.map((r) => {
                      const badgeClass = r.isOpeningRow
                        ? 'bg-slate-500/20 text-slate-200 border border-slate-400/30'
                        : r.isInvoice
                        ? 'bg-blue-500/15 text-blue-300 border border-blue-500/25'
                        : r.rawTip === 'tahsilat'
                        ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                        : 'bg-orange-500/10 text-orange-400 border border-orange-500/20';

                      return (
                        <div
                          key={r.key}
                          className={`p-3 rounded-xl border ${
                            r.isOpeningRow
                              ? 'bg-white/[0.04] border-white/15'
                              : 'bg-black/25 border-white/[0.07]'
                          } space-y-2`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] text-gray-300 font-semibold">
                                  {r.formattedDate}
                                </span>
                                <span className="font-mono text-[11px] text-teal-400">
                                  {r.belgeNo}
                                </span>
                              </div>
                              <div className="mt-1">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badgeClass}`}
                                >
                                  {r.tipLabel}
                                </span>
                              </div>
                            </div>

                            {r.isPayment && !r.isOpeningRow && r.rawMovement && onOpenMakbuz ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenMakbuz({
                                    ...(r.rawMovement as Islem),
                                    cariler: selectedCariForDetail,
                                  });
                                }}
                                className="px-2.5 py-1 rounded-lg bg-teal-500/15 text-teal-300 border border-teal-500/30 text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Makbuz</span>
                              </button>
                            ) : r.isInvoice && !r.isOpeningRow && r.rawMovement ? (
                              <div className="inline-flex items-center gap-1.5 shrink-0">
                                {canPreviewUblInvoice && (
                                  <button
                                    type="button"
                                    data-testid="ekstre_view_invoice_btn_mobile"
                                    onClick={() => {
                                      void handleOpenFaturaPreview(r);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Fatura</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  data-testid="ekstre_delete_invoice_btn_mobile"
                                  onClick={() => setFaturaToDelete(r.rawMovement as Fatura)}
                                  className="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                                  title="Faturayı Sil"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Sil</span>
                                </button>
                              </div>
                            ) : null}
                          </div>

                          {r.aciklama && r.aciklama !== '-' && (
                            <div className="text-[11px] text-gray-300 leading-snug break-words">
                              {r.aciklama}
                            </div>
                          )}

                          {r.yapan && r.yapan !== '-' && (
                            <div className="text-[10px] text-gray-500">
                              İşlemi Yapan: <span className="text-gray-400 font-medium">{r.yapan}</span>
                            </div>
                          )}

                          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-white/[0.06] text-[10.5px]">
                            <div>
                              <div className="text-[9px] uppercase text-gray-500 font-semibold">Borç</div>
                              <div
                                className={`font-mono tabular-nums font-bold ${
                                  r.isCancelled
                                    ? 'line-through text-gray-500'
                                    : r.borc > 0
                                    ? 'text-rose-300'
                                    : 'text-gray-500'
                                }`}
                              >
                                {r.borc > 0 ? formatCurrency(r.borc) : '-'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase text-gray-500 font-semibold">Alacak</div>
                              <div
                                className={`font-mono tabular-nums font-bold ${
                                  r.isCancelled
                                    ? 'line-through text-gray-500'
                                    : r.alacak > 0
                                    ? 'text-emerald-300'
                                    : 'text-gray-500'
                                }`}
                              >
                                {r.alacak > 0 ? formatCurrency(r.alacak) : '-'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[9px] uppercase text-gray-500 font-semibold">Bakiye</div>
                              <div
                                className={`font-mono tabular-nums font-black ${
                                  r.bakiye > 0
                                    ? 'text-teal-300'
                                    : r.bakiye < 0
                                    ? 'text-red-300'
                                    : 'text-gray-400'
                                }`}
                              >
                                {formatEkstreBakiye(r.bakiye)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EKLE / DÜZENLE MODALI */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.07] mb-4">
              <h3 className="font-bold text-white text-base">
                {editingCari ? 'Cari Kartını Düzenle' : 'Yeni Cari Kartı Oluştur'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCari} className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-300 font-semibold mb-1">Cari Türü *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormTur('alici')}
                    className={`py-2 rounded-xl border text-center font-bold transition ${
                      formTur === 'alici'
                        ? 'bg-teal-400 text-[#0a0e13] border-teal-400 shadow-sm'
                        : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    Alıcı (Müşteri)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormTur('tedarikci')}
                    className={`py-2 rounded-xl border text-center font-bold transition ${
                      formTur === 'tedarikci'
                        ? 'bg-orange-500 text-[#0a0e13] border-orange-500 shadow-sm'
                        : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    Tedarikçi (Satıcı)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-gray-300 font-semibold mb-1">Cari Unvanı *</label>
                <input
                  type="text"
                  required
                  value={formUnvan}
                  onChange={(e) => setFormUnvan(e.target.value)}
                  placeholder="Örn: Atlas Dağıtım Pazarlama A.Ş."
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-semibold mb-1">Vergi No / TCKN</label>
                <input
                  type="text"
                  value={formVergiTcNo}
                  onChange={(e) => setFormVergiTcNo(e.target.value)}
                  placeholder="10 haneli VKN veya 11 haneli TCKN"
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-300 font-semibold mb-1">Telefon</label>
                  <input
                    type="tel"
                    value={formTelefon}
                    onChange={(e) => setFormTelefon(e.target.value)}
                    placeholder="05XX XXX XX XX"
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-semibold mb-1">E-posta</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="muhasebe@cari.com"
                    className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-300 font-semibold mb-1">
                  Risk Limiti (₺ - Opsiyonel)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formRiskLimiti}
                  onChange={(e) => setFormRiskLimiti(e.target.value)}
                  data-testid="cari_risk_limit_input"
                  placeholder="Örn: 100000 (Boş bırakılırsa limit uygulanmaz)"
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 font-semibold transition"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold shadow-[0_0_15px_rgba(45,212,191,0.25)] transition disabled:opacity-50"
                >
                  {formLoading ? 'Kaydediliyor...' : editingCari ? 'Güncelle' : 'Cariyi Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CARİ SİLME ONAY MODALI (Bağlı fatura & işlem kontrolü + RLS SQL desteği) */}
      <DeleteCariConfirmModal
        cari={cariToDelete}
        onClose={() => setCariToDelete(null)}
        onDeleted={async (deletedCariId) => {
          if (selectedCariForDetail?.id === deletedCariId) {
            setSelectedCariForDetail(null);
          }
          await fetchCariler();
        }}
      />

      {/* FATURA SİLME ONAY MODALI */}
      <DeleteFaturaConfirmModal
        fatura={faturaToDelete}
        cariUnvan={selectedCariForDetail?.unvan}
        onClose={() => setFaturaToDelete(null)}
        onDeleted={async () => {
          await fetchCariler();
          if (selectedCariForDetail) {
            await openDetail(selectedCariForDetail);
          }
        }}
      />

      {/* SADECE WEB: UBL / XML / ZIP FATURA YÜKLEME MODALI */}
      {isWebPlatform() && (
        <UblImportModal
          isOpen={isUblModalOpen && entitlements.canUseUblImport}
          onClose={() => setIsUblModalOpen(false)}
          cariler={cariler}
          onImported={fetchCariler}
        />
      )}

      {/* SADECE WEB (TÜM PAKETLER): ELLE ALIŞ / SATIŞ FATURASI MODALI */}
      {isWebPlatform() && (
        <ManualFaturaModal
          isOpen={isManualFaturaOpen}
          onClose={() => setIsManualFaturaOpen(false)}
          cariler={cariler}
          initialCari={manualFaturaInitialCari}
          lockCari={manualFaturaLockCari}
          initialYon={
            manualFaturaInitialCari?.tur === 'tedarikci' ? 'alis' : 'satis'
          }
          defaultSyncToKasa={false}
          onSaved={async () => {
            await fetchCariler();
            if (selectedCariForDetail) {
              await openDetail(selectedCariForDetail);
            }
          }}
        />
      )}

      {/* CARİ MUTABAKAT A4 PDF VE ONLINE ONAY LİNKİ MODALI */}
      <MutabakatMektubuModal
        isOpen={isMutabakatModalOpen}
        onClose={() => setIsMutabakatModalOpen(false)}
        cari={selectedCariForDetail}
        movements={detailMovements}
        initialEndDate={detailEndDate || undefined}
        onPreviewLink={onPreviewMutabakatLink}
      />

      {/* SADECE WEB: EXCEL / CSV TOPLU CARİ YÜKLEME MODALI */}
      {isWebPlatform() && (
        <CariExcelImportModal
          isOpen={isExcelImportModalOpen}
          onClose={() => setIsExcelImportModalOpen(false)}
          cariler={cariler}
          onImported={fetchCariler}
        />
      )}

      {/* SADECE WEB: UBL / e-FATURA GÖRSEL ÖNİZLEME MODALI */}
      {canPreviewUblInvoice && previewFaturaState && (
        <UblInvoicePreviewModal
          isOpen={Boolean(previewFaturaState)}
          invoice={previewFaturaState.invoice}
          yon={previewFaturaState.yon}
          isSummaryFallback={previewFaturaState.isSummaryFallback}
          firmaVergiNo={firma?.vergi_no}
          onClose={() => setPreviewFaturaState(null)}
          onDelete={
            previewFaturaState.sourceFatura
              ? () => {
                  const target = previewFaturaState.sourceFatura!;
                  setPreviewFaturaState(null);
                  setFaturaToDelete(target);
                }
              : undefined
          }
          onXmlAttached={async (parsed) => {
            const targetYon = previewFaturaState.yon;
            if (effectiveFirmaId) {
              const items = [{ yon: targetYon, parsed }];
              await saveUblInvoiceSnapshotsAsync(effectiveFirmaId, items);
              void syncUblDetayToSupabase(effectiveFirmaId, items);
            }
            setPreviewFaturaState({
              invoice: parsed,
              yon: targetYon,
              isSummaryFallback: false,
              sourceFatura: previewFaturaState.sourceFatura,
            });
          }}
        />
      )}

      {/* FİRMA GENELİ BAKİYE DOĞRULAMA & ONARIM MODALI */}
      {isAuditModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="cariler_audit_modal"
        >
          <div className="bg-[#111820] border border-white/15 rounded-2xl w-full max-w-3xl max-h-[88dvh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/[0.07] flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                  Otomatik Mutabakat Denetimi
                </div>
                <h3 className="text-base font-extrabold text-white">
                  Cari Bakiye Doğrulama &amp; Onarım
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAuditModalOpen(false)}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-3 text-xs">
              {auditLoading ? (
                <div className="py-10 text-center text-slate-400">
                  Tüm fatura ve makbuz hareketleri carilerle karşılaştırılıyor...
                </div>
              ) : auditResults.length === 0 ? (
                <div className="py-10 text-center text-slate-400">Denetlenecek cari bulunamadı.</div>
              ) : (
                <>
                  {(() => {
                    const mismatches = auditResults.filter((r) => r.hasDiscrepancy);
                    return (
                      <div
                        className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                          mismatches.length > 0
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        }`}
                      >
                        <span className="font-bold">
                          {mismatches.length > 0
                            ? `${mismatches.length} caride kayıtlı bakiye ile hareket toplamı arasında sapma bulundu.`
                            : `Tüm cariler (${auditResults.length}) hareket toplamlarıyla %100 uyumlu.`}
                        </span>
                        {mismatches.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleSyncAllDiscrepancies()}
                            data-testid="audit_sync_all_btn"
                            className="px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-[11px]"
                          >
                            Tüm Sapmaları Eşitle ({mismatches.length})
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-xl overflow-hidden">
                    {auditResults.map((row) => (
                      <div
                        key={row.cariId}
                        className="p-3 bg-black/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>{row.cariUnvan}</span>
                            {row.hasDiscrepancy ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">
                                Sapma: {formatCurrency(row.diff)}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300">
                                Uyumlu
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                            Kayıtlı: {formatCurrency(row.recordedBakiye)} · Hesaplanan:{' '}
                            {formatCurrency(row.calculatedBakiye)} ({row.faturaCount} Fatura,{' '}
                            {row.islemCount} İşlem)
                          </div>
                        </div>

                        {row.hasDiscrepancy && (
                          <button
                            type="button"
                            disabled={syncingAuditCariId === row.cariId}
                            onClick={() => void handleSyncAuditRow(row)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-slate-950 font-extrabold text-[11px] shrink-0"
                          >
                            {syncingAuditCariId === row.cariId ? 'Eşitleniyor...' : 'Bakiyeyi Eşitle'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* WHATSAPP BORÇ / MUTABAKAT HATIRLATMA MODALI */}
      <WhatsAppReminderModal
        isOpen={Boolean(waCariTarget)}
        onClose={() => setWaCariTarget(null)}
        title={`Cari Bakiye Hatırlatma: ${waCariTarget?.cari.unvan || ''}`}
        subtitle={`Güncel Bakiye: ${formatCurrency(Number(waCariTarget?.cari.bakiye) || 0)}`}
        initialPhone={waCariTarget?.cari.telefon}
        defaultMessage={waCariTarget?.defaultMessage || ''}
        badgeText="Cari Hatırlatma"
      />
    </div>
  );
};
