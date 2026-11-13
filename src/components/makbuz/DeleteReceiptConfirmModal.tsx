import React, { useState, useEffect } from 'react';
import {
  Trash2,
  X,
  AlertTriangle,
  Code2,
  Copy,
  Check,
  Ban,
  Loader2,
  ArrowRightLeft,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Islem } from '../../types/database';
import { formatCurrency, formatDate } from '../../lib/formatters';
import {
  inspectReceiptDeletionTargets,
  deleteReceiptRows,
  cancelReceiptRowsFallback,
  ReceiptDeletionInspection,
} from '../../lib/receiptDeleteHelper';

interface DeleteReceiptConfirmModalProps {
  islem: Islem | null;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}

export const DeleteReceiptConfirmModal: React.FC<DeleteReceiptConfirmModalProps> = ({
  islem,
  onClose,
  onDeleted,
}) => {
  const { firma, profile } = useAuth();
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<ReceiptDeletionInspection | null>(null);
  const [deleteLinkedCapraz, setDeleteLinkedCapraz] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showRlsSql, setShowRlsSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (!islem || !firma?.id) {
      setInspection(null);
      setErrorText(null);
      setShowRlsSql(false);
      return;
    }

    let cancelled = false;
    setInspecting(true);
    setErrorText(null);
    setShowRlsSql(false);
    setDeleteLinkedCapraz(true);

    inspectReceiptDeletionTargets(islem, firma.id)
      .then((res) => {
        if (!cancelled) setInspection(res);
      })
      .finally(() => {
        if (!cancelled) setInspecting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [islem?.id, firma?.id]);

  if (!islem) return null;

  const mainRows = inspection?.mainRows || [islem];
  const linkedCaprazRow = inspection?.linkedCaprazRow || null;
  const totalAmount = inspection?.totalAmount ?? (Number(islem.tutar) || 0);
  const isKarma = inspection?.isKarma ?? false;

  const getRowsToProcess = (): Islem[] => {
    const list = [...mainRows];
    if (linkedCaprazRow && deleteLinkedCapraz) {
      list.push(linkedCaprazRow);
    }
    return list;
  };

  const handleConfirmDelete = async () => {
    if (!firma?.id) return;
    setDeleting(true);
    setErrorText(null);

    try {
      const res = await deleteReceiptRows({
        rowsToDelete: getRowsToProcess(),
        firmaId: firma.id,
        isFirmaUnlimited: Boolean(firma?.sinirsiz),
      });

      if (res.deletedCount > 0) {
        await onDeleted();
        onClose();
        return;
      }

      setErrorText(res.errorMessage || 'Makbuz silinemedi.');
      if (res.isRlsBlocked) {
        setShowRlsSql(true);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleFallbackCancel = async () => {
    if (!firma?.id) return;
    setDeleting(true);
    setErrorText(null);

    try {
      const res = await cancelReceiptRowsFallback({
        rowsToCancel: getRowsToProcess(),
        firmaId: firma.id,
        userId: profile?.id,
      });

      if (res.cancelledCount > 0) {
        await onDeleted();
        onClose();
        return;
      }

      setErrorText(res.errorMessage || 'Makbuz iptal edilemedi.');
    } finally {
      setDeleting(false);
    }
  };

  const deletePolicySql = `-- Supabase SQL Editor'de çalıştırarak "islemler" tablosunda silme (DELETE) yetkisi açın:
DROP POLICY IF EXISTS "Superadmin and active firms can delete islemler" ON islemler;
CREATE POLICY "Superadmin and active firms can delete islemler" ON islemler
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN firmalar f ON f.id = p.firma_id
      WHERE p.id = auth.uid()
        AND p.firma_id = islemler.firma_id
        AND p.aktif = true
        AND p.rol IN ('ana', 'plasiyer', 'superadmin')
        AND (f.sinirsiz = true OR f.paket_bitis >= CURRENT_DATE OR f.deneme_bitis >= CURRENT_DATE)
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND (rol = 'superadmin' OR lower(email) = 'conqueror58@gmail.com')
    )
  );`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(deletePolicySql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
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
              <h3 className="font-bold text-white text-base">Makbuzu Silmek İstiyor musunuz?</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Bu işlem kalıcıdır ve cari bakiyesi otomatik güncellenir.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Makbuz Özeti */}
        <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Makbuz No:</span>
            <span className="font-mono font-bold text-teal-400">
              {islem.makbuz_no || `#${islem.id.slice(0, 8)}`}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Cari Hesap:</span>
            <span className="font-bold text-white text-right truncate max-w-[220px]">
              {islem.cariler?.unvan || 'Cari Belirtilmemiş'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">Tarih / Tip:</span>
            <span className="text-gray-200 uppercase font-semibold">
              {formatDate(islem.tarih)} • {islem.tip}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
            <span className="text-gray-400">Tutar:</span>
            <span className="font-mono font-extrabold text-sm text-white">
              {formatCurrency(totalAmount)}
            </span>
          </div>
          {isKarma && mainRows.length > 1 && (
            <div className="text-[11px] text-cyan-300 pt-1">
              • Bu Karma Makbuz toplam <strong>{mainRows.length} ödeme kalemi</strong> ile birlikte silinecektir.
            </div>
          )}
        </div>

        {inspecting && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-400" />
            <span>Bağlı kayıtlar kontrol ediliyor...</span>
          </div>
        )}

        {/* Çapraz İşlem Seçeneği */}
        {linkedCaprazRow && (
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/25 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={deleteLinkedCapraz}
              onChange={(e) => setDeleteLinkedCapraz(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-purple-400 rounded"
            />
            <div className="space-y-0.5">
              <div className="font-bold text-purple-200 flex items-center gap-1.5">
                <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400" />
                <span>Bağlı Çapraz Kaydı da Sil</span>
              </div>
              <div className="text-[11px] text-purple-200/80">
                Karşı işlem ({linkedCaprazRow.cariler?.unvan || 'Bağlı Cari'} -{' '}
                {formatCurrency(linkedCaprazRow.tutar)}) da silinsin.
              </div>
            </div>
          </label>
        )}

        {errorText && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span className="leading-relaxed">{errorText}</span>
            </div>

            {showRlsSql && (
              <div className="pt-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1">
                    <Code2 className="w-3.5 h-3.5" />
                    Supabase DELETE RLS SQL
                  </span>
                  <button
                    type="button"
                    onClick={handleCopySql}
                    className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-extrabold flex items-center gap-1"
                  >
                    {copiedSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSql ? 'Kopyalandı' : 'SQL Kopyala'}</span>
                  </button>
                </div>
                <pre className="p-2.5 rounded-lg bg-black/50 border border-white/10 text-[9.5px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap">
                  {deletePolicySql}
                </pre>

                {!islem.iptal && (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleFallbackCancel}
                    className="w-full py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/35 text-amber-200 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Bunun Yerine Makbuzu İptal Et (Bakiyeyi Düzelt)</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="pt-1 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 text-xs font-semibold hover:bg-white/5 transition"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={deleting || inspecting}
            onClick={handleConfirmDelete}
            data-testid="confirm_delete_receipt_button"
            className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg transition"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            <span>{deleting ? 'Siliniyor...' : 'Evet, Makbuzu Sil'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
