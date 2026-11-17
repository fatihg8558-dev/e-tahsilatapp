import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Link2,
  ShieldCheck,
  Search,
  Share2,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Send,
  Sparkles,
  Globe,
  Loader2,
  Eye,
} from 'lucide-react';
import { Cari } from '../../types/database';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../lib/formatters';
import {
  generatePaymentLink,
  parsePosPayParams,
  PaymentLinkResult,
  PosConfig,
  PosPayLinkParams,
} from '../../lib/posService';
import {
  createCloudPaymentLinkSession,
  fetchCloudPosConfig,
} from '../../lib/posGatewayService';
import { openExternalLink, openWhatsApp } from '../../lib/linkHelper';

interface PaymentLinkRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  cariler: Cari[];
  initialCariId: string;
  initialTutar: string;
  initialAciklama: string;
  posConfig: PosConfig;
  onPreviewInApp?: (params: PosPayLinkParams) => void;
  onGenerated?: (payload: {
    linkResult: PaymentLinkResult;
    cariId: string;
    tutarDisplay: string;
    provider: 'iyzico' | 'paytr';
  }) => void;
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

export const PaymentLinkRequestModal: React.FC<PaymentLinkRequestModalProps> = ({
  isOpen,
  onClose,
  cariler,
  initialCariId,
  initialTutar,
  initialAciklama,
  posConfig,
  onPreviewInApp,
  onGenerated,
}) => {
  const { firma, profile } = useAuth();
  const effectiveFirmaId = firma?.id || profile?.firma_id || '';

  const [effectiveConfig, setEffectiveConfig] = useState<PosConfig>(posConfig);
  const [selectedCariId, setSelectedCariId] = useState(initialCariId);
  const [cariQuery, setCariQuery] = useState('');
  const [tutarInput, setTutarInput] = useState(initialTutar);
  const [aciklamaInput, setAciklamaInput] = useState(initialAciklama);
  const [provider, setProvider] = useState<'iyzico' | 'paytr'>(
    posConfig.provider === 'paytr' ? 'paytr' : 'iyzico'
  );
  const [generated, setGenerated] = useState<PaymentLinkResult | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<'url' | 'message' | null>(null);

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

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const initModal = async () => {
      const syncedConfig = effectiveFirmaId
        ? await fetchCloudPosConfig(effectiveFirmaId)
        : posConfig;
      if (cancelled) return;

      const nextCfg = syncedConfig.publicWebUrl ? syncedConfig : posConfig;
      setEffectiveConfig(nextCfg);

      const defaultProvider: 'iyzico' | 'paytr' =
        nextCfg.provider === 'paytr' ? 'paytr' : 'iyzico';

      setSelectedCariId(initialCariId);
      setCariQuery('');
      setTutarInput(initialTutar);
      setAciklamaInput(initialAciklama);
      setProvider(defaultProvider);
      setError(null);
      setCopiedType(null);

      const parsedAmt = parseAmount(initialTutar);
      if (parsedAmt > 0) {
        const targetCari = cariler.find((c) => c.id === initialCariId);
        const amount = Math.round(parsedAmt * 100) / 100;
        const referenceNo = `POS-${Date.now().toString().slice(-6)}`;
        const sessionRes = await createCloudPaymentLinkSession({
          firmaId: effectiveFirmaId || undefined,
          firmaUnvan: firma?.unvan || undefined,
          cariId: targetCari?.id || undefined,
          cariUnvan: targetCari?.unvan || 'Müşteri',
          tutar: amount,
          aciklama: initialAciklama || undefined,
          provider: defaultProvider,
          referenceNo,
        });
        if (cancelled) return;

        const linkResult = generatePaymentLink({
          amount,
          customerName: targetCari?.unvan || 'Müşteri',
          customerPhone: targetCari?.telefon || undefined,
          description: initialAciklama || undefined,
          firmaName: firma?.unvan || undefined,
          firmaId: effectiveFirmaId || undefined,
          payCode: sessionRes.payCode,
          referenceNo,
          config: nextCfg,
          providerOverride: defaultProvider,
        });
        setGenerated(linkResult);
      } else {
        setGenerated(null);
      }
    };

    void initModal();
    return () => {
      cancelled = true;
    };
  }, [isOpen, initialCariId, initialTutar, initialAciklama, posConfig, cariler, effectiveFirmaId, firma?.unvan]);

  if (!isOpen) return null;

  const isLiveConfigured =
    effectiveConfig.enabled &&
    !effectiveConfig.testMode &&
    ((provider === 'iyzico' &&
      effectiveConfig.provider === 'iyzico' &&
      Boolean(effectiveConfig.iyzicoApiKey?.trim()) &&
      Boolean(effectiveConfig.iyzicoSecretKey?.trim())) ||
      (provider === 'paytr' &&
        effectiveConfig.provider === 'paytr' &&
        Boolean(effectiveConfig.paytrMerchantId?.trim()) &&
        Boolean(effectiveConfig.paytrMerchantKey?.trim()) &&
        Boolean(effectiveConfig.paytrMerchantSalt?.trim())));

  const handleGenerate = async (targetProvider: 'iyzico' | 'paytr' = provider) => {
    setError(null);
    const amount = Math.round(numericAmount * 100) / 100;
    if (!amount || amount <= 0) {
      setError('Lütfen ödeme istemek için geçerli bir tutar giriniz.');
      return;
    }

    setCreatingLink(true);
    try {
      const customerName = selectedCari?.unvan || 'Müşteri';
      const referenceNo = `POS-${Date.now().toString().slice(-6)}`;
      const sessionRes = await createCloudPaymentLinkSession({
        firmaId: effectiveFirmaId || undefined,
        firmaUnvan: firma?.unvan || undefined,
        cariId: selectedCari?.id || undefined,
        cariUnvan: customerName,
        tutar: amount,
        aciklama: aciklamaInput.trim() || undefined,
        provider: targetProvider,
        referenceNo,
      });

      const result = generatePaymentLink({
        amount,
        customerName,
        customerPhone: selectedCari?.telefon || undefined,
        description: aciklamaInput.trim() || undefined,
        firmaName: firma?.unvan || undefined,
        firmaId: effectiveFirmaId || undefined,
        payCode: sessionRes.payCode,
        referenceNo,
        config: effectiveConfig,
        providerOverride: targetProvider,
      });
      setGenerated(result);
      onGenerated?.({
        linkResult: result,
        cariId: selectedCariId,
        tutarDisplay: amount.toFixed(2).replace('.', ','),
        provider: targetProvider,
      });
    } finally {
      setCreatingLink(false);
    }
  };

  const handleCopy = async (value: string, type: 'url' | 'message') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      setError('Panoya kopyalama başarısız oldu.');
    }
  };

  const handlePreviewInsideApp = () => {
    if (!generated) return;
    if (onPreviewInApp) {
      const urlObj = new URL(generated.url);
      const parsed = parsePosPayParams(urlObj.search);
      if (parsed) {
        onPreviewInApp({
          ...parsed,
          amount: parsed.amount || Math.round(numericAmount * 100) / 100,
          customerName:
            parsed.customerName !== 'Müşteri'
              ? parsed.customerName
              : selectedCari?.unvan || 'Müşteri',
          provider,
          description: aciklamaInput.trim() || parsed.description,
          firmaName: firma?.unvan || parsed.firmaName,
          firmaId: effectiveFirmaId || parsed.firmaId,
        });
        return;
      }
    }
    openExternalLink(generated.url);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      data-testid="payment_link_request_modal"
    >
      <div className="bg-[#111820] border border-cyan-500/30 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden my-auto">
        {/* ÜST BAŞLIK */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-500/20 via-[#0f192b] to-cyan-500/15 border-b border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white flex items-center justify-center shrink-0 shadow-lg">
              <Link2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-white truncate">
                Link ile Ödeme İste
              </h3>
              <p className="text-[11px] text-cyan-300 font-semibold truncate">
                iyzico / PayTR 3D Secure Ödeme Linki Oluştur &amp; Gönder
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* GÖVDE */}
        <div className="p-4 sm:p-5 space-y-4 max-h-[82dvh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ALTYAPI SEÇİMİ (iyzico / PayTR) */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">
                Ödeme Altyapısı
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                  isLiveConfigured
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                }`}
              >
                {isLiveConfigured ? (
                  <>
                    <ShieldCheck className="w-3 h-3" />
                    <span>Canlı POS Hazır</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    <span>Test / Hızlı Link Modu</span>
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="payment_link_provider_iyzico"
                onClick={() => {
                  setProvider('iyzico');
                  if (numericAmount > 0) void handleGenerate('iyzico');
                }}
                className={`py-2.5 px-3 rounded-xl border text-xs font-extrabold transition flex items-center justify-center gap-1.5 ${
                  provider === 'iyzico'
                    ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_16px_rgba(99,102,241,0.35)]'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>iyzico Link</span>
              </button>

              <button
                type="button"
                data-testid="payment_link_provider_paytr"
                onClick={() => {
                  setProvider('paytr');
                  if (numericAmount > 0) void handleGenerate('paytr');
                }}
                className={`py-2.5 px-3 rounded-xl border text-xs font-extrabold transition flex items-center justify-center gap-1.5 ${
                  provider === 'paytr'
                    ? 'bg-cyan-500 text-[#0a0e13] border-cyan-400 shadow-[0_0_16px_rgba(6,182,212,0.35)]'
                    : 'bg-[#0a0e13] border-white/10 text-gray-300 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>PayTR Link</span>
              </button>
            </div>
          </div>

          {/* CARİ / MÜŞTERİ SEÇİMİ */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-300">
                Müşteri / Cari Hesap
              </label>
              {selectedCari?.telefon && (
                <span className="text-[11px] font-mono text-emerald-300">
                  Tel: {selectedCari.telefon}
                </span>
              )}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={cariQuery}
                onChange={(e) => setCariQuery(e.target.value)}
                placeholder="Cari ünvanı veya VKN ile ara..."
                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
              />
            </div>

            <select
              value={selectedCariId}
              onChange={(e) => {
                setSelectedCariId(e.target.value);
                setGenerated(null);
              }}
              data-testid="payment_link_cari_select"
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
            >
              <option value="">-- Müşteri Seçiniz (Opsiyonel) --</option>
              {filteredCariler.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.unvan} {c.telefon ? `(${c.telefon})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* TUTAR & AÇIKLAMA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1">
                İstenecek Tutar (₺) *
              </label>
              <input
                type="text"
                inputMode="decimal"
                data-testid="payment_link_amount_input"
                value={tutarInput}
                onChange={(e) => {
                  setTutarInput(e.target.value);
                  setGenerated(null);
                }}
                placeholder="Örn: 2500,00"
                className="w-full bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2.5 text-sm font-mono font-bold text-white focus:outline-none focus:border-cyan-400"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1">
                Açıklama (Opsiyonel)
              </label>
              <input
                type="text"
                value={aciklamaInput}
                onChange={(e) => {
                  setAciklamaInput(e.target.value);
                  setGenerated(null);
                }}
                placeholder="Örn: Fatura ödemesi"
                className="w-full bg-[#0a0e13] border border-white/15 rounded-xl px-3 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          <button
            type="button"
            data-testid="generate_payment_link_modal_btn"
            disabled={creatingLink}
            onClick={() => void handleGenerate(provider)}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 disabled:opacity-60 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(99,102,241,0.35)] transition active:scale-[0.99]"
          >
            {creatingLink ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Ödeme Linki Hazırlanıyor...</span>
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4" />
                <span>
                  {numericAmount > 0
                    ? `${formatCurrency(numericAmount)} ${provider === 'iyzico' ? 'iyzico' : 'PayTR'} Ödeme Linki Oluştur`
                    : `${provider === 'iyzico' ? 'iyzico' : 'PayTR'} Ödeme Linki Oluştur`}
                </span>
              </>
            )}
          </button>

          {/* OLUŞTURULAN LİNK VE PAYLAŞIM KARTI */}
          {generated && (
            <div
              className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-400/30 space-y-3"
              data-testid="payment_link_result_card"
            >
              <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  <span>Link Hazır ({provider === 'iyzico' ? 'iyzico' : 'PayTR'})</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      generated.baseUrlSource === 'configured' || generated.baseUrlSource === 'window'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {generated.baseUrlSource === 'configured'
                      ? 'Tanımlı Web Adresi'
                      : generated.baseUrlSource === 'window'
                      ? 'Canlı Web Adresi'
                      : 'Paylaşılan Web Adresi'}
                  </span>
                  <span className="font-mono text-[11px] bg-black/40 px-2 py-0.5 rounded text-white">
                    Ref: {generated.referenceNo}
                  </span>
                </div>
              </div>

              {generated.warning && (
                <div className="text-[10.5px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 leading-relaxed">
                  {generated.warning}
                </div>
              )}

              <div className="bg-[#0a0e13] border border-white/10 rounded-xl p-2.5 space-y-1.5">
                <div className="text-[10px] uppercase font-bold text-gray-400">
                  Müşteriye Gönderilecek Bağlantı
                </div>
                <div className="text-[11px] font-mono text-cyan-300 break-all select-all">
                  {generated.url}
                </div>
              </div>

              <div className="bg-[#0a0e13] border border-white/10 rounded-xl p-2.5 text-[11px] text-gray-300 font-mono whitespace-pre-line max-h-32 overflow-y-auto">
                {generated.message}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="payment_link_whatsapp_btn"
                  onClick={() => openWhatsApp(selectedCari?.telefon, generated.message)}
                  className="py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0a0e13] font-black text-xs flex items-center justify-center gap-1.5 transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>WhatsApp ile Ödeme İste</span>
                </button>

                <button
                  type="button"
                  data-testid="payment_link_copy_url_btn"
                  onClick={() => handleCopy(generated.url, 'url')}
                  className="py-2.5 px-3 rounded-xl bg-cyan-400/20 hover:bg-cyan-400/30 border border-cyan-400/35 text-cyan-200 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  {copiedType === 'url' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Link Kopyalandı</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Linki Kopyala</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleCopy(generated.message, 'message')}
                  className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  {copiedType === 'message' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Mesaj Kopyalandı</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Tüm Mesajı Kopyala</span>
                    </>
                  )}
                </button>

                {onPreviewInApp ? (
                  <button
                    type="button"
                    data-testid="payment_link_preview_in_app_btn"
                    onClick={handlePreviewInsideApp}
                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                  >
                    <Eye className="w-3.5 h-3.5 text-cyan-300" />
                    <span>Uygulama İçi Önizle</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openExternalLink(generated.url)}
                    className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Ödeme Ekranını Test Et</span>
                  </button>
                )}
              </div>

              {onPreviewInApp && (
                <button
                  type="button"
                  onClick={() => openExternalLink(generated.url)}
                  className="w-full py-2 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-cyan-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Harici Tarayıcıda Aç (Müşteri Gözüyle Test Et)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
