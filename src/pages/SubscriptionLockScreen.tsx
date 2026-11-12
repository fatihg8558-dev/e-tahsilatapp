import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { ShieldAlert, CheckCircle2, Copy, CreditCard, Sparkles, AlertCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/formatters';

interface Paket {
  id: string;
  ad: string;
  sure_gun: number;
  fiyat: number;
  ek_plasiyer_ucreti: number;
  aktif: boolean;
}

export const SubscriptionLockScreen: React.FC = () => {
  const { firma, refreshProfileAndFirma, signOut, isPeriodExpired, periodInfo } = useAuth();
  const [paketler, setPaketler] = useState<Paket[]>([]);
  const [iban, setIban] = useState<string>('');
  const [hesapSahibi, setHesapSahibi] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchPackagesAndSettings = async () => {
      try {
        setLoading(true);
        // Paketler
        const { data: pData } = await supabase
          .from('paketler')
          .select('*')
          .eq('aktif', true)
          .order('fiyat', { ascending: true });

        if (pData) setPaketler(pData as Paket[]);

        // Ayarlar: IBAN ve Hesap Sahibi
        const { data: sData } = await supabase.from('ayarlar').select('*');
        if (sData) {
          sData.forEach((setting: { anahtar: string; deger: string }) => {
            if (setting.anahtar === 'iban') setIban(setting.deger);
            if (setting.anahtar === 'hesap_sahibi') setHesapSahibi(setting.deger);
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchPackagesAndSettings();
  }, []);

  const handleCopyIban = () => {
    if (!iban) return;
    navigator.clipboard.writeText(iban);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePaketSecimi = (p: Paket) => {
    setActionMessage(
      `"${p.ad}" paketi seçildi (${formatCurrency(p.fiyat)}). Lütfen aşağıdaki IBAN numarasına firma unvanınızı açıklama kısmına yazarak havale/EFT yapınız.`
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0e13] text-gray-100 flex flex-col justify-between p-4 sm:p-8 fintech-glow">
      <div className="max-w-4xl mx-auto w-full pt-6">
        {/* ÜST BİLGİLENDİRME BANNERI */}
        {isPeriodExpired ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 mb-8 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-red-400">Kullanım Süreniz Sona Erdi</h2>
            <p className="text-xs text-gray-300 mt-1 leading-relaxed">
              Firma hesabınızın ({firma?.unvan}) deneme veya paket süresi{' '}
              <span className="text-white font-medium">
                {formatDate(firma?.paket_bitis || firma?.deneme_bitis)}
              </span>{' '}
              tarihinde dolmuştur. Kesintisiz tahsilat ve tediye işlemlerine devam edebilmek için lütfen bir paket seçiniz.
            </p>
          </div>
          <button
            onClick={signOut}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-gray-300 transition"
          >
            Çıkış Yap
          </button>
        </div>
        ) : (
          <div className="bg-teal-400/10 border border-teal-400/20 rounded-2xl p-6 mb-8 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
            <div className="w-12 h-12 rounded-2xl bg-teal-400/20 text-teal-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-teal-400">
                {periodInfo.status === 'unlimited' ? 'Sınırsız Kullanım' : 'Aboneliğiniz Aktif'}
              </h2>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                {periodInfo.status === 'unlimited' ? (
                  'Hesabınızda süre sınırı yoktur.'
                ) : (
                  <>
                    Firma hesabınızın ({firma?.unvan}) süresi{' '}
                    <span className="text-white font-medium">
                      {formatDate(firma?.paket_bitis || firma?.deneme_bitis)}
                    </span>{' '}
                    tarihinde dolacak ({periodInfo.kalanGun} gün kaldı). Süre bitmeden yeni paket alabilirsiniz.
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {/* BAŞLIK & PAKETLER */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-400/10 border border-teal-400/20 text-teal-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Abonelik Paketleri</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            İşletmenize Uygun Paketi Seçin
          </h1>
          <p className="text-xs text-gray-400 mt-2">
            Tüm paketlerde sınırsız tahsilat & tediye makbuzu, cari ekstreleri ve bulut yedekleme dahildir.
          </p>
        </div>

        {actionMessage && (
          <div className="mb-6 p-4 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionMessage}</span>
          </div>
        )}

        {/* PAKET LİSTESİ */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {paketler.map((p) => (
              <div
                key={p.id}
                className="bg-[#111820] border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between hover:border-teal-400/40 transition duration-300 hover:shadow-[0_0_30px_rgba(45,212,191,0.15)] group relative"
              >
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold text-lg text-white group-hover:text-teal-300 transition">{p.ad}</h3>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                      {p.sure_gun} Gün
                    </span>
                  </div>

                  <div className="mb-6">
                    <span className="text-3xl font-black text-white">{formatCurrency(p.fiyat, false)}</span>
                    <span className="text-xs text-gray-400 ml-1.5 font-medium">₺ / dönem</span>
                  </div>

                  <ul className="space-y-2.5 text-xs text-gray-300 mb-6">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
                      <span>Sınırsız Tahsilat ve Tediye Makbuzu</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
                      <span>Cari Hesap Takibi ve Ekstreler</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
                      <span>Masaüstü ve Mobil Uyum</span>
                    </li>
                    {p.ek_plasiyer_ucreti > 0 && (
                      <li className="flex items-center gap-2 text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
                        <span>Ek Plasiyer: {formatCurrency(p.ek_plasiyer_ucreti)}</span>
                      </li>
                    )}
                  </ul>
                </div>

                <button
                  onClick={() => handlePaketSecimi(p)}
                  className="w-full bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold py-2.5 px-4 rounded-xl text-xs transition duration-200 shadow-md flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Paketi Seç</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* BANKA VE HAVALE BİLGİLERİ */}
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-6 sm:p-8">
          <h4 className="font-bold text-sm text-white mb-2">Banka Havale / EFT Bilgileri</h4>
          <p className="text-xs text-gray-400 mb-4 leading-relaxed">
            Paket ödemenizi aşağıdaki hesaba gönderirken açıklama kısmına{' '}
            <strong className="text-teal-400">{firma?.unvan}</strong> ve Vergi Numaranızı yazmayı unutmayınız.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-black/40 border border-white/[0.05]">
              <div className="text-[10px] text-gray-400 uppercase font-semibold">Hesap Sahibi</div>
              <div className="text-sm font-bold text-white mt-1">{hesapSahibi || 'Tahsilatım Yazılım A.Ş.'}</div>
            </div>

            <div className="p-4 rounded-xl bg-black/40 border border-white/[0.05] flex items-center justify-between">
              <div>
                <div className="text-[10px] text-gray-400 uppercase font-semibold">IBAN Numarası</div>
                <div className="text-sm font-mono font-bold text-teal-400 mt-1 tracking-wider">
                  {iban || 'TR00 0000 0000 0000 0000 0000 00'}
                </div>
              </div>
              <button
                onClick={handleCopyIban}
                title="IBAN Kopyala"
                className="p-2 text-gray-400 hover:text-teal-400 hover:bg-teal-500/10 rounded-lg transition"
              >
                {copied ? <CheckCircle2 className="w-5 h-5 text-teal-400" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.05] flex justify-between items-center text-xs">
            <span className="text-gray-400">Ödemeniz yapıldıktan sonra onay süreci başlatılır.</span>
            <button
              onClick={() => refreshProfileAndFirma()}
              className="text-teal-400 hover:text-teal-300 font-semibold underline"
            >
              Durumu Yenile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
