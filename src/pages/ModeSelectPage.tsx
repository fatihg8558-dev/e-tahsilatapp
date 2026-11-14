import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  Bell,
  Building2,
  Crown,
  LogOut,
  ReceiptText,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SettingsModal } from '../components/settings/SettingsModal';

interface ModeSelectPageProps {
  onSelectMode: (mode: 'tahsilat' | 'kasa') => void;
  onOpenNotifications: () => void;
  onOpenSuperAdmin: () => void;
}

export const ModeSelectPage: React.FC<ModeSelectPageProps> = ({
  onSelectMode,
  onOpenNotifications,
  onOpenSuperAdmin,
}) => {
  const { user, profile, firma, isSuperAdmin, signOut } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleConfirmSignOut = () => {
    if (window.confirm('Güvenli çıkış yapmak istediğinize emin misiniz?')) {
      signOut();
    }
  };

  const roleLabel = {
    ana: 'Ana Hesap',
    plasiyer: 'Plasiyer',
    muhasebeci: 'Muhasebeci',
    superadmin: 'Süper Admin',
  }[profile?.rol || 'ana'];

  return (
    <div className="min-h-screen bg-[#0b1322] text-slate-100 flex flex-col fintech-glow">
      {/* ÜST BAR */}
      <header className="border-b border-slate-700/60 bg-[#111c2e]/95 backdrop-blur-md px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-teal-400 text-slate-950 font-black flex items-center justify-center text-lg shadow-[0_0_20px_rgba(45,212,191,0.4)] shrink-0">
            e
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline">
              <span className="font-extrabold text-lg text-white tracking-tight">Tahsilatım</span>
              <span className="text-teal-400 font-black text-2xl leading-none">.</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
              <Building2 className="w-3 h-3 text-teal-400 shrink-0" />
              <span className="truncate">{firma?.unvan || 'Firma Hesabı'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onOpenSuperAdmin}
              data-testid="mode_superadmin_btn"
              className="min-h-[44px] px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-xs font-extrabold flex items-center gap-1.5 transition"
            >
              <Crown className="w-4 h-4" />
              <span className="hidden sm:inline">Admin</span>
            </button>
          )}

          {(profile?.rol === 'ana' || isSuperAdmin) && (
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Ayarlar"
              className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 flex items-center justify-center transition"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenNotifications}
            aria-label="Bildirimler"
            className="w-11 h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 flex items-center justify-center transition"
          >
            <Bell className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={handleConfirmSignOut}
            data-testid="mode_logout_btn"
            className="min-h-[44px] px-3 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/35 text-xs font-bold flex items-center gap-1.5 transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </header>

      {/* MERKEZ: 2 MOD SEÇİMİ */}
      <main className="flex-1 flex flex-col items-center justify-center p-5 sm:p-8 max-w-4xl w-full mx-auto">
        <div className="text-center mb-8 sm:mb-10 space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/25 text-teal-300 text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{profile?.ad_soyad || user?.email} • {roleLabel}</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
            Çalışma Modülünü Seçin
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
            Karışıklık olmadan sadece seçtiğiniz bölümün ekranı açılır. İstediğiniz zaman üst menüden mod değiştirebilirsiniz.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full">
          {/* SEÇENEK 1: TAHSİLAT */}
          <button
            type="button"
            onClick={() => onSelectMode('tahsilat')}
            data-testid="mode_select_tahsilat"
            className="group text-left bg-[#111820] hover:bg-[#14202c] border-2 border-teal-500/30 hover:border-teal-400 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-200 hover:-translate-y-1 flex flex-col justify-between gap-6"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-14 h-14 rounded-2xl bg-teal-400/15 border border-teal-400/35 text-teal-400 flex items-center justify-center group-hover:scale-110 transition">
                  <ReceiptText className="w-7 h-7" />
                </div>
                <span className="px-3 py-1 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 text-[11px] font-extrabold uppercase tracking-wider">
                  Cari &amp; Makbuz
                </span>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white group-hover:text-teal-300 transition flex items-center gap-2">
                  <span>Tahsilat</span>
                  <ArrowDownLeft className="w-5 h-5 text-teal-400" />
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-2 leading-relaxed">
                  Müşteri ve tedarikçi carileri, tahsilat / tediye makbuzları, çek &amp; senet vadeleri, PDF paylaşımı ve plasiyer raporları.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-white/[0.07] flex items-center justify-between text-teal-400 font-extrabold text-sm">
              <span>Tahsilat Sayfasını Aç</span>
              <div className="w-9 h-9 rounded-xl bg-teal-400 text-slate-950 flex items-center justify-center group-hover:translate-x-1 transition">
                <ArrowRight className="w-5 h-5" />
              </div>
            </div>
          </button>

          {/* SEÇENEK 2: GELİR / GİDER */}
          <button
            type="button"
            onClick={() => onSelectMode('kasa')}
            data-testid="mode_select_kasa"
            className="group text-left bg-[#111820] hover:bg-[#14202c] border-2 border-emerald-500/30 hover:border-emerald-400 rounded-3xl p-6 sm:p-8 shadow-2xl transition-all duration-200 hover:-translate-y-1 flex flex-col justify-between gap-6"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-14 h-14 rounded-2xl bg-emerald-400/15 border border-emerald-400/35 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition">
                  <Wallet className="w-7 h-7" />
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-extrabold uppercase tracking-wider">
                  Kasa &amp; Masraf
                </span>
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white group-hover:text-emerald-300 transition">
                  Gelir / Gider
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-2 leading-relaxed">
                  Şirket içi gelir ve gider kayıtları, nakit kasa, banka ve POS hesap bakiyeleri, kasalar arası virman ve Excel/PDF dökümü.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-white/[0.07] flex items-center justify-between text-emerald-400 font-extrabold text-sm">
              <span>Gelir / Gider Sayfasını Aç</span>
              <div className="w-9 h-9 rounded-xl bg-emerald-400 text-slate-950 flex items-center justify-center group-hover:translate-x-1 transition">
                <ArrowRight className="w-5 h-5" />
              </div>
            </div>
          </button>
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab="plasiyer"
      />
    </div>
  );
};
