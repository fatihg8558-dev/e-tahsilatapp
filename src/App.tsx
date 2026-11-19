import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { AuthScreen } from './components/auth/AuthScreen';
import { SubscriptionLockScreen } from './pages/SubscriptionLockScreen';
import { DashboardPage } from './pages/DashboardPage';
import { CarilerPage } from './pages/CarilerPage';
import { IslemFormPage } from './pages/IslemFormPage';
import { IslemlerPage } from './pages/IslemlerPage';
import { PlasiyerPerformansPage } from './pages/PlasiyerPerformansPage';
import { PlasiyerGunSonuPage } from './pages/PlasiyerGunSonuPage';
import { SuperAdminPage } from './pages/SuperAdminPage';
import { CekSenetPortfoyPage } from './pages/CekSenetPortfoyPage';
import { KasaGelirGiderPage } from './pages/KasaGelirGiderPage';
import { YedeklemePage } from './pages/YedeklemePage';
import { MakbuzModal } from './components/makbuz/MakbuzModal';
import { NotificationsModal } from './components/notifications/NotificationsModal';
import { PosPaymentLinkPage } from './components/pos/PosPaymentLinkPage';
import { parsePosPayParams, PosPayLinkParams } from './lib/posService';
import { isWebPlatform } from './lib/platform';
import { Islem } from './types/database';

const VALID_TABS = new Set([
  'dashboard',
  'cariler',
  'tahsilat',
  'tediye',
  'islem_duzenle',
  'islemler',
  'portfoy',
  'kasa',
  'performans',
  'gun_sonu',
  'yedekleme',
  'paketler',
  'superadmin',
]);

const isTabAuthorized = (
  tab: string,
  role: string | undefined,
  isSuperAdmin: boolean,
  hasEditingIslem: boolean,
  isWeb: boolean = isWebPlatform()
): boolean => {
  if (!VALID_TABS.has(tab)) return false;
  if (tab === 'portfoy' && !isWeb) return false;
  if (tab === 'superadmin') return isSuperAdmin;
  if (tab === 'kasa' && role === 'plasiyer') return false;
  if ((tab === 'tahsilat' || tab === 'tediye' || tab === 'islem_duzenle') && role === 'muhasebeci') {
    return false;
  }
  if (tab === 'islem_duzenle' && !hasEditingIslem) return false;
  return true;
};

