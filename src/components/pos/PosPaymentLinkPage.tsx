import React, { useEffect, useState } from 'react';
import { PosPayLinkParams } from '../../lib/posService';
import {
  fetchPaymentLinkSession,
  initializeRealGatewayCheckout,
} from '../../lib/posGatewayService';
import { formatCurrency } from '../../lib/formatters';
import {
  ShieldCheck,
  CreditCard,
  Lock,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  AlertCircle,
  ExternalLink,
  Building2,
  Sparkles,
} from 'lucide-react';

interface PosPaymentLinkPageProps {
  params: PosPayLinkParams;
  onExit: () => void;
}

const formatCardNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
};

const formatExpiry = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
};

export const PosPaymentLinkPage: React.FC<PosPaymentLinkPageProps> = ({ params, onExit }) => {
  const [resolvedParams, setResolvedParams] = useState<PosPayLinkParams>(params);
  const [sessionLoading, setSessionLoading] = useState<boolean>(Boolean(params.payCode));
  const [sessionNotFound, setSessionNotFound] = useState<boolean>(false);

  // Gerçek Gateway Durumu
  const [gatewayLoading, setGatewayLoading] = useState<boolean>(false);
  const [paytrIframeUrl, setPaytrIframeUrl] = useState<string | null>(null);
  const [iyzicoPaymentUrl, setIyzicoPaymentUrl] = useState<string | null>(null);
  const [gatewayNotice, setGatewayNotice] = useState<string | null>(null);
  const [isGatewayLive, setIsGatewayLive] = useState<boolean>(false);

  // Test / Önizleme Formu State'i
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    params.payStatus === 'failed'
      ? 'Ödeme işlemi banka veya 3D Secure adımında tamamlanamadı. Lütfen tekrar deneyiniz.'
      : null
  );
  const [completedTxId, setCompletedTxId] = useState<string | null>(() =>
    params.payStatus === 'success'
      ? `${params.provider.toUpperCase()}-3DS-${params.referenceNo}`
      : null
  );

  useEffect(() => {
    setResolvedParams(params);
  }, [params]);

  useEffect(() => {
    let cancelled = false;

    const loadSessionAndGateway = async () => {
      let current = params;

      if (params.payCode) {
        setSessionLoading(true);
        const session = await fetchPaymentLinkSession(params.payCode);
        if (cancelled) return;
        setSessionLoading(false);

        if (session) {
          current = {
            referenceNo: session.referans_no || params.payCode,
            amount: Number(session.tutar) || 0,
            customerName: session.cari_unvan || 'Müşteri',
            provider: session.saglayici === 'paytr' ? 'paytr' : 'iyzico',
            payCode: session.pay_code,
            description: session.aciklama || undefined,
            firmaName: session.firma_unvan || undefined,
            firmaId: session.firma_id || undefined,
          };
          setResolvedParams(current);

          if (session.durum === 'odendi') {
            setCompletedTxId(session.gateway_token || session.referans_no);
            return;
          }
        } else if (params.amount <= 0) {
          setSessionNotFound(true);
          return;
        }
      }

      if (params.payStatus === 'success' || current.amount <= 0) {
        return;
      }

      // Gerçek iyzico / PayTR Edge Function gateway kontrolü
      setGatewayLoading(true);
      const returnBaseUrl =
        typeof window !== 'undefined' &&
        window.location?.origin &&
        !window.location.origin.includes('appassets.androidplatform.net')
          ? window.location.origin
          : '';

      const gw = await initializeRealGatewayCheckout({
        provider: current.provider,
        amount: current.amount,
        referenceNo: current.referenceNo,
        payCode: current.payCode,
        firmaId: current.firmaId,
        customerName: current.customerName,
        description: current.description,
        returnBaseUrl,
      });

      if (cancelled) return;
      setGatewayLoading(false);

      if (gw.ok && gw.provider === 'paytr' && gw.iframeUrl) {
        setIsGatewayLive(true);
        setPaytrIframeUrl(gw.iframeUrl);
        setGatewayNotice(null);
        return;
      }

      if (gw.ok && gw.provider === 'iyzico' && gw.paymentPageUrl) {
        setIsGatewayLive(true);
        setIyzicoPaymentUrl(gw.paymentPageUrl);
        setGatewayNotice(null);
        return;
      }

      setIsGatewayLive(false);
      if (gw.notDeployed) {
        setGatewayNotice(
          'Canlı POS gateway servisi henüz kurulmadığı için sayfa Test / Önizleme modunda açıldı.'
        );
      } else if (gw.missingKeys) {
        setGatewayNotice(
          'Firma iyzico / PayTR canlı anahtarları henüz girilmediği için Test / Önizleme modunda açıldı.'
        );
      } else if (gw.error) {
        setGatewayNotice(gw.error);
      }
    };

    void loadSessionAndGateway();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const providerTitle =
    resolvedParams.provider === 'paytr' ? 'PayTR Güvenli Ödeme' : 'iyzico Güvenli Ödeme';

  const handleTestCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanCard = cardNumber.replace(/\s+/g, '');
    if (!cardHolder.trim()) {
      setError('Lütfen kart üzerindeki ad soyad bilgisini giriniz.');
      return;
    }
    if (cleanCard.length < 15) {
      setError('Lütfen geçerli bir kart numarası giriniz.');
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
      setError('Lütfen son kullanma tarihini AA/YY formatında giriniz.');
      return;
    }
    if (cvc.trim().length < 3) {
      setError('Lütfen 3 veya 4 haneli güvenlik kodunu (CVC) giriniz.');
      return;
    }

    setProcessing(true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const authCode = Math.floor(100000 + Math.random() * 900000).toString();
    setCompletedTxId(`${resolvedParams.provider.toUpperCase()}-TEST-${authCode}`);
    setProcessing(false);
  };

  return (
    <div className="min-h-[100dvh] bg-[#0a0e13] text-gray-100 flex flex-col items-center justify-center px-3 sm:px-4 py-6 pt-[max(env(safe-area-inset-top,0px),1.5rem)] pb-[max(env(safe-area-inset-bottom,0px),1.5rem)]">
      <div className="w-full max-w-lg bg-[#0b1322] border border-teal-500/25 rounded-2xl shadow-2xl overflow-hidden">
        {/* ÜST BAŞLIK */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-teal-500/15 via-[#0f192b] to-black/30 border-b border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-black text-white tracking-tight truncate">
                {providerTitle}
              </h1>
              <p className="text-[11px] text-teal-300 font-semibold truncate">
                3D Secure Bağlantılı Tahsilat
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onExit}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 font-semibold flex items-center gap-1 transition shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kapat</span>
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {sessionLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-300">
              <Loader2 className="w-7 h-7 animate-spin text-teal-400" />
              <p className="text-xs">Ödeme oturumu yükleniyor...</p>
            </div>
          ) : sessionNotFound ? (
            <div className="p-5 rounded-2xl bg-red-500/10 border border-red-500/30 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
              <div className="text-sm font-bold text-white">Ödeme Bağlantısı Bulunamadı</div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Bu ödeme linki geçersiz veya süresi dolmuş olabilir. Lütfen satıcı firmadan yeni bir ödeme linki isteyiniz.
              </p>
            </div>
          ) : (
            <>
              {/* ÖDEME ÖZET KARTI */}
              <div className="p-4 rounded-xl bg-black/35 border border-white/[0.07] space-y-2">
                {resolvedParams.firmaName && (
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-teal-400" />
                      <span>Satıcı Firma</span>
                    </span>
                    <span className="text-teal-300 font-bold">{resolvedParams.firmaName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>Cari / Müşteri</span>
                  <span className="text-white font-bold">{resolvedParams.customerName}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>Referans No</span>
                  <span className="font-mono text-teal-300 font-bold">
                    {resolvedParams.referenceNo}
                  </span>
                </div>
                {resolvedParams.description && (
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
                    <span>Açıklama</span>
                    <span className="text-gray-200 text-right truncate">
                      {resolvedParams.description}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                    Ödenecek Tutar
                  </span>
                  <span className="text-2xl font-mono font-black text-teal-300">
                    {resolvedParams.amount > 0
                      ? formatCurrency(resolvedParams.amount)
                      : 'Belirtilmedi'}
                  </span>
                </div>
              </div>

              {completedTxId ? (
                <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="text-base font-black text-white">
                    3D Secure Ödeme Onayı Alındı
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {isGatewayLive || params.payStatus === 'success'
                      ? 'Ödemeniz güvenli 3D Secure altyapısı üzerinden başarıyla onaylandı.'
                      : 'Test / önizleme kart doğrulaması başarıyla tamamlandı.'}
                  </p>
                  <div className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 font-mono text-xs text-emerald-300">
                    İşlem No: {completedTxId}
                  </div>
                  <button
                    type="button"
                    onClick={onExit}
                    className="w-full py-3 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-black text-sm transition"
                  >
                    Tamamlandı / Kapat
                  </button>
                </div>
              ) : gatewayLoading ? (
                <div className="py-10 flex flex-col items-center justify-center gap-3 text-gray-300">
                  <Loader2 className="w-7 h-7 animate-spin text-cyan-400" />
                  <p className="text-xs font-semibold">
                    {resolvedParams.provider === 'paytr'
                      ? 'PayTR Güvenli 3D Secure iFrame hazırlanıyor...'
                      : 'iyzico 3D Secure ödeme oturumu başlatılıyor...'}
                  </p>
                </div>
              ) : paytrIframeUrl ? (
                /* GERÇEK PAYTR IFRAME */
                <div className="space-y-2.5">
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Canlı PayTR 3D Secure Ödeme Ekranı</span>
                  </div>
                  <div className="rounded-xl overflow-hidden bg-white border border-white/15">
                    <iframe
                      title="PayTR Güvenli Ödeme Formu"
                      src={paytrIframeUrl}
                      className="w-full min-h-[540px] border-0 block"
                      allow="payment"
                    />
                  </div>
                </div>
              ) : iyzicoPaymentUrl ? (
                /* GERÇEK IYZICO CHECKOUT FORM YÖNLENDİRMESİ */
                <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-400/30 space-y-3 text-center">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>iyzico Güvenli Ödeme Oturumu Hazır</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Kart bilgilerinizi girmek ve 3D Secure doğrulamasını tamamlamak için iyzico resmi ödeme sayfasına geçiniz.
                  </p>
                  <button
                    type="button"
                    data-testid="iyzico_redirect_checkout_btn"
                    onClick={() => window.location.assign(iyzicoPaymentUrl)}
                    className="w-full py-3.5 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg transition"
                  >
                    <Lock className="w-4 h-4" />
                    <span>iyzico ile {formatCurrency(resolvedParams.amount)} Öde</span>
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* TEST / ÖNİZLEME MODU (GATEWAY KURULMADAN ÖNCE DE HER TELEFONDA AÇILIR) */
                <form onSubmit={handleTestCardSubmit} className="space-y-3.5">
                  {gatewayNotice && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] flex items-start gap-2 leading-relaxed">
                      <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
                      <span>{gatewayNotice}</span>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                      Kart Üzerindeki İsim
                    </label>
                    <input
                      type="text"
                      autoComplete="cc-name"
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value)}
                      placeholder="AD SOYAD"
                      className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                      Kart Numarası
                    </label>
                    <div className="relative">
                      <CreditCard className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-number"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                        placeholder="0000 0000 0000 0000"
                        className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                        Son Kullanma (AA/YY)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        value={expiry}
                        onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                        placeholder="12/29"
                        className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1">
                        CVC / CVV
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        maxLength={4}
                        value={cvc}
                        onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="•••"
                        className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={processing || resolvedParams.amount <= 0}
                    className="w-full py-3.5 px-4 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-[#0a0e13] font-black text-sm flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(45,212,191,0.28)] transition"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>3D Secure İşleniyor...</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>
                          {resolvedParams.amount > 0
                            ? `${formatCurrency(resolvedParams.amount)} Test Ödemesini Tamamla`
                            : 'Geçerli Tutar Yok'}
                        </span>
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-center text-gray-400 leading-relaxed">
                    iPhone Safari, Android Chrome ve tüm mobil tarayıcılarla uyumlu 256-bit SSL güvenli ödeme sayfası.
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
