import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Upload,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  UserPlus,
  Building2,
  Trash2,
  Code2,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import { Cari, FaturaYon } from '../../types/database';
import { formatCurrency, formatDate } from '../../lib/formatters';
import {
  parseUblInvoiceXml,
  ParsedUblInvoice,
  normalizeTaxId,
  UblPartyInfo,
} from '../../lib/ublParser';

interface UblImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  cariler: Cari[];
  onImported: () => Promise<void> | void;
}

interface ExistingFaturaKey {
  fatura_no: string;
  yon: FaturaYon;
  cari_id: string;
}

interface ImportRow {
  id: string;
  fileName: string;
  parsed?: ParsedUblInvoice;
  error?: string;
  yon: FaturaYon;
  selectedCariId: string; // existing cari id OR '__auto_create__' OR ''
  exchangeRate: number;
  tutarTL: number;
  include: boolean;
  isDuplicate: boolean;
}

const AUTO_CREATE_VALUE = '__auto_create__';

export const UblImportModal: React.FC<UblImportModalProps> = ({
  isOpen,
  onClose,
  cariler,
  onImported,
}) => {
  const { firma, isPeriodExpired } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [rows, setRows] = useState<ImportRow[]>([]);
  const [existingInvoices, setExistingInvoices] = useState<ExistingFaturaKey[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    showSqlHint?: boolean;
  } | null>(null);
  const [showSqlHelp, setShowSqlHelp] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const loadExistingInvoices = async (): Promise<ExistingFaturaKey[]> => {
    if (!firma?.id) return [];
    const { data, error } = await supabase
      .from('faturalar')
      .select('fatura_no, yon, cari_id')
      .eq('firma_id', firma.id);

    if (error || !data) return existingInvoices;
    const list = data as ExistingFaturaKey[];
    setExistingInvoices(list);
    return list;
  };

  useEffect(() => {
    if (isOpen && firma?.id) {
      setFeedback(null);
      loadExistingInvoices();
    }
    if (!isOpen) {
      setRows([]);
      setFeedback(null);
      setIsDragging(false);
      setShowSqlHelp(false);
    }
  }, [isOpen, firma?.id]);

  if (!isOpen) return null;

  const findMatchingCariId = (party: UblPartyInfo): string => {
    const normVkn = normalizeTaxId(party.vkn);
    if (normVkn) {
      const match = cariler.find((c) => normalizeTaxId(c.vergi_tc_no) === normVkn);
      if (match) return match.id;
    }
    if (party.vkn || (party.unvan && party.unvan !== 'Bilinmeyen Cari')) {
      return AUTO_CREATE_VALUE;
    }
    return '';
  };

  const isDuplicateFatura = (
    faturaNo: string,
    yon: FaturaYon,
    knownInvoices: ExistingFaturaKey[]
  ): boolean => {
    const cleanNo = faturaNo.trim().toUpperCase();
    return knownInvoices.some(
      (f) => f.fatura_no.trim().toUpperCase() === cleanNo && f.yon === yon
    );
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setParsing(true);
    setFeedback(null);

    try {
      const latestInvoices = await loadExistingInvoices();
      const newRows: ImportRow[] = [];

      for (const file of files) {
        const rowId = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        try {
          const text = await file.text();
          const parsed = parseUblInvoiceXml(text, file.name, firma?.vergi_no, cariler);
          const yon = parsed.detectedYon;
          const counterparty = yon === 'satis' ? parsed.customer : parsed.supplier;
          const selectedCariId = findMatchingCariId(counterparty);
          const duplicate = isDuplicateFatura(parsed.faturaNo, yon, latestInvoices);

          newRows.push({
            id: rowId,
            fileName: file.name,
            parsed,
            yon,
            selectedCariId,
            exchangeRate: parsed.exchangeRate,
            tutarTL: parsed.tutarTL,
            isDuplicate: duplicate,
            include: !duplicate && parsed.tutarTL > 0 && Boolean(selectedCariId),
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : `${file.name} okunamadı.`;
          newRows.push({
            id: rowId,
            fileName: file.name,
            error: msg,
            yon: 'alis',
            selectedCariId: '',
            exchangeRate: 1,
            tutarTL: 0,
            isDuplicate: false,
            include: false,
          });
        }
      }

      setRows((prev) => {
        // Aynı dosya adı + fatura no tekrar eklenmesini engelle
        const merged = [...prev];
        for (const nr of newRows) {
          const existsInBatch =
            nr.parsed &&
            merged.some(
              (m) =>
                m.parsed &&
                m.parsed.faturaNo.trim().toUpperCase() === nr.parsed!.faturaNo.trim().toUpperCase() &&
                m.yon === nr.yon
            );
          if (!existsInBatch) {
            merged.push(nr);
          }
        }
        return merged;
      });
    } finally {
      setParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleYonChange = (rowId: string, newYon: FaturaYon) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || !row.parsed) return row;
        const counterparty = newYon === 'satis' ? row.parsed.customer : row.parsed.supplier;
        const matchedCariId = findMatchingCariId(counterparty);
        const dup = isDuplicateFatura(row.parsed.faturaNo, newYon, existingInvoices);
        return {
          ...row,
          yon: newYon,
          selectedCariId: matchedCariId,
          isDuplicate: dup,
          include: !dup && row.tutarTL > 0 && Boolean(matchedCariId),
        };
      })
    );
  };

  const handleCariChange = (rowId: string, cariId: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              selectedCariId: cariId,
              include: cariId ? (!row.isDuplicate ? true : row.include) : false,
            }
          : row
      )
    );
  };

  const handleExchangeRateChange = (rowId: string, rawRate: string) => {
    const rate = parseFloat(rawRate.replace(',', '.'));
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || !row.parsed) return row;
        const validRate = isNaN(rate) || rate < 0 ? 0 : rate;
        const nextTL = Math.round(row.parsed.originalAmount * validRate * 100) / 100;
        return {
          ...row,
          exchangeRate: validRate,
          tutarTL: nextTL,
        };
      })
    );
  };

  const handleTutarChange = (rowId: string, rawTutar: string) => {
    const val = parseFloat(rawTutar.replace(',', '.'));
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId ? { ...row, tutarTL: isNaN(val) || val < 0 ? 0 : val } : row
      )
    );
  };

  const handleToggleInclude = (rowId: string) => {
    setRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, include: !row.include } : row))
    );
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const selectedRows = rows.filter((r) => r.include && !r.error && r.parsed && r.selectedCariId);
  const autoCreateCount = new Set(
    selectedRows
      .filter((r) => r.selectedCariId === AUTO_CREATE_VALUE && r.parsed)
      .map((r) => {
        const party = r.yon === 'satis' ? r.parsed!.customer : r.parsed!.supplier;
        return normalizeTaxId(party.vkn) || party.unvan.trim().toLowerCase();
      })
  ).size;

  const handleImportConfirm = async () => {
    if (!firma?.id) return;
    if (isPeriodExpired) {
      setFeedback({
        type: 'error',
        text: 'Firma abonelik / deneme süreniz dolmuş görünüyor. Lütfen paket yenileyiniz.',
      });
      return;
    }

    if (selectedRows.length === 0) {
      setFeedback({
        type: 'error',
        text: 'İşlenecek geçerli bir fatura seçilmedi.',
      });
      return;
    }

    setImporting(true);
    setFeedback(null);

    try {
      // 1. Otomatik açılacak yeni carileri VKN bazında tekilleştirerek oluştur
      const createdCariByKey = new Map<string, Cari>();
      let createdCount = 0;

      for (const row of selectedRows) {
        if (row.selectedCariId !== AUTO_CREATE_VALUE || !row.parsed) continue;
        const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
        const normVkn = normalizeTaxId(party.vkn);
        const dedupKey = normVkn || party.unvan.trim().toLowerCase();

        if (createdCariByKey.has(dedupKey)) continue;

        const { data: insertedCari, error: cariErr } = await supabase
          .from('cariler')
          .insert({
            firma_id: firma.id,
            unvan: party.unvan.trim() || 'Bilinmeyen Cari',
            vergi_tc_no: normVkn || null,
            telefon: party.telefon?.trim() || null,
            email: party.email?.trim() || null,
            tur: row.yon === 'satis' ? 'alici' : 'tedarikci',
            bakiye: 0,
          })
          .select('*')
          .single();

        if (cariErr) throw cariErr;
        if (insertedCari) {
          createdCariByKey.set(dedupKey, insertedCari as Cari);
          createdCount++;
        }
      }

      // 2. Etkilenen carilerin mevcut bakiyelerini ve beklenen değişimi hesapla
      const resolvedPayloads: Array<{
        firma_id: string;
        cari_id: string;
        fatura_no: string;
        tarih: string;
        tutar: number;
        yon: FaturaYon;
      }> = [];

      const expectedDeltaByCari = new Map<string, number>();

      for (const row of selectedRows) {
        if (!row.parsed) continue;
        let targetCariId = row.selectedCariId;

        if (targetCariId === AUTO_CREATE_VALUE) {
          const party = row.yon === 'satis' ? row.parsed.customer : row.parsed.supplier;
          const normVkn = normalizeTaxId(party.vkn);
          const dedupKey = normVkn || party.unvan.trim().toLowerCase();
          const newCari = createdCariByKey.get(dedupKey);
          if (!newCari) {
            throw new Error(`${party.unvan} için cari kartı oluşturulamadı.`);
          }
          targetCariId = newCari.id;
        }

        const tutar = Math.round((Number(row.tutarTL) || 0) * 100) / 100;
        resolvedPayloads.push({
          firma_id: firma.id,
          cari_id: targetCariId,
          fatura_no: row.parsed.faturaNo.trim(),
          tarih: row.parsed.tarih,
          tutar,
          yon: row.yon,
        });

        // Satış faturası cariyi bize borçlandırır (+tutar), Alış faturası bizi alacaklandırır/borçlandırır (-tutar)
        const signedDelta = row.yon === 'satis' ? tutar : -tutar;
        expectedDeltaByCari.set(
          targetCariId,
          (expectedDeltaByCari.get(targetCariId) || 0) + signedDelta
        );
      }

      const affectedCariIds = Array.from(expectedDeltaByCari.keys());
      const beforeBalanceMap = new Map<string, number>();
      if (affectedCariIds.length > 0) {
        const { data: beforeCaris } = await supabase
          .from('cariler')
          .select('id, bakiye')
          .in('id', affectedCariIds);
        (beforeCaris || []).forEach((c: { id: string; bakiye: number }) => {
          beforeBalanceMap.set(c.id, Number(c.bakiye) || 0);
        });
      }

      // 3. Faturaları kaydet
      const { error: faturaErr } = await supabase.from('faturalar').insert(resolvedPayloads);
      if (faturaErr) throw faturaErr;

      // 4. Veritabanı trigger'ı cariler.bakiye'yi güncelledi mi kontrol et; trigger yoksa istemciden güncelle
      if (affectedCariIds.length > 0) {
        const { data: afterCaris } = await supabase
          .from('cariler')
          .select('id, bakiye')
          .in('id', affectedCariIds);

        for (const c of (afterCaris || []) as Array<{ id: string; bakiye: number }>) {
          const beforeVal = beforeBalanceMap.get(c.id) ?? 0;
          const afterVal = Number(c.bakiye) || 0;
          const expectedDelta = expectedDeltaByCari.get(c.id) || 0;

          // Eğer trigger çalışmadıysa afterVal === beforeVal kalmıştır; çift sayımı önlemek için sadece değişmemişse güncelle
          if (Math.abs(afterVal - beforeVal) < 0.005 && Math.abs(expectedDelta) >= 0.005) {
            const nextBakiye = Math.round((beforeVal + expectedDelta) * 100) / 100;
            await supabase
              .from('cariler')
              .update({ bakiye: nextBakiye })
              .eq('id', c.id)
              .eq('firma_id', firma.id);
          }
        }
      }

      await onImported();
      setFeedback({
        type: 'success',
        text: `${resolvedPayloads.length} adet fatura vergi numarasına göre ilgili cari hesaplara başarıyla işlendi.${
          createdCount > 0 ? ` (${createdCount} yeni cari kartı otomatik açıldı.)` : ''
        }`,
      });
      setRows([]);
    } catch (err: unknown) {
      const msg = handleSupabaseError(err, 'Faturalar işlenirken hata oluştu.', {
        isFirmaUnlimited: Boolean(firma?.sinirsiz),
      });
      const lowerMsg = msg.toLowerCase();
      const isRls =
        lowerMsg.includes('rls') ||
        lowerMsg.includes('security') ||
        lowerMsg.includes('permission') ||
        lowerMsg.includes('yetki');
      setFeedback({
        type: 'error',
        text: msg,
        showSqlHint: isRls,
      });
      if (isRls) {
        setShowSqlHelp(true);
      }
    } finally {
      setImporting(false);
    }
  };

  const faturaSqlSnippet = `-- Supabase SQL Editor'de çalıştırarak faturalar tablosunun otomatik bakiye ve güvenlik kurallarını tanımlayın:
-- 1) Fatura eklendiğinde/silindiğinde cariler.bakiye otomatik güncellensin:
CREATE OR REPLACE FUNCTION handle_fatura_bakiye()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE cariler
    SET bakiye = COALESCE(bakiye, 0) + (CASE WHEN NEW.yon = 'satis' THEN NEW.tutar ELSE -NEW.tutar END)
    WHERE id = NEW.cari_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE cariler
    SET bakiye = COALESCE(bakiye, 0) - (CASE WHEN OLD.yon = 'satis' THEN OLD.tutar ELSE -OLD.tutar END)
    WHERE id = OLD.cari_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_faturalar_bakiye ON faturalar;
CREATE TRIGGER trg_faturalar_bakiye
  AFTER INSERT OR DELETE ON faturalar
  FOR EACH ROW EXECUTE FUNCTION handle_fatura_bakiye();

-- 2) RLS (Satır Bazlı Güvenlik) Politikaları:
ALTER TABLE faturalar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Firma uyeleri faturalari gorebilir" ON faturalar;
CREATE POLICY "Firma uyeleri faturalari gorebilir" ON faturalar
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.firma_id = faturalar.firma_id AND p.aktif = true)
  );

DROP POLICY IF EXISTS "Aktif firma fatura ekleyebilir" ON faturalar;
CREATE POLICY "Aktif firma fatura ekleyebilir" ON faturalar
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN firmalar f ON f.id = p.firma_id
      WHERE p.id = auth.uid()
        AND p.firma_id = faturalar.firma_id
        AND p.aktif = true
        AND (f.sinirsiz = true OR f.paket_bitis >= CURRENT_DATE OR f.deneme_bitis >= CURRENT_DATE)
    )
  );`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(faturaSqlSnippet);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* ÜST BAŞLIK */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shrink-0">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                UBL / XML Fatura Yükle &amp; VKN ile Cariye İşle
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                E-Fatura / E-Arşiv <code className="text-teal-300">.xml</code> veya{' '}
                <code className="text-teal-300">.ubl</code> dosyalarını seçin; vergi numarası otomatik eşleştirilip cariye işlensin.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSqlHelp(!showSqlHelp)}
              data-testid="ubl_sql_help_button"
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-[11px] font-bold text-amber-300 flex items-center gap-1 transition"
              title="Supabase Veritabanı Trigger & RLS SQL Kodları"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Veritabanı SQL</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* GÖVDE */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* FİRMA VKN BİLGİ ŞERİDİ */}
          <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-start gap-2.5 text-[11px] text-blue-200">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              Firmanızın Vergi/TC No bilgisi:{' '}
              <strong className="font-mono text-white">{firma?.vergi_no || 'Tanımsız'}</strong>.
              Yüklediğiniz XML içindeki <strong>Satıcı VKN</strong> firmanızla eşleşirse{' '}
              <span className="text-teal-300 font-bold">Satış Faturası</span> (müşteri borçlanır),
              <strong>Alıcı VKN</strong> firmanızla eşleşirse{' '}
              <span className="text-orange-300 font-bold">Alış Faturası</span> (tedarikçi alacaklanır) olarak otomatik seçilir.
            </div>
          </div>

          {/* OPSİYONEL VERİTABANI SQL YARDIMCISI */}
          {showSqlHelp && (
            <div className="p-4 rounded-xl bg-black/40 border border-amber-400/30 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h4 className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                    <Code2 className="w-4 h-4" />
                    <span>Supabase faturalar Trigger &amp; RLS SQL</span>
                  </h4>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Supabase SQL Editor&apos;de bu komutu bir kez çalıştırırsanız sunucu tarafında da bakiye &amp; güvenlik politikaları garantiye alınır.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'Kopyalandı' : 'SQL Kopyala'}</span>
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-black/60 border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap">
                {faturaSqlSnippet}
              </pre>
            </div>
          )}

          {/* GERİ BİLDİRİM MESAJI */}
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

          {/* DOSYA YÜKLEME ALANI (DROPZONE) */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) {
                processFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            data-testid="ubl_dropzone"
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
              isDragging
                ? 'border-teal-400 bg-teal-400/10'
                : 'border-white/15 bg-black/20 hover:border-teal-400/50 hover:bg-black/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.ubl,text/xml,application/xml"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) {
                  processFiles(e.target.files);
                }
              }}
              className="hidden"
              data-testid="ubl_file_input"
            />
            <div className="w-12 h-12 rounded-2xl bg-teal-400/15 text-teal-400 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-xs sm:text-sm font-bold text-white">
              {parsing
                ? 'XML dosyaları çözümleniyor...'
                : 'UBL / XML Fatura Dosyalarını Seçin veya Buraya Sürükleyin'}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Birden fazla <span className="text-gray-200 font-semibold">.xml</span> veya{' '}
              <span className="text-gray-200 font-semibold">.ubl</span> dosyasını aynı anda yükleyebilirsiniz.
            </p>
          </div>

          {/* ÇÖZÜMLENEN FATURALAR LİSTESİ */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-gray-300">
                  Önizleme ve Cari Eşleştirme ({rows.length} dosya)
                </h4>
                <button
                  type="button"
                  onClick={() => setRows([])}
                  className="text-[11px] text-gray-400 hover:text-red-400 font-semibold transition"
                >
                  Listeyi Temizle
                </button>
              </div>

              <div className="space-y-2.5">
                {rows.map((row) => {
                  if (row.error || !row.parsed) {
                    return (
                      <div
                        key={row.id}
                        className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2 text-red-300 min-w-0">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span className="truncate">{row.error || `${row.fileName} hatalı`}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.id)}
                          className="p-1.5 text-red-300 hover:bg-red-500/20 rounded-lg shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  }

                  const p = row.parsed;
                  const counterparty = row.yon === 'satis' ? p.customer : p.supplier;
                  const matchedExisting = cariler.find((c) => c.id === row.selectedCariId);
                  const isAutoCreate = row.selectedCariId === AUTO_CREATE_VALUE;
                  const isForeign = p.currencyCode !== 'TRY' && p.currencyCode !== 'TL';

                  return (
                    <div
                      key={row.id}
                      className={`p-3.5 sm:p-4 rounded-xl border transition space-y-3 ${
                        row.include
                          ? 'bg-[#0a0e13] border-teal-500/30'
                          : 'bg-black/20 border-white/[0.06] opacity-70'
                      }`}
                    >
                      {/* Satır Üst Başlık: Checkbox, Fatura No, Tarih, Yön, Durum */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={() => handleToggleInclude(row.id)}
                            aria-label={`${p.faturaNo} faturasını içe aktar`}
                            className="w-4 h-4 accent-teal-400 rounded cursor-pointer"
                          />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-extrabold text-teal-400">
                                {p.faturaNo}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {formatDate(p.tarih)}
                              </span>
                              {p.invoiceTypeCode === 'IADE' && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  İADE FATURASI
                                </span>
                              )}
                              {row.isDuplicate && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/30">
                                  Mükerrer (Zaten Kayıtlı)
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate mt-0.5">
                              Dosya: {row.fileName} • {p.detectionReason}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Yön Seçici */}
                          <div className="inline-flex rounded-lg bg-black/50 p-0.5 border border-white/10">
                            <button
                              type="button"
                              onClick={() => handleYonChange(row.id, 'satis')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                                row.yon === 'satis'
                                  ? 'bg-teal-400 text-[#0a0e13]'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              <ArrowUpRight className="w-3 h-3" />
                              <span>Satış</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleYonChange(row.id, 'alis')}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition ${
                                row.yon === 'alis'
                                  ? 'bg-orange-400 text-[#0a0e13]'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              <ArrowDownLeft className="w-3 h-3" />
                              <span>Alış</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveRow(row.id)}
                            title="Listeden çıkar"
                            className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Satır Detay: Karşı Taraf VKN/Ünvan + Cari Eşleştirme + Tutar */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start pt-2 border-t border-white/[0.05]">
                        {/* XML'den okunan karşı taraf */}
                        <div className="md:col-span-4 space-y-1">
                          <div className="text-[10px] uppercase font-bold text-gray-400">
                            XML {row.yon === 'satis' ? 'Alıcı (Müşteri)' : 'Satıcı (Tedarikçi)'}
                          </div>
                          <div className="text-xs font-bold text-white leading-snug">
                            {counterparty.unvan}
                          </div>
                          <div className="text-[11px] font-mono text-teal-300">
                            VKN/TCKN: {counterparty.vkn || 'Bulunamadı'}
                          </div>
                        </div>

                        {/* İşleneceği Cari Hesap */}
                        <div className="md:col-span-5 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase font-bold text-gray-400">
                              İşleneceği Cari Hesap
                            </span>
                            {matchedExisting ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-400">
                                <Building2 className="w-3 h-3" />
                                VKN Eşleşti
                              </span>
                            ) : isAutoCreate ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300">
                                <UserPlus className="w-3 h-3" />
                                Yeni Cari Açılacak
                              </span>
                            ) : null}
                          </div>
                          <select
                            value={row.selectedCariId}
                            onChange={(e) => handleCariChange(row.id, e.target.value)}
                            className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
                          >
                            <option value="">-- Cari Seçiniz --</option>
                            <option value={AUTO_CREATE_VALUE}>
                              + Otomatik Yeni Cari Aç ({counterparty.unvan} - {counterparty.vkn || 'VKN Yok'})
                            </option>
                            {cariler.map((c) => (
                              <option key={c.id} value={c.id}>
                                [{c.tur === 'alici' ? 'ALICI' : 'TEDARİKÇİ'}] {c.unvan}
                                {c.vergi_tc_no ? ` (${c.vergi_tc_no})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Tutar / Kur */}
                        <div className="md:col-span-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-gray-400">
                              TL Tutarı
                            </span>
                            {isForeign && (
                              <span className="text-[10px] font-mono text-amber-300">
                                {p.originalAmount.toLocaleString('tr-TR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                {p.currencyCode}
                              </span>
                            )}
                          </div>
                          {isForeign ? (
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="number"
                                step="0.0001"
                                value={row.exchangeRate}
                                onChange={(e) => handleExchangeRateChange(row.id, e.target.value)}
                                title="Döviz Kuru"
                                placeholder="Kur"
                                className="w-full bg-[#111820] border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono text-amber-300 focus:outline-none focus:border-teal-400"
                              />
                              <input
                                type="number"
                                step="0.01"
                                value={row.tutarTL}
                                onChange={(e) => handleTutarChange(row.id, e.target.value)}
                                title="TL Karşılığı"
                                className="w-full bg-[#111820] border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-white text-right focus:outline-none focus:border-teal-400"
                              />
                            </div>
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              value={row.tutarTL}
                              onChange={(e) => handleTutarChange(row.id, e.target.value)}
                              className="w-full bg-[#111820] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-white text-right focus:outline-none focus:border-teal-400"
                            />
                          )}
                          <div className="text-[10px] text-right text-gray-400">
                            Etki:{' '}
                            <span
                              className={
                                row.yon === 'satis' ? 'text-teal-400 font-bold' : 'text-red-400 font-bold'
                              }
                            >
                              {row.yon === 'satis' ? '+' : '-'}
                              {formatCurrency(row.tutarTL)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ALT BİLGİ & KAYDET */}
        <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-black/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            {selectedRows.length > 0 ? (
              <span>
                <strong className="text-white">{selectedRows.length} fatura</strong> işlenecek
                {autoCreateCount > 0 && (
                  <>
                    {' '}
                    • <strong className="text-amber-300">{autoCreateCount} yeni cari</strong> oluşturulacak
                  </>
                )}
              </span>
            ) : (
              <span>Yüklemek için yukarıdan .xml veya .ubl fatura seçiniz.</span>
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
              disabled={importing || selectedRows.length === 0}
              onClick={handleImportConfirm}
              data-testid="ubl_import_confirm_button"
              className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-40 text-[#0a0e13] font-extrabold text-xs flex items-center gap-2 shadow-[0_0_20px_rgba(45,212,191,0.25)] transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {importing
                  ? 'Carilere İşleniyor...'
                  : `${selectedRows.length} Faturayı Cariye İşle`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
