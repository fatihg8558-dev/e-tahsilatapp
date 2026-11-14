import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Plus,
  Search,
  Download,
  Printer,
  Edit2,
  Trash2,
  Database,
  RefreshCw,
  Building2,
  CreditCard,
  Banknote,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { formatCurrency, formatDate } from '../lib/formatters';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import { GelirGider, GelirGiderTip, Kasa } from '../types/database';
import { isMissingKasaTableError, KASA_TUR_LABELS } from '../lib/kasaSql';
import {
  GelirGiderFormModal,
  KasaAccountModal,
  KasaSqlSetupModal,
  syncKasaBalanceAfterDelete,
} from '../components/kasa/KasaModals';

interface KasaGelirGiderPageProps {
  initialAction?: GelirGiderTip | null;
  onConsumeInitialAction?: () => void;
}

type KasaSubTab = 'defter' | 'kasalar';

export const KasaGelirGiderPage: React.FC<KasaGelirGiderPageProps> = ({
  initialAction = null,
  onConsumeInitialAction,
}) => {
  const { firma, profile } = useAuth();
  const [subTab, setSubTab] = useState<KasaSubTab>('defter');
  const [loading, setLoading] = useState(true);
  const [missingTables, setMissingTables] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [hareketler, setHareketler] = useState<GelirGider[]>([]);

  // Filtreler
  const now = new Date();
  const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultEnd = now.toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [tipFilter, setTipFilter] = useState<'all' | GelirGiderTip>('all');
  const [kasaFilter, setKasaFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modallar
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [formModalTip, setFormModalTip] = useState<GelirGiderTip>('gelir');
  const [editingHareket, setEditingHareket] = useState<GelirGider | null>(null);

  const [kasaModalOpen, setKasaModalOpen] = useState(false);
  const [editingKasa, setEditingKasa] = useState<Kasa | null>(null);

  const [sqlModalOpen, setSqlModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!firma?.id) return;
    try {
      setLoading(true);
      setError(null);

      // Kasalar
      const { data: kasaData, error: kasaErr } = await supabase
        .from('kasalar')
        .select('*')
        .eq('firma_id', firma.id)
        .order('created_at', { ascending: true });

      if (kasaErr) {
        if (isMissingKasaTableError(kasaErr)) {
          setMissingTables(true);
          setKasalar([]);
          setHareketler([]);
          return;
        }
        throw kasaErr;
      }

      setMissingTables(false);
      setKasalar((kasaData || []) as Kasa[]);

      // Gelir / Gider / Virman
      let ggQuery = supabase
        .from('gelir_giderler')
        .select('*, kasalar:kasa_id(ad, tur), hedef_kasalar:hedef_kasa_id(ad, tur), profiles:yapan_user_id(ad_soyad)')
        .eq('firma_id', firma.id)
        .gte('tarih', startDate)
        .lte('tarih', endDate)
        .order('tarih', { ascending: false })
        .order('created_at', { ascending: false });

      if (tipFilter !== 'all') {
        ggQuery = ggQuery.eq('tip', tipFilter);
      }
      if (kasaFilter !== 'all') {
        ggQuery = ggQuery.or(`kasa_id.eq.${kasaFilter},hedef_kasa_id.eq.${kasaFilter}`);
      }

      const { data: ggData, error: ggErr } = await ggQuery.limit(300);
      if (ggErr) {
        if (isMissingKasaTableError(ggErr)) {
          setMissingTables(true);
          setHareketler([]);
          return;
        }
        throw ggErr;
      }

      setHareketler((ggData || []) as GelirGider[]);
    } catch (err) {
      setError(handleSupabaseError(err, 'Kasa ve gelir-gider verileri yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, [firma?.id, startDate, endDate, tipFilter, kasaFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (initialAction && !missingTables && !loading) {
      setEditingHareket(null);
      setFormModalTip(initialAction);
      setFormModalOpen(true);
      onConsumeInitialAction?.();
    }
  }, [initialAction, missingTables, loading, onConsumeInitialAction]);

  const openNewHareket = (tip: GelirGiderTip) => {
    if (missingTables) {
      setSqlModalOpen(true);
      return;
    }
    setEditingHareket(null);
    setFormModalTip(tip);
    setFormModalOpen(true);
  };

  const handleDeleteHareket = async (item: GelirGider) => {
    if (!window.confirm(`${item.kategori} (${formatCurrency(item.tutar)}) kaydını silmek istediğinize emin misiniz? Kasa bakiyesi otomatik güncellenecektir.`)) {
      return;
    }
    try {
      await syncKasaBalanceAfterDelete(item);
      await loadData();
    } catch (err) {
      setError(handleSupabaseError(err, 'Kayıt silinemedi.'));
    }
  };

  const handleDeleteKasa = async (kasa: Kasa) => {
    if (!window.confirm(`"${kasa.ad}" hesabını silmek istediğinize emin misiniz? (İçinde hareket varsa silinemez)`)) {
      return;
    }
    try {
      const { error: delErr } = await supabase.from('kasalar').delete().eq('id', kasa.id);
      if (delErr) throw delErr;
      await loadData();
    } catch (err) {
      setError(handleSupabaseError(err, 'Kasa silinemedi. Önce bağlı gelir/gider kayıtlarını silmelisiniz.'));
    }
  };

  const filteredHareketler = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return hareketler;
    return hareketler.filter((h) =>
      `${h.kategori} ${h.aciklama || ''} ${h.belge_no || ''} ${h.kasalar?.ad || ''} ${h.hedef_kasalar?.ad || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [hareketler, searchQuery]);

  const totals = useMemo(() => {
    const nakitKasa = kasalar
      .filter((k) => k.aktif && k.tur === 'nakit')
      .reduce((acc, k) => acc + Number(k.guncel_bakiye || 0), 0);
    const bankaPos = kasalar
      .filter((k) => k.aktif && (k.tur === 'banka' || k.tur === 'pos'))
      .reduce((acc, k) => acc + Number(k.guncel_bakiye || 0), 0);
    const donemGelir = filteredHareketler
      .filter((h) => h.tip === 'gelir')
      .reduce((acc, h) => acc + Number(h.tutar || 0), 0);
    const donemGider = filteredHareketler
      .filter((h) => h.tip === 'gider')
      .reduce((acc, h) => acc + Number(h.tutar || 0), 0);

    return {
      nakitKasa,
      bankaPos,
      donemGelir,
      donemGider,
      netFark: donemGelir - donemGider,
    };
  }, [kasalar, filteredHareketler]);

  const handleExportExcel = () => {
    const headers = ['Tarih', 'Tip', 'Kategori', 'Kasa / Hesap', 'Hedef Kasa', 'Belge No', 'Açıklama', 'Tutar (₺)'];
    const rows = filteredHareketler.map((h) => [
      formatDate(h.tarih),
      h.tip.toUpperCase(),
      h.kategori,
      h.kasalar?.ad || '-',
      h.hedef_kasalar?.ad || '-',
      h.belge_no || '-',
      h.aciklama || '-',
      Number(h.tutar).toFixed(2),
    ]);
    exportToExcel(`kasa_gelir_gider_${startDate}_${endDate}`, headers, rows);
  };

  const handleExportPdf = () => {
    const headers = ['Tarih', 'Tip', 'Kategori', 'Kasa', 'Açıklama', 'Tutar'];
    const rows = filteredHareketler.map((h) => [
      formatDate(h.tarih),
      h.tip.toUpperCase(),
      h.kategori,
      h.tip === 'virman' ? `${h.kasalar?.ad || ''} → ${h.hedef_kasalar?.ad || ''}` : h.kasalar?.ad || '-',
      h.aciklama || h.belge_no || '-',
      formatCurrency(h.tutar),
    ]);
    printPdfReport(
      'Kasa & Gelir-Gider Raporu',
      `${firma?.unvan || 'Firma'} (${formatDate(startDate)} - ${formatDate(endDate)})`,
      headers,
      rows,
      [
        { label: 'Dönem Gelirleri', value: formatCurrency(totals.donemGelir) },
        { label: 'Dönem Giderleri', value: formatCurrency(totals.donemGider) },
        { label: 'Net Fark', value: formatCurrency(totals.netFark) },
        { label: 'Toplam Kasa + Banka', value: formatCurrency(totals.nakitKasa + totals.bankaPos) },
      ],
      firma?.logo_data
    );
  };

  return (
    <div className="space-y-6">
      {/* ÜST BAŞLIK & KASA AKSİYONLARI */}
      <div className="bg-[#111820] border border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-bold uppercase tracking-wider mb-1.5">
              <Wallet className="w-3 h-3" />
              <span>Gelir / Gider &amp; Kasa Modülü</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Kasa, Gelir &amp; Gider Yönetimi
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Şirket içi gelir, gider ve nakit/banka/POS hesap bakiyelerinizi tek ekrandan takip edin.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSqlModalOpen(true)}
            className="self-start sm:self-auto px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <Database className="w-3.5 h-3.5 text-amber-400" />
            <span>Veritabanı SQL</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => openNewHareket('gelir')}
            data-testid="kasa_add_gelir_btn"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 transition shadow-md"
          >
            <TrendingUp className="w-4 h-4" />
            <span>+ Gelir Ekle</span>
          </button>
          <button
            type="button"
            onClick={() => openNewHareket('gider')}
            data-testid="kasa_add_gider_btn"
            className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-extrabold text-xs flex items-center gap-1.5 transition shadow-md"
          >
            <TrendingDown className="w-4 h-4" />
            <span>- Gider / Masraf Ekle</span>
          </button>
          <button
            type="button"
            onClick={() => openNewHareket('virman')}
            data-testid="kasa_add_virman_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-bold text-xs flex items-center gap-1.5 transition"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Kasa Virman</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (missingTables) setSqlModalOpen(true);
              else {
                setEditingKasa(null);
                setKasaModalOpen(true);
              }
            }}
            data-testid="kasa_add_account_btn"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/15 font-bold text-xs flex items-center gap-1.5 transition"
          >
            <Plus className="w-4 h-4 text-teal-400" />
            <span>Yeni Kasa / Banka</span>
          </button>
        </div>
      </div>

      {/* TABLOLAR HENÜZ KURULMADIYSA YÖNLENDİRME */}
      {missingTables && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-extrabold text-sm text-amber-300">
                Supabase Kurulumu Gerekli (`kasalar` ve `gelir_giderler` tabloları henüz yok)
              </h3>
              <p className="text-xs text-gray-300 mt-1">
                Kasa bakiyeleri ve gelir/gider kayıtlarını bulutta saklamak için aşağıdaki SQL kurulumunu Supabase SQL Editor’de bir kez çalıştırın.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSqlModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs flex items-center gap-1.5"
            >
              <Database className="w-4 h-4" />
              <span>Kurulum SQL’ini Aç</span>
            </button>
            <button
              type="button"
              onClick={loadData}
              className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Yenile</span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* 4 ÖZET KPI KARTI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase">Nakit Kasalar</span>
            <Banknote className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-xl font-black text-white">{formatCurrency(totals.nakitKasa)}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            {kasalar.filter((k) => k.tur === 'nakit').length} nakit kasa toplamı
          </div>
        </div>

        <div className="bg-[#111820] border border-white/[0.07] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-gray-400 uppercase">Banka & POS</span>
            <Building2 className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-xl font-black text-white">{formatCurrency(totals.bankaPos)}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            {kasalar.filter((k) => k.tur !== 'nakit').length} banka/POS hesabı
          </div>
        </div>

        <div className="bg-[#111820] border border-emerald-500/20 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-emerald-300 uppercase">Dönem Gelirler</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-black text-emerald-400">{formatCurrency(totals.donemGelir)}</div>
          <div className="text-[11px] text-gray-400 mt-1">Seçili tarih aralığı kasa girişi</div>
        </div>

        <div className="bg-[#111820] border border-rose-500/20 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-rose-300 uppercase">Dönem Giderler</span>
            <TrendingDown className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-xl font-black text-rose-400">{formatCurrency(totals.donemGider)}</div>
          <div className="text-[11px] text-gray-400 mt-1">
            Net Fark:{' '}
            <span className={totals.netFark >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {formatCurrency(totals.netFark)}
            </span>
          </div>
        </div>
      </div>

      {/* ALT SEKMELER */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-3">
        <button
          type="button"
          onClick={() => setSubTab('defter')}
          data-testid="kasa_tab_defter"
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'defter'
              ? 'bg-teal-400 text-slate-950 shadow'
              : 'bg-[#111820] text-gray-300 border border-white/10 hover:text-white'
          }`}
        >
          Gelir & Gider Defteri ({filteredHareketler.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('kasalar')}
          data-testid="kasa_tab_kasalar"
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'kasalar'
              ? 'bg-teal-400 text-slate-950 shadow'
              : 'bg-[#111820] text-gray-300 border border-white/10 hover:text-white'
          }`}
        >
          Kasalar & Hesaplar ({kasalar.length})
        </button>
      </div>

      {/* SEKME 1: GELİR & GİDER DEFTERİ */}
      {subTab === 'defter' && (
        <div className="bg-[#111820] border border-white/[0.07] rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-white/[0.07] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
              <span className="text-gray-500 text-xs">—</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />

              <select
                value={tipFilter}
                onChange={(e) => setTipFilter(e.target.value as 'all' | GelirGiderTip)}
                className="bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              >
                <option value="all">Tüm Tipler</option>
                <option value="gelir">Sadece Gelir</option>
                <option value="gider">Sadece Gider</option>
                <option value="virman">Sadece Virman</option>
              </select>

              <select
                value={kasaFilter}
                onChange={(e) => setKasaFilter(e.target.value)}
                className="bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              >
                <option value="all">Tüm Kasalar</option>
                {kasalar.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.ad}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:w-52">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Kategori, açıklama ara..."
                  className="w-full bg-[#0b1017] border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-xs text-white"
                />
              </div>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={filteredHareketler.length === 0}
                className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredHareketler.length === 0}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/15 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-xs text-gray-400">Kayıtlar yükleniyor...</div>
          ) : filteredHareketler.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Wallet className="w-10 h-10 text-gray-600 mx-auto" />
              <p className="text-xs text-gray-400">
                Seçili tarih aralığında şirket içi gelir, gider veya virman kaydı bulunmuyor.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => openNewHareket('gelir')}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs"
                >
                  + Gelir Ekle
                </button>
                <button
                  type="button"
                  onClick={() => openNewHareket('gider')}
                  className="px-4 py-2 rounded-xl bg-rose-500 text-white font-bold text-xs"
                >
                  - Gider Ekle
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {filteredHareketler.map((item) => (
                <div
                  key={item.id}
                  className="p-4 hover:bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        item.tip === 'gelir'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : item.tip === 'gider'
                          ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                          : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                      }`}
                    >
                      {item.tip === 'gelir' ? (
                        <TrendingUp className="w-5 h-5" />
                      ) : item.tip === 'gider' ? (
                        <TrendingDown className="w-5 h-5" />
                      ) : (
                        <ArrowLeftRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white">{item.kategori}</span>
                        <span
                          className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                            item.tip === 'gelir'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : item.tip === 'gider'
                              ? 'bg-rose-500/15 text-rose-300'
                              : 'bg-sky-500/15 text-sky-300'
                          }`}
                        >
                          {item.tip}
                        </span>
                        {item.belge_no && (
                          <span className="text-[10px] font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded">
                            {item.belge_no}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 flex flex-wrap items-center gap-2">
                        <span>{formatDate(item.tarih)}</span>
                        <span>•</span>
                        <span className="text-teal-300 font-medium">
                          {item.tip === 'virman'
                            ? `${item.kasalar?.ad || '-'} → ${item.hedef_kasalar?.ad || '-'}`
                            : item.kasalar?.ad || '-'}
                        </span>
                        {item.aciklama && (
                          <>
                            <span>•</span>
                            <span className="text-gray-300 truncate max-w-xs">{item.aciklama}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    <span
                      className={`text-base font-black font-mono ${
                        item.tip === 'gelir'
                          ? 'text-emerald-400'
                          : item.tip === 'gider'
                          ? 'text-rose-400'
                          : 'text-sky-400'
                      }`}
                    >
                      {item.tip === 'gelir' ? '+' : item.tip === 'gider' ? '-' : ''}
                      {formatCurrency(item.tutar)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingHareket(item);
                          setFormModalTip(item.tip);
                          setFormModalOpen(true);
                        }}
                        title="Düzenle"
                        className="p-2 rounded-lg text-gray-400 hover:text-teal-400 hover:bg-white/5"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHareket(item)}
                        title="Sil"
                        className="p-2 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SEKME 2: KASALAR & HESAPLAR */}
      {subTab === 'kasalar' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kasalar.map((kasa) => (
            <div
              key={kasa.id}
              className="bg-[#111820] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center">
                      {kasa.tur === 'nakit' ? (
                        <Banknote className="w-5 h-5" />
                      ) : kasa.tur === 'banka' ? (
                        <Building2 className="w-5 h-5" />
                      ) : (
                        <CreditCard className="w-5 h-5" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-white">{kasa.ad}</h4>
                      <span className="text-[11px] text-gray-400">{KASA_TUR_LABELS[kasa.tur]}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKasa(kasa);
                        setKasaModalOpen(true);
                      }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-teal-400 hover:bg-white/5"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteKasa(kasa)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {kasa.banka_adi && (
                  <div className="text-xs text-gray-400 mt-3">Banka: {kasa.banka_adi}</div>
                )}
                {kasa.iban && (
                  <div className="text-[11px] font-mono text-gray-500 mt-0.5 truncate">{kasa.iban}</div>
                )}
              </div>

              <div className="pt-3 border-t border-white/[0.06] flex items-end justify-between">
                <div>
                  <div className="text-[10px] uppercase font-bold text-gray-400">Güncel Bakiye</div>
                  <div
                    className={`text-xl font-black font-mono ${
                      Number(kasa.guncel_bakiye) >= 0 ? 'text-teal-400' : 'text-rose-400'
                    }`}
                  >
                    {formatCurrency(kasa.guncel_bakiye)}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => openNewHareket('gelir')}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] font-bold"
                  >
                    + Gelir
                  </button>
                  <button
                    type="button"
                    onClick={() => openNewHareket('gider')}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-[11px] font-bold"
                  >
                    - Gider
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              if (missingTables) setSqlModalOpen(true);
              else {
                setEditingKasa(null);
                setKasaModalOpen(true);
              }
            }}
            className="min-h-[170px] rounded-2xl border-2 border-dashed border-slate-700 hover:border-teal-400/60 bg-black/20 hover:bg-teal-500/5 flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-teal-300 transition p-5"
          >
            <Plus className="w-8 h-8" />
            <span className="text-xs font-bold">Yeni Kasa / Banka / POS Ekle</span>
          </button>
        </div>
      )}

      {/* MODALLAR */}
      {firma?.id && (
        <>
          <GelirGiderFormModal
            isOpen={formModalOpen}
            initialTip={formModalTip}
            editingItem={editingHareket}
            kasalar={kasalar}
            firmaId={firma.id}
            userId={profile?.id}
            onClose={() => {
              setFormModalOpen(false);
              setEditingHareket(null);
            }}
            onSaved={loadData}
            onOpenNewKasa={() => {
              setEditingKasa(null);
              setKasaModalOpen(true);
            }}
          />

          <KasaAccountModal
            isOpen={kasaModalOpen}
            editingKasa={editingKasa}
            firmaId={firma.id}
            onClose={() => {
              setKasaModalOpen(false);
              setEditingKasa(null);
            }}
            onSaved={loadData}
          />
        </>
      )}

      <KasaSqlSetupModal isOpen={sqlModalOpen} onClose={() => setSqlModalOpen(false)} />
    </div>
  );
};
