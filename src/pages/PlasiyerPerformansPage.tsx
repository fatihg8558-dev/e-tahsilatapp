import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { Islem, Profile } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import {
  TrendingUp,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  ReceiptText,
  Calendar,
  CreditCard,
  Banknote,
  FileCheck2,
  Users,
  Search,
  Filter,
  FileSpreadsheet,
  Printer,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Clock,
  ShieldCheck,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface PlasiyerPerformansPageProps {
  onOpenMakbuz: (islem: Islem) => void;
  onNavigate: (tab: string, state?: unknown) => void;
  refreshKey?: number;
}

type DateRangeFilter = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export const PlasiyerPerformansPage: React.FC<PlasiyerPerformansPageProps> = ({
  onOpenMakbuz,
  onNavigate,
  refreshKey = 0,
}) => {
  const { profile, firma } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allPlasiyerler, setAllPlasiyerler] = useState<Profile[]>([]);
  const [selectedPlasiyerId, setSelectedPlasiyerId] = useState<string>('');

  // Ham İşlemler
  const [islemler, setIslemler] = useState<Islem[]>([]);

  // Filtreler
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>('month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [tipFilter, setTipFilter] = useState<'all' | 'tahsilat' | 'tediye'>('all');
  const [turFilter, setTurFilter] = useState<'all' | 'nakit' | 'kredi_karti' | 'cek' | 'senet'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const isPlasiyer = profile?.rol === 'plasiyer';

  // 1. Plasiyer Listesini Yükle (Eğer ana hesap veya süperadmin ise diğer plasiyerleri seçebilsin)
  useEffect(() => {
    if (!firma?.id) return;

    if (isPlasiyer && profile?.id) {
      setSelectedPlasiyerId(profile.id);
    } else {
      // Ana hesap: Plasiyerleri listele
      supabase
        .from('profiles')
        .select('*')
        .eq('firma_id', firma.id)
        .eq('rol', 'plasiyer')
        .then(({ data }) => {
          if (data && data.length > 0) {
            setAllPlasiyerler(data as Profile[]);
            // Varsayılan ilk plasiyeri veya tümünü seç
            setSelectedPlasiyerId('all');
          } else {
            setSelectedPlasiyerId('all');
          }
        });
    }
  }, [firma?.id, isPlasiyer, profile?.id]);

  // 2. İşlemleri Veritabanından Çek
  useEffect(() => {
    if (!firma?.id) return;

    const fetchPerformansIslemleri = async () => {
      try {
        setLoading(true);
        setError(null);

        let query = supabase
          .from('islemler')
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad, email, rol)')
          .eq('firma_id', firma.id)
          .order('tarih', { ascending: false });

        // Plasiyer ise ZORUNLU olarak sadece kendi kestiği işlemleri çeker
        if (isPlasiyer && profile?.id) {
          query = query.eq('yapan_user_id', profile.id);
        } else if (selectedPlasiyerId && selectedPlasiyerId !== 'all') {
          query = query.eq('yapan_user_id', selectedPlasiyerId);
        }

        const { data, error: fetchErr } = await query;
        if (fetchErr) throw fetchErr;

        setIslemler((data as Islem[]) || []);
      } catch (err: unknown) {
        setError(handleSupabaseError(err, 'Performans verileri yüklenirken bir hata oluştu.'));
      } finally {
        setLoading(false);
      }
    };

    fetchPerformansIslemleri();
  }, [firma?.id, isPlasiyer, profile?.id, selectedPlasiyerId, refreshKey]);

  // 3. Tarih Aralığı ve Ek Filtreleri Uygula
  const filteredIslemler = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Tarih başlangıç ve bitiş sınırlarını hesapla
    let startLimit: Date | null = null;
    let endLimit: Date | null = null;

    if (dateFilter === 'today') {
      startLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      endLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (dateFilter === 'week') {
      const dayOfWeek = now.getDay() || 7; // 1 = Pazartesi, 7 = Pazar
      startLimit = new Date(now);
      startLimit.setDate(now.getDate() - dayOfWeek + 1);
      startLimit.setHours(0, 0, 0, 0);
      endLimit = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (dateFilter === 'month') {
      startLimit = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      endLimit = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (dateFilter === 'year') {
      startLimit = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
      endLimit = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    } else if (dateFilter === 'custom') {
      if (customStartDate) {
        startLimit = new Date(customStartDate);
        startLimit.setHours(0, 0, 0, 0);
      }
      if (customEndDate) {
        endLimit = new Date(customEndDate);
        endLimit.setHours(23, 59, 59, 999);
      }
    }

    return islemler.filter((islem) => {
      // Tip Filtresi
      if (tipFilter !== 'all' && islem.tip !== tipFilter) return false;

      // Tür Filtresi
      if (turFilter !== 'all' && islem.tur !== turFilter) return false;

      // Tarih Filtresi
      if (islem.tarih) {
        const itemDate = new Date(islem.tarih);
        if (startLimit && itemDate < startLimit) return false;
        if (endLimit && itemDate > endLimit) return false;
      }

      // Arama Filtresi
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const unvan = islem.cariler?.unvan?.toLowerCase() || '';
        const makbuzNo = islem.makbuz_no?.toLowerCase() || '';
        const aciklama = islem.aciklama?.toLowerCase() || '';
        if (!unvan.includes(q) && !makbuzNo.includes(q) && !aciklama.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [islemler, dateFilter, customStartDate, customEndDate, tipFilter, turFilter, searchQuery]);

  // 4. İstatistik Hesaplamaları (Toplam Tahsilat, Tediye, Net Kasa vb.)
  const stats = useMemo(() => {
    let toplamTahsilat = 0;
    let toplamTediye = 0;
    let iptalSayisi = 0;
    let iptalTutar = 0;

    let nakitTahsilat = 0;
    let krediKartiTahsilat = 0;
    let cekTahsilat = 0;
    let senetTahsilat = 0;

    let nakitAdet = 0;
    let kartAdet = 0;
    let cekAdet = 0;
    let senetAdet = 0;

    const cariTotals: Record<string, { unvan: string; tutar: number; adet: number }> = {};

    filteredIslemler.forEach((i) => {
      const tutar = Number(i.tutar) || 0;

      if (i.iptal) {
        iptalSayisi++;
        iptalTutar += tutar;
        return;
      }

      if (i.tip === 'tahsilat') {
        toplamTahsilat += tutar;

        if (i.tur === 'nakit') {
          nakitTahsilat += tutar;
          nakitAdet++;
        } else if (i.tur === 'kredi_karti') {
          krediKartiTahsilat += tutar;
          kartAdet++;
        } else if (i.tur === 'cek') {
          cekTahsilat += tutar;
          cekAdet++;
        } else if (i.tur === 'senet') {
          senetTahsilat += tutar;
          senetAdet++;
        }
      } else if (i.tip === 'tediye') {
        toplamTediye += tutar;
      }

      // Cari Bazlı Toplam
      const cid = i.cari_id;
      const unvan = i.cariler?.unvan || 'Cari Belirtilmemiş';
      if (!cariTotals[cid]) {
        cariTotals[cid] = { unvan, tutar: 0, adet: 0 };
      }
      cariTotals[cid].tutar += tutar;
      cariTotals[cid].adet++;
    });

    const netKasa = toplamTahsilat - toplamTediye;
    const gecerliIslemSayisi = filteredIslemler.filter((i) => !i.iptal).length;

    // En çok işlem yapılan ilk 5 cari
    const topCariler = Object.values(cariTotals)
      .sort((a, b) => b.tutar - a.tutar)
      .slice(0, 5);

    return {
      toplamTahsilat,
      toplamTediye,
      netKasa,
      gecerliIslemSayisi,
      iptalSayisi,
      iptalTutar,
      nakitTahsilat,
      krediKartiTahsilat,
      cekTahsilat,
      senetTahsilat,
      nakitAdet,
      kartAdet,
      cekAdet,
      senetAdet,
      topCariler,
    };
  }, [filteredIslemler]);

  // Aktif Plasiyer Adı
  const activePlasiyerName = useMemo(() => {
    if (isPlasiyer) {
      return profile?.ad_soyad || 'Plasiyer';
    }
    if (selectedPlasiyerId === 'all') {
      return 'Tüm Firma Plasiyerleri';
    }
    const found = allPlasiyerler.find((p) => p.id === selectedPlasiyerId);
    return found ? found.ad_soyad : 'Seçili Plasiyer';
  }, [isPlasiyer, profile?.ad_soyad, selectedPlasiyerId, allPlasiyerler]);

  // 5. Excel ve PDF Dışa Aktarma
  const handleExportExcel = () => {
    const headers = [
      'Tarih',
      'Makbuz No',
      'Cari Unvanı',
      'İşlem Tipi',
      'Ödeme Türü',
      'Plasiyer',
      'Açıklama',
      'Durum',
      'Tutar (TL)',
    ];

    const rows = filteredIslemler.map((i) => [
      formatDate(i.tarih),
      i.makbuz_no || `#${i.id.slice(0, 8)}`,
      i.cariler?.unvan || '-',
      i.tip.toUpperCase(),
      i.tur.toUpperCase(),
      i.profiles?.ad_soyad || activePlasiyerName,
      i.aciklama || '-',
      i.iptal ? 'İPTAL' : i.durum.toUpperCase(),
      Number(i.tutar) || 0,
    ]);

    const dateStr = new Date().toISOString().split('T')[0];
    const cleanPlasiyer = activePlasiyerName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    exportToExcel(`plasiyer_performans_${cleanPlasiyer}_${dateStr}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Tarih', 'Makbuz No', 'Cari Unvanı', 'Ödeme Türü', 'Tip', 'Durum', 'Tutar'];

    const rows = filteredIslemler.map((i) => [
      formatDate(i.tarih),
      i.makbuz_no || `#${i.id.slice(0, 8)}`,
      i.cariler?.unvan || '-',
      i.tur.toUpperCase(),
      i.tip.toUpperCase(),
      i.iptal ? 'İPTAL' : i.durum.toUpperCase(),
      formatCurrency(i.tutar),
    ]);

    const summary = [
      { label: 'Plasiyer', value: activePlasiyerName },
      { label: 'Toplam Tahsilat', value: formatCurrency(stats.toplamTahsilat) },
      { label: 'Toplam Tediye', value: formatCurrency(stats.toplamTediye) },
      { label: 'Net Bakiye', value: formatCurrency(stats.netKasa) },
      { label: 'İşlem Adedi', value: `${stats.gecerliIslemSayisi} Kayıt` },
    ];

    printPdfReport(
      `PLASİYER PERFORMANS RAPORU - ${activePlasiyerName.toUpperCase()}`,
      `Firma: ${firma?.unvan || '-'} | Dönem: ${dateFilter.toUpperCase()} | Rapor Alma Tarihi: ${new Date().toLocaleDateString('tr-TR')}`,
      headers,
      rows,
      summary
    );
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* BAŞLIK & KARŞILAMA ALANI */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold uppercase tracking-wider mb-2">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Saha Performansı</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5 flex-wrap">
            <span>{isPlasiyer ? 'Performans Raporum' : 'Plasiyer Performans Raporu'}</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-teal-500/15 text-teal-300 border border-teal-500/30 font-mono">
              {activePlasiyerName}
            </span>
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            {isPlasiyer
              ? 'Yalnızca şahsınız tarafından kesilen tahsilat ve tediye makbuzlarının anlık özeti'
              : 'Firma bünyesinde çalışan plasiyerlerin tahsilat başarıları, kestiği makbuzlar ve bakiye raporu'}
          </p>
        </div>

        {/* SAĞ ÜST AKSİYONLAR & HIZLI MAKBUZ DÜZENLEME */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* DIŞA AKTAR BUTONLARI */}
          <button
            onClick={handleExportExcel}
            className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-bold text-xs px-3.5 py-2.5 rounded-xl transition flex items-center gap-1.5"
            title="Excel (CSV) Olarak İndir"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Excel</span>
          </button>

          <button
            onClick={handleExportPdf}
            className="bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30 font-bold text-xs px-3.5 py-2.5 rounded-xl transition flex items-center gap-1.5"
            title="A4 PDF Raporu Yazdır"
          >
            <Printer className="w-4 h-4 text-teal-400" />
            <span className="hidden sm:inline">PDF Yazdır</span>
          </button>

          <button
            onClick={() => onNavigate('tahsilat')}
            className="bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs px-3.5 py-2.5 rounded-xl transition shadow-[0_0_15px_rgba(45,212,191,0.25)] flex items-center gap-1.5"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>Yeni Tahsilat</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* FİLTRE VE DÖNEM SEÇİCİ PANEL */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Hızlı Dönem Butonları */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-gray-400 mr-1 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-teal-400" />
              <span>Dönem:</span>
            </span>

            {[
              { id: 'today', label: 'Bugün' },
              { id: 'week', label: 'Bu Hafta' },
              { id: 'month', label: 'Bu Ay' },
              { id: 'year', label: 'Bu Yıl' },
              { id: 'all', label: 'Tüm Zamanlar' },
              { id: 'custom', label: 'Özel Aralık' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDateFilter(tab.id as DateRangeFilter)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  dateFilter === tab.id
                    ? 'bg-teal-400 text-[#0a0e13] shadow-sm'
                    : 'bg-black/30 text-gray-400 hover:text-white border border-white/5 hover:border-white/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Ana Hesap ise: Plasiyer Seçici */}
          {!isPlasiyer && allPlasiyerler.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-teal-400" />
                <span>Plasiyer:</span>
              </span>
              <select
                value={selectedPlasiyerId}
                onChange={(e) => setSelectedPlasiyerId(e.target.value)}
                className="bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400 font-medium"
              >
                <option value="all">Tüm Plasiyerler</option>
                {allPlasiyerler.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ad_soyad} ({p.email})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Özel Tarih Seçici (Eğer "Özel Aralık" seçiliyse) */}
        {dateFilter === 'custom' && (
          <div className="pt-3 border-t border-white/[0.05] flex items-center gap-3 flex-wrap text-xs">
            <span className="text-gray-400 font-medium">Tarih Aralığı:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="bg-[#0a0e13] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-teal-400"
            />
            <span className="text-gray-500">-</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="bg-[#0a0e13] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-teal-400"
            />
          </div>
        )}

        {/* Alt Filtreleme: Arama, Tip, Tür */}
        <div className="pt-3 border-t border-white/[0.05] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* Arama Inputu */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari veya makbuz no ara..."
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
            />
          </div>

          {/* Tip (Tahsilat / Tediye) */}
          <div>
            <select
              value={tipFilter}
              onChange={(e) => setTipFilter(e.target.value as any)}
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
            >
              <option value="all">Tüm Tipler (Tahsilat & Tediye)</option>
              <option value="tahsilat">Sadece Tahsilatlar</option>
              <option value="tediye">Sadece Tediyeler</option>
            </select>
          </div>

          {/* Ödeme Türü (Nakit, Kart, Çek, Senet) */}
          <div>
            <select
              value={turFilter}
              onChange={(e) => setTurFilter(e.target.value as any)}
              className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
            >
              <option value="all">Tüm Ödeme Türleri</option>
              <option value="nakit">Nakit</option>
              <option value="kredi_karti">Kredi Kartı</option>
              <option value="cek">Çek</option>
              <option value="senet">Senet</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4 TEMEL PERFORMANS ÖZET KARTI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* TOPLAM TAHSİLAT */}
        <div className="bg-[#111820] border border-teal-500/20 rounded-2xl p-5 hover:border-teal-400/40 transition duration-300 group shadow-[0_0_25px_rgba(45,212,191,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-teal-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              Toplam Tahsilat
            </span>
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {loading ? '...' : formatCurrency(stats.toplamTahsilat)}
          </div>
          <div className="text-[11px] text-teal-400/80 font-medium mt-1">
            Seçili dönemde müşterilerden toplanan
          </div>
        </div>

        {/* TOPLAM TEDİYE */}
        <div className="bg-[#111820] border border-orange-500/20 rounded-2xl p-5 hover:border-orange-500/40 transition duration-300 group shadow-[0_0_25px_rgba(249,115,22,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-orange-300 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
              Toplam Tediye
            </span>
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/30 text-orange-400 flex items-center justify-center group-hover:scale-110 transition">
              <ArrowUpRight className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {loading ? '...' : formatCurrency(stats.toplamTediye)}
          </div>
          <div className="text-[11px] text-orange-400/80 font-medium mt-1">
            Seçili dönemde yapılan ödemeler
          </div>
        </div>

        {/* NET KASA / BAKİYE */}
        <div className="bg-[#111820] border border-blue-500/20 rounded-2xl p-5 hover:border-blue-400/40 transition duration-300 group shadow-[0_0_25px_rgba(59,130,246,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
              Net Kasa Farkı
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center group-hover:scale-110 transition">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div
            className={`text-2xl sm:text-3xl font-black tracking-tight ${
              stats.netKasa >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {loading ? '...' : formatCurrency(stats.netKasa)}
          </div>
          <div className="text-[11px] text-gray-400 font-medium mt-1">
            Tahsilat - Tediye net farkı
          </div>
        </div>

        {/* İŞLEM ADEDİ */}
        <div className="bg-[#111820] border border-purple-500/20 rounded-2xl p-5 hover:border-purple-400/40 transition duration-300 group shadow-[0_0_25px_rgba(168,85,247,0.06)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
              Makbuz Hacmi
            </span>
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 flex items-center justify-center group-hover:scale-110 transition">
              <ReceiptText className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {loading ? '...' : `${stats.gecerliIslemSayisi} Adet`}
          </div>
          <div className="text-[11px] text-gray-400 font-medium mt-1 flex items-center gap-1.5">
            {stats.iptalSayisi > 0 && (
              <span className="text-red-400 font-semibold">({stats.iptalSayisi} İptal)</span>
            )}
            <span>Başarılı makbuz kaydı</span>
          </div>
        </div>
      </div>

      {/* ÖDEME TÜRLERİ DAĞILIMI & EN ÇOK İŞLEM YAPILAN CARİLER */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ÖDEME TÜRLERİ KIRILIMI (2 SÜTUN) */}
        <div className="lg:col-span-2 bg-[#111820] border border-white/[0.08] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <Banknote className="w-4 h-4 text-teal-400" />
              <span>Tahsilat Ödeme Türü Dağılımı</span>
            </h3>
            <span className="text-[11px] text-gray-500">
              Net Tahsilat: {formatCurrency(stats.toplamTahsilat)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* NAKİT */}
            <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.05] hover:border-emerald-500/30 transition space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5" />
                  <span>Nakit</span>
                </span>
                <span className="text-[11px] font-mono text-gray-400">
                  {stats.nakitAdet} İşlem
                </span>
              </div>
              <div className="text-lg font-black text-white font-mono">
                {formatCurrency(stats.nakitTahsilat)}
              </div>
              {/* Progress bar */}
              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-400 h-1.5 rounded-full"
                  style={{
                    width: `${stats.toplamTahsilat > 0 ? (stats.nakitTahsilat / stats.toplamTahsilat) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* KREDİ KARTI */}
            <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.05] hover:border-blue-500/30 transition space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Kredi Kartı</span>
                </span>
                <span className="text-[11px] font-mono text-gray-400">
                  {stats.kartAdet} İşlem
                </span>
              </div>
              <div className="text-lg font-black text-white font-mono">
                {formatCurrency(stats.krediKartiTahsilat)}
              </div>
              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-400 h-1.5 rounded-full"
                  style={{
                    width: `${stats.toplamTahsilat > 0 ? (stats.krediKartiTahsilat / stats.toplamTahsilat) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* ÇEK */}
            <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.05] hover:border-amber-500/30 transition space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Müşteri Çeki</span>
                </span>
                <span className="text-[11px] font-mono text-gray-400">
                  {stats.cekAdet} İşlem
                </span>
              </div>
              <div className="text-lg font-black text-white font-mono">
                {formatCurrency(stats.cekTahsilat)}
              </div>
              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-amber-400 h-1.5 rounded-full"
                  style={{
                    width: `${stats.toplamTahsilat > 0 ? (stats.cekTahsilat / stats.toplamTahsilat) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* SENET */}
            <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.05] hover:border-purple-500/30 transition space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-400 flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Müşteri Senedi</span>
                </span>
                <span className="text-[11px] font-mono text-gray-400">
                  {stats.senetAdet} İşlem
                </span>
              </div>
              <div className="text-lg font-black text-white font-mono">
                {formatCurrency(stats.senetTahsilat)}
              </div>
              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-purple-400 h-1.5 rounded-full"
                  style={{
                    width: `${stats.toplamTahsilat > 0 ? (stats.senetTahsilat / stats.toplamTahsilat) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* EN ÇOK İŞLEM YAPILAN MÜŞTERİLER (1 SÜTUN) */}
        <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-400" />
              <span>En Çok Çalışılan Cariler</span>
            </h3>
            <span className="text-[11px] text-gray-500">İlk 5</span>
          </div>

          {stats.topCariler.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-500">
              Seçilen dönemde müşteri hareketi bulunmuyor.
            </div>
          ) : (
            <div className="space-y-2.5">
              {stats.topCariler.map((c, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-black/30 border border-white/[0.04] flex items-center justify-between gap-2 hover:border-teal-400/30 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-white truncate">{c.unvan}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{c.adet} Makbuz</div>
                  </div>
                  <div className="font-mono font-bold text-xs text-teal-400 whitespace-nowrap">
                    {formatCurrency(c.tutar)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* GERÇEKLEŞTİRİLEN İŞLEMLER TABLOSU */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
        <div className="p-5 border-b border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ReceiptText className="w-4 h-4 text-teal-400" />
            <h3 className="font-bold text-sm text-white">
              Performans İşlem Listesi ({filteredIslemler.length} Kayıt)
            </h3>
          </div>
          <span className="text-[11px] text-gray-400">
            Makbuz detayını incelemek için satıra dokunun
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-gray-400">İşlemler listeleniyor...</div>
        ) : filteredIslemler.length === 0 ? (
          <div className="p-12 text-center">
            <ReceiptText className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Belirtilen kriterlerde işlem kaydı bulunamadı.</p>
          </div>
        ) : (
          <div>
            {/* MASAÜSTÜ TABLO */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-black/20 text-gray-400 text-[11px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-5">Tarih</th>
                    <th className="py-3 px-4">Makbuz No</th>
                    <th className="py-3 px-4">Cari Unvanı</th>
                    <th className="py-3 px-4">Tip</th>
                    <th className="py-3 px-4">Ödeme Türü</th>
                    <th className="py-3 px-4">Durum</th>
                    <th className="py-3 px-5 text-right">Tutar (₺)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredIslemler.map((islem) => (
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
                      <td className="py-3.5 px-4 text-gray-300 capitalize">
                        {islem.tur.replace('_', ' ')}
                      </td>
                      <td className="py-3.5 px-4">
                        {islem.iptal ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                            İptal
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              islem.durum === 'plasiyerde'
                                ? 'bg-amber-500/10 text-amber-400'
                                : islem.durum === 'aktarildi'
                                ? 'bg-blue-500/10 text-blue-400'
                                : 'bg-emerald-500/10 text-emerald-400'
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

            {/* MOBİL KART GÖRÜNÜMÜ */}
            <div className="md:hidden divide-y divide-white/[0.04]">
              {filteredIslemler.map((islem) => (
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
    </div>
  );
};
