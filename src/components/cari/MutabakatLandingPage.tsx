import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Building2,
  FileCheck2,
  Loader2,
  ArrowLeft,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/formatters';
import {
  CariMutabakatRecord,
  describeMutabakatBalance,
  fetchMutabakatByCode,
  submitCounterpartyMutabakatResponse,
} from '../../lib/mutabakatService';

interface MutabakatLandingPageProps {
  mutabakatKodu: string;
  onExit: () => void;
}

export const MutabakatLandingPage: React.FC<MutabakatLandingPageProps> = ({
  mutabakatKodu,
  onExit,
}) => {
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<CariMutabakatRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cevaplayanAd, setCevaplayanAd] = useState('');
  const [mode, setMode] = useState<'select' | 'itiraz'>('select');
  const [itirazTutari, setItirazTutari] = useState('');
  const [itirazNotu, setItirazNotu] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchMutabakatByCode(mutabakatKodu)
      .then((res) => {
        if (cancelled) return;
        if (res.record) {
          setRecord(res.record);
        } else if (res.missingTable) {
          setLoadError('Mutabakat sistemi veritabanı henüz etkinleştirilmemiş.');
        } else {
          setLoadError('Bu mutabakat kaydı bulunamadı veya bağlantı geçersiz.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mutabakatKodu]);

  const handleSubmitResponse = async (durum: 'mutabik' | 'itiraz') => {
    if (!record) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const parsedItiraz = itirazTutari.trim()
        ? parseFloat(itirazTutari.replace(',', '.'))
        : null;

      const res = await submitCounterpartyMutabakatResponse({
        mutabakatKodu: record.mutabakat_kodu,
        durum,
        cevaplayanAd,
        itirazTutari: Number.isFinite(parsedItiraz as number) ? parsedItiraz : null,
        itirazNotu,
      });

      if (!res.ok || !res.record) {
        setSubmitError(res.error || 'Yanıtınız kaydedilemedi.');
        return;
      }

      setRecord(res.record);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#0a0e13] flex flex-col items-center justify-center p-4 text-teal-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm font-semibold text-gray-300">Cari mutabakat belgesi yükleniyor...</p>
      </div>
    );
  }

  if (loadError || !record) {
    return (
      <div className="min-h-[100dvh] bg-[#0a0e13] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#111820] border border-white/10 rounded-2xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-extrabold text-white">Mutabakat Kaydı Bulunamadı</h1>
          <p className="text-xs text-gray-400 leading-relaxed">
            {loadError || 'Link süresi dolmuş veya hatalı olabilir.'}
          </p>
          <button
            type="button"
            onClick={onExit}
            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Ana Sayfaya Dön</span>
          </button>
        </div>
      </div>
    );
  }

  const balanceInfo = describeMutabakatBalance(Number(record.bakiye));
  const kalemler = Array.isArray(record.ozet_kalemler) ? record.ozet_kalemler : [];

  return (
    <div
      className="min-h-[100dvh] bg-slate-950 py-6 px-3 sm:px-6 flex flex-col items-center"
      data-testid="mutabakat_landing_page"
    >
      <div className="w-full max-w-2xl space-y-4">
        {/* ÜST ŞERİT */}
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <div className="flex items-center gap-2 font-semibold text-teal-400">
            <ShieldCheck className="w-4 h-4" />
            <span>Online Cari Hesap Mutabakatı</span>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="text-slate-400 hover:text-white inline-flex items-center gap-1 font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Uygulamaya Git</span>
          </button>
        </div>

        {/* ANA BELGE KARTI (Crisp Paper Document) */}
        <div className="bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
          {/* FİRMA BAŞLIĞI */}
          <div className="p-5 sm:p-7 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-300 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-teal-300 font-bold">
                  Mutabakat Gönderen Firma
                </div>
                <h1 className="text-lg font-black tracking-tight mt-0.5">{record.firma_unvan}</h1>
                <div className="text-xs text-slate-300">
                  {record.firma_vergi_no ? `VKN: ${record.firma_vergi_no}` : ''}
                  {record.firma_telefon ? ` · Tel: ${record.firma_telefon}` : ''}
                </div>
              </div>
            </div>

            <div className="sm:text-right">
              <span className="inline-block px-2.5 py-1 rounded-lg bg-white/10 font-mono text-xs font-bold text-teal-300">
                {record.mutabakat_kodu}
              </span>
              <div className="text-xs text-slate-300 mt-1">
                Mutabakat Tarihi: <strong className="text-white">{formatDate(record.mutabakat_tarihi)}</strong>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7 space-y-5 text-sm">
            {/* MUHATAP CARİ & BAKİYE */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <div className="text-[11px] font-bold uppercase text-slate-500">Muhatap Cari Hesap</div>
                  <div className="text-base font-extrabold text-slate-900">{record.cari_unvan}</div>
                  {record.cari_vergi_no && (
                    <div className="text-xs font-mono text-slate-600">VKN/TCKN: {record.cari_vergi_no}</div>
                  )}
                </div>
                {record.donem_baslik && (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-200/70 text-slate-800 text-xs font-bold">
                    {record.donem_baslik}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                <div>
                  <div className="text-[11px] font-bold uppercase text-slate-500">
                    Kayıtlarımızdaki Net Bakiye
                  </div>
                  <div className="text-sm font-bold text-slate-800">{balanceInfo.yonLabel}</div>
                </div>
                <div className="text-3xl font-black font-mono text-slate-900">
                  {formatCurrency(balanceInfo.absAmount)}
                </div>
              </div>
            </div>

            {/* SON HAREKETLER ÖZETİ */}
            {kalemler.length > 0 && (
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Bakiye Dayanak Hareketleri (Son Kayıtlar)
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="py-2 px-3 text-left">Tarih</th>
                        <th className="py-2 px-3 text-left">İşlem / Belge</th>
                        <th className="py-2 px-3 text-right">Borç</th>
                        <th className="py-2 px-3 text-right">Alacak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kalemler.map((row, idx) => (
                        <tr key={idx} className="border-t border-slate-200">
                          <td className="py-1.5 px-3 whitespace-nowrap">{formatDate(row.tarih)}</td>
                          <td className="py-1.5 px-3">
                            <span className="capitalize font-semibold">{row.tip}</span>
                            {row.belgeNo ? ` (${row.belgeNo})` : ''}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono">
                            {row.borc > 0 ? formatCurrency(row.borc) : '-'}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono">
                            {row.alacak > 0 ? formatCurrency(row.alacak) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* CEVAP FORMU VEYA SONUÇ */}
            {record.durum === 'bekliyor' ? (
              <div className="rounded-xl border-2 border-slate-200 p-4 sm:p-5 space-y-4 bg-white">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>Lütfen yukarıdaki bakiyeyi kontrol ederek mutabakat cevabınızı iletiniz.</span>
                </div>

                {submitError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                    {submitError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Yanıtlayan Yetkili Adı Soyadı / Ünvanı *
                  </label>
                  <input
                    type="text"
                    value={cevaplayanAd}
                    onChange={(e) => setCevaplayanAd(e.target.value)}
                    data-testid="mutabakat_responder_name_input"
                    placeholder="Örn: Mehmet Demir (Muhasebe)"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-teal-600"
                  />
                </div>

                {mode === 'itiraz' && (
                  <div className="space-y-3 p-3.5 rounded-xl bg-orange-50 border border-orange-200">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Kendi Kayıtlarınızdaki Bakiye (₺ - Opsiyonel)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={itirazTutari}
                        onChange={(e) => setItirazTutari(e.target.value)}
                        data-testid="mutabakat_dispute_amount_input"
                        placeholder="Örn: 12500"
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Fark / İtiraz Açıklaması *
                      </label>
                      <textarea
                        rows={3}
                        value={itirazNotu}
                        onChange={(e) => setItirazNotu(e.target.value)}
                        data-testid="mutabakat_dispute_note_input"
                        placeholder="Örn: 14.11.2026 tarihli 5.000 TL havale ödememiz ekstrede görünmüyor."
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleSubmitResponse('mutabik')}
                    data-testid="mutabakat_approve_btn"
                    className="min-h-[48px] px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    <span>{submitting ? 'Kaydediliyor...' : 'Mutabıkım (Onayla)'}</span>
                  </button>

                  {mode === 'select' ? (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => setMode('itiraz')}
                      data-testid="mutabakat_open_dispute_btn"
                      className="min-h-[48px] px-4 py-3 rounded-xl bg-orange-50 hover:bg-orange-100 border-2 border-orange-500 text-orange-800 font-extrabold text-sm flex items-center justify-center gap-2 transition"
                    >
                      <AlertTriangle className="w-5 h-5" />
                      <span>Mutabık Değilim (İtiraz)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleSubmitResponse('itiraz')}
                      data-testid="mutabakat_submit_dispute_btn"
                      className="min-h-[48px] px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50"
                    >
                      <AlertTriangle className="w-5 h-5" />
                      <span>{submitting ? 'Gönderiliyor...' : 'İtiraz Cevabını Gönder'}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                data-testid="mutabakat_completed_card"
                className={`rounded-xl p-5 border-2 space-y-2 ${
                  record.durum === 'mutabik'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : 'bg-red-50 border-red-300 text-red-950'
                }`}
              >
                <div className="flex items-center gap-2.5 text-base font-black">
                  {record.durum === 'mutabik' ? (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                      <span>Mutabakat Onaylandı (Mutabıkım)</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-6 h-6 text-red-600" />
                      <span>İtiraz / Fark Bildirimi Alındı</span>
                    </>
                  )}
                </div>
                <p className="text-xs">
                  Yanıtlayan: <strong>{record.cevaplayan_ad}</strong>
                  {record.cevap_tarihi ? ` · Tarih: ${formatDate(record.cevap_tarihi)}` : ''}
                </p>
                {record.durum === 'itiraz' && (
                  <div className="text-xs bg-white/80 rounded-lg p-3 border border-red-200 space-y-1">
                    {record.itiraz_tutari !== null && record.itiraz_tutari !== undefined && (
                      <div>
                        Bildirilen Karşı Bakiye:{' '}
                        <strong className="font-mono">{formatCurrency(Number(record.itiraz_tutari))}</strong>
                      </div>
                    )}
                    {record.itiraz_notu && <div>Açıklama: {record.itiraz_notu}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
