import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  LayoutDashboard,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
  CreditCard,
  LogOut,
  Bell,
  Menu,
  X,
  Building2,
  ShieldCheck,
  ChevronRight,
  Settings,
  UserCog,
  TrendingUp,
  Home,
  ArrowLeft,
  Crown,
} from 'lucide-react';
import { SettingsModal } from '../settings/SettingsModal';

interface AppLayoutProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  onOpenNotifications: () => void;
  notificationRefreshKey?: number;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onSelectTab,
  onOpenNotifications,
  notificationRefreshKey = 0,
  children,
}) => {
  const { user, profile, firma, isSuperAdmin, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingNotificationCount, setPendingNotificationCount] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'firma' | 'plasiyer'>('plasiyer');

  const handleConfirmSignOut = () => {
    if (window.confirm('Güvenli çıkış yapmak istediğinize emin misiniz?')) {
      setMobileMenuOpen(false);
      signOut();
    }
  };

  // Bekleyen bildirim sayısını dinle
  useEffect(() => {
    if (!firma?.id) return;

    const fetchPendingNotifications = async () => {
      const { count } = await supabase
        .from('bildirimler')
        .select('*', { count: 'exact', head: true })
        .eq('alici_firma_id', firma.id)
        .eq('durum', 'bekliyor');

      setPendingNotificationCount(count || 0);
    };

    fetchPendingNotifications();
    const interval = setInterval(fetchPendingNotifications, 30000);
    return () => clearInterval(interval);
  }, [firma?.id, notificationRefreshKey]);

  const roleLabel = {
    ana: 'Ana Hesap',
    plasiyer: 'Plasiyer',
    muhasebeci: 'Muhasebeci',
    superadmin: 'Süper Admin',
  }[profile?.rol || 'ana'];

  const breadcrumbs: Record<string, string> = {
    dashboard: 'Genel Bakış',
    cariler: 'Cari Hesaplar',
    tahsilat: 'Yeni Tahsilat Makbuzu',
    tediye: 'Yeni Tediye Makbuzu',
    islem_duzenle: 'Makbuz Güncelle',
    islemler: 'İşlem Listesi',
    performans: 'Plasiyer Performans Raporu',
    paketler: 'Abonelik & Paketler',
    superadmin: 'Süper Admin Paneli',
  };

  const isSubPage = currentTab !== 'dashboard';

  return (
    <div className="min-h-screen bg-[#0b1322] text-slate-100 flex flex-col lg:flex-row relative overflow-x-hidden fintech-glow">
      {/* MASAÜSTÜ SOL SABİT MENÜ (≥1024px, 240px) */}
      <aside className="hidden lg:flex flex-col w-60 bg-[#111c2e] border-r border-slate-700/60 min-h-screen fixed left-0 top-0 bottom-0 z-30 select-none shadow-xl">
        {/* LOGO */}
        <div className="p-5 flex items-center justify-between border-b border-slate-700/60">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => onSelectTab('dashboard')}>
            <div className="w-9 h-9 rounded-xl bg-teal-400 text-slate-950 font-black flex items-center justify-center text-lg shadow-[0_0_20px_rgba(45,212,191,0.4)]">
              e
            </div>
            <div className="flex items-baseline">
              <span className="font-extrabold text-lg text-white tracking-tight">Tahsilatım</span>
              <span className="text-teal-400 font-black text-2xl leading-none">.</span>
            </div>
          </div>
        </div>

        {/* ÇALIŞMA ALANI FİRMA KARTI */}
        <div className="p-3.5 mx-3 mt-3 rounded-xl bg-slate-800/60 border border-slate-700/70 flex items-center gap-2.5 shadow-sm">
          <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Çalışma Alanı</div>
            <div className="text-xs font-bold text-white truncate" title={firma?.unvan || 'Firma Yükleniyor'}>
              {firma?.unvan || 'Firma Hesabı'}
            </div>
          </div>
        </div>

        {/* MENÜ LİSTESİ */}
        <div className="flex-1 py-4 px-3 space-y-6 overflow-y-auto">
          {/* YÖNETİM */}
          <div>
            <div className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              YÖNETİM
            </div>
            <nav className="space-y-1">
              <button
                onClick={() => onSelectTab('dashboard')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  currentTab === 'dashboard'
                    ? 'bg-teal-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Genel Bakış</span>
              </button>

              <button
                onClick={() => onSelectTab('cariler')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  currentTab === 'cariler'
                    ? 'bg-teal-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Cariler</span>
              </button>

              {/* Plasiyer ve Muhasebeci form kısıtları */}
              {profile?.rol !== 'muhasebeci' && (
                <>
                  <button
                    onClick={() => onSelectTab('tahsilat')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                      currentTab === 'tahsilat'
                        ? 'bg-teal-400 text-[#0a0e13] font-semibold shadow-sm'
                        : 'text-teal-400/90 hover:text-teal-300 hover:bg-teal-500/10'
                    }`}
                  >
                    <ArrowDownLeft className="w-4 h-4 text-teal-400" />
                    <span>Tahsilat Yap</span>
                  </button>

                  <button
                    onClick={() => onSelectTab('tediye')}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                      currentTab === 'tediye'
                        ? 'bg-teal-400 text-[#0a0e13] font-semibold shadow-sm'
                        : 'text-orange-400/90 hover:text-orange-300 hover:bg-orange-500/10'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-orange-400" />
                    <span>Tediye Yap</span>
                  </button>
                </>
              )}

              <button
                onClick={() => onSelectTab('islemler')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  currentTab === 'islemler'
                    ? 'bg-teal-400 text-[#0a0e13] font-semibold shadow-sm'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <ReceiptText className="w-4 h-4" />
                <span>İşlemler</span>
              </button>

              <button
                onClick={() => onSelectTab('performans')}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  currentTab === 'performans'
                    ? 'bg-teal-400 text-[#0a0e13] font-semibold shadow-sm'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>{profile?.rol === 'plasiyer' ? 'Performans Raporum' : 'Plasiyer Raporları'}</span>
              </button>
            </nav>
          </div>

          {/* HESABIM */}
          <div>
            <div className="px-3 text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              HESABIM
            </div>
            <nav className="space-y-1">
              <button
                onClick={() => onSelectTab('paketler')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  currentTab === 'paketler'
                    ? 'bg-teal-400 text-[#0a0e13] font-semibold shadow-sm'
                    : 'text-gray-300 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="w-4 h-4" />
                  <span>Paket Satın Al</span>
                </div>
                {firma?.sinirsiz ? (
                  <span className="text-[10px] bg-teal-500/20 text-teal-300 px-1.5 py-0.5 rounded font-bold">
                    Sınırsız
                  </span>
                ) : (
                  <span className="text-[10px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded">
                    Abonelik
                  </span>
                )}
              </button>

              {/* Sadece Ana Hesap ve Süper Admin Görür */}
              {(profile?.rol === 'ana' || isSuperAdmin) && (
                <button
                  onClick={() => {
                    setSettingsInitialTab('plasiyer');
                    setIsSettingsOpen(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-white hover:bg-white/[0.05] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <UserCog className="w-4 h-4 text-teal-400" />
                    <span>Plasiyer & Ayarlar</span>
                  </div>
                  <span className="text-[10px] bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded border border-teal-500/20 font-bold">
                    Yönet
                  </span>
                </button>
              )}

              {/* Sadece Süper Admin (conqueror58@gmail.com) Görür */}
              {isSuperAdmin && (
                <button
                  onClick={() => onSelectTab('superadmin')}
                  data-testid="nav_superadmin_desktop"
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold transition-all border ${
                    currentTab === 'superadmin'
                      ? 'bg-amber-400 text-slate-950 border-amber-400 shadow-md'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Crown className="w-4 h-4 shrink-0" />
                    <span>Süper Admin</span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-extrabold ${
                      currentTab === 'superadmin'
                        ? 'bg-slate-950/20 text-slate-950'
                        : 'bg-amber-400/20 text-amber-300'
                    }`}
                  >
                    Yönetim
                  </span>
                </button>
              )}
            </nav>
          </div>
        </div>

        {/* ALTTINDA KULLANICI KARTI */}
        <div className="p-3 border-t border-white/[0.07] bg-black/20 space-y-2">
          <div className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-white/[0.04] transition">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-teal-500 to-emerald-400 text-[#0a0e13] font-bold flex items-center justify-center text-xs shrink-0">
              {profile?.ad_soyad?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">{profile?.ad_soyad || user?.email}</div>
              <div className="text-[10px] text-teal-400/90 flex items-center gap-1 font-medium">
                <ShieldCheck className="w-3 h-3" />
                {roleLabel}
              </div>
            </div>
            {(profile?.rol === 'ana' || isSuperAdmin) && (
              <button
                onClick={() => {
                  setSettingsInitialTab('plasiyer');
                  setIsSettingsOpen(true);
                }}
                title="Plasiyer & Firma Ayarları"
                className="p-1.5 text-gray-400 hover:text-teal-400 hover:bg-teal-500/10 rounded-lg transition"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleConfirmSignOut}
            data-testid="sidebar_logout_button"
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25 text-xs font-bold transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Güvenli Çıkış Yap</span>
          </button>
        </div>
      </aside>

      {/* MASAÜSTÜ İÇERİK ALANI (SOL MENÜNÜN YANINDA) */}
      <div className="lg:pl-60 flex-1 flex flex-col min-w-0">
        {/* ÜST ÇUBUK / HEADER */}
        <header className="min-h-14 lg:h-16 py-2 lg:py-0 border-b border-slate-700/60 bg-[#111c2e]/98 backdrop-blur-md sticky top-0 z-20 px-2.5 sm:px-4 lg:px-8 flex items-center justify-between gap-2 shadow-md">
          {/* SOL: Geri/Ana Sayfa Butonu, Menü & Başlık */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
            {/* Alt sayfalarda Geri Butonu, Ana sayfada Ana Sayfa kısayolu */}
            {isSubPage ? (
              <button
                type="button"
                onClick={() => onSelectTab('dashboard')}
                className="lg:hidden w-10 h-10 sm:min-w-[44px] sm:min-h-[44px] text-teal-300 hover:text-white bg-teal-500/15 active:bg-teal-500/25 rounded-xl flex items-center justify-center border border-teal-500/30 shadow-sm transition shrink-0"
                title="Geri / Ana Sayfa"
                aria-label="Geri Dön"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectTab('dashboard')}
                className="lg:hidden w-10 h-10 sm:min-w-[44px] sm:min-h-[44px] rounded-xl flex items-center justify-center border transition bg-teal-400 text-slate-950 font-bold border-teal-400 shadow-sm shrink-0"
                title="Ana Sayfaya Git"
                aria-label="Ana Sayfa"
              >
                <Home className="w-5 h-5" />
              </button>
            )}

            {/* Menü Butonu */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden w-10 h-10 sm:min-w-[44px] sm:min-h-[44px] text-slate-200 hover:text-white bg-slate-800/80 active:bg-slate-700 rounded-xl flex items-center justify-center border border-slate-700/50 shadow-sm transition shrink-0"
              aria-label="Menüyü Aç"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 text-teal-400" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Breadcrumb / Başlık */}
            <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-400 font-medium min-w-0">
              <span className="hidden sm:inline hover:text-slate-200 cursor-pointer shrink-0" onClick={() => onSelectTab('dashboard')}>
                Yönetim
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 hidden sm:inline shrink-0" />
              <span className="font-bold text-teal-400 bg-teal-500/10 px-2 sm:px-2.5 py-1 rounded-lg border border-teal-500/20 text-[11px] sm:text-sm truncate">
                {breadcrumbs[currentTab] || 'Sayfa'}
              </span>
            </div>
          </div>

          {/* SAĞ: Süper Admin, Ayarlar, Bildirim Zili, Güvenli Çıkış & Hızlı İşlem */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => onSelectTab('superadmin')}
                data-testid="header_superadmin_button"
                title="Süper Admin Paneli"
                aria-label="Süper Admin Paneli"
                className={`w-10 h-10 sm:w-auto sm:min-w-[44px] sm:min-h-[44px] sm:px-2.5 rounded-xl flex items-center justify-center gap-1.5 border shadow-sm transition text-xs font-extrabold ${
                  currentTab === 'superadmin'
                    ? 'bg-amber-400 text-slate-950 border-amber-400'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/40 hover:bg-amber-500/25'
                }`}
              >
                <Crown className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Admin Paneli</span>
              </button>
            )}

            {(profile?.rol === 'ana' || isSuperAdmin) && (
              <button
                type="button"
                onClick={() => {
                  setSettingsInitialTab('plasiyer');
                  setIsSettingsOpen(true);
                }}
                title="Plasiyer ve Firma Ayarları"
                className="hidden sm:flex min-w-[44px] min-h-[44px] p-2.5 text-slate-200 hover:text-teal-400 bg-slate-800/80 active:bg-slate-700 rounded-xl items-center justify-center border border-slate-700/50 shadow-sm transition"
                aria-label="Ayarlar"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={onOpenNotifications}
              data-testid="header_notifications_button"
              title="Bildirimler"
              className="relative w-10 h-10 sm:min-w-[44px] sm:min-h-[44px] text-slate-200 hover:text-white bg-slate-800/80 active:bg-slate-700 rounded-xl flex items-center justify-center border border-slate-700/50 shadow-sm transition"
              aria-label="Bildirimler"
            >
              <Bell className="w-5 h-5" />
              {pendingNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-400 text-slate-950 text-[10px] font-black flex items-center justify-center shadow-[0_0_8px_rgba(45,212,191,0.9)]">
                  {pendingNotificationCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleConfirmSignOut}
              data-testid="header_logout_button"
              title="Güvenli Çıkış Yap"
              aria-label="Güvenli Çıkış"
              className="w-10 h-10 md:w-auto sm:min-w-[44px] sm:min-h-[44px] md:px-2.5 text-red-300 hover:text-red-200 bg-red-500/15 hover:bg-red-500/25 active:bg-red-500/30 rounded-xl flex items-center justify-center gap-1.5 border border-red-500/35 shadow-sm transition text-xs font-bold"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="hidden md:inline">Güvenli Çıkış</span>
            </button>

            {profile?.rol !== 'muhasebeci' && (
              <div className="hidden sm:flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectTab('tahsilat')}
                  className="bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-xl transition shadow-[0_0_15px_rgba(45,212,191,0.25)] flex items-center gap-1.5"
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Tahsilat Yap</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTab('tediye')}
                  className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/40 font-bold text-xs px-3.5 py-2 rounded-xl transition flex items-center gap-1.5"
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Tediye Yap</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* MOBİL SLIDE-OVER MENÜ */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex">
            <div className="w-72 bg-[#111c2e] border-r border-slate-700 h-full p-4 flex flex-col justify-between shadow-2xl overflow-y-auto">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-700 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-teal-400 text-slate-950 font-black flex items-center justify-center text-lg">
                      e
                    </div>
                    <span className="font-extrabold text-lg text-white">Tahsilatım.</span>
                  </div>
                  <button onClick={() => setMobileMenuOpen(false)} className="p-2 text-slate-400 hover:text-white rounded-lg">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-1">
                  <button
                    onClick={() => {
                      onSelectTab('dashboard');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-200 hover:bg-white/5"
                  >
                    <LayoutDashboard className="w-4 h-4 text-teal-400" />
                    <span>Genel Bakış</span>
                  </button>
                  <button
                    onClick={() => {
                      onSelectTab('cariler');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-200 hover:bg-white/5"
                  >
                    <Users className="w-4 h-4 text-teal-400" />
                    <span>Cariler</span>
                  </button>
                  <button
                    onClick={() => {
                      onSelectTab('tahsilat');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-teal-400 hover:bg-teal-500/10"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>Tahsilat Yap</span>
                  </button>
                  <button
                    onClick={() => {
                      onSelectTab('tediye');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-orange-400 hover:bg-orange-500/10"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>Tediye Yap</span>
                  </button>
                  <button
                    onClick={() => {
                      onSelectTab('islemler');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-200 hover:bg-white/5"
                  >
                    <ReceiptText className="w-4 h-4 text-teal-400" />
                    <span>İşlemler</span>
                  </button>

                  <button
                    onClick={() => {
                      onSelectTab('performans');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-200 hover:bg-white/5"
                  >
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span>{profile?.rol === 'plasiyer' ? 'Performans Raporum' : 'Plasiyer Raporları'}</span>
                  </button>
                  <button
                    onClick={() => {
                      onSelectTab('paketler');
                      setMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-200 hover:bg-white/5"
                  >
                    <CreditCard className="w-4 h-4 text-teal-400" />
                    <span>Paket Satın Al</span>
                  </button>

                  {(profile?.rol === 'ana' || isSuperAdmin) && (
                    <button
                      onClick={() => {
                        setSettingsInitialTab('plasiyer');
                        setIsSettingsOpen(true);
                        setMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-teal-300 hover:bg-teal-500/10"
                    >
                      <UserCog className="w-4 h-4 text-teal-400" />
                      <span>Plasiyer & Ayarlar</span>
                    </button>
                  )}

                  {isSuperAdmin && (
                    <button
                      onClick={() => {
                        onSelectTab('superadmin');
                        setMobileMenuOpen(false);
                      }}
                      data-testid="nav_superadmin_mobile"
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold border mt-2 ${
                        currentTab === 'superadmin'
                          ? 'bg-amber-400 text-slate-950 border-amber-400'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Crown className="w-4 h-4" />
                        <span>Süper Admin Paneli</span>
                      </div>
                      <span className="text-[10px] uppercase font-extrabold">Yetki</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 pb-safe">
                <div className="text-xs text-gray-300 font-semibold mb-0.5 truncate">
                  {profile?.ad_soyad || user?.email}
                </div>
                <div className="text-[10px] text-teal-400 mb-3">{roleLabel}</div>
                <button
                  type="button"
                  onClick={handleConfirmSignOut}
                  data-testid="mobile_menu_logout_button"
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-bold transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Güvenli Çıkış Yap</span>
                </button>
              </div>
            </div>
            <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
          </div>
        )}

        {/* ANA İÇERİK ALANI (Altta menü için ferah boşluk bırakıldı) */}
        <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto pb-nav-safe lg:pb-8">
          {children}
        </main>

        {/* MOBİL ALT MENÜ (Navigasyon çubuğu üstünde kalması için pb-safe ve z-40 uygulandı) */}
        <nav className="mobile-bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#111c2e] border-t border-slate-700/80 px-2 pt-2.5 pb-safe shadow-[0_-8px_25px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-around">
            <button
              onClick={() => onSelectTab('dashboard')}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl text-[10px] font-semibold transition ${
                currentTab === 'dashboard' ? 'text-teal-400 font-bold bg-teal-400/15' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span>Ana Sayfa</span>
            </button>

            <button
              onClick={() => onSelectTab('cariler')}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl text-[10px] font-semibold transition ${
                currentTab === 'cariler' ? 'text-teal-400 font-bold bg-teal-400/15' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-5 h-5" />
              <span>Cariler</span>
            </button>

            <button
              onClick={() => onSelectTab('tahsilat')}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl text-[10px] font-semibold transition ${
                currentTab === 'tahsilat' ? 'text-teal-400 font-bold bg-teal-400/20' : 'text-teal-400/80 hover:text-teal-300'
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-teal-400/20 border border-teal-400/30 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4 text-teal-400" />
              </div>
              <span>Tahsilat</span>
            </button>

            <button
              onClick={() => onSelectTab('tediye')}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl text-[10px] font-semibold transition ${
                currentTab === 'tediye' ? 'text-orange-400 font-bold bg-orange-400/20' : 'text-orange-400/80 hover:text-orange-300'
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-orange-400/20 border border-orange-400/30 flex items-center justify-center">
                <ArrowUpRight className="w-4 h-4 text-orange-400" />
              </div>
              <span>Tediye</span>
            </button>

            <button
              onClick={() => onSelectTab('islemler')}
              className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl text-[10px] font-semibold transition ${
                currentTab === 'islemler' ? 'text-teal-400 font-bold bg-teal-400/15' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ReceiptText className="w-5 h-5" />
              <span>İşlemler</span>
            </button>
          </div>
        </nav>
      </div>

      {/* PROFİL, FİRMA & PLASİYER AYARLARI MODALİ */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
      />
    </div>
  );
};
