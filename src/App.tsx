import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { AuthScreen } from './components/auth/AuthScreen';
import { SubscriptionLockScreen } from './pages/SubscriptionLockScreen';
import { DashboardPage } from './pages/DashboardPage';
import { CarilerPage } from './pages/CarilerPage';
import { IslemFormPage } from './pages/IslemFormPage';
import { IslemlerPage } from './pages/IslemlerPage';
import { PlasiyerPerformansPage } from './pages/PlasiyerPerformansPage';
import { MakbuzModal } from './components/makbuz/MakbuzModal';
import { Islem } from './types/database';

export const App: React.FC = () => {
  const { user, loading, isPeriodExpired } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [activeMakbuz, setActiveMakbuz] = useState<Islem | null>(null);
  const [preSelectedCariId, setPreSelectedCariId] = useState<string | undefined>(undefined);
  const [openNewCari, setOpenNewCari] = useState<boolean>(false);

  // Oturum kontrolü yüklenirken
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e13] flex flex-col items-center justify-center text-teal-400">
        <div className="w-12 h-12 rounded-2xl bg-teal-400 text-[#0a0e13] font-black flex items-center justify-center text-2xl shadow-[0_0_30px_rgba(45,212,191,0.4)] animate-pulse mb-4">
          e
        </div>
        <div className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-gray-400 mt-3 font-medium">Tahsilatım yükleniyor...</span>
      </div>
    );
  }

  // Kullanıcı giriş yapmamışsa
  if (!user) {
    return <AuthScreen />;
  }

  // Deneme veya paket süresi dolmuşsa ve sinirsiz=false ise kilit ekranı
  if (isPeriodExpired) {
    return <SubscriptionLockScreen />;
  }

  const handleNavigate = (tab: string, state?: any) => {
    if (state?.cariId) {
      setPreSelectedCariId(state.cariId);
    } else {
      setPreSelectedCariId(undefined);
    }

    if (state?.openNew) {
      setOpenNewCari(true);
    } else {
      setOpenNewCari(false);
    }

    setCurrentTab(tab);
  };

  const handleIslemSuccess = (savedIslem: Islem) => {
    setActiveMakbuz(savedIslem);
    setCurrentTab('islemler');
  };

  return (
    <AppLayout currentTab={currentTab} onSelectTab={setCurrentTab}>
        {currentTab === 'dashboard' && (
          <DashboardPage
            onNavigate={handleNavigate}
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
          />
        )}

        {currentTab === 'cariler' && (
          <CarilerPage
            onNavigate={handleNavigate}
            openNewModalInitially={openNewCari}
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
          />
        )}

        {currentTab === 'tahsilat' && (
          <IslemFormPage
            initialTip="tahsilat"
            preSelectedCariId={preSelectedCariId}
            onSuccess={handleIslemSuccess}
            onCancel={() => setCurrentTab('dashboard')}
          />
        )}

        {currentTab === 'tediye' && (
          <IslemFormPage
            initialTip="tediye"
            preSelectedCariId={preSelectedCariId}
            onSuccess={handleIslemSuccess}
            onCancel={() => setCurrentTab('dashboard')}
          />
        )}

        {currentTab === 'islemler' && (
          <IslemlerPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onNavigate={handleNavigate}
          />
        )}

        {currentTab === 'performans' && (
          <PlasiyerPerformansPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onNavigate={handleNavigate}
          />
        )}

        {currentTab === 'paketler' && (
          <SubscriptionLockScreen />
        )}

        {/* MAKBUZ ÖNİZLEME MODALI */}
        {activeMakbuz && (
          <MakbuzModal
            islem={activeMakbuz}
            onClose={() => setActiveMakbuz(null)}
          />
        )}
      </AppLayout>
  );
};
