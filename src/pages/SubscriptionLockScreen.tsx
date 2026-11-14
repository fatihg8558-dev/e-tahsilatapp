import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  ShieldAlert,
  CheckCircle2,
  Copy,
  CreditCard,
  Sparkles,
  Crown,
  ArrowLeft,
  Upload,
  FileText,
  Landmark,
  AlertCircle,
  X,
} from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/formatters';
import { Paket } from '../types/database';

interface SubscriptionLockScreenProps {
  isLockMode?: boolean;
}

const PAKET_OZELLIKLERI = [
  'Sınırsız Tahsilat ve Tediye Makbuzu',
  'Cari Hesap Takibi, Bakiyeler ve Ekstreler',
  'Çek / Senet Vade & Ciro Takibi',
  'Kasa & Gelir-Gider Yönetimi',
  'PDF Makbuz & WhatsApp / E-posta Paylaşımı',
  'UBL / XML Fatura İçe Aktarma',
  'Çoklu Kullanıcı / Saha Plasiyer Desteği',
  'Bulut Yedekleme & Mobil/Masaüstü Erişim',
];

export const SubscriptionLockScreen: React.FC<SubscriptionLockScreenProps> = ({ isLockMode = true }) => {
  const { firma, profile, periodInfo, refreshProfileAndFirma, signOut } = useAuth();
  const [paketler, setPaketler] = useState<Paket[]>([]);
  const [iban, setIban] = useState<string>('');
  const [hesapSahibi, setHesapSahibi] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [secili, setSecili] = useState<Paket | null>(null);
  const [dosya, setDosya] = useState<File | null>(null);
  const [aciklama, setAciklama] = useState('');
  const [gonderiyor, setGonderiyor] = useState(false);
  const [hata, setHata] = useState('');
  const [bildirimler, setBildirimler] = useState<any[]>([]);

  const yukleBildirimler = async () => {
    if (!firma?.id) return;
    const { data } = await supabase
      .from('odeme_bildirimleri')
      .select('id,tutar,durum,tarih')
      .eq('firma_id', firma.id)
      .order('tarih', { ascending: false })
      .limit(5);
    setBildirimler(data ?? []);
  };

  useEffect(() => {
    yukleBildirimler();
  }, [firma?.id]);

  useEffect(() => {
    const fetchPackagesAndSettings = async () => {
      try {
        setLoading(true);
        const { data: pData } = await supabase
          .from('paketler')
          .select('*')
          .eq('aktif', true)
          .order('fiyat', { ascending: true });

        if (pData) setPaketler(pData as Paket[]);

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
    setSecili(p);
    setDosya(null);
    setAciklama('');
    setHata('');
    setActionMessage(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePaketlereDon = () => {
    setSecili(null);
    setDosya(null);
    setHata('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const bildirimGonder = async () => {
    if (!secili || !firma?.id) return;
    if (profile?.rol !== 'ana') return setHata('Ödeme bildirimi yalnızca ana hesap tarafından yapılabilir.');
    if (!dosya) return setHata('Lütfen dekont dosyasını seçin.');
    if (dosya.size > 5 * 1024 * 1024) return setHata('Dosya 5 MB’tan küçük olmalı.');
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(dosya.type)) {
      return setHata('Yalnızca JPG, PNG veya PDF yükleyebilirsiniz.');
    }
    setGonderiyor(true);
    setHata('');
    const ext = dosya.type === 'application/pdf' ? 'pdf' : dosya.type === 'image/png' ? 'png' : 'jpg';
    const yol = `${firma.id}/${Date.now()}.${ext}`;
    const up = await supabase.storage.from('dekontlar').upload(yol, dosya, { contentType: dosya.type });
    if (up.error) {
      setGonderiyor(false);
      return setHata('Dekont yüklenemedi: ' + up.error.message);
    }
    const ins = await supabase.from('odeme_bildirimleri').insert({
      firma_id: firma.id,
      paket_id: secili.id,
      tutar: secili.fiyat,
      dekont_url: yol,
      durum: 'bekliyor',
      tarih: new Date().toISOString(),
      not: aciklama.trim() || null,
    });
    setGonderiyor(false);
    if (ins.error) return setHata('Bildirim kaydedilemedi: ' + ins.error.message);
    setSecili(null);
    setDosya(null);
    setAciklama('');
    setActionMessage('Ödeme bildiriminiz alındı. Kontrol edilip onaylandığında süreniz uzatılacak.');
    yukleBildirimler();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // SEÇİLİ PAKET DETAY VE DEKONT YÜKLEME SAYFASI
  if (secili) {
    return (
      <div className={isLockMode ? 'min-h-screen bg-[#0a0e13] text-gray-100 flex flex-col p-4 sm:p-8 fintech-glow' : 'text-gray-100 pb-10'}>
        <div className={isLockMode ? 'max-w-3xl mx-auto w-full pt-2 sm:pt-4 space-y-5' : 'max-w-3xl mx-auto w-full space-y-5'}>
          {/* Üst Geri Dönüş Çubuğu */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handlePaketlereDon}
              data-testid="paket_back_btn"
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-gray-200 transition"
            >
              <ArrowLeft className="w-4 h-4 text-teal-400" />
              <span>Paketlere Dön</span>
            </button>

            <span className="px-3 py-1 rounded-full bg-teal-400/10 border border-teal-400/25 text-teal-300 text-[11px] font-bold uppercase tracking-wider">
              {secili.sure_gun} Günlük Paket
            </span>
          </div>

          {/* 1. PAKET ÖZELLİKLERİ KARTI */}
          <div className="bg-[#111820] border border-teal-400/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_30px_rgba(45,212,191,0.08)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/[0.07]">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-teal-400 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Seçilen Paket Özeti</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-white">{secili.ad}</h1>
                <p className="text-xs text-gray-400 mt-1">
                  {secili.sure_gun} gün kesintisiz tam erişim
                  {secili.ek_plasiyer_ucreti > 0
                    ? ` • Ek Plasiyer Ücreti: ${formatCurrency(secili.ek_plasiyer_ucreti)}`
                    : ' • Ek Plasiyer Ücreti Yok'}
                </p>
              </div>

              <div className="sm:text-right bg-black/30 border border-white/[0.06] rounded-xl px-4 py-3 shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Ödenecek Tutar</div>
                <div className="text-2xl sm:text-3xl font-black text-teal-300 mt-0.5">
                  {formatCurrency(secili.fiyat)}
                </div>
              </div>
            </div>

            <div className="pt-5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-300 mb-3">
                Paket Özellikleri
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {PAKET_OZELLIKLERI.map((ozellik) => (
                  <div
                    key={ozellik}
                    className="flex items-start gap-2.5 p-2.5 rounded-xl bg-black/25 border border-white/[0.05] text-xs text-gray-200"
                  >
                    <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                    <span>{ozellik}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2. BANKA HAVALE / EFT BİLGİLERİ */}
          <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-2">
              <Landmark className="w-4 h-4 text-teal-400" />
              <h3 className="font-bold text-sm text-white">1. Adım: Banka Havale / EFT Yapın</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              Havale/EFT açıklama kısmına firma ünvanınız{' '}
              <strong className="text-teal-300">{firma?.unvan}</strong>
              {firma?.vergi_no ? (
                <>
                  {' '}ve Vergi No <strong className="text-teal-300">{firma.vergi_no}</strong>
                </>
              ) : null}{' '}
              bilgisini yazmayı unutmayınız.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06]">
                <div className="text-[10px] text-gray-400 uppercase font-semibold">Hesap Sahibi</div>
                <div className="text-sm font-bold text-white mt-1">{hesapSahibi || 'Tahsilatım Yazılım A.Ş.'}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">IBAN Numarası</div>
                  <div className="text-xs sm:text-sm font-mono font-bold text-teal-400 mt-1 tracking-wider break-all">
                    {iban || 'TR00 0000 0000 0000 0000 0000 00'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyIban}
                  title="IBAN Kopyala"
                  data-testid="copy_iban_btn"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-300 hover:text-teal-400 hover:bg-teal-500/10 rounded-xl transition shrink-0"
                >
                  {copied ? <CheckCircle2 className="w-5 h-5 text-teal-400" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          {/* 3. DEKONT YÜKLEME VE ÖDEME BİLDİRİMİ */}
          <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-teal-400" />
              <h3 className="font-bold text-sm text-white">2. Adım: Dekont Yükle & Bildirimi Gönder</h3>
            </div>

            {profile?.rol !== 'ana' && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Ödeme bildirimi yalnızca firmanın Ana Hesabı tarafından yapılabilir.</span>
              </div>
            )}

            <label className="block cursor-pointer">
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                data-testid="dekont_file_input"
                onChange={(e) => {
                  setDosya(e.target.files?.[0] ?? null);
                  setHata('');
                }}
                className="sr-only"
              />
              <div className="min-h-[96px] rounded-2xl border-2 border-dashed border-teal-400/30 hover:border-teal-400/60 bg-teal-400/[0.03] hover:bg-teal-400/[0.06] p-4 flex flex-col items-center justify-center text-center transition">
                {dosya ? (
                  <div className="flex items-center gap-3 text-left w-full max-w-md justify-between bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-5 h-5 text-teal-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{dosya.name}</div>
                        <div className="text-[11px] text-gray-400">{formatFileSize(dosya.size)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setDosya(null);
                      }}
                      aria-label="Seçili dosyayı kaldır"
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-teal-400 mb-1.5" />
                    <span className="text-xs font-bold text-white">Dekont Dosyası Seçin</span>
                    <span className="text-[11px] text-gray-400 mt-0.5">
                      JPG, PNG veya PDF formatında (en fazla 5 MB)
                    </span>
                  </>
                )}
              </div>
            </label>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                Açıklama / Not (İsteğe Bağlı)
              </label>
              <input
                type="text"
                data-testid="dekont_note_input"
                value={aciklama}
                onChange={(e) => setAciklama(e.target.value)}
                placeholder="Örn: Havale gönderen adı veya işlem saati"
                className="w-full min-h-[44px] rounded-xl bg-[#0a0e13] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
              />
            </div>

            {hata && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{hata}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={bildirimGonder}
                disabled={gonderiyor}
                data-testid="dekont_submit_btn"
                className="flex-1 min-h-[48px] px-5 py-3 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] text-xs font-extrabold disabled:opacity-60 transition shadow-lg flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{gonderiyor ? 'Gönderiliyor…' : 'Ödeme Bildirimini Gönder'}</span>
              </button>
              <button
                type="button"
                onClick={handlePaketlereDon}
                className="min-h-[48px] px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={isLockMode ? 'min-h-screen bg-[#0a0e13] text-gray-100 flex flex-col justify-between p-4 sm:p-8 fintech-glow' : 'text-gray-100 pb-8'}>
      <div className={isLockMode ? 'max-w-4xl mx-auto w-full pt-6' : 'max-w-4xl mx-auto w-full'}>
        {/* ÜST BİLGİLENDİRME BANNERI */}
        {isLockMode ? (
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
          <div className="bg-teal-500/10 border border-teal-500/25 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-teal-400/15 text-teal-300 border border-teal-400/30 flex items-center justify-center shrink-0">
                <Crown className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">
                  {periodInfo.status === 'unlimited'
                    ? 'Sınırsız Tam Erişim Aktif'
                    : periodInfo.status === 'active_package'
                    ? `Aktif Abonelik (${periodInfo.kalanGun} Gün Kaldı)`
                    : `Ücretsiz Deneme Süresi (${periodInfo.kalanGun} Gün Kaldı)`}
                </h2>
                <p className="text-xs text-gray-300 mt-0.5">
                  {firma?.unvan}
                  {periodInfo.bitisTarihi ? ` • Bitiş Tarihi: ${formatDate(periodInfo.bitisTarihi)}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => refreshProfileAndFirma()}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-teal-400/15 hover:bg-teal-400/25 text-teal-300 border border-teal-400/30 transition"
            >
              Durumu Yenile
            </button>
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
            Paket seçtiğinizde tüm paket özellikleri ve dekont yükleme ekranı açılır.
          </p>
        </div>

        {actionMessage && (
          <div className="mb-6 p-4 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionMessage}</span>
          </div>
        )}

        {bildirimler.length > 0 && (
          <div className="mb-8 rounded-2xl border border-white/10 bg-[#111820]/70 p-4 text-xs text-gray-300">
            <p className="font-bold text-white mb-2">Son ödeme bildirimleriniz</p>
            {bildirimler.map((b) => (
              <div key={b.id} className="flex justify-between py-1.5 border-b border-white/5 last:border-0">
                <span>{formatDate(b.tarih)} · {formatCurrency(b.tutar)}</span>
                <span className={b.durum === 'onaylandi' ? 'text-teal-300' : b.durum === 'red' ? 'text-red-400' : 'text-amber-300'}>
                  {b.durum === 'onaylandi' ? 'Onaylandı' : b.durum === 'red' ? 'Reddedildi' : 'Onay bekliyor'}
                </span>
              </div>
            ))}
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
                  type="button"
                  onClick={() => handlePaketSecimi(p)}
                  data-testid={`select_paket_${p.id}`}
                  className="w-full min-h-[44px] bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold py-2.5 px-4 rounded-xl text-xs transition duration-200 shadow-md flex items-center justify-center gap-2"
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
                type="button"
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
              type="button"
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
