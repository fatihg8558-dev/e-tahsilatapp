import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Islem } from '../types/database';
import { formatCurrency, formatDate, getGreeting } from '../lib/formatters';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Users,
  Bell,
  Plus,
  ReceiptText,
  Clock,
  Sparkles,
  ChevronRight,
  ShieldAlert,
  CalendarClock,
  Calendar,
  AlertTriangle,
  FileCheck,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';

export interface VadeItem {
  islem: Islem;
  diffDays: number;
  durumLabel: string;
  durumClass: string;
}

interface DashboardPageProps {
  onNavigate: (tab: string, state?: unknown) => void;
  onOpenMakbuz: (islem: Islem) => void;
  onOpenNotifications?: () => void;
  refreshKey?: number;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  onNavigate,
  onOpenMakbuz,
  onOpenNotifications,
  refreshKey = 0,
}) => {
  const { profile, firma } = useAuth();
  const [loading, setLoading] = useState(true);
  const [toplamTahsilat, setToplamTahsilat] = useState(0);
  const [toplamTediye, setToplamTediye] = useState(0);
  const [bugunTahsilat, setBugunTahsilat] = useState(0);
  const [bugunTediye, setBugunTediye] = useState(0);
  const [vadeAraligiGun, setVadeAraligiGun] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('tahsilatim_vade_gun_esigi');
      return saved ? parseInt(saved, 10) : 15;
    } catch {
      return 15;
    }
  });
  const [aktifCariSayisi, setAktifCariSayisi] = useState(0);
  const [bekleyenBildirimSayisi, setBekleyenBildirimSayisi] = useState(0);
  const [sonIslemler, setSonIslemler] = useState<Islem[]>([]);
  const [vadesiYaklasanlar, setVadesiYaklasanlar] = useState<VadeItem[]>([]);
  const [vadeFilter, setVadeFilter] = useState<'all' | 'tahsilat' | 'tediye'>('all');
  const [error, setError] = useState<string | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  const handleVadeAraligiChange = (gun: number) => {
    setVadeAraligiGun(gun);
    try {
      localStorage.setItem('tahsilatim_vade_gun_esigi', gun.toString());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!firma?.id) return;

    const loadDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        // 1. İşlemleri Çek (Plasiyer ise sadece yapan_user_id = profile.id; Ana hesap ise tüm firma)
        let query = supabase
          .from('islemler')
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
          .eq('firma_id', firma.id)
          .order('tarih', { ascending: false })
          .order('id', { ascending: false });

        if (profile?.rol === 'plasiyer') {
          query = query.eq('yapan_user_id', profile.id);
        }

        const { data: islemlerData, error: islemlerErr } = await query.limit(50);

        if (islemlerErr) throw islemlerErr;

        if (islemlerData) {
          // Son 8 işlem
          setSonIslemler(islemlerData.slice(0, 8) as Islem[]);

          // Toplam Tahsilat, Tediye ve Bugünkü Tutarlar
          const todayStr = new Date().toISOString().split('T')[0];
          let tTahsilat = 0;
          let tTediye = 0;
          let tBugunTahsilat = 0;
          let tBugunTediye = 0;

          islemlerData.forEach((islem) => {
            if (!islem.iptal) {
              const tutar = Number(islem.tutar) || 0;
              if (islem.tip === 'tahsilat') tTahsilat += tutar;
              else if (islem.tip === 'tediye') tTediye += tutar;

              if (islem.tarih && islem.tarih.startsWith(todayStr)) {
                if (islem.tip === 'tahsilat') tBugunTahsilat += tutar;
                else if (islem.tip === 'tediye') tBugunTediye += tutar;
              }
            }
          });

          setToplamTahsilat(tTahsilat);
          setToplamTediye(tTediye);
          setBugunTahsilat(tBugunTahsilat);
          setBugunTediye(tBugunTediye);
        }

        // 2. Vadesi Yaklaşan Çek ve Senetleri Çek
        const { data: cekSenetData, error: cekSenetErr } = await supabase
          .from('islemler')
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
          .eq('firma_id', firma.id)
          .in('tur', ['cek', 'senet'])
          .eq('iptal', false)
          .not('vade', 'is', null)
          .order('vade', { ascending: true });

        if (!cekSenetErr && cekSenetData) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);

          const items: VadeItem[] = [];

          cekSenetData.forEach((item) => {
            // Ciro edilmiş çek ve senetleri hariç tut:
            // 1. Müşteriden alınıp tedarikçiye ciro edilmiş tahsilat çeki ([CİRO EDİLDİ -> ...)
            // 2. Tedarikçiye ciro olarak verilmiş tediye çeki ([CİRO EDİLDİ - Asıl Borçlu: ...)
            // 3. Açıklamasında veya notunda 'CİRO' geçen herhangi bir işlem
            const aciklamaUpper = (item.aciklama || '').toUpperCase();
            if (
              aciklamaUpper.includes('CİRO') ||
              aciklamaUpper.includes('CIRO') ||
              item.durum === 'ciro'
            ) {
              return;
            }

            if (!item.vade) return;
            const cleanVade = item.vade.trim();
            let vDate: Date | null = null;

            if (/^\d{4}-\d{2}-\d{2}$/.test(cleanVade)) {
              const parts = cleanVade.split('-');
              vDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(cleanVade)) {
              const parts = cleanVade.split('.');
              vDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
            }

            if (!vDate || isNaN(vDate.getTime())) return;
            vDate.setHours(0, 0, 0, 0);

            const diffMs = vDate.getTime() - now.getTime();
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

            // Vadesi geçmiş veya seçilen gün eşiği içinde olanlar
            if (diffDays <= vadeAraligiGun && diffDays >= -60) {
              let durumLabel = '';
              let durumClass = '';

              if (diffDays < 0) {
                durumLabel = `${Math.abs(diffDays)} GÜN GEÇTİ`;
                durumClass = 'bg-red-500/20 text-red-300 border-red-500/40 font-bold';
              } else if (diffDays === 0) {
                durumLabel = 'BUGÜN VADESİ GELİYOR';
                durumClass = 'bg-amber-500/25 text-amber-300 border-amber-500/50 font-black animate-pulse';
              } else if (diffDays === 1) {
                durumLabel = 'YARIN VADESİ';
                durumClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30 font-bold';
              } else if (diffDays <= 7) {
                durumLabel = `${diffDays} GÜN KALDI`;
                durumClass = 'bg-teal-500/20 text-teal-300 border-teal-500/30 font-bold';
              } else {
                durumLabel = `${diffDays} gün kaldı`;
                durumClass = 'bg-blue-500/10 text-blue-300 border-blue-500/20 font-medium';
              }

              items.push({
                islem: item as Islem,
                diffDays,
                durumLabel,
                durumClass,
              });
            }
          });

          // En acil olanlar en üstte (Vadesi geçenler -> Bugün -> Yaklaşanlar)
          items.sort((a, b) => a.diffDays - b.diffDays);
          setVadesiYaklasanlar(items);
        }

        // 3. Aktif Cari Sayısı
        const { count: cariCount, error: cariErr } = await supabase
          .from('cariler')
          .select('*', { count: 'exact', head: true })
          .eq('firma_id', firma.id);

        if (!cariErr && cariCount !== null) {
          setAktifCariSayisi(cariCount);
        }

        // 4. Bekleyen Bildirim Sayısı
        const { count: notifCount, error: notifErr } = await supabase
          .from('bildirimler')
          .select('*', { count: 'exact', head: true })
          .eq('alici_firma_id', firma.id)
          .eq('durum', 'bekliyor');

        if (!notifErr && notifCount !== null) {
          setBekleyenBildirimSayisi(notifCount);
        }
      } catch (err: unknown) {
        const msg = handleSupabaseError(err, 'Gösterge verileri yüklenirken bir hata oluştu.');
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [firma?.id, profile?.id, profile?.rol, vadeAraligiGun, refreshKey]);

  return (
    <div className="space-y-8">
      {/* SAYFA BAŞLIĞI & KARŞILAMA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-3 h-3" />
            <span>Genel Bakış</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {getGreeting(profile?.ad_soyad)}
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {firma?.unvan} firması için tahsilat, tediye ve güncel cari hareketleri özeti
          </p>
        </div>

        {/* SAĞ ÜST HIZLI AKSİYONLAR */}
        {profile?.rol !== 'muhasebeci' && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => onNavigate('performans')}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2"
            >
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>{profile?.rol === 'plasiyer' ? 'Performans Raporum' : 'Plasiyer Raporları'}</span>
            </button>
            <button
              onClick={() => onNavigate('tahsilat')}
              className="bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs px-4 py-2.5 rounded-xl transition shadow-[0_0_20px_rgba(45,212,191,0.25)] flex items-center gap-2"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Yeni Tahsilat</span>
            </button>
            <button
              onClick={() => onNavigate('tediye')}
              className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-2"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Yeni Tediye</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 6 ÖZET KARTI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* BUGÜNKÜ TAHSİLAT */}
        <div className="bg-[#111820] border border-teal-500/20 rounded-2xl p-5 hover:border-teal-400/40 transition duration-300 group shadow-[0_0_20px_rgba(45,212,191,0.05)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-teal-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              Bugünkü Tahsilat
            </span>
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {loading ? '...' : formatCurrency(bugunTahsilat)}
          </div>
          <div className="text-[11px] text-teal-400/80 font-medium mt-1">Bugün yapılan tahsilatlar toplamı</div>
        </div>

        {/* BUGÜNKÜ TEDİYE */}
        <div className="bg-[#111820] border border-orange-500/20 rounded-2xl p-5 hover:border-orange-500/40 transition duration-300 group shadow-[0_0_20px_rgba(249,115,22,0.05)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-orange-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
              Bugünkü Tediye
            </span>
            <div className="w-9 h-9 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {loading ? '...' : formatCurrency(bugunTediye)}
          </div>
          <div className="text-[11px] text-orange-400/80 font-medium mt-1">Bugün yapılan ödemeler toplamı</div>
        </div>

        {/* TOPLAM TAHSİLAT */}
        <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-5 hover:border-teal-400/30 transition duration-300 group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Toplam Tahsilat</span>
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {loading ? '...' : formatCurrency(toplamTahsilat)}
          </div>
          <div className="text-[11px] text-teal-400/80 font-medium mt-1">İptal edilenler hariç net tahsilat</div>
        </div>

        {/* TOPLAM TEDİYE */}
        <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-5 hover:border-orange-500/30 transition duration-300 group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Toplam Tediye</span>
            <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {loading ? '...' : formatCurrency(toplamTediye)}
          </div>
          <div className="text-[11px] text-orange-400/80 font-medium mt-1">İptal edilenler hariç net ödeme</div>
        </div>

        {/* AKTİF CARİ */}
        <div
          onClick={() => onNavigate('cariler')}
          className="bg-[#111820] border border-white/[0.07] rounded-2xl p-5 hover:border-teal-400/30 transition duration-300 group cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Aktif Cari</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center group-hover:scale-110 transition">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {loading ? '...' : `${aktifCariSayisi} Firma`}
          </div>
          <div className="text-[11px] text-gray-400 font-medium mt-1 flex items-center gap-1 group-hover:text-teal-400 transition">
            <span>Carileri Yönet</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </div>

        {/* BEKLEYEN BİLDİRİM */}
        <div
          onClick={() => (onOpenNotifications ? onOpenNotifications() : onNavigate('islemler'))}
          className="bg-[#111820] border border-white/[0.07] rounded-2xl p-5 hover:border-teal-400/30 transition duration-300 group cursor-pointer"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bekleyen Bildirim</span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center group-hover:scale-110 transition relative">
              <Bell className="w-5 h-5" />
              {bekleyenBildirimSayisi > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-teal-400 animate-ping" />
              )}
            </div>
          </div>
          <div className="text-2xl font-black text-white tracking-tight">
            {loading ? '...' : `${bekleyenBildirimSayisi} Adet`}
          </div>
          <div className="text-[11px] text-gray-400 font-medium mt-1">Bildirim merkezini aç</div>
        </div>
      </div>

      {/* VADESİ YAKLAŞAN ÇEK VE SENETLER BİLDİRİM PANELİ */}
      {(() => {
        const filteredItems = vadesiYaklasanlar.filter(
          (i) => vadeFilter === 'all' || i.islem.tip === vadeFilter
        );
        const tahsilatCount = vadesiYaklasanlar.filter((i) => i.islem.tip === 'tahsilat').length;
        const tediyeCount = vadesiYaklasanlar.filter((i) => i.islem.tip === 'tediye').length;
        const gecikmisSayisi = vadesiYaklasanlar.filter((i) => i.diffDays < 0).length;
        const bugunSayisi = vadesiYaklasanlar.filter((i) => i.diffDays === 0).length;

        return (
          <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
            {/* BAŞLIK VE ÖZET BADGELERİ */}
            <div className="p-4 sm:p-5 border-b border-white/[0.07] flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-teal-500/10 via-transparent to-orange-500/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center shrink-0 shadow-lg">
                  <CalendarClock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-sm sm:text-base text-white tracking-tight">
                      Vadesi Yaklaşan Çek ve Senetler
                    </h3>
                    {vadesiYaklasanlar.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-teal-400 text-[#0a0e13]">
                        {vadesiYaklasanlar.length} Adet
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Önümüzdeki {vadeAraligiGun} gün içinde vadesi gelen veya vadesi geçmiş portföy hareketleri
                  </p>
                </div>
              </div>

              {/* GÜN EŞİĞİ SEÇİCİ VE FİLTRELER */}
              <div className="flex items-center gap-2.5 self-start lg:self-auto flex-wrap">
                {/* Gün Eşiği Seçici (3, 7, 15, 30 gün) */}
                <div className="flex items-center gap-1 bg-black/50 p-1 rounded-xl border border-white/[0.08]">
                  <span className="text-[10px] text-gray-400 font-semibold px-2">Bildirim:</span>
                  {[3, 7, 15, 30].map((gun) => (
                    <button
                      key={gun}
                      type="button"
                      onClick={() => handleVadeAraligiChange(gun)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                        vadeAraligiGun === gun
                          ? 'bg-amber-400 text-[#0a0e13] shadow-sm'
                          : 'text-gray-400 hover:text-white hover:bg-white/[0.05]'
                      }`}
                    >
                      {gun}G
                    </button>
                  ))}
                </div>

                {gecikmisSayisi > 0 && (
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                    {gecikmisSayisi} Gecikmiş
                  </span>
                )}
                {bugunSayisi > 0 && (
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    {bugunSayisi} Bugün Vadesi Dolan
                  </span>
                )}
                <div className="flex rounded-lg bg-black/40 p-0.5 border border-white/[0.06] text-xs">
                  <button
                    type="button"
                    onClick={() => setVadeFilter('all')}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${
                      vadeFilter === 'all' ? 'bg-teal-400 text-[#0a0e13]' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Tümü ({vadesiYaklasanlar.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setVadeFilter('tahsilat')}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${
                      vadeFilter === 'tahsilat' ? 'bg-teal-400 text-[#0a0e13]' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Tahsilat ({tahsilatCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setVadeFilter('tediye')}
                    className={`px-2 py-1 rounded-md text-[11px] font-semibold transition ${
                      vadeFilter === 'tediye' ? 'bg-orange-400 text-[#0a0e13]' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Tediye ({tediyeCount})
                  </button>
                </div>
              </div>
            </div>

            {/* LİSTE */}
            {vadesiYaklasanlar.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400 flex flex-col items-center justify-center gap-1.5">
                <CheckCircle2 className="w-6 h-6 text-teal-400/80 mb-1" />
                <span className="text-gray-300 font-semibold">Tüm Çek ve Senet Vadeleri Güncel</span>
                <span className="text-[11px] text-gray-500">
                  Önümüzdeki 30 gün içinde vadesi gelen veya vadesi geçmiş çek/senet kaydı bulunmuyor.
                </span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400">
                Seçili filtreye uygun çek/senet kaydı bulunmuyor.
              </div>
            ) : (
              <div className="p-4 divide-y divide-white/[0.04] space-y-2.5">
                {filteredItems.map((item) => (
                  <div
                    key={item.islem.id}
                    onClick={() => onOpenMakbuz(item.islem)}
                    className="pt-2.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-black/30 hover:bg-white/[0.04] border border-white/[0.05] hover:border-teal-400/30 transition cursor-pointer group"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          item.islem.tip === 'tahsilat'
                            ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                            : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                        }`}
                      >
                        {item.islem.tip === 'tahsilat' ? (
                          <ArrowDownLeft className="w-5 h-5" />
                        ) : (
                          <ArrowUpRight className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-white text-xs group-hover:text-teal-300 transition">
                            {item.islem.cariler?.unvan || 'Cari Belirtilmemiş'}
                          </span>
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${item.durumClass}`}
                          >
                            {item.durumLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-1 flex-wrap">
                          <span className="text-gray-300 font-semibold capitalize">
                            {item.islem.tur === 'cek' ? 'Çek' : 'Senet'}
                          </span>
                          <span>•</span>
                          <span className="font-mono text-teal-400">No: {item.islem.belge_no || '-'}</span>
                          {item.islem.banka_adi && (
                            <>
                              <span>•</span>
                              <span>{item.islem.banka_adi}</span>
                            </>
                          )}
                          <span>•</span>
                          <span className="text-gray-300">
                            Vade: <strong className="text-white">{formatDate(item.islem.vade)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 border-white/[0.05]">
                      <span className="text-sm sm:text-base font-black text-white font-mono tracking-tight group-hover:text-teal-400 transition">
                        {formatCurrency(item.islem.tutar)}
                      </span>
                      <span className="text-[10px] text-gray-400 group-hover:text-teal-300 flex items-center gap-1 font-medium mt-0.5">
                        <span>Makbuzu Aç</span>
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* HIZLI İŞLEMLER PANELİ */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-5">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-teal-400" />
          <span>Hızlı İşlemler</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => onNavigate('tahsilat')}
            className="p-3.5 rounded-xl bg-black/40 hover:bg-teal-500/10 border border-white/[0.05] hover:border-teal-500/30 transition text-left group"
          >
            <div className="w-7 h-7 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center mb-2 group-hover:scale-110 transition">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-white group-hover:text-teal-300">Yeni Tahsilat</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Alıcıdan ödeme al</div>
          </button>

          <button
            onClick={() => onNavigate('tediye')}
            className="p-3.5 rounded-xl bg-black/40 hover:bg-orange-500/10 border border-white/[0.05] hover:border-orange-500/30 transition text-left group"
          >
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 text-orange-400 flex items-center justify-center mb-2 group-hover:scale-110 transition">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-white group-hover:text-orange-300">Yeni Tediye</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Tedarikçiye ödeme yap</div>
          </button>

          <button
            onClick={() => onNavigate('cariler', { openNew: true })}
            className="p-3.5 rounded-xl bg-black/40 hover:bg-blue-500/10 border border-white/[0.05] hover:border-blue-500/30 transition text-left group"
          >
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-2 group-hover:scale-110 transition">
              <Users className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-white group-hover:text-blue-300">Yeni Cari Ekle</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Müşteri veya tedarikçi</div>
          </button>

          <button
            onClick={() => onNavigate('islemler')}
            className="p-3.5 rounded-xl bg-black/40 hover:bg-purple-500/10 border border-white/[0.05] hover:border-purple-500/30 transition text-left group"
          >
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-2 group-hover:scale-110 transition">
              <ReceiptText className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-white group-hover:text-purple-300">Tüm İşlemler</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Filtrele ve raporla</div>
          </button>
        </div>
      </div>

      {/* SON İŞLEMLER (8 KAYIT) */}
      <div className="bg-[#111820] border border-white/[0.07] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-5 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ReceiptText className="w-4 h-4 text-teal-400" />
            <h3 className="font-bold text-sm text-white">Son İşlemler</h3>
            <span className="text-[11px] text-gray-400">(Son 8 Kayıt)</span>
          </div>
          <button
            onClick={() => onNavigate('islemler')}
            className="text-xs text-teal-400 hover:text-teal-300 font-semibold flex items-center gap-1 transition"
          >
            <span>Tümünü Gör</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-gray-400">İşlemler yükleniyor...</div>
        ) : sonIslemler.length === 0 ? (
          <div className="p-12 text-center">
            <ReceiptText className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Henüz kaydedilmiş bir tahsilat veya tediye makbuzu bulunmuyor.</p>
            <button
              onClick={() => onNavigate('tahsilat')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-400 text-[#0a0e13] font-bold text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>İlk Makbuzu Düzenle</span>
            </button>
          </div>
        ) : (
          <div>
            {/* MASAÜSTÜ TABLO GÖRÜNÜMÜ */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/20 text-gray-400 text-[11px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-5">Tarih</th>
                    <th className="py-3 px-4">Makbuz No</th>
                    <th className="py-3 px-4">Cari Unvanı</th>
                    <th className="py-3 px-4">Tür</th>
                    <th className="py-3 px-4">Tip</th>
                    <th className="py-3 px-4">Durum</th>
                    <th className="py-3 px-5 text-right">Tutar (₺)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {sonIslemler.map((islem) => (
                    <tr
                      key={islem.id}
                      onClick={() => onOpenMakbuz(islem)}
                      className="hover:bg-white/[0.03] transition cursor-pointer group"
                    >
                      <td className="py-3.5 px-5 text-gray-300 font-medium whitespace-nowrap">
                        {formatDate(islem.tarih)}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-teal-400 whitespace-nowrap">
                        {islem.makbuz_no || `#${islem.id.slice(0, 8)}`}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-white max-w-[200px] truncate">
                        {islem.cariler?.unvan || '-'}
                      </td>
                      <td className="py-3.5 px-4 text-gray-400 capitalize">
                        {islem.tur.replace('_', ' ')}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            islem.tip === 'tahsilat'
                              ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                              : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                          }`}
                        >
                          {islem.tip}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {islem.iptal ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                            İptal
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              islem.durum === 'aktif'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : islem.durum === 'plasiyerde'
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-blue-500/10 text-blue-400'
                            }`}
                          >
                            {islem.durum}
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-3.5 px-5 text-right font-bold text-sm whitespace-nowrap ${
                          islem.iptal
                            ? 'line-through text-gray-500'
                            : islem.tip === 'tahsilat'
                            ? 'text-teal-400'
                            : 'text-orange-400'
                        }`}
                      >
                        {formatCurrency(islem.tutar)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* MOBİL KART LİSTESİ */}
            <div className="md:hidden divide-y divide-white/[0.04]">
              {sonIslemler.map((islem) => (
                <div
                  key={islem.id}
                  onClick={() => onOpenMakbuz(islem)}
                  className="p-4 hover:bg-white/[0.03] transition cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-teal-400">
                      {islem.makbuz_no || `#${islem.id.slice(0, 8)}`}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        islem.iptal
                          ? 'line-through text-gray-500'
                          : islem.tip === 'tahsilat'
                          ? 'text-teal-400'
                          : 'text-orange-400'
                      }`}
                    >
                      {formatCurrency(islem.tutar)}
                    </span>
                  </div>

                  <div className="text-xs font-semibold text-white mb-1 truncate">
                    {islem.cariler?.unvan || 'Cari Belirtilmemiş'}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          islem.tip === 'tahsilat'
                            ? 'bg-teal-500/10 text-teal-400'
                            : 'bg-orange-500/10 text-orange-400'
                        }`}
                      >
                        {islem.tip}
                      </span>
                      <span className="capitalize">{islem.tur.replace('_', ' ')}</span>
                    </div>
                    <span>{formatDate(islem.tarih)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* HIZLI İŞLEM YÜZEN EYLEM BUTONLARI (FAB - FLOATING ACTION BUTTON) */}
      {profile?.rol !== 'muhasebeci' && (
        <div className="fixed bottom-20 right-4 sm:bottom-8 sm:right-8 z-40 flex flex-col items-end gap-2.5">
          {/* AÇILIR BUTONLAR */}
          {fabOpen && (
            <div className="flex flex-col items-end gap-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
              {/* YENİ CARİ BUTONU */}
              <button
                type="button"
                onClick={() => {
                  setFabOpen(false);
                  onNavigate('cariler', { openNew: true });
                }}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/95 hover:bg-slate-850 text-white text-xs font-bold border border-slate-700/80 shadow-2xl transition hover:scale-105 active:scale-95 group"
              >
                <span className="text-slate-200 group-hover:text-white transition">Yeni Cari Ekle</span>
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
              </button>

              {/* YENİ TEDİYE FİŞİ BUTONU */}
              <button
                type="button"
                onClick={() => {
                  setFabOpen(false);
                  onNavigate('tediye');
                }}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/95 hover:bg-slate-850 text-white text-xs font-bold border border-orange-500/40 shadow-2xl transition hover:scale-105 active:scale-95 group"
              >
                <span className="text-orange-200 group-hover:text-white transition">Yeni Tediye Fişi</span>
                <div className="w-8 h-8 rounded-xl bg-orange-500 text-slate-950 flex items-center justify-center font-black shadow-md">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </button>

              {/* YENİ TAHSİLAT FİŞİ BUTONU */}
              <button
                type="button"
                onClick={() => {
                  setFabOpen(false);
                  onNavigate('tahsilat');
                }}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/95 hover:bg-slate-850 text-white text-xs font-bold border border-teal-500/40 shadow-2xl transition hover:scale-105 active:scale-95 group"
              >
                <span className="text-teal-200 group-hover:text-white transition">Yeni Tahsilat Fişi</span>
                <div className="w-8 h-8 rounded-xl bg-teal-400 text-slate-950 flex items-center justify-center font-black shadow-md">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
              </button>
            </div>
          )}

          {/* ANA FAB TETİKLEYİCİ BUTON */}
          <button
            type="button"
            onClick={() => setFabOpen(!fabOpen)}
            className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-[0_10px_30px_rgba(45,212,191,0.4)] transition-all duration-300 active:scale-90 border ${
              fabOpen
                ? 'bg-rose-500 text-white rotate-45 border-rose-400'
                : 'bg-teal-400 text-slate-950 hover:bg-teal-300 border-teal-300 hover:scale-105'
            }`}
            aria-label="Hızlı İşlem Menüsü"
            title={fabOpen ? 'Kapat' : 'Hızlı İşlem Yap'}
          >
            <Plus className="w-7 h-7 stroke-[2.5]" />
          </button>
        </div>
      )}

    </div>
  );
};
