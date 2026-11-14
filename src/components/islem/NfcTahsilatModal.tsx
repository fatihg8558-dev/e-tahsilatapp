import React, { useEffect, useMemo, useState } from 'react';
import { Cari } from '../../types/database';
import { formatCurrency } from '../../lib/formatters';
import {
  PosConfig,
  NfcCardReadDetail,
  authorizeNfcPayment,
  buildCepPosLaunchUrl,
  clearPendingCepPosTx,
  getAndroidNfcStatus,
  isAndroidCepPosInstalled,
  savePendingCepPosTx,
} from '../../lib/posService';
import {
  Wifi,
  CreditCard,
  X,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  RefreshCw,
  ShieldCheck,
  Search,
  ExternalLink,
  Settings,
  Sparkles,
} from 'lucide-react';

export interface NfcPaymentCompletePayload {
  cariId: string;
  tutar: number;
  bankaAdi: string;
  slipNo: string;
  aciklamaTag: string;
  userNote: string;
  isTestMode: boolean;
}

interface NfcTahsilatModalProps {
  isOpen: boolean;
  onClose: () => void;
  firmaId: string;
  cariler: Cari[];
  initialCariId: string;
  initialTutar: string;
  initialAciklama: string;
  posConfig: PosConfig;
  onCompletePayment: (payload: NfcPaymentCompletePayload) => Promise<void>;
}

const parseAmount = (raw: string): number => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return 0;
  if (trimmed.includes(',')) {
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    const n = parseFloat(trimmed.replace(/\./g, ''));
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(trimmed);
  return isNaN(n) ? 0 : n;
};

type NfcStage = 'idle' | 'scanning' | 'detected' | 'authorizing' | 'waiting_ceppost' | 'error';

