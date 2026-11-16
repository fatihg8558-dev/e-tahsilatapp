import React, { useState } from 'react';
import { PosPayLinkParams } from '../../lib/posService';
import { formatCurrency } from '../../lib/formatters';
import {
  ShieldCheck,
  CreditCard,
  Lock,
  CheckCircle2,
  ArrowLeft,
  Loader2,
  AlertCircle,
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
  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedTxId, setCompletedTxId] = useState<string | null>(null);

  const providerTitle = params.provider === 'paytr' ? 'PayTR Güvenli Ödeme' : 'iyzico Güvenli Ödeme';

  const handleSubmit = async (e: React.FormEvent) => {
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
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const authCode = Math.floor(100000 + Math.random() * 900000).toString();
    setCompletedTxId(`${params.provider.toUpperCase()}-3DS-${authCode}`);
    setProcessing(false);
  };

  return (
    <div className="min-h-[100dvh] bg-[#0a0e13] text-gray-100 flex flex-col items-center justify-center px-4 py-8 pt-[max(env(safe-area-inset-top,0px),2rem)] pb-[max(env(safe-area-inset-bottom,0px),2rem)]">
      <div className="w-full max-w-md bg-[#0b1322] border border-teal-500/25 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 bg-gradient-to-r from-teal-500/15 via-[#0f192b] to-black/30 border-b border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-black text-white tracking-tight">{providerTitle}</h1>
              <p className="text-[11px] text-teal-300 font-semibold">3D Secure Bağlantılı Ödeme</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onExit}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 font-semibold flex items-center gap-1 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Uygulamaya Dön</span>
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="p-4 rounded-xl bg-black/35 border border-white/[0.07] space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Cari / Müşteri</span>
              <span className="text-white font-bold">{params.customerName}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Referans No</span>
              <span className="font-mono text-teal-300 font-bold">{params.referenceNo}</span>
            </div>
            <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Ödenecek Tutar</span>
              <span className="text-2xl font-mono font-black text-teal-300">
                {params.amount > 0 ? formatCurrency(params.amount) : 'Belirtilmedi'}
              </span>
            </div>
          </div>

          {completedTxId ? (
            <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="text-base font-black text-white">3D Secure Ödeme Onayı Alındı</div>
              <p className="text-xs text-gray-300 leading-relaxed">
                Ödeme işlemi simülasyon/doğrulama adımı başarıyla tamamlandı.
              </p>
              <div className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 font-mono text-xs text-emerald-300">
                İşlem No: {completedTxId}
              </div>
              <button
                type="button"
                onClick={onExit}
                className="w-full py-3 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-black text-sm transition"
              >
                Tahsilatım Uygulamasına Dön
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
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
                disabled={processing || params.amount <= 0}
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
                      {params.amount > 0
                        ? `${formatCurrency(params.amount)} Güvenli Öde`
                        : 'Geçerli Tutar Yok'}
                    </span>
                  </>
                )}
              </button>

              <p className="text-[10px] text-center text-gray-400 leading-relaxed">
                Ödeme sayfası iPhone Safari, iPad ve tüm mobil tarayıcılarla uyumlu 256-bit SSL güvenli bağlantı yapısındadır.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
