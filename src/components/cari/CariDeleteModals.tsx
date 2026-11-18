import React, { useEffect, useState } from 'react';
import {
  Trash2,
  X,
  AlertTriangle,
  Code2,
  Copy,
  Check,
  Loader2,
  FileText,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Cari, Fatura } from '../../types/database';
import { formatCurrency, formatDate } from '../../lib/formatters';
import {
  CARILER_AND_FATURALAR_DELETE_RLS_SQL,
  CariDeletionInspection,
  deleteCariWithLinkedRecords,
  deleteFaturaRecord,
  inspectCariDeletionTargets,
} from '../../lib/cariDeleteHelper';

interface DeleteCariConfirmModalProps {
  cari: Cari | null;
  onClose: () => void;
  onDeleted: (deletedCariId: string) => Promise<void> | void;
}

export const DeleteCariConfirmModal: React.FC<DeleteCariConfirmModalProps> = ({
  cari,
  onClose,
  onDeleted,
}) => {
  const { firma, profile } = useAuth();
  const effectiveFirmaId = cari?.firma_id || firma?.id || profile?.firma_id || '';

  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<CariDeletionInspection | null>(null);
  const [deleteLinkedRecords, setDeleteLinkedRecords] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showRlsSql, setShowRlsSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (!cari || !effectiveFirmaId) {
      setInspection(null);
      setErrorText(null);
      setShowRlsSql(false);
      setDeleteLinkedRecords(true);
      return;
    }

    let cancelled = false;
    setInspecting(true);
    setErrorText(null);
    setShowRlsSql(false);
    setDeleteLinkedRecords(true);

    inspectCariDeletionTargets(cari.id, effectiveFirmaId)
      .then((res) => {
        if (!cancelled) setInspection(res);
      })
      .catch(() => {
        if (!cancelled) setInspection(null);
      })
      .finally(() => {
        if (!cancelled) setInspecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cari?.id, effectiveFirmaId]);

  if (!cari) return null;

  const hasLinked = Boolean(inspection?.hasLinkedRecords);

  const handleConfirm = async () => {
    if (!effectiveFirmaId) return;
    setDeleting(true);
    setErrorText(null);

    try {
      const res = await deleteCariWithLinkedRecords({
        cari,
        firmaId: effectiveFirmaId,
        deleteLinkedRecords: hasLinked ? deleteLinkedRecords : false,
        isFirmaUnlimited: Boolean(firma?.sinirsiz),
      });

      if (res.deleted) {
        await onDeleted(cari.id);
        onClose();
        return;
      }

      setErrorText(res.errorMessage || 'Cari silinemedi.');
      if (res.isRlsBlocked) {
        setShowRlsSql(true);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(CARILER_AND_FATURALAR_DELETE_RLS_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => {
        if (!deleting) onClose();
      }}
      data-testid="delete_cari_confirm_modal"
    >
      <div
        className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-2xl space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Cariyi Silmek İstiyor musunuz?</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                <strong className="text-white">{cari.unvan}</strong> cari kartı kalıcı olarak silinecektir.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Cari Unvanı:</span>
            <span className="font-bold text-white text-right truncate max-w-[230px]">
              {cari.unvan}
            </span>
          </div>
          {cari.vergi_tc_no && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">VKN / TCKN:</span>
              <span className="font-mono text-gray-200">{cari.vergi_tc_no}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Güncel Bakiye:</span>
            <span className="font-mono font-bold text-teal-300">
              {formatCurrency(Number(cari.bakiye) || 0)}
            </span>
          </div>
        </div>

        {inspecting && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
            <span>Bağlı fatura ve işlemler kontrol ediliyor...</span>
          </div>
        )}

        {!inspecting && hasLinked && inspection && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 text-xs">
            <div className="flex items-start gap-2 text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                Bu cariye bağlı{' '}
                {inspection.faturaCount > 0 && (
                  <strong className="text-white">{inspection.faturaCount} adet fatura</strong>
                )}
                {inspection.faturaCount > 0 && inspection.islemCount > 0 && ' ve '}
                {inspection.islemCount > 0 && (
                  <strong className="text-white">
                    {inspection.islemCount} adet tahsilat/tediye işlemi
                  </strong>
                )}{' '}
                bulunuyor. Bağlı kayıtlar silinmeden cari kartı veritabanından silinemez.
              </div>
            </div>

            <label className="flex items-start gap-2.5 pt-2 border-t border-amber-500/20 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteLinkedRecords}
                onChange={(e) => setDeleteLinkedRecords(e.target.checked)}
                data-testid="delete_cari_cascade_checkbox"
                className="mt-0.5 w-4 h-4 accent-red-500 rounded cursor-pointer"
              />
              <span className="text-[11px] text-amber-100 font-semibold leading-snug">
                Bağlı tüm fatura ve işlemleri de bu cariyle birlikte kalıcı olarak sil
              </span>
            </label>
          </div>
        )}

        {errorText && (
          <div
            data-testid="delete_cari_error_box"
            className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span className="leading-relaxed">{errorText}</span>
          </div>
        )}

        {showRlsSql && (
          <div className="p-3 rounded-xl bg-black/40 border border-amber-400/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5" />
                <span>Supabase DELETE (Silme) İzni SQL</span>
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-extrabold flex items-center gap-1"
              >
                {copiedSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSql ? 'Kopyalandı' : 'SQL Kopyala'}</span>
              </button>
            </div>
            <p className="text-[10.5px] text-gray-400 leading-relaxed">
              Supabase SQL Editor&apos;de bu SQL&apos;i bir kez çalıştırarak cariler, faturalar ve işlemler için silme yetkisini kalıcı olarak açabilirsiniz:
            </p>
            <pre className="p-2.5 rounded-lg bg-black/60 border border-white/10 text-[9.5px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
              {CARILER_AND_FATURALAR_DELETE_RLS_SQL}
            </pre>
          </div>
        )}

        <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowRlsSql((v) => !v)}
            className="text-[11px] text-amber-300/80 hover:text-amber-300 font-semibold flex items-center gap-1"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{showRlsSql ? 'SQL Yardımını Gizle' : 'Veritabanı Silme İzni (SQL)'}</span>
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              disabled={deleting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 text-xs font-semibold hover:bg-white/5 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={deleting || inspecting || (hasLinked && !deleteLinkedRecords)}
              onClick={handleConfirm}
              data-testid="confirm_delete_cari_button"
              className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{deleting ? 'Siliniyor...' : 'Evet, Sil'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DeleteFaturaConfirmModalProps {
  fatura: Fatura | null;
  cariUnvan?: string;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}

export const DeleteFaturaConfirmModal: React.FC<DeleteFaturaConfirmModalProps> = ({
  fatura,
  cariUnvan,
  onClose,
  onDeleted,
}) => {
  const { firma, profile } = useAuth();
  const effectiveFirmaId = fatura?.firma_id || firma?.id || profile?.firma_id || '';

  const [deleting, setDeleting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showRlsSql, setShowRlsSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    setErrorText(null);
    setShowRlsSql(false);
  }, [fatura?.id]);

  if (!fatura) return null;

  const handleConfirm = async () => {
    if (!effectiveFirmaId) return;
    setDeleting(true);
    setErrorText(null);

    try {
      const res = await deleteFaturaRecord({
        fatura,
        firmaId: effectiveFirmaId,
        isFirmaUnlimited: Boolean(firma?.sinirsiz),
      });

      if (res.deleted) {
        await onDeleted();
        onClose();
        return;
      }

      setErrorText(res.errorMessage || 'Fatura silinemedi.');
      if (res.isRlsBlocked) {
        setShowRlsSql(true);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(CARILER_AND_FATURALAR_DELETE_RLS_SQL);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => {
        if (!deleting) onClose();
      }}
      data-testid="delete_fatura_confirm_modal"
    >
      <div
        className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-2xl space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Faturayı Silmek İstiyor musunuz?</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Fatura silindiğinde cari bakiyesi otomatik olarak geri düzeltilir.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Fatura No:</span>
            <span className="font-mono font-bold text-teal-300">{fatura.fatura_no}</span>
          </div>
          {cariUnvan && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-400">Cari Hesap:</span>
              <span className="font-bold text-white text-right truncate max-w-[230px]">
                {cariUnvan}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Tarih / Tür:</span>
            <span className="text-gray-200 font-semibold">
              {formatDate(fatura.tarih)} •{' '}
              <span className={fatura.yon === 'satis' ? 'text-teal-300' : 'text-orange-300'}>
                {fatura.yon === 'satis' ? 'Satış Faturası' : 'Alış Faturası'}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
            <span className="text-gray-400">Tutar:</span>
            <span className="font-mono font-extrabold text-sm text-white">
              {formatCurrency(Number(fatura.tutar) || 0)}
            </span>
          </div>
        </div>

        {errorText && (
          <div
            data-testid="delete_fatura_error_box"
            className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span className="leading-relaxed">{errorText}</span>
          </div>
        )}

        {showRlsSql && (
          <div className="p-3 rounded-xl bg-black/40 border border-amber-400/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5" />
                <span>Supabase DELETE (Silme) İzni SQL</span>
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[10px] font-extrabold flex items-center gap-1"
              >
                {copiedSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedSql ? 'Kopyalandı' : 'SQL Kopyala'}</span>
              </button>
            </div>
            <p className="text-[10.5px] text-gray-400 leading-relaxed">
              Supabase SQL Editor&apos;de bu SQL&apos;i bir kez çalıştırarak fatura silme yetkisini açabilirsiniz:
            </p>
            <pre className="p-2.5 rounded-lg bg-black/60 border border-white/10 text-[9.5px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
              {CARILER_AND_FATURALAR_DELETE_RLS_SQL}
            </pre>
          </div>
        )}

        <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowRlsSql((v) => !v)}
            className="text-[11px] text-amber-300/80 hover:text-amber-300 font-semibold flex items-center gap-1"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{showRlsSql ? 'SQL Yardımını Gizle' : 'Veritabanı Silme İzni (SQL)'}</span>
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              disabled={deleting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/10 text-gray-300 text-xs font-semibold hover:bg-white/5 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={handleConfirm}
              data-testid="confirm_delete_fatura_button"
              className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{deleting ? 'Siliniyor...' : 'Faturayı Sil'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