export const NfcTahsilatModal: React.FC<NfcTahsilatModalProps> = ({
  isOpen,
  onClose,
  firmaId,
  cariler,
  initialCariId,
  initialTutar,
  initialAciklama,
  posConfig,
  onCompletePayment,
}) => {
  const [selectedCariId, setSelectedCariId] = useState(initialCariId);
  const [cariQuery, setCariQuery] = useState('');
  const [tutarInput, setTutarInput] = useState(initialTutar);
  const [aciklamaInput, setAciklamaInput] = useState(initialAciklama);

  const [stage, setStage] = useState<NfcStage>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedCard, setDetectedCard] = useState<NfcCardReadDetail | null>(null);
  const [nfcStatus, setNfcStatus] = useState<'ready' | 'disabled' | 'unsupported' | 'web'>(() =>
    getAndroidNfcStatus()
  );
  const [cepPosInstalled, setCepPosInstalled] = useState<boolean>(() => isAndroidCepPosInstalled());

  useEffect(() => {
    if (isOpen) {
      setSelectedCariId(initialCariId);
      setTutarInput(initialTutar);
      setAciklamaInput(initialAciklama);
      setStage('idle');
      setErrorMessage(null);
      setStatusMessage(null);
      setDetectedCard(null);
      setNfcStatus(getAndroidNfcStatus());
      setCepPosInstalled(isAndroidCepPosInstalled());
    } else {
      window.AndroidBridge?.stopNfcReader?.();
    }
  }, [isOpen, initialCariId, initialTutar, initialAciklama]);

  useEffect(() => {
    return () => {
      window.AndroidBridge?.stopNfcReader?.();
    };
  }, []);

  const filteredCariler = useMemo(() => {
    const q = cariQuery.trim().toLowerCase();
    const list = !q
      ? cariler
      : cariler.filter(
          (c) =>
            c.unvan.toLowerCase().includes(q) ||
            (c.vergi_tc_no && c.vergi_tc_no.toLowerCase().includes(q))
        );
    return [...list].sort((a, b) => {
      if (a.tur === 'alici' && b.tur !== 'alici') return -1;
      if (a.tur !== 'alici' && b.tur === 'alici') return 1;
      return a.unvan.localeCompare(b.unvan, 'tr');
    });
  }, [cariler, cariQuery]);

  const selectedCari = useMemo(
    () => cariler.find((c) => c.id === selectedCariId) || null,
    [cariler, selectedCariId]
  );

  const numericAmount = useMemo(() => parseAmount(tutarInput), [tutarInput]);

  const hasLiveKeys = Boolean(
    posConfig.provider === 'iyzico' &&
      !posConfig.testMode &&
      posConfig.iyzicoApiKey?.trim() &&
      posConfig.iyzicoSecretKey?.trim()
  );

  const finalizeAuthorizedCard = async (
    cardSummary: NfcCardReadDetail,
    source: 'android_nfc' | 'sandbox_sim' | 'ceppost_callback',
    externalAuthCode?: string
  ) => {
    if (!selectedCariId) {
      setStage('error');
      setErrorMessage('Lütfen tahsilat yapılacak cari hesabı seçiniz.');
      return;
    }
    if (numericAmount <= 0) {
      setStage('error');
      setErrorMessage('Lütfen geçerli bir tahsilat tutarı giriniz.');
      return;
    }

    setDetectedCard(cardSummary);
    setStage('detected');
    setErrorMessage(null);
    setStatusMessage('Kart doğrulandı, provizyon ve makbuz kaydı oluşturuluyor...');

    await new Promise((r) => setTimeout(r, 450));
    setStage('authorizing');

    try {
      const auth = await authorizeNfcPayment({
        amount: numericAmount,
        cardSummary,
        config: posConfig,
        source,
        externalAuthCode,
      });

      await onCompletePayment({
        cariId: selectedCariId,
        tutar: numericAmount,
        bankaAdi: auth.bankaAdi,
        slipNo: auth.slipNo,
        aciklamaTag: auth.aciklamaTag,
        userNote: aciklamaInput.trim(),
        isTestMode: auth.isTestMode,
      });
    } catch (err: unknown) {
      setStage('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Tahsilat makbuzu kaydedilirken bir hata oluştu.'
      );
    }
  };

  // Android Native NFC Listener
  useEffect(() => {
    if (!isOpen) return;

    const handleNfcRead = (e: Event) => {
      const detail = (e as CustomEvent<NfcCardReadDetail>).detail;
      if (!detail || !detail.success) {
        setStage('error');
        setErrorMessage(detail?.error || 'Kart okunamadı. Lütfen kartı sabit tutarak tekrar deneyin.');
        return;
      }
      void finalizeAuthorizedCard(detail, 'android_nfc');
    };

    const handleNfcErr = (e: Event) => {
      const detail = (e as CustomEvent<{ error?: string }>).detail;
      setStage('error');
      setErrorMessage(detail?.error || 'NFC okuma hatası. Kartı telefonun arkasına yaklaştırıp bekleyin.');
    };

    window.addEventListener('androidNfcCardRead', handleNfcRead);
    window.addEventListener('androidNfcError', handleNfcErr);
    return () => {
      window.removeEventListener('androidNfcCardRead', handleNfcRead);
      window.removeEventListener('androidNfcError', handleNfcErr);
    };
  });

  if (!isOpen) return null;

  const validateBeforeScan = (): boolean => {
    if (!selectedCariId) {
      setErrorMessage('Lütfen önce tahsilatın işleneceği cari hesabı seçiniz.');
      return false;
    }
    if (numericAmount <= 0) {
      setErrorMessage('Lütfen 0 TL üzerinde geçerli bir tahsilat tutarı giriniz.');
      return false;
    }
    setErrorMessage(null);
    return true;
  };

  const handleStartAndroidNfcScan = () => {
    if (!validateBeforeScan()) return;
    const currentStatus = getAndroidNfcStatus();
    setNfcStatus(currentStatus);

    if (currentStatus === 'disabled') {
      setStage('error');
      setErrorMessage('Telefonunuzun NFC özelliği kapalı. Ayarlardan NFC’yi açıp tekrar deneyin.');
      return;
    }
    if (currentStatus !== 'ready') {
      setStage('error');
      setErrorMessage(
        'Bu cihazda veya tarayıcı önizlemesinde yerel Android NFC donanımı algılanamadı. Aşağıdaki Sandbox Test Kartı butonuyla akışı test edebilirsiniz.'
      );
      return;
    }

    const res = window.AndroidBridge?.startNfcReader?.();
    if (res === 'started') {
      setStage('scanning');
      setStatusMessage('Müşterinin temassız kartını telefonun arka NFC antenine yaklaştırın...');
    } else {
      setStage('error');
      setErrorMessage('NFC okuyucu başlatılamadı.');
    }
  };

  const handleStopScan = () => {
    window.AndroidBridge?.stopNfcReader?.();
    setStage('idle');
    setStatusMessage(null);
  };

  const handleLaunchCepPos = () => {
    if (!validateBeforeScan() || !selectedCari) return;

    const txRef = `CEPPOS-${Date.now().toString().slice(-8)}`;
    savePendingCepPosTx({
      txRef,
      firmaId,
      cariId: selectedCari.id,
      cariUnvan: selectedCari.unvan,
      tutar: numericAmount,
      aciklama: aciklamaInput.trim(),
      createdAt: new Date().toISOString(),
    });

    const launchUrl = buildCepPosLaunchUrl({
      txRef,
      amount: numericAmount,
      customerName: selectedCari.unvan,
      config: posConfig,
    });

    const launched = window.AndroidBridge?.launchCepPosDeepLink?.(launchUrl);
    if (launched && (cepPosInstalled || launchUrl)) {
      setStage('waiting_ceppost');
      setStatusMessage(
        'iyzico Cep POS uygulamasına yönlendirildi. Ödeme tamamlandığında Tahsilatım uygulamasına otomatik dönüş bekleniyor.'
      );
    } else {
      clearPendingCepPosTx();
      setStage('error');
      setErrorMessage(
        'iyzico Cep POS uygulaması cihazda yüklü veya yapılandırılmış değil. Android NFC ile Kart Okut veya Sandbox Test seçeneğini kullanabilirsiniz.'
      );
    }
  };

  const handleSandboxTestCard = () => {
    if (!validateBeforeScan()) return;
    void finalizeAuthorizedCard(
      {
        success: true,
        brand: 'VISA (Test)',
        last4: '4242',
        expiry: '12/29',
        method: 'sandbox_sim',
      },
      'sandbox_sim'
    );
  };

  const showAndroidNfcBtn = (posConfig.cepPosMode || 'hybrid') !== 'app2app';
  const showCepPosBtn = (posConfig.cepPosMode || 'hybrid') !== 'nfc_only';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-[#0b1322] border border-teal-500/25 rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* HEADER */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-gradient-to-r from-teal-500/10 via-[#0f192b] to-black/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shadow-lg">
              <Wifi className="w-5 h-5 rotate-90" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-black text-white tracking-tight">
                  NFC Temassız Tahsilat
                </h2>
                {!hasLiveKeys && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300">
                    TEST / SİMÜLASYON
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400">
                Tutarı girin, kartı okutun ➔ Cariye + Kasaya + Makbuz (PDF/WhatsApp)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              handleStopScan();
              onClose();
            }}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* DONANIM & ENTEGRASYON DURUM ÇUBUĞU */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/30 border border-white/[0.07] text-[11px]">
            <div className="flex items-center gap-2">
              <Smartphone className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-gray-300">
                NFC:{' '}
                <strong
                  className={
                    nfcStatus === 'ready'
                      ? 'text-emerald-400'
                      : nfcStatus === 'disabled'
                      ? 'text-amber-400'
                      : 'text-gray-400'
                  }
                >
                  {nfcStatus === 'ready'
                    ? 'Hazır'
                    : nfcStatus === 'disabled'
                    ? 'Kapalı'
                    : nfcStatus === 'web'
                    ? 'Tarayıcı Önizleme'
                    : 'Desteklenmiyor'}
                </strong>
              </span>
            </div>

            {nfcStatus === 'disabled' && (
              <button
                type="button"
                onClick={() => window.AndroidBridge?.openNfcSettings?.()}
                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1"
              >
                <Settings className="w-3 h-3" />
                <span>NFC Ayarlarını Aç</span>
              </button>
            )}

            <span className="text-gray-400">
              Cep POS:{' '}
              <strong className={cepPosInstalled ? 'text-emerald-400' : 'text-gray-400'}>
                {cepPosInstalled ? 'Yüklü' : 'Başvuru / Test'}
              </strong>
            </span>
          </div>

          {/* CARİ SEÇİMİ */}
          <div className="space-y-2">
            <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider">
              Tahsilat İşlenecek Cari *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  value={cariQuery}
                  onChange={(e) => setCariQuery(e.target.value)}
                  placeholder="Cari ara..."
                  disabled={stage === 'scanning' || stage === 'authorizing'}
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                />
              </div>
              <select
                data-testid="nfc_cari_select"
                value={selectedCariId}
                onChange={(e) => setSelectedCariId(e.target.value)}
                disabled={stage === 'scanning' || stage === 'authorizing'}
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400"
              >
                <option value="">Cari Seçiniz...</option>
                {filteredCariler.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.unvan} ({formatCurrency(c.bakiye)})
                  </option>
                ))}
              </select>
            </div>
            {selectedCari && (
              <div className="px-3 py-2 rounded-lg bg-black/30 border border-white/[0.06] flex items-center justify-between text-xs">
                <span className="text-white font-semibold truncate">{selectedCari.unvan}</span>
                <span className="text-teal-400 font-bold whitespace-nowrap ml-2">
                  Bakiye: {formatCurrency(selectedCari.bakiye)}
                </span>
              </div>
            )}
          </div>

          {/* TUTAR & AÇIKLAMA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                Tahsilat Tutarı (₺) *
              </label>
              <input
                type="text"
                inputMode="decimal"
                data-testid="nfc_tutar_input"
                value={tutarInput}
                onChange={(e) => setTutarInput(e.target.value)}
                disabled={stage === 'scanning' || stage === 'authorizing'}
                placeholder="Örn: 1500,00"
                className="w-full bg-[#0a0e13] border border-teal-500/30 rounded-xl px-3 py-2.5 text-base font-mono font-black text-teal-300 placeholder-gray-600 focus:outline-none focus:border-teal-400"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                Açıklama (Opsiyonel)
              </label>
              <input
                type="text"
                value={aciklamaInput}
                onChange={(e) => setAciklamaInput(e.target.value)}
                disabled={stage === 'scanning' || stage === 'authorizing'}
                placeholder="Örn: Fatura bedeli"
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
              />
            </div>
          </div>

          {/* HATA MESAJI */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* TEMASSIZ OKUMA RADAR / KART ALANI */}
          <div className="p-5 rounded-2xl bg-[#111820] border border-white/[0.08] flex flex-col items-center text-center space-y-3">
            {stage === 'scanning' ? (
              <>
                <div className="relative w-20 h-20 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-teal-400/20 animate-ping" />
                  <span className="absolute inset-2 rounded-full border border-teal-400/40 animate-pulse" />
                  <div className="w-14 h-14 rounded-full bg-teal-400/20 border border-teal-400 text-teal-300 flex items-center justify-center">
                    <Wifi className="w-7 h-7 rotate-90" />
                  </div>
                </div>
                <div className="text-sm font-bold text-white">Kart Bekleniyor...</div>
                <p className="text-xs text-teal-300/90 max-w-xs">{statusMessage}</p>
                <div className="text-lg font-mono font-black text-white">
                  {formatCurrency(numericAmount)}
                </div>
                <button
                  type="button"
                  onClick={handleStopScan}
                  className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold text-gray-200 transition"
                >
                  Okumayı Durdur
                </button>
              </>
            ) : stage === 'detected' || stage === 'authorizing' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 flex items-center justify-center">
                  {stage === 'authorizing' ? (
                    <RefreshCw className="w-7 h-7 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-7 h-7" />
                  )}
                </div>
                <div className="text-sm font-black text-emerald-300">
                  {detectedCard?.brand || 'Temassız Kart'}{' '}
                  {detectedCard?.last4 ? `•••• ${detectedCard.last4}` : ''}
                  {detectedCard?.expiry ? ` (${detectedCard.expiry})` : ''}
                </div>
                <p className="text-xs text-gray-300">
                  {statusMessage || 'Makbuz ve kasa kaydı oluşturuluyor...'}
                </p>
              </>
            ) : stage === 'waiting_ceppost' ? (
              <>
                <div className="w-14 h-14 rounded-full bg-teal-500/20 border border-teal-400 text-teal-300 flex items-center justify-center">
                  <ExternalLink className="w-6 h-6 animate-pulse" />
                </div>
                <div className="text-sm font-bold text-white">iyzico Cep POS Açıldı</div>
                <p className="text-xs text-gray-300 max-w-xs">{statusMessage}</p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      void finalizeAuthorizedCard(
                        {
                          success: true,
                          brand: 'iyzico Cep POS',
                          method: 'ceppost_manual_confirm',
                        },
                        'ceppost_callback'
                      )
                    }
                    className="px-3.5 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] text-xs font-black transition"
                  >
                    Ödemeyi Onayla & Makbuzu Kes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearPendingCepPosTx();
                      setStage('idle');
                    }}
                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-gray-200 transition"
                  >
                    İptal
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/25 text-teal-400 flex items-center justify-center">
                  <CreditCard className="w-6 h-6" />
                </div>
                <div className="text-xs font-bold text-white">
                  Temassız Kart Okutma veya iyzico Cep POS
                </div>
                <p className="text-[11px] text-gray-400 max-w-sm leading-relaxed">
                  Kart okutulduğunda tam kart numarası saklanmaz; yalnızca kart şeması/son 4 hanesi ile{' '}
                  <strong>Tahsilat Makbuzu</strong> kesilir, <strong>POS Kasası</strong> güncellenir ve{' '}
                  <strong>PDF / WhatsApp</strong> ekranı açılır.
                </p>
              </>
            )}
          </div>

          {/* AKSİYON BUTONLARI */}
          {stage !== 'scanning' && stage !== 'detected' && stage !== 'authorizing' && stage !== 'waiting_ceppost' && (
            <div className="space-y-2.5">
              {showAndroidNfcBtn && (
                <button
                  type="button"
                  data-testid="nfc_start_reader_btn"
                  onClick={handleStartAndroidNfcScan}
                  className="w-full py-3.5 px-4 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-black text-sm flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(45,212,191,0.3)] transition"
                >
                  <Wifi className="w-4 h-4 rotate-90" />
                  <span>Android NFC ile Kart Okut ({formatCurrency(numericAmount)})</span>
                </button>
              )}

              {showCepPosBtn && (
                <button
                  type="button"
                  data-testid="nfc_launch_ceppost_btn"
                  onClick={handleLaunchCepPos}
                  className="w-full py-3 px-4 rounded-xl bg-[#111820] hover:bg-white/10 text-teal-300 border border-teal-500/30 font-bold text-xs flex items-center justify-center gap-2 transition"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>iyzico Cep POS Uygulamasını Aç (App2App)</span>
                </button>
              )}

              {(nfcStatus === 'web' || nfcStatus === 'unsupported' || posConfig.testMode) && (
                <button
                  type="button"
                  data-testid="nfc_sandbox_test_btn"
                  onClick={handleSandboxTestCard}
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 font-bold text-xs flex items-center justify-center gap-2 transition"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Sandbox Test Kartı ile Dene (TEST / SİMÜLASYON)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
