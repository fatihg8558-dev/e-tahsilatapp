import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Building2, User, Phone, Mail, Lock, FileText, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';

export const AuthScreen: React.FC = () => {
  const { signIn, signUp, error: authError } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form State
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('tahsilatim_remembered_email') || '';
    } catch {
      return '';
    }
  });
  const [rememberMe, setRememberMe] = useState(true);
  const [password, setPassword] = useState('');
  const [unvan, setUnvan] = useState('');
  const [vergiNo, setVergiNo] = useState('');
  const [adSoyad, setAdSoyad] = useState('');
  const [telefon, setTelefon] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(true);

    // E-posta hatırlama
    try {
      if (rememberMe && email.trim()) {
        localStorage.setItem('tahsilatim_remembered_email', email.trim());
      } else if (!rememberMe) {
        localStorage.removeItem('tahsilatim_remembered_email');
      }
    } catch {
      // ignore
    }

    try {
      if (isSignUp) {
        if (!unvan.trim() || !vergiNo.trim() || !adSoyad.trim() || !email.trim() || !password) {
          setErrorMessage('Lütfen tüm zorunlu alanları doldurunuz.');
          setLoading(false);
          return;
        }

        const res = await signUp({
          unvan,
          vergi_no: vergiNo,
          ad_soyad: adSoyad,
          telefon,
          email,
          pass: password,
        });

        if (res.error) {
          setErrorMessage(res.error);
        } else {
          setSuccessMessage('Kayıt başarılı! 7 günlük deneme paketiniz başlatıldı.');
        }
      } else {
        if (!email.trim() || !password) {
          setErrorMessage('Lütfen e-posta ve şifrenizi giriniz.');
          setLoading(false);
          return;
        }

        const res = await signIn(email, password);
        if (res.error) {
          setErrorMessage(res.error);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e13] text-gray-100 flex items-center justify-center p-4 fintech-glow">
      <div className="w-full max-w-md">
        {/* LOGO & BAŞLIK */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-400 text-[#0a0e13] font-black flex items-center justify-center text-2xl shadow-[0_0_25px_rgba(45,212,191,0.4)]">
              e
            </div>
            <div className="flex items-baseline">
              <span className="font-extrabold text-2xl text-white tracking-tight">Tahsilatım</span>
              <span className="text-teal-400 font-black text-3xl leading-none">.</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 max-w-xs mx-auto">
            Mobil öncelikli, bulut tabanlı modern Tahsilat ve Tediye Makbuzu platformu
          </p>
        </div>

        {/* KART */}
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative">
          {/* TAB DEĞİŞTİRİCİ */}
          <div className="flex rounded-xl bg-black/40 p-1 mb-6 border border-white/[0.05]">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(false);
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                !isSignUp
                  ? 'bg-teal-400 text-[#0a0e13] shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Giriş Yap
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignUp(true);
                setErrorMessage(null);
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                isSignUp
                  ? 'bg-teal-400 text-[#0a0e13] shadow-md'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Kayıt Ol (7 Gün Ücretsiz)
            </button>
          </div>

          {/* HATA VEYA BİLGİ MESAJI */}
          {(errorMessage || authError) && (
            <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs space-y-2">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{errorMessage || authError}</span>
              </div>
              {((errorMessage || authError)?.includes('zaten kayıtlı') || (errorMessage || authError)?.toLowerCase().includes('already registered')) && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                    setErrorMessage(null);
                  }}
                  className="w-full mt-1.5 py-1.5 px-3 rounded-lg bg-teal-400 text-[#0a0e13] font-bold text-xs hover:bg-teal-300 transition text-center shadow-sm"
                >
                  Giriş Yap Sekmesine Geç
                </button>
              )}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                    Firma Unvanı *
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={unvan}
                      onChange={(e) => setUnvan(e.target.value)}
                      placeholder="Örn: ABC Lojistik Tic. Ltd. Şti."
                      className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                    Vergi / TCKN No *
                  </label>
                  <div className="relative">
                    <FileText className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={vergiNo}
                      onChange={(e) => setVergiNo(e.target.value)}
                      placeholder="10 haneli VKN veya 11 haneli TCKN"
                      className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                    Ad Soyad (Yetkili) *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={adSoyad}
                      onChange={(e) => setAdSoyad(e.target.value)}
                      placeholder="Adınız Soyadınız"
                      className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                    Telefon
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
                    <input
                      type="tel"
                      value={telefon}
                      onChange={(e) => setTelefon(e.target.value)}
                      placeholder="05XX XXX XX XX"
                      className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                E-posta Adresi *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ornek@firma.com"
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                Şifre *
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3.5 top-3.5 text-gray-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 transition"
                />
              </div>
            </div>

            {/* BENİ HATIRLA SEÇENEĞİ */}
            <div className="flex items-center justify-between py-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded bg-[#0a0e13] border-white/20 text-teal-400 focus:ring-teal-400 focus:ring-offset-0 focus:ring-1 cursor-pointer"
                />
                <span className="text-xs text-gray-300 font-medium">Beni hatırla (Oturumu açık tut)</span>
              </label>
              <span className="text-[11px] text-teal-400/80">Güvenli Giriş</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold py-3 px-4 rounded-xl transition duration-200 flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(45,212,191,0.3)] disabled:opacity-50 text-sm"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-[#0a0e13] border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{isSignUp ? 'Hesabımı Oluştur ve Başla' : 'Giriş Yap'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* SÜREÇ BİLGİLENDİRMESİ */}
          {isSignUp && (
            <p className="mt-4 text-[11px] text-gray-400 text-center leading-relaxed">
              Kayıt olduğunuzda 7 günlük tam özellikli deneme süreniz otomatik başlar. Kredi kartı gerekmez.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
