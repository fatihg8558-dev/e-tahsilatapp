import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  X,
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  FileWarning,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import { Cari, CariTur } from '../../types/database';
import { formatCurrency } from '../../lib/formatters';
import { isWebPlatform } from '../../lib/platform';
import {
  autoDetectCariColumnMapping,
  CariColumnMapping,
  CariImportField,
  downloadCariExcelTemplate,
  evaluateCariImportRows,
  ExistingCariAction,
  exportCariImportErrorReport,
  ParsedCariImportRow,
  readCariSpreadsheetBuffer,
} from '../../lib/cariExcelImport';

interface CariExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cariler: Cari[];
  onImported: () => Promise<void> | void;
}

const FIELD_META: Array<{ key: CariImportField; label: string; required?: boolean }> = [
  { key: 'unvan', label: 'Cari Unvanı', required: true },
  { key: 'vergi_tc_no', label: 'VKN / TCKN' },
  { key: 'tur', label: 'Cari Türü (Alıcı / Tedarikçi)' },
  { key: 'telefon', label: 'Telefon' },
  { key: 'email', label: 'E-posta' },
  { key: 'bakiye', label: 'Açılış Bakiyesi' },
];

export const CariExcelImportModal: React.FC<CariExcelImportModalProps> = ({
  isOpen,
  onClose,
  cariler,
  onImported,
}) => {
  const { firma, profile, isPeriodExpired } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id || '';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<CariColumnMapping>({
    unvan: null,
    vergi_tc_no: null,
    tur: null,
    telefon: null,
    email: null,
    bakiye: null,
  });
  const [defaultTur, setDefaultTur] = useState<CariTur>('alici');
  const [updateBakiyeOnExisting, setUpdateBakiyeOnExisting] = useState<boolean>(false);
  const [rowOverrides, setRowOverrides] = useState<
    Record<number, { include?: boolean; existingAction?: ExistingCariAction }>
  >({});
  const [activeFilter, setActiveFilter] = useState<'all' | 'new' | 'existing' | 'error'>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setFileName('');
      setHeaders([]);
      setRawRows([]);
      setRowOverrides({});
      setActiveFilter('all');
      setFeedback(null);
      setIsDragging(false);
    }
  }, [isOpen]);

  const evaluatedRows = useMemo<ParsedCariImportRow[]>(() => {
    if (rawRows.length === 0) return [];
    const base = evaluateCariImportRows({
      rawRows,
      mapping,
      existingCariler: cariler,
      defaultTur,
    });
    return base.map((r) => {
      const ov = rowOverrides[r.rowIndex];
      if (!ov) return r;
      const nextAction = ov.existingAction ?? r.existingAction;
      let nextInclude = ov.include ?? r.include;
      if (r.status === 'error') {
        nextInclude = false;
      } else if (r.status === 'existing_vkn' && ov.existingAction !== undefined && ov.include === undefined) {
        nextInclude = nextAction === 'update';
      }
      return {
        ...r,
        existingAction: nextAction,
        include: nextInclude,
      };
    });
  }, [rawRows, mapping, cariler, defaultTur, rowOverrides]);

  const stats = useMemo(() => {
    const newValid = evaluatedRows.filter((r) => r.status === 'valid_new');
    const existing = evaluatedRows.filter((r) => r.status === 'existing_vkn');
    const errors = evaluatedRows.filter((r) => r.status === 'error');
    const toInsert = newValid.filter((r) => r.include);
    const toUpdate = existing.filter((r) => r.include && r.existingAction === 'update');
    return {
      total: evaluatedRows.length,
      newValidCount: newValid.length,
      existingCount: existing.length,
      errorCount: errors.length,
      toInsertCount: toInsert.length,
      toUpdateCount: toUpdate.length,
      errorRows: errors,
    };
  }, [evaluatedRows]);

  const visibleRows = useMemo(() => {
    if (activeFilter === 'new') return evaluatedRows.filter((r) => r.status === 'valid_new');
    if (activeFilter === 'existing') return evaluatedRows.filter((r) => r.status === 'existing_vkn');
    if (activeFilter === 'error') return evaluatedRows.filter((r) => r.status === 'error');
    return evaluatedRows;
  }, [evaluatedRows, activeFilter]);

  if (!isOpen || !isWebPlatform()) return null;

  const handleFileSelected = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      setFeedback({
        type: 'error',
        text: 'Lütfen yalnızca .xlsx, .xls veya .csv uzantılı Excel dosyası seçiniz.',
      });
      return;
    }

    setParsing(true);
    setFeedback(null);
    setRowOverrides({});

    try {
      const buffer = await file.arrayBuffer();
      const { headers: parsedHeaders, rows: parsedRows } = readCariSpreadsheetBuffer(buffer, file.name);
      if (parsedHeaders.length === 0 || parsedRows.length === 0) {
        setFeedback({
          type: 'error',
          text: 'Dosya boş görünüyor veya okunabilir veri satırı bulunamadı.',
        });
        setFileName('');
        setHeaders([]);
        setRawRows([]);
        return;
      }

      setFileName(file.name);
      setHeaders(parsedHeaders);
      setRawRows(parsedRows);
      setMapping(autoDetectCariColumnMapping(parsedHeaders));
      setActiveFilter('all');
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Excel dosyası okunurken bir hata oluştu.',
      });
    } finally {
      setParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleBulkExistingAction = (action: ExistingCariAction) => {
    setRowOverrides((prev) => {
      const next = { ...prev };
      evaluatedRows.forEach((r) => {
        if (r.status === 'existing_vkn') {
          next[r.rowIndex] = {
            ...next[r.rowIndex],
            existingAction: action,
            include: action === 'update',
          };
        }
      });
      return next;
    });
  };

  const handleImportSubmit = async () => {
    if (!effectiveFirmaId) return;
    if (isPeriodExpired) {
      setFeedback({
        type: 'error',
        text: 'Firma abonelik veya deneme süreniz dolmuş görünüyor.',
      });
      return;
    }

    if (!mapping.unvan) {
      setFeedback({
        type: 'error',
        text: 'Lütfen eşleştirme alanından "Cari Unvanı" sütununu seçiniz.',
      });
      return;
    }

    const insertRows = evaluatedRows.filter((r) => r.status === 'valid_new' && r.include);
    const updateRows = evaluatedRows.filter(
      (r) => r.status === 'existing_vkn' && r.include && r.existingAction === 'update' && r.matchedExistingCari
    );

    if (insertRows.length === 0 && updateRows.length === 0) {
      setFeedback({
        type: 'error',
        text: 'İçe aktarılacak veya güncellenecek geçerli satır bulunamadı.',
      });
      return;
    }

    setImporting(true);
    setFeedback(null);

    try {
      let insertedCount = 0;
      let updatedCount = 0;

      // 1. Yeni carileri 100'erli paketler halinde ekle
      const payloads = insertRows.map((r) => ({
        firma_id: effectiveFirmaId,
        unvan: r.unvan,
        vergi_tc_no: r.vergiTcNo || null,
        tur: r.tur,
        telefon: r.telefon || null,
        email: r.email || null,
        bakiye: Math.round((Number(r.bakiye) || 0) * 100) / 100,
      }));

      for (let i = 0; i < payloads.length; i += 100) {
        const chunk = payloads.slice(i, i + 100);
        const { error: insertErr } = await supabase.from('cariler').insert(chunk);
        if (insertErr) throw insertErr;
        insertedCount += chunk.length;
      }

      // 2. Güncellenmesi seçilen mevcut carileri güncelle
      for (const r of updateRows) {
        const target = r.matchedExistingCari!;
        const updatePayload: Record<string, unknown> = {
          unvan: r.unvan || target.unvan,
          tur: r.tur,
          telefon: r.telefon || target.telefon || null,
          email: r.email || target.email || null,
        };
        if (r.vergiTcNo) {
          updatePayload.vergi_tc_no = r.vergiTcNo;
        }
        if (updateBakiyeOnExisting) {
          updatePayload.bakiye = Math.round((Number(r.bakiye) || 0) * 100) / 100;
        }
        const { error: updErr } = await supabase
          .from('cariler')
          .update(updatePayload)
          .eq('id', target.id)
          .eq('firma_id', effectiveFirmaId);
        if (updErr) throw updErr;
        updatedCount++;
      }

      await onImported();

      const skippedErrorCount = stats.errorCount;
      setFeedback({
        type: 'success',
        text: `Excel aktarımı tamamlandı: ${insertedCount} yeni cari eklendi${
          updatedCount > 0 ? `, ${updatedCount} mevcut cari güncellendi` : ''
        }${skippedErrorCount > 0 ? ` (${skippedErrorCount} hatalı satır atlandı)` : ''}.`,
      });
      setRawRows([]);
      setHeaders([]);
      setFileName('');
      setRowOverrides({});
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        text: handleSupabaseError(err, 'Cariler Excel’den yüklenirken bir hata oluştu.', {
          isFirmaUnlimited: Boolean(firma?.sinirsiz),
        }),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      data-testid="cari_excel_import_modal"
    >
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[92dvh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* BAŞLIK */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 bg-black/25">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                Excel / CSV ile Toplu Cari Yükleme (Web)
              </h3>
              <p className="text-xs text-gray-400">
                .xlsx, .xls veya .csv dosyalarından sütun eşleştirme ve açılış bakiyesi ile cari kartı aktarın
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadCariExcelTemplate}
              data-testid="download_cari_excel_template_btn"
              className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Örnek Şablon İndir (.xlsx)</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Excel Cari Yükleme Penceresini Kapat"
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* İÇERİK */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              <div className="flex items-start gap-2">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{feedback.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-gray-400 hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* AÇIKLAMA / İPUCU */}
          <div className="p-3 rounded-xl bg-teal-500/[0.06] border border-teal-500/20 text-[11px] text-teal-100/90 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <div>
              Açılış bakiyesi sütununda <strong className="text-white">pozitif tutar</strong> (örn:{' '}
              <code className="font-mono text-teal-300">12.500,00</code>) müşterinin{' '}
              <strong className="text-teal-300">bize borçlu</strong> olduğunu,{' '}
              <strong className="text-white">negatif tutar</strong> (örn:{' '}
              <code className="font-mono text-orange-300">-4.750,50</code>) bizim{' '}
              <strong className="text-orange-300">alacaklı/borçlu</strong> devir bakiyemizi ifade eder ve cari ekstreye{' '}
              <em>Açılış Bakiyesi</em> olarak otomatik yansır.
            </div>
          </div>

          {/* DROPZONE */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFileSelected(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            data-testid="cari_excel_dropzone"
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
              isDragging
                ? 'border-emerald-400 bg-emerald-400/10'
                : 'border-white/15 bg-black/20 hover:border-emerald-400/50 hover:bg-black/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelected(f);
              }}
              className="hidden"
              data-testid="cari_excel_file_input"
            />
            <div className="w-12 h-12 rounded-2xl bg-emerald-400/15 text-emerald-400 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-xs sm:text-sm font-bold text-white">
              {parsing
                ? 'Excel dosyası okunuyor...'
                : fileName
                ? `Seçili Dosya: ${fileName} (${rawRows.length} satır) — değiştirmek için tıklayın`
                : 'Excel (.xlsx, .xls) veya CSV Cari Listesini Seçin ya da Sürükleyin'}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Başlık satırınız otomatik eşleştirilir; yükleme öncesi tüm satırları ve hataları önizleyebilirsiniz.
            </p>
          </div>

          {/* SÜTUN EŞLEŞTİRME PANELİ */}
          {headers.length > 0 && (
            <div className="p-4 rounded-2xl bg-[#0a0e13] border border-white/[0.08] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-teal-300">
                  Sütun Eşleştirme
                </h4>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 text-[11px]">Varsayılan Tür:</span>
                    <select
                      value={defaultTur}
                      onChange={(e) => setDefaultTur(e.target.value as CariTur)}
                      className="bg-[#111820] border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-teal-400"
                    >
                      <option value="alici">Alıcı (Müşteri)</option>
                      <option value="tedarikci">Tedarikçi</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMapping(autoDetectCariColumnMapping(headers))}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-semibold flex items-center gap-1 transition"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Otomatik Eşleştir</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {FIELD_META.map((field) => (
                  <div key={field.key}>
                    <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                      {field.label}
                      {field.required && <span className="text-red-400 ml-1">*</span>}
                    </label>
                    <select
                      value={mapping[field.key] || ''}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [field.key]: e.target.value || null,
                        }))
                      }
                      className={`w-full bg-[#111820] border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400 ${
                        field.required && !mapping[field.key]
                          ? 'border-red-500/50'
                          : 'border-white/10'
                      }`}
                    >
                      <option value="">-- Eşleştirilmedi --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ÖZET KARTLARI VE HATALI SATIR ÖZETİ */}
          {evaluatedRows.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveFilter('all')}
                  className={`p-3 rounded-xl border text-left transition ${
                    activeFilter === 'all'
                      ? 'bg-white/10 border-white/30'
                      : 'bg-black/25 border-white/[0.06] hover:border-white/20'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-gray-400">Toplam Satır</div>
                  <div className="text-lg font-black text-white font-mono">{stats.total}</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveFilter('new')}
                  className={`p-3 rounded-xl border text-left transition ${
                    activeFilter === 'new'
                      ? 'bg-teal-500/15 border-teal-400/50'
                      : 'bg-teal-500/[0.06] border-teal-500/20 hover:border-teal-400/40'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-teal-300">Yeni Cari (Hazır)</div>
                  <div className="text-lg font-black text-teal-400 font-mono">
                    {stats.newValidCount}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveFilter('existing')}
                  className={`p-3 rounded-xl border text-left transition ${
                    activeFilter === 'existing'
                      ? 'bg-amber-500/15 border-amber-400/50'
                      : 'bg-amber-500/[0.06] border-amber-500/20 hover:border-amber-400/40'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-amber-300">Sistemde Mevcut</div>
                  <div className="text-lg font-black text-amber-300 font-mono">
                    {stats.existingCount}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveFilter('error')}
                  className={`p-3 rounded-xl border text-left transition ${
                    activeFilter === 'error'
                      ? 'bg-red-500/15 border-red-400/50'
                      : 'bg-red-500/[0.06] border-red-500/20 hover:border-red-400/40'
                  }`}
                >
                  <div className="text-[10px] uppercase font-bold text-red-300">Hatalı Satır</div>
                  <div className="text-lg font-black text-red-400 font-mono">{stats.errorCount}</div>
                </button>
              </div>

              {/* HATALI SATIR ÖZET PANELİ */}
              {stats.errorCount > 0 && (
                <div
                  data-testid="cari_excel_error_summary"
                  className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-red-300">
                      <FileWarning className="w-4 h-4 shrink-0" />
                      <span>
                        Hatalı Satır Özeti ({stats.errorCount} satır aktarılmayacak)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => exportCariImportErrorReport(stats.errorRows)}
                      data-testid="download_cari_error_report_btn"
                      className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-[11px] font-bold flex items-center gap-1 transition"
                    >
                      <Download className="w-3 h-3" />
                      <span>Hatalı Satırları İndir (.csv)</span>
                    </button>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 text-[11px] text-red-200/90">
                    {stats.errorRows.map((errRow) => (
                      <div key={errRow.rowIndex} className="flex items-start gap-2">
                        <span className="font-mono font-bold text-red-300 shrink-0">
                          Satır {errRow.rowIndex}:
                        </span>
                        <span>
                          <strong>{errRow.unvan || '(Unvan Boş)'}</strong> — {errRow.errors.join(' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MEVCUT CARİLER İÇİN TOPLU AKSİYON */}
              {stats.existingCount > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/25 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      <strong>{stats.existingCount} satır</strong> sistemdeki kayıtlarla (VKN/Unvan) eşleşti.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer mr-2">
                      <input
                        type="checkbox"
                        checked={updateBakiyeOnExisting}
                        onChange={(e) => setUpdateBakiyeOnExisting(e.target.checked)}
                        className="w-3.5 h-3.5 accent-amber-400 rounded"
                      />
                      <span>Güncellerken bakiyeyi de üzerine yaz</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleBulkExistingAction('skip')}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-[11px] font-bold transition"
                    >
                      Tümünü Atla
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkExistingAction('update')}
                      className="px-2.5 py-1 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 text-amber-200 text-[11px] font-bold transition"
                    >
                      Tümünü Güncelle
                    </button>
                  </div>
                </div>
              )}

              {/* ÖNİZLEME TABLOSU */}
              <div className="border border-white/[0.08] rounded-xl overflow-x-auto bg-[#0a0e13]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-black/40 text-gray-400 text-[10px] uppercase tracking-wider">
                      <th className="py-2.5 px-3 w-8">Seç</th>
                      <th className="py-2.5 px-3">Satır</th>
                      <th className="py-2.5 px-3">Cari Unvanı</th>
                      <th className="py-2.5 px-3">VKN / TCKN</th>
                      <th className="py-2.5 px-3">Tür</th>
                      <th className="py-2.5 px-3">İletişim</th>
                      <th className="py-2.5 px-3 text-right">Açılış Bakiyesi</th>
                      <th className="py-2.5 px-3">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {visibleRows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={
                          row.status === 'error'
                            ? 'bg-red-500/[0.05]'
                            : row.include
                            ? 'hover:bg-white/[0.02]'
                            : 'opacity-60 hover:bg-white/[0.02]'
                        }
                      >
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            disabled={row.status === 'error'}
                            checked={row.include}
                            onChange={() =>
                              setRowOverrides((prev) => ({
                                ...prev,
                                [row.rowIndex]: {
                                  ...prev[row.rowIndex],
                                  include: !row.include,
                                  existingAction:
                                    row.status === 'existing_vkn' && !row.include
                                      ? 'update'
                                      : row.existingAction,
                                },
                              }))
                            }
                            className="w-4 h-4 accent-teal-400 rounded cursor-pointer disabled:opacity-40"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono text-gray-400">{row.rowIndex}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-white">{row.unvan || '-'}</div>
                          {row.errors.length > 0 && (
                            <div className="text-[10px] text-red-400 mt-0.5">
                              {row.errors.join(' • ')}
                            </div>
                          )}
                          {row.warnings.length > 0 && (
                            <div className="text-[10px] text-amber-300 mt-0.5">
                              {row.warnings.join(' • ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-gray-300">
                          {row.vergiTcNo || '-'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              row.tur === 'alici'
                                ? 'bg-teal-500/15 text-teal-300 border border-teal-500/25'
                                : 'bg-orange-500/15 text-orange-300 border border-orange-500/25'
                            }`}
                          >
                            {row.tur === 'alici' ? 'Alıcı' : 'Tedarikçi'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-gray-300">
                          <div>{row.telefon || '-'}</div>
                          {row.email && <div className="text-gray-500">{row.email}</div>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                          <span
                            className={
                              row.bakiye > 0
                                ? 'text-teal-400'
                                : row.bakiye < 0
                                ? 'text-red-400'
                                : 'text-gray-400'
                            }
                          >
                            {formatCurrency(Math.abs(row.bakiye))}
                            {row.bakiye > 0 ? ' (B)' : row.bakiye < 0 ? ' (A)' : ''}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {row.status === 'valid_new' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/25">
                              Yeni Cari
                            </span>
                          )}
                          {row.status === 'error' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                              Hatalı
                            </span>
                          )}
                          {row.status === 'existing_vkn' && (
                            <select
                              value={row.existingAction}
                              onChange={(e) => {
                                const action = e.target.value as ExistingCariAction;
                                setRowOverrides((prev) => ({
                                  ...prev,
                                  [row.rowIndex]: {
                                    existingAction: action,
                                    include: action === 'update',
                                  },
                                }));
                              }}
                              className="bg-[#111820] border border-amber-500/40 rounded-lg px-2 py-1 text-[11px] text-amber-200 focus:outline-none"
                            >
                              <option value="skip">Mevcut — Atla</option>
                              <option value="update">Mevcut — Güncelle</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ALT AKSİYON ÇUBUĞU */}
        <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-black/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {stats.toInsertCount > 0 || stats.toUpdateCount > 0 ? (
              <span>
                <strong className="text-teal-300">{stats.toInsertCount} yeni cari</strong> eklenecek
                {stats.toUpdateCount > 0 && (
                  <>
                    {' '}
                    • <strong className="text-amber-300">{stats.toUpdateCount} cari</strong> güncellenecek
                  </>
                )}
              </span>
            ) : (
              <span>Aktarım için yukarıdan geçerli satırları seçiniz.</span>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 text-xs font-semibold transition"
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={importing || (stats.toInsertCount === 0 && stats.toUpdateCount === 0)}
              onClick={handleImportSubmit}
              data-testid="cari_excel_import_confirm_btn"
              className="px-5 py-2.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 disabled:opacity-40 text-[#0a0e13] font-extrabold text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.25)] transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {importing
                  ? 'Cariler Aktarılıyor...'
                  : `${stats.toInsertCount + stats.toUpdateCount} Cariyi Kaydet`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
