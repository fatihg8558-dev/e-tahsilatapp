import React, { useRef } from 'react';
import {
  Banknote,
  CreditCard,
  FileCheck,
  FileText,
  Calendar,
  Plus,
  Trash2,
  Share2,
  Copy,
  Layers,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { ExchangeRates } from '../../lib/currencyService';
import { formatCurrency } from '../../lib/formatters';
import { PosConfig, PaymentLinkResult } from '../../lib/posService';
import {
  CekRowItem,
  KarmaNakitState,
  KarmaKartState,
  KarmaSaveMode,
  createEmptyCekRow,
  formatIsoToDisplay,
  getRowTlEquivalent,
  parseAmountInput,
  parseVadeToIso,
} from '../../lib/karmaReceiptHelper';

interface KarmaPaymentSectionProps {
  nakit: KarmaNakitState;
  onChangeNakit: (next: KarmaNakitState) => void;
  kart: KarmaKartState;
  onChangeKart: (next: KarmaKartState) => void;
  cekler: CekRowItem[];
  onChangeCekler: (next: CekRowItem[]) => void;
  senetler: CekRowItem[];
  onChangeSenetler: (next: CekRowItem[]) => void;
  saveMode: KarmaSaveMode;
  onChangeSaveMode: (mode: KarmaSaveMode) => void;
  isEditing: boolean;
  exchangeRates: ExchangeRates | null;
  posConfig: PosConfig;
  posLinkGenerated: PaymentLinkResult | null;
  onCreatePosLinkForKarma: (kartTlAmount: number) => void;
  onSendPosLinkWhatsApp: () => void;
}

export const KarmaPaymentSection: React.FC<KarmaPaymentSectionProps> = ({
  nakit,
  onChangeNakit,
  kart,
  onChangeKart,
  cekler,
  onChangeCekler,
  senetler,
  onChangeSenetler,
  saveMode,
  onChangeSaveMode,
  isEditing,
  exchangeRates,
  posConfig,
  posLinkGenerated,
  onCreatePosLinkForKarma,
  onSendPosLinkWhatsApp,
}) => {
  const vadeRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const defaultUsdKur = (exchangeRates?.USD || 38.45).toString().replace('.', ',');
  const defaultEurKur = (exchangeRates?.EUR || 41.2).toString().replace('.', ',');

  const nakitTL = getRowTlEquivalent(nakit.tutar, nakit.paraBirimi, nakit.kur, exchangeRates);
  const kartTL = getRowTlEquivalent(kart.tutar, kart.paraBirimi, kart.kur, exchangeRates);
  const ceklerTL =
    Math.round(
      cekler.reduce(
        (acc, c) => acc + getRowTlEquivalent(c.tutar, c.paraBirimi, c.kur, exchangeRates),
        0
      ) * 100
    ) / 100;
  const senetlerTL =
    Math.round(
      senetler.reduce(
        (acc, s) => acc + getRowTlEquivalent(s.tutar, s.paraBirimi, s.kur, exchangeRates),
        0
      ) * 100
    ) / 100;
  const genelToplamTL = Math.round((nakitTL + kartTL + ceklerTL + senetlerTL) * 100) / 100;

  const formatVadeDigits = (input: string): string => {
    const digits = input.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
    return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  };

  const getQuickVadeStr = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  };

  const renderInstrumentList = (
    kind: 'cek' | 'senet',
    items: CekRowItem[],
    onChangeItems: (next: CekRowItem[]) => void
  ) => {
    const isCek = kind === 'cek';
    const title = isCek ? 'Çekler' : 'Senetler';
    const singleTitle = isCek ? 'Çek' : 'Senet';
    const accentBorder = isCek ? 'border-teal-500/25' : 'border-amber-500/25';
    const badgeBg = isCek ? 'bg-teal-500/20 text-teal-300' : 'bg-amber-500/20 text-amber-300';
    const subtotal = isCek ? ceklerTL : senetlerTL;

    const updateRow = (id: string, patch: Partial<CekRowItem>) => {
      onChangeItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    };

    const addRow = () => {
      onChangeItems([...items, createEmptyCekRow()]);
    };

    const removeRow = (id: string) => {
      onChangeItems(items.filter((item) => item.id !== id));
    };

    return (
      <div className={`p-4 rounded-xl bg-black/35 border ${accentBorder} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            {isCek ? (
              <FileCheck className="w-4 h-4 text-teal-400" />
            ) : (
              <FileText className="w-4 h-4 text-amber-400" />
            )}
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              {title} ({items.length} Adet)
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            {subtotal > 0 && (
              <span className="text-xs font-mono font-bold text-teal-300">
                {formatCurrency(subtotal)}
              </span>
            )}
            <button
              type="button"
              onClick={addRow}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition active:scale-95 ${
                isCek
                  ? 'bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40'
                  : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ {singleTitle} Ekle</span>
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="py-3 px-3 rounded-xl border border-dashed border-white/10 text-[11px] text-gray-400 flex items-center justify-between gap-2">
            <span>Bu makbuzda henüz {singleTitle.toLowerCase()} satırı yok (isteğe bağlı).</span>
            <button
              type="button"
              onClick={addRow}
              className="text-teal-400 hover:text-teal-300 font-bold underline shrink-0"
            >
              + {singleTitle} Ekle
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((row, idx) => {
              const rowTl = getRowTlEquivalent(
                row.tutar,
                row.paraBirimi,
                row.kur,
                exchangeRates
              );
              const defaultKur = row.paraBirimi === 'USD' ? defaultUsdKur : defaultEurKur;
              const pickerKey = `${kind}-${row.id}`;

              return (
                <div
                  key={row.id}
                  className="p-3 rounded-xl bg-[#0a0e13] border border-white/10 space-y-2.5"
                >
                  <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${badgeBg}`}>
                        {idx + 1}. {singleTitle}
                      </span>
                      {row.tutar && parseAmountInput(row.tutar) > 0 && (
                        <span className="text-[11px] font-mono text-gray-300">
                          {parseAmountInput(row.tutar).toLocaleString('tr-TR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          {row.paraBirimi === 'TRY' ? 'TL' : row.paraBirimi}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex rounded-lg bg-black/60 p-0.5 border border-white/10 text-[10px]">
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, { durum: 'keside' })}
                          className={`px-2 py-1 rounded font-bold transition ${
                            row.durum === 'keside'
                              ? 'bg-emerald-500 text-slate-950'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          Keşide
                        </button>
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, { durum: 'ciro' })}
                          className={`px-2 py-1 rounded font-bold transition ${
                            row.durum === 'ciro'
                              ? 'bg-amber-400 text-slate-950'
                              : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          Ciro
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/15 transition"
                        title={`Bu ${singleTitle} Satırını Kaldır`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                        {singleTitle} / Belge No
                      </label>
                      <input
                        type="text"
                        value={row.no}
                        onChange={(e) => updateRow(row.id, { no: e.target.value })}
                        placeholder={isCek ? 'Örn: CK-98421' : 'Örn: SN-1042'}
                        className="w-full bg-[#111820] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                        Vade Tarihi (GG.AA.YYYY) *
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.vade}
                          onChange={(e) =>
                            updateRow(row.id, { vade: formatVadeDigits(e.target.value) })
                          }
                          placeholder="Örn: 15.12.2026"
                          maxLength={10}
                          className="w-full bg-[#111820] border border-white/10 rounded-xl pl-3 pr-9 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono tracking-wider"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const refEl = vadeRefs.current[pickerKey];
                            if (refEl) {
                              if (typeof (refEl as any).showPicker === 'function') {
                                (refEl as any).showPicker();
                              } else {
                                refEl.click();
                              }
                            }
                          }}
                          className="absolute right-1.5 p-1 rounded-lg text-teal-400 hover:text-teal-300 hover:bg-white/10 transition"
                          title="Takvimi Aç"
                        >
                          <Calendar className="w-4 h-4" />
                        </button>
                        <input
                          ref={(el) => {
                            vadeRefs.current[pickerKey] = el;
                          }}
                          type="date"
                          tabIndex={-1}
                          value={parseVadeToIso(row.vade) || ''}
                          onChange={(e) => {
                            if (e.target.value) {
                              updateRow(row.id, { vade: formatIsoToDisplay(e.target.value) });
                            }
                          }}
                          className="sr-only opacity-0 absolute pointer-events-none"
                        />
                      </div>
                      <div className="flex items-center gap-1 mt-1 overflow-x-auto">
                        {[
                          { label: 'Bugün', days: 0 },
                          { label: '30G', days: 30 },
                          { label: '60G', days: 60 },
                          { label: '90G', days: 90 },
                          { label: '120G', days: 120 },
                        ].map((q) => (
                          <button
                            key={q.days}
                            type="button"
                            onClick={() => updateRow(row.id, { vade: getQuickVadeStr(q.days) })}
                            className="px-2 py-0.5 rounded bg-white/5 hover:bg-teal-500/20 text-gray-300 hover:text-teal-300 text-[10px] font-semibold border border-white/10 transition shrink-0"
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                        {isCek ? 'Banka Adı / Şube' : 'Banka / Düzenleyen'}
                      </label>
                      <input
                        type="text"
                        value={row.banka}
                        onChange={(e) => updateRow(row.id, { banka: e.target.value })}
                        placeholder={isCek ? 'Örn: Garanti BBVA' : 'Örn: İş Bankası / Merkez'}
                        className="w-full bg-[#111820] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-teal-300 mb-1">
                        {singleTitle} Tutarı *
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.tutar}
                        onChange={(e) => updateRow(row.id, { tutar: e.target.value })}
                        placeholder="Örn: 25.000,00"
                        className="w-full bg-[#111820] border border-teal-500/30 rounded-xl px-3 py-2 text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                        Para Birimi
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        {(['TRY', 'USD', 'EUR'] as const).map((curr) => (
                          <button
                            key={curr}
                            type="button"
                            onClick={() =>
                              updateRow(row.id, {
                                paraBirimi: curr,
                                kur:
                                  curr === 'TRY'
                                    ? ''
                                    : row.kur || (curr === 'USD' ? defaultUsdKur : defaultEurKur),
                              })
                            }
                            className={`py-2 rounded-xl border text-[11px] font-bold transition ${
                              row.paraBirimi === curr
                                ? 'bg-teal-400 text-slate-950 border-teal-400'
                                : 'bg-[#111820] border-white/10 text-gray-300 hover:text-white'
                            }`}
                          >
                            {curr === 'TRY' ? '₺ TL' : curr === 'USD' ? '$ USD' : '€ EUR'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {row.paraBirimi !== 'TRY' ? (
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                          Kur (₺) • TL: {formatCurrency(rowTl)}
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={row.kur || defaultKur}
                          onChange={(e) => updateRow(row.id, { kur: e.target.value })}
                          placeholder={defaultKur}
                          className="w-full bg-[#111820] border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-teal-300 focus:outline-none focus:border-teal-400 font-mono"
                        />
                      </div>
                    ) : (
                      <div className="hidden sm:flex items-end pb-2 text-[11px] text-gray-400 font-mono">
                        TL Karşılığı: {formatCurrency(rowTl)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* ÜST BİLGİ BANNER */}
      <div className="p-3.5 rounded-xl bg-gradient-to-r from-teal-500/15 via-cyan-500/10 to-indigo-500/15 border border-teal-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <Layers className="w-4 h-4 text-teal-300 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-white">
              Karma / Çoklu Ödeme Makbuzu Modu
            </div>
            <p className="text-[11px] text-gray-300 mt-0.5">
              Aynı makbuzda Nakit, Kredi Kartı, Çek ve Senet kalemlerinden dilediklerinizi birlikte girebilirsiniz. Boş bıraktığınız türler makbuza eklenmez.
            </p>
          </div>
        </div>
        {exchangeRates && (
          <span className="text-[10px] text-gray-300 flex items-center gap-1 shrink-0 bg-black/30 px-2.5 py-1 rounded-lg border border-white/10">
            <TrendingUp className="w-3 h-3 text-teal-400" />
            <span>TCMB: $ {exchangeRates.USD} | € {exchangeRates.EUR}</span>
          </span>
        )}
      </div>

      {/* 1. NAKİT GİRİŞİ */}
      <div className="p-4 rounded-xl bg-black/35 border border-emerald-500/25 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              1. Nakit Ödeme
            </span>
          </div>
          {nakitTL > 0 && (
            <span className="text-xs font-mono font-bold text-emerald-400">
              {formatCurrency(nakitTL)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
              Nakit Tutarı
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={nakit.tutar}
              onChange={(e) => onChangeNakit({ ...nakit, tutar: e.target.value })}
              placeholder="0,00 (Opsiyonel)"
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-emerald-400 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
              Para Birimi
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(['TRY', 'USD', 'EUR'] as const).map((curr) => (
                <button
                  key={curr}
                  type="button"
                  onClick={() =>
                    onChangeNakit({
                      ...nakit,
                      paraBirimi: curr,
                      kur:
                        curr === 'TRY'
                          ? ''
                          : nakit.kur || (curr === 'USD' ? defaultUsdKur : defaultEurKur),
                    })
                  }
                  className={`py-2 rounded-xl border text-[11px] font-bold transition ${
                    nakit.paraBirimi === curr
                      ? 'bg-emerald-400 text-slate-950 border-emerald-400'
                      : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                  }`}
                >
                  {curr === 'TRY' ? '₺ TL' : curr === 'USD' ? '$ USD' : '€ EUR'}
                </button>
              ))}
            </div>
          </div>

          {nakit.paraBirimi !== 'TRY' ? (
            <div>
              <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                Kur (₺) • TL: {formatCurrency(nakitTL)}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={nakit.kur}
                onChange={(e) => onChangeNakit({ ...nakit, kur: e.target.value })}
                placeholder={nakit.paraBirimi === 'USD' ? defaultUsdKur : defaultEurKur}
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-emerald-300 focus:outline-none focus:border-emerald-400 font-mono"
              />
            </div>
          ) : (
            <div className="hidden sm:flex items-end pb-2 text-[11px] text-gray-400">
              Peşin / Kasa nakit tutarı
            </div>
          )}
        </div>
      </div>

      {/* 2. KREDİ KARTI GİRİŞİ */}
      <div className="p-4 rounded-xl bg-black/35 border border-sky-500/25 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-sky-400" />
            <span className="font-bold text-white text-xs uppercase tracking-wider">
              2. Kredi Kartı / POS
            </span>
          </div>
          {kartTL > 0 && (
            <span className="text-xs font-mono font-bold text-sky-400">
              {formatCurrency(kartTL)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
              Kredi Kartı Tutarı
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={kart.tutar}
              onChange={(e) => onChangeKart({ ...kart, tutar: e.target.value })}
              placeholder="0,00 (Opsiyonel)"
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-sm font-bold text-white placeholder-gray-500 focus:outline-none focus:border-sky-400 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
              Para Birimi
            </label>
            <div className="grid grid-cols-3 gap-1">
              {(['TRY', 'USD', 'EUR'] as const).map((curr) => (
                <button
                  key={curr}
                  type="button"
                  onClick={() =>
                    onChangeKart({
                      ...kart,
                      paraBirimi: curr,
                      kur:
                        curr === 'TRY'
                          ? ''
                          : kart.kur || (curr === 'USD' ? defaultUsdKur : defaultEurKur),
                    })
                  }
                  className={`py-2 rounded-xl border text-[11px] font-bold transition ${
                    kart.paraBirimi === curr
                      ? 'bg-sky-400 text-slate-950 border-sky-400'
                      : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                  }`}
                >
                  {curr === 'TRY' ? '₺ TL' : curr === 'USD' ? '$ USD' : '€ EUR'}
                </button>
              ))}
            </div>
          </div>

          {kart.paraBirimi !== 'TRY' ? (
            <div>
              <label className="block text-[11px] font-semibold text-gray-300 mb-1">
                Kur (₺) • TL: {formatCurrency(kartTL)}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={kart.kur}
                onChange={(e) => onChangeKart({ ...kart, kur: e.target.value })}
                placeholder={kart.paraBirimi === 'USD' ? defaultUsdKur : defaultEurKur}
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-sky-300 focus:outline-none focus:border-sky-400 font-mono"
              />
            </div>
          ) : (
            <div className="hidden sm:flex items-end pb-2 text-[11px] text-gray-400">
              POS cihazı / sanal POS çekimi
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
              Banka / POS Cihazı
            </label>
            <input
              type="text"
              value={kart.bankaAdi}
              onChange={(e) => onChangeKart({ ...kart, bankaAdi: e.target.value })}
              placeholder="Örn: Garanti POS, Yapı Kredi"
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-sky-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-300 mb-1">
              Slip / Otorizasyon / Kart Ref No
            </label>
            <input
              type="text"
              value={kart.slipNo}
              onChange={(e) => onChangeKart({ ...kart, slipNo: e.target.value })}
              placeholder="Örn: 984521 veya Son 4 Hane"
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-sky-400"
            />
          </div>
        </div>

        {posConfig.enabled && posConfig.provider !== 'none' && (
          <div className="pt-2 border-t border-white/[0.05] flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">
              Kart tutarı için müşteriye Sanal POS linki gönderebilirsiniz:
            </span>
            <button
              type="button"
              onClick={() => onCreatePosLinkForKarma(kartTL)}
              className="px-3 py-1.5 rounded-lg bg-sky-400/20 text-sky-300 hover:bg-sky-400/30 border border-sky-400/30 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Kart Tutarı İçin Link Üret</span>
            </button>
          </div>
        )}

        {posLinkGenerated && (
          <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/30 space-y-2">
            <div className="text-[11px] text-gray-300 font-mono whitespace-pre-line bg-[#0a0e13] p-2.5 rounded border border-white/5">
              {posLinkGenerated.message}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(posLinkGenerated.message);
                  alert('Ödeme linki metni kopyalandı!');
                }}
                className="px-3 py-1 rounded bg-teal-400/20 text-teal-300 text-xs font-bold hover:bg-teal-400/30 transition flex items-center gap-1"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Kopyala</span>
              </button>
              <button
                type="button"
                onClick={onSendPosLinkWhatsApp}
                className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 transition flex items-center gap-1"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>WhatsApp ile Gönder</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. ÇEK GİRİŞİ */}
      {renderInstrumentList('cek', cekler, onChangeCekler)}

      {/* 4. SENET GİRİŞİ */}
      {renderInstrumentList('senet', senetler, onChangeSenetler)}

      {/* 5. CANLI MAKBUZ GENEL TOPLAMI ÖZETİ */}
      <div className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/30 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-teal-300 uppercase tracking-wider">
            Karma Makbuz Genel Özeti
          </span>
          <span className="text-xl font-black text-white font-mono">
            {formatCurrency(genelToplamTL)}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-2 border-t border-teal-500/20">
          <div className="p-2 rounded-lg bg-black/30">
            <span className="text-gray-400 block">Nakit</span>
            <strong className="text-emerald-300 font-mono">{formatCurrency(nakitTL)}</strong>
          </div>
          <div className="p-2 rounded-lg bg-black/30">
            <span className="text-gray-400 block">Kredi Kartı</span>
            <strong className="text-sky-300 font-mono">{formatCurrency(kartTL)}</strong>
          </div>
          <div className="p-2 rounded-lg bg-black/30">
            <span className="text-gray-400 block">Çek ({cekler.length})</span>
            <strong className="text-teal-300 font-mono">{formatCurrency(ceklerTL)}</strong>
          </div>
          <div className="p-2 rounded-lg bg-black/30">
            <span className="text-gray-400 block">Senet ({senetler.length})</span>
            <strong className="text-amber-300 font-mono">{formatCurrency(senetlerTL)}</strong>
          </div>
        </div>
      </div>

      {/* 6. KAYDETME SEÇENEĞİ */}
      <div className="p-4 rounded-xl bg-black/40 border border-white/10 space-y-2.5">
        <label className="block text-xs font-bold text-gray-200 uppercase tracking-wider">
          Kaydetme Seçeneği
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={isEditing}
            onClick={() => onChangeSaveMode('ortak_tur_bazli')}
            className={`p-3 rounded-xl border text-left transition ${
              saveMode === 'ortak_tur_bazli'
                ? 'bg-teal-500/15 border-teal-400 text-white shadow'
                : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:border-white/25'
            } ${isEditing ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-teal-300">
                Ortak Makbuz + Tür Bazlı Kaydet
              </span>
              {saveMode === 'ortak_tur_bazli' && (
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
              Önerilen: Her ödeme türü ayrı satır olarak işlenir (çek/senet vade takibi aktif kalır), önizleme ve PDF tek birleşik makbuz olarak hazırlanır.
            </p>
          </button>

          <button
            type="button"
            disabled={isEditing}
            onClick={() => onChangeSaveMode('tek_satir')}
            className={`p-3 rounded-xl border text-left transition ${
              saveMode === 'tek_satir'
                ? 'bg-teal-500/15 border-teal-400 text-white shadow'
                : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:border-white/25'
            } ${isEditing ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white">
                Tek Satır Birleşik Makbuz Kaydet
              </span>
              {saveMode === 'tek_satir' && (
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
              İşlem listesinde tek kayıt ve tek makbuz numarası görünür; tüm kalemler makbuz dökümünde ve açıklamada saklanır.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
};
