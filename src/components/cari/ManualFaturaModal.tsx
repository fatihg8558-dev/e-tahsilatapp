import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  FileText,
  ArrowUpRight,
  ArrowDownLeft,
  Calculator,
  Wallet,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Cari, FaturaYon, Kasa } from '../../types/database';
import { formatCurrency, getTodayIsoLocal } from '../../lib/formatters';
import {
  FATURA_GELIR_KATEGORILERI,
  FATURA_GIDER_KATEGORILERI,
} from '../../lib/faturaExpenseService';
import {
  calculateGrossFromNetAndVat,
  createManualFaturaRecord,
  generateManualFaturaNoSuggestion,
  splitGrossToNetAndVat,
} from '../../lib/manualFaturaService';

interface ManualFaturaModalProps {
  isOpen: boolean;
  onClose: () => void;
  cariler?: Cari[];
  initialCari?: Cari | null;
  lockCari?: boolean;
  initialYon?: FaturaYon;
  defaultSyncToKasa?: boolean;
  onSaved: () => Promise<void> | void;
}

const VAT_RATES = [0, 1, 10, 20];

export const ManualFaturaModal: React.FC<ManualFaturaModalProps> = ({
  isOpen,
  onClose,
  cariler: externalCariler,
  initialCari,
  lockCari = false,
  initialYon = 'satis',
  defaultSyncToKasa = false,
  onSaved,
}) => {
  const { firma, profile, isPeriodExpired } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id || '';

  const [yon, setYon] = useState<FaturaYon>(initialYon);
  const [cariList, setCariList] = useState<Cari[]>(externalCariler || []);
  const [cariSearch, setCariSearch] = useState('');
  const [selectedCariId, setSelectedCariId] = useState<string>(initialCari?.id || '');
  const [faturaNo, setFaturaNo] = useState('');
  const [tarih, setTarih] = useState(getTodayIsoLocal);
  const [vadeTarihi, setVadeTarihi] = useState('');
  const [amountInputMode, setAmountInputMode] = useState<'gross' | 'net'>('gross');
  const [rawAmount, setRawAmount] = useState('');
  const [kdvOrani, setKdvOrani] = useState<number>(20);
  const [aciklama, setAciklama] = useState('');

  const [syncToKasa, setSyncToKasa] = useState<boolean>(defaultSyncToKasa);
  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [selectedKasaId, setSelectedKasaId] = useState('');
  const [selectedKategori, setSelectedKategori] = useState('');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setYon(initialYon);
    setSelectedCariId(initialCari?.id || '');
    setCariSearch('');
    setFaturaNo(generateManualFaturaNoSuggestion(initialYon));
    setTarih(getTodayIsoLocal());
    setVadeTarihi('');
    setAmountInputMode('gross');
    setRawAmount('');
    setKdvOrani(20);
    setAciklama('');
    setSyncToKasa(defaultSyncToKasa);
    setSelectedKategori(
      initialYon === 'satis' ? FATURA_GELIR_KATEGORILERI[0] : FATURA_GIDER_KATEGORILERI[0]
    );
    setFeedback(null);
  }, [isOpen, initialCari?.id, initialYon, defaultSyncToKasa]);

  useEffect(() => {
    if (externalCariler && externalCariler.length > 0) {
      setCariList(externalCariler);
    }
  }, [externalCariler]);

  useEffect(() => {
    if (!isOpen || !effectiveFirmaId) return;
    let cancelled = false;

    const loadDeps = async () => {
      const requests: Promise<void>[] = [];

      if (!externalCariler || externalCariler.length === 0) {
        requests.push(
          Promise.resolve(
            supabase
              .from('cariler')
              .select('*')
              .eq('firma_id', effectiveFirmaId)
              .order('unvan', { ascending: true })
          ).then(({ data }) => {
            if (!cancelled && data) setCariList(data as Cari[]);
          })
        );
      }

      requests.push(
        Promise.resolve(
          supabase
            .from('kasalar')
            .select('*')
            .eq('firma_id', effectiveFirmaId)
            .eq('aktif', true)
            .order('created_at', { ascending: true })
        ).then(({ data }) => {
          if (!cancelled && data) {
            const kList = data as Kasa[];
            setKasalar(kList);
            if (kList.length > 0) {
              const best = kList.find((k) => k.tur === 'nakit') || kList[0];
              setSelectedKasaId((prev) => prev || best.id);
            }
          }
        })
      );

      await Promise.all(requests);
    };

    void loadDeps();
    return () => {
      cancelled = true;
    };
  }, [isOpen, effectiveFirmaId, externalCariler]);

  const handleSwitchYon = (nextYon: FaturaYon) => {
    setYon(nextYon);
    setSelectedKategori(
      nextYon === 'satis' ? FATURA_GELIR_KATEGORILERI[0] : FATURA_GIDER_KATEGORILERI[0]
    );
    if (/^(SAT|ALS)\d{8}-\d{3}$/.test(faturaNo.trim())) {
      setFaturaNo(generateManualFaturaNoSuggestion(nextYon));
    }
  };

  const filteredCariler = useMemo(() => {
    const q = cariSearch.trim().toLocaleLowerCase('tr-TR');
    const sorted = [...cariList].sort((a, b) => {
      // Satışta alıcıları, alışta tedarikçileri öne al
      const prefTur = yon === 'satis' ? 'alici' : 'tedarikci';
      if (a.tur === prefTur && b.tur !== prefTur) return -1;
      if (b.tur === prefTur && a.tur !== prefTur) return 1;
      return a.unvan.localeCompare(b.unvan, 'tr-TR');
    });
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.unvan.toLocaleLowerCase('tr-TR').includes(q) ||
        (c.vergi_tc_no || '').toLowerCase().includes(q)
    );
  }, [cariList, cariSearch, yon]);

  const selectedCari = useMemo(
    () =>
      (initialCari && initialCari.id === selectedCariId ? initialCari : null) ||
      cariList.find((c) => c.id === selectedCariId) ||
      null,
    [initialCari, cariList, selectedCariId]
  );

  const numericInput = useMemo(() => {
    const clean = parseFloat(rawAmount.replace(',', '.'));
    return Number.isFinite(clean) && clean > 0 ? clean : 0;
  }, [rawAmount]);

  const computedSummary = useMemo(() => {
    if (amountInputMode === 'net') {
      const toplam = calculateGrossFromNetAndVat(numericInput, kdvOrani);
      const kdvTutar = Math.round((toplam - numericInput) * 100) / 100;
      return { matrah: numericInput, kdvTutar, toplam };
    }
    const split = splitGrossToNetAndVat(numericInput, kdvOrani);
    return { matrah: split.matrah, kdvTutar: split.kdvTutar, toplam: numericInput };
  }, [amountInputMode, numericInput, kdvOrani]);

  if (!isOpen) return null;

  const kategoriList =
    yon === 'satis' ? FATURA_GELIR_KATEGORILERI : FATURA_GIDER_KATEGORILERI;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFirmaId) return;

    if (isPeriodExpired) {
      setFeedback({
        type: 'error',
        text: 'Abonelik / deneme süreniz dolmuş görünüyor. Lütfen paket yenileyiniz.',
      });
      return;
    }

    if (!selectedCari) {
      setFeedback({ type: 'error', text: 'Lütfen fatura kesilecek/alınacak cari hesabı seçiniz.' });
      return;
    }

    if (computedSummary.toplam <= 0) {
      setFeedback({ type: 'error', text: 'Lütfen sıfırdan büyük bir fatura tutarı giriniz.' });
      return;
    }

    setSaving(true);
    setFeedback(null);

    try {
      const res = await createManualFaturaRecord({
        firmaId: effectiveFirmaId,
        firma,
        cari: selectedCari,
        faturaNo,
        tarih,
        yon,
        toplamTutar: computedSummary.toplam,
        kdvOrani,
        aciklama,
        vadeTarihi,
        syncToKasa,
        kasaId: selectedKasaId || null,
        kasaKategori: selectedKategori,
        userId: profile?.id || null,
        knownKasalar: kasalar,
      });

      if (!res.success) {
        setFeedback({ type: 'error', text: res.error || 'Fatura kaydedilemedi.' });
        return;
      }

      await onSaved();

      if (res.kasaWarning) {
        setFeedback({ type: 'error', text: res.kasaWarning });
        return;
      }

      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[72] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      data-testid="manual_fatura_modal"
    >
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* BAŞLIK */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-black/25">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                Elle Alış / Satış Faturası Girişi
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Tüm paketlerde açık • Cari mutabakatına işlenir, isteğe bağlı kasaya yansır
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

        {/* FORM GÖVDESİ */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs">
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
              <span>{feedback.text}</span>
            </div>
          )}

          {/* YÖN SEÇİMİ */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-black/35 border border-white/10">
            <button
              type="button"
              onClick={() => handleSwitchYon('satis')}
              data-testid="manual_fatura_yon_satis"
              className={`px-3 py-2.5 rounded-lg font-extrabold flex items-center justify-center gap-1.5 transition ${
                yon === 'satis'
                  ? 'bg-teal-400 text-[#0a0e13] shadow-sm'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Satış Faturası (Borçlandırır)</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchYon('alis')}
              data-testid="manual_fatura_yon_alis"
              className={`px-3 py-2.5 rounded-lg font-extrabold flex items-center justify-center gap-1.5 transition ${
                yon === 'alis'
                  ? 'bg-orange-400 text-[#0a0e13] shadow-sm'
                  : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Alış Faturası (Alacaklandırır)</span>
            </button>
          </div>

          {/* CARİ SEÇİMİ */}
          <div className="space-y-1.5">
            <label className="block text-gray-300 font-semibold">
              Cari Hesap (Müşteri / Tedarikçi) *
            </label>
            {lockCari && initialCari ? (
              <div className="p-3 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-white">{initialCari.unvan}</div>
                  {initialCari.vergi_tc_no && (
                    <div className="text-[10px] font-mono text-gray-400">
                      VKN/TCKN: {initialCari.vergi_tc_no}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-mono font-bold text-teal-300">
                  Bakiye: {formatCurrency(Number(initialCari.bakiye) || 0)}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={cariSearch}
                  onChange={(e) => setCariSearch(e.target.value)}
                  placeholder="Cari ünvanı veya VKN ile hızlı ara..."
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
                <select
                  required
                  value={selectedCariId}
                  onChange={(e) => setSelectedCariId(e.target.value)}
                  data-testid="manual_fatura_cari_select"
                  className="w-full min-h-[42px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
                >
                  <option value="">-- Cari Seçiniz ({filteredCariler.length} kayıt) --</option>
                  {filteredCariler.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.unvan} ({c.tur === 'alici' ? 'Alıcı' : 'Tedarikçi'}) — Bakiye:{' '}
                      {formatCurrency(Number(c.bakiye) || 0)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* FATURA NO + TARİH + VADE */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-gray-300 font-semibold">Fatura No *</label>
                <button
                  type="button"
                  onClick={() => setFaturaNo(generateManualFaturaNoSuggestion(yon))}
                  className="text-[10px] text-teal-300 hover:underline flex items-center gap-0.5"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Otomatik</span>
                </button>
              </div>
              <input
                type="text"
                required
                value={faturaNo}
                onChange={(e) => setFaturaNo(e.target.value)}
                data-testid="manual_fatura_no_input"
                placeholder="Örn: FAT202600001"
                className="w-full min-h-[42px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 font-mono text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
              />
            </div>

            <div>
              <label className="block text-gray-300 font-semibold mb-1">Fatura Tarihi *</label>
              <input
                type="date"
                required
                value={tarih}
                onChange={(e) => setTarih(e.target.value)}
                data-testid="manual_fatura_date_input"
                className="w-full min-h-[42px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
              />
            </div>

            <div>
              <label className="block text-gray-300 font-semibold mb-1">Vade Tarihi (Opsiyonel)</label>
              <input
                type="date"
                value={vadeTarihi}
                onChange={(e) => setVadeTarihi(e.target.value)}
                className="w-full min-h-[42px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
              />
            </div>
          </div>

          {/* TUTAR VE KDV HESAPLAYICI */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.08] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-teal-400" />
                <span>Tutar &amp; KDV Bilgisi</span>
              </span>
              <div className="inline-flex rounded-lg bg-[#0a0e13] border border-white/10 p-0.5 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setAmountInputMode('gross')}
                  className={`px-2 py-1 rounded-md transition ${
                    amountInputMode === 'gross'
                      ? 'bg-teal-400 text-[#0a0e13]'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  KDV Dahil Gir
                </button>
                <button
                  type="button"
                  onClick={() => setAmountInputMode('net')}
                  className={`px-2 py-1 rounded-md transition ${
                    amountInputMode === 'net'
                      ? 'bg-teal-400 text-[#0a0e13]'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Matrah + KDV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-300 font-semibold mb-1">
                  {amountInputMode === 'gross' ? 'Genel Toplam Tutar (₺) *' : 'KDV Hariç Matrah (₺) *'}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={rawAmount}
                  onChange={(e) => setRawAmount(e.target.value)}
                  data-testid="manual_fatura_amount_input"
                  placeholder="0,00"
                  className="w-full min-h-[42px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 font-mono text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-semibold mb-1">KDV Oranı</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {VAT_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setKdvOrani(rate)}
                      className={`min-h-[42px] rounded-xl font-bold border transition ${
                        kdvOrani === rate
                          ? 'bg-teal-400/20 border-teal-400 text-teal-300'
                          : 'bg-[#0a0e13] border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      %{rate}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {computedSummary.toplam > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
                <span className="text-gray-400">
                  Matrah: <strong className="text-gray-200 font-mono">{formatCurrency(computedSummary.matrah)}</strong>
                  {' • '}KDV (%{kdvOrani}):{' '}
                  <strong className="text-gray-200 font-mono">{formatCurrency(computedSummary.kdvTutar)}</strong>
                </span>
                <span className="font-extrabold text-teal-300 font-mono">
                  Cariye İşlenecek: {formatCurrency(computedSummary.toplam)}
                </span>
              </div>
            )}
          </div>

          {/* AÇIKLAMA */}
          <div>
            <label className="block text-gray-300 font-semibold mb-1">
              Açıklama / Mal &amp; Hizmet Kalemi (Opsiyonel)
            </label>
            <input
              type="text"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              placeholder="Örn: Ekim ayı malzeme sevkiyat faturası"
              className="w-full min-h-[40px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* KASA GELİR / GİDER SENKRONİZASYONU */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.08] space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={syncToKasa}
                onChange={(e) => setSyncToKasa(e.target.checked)}
                data-testid="manual_fatura_sync_kasa_checkbox"
                className="mt-0.5 w-4 h-4 accent-teal-400 rounded cursor-pointer"
              />
              <div>
                <div className="font-bold text-white flex items-center gap-1.5">
                  <Wallet className="w-3.5 h-3.5 text-amber-300" />
                  <span>
                    {yon === 'alis'
                      ? 'Aynı Anda Kasaya Gider Olarak İşle (Giderleştir)'
                      : 'Aynı Anda Kasaya Peşin Gelir Olarak İşle'}
                  </span>
                </div>
                <p className="text-[10.5px] text-gray-400 mt-0.5">
                  Vadeli/açık hesap faturalarda kapalı bırakabilirsiniz. Açık bırakılırsa seçilen kasanın bakiyesi ve Gelir-Gider defteri güncellenir.
                </p>
              </div>
            </label>

            {syncToKasa && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
                <div>
                  <label className="block text-gray-300 font-semibold mb-1">Hedef Kasa / Banka</label>
                  <select
                    value={selectedKasaId}
                    onChange={(e) => setSelectedKasaId(e.target.value)}
                    data-testid="manual_fatura_kasa_select"
                    className="w-full min-h-[38px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-teal-400"
                  >
                    <option value="">Otomatik (Varsayılan Kasa)</option>
                    {kasalar.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.ad} ({k.tur.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-gray-300 font-semibold mb-1">
                    {yon === 'satis' ? 'Gelir Kategorisi' : 'Gider Kategorisi'}
                  </label>
                  <select
                    value={selectedKategori}
                    onChange={(e) => setSelectedKategori(e.target.value)}
                    className="w-full min-h-[38px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-teal-400"
                  >
                    {kategoriList.map((kat) => (
                      <option key={kat} value={kat}>
                        {kat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* BUTONLAR */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 font-semibold transition"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="manual_fatura_submit_btn"
              className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-extrabold flex items-center gap-1.5 shadow-lg transition disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{saving ? 'Kaydediliyor...' : 'Faturayı Kaydet'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