export const App: React.FC = () => {
  const { user, profile, loading, isPeriodExpired, isSuperAdmin } = useAuth();
  const [currentTab, setCurrentTab] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.__ANDROID_PENDING_TAB__) {
      const initial = window.__ANDROID_PENDING_TAB__.trim();
      delete window.__ANDROID_PENDING_TAB__;
      if (initial && !(initial === 'portfoy' && !isWebPlatform())) return initial;
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
  const [posPayParams, setPosPayParams] = useState<PosPayLinkParams | null>(() => {
    if (typeof window === 'undefined') return null;
    return parsePosPayParams(window.location.search);
  });

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
      const vv = window.visualViewport;
      if (vv) {
        const keyboardLikelyOpen = window.innerHeight - vv.height > 140;
        if (keyboardLikelyOpen) {
          document.body.classList.add('keyboard-open');
        } else if (!isTextInput(document.activeElement)) {
          document.body.classList.remove('keyboard-open');
        }
      }
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
          setCurrentTab(pending === 'portfoy' && !isWebPlatform() ? 'dashboard' : pending);
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
        const cleanTab = tab.trim();
        setEditingIslem(null);
        setCurrentTab(cleanTab === 'portfoy' && !isWebPlatform() ? 'dashboard' : cleanTab);
      }
    };
    window.addEventListener('androidOpenTab', handleAndroidOpenTab);
    return () => window.removeEventListener('androidOpenTab', handleAndroidOpenTab);
  }, []);

  // Oturum değiştiğinde (giriş veya çıkış) aktif sekmeyi ve geçici durumları Genel Bakış'a sıfırla
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const initialAuthResolvedRef = useRef<boolean>(!loading);

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const prevUserId = prevUserIdRef.current;

    if (!initialAuthResolvedRef.current) {
      if (!loading) {
        initialAuthResolvedRef.current = true;
        prevUserIdRef.current = currentUserId;
        if (!currentUserId) {
          setCurrentTab('dashboard');
          setActiveMakbuz(null);
          setEditingIslem(null);
          setEditReturnTab('islemler');
          setPreSelectedCariId(undefined);
          setOpenNewCari(false);
          setKasaModal(undefined);
          setIsNotificationsOpen(false);
        }
      }
      return;
    }

    if (prevUserId !== currentUserId) {
      prevUserIdRef.current = currentUserId;
      setCurrentTab('dashboard');
      setActiveMakbuz(null);
      setEditingIslem(null);
      setEditReturnTab('islemler');
      setPreSelectedCariId(undefined);
      setOpenNewCari(false);
      setKasaModal(undefined);
      setIsNotificationsOpen(false);
    }
  }, [user?.id, loading]);

  // Yetkisi olmayan bir sekme açık kalırsa otomatik olarak Genel Bakış'a yönlendir
  useEffect(() => {
    if (!user || loading) return;
    if (!isTabAuthorized(currentTab, profile?.rol, isSuperAdmin, !!editingIslem)) {
      setEditingIslem(null);
      setCurrentTab('dashboard');
    }
  }, [user, loading, currentTab, profile?.rol, isSuperAdmin, editingIslem]);

  // Ödeme Linki (?pos_pay=...) doğrudan müşteri ödeme ekranını açar (giriş yapmadan da erişilebilir)
  if (posPayParams) {
    return (
      <PosPaymentLinkPage
        params={posPayParams}
        onExit={() => {
          setPosPayParams(null);
          if (typeof window !== 'undefined' && window.history?.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }}
      />
    );
  }

  // Oturum kontrolü yüklenirken
  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#0a0e13] flex flex-col items-center justify-center text-teal-400">
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
    setReceiptRefreshKey((k) => k + 1);
    setCurrentTab(wasEditing ? editReturnTab || 'islemler' : 'islemler');
  };

  const effectiveTab = isTabAuthorized(currentTab, profile?.rol, isSuperAdmin, !!editingIslem)
    ? currentTab
    : 'dashboard';

  return (
    <AppLayout
      currentTab={effectiveTab}
      onSelectTab={handleSelectTab}
      onOpenNotifications={() => setIsNotificationsOpen(true)}
      notificationRefreshKey={notificationRefreshKey}
    >
        {effectiveTab === 'dashboard' && (
          <DashboardPage
            onNavigate={handleNavigate}
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onOpenNotifications={() => setIsNotificationsOpen(true)}
            refreshKey={receiptRefreshKey}
          />
        )}

        {effectiveTab === 'cariler' && (
          <CarilerPage
            onNavigate={handleNavigate}
            openNewModalInitially={openNewCari}
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            refreshKey={receiptRefreshKey}
          />
        )}

        {effectiveTab === 'tahsilat' && (
          <IslemFormPage
            key="new-tahsilat"
            initialTip="tahsilat"
            preSelectedCariId={preSelectedCariId}
            onSuccess={handleIslemSuccess}
            onCancel={() => handleSelectTab('dashboard')}
            onUpgradePackage={() => handleSelectTab('paketler')}
            onPreviewPaymentLink={(params) => setPosPayParams(params)}
          />
        )}

        {effectiveTab === 'tediye' && (
          <IslemFormPage
            key="new-tediye"
            initialTip="tediye"
            preSelectedCariId={preSelectedCariId}
            onSuccess={handleIslemSuccess}
            onCancel={() => handleSelectTab('dashboard')}
            onUpgradePackage={() => handleSelectTab('paketler')}
            onPreviewPaymentLink={(params) => setPosPayParams(params)}
          />
        )}

        {effectiveTab === 'islem_duzenle' && editingIslem && (
          <IslemFormPage
            key={`edit-${editingIslem.id}`}
            initialTip={editingIslem.tip}
            editingIslem={editingIslem}
            onSuccess={handleIslemSuccess}
            onCancel={() => handleSelectTab(editReturnTab || 'islemler')}
            onUpgradePackage={() => handleSelectTab('paketler')}
            onPreviewPaymentLink={(params) => setPosPayParams(params)}
          />
        )}

        {effectiveTab === 'islemler' && (
          <IslemlerPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onEditIslem={handleStartEditIslem}
            onNavigate={handleNavigate}
            refreshKey={receiptRefreshKey}
            onRefreshReceipts={() => setReceiptRefreshKey((k) => k + 1)}
          />
        )}

        {effectiveTab === 'portfoy' && isWebPlatform() && (
          <CekSenetPortfoyPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onNavigate={handleNavigate}
            refreshKey={receiptRefreshKey}
            onUpdated={() => {
              setReceiptRefreshKey((k) => k + 1);
              setNotificationRefreshKey((k) => k + 1);
            }}
          />
        )}

        {effectiveTab === 'kasa' && (
          <KasaGelirGiderPage
            key={kasaModal ?? 'kasa'}
            onNavigate={handleNavigate}
            initialModal={kasaModal}
            refreshKey={receiptRefreshKey}
            onTransferSuccess={() => setReceiptRefreshKey((k) => k + 1)}
          />
        )}

        {effectiveTab === 'performans' && (
          <PlasiyerPerformansPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onNavigate={handleNavigate}
            refreshKey={receiptRefreshKey}
          />
        )}

        {effectiveTab === 'gun_sonu' && (
          <PlasiyerGunSonuPage
            onOpenMakbuz={(islem) => setActiveMakbuz(islem)}
            onNavigate={handleNavigate}
            refreshKey={receiptRefreshKey}
            onTransferSuccess={() => {
              setReceiptRefreshKey((k) => k + 1);
              setNotificationRefreshKey((k) => k + 1);
            }}
          />
        )}

        {effectiveTab === 'yedekleme' && (
          <YedeklemePage
            onBackupChanged={() => setNotificationRefreshKey((k) => k + 1)}
            onRestored={() => setReceiptRefreshKey((k) => k + 1)}
          />
        )}

        {effectiveTab === 'paketler' && (
          <SubscriptionLockScreen isLockMode={false} />
        )}

        {effectiveTab === 'superadmin' && (
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
