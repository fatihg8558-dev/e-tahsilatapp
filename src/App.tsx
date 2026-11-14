import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { AuthScreen } from './components/auth/AuthScreen';
import { SubscriptionLockScreen } from './pages/SubscriptionLockScreen';
import { DashboardPage } from './pages/DashboardPage';
import { CarilerPage } from './pages/CarilerPage';
import { IslemFormPage } from './pages/IslemFormPage';
import { IslemlerPage } from './pages/IslemlerPage';
import { PlasiyerPerformansPage } from './pages/PlasiyerPerformansPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { KasaGelirGiderPage } from './pages/KasaGelirGiderPage';
import { YedeklemePage } from './pages/YedeklemePage';
import { MakbuzModal } from './components/makbuz/MakbuzModal';
import { NotificationsModal } from './components/notifications/NotificationsModal';
import { Islem } from './types/database';

export const App: React.FC = () => {
  const { user, loading, isPeriodExpired } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.__ANDROID_PENDING_TAB__) {
      const initial = window.__ANDROID_PENDING_TAB__.trim();
      delete window.__ANDROID_PENDING_TAB__;
      if (initial) return initial;
    }
    return 'dashboard';
  });
  const [activeMakbuz, setActiveMakbuz] = useState<Islem | null>(null);
  const [editingIslem, setEditingIslem] = useState<Islem | null>(null);
  const [editReturnTab, setEditReturnTab] = useState<string>('islemler');
  const [preSelectedCariId, setPreSelectedCariId] = useState<string | undefined>(undefined);
  const [openNewCari, setOpenNewCari] = useState<boolean>(false);
  const [kasaModal, setKasaModal] = useState<'gelir' | 'gider' | undefined>(undefined);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState<number>(0);
  const [receiptRefreshKey, setReceiptRefreshKey] = useState<number>(0);

  // Klavye açıldığında odaklanılan input'u otomatik olarak klavyenin üzerine kaydır
  useEffect(() => {
    const isTextInput = (el: Element | null): el is HTMLElement => {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.classList.contains('sr-only')) return false;
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (tag === 'INPUT') {
        const type = (el as HTMLInputElement).type;
        return !['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(type);
      }
      return el.isContentEditable;
    };

    const scrollTargetIntoView = (el: HTMLElement) => {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch {
        el.scrollIntoView(true);
      }
    };

    let blurTimer: number | undefined;
    let scrollTimers: number[] = [];

    const clearScrollTimers = () => {
      scrollTimers.forEach((t) => window.clearTimeout(t));
      scrollTimers = [];
    };

    const scheduleScrollForActive = () => {
      clearScrollTimers();
      const active = document.activeElement;
      if (!isTextInput(active)) return;
      scrollTimers.push(window.setTimeout(() => scrollTargetIntoView(active), 60));
      scrollTimers.push(window.setTimeout(() => scrollTargetIntoView(active), 180));
      scrollTimers.push(window.setTimeout(() => scrollTargetIntoView(active), 380));
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (blurTimer) {
        window.clearTimeout(blurTimer);
        blurTimer = undefined;
      }
      const target = e.target as Element | null;
      if (isTextInput(target)) {
        document.body.classList.add('keyboard-open');
        scheduleScrollForActive();
      }
    };

    const handleFocusOut = () => {
      if (blurTimer) window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (!isTextInput(document.activeElement)) {
          document.body.classList.remove('keyboard-open');
        }
      }, 160);
    };

    const handleAndroidKeyboard = (e: Event) => {
      const detail = (e as CustomEvent<{ open?: boolean; height?: number }>).detail;
      if (detail?.open) {
        document.body.classList.add('keyboard-open');
        scheduleScrollForActive();
      } else if (detail && detail.open === false) {
        if (!isTextInput(document.activeElement)) {
          document.body.classList.remove('keyboard-open');
        }
      }
    };

    const handleViewportResize = () => {
      if (isTextInput(document.activeElement)) {
        scheduleScrollForActive();
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    window.addEventListener('androidKeyboardChange', handleAndroidKeyboard);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

    return () => {
      clearScrollTimers();
      if (blurTimer) window.clearTimeout(blurTimer);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('androidKeyboardChange', handleAndroidKeyboard);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      document.body.classList.remove('keyboard-open');
    };
  }, []);

  // Android widget ve bildiriminden belirli sekmeye doğrudan yönlendirme desteği
  useEffect(() => {
    const consumePendingTab = () => {
      if (typeof window !== 'undefined' && window.__ANDROID_PENDING_TAB__) {
        const pending = window.__ANDROID_PENDING_TAB__.trim();
        delete window.__ANDROID_PENDING_TAB__;
        if (pending) {
          setEditingIslem(null);
          setCurrentTab(pending);
        }
      }
    };
    consumePendingTab();

    const handleAndroidOpenTab = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail;
      if (typeof tab === 'string' && tab.trim()) {
        if (typeof window !== 'undefined') {
          delete window.__ANDROID_PENDING_TAB__;
        }
        setEditingIslem(null);
        setCurrentTab(tab.trim());
      }
    };
    window.addEventListener('androidOpenTab', handleAndroidOpenTab);
    return () => window.removeEventListener('androidOpenTab', handleAndroidOpenTab);
  }, []);

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

  const handleSelectTab = (tab: string) => {
    setEditingIslem(null);
    setCurrentTab(tab);
  };

  const handleNavigate = (tab: string, state?: any) => {
    setEditingIslem(null);
    setKasaModal(state?.kasaModal);
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

  const handleStartEditIslem = (islemToEdit: Islem) => {
    setEditReturnTab(currentTab === 'islem_duzenle' ? 'islemler' : currentTab);
    setActiveMakbuz(null);
    setEditingIslem(islemToEdit);
    setCurrentTab('islem_duzenle');
  };

  const handleIslemSuccess = (savedIslem: Islem) => {
    const wasEditing = !!editingIslem;
    setEditingIslem(null);
    setActiveMakbuz(savedIslem);
    setCurrentTab(wasEditing ? editReturnTab || 'islemler' : 'islemler');
  };

  return (
    <AppLayout
      currentTab={currentTab}
      onSelectTab={handleSelectTab}
      onOpenNotifications={() => setIsNotificationsOpen(true)}
      notificationRefreshKey={notificationRefreshKey}
    >
        {currentTab === 'dashboard' && (
          <DashboardPage
            onNavigate={handleNavigate}
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onOpenNotifications={() => setIsNotificationsOpen(true)}
            refreshKey={receiptRefreshKey}
          />
        )}

        {currentTab === 'cariler' && (
          <CarilerPage
            onNavigate={handleNavigate}
            openNewModalInitially={openNewCari}
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            refreshKey={receiptRefreshKey}
          />
        )}

        {currentTab === 'tahsilat' && (
          <IslemFormPage
            key="new-tahsilat"
            initialTip="tahsilat"
            preSelectedCariId={preSelectedCariId}
            onSuccess={handleIslemSuccess}
            onCancel={() => handleSelectTab('dashboard')}
          />
        )}

        {currentTab === 'tediye' && (
          <IslemFormPage
            key="new-tediye"
            initialTip="tediye"
            preSelectedCariId={preSelectedCariId}
            onSuccess={handleIslemSuccess}
            onCancel={() => handleSelectTab('dashboard')}
          />
        )}

        {currentTab === 'islem_duzenle' && editingIslem && (
          <IslemFormPage
            key={`edit-${editingIslem.id}`}
            initialTip={editingIslem.tip}
            editingIslem={editingIslem}
            onSuccess={handleIslemSuccess}
            onCancel={() => handleSelectTab(editReturnTab || 'islemler')}
          />
        )}

        {currentTab === 'islemler' && (
          <IslemlerPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onEditIslem={handleStartEditIslem}
            onNavigate={handleNavigate}
            refreshKey={receiptRefreshKey}
          />
        )}

        {currentTab === 'kasa' && (
          <KasaGelirGiderPage key={kasaModal ?? 'kasa'} onNavigate={handleNavigate} initialModal={kasaModal} />
        )}

        {currentTab === 'performans' && (
          <PlasiyerPerformansPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onNavigate={handleNavigate}
            refreshKey={receiptRefreshKey}
          />
        )}

        {currentTab === 'yedekleme' && (
          <YedeklemePage
            onBackupChanged={() => setNotificationRefreshKey((k) => k + 1)}
            onRestored={() => setReceiptRefreshKey((k) => k + 1)}
          />
        )}

        {currentTab === 'paketler' && (
          <SubscriptionLockScreen isLockMode={false} />
        )}

        {currentTab === 'superadmin' && (
          <SuperAdminPage onBackToDashboard={() => handleSelectTab('dashboard')} />
        )}

        {/* MAKBUZ ÖNİZLEME MODALI */}
        {activeMakbuz && (
          <MakbuzModal
            islem={activeMakbuz}
            onClose={() => setActiveMakbuz(null)}
            onEdit={handleStartEditIslem}
            onDeleted={() => {
              setActiveMakbuz(null);
              setReceiptRefreshKey((k) => k + 1);
            }}
          />
        )}

        {/* BİLDİRİM MERKEZİ MODALI */}
        <NotificationsModal
          isOpen={isNotificationsOpen}
          onClose={() => setIsNotificationsOpen(false)}
          onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
          onNavigateTab={handleSelectTab}
          onBadgeUpdated={() => setNotificationRefreshKey((k) => k + 1)}
        />
      </AppLayout>
  );
};
