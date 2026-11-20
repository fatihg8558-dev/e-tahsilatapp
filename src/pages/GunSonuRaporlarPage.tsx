import React, { useEffect, useState } from 'react';
import { ClipboardCheck, TrendingUp } from 'lucide-react';
import { Islem } from '../types/database';
import { PlasiyerGunSonuPage } from './PlasiyerGunSonuPage';
import { PlasiyerPerformansPage } from './PlasiyerPerformansPage';

interface GunSonuRaporlarPageProps {
  initialSubTab?: 'gun_sonu' | 'performans';
  onOpenMakbuz: (islem: Islem) => void;
  onNavigate: (tab: string, state?: unknown) => void;
  refreshKey?: number;
  onTransferSuccess?: () => void;
}

export const GunSonuRaporlarPage: React.FC<GunSonuRaporlarPageProps> = ({
  initialSubTab = 'gun_sonu',
  onOpenMakbuz,
  onNavigate,
  refreshKey = 0,
  onTransferSuccess,
}) => {
  const [subTab, setSubTab] = useState<'gun_sonu' | 'performans'>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ÜST SEKMELER: GÜN SONU & PLASİYER RAPORLARI */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#111820] border border-white/[0.08] rounded-2xl p-2.5 shadow-lg">
        <div
          role="tablist"
          aria-label="Gün Sonu ve Raporlar Sekmeleri"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'gun_sonu'}
            data-testid="gun_sonu_raporlar_tab_gun_sonu"
            onClick={() => setSubTab('gun_sonu')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${
              subTab === 'gun_sonu'
                ? 'bg-amber-400 text-[#0a0e13] shadow'
                : 'text-gray-300 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Plasiyer Gün Sonu</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'performans'}
            data-testid="gun_sonu_raporlar_tab_performans"
            onClick={() => setSubTab('performans')}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition ${
              subTab === 'performans'
                ? 'bg-teal-400 text-[#0a0e13] shadow'
                : 'text-gray-300 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Plasiyer Raporları</span>
          </button>
        </div>

        <div className="text-[11px] text-gray-400 px-2 hidden md:block">
          {subTab === 'gun_sonu'
            ? 'Nakit sayım mutabakatı, merkez kasa devri ve Z-Raporu'
            : 'Plasiyer bazlı tahsilat, tediye ve ödeme türü analizleri'}
        </div>
      </div>

      {subTab === 'gun_sonu' ? (
        <PlasiyerGunSonuPage
          onOpenMakbuz={onOpenMakbuz}
          onNavigate={onNavigate}
          refreshKey={refreshKey}
          onTransferSuccess={onTransferSuccess}
        />
      ) : (
        <PlasiyerPerformansPage
          onOpenMakbuz={onOpenMakbuz}
          onNavigate={onNavigate}
          refreshKey={refreshKey}
        />
      )}
    </div>
  );
};
