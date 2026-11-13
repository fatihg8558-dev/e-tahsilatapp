import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth, SUPER_ADMIN_EMAIL } from '../context/AuthContext';
import { OdemelerPanel } from './OdemelerPanel';
import { supabase } from '../lib/supabase';
import { Firma, Profile, Paket, UserRole } from '../types/database';
import { formatCurrency, formatDate } from '../lib/formatters';
import {
  ShieldCheck,
  Crown,
  Package,
  Building2,
  Users,
  Search,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Infinity as InfinityIcon,
  Calendar,
  Landmark,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  Power,
  Mail,
  Phone,
  Sparkles,
  Copy,
  Check,
  Code2,
} from 'lucide-react';

interface SuperAdminPageProps {
  onBackToDashboard?: () => void;
}

type AdminTab = 'firmalar' | 'paketler' | 'ayarlar' | 'odemeler';
type FirmaFilter = 'all' | 'unlimited' | 'active_package' | 'active_trial' | 'expired';

function extractAdminError(err: unknown, fallback: string): { message: string; isRls: boolean } {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const raw = String((err as { message: string }).message || '');
    const lower = raw.toLowerCase();
    const isRls =
      lower.includes('row-level security') ||
      lower.includes('violates row-level security') ||
      lower.includes('permission denied');
    if (isRls) {
      return {
        message: `Veritabanı RLS güvenlik kuralı bu işleme izin vermedi (${raw}). Supabase SQL Editor üzerinden süper admin yetki kurallarını tanımlamanız gerekebilir.`,
        isRls: true,
      };
    }
    if (lower.includes('foreign key constraint')) {
      return {
        message:
          'Bu paket bir veya daha fazla firmaya tanımlı olduğu için silinemez. Bunun yerine paketi "Pasif" duruma alabilirsiniz.',
        isRls: false,
      };
    }
    return { message: raw || fallback, isRls: false };
  }
  return { message: fallback, isRls: false };
}

function toDateInputValue(isoOrDate?: string | null): string {
  if (!isoOrDate) return '';
  if (isoOrDate.length >= 10) {
    return isoOrDate.slice(0, 10);
  }
  return isoOrDate;
}

function addDaysFromBase(baseDateStr: string | null | undefined, days: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let base = new Date(today);
  if (baseDateStr) {
    const parsed = new Date(baseDateStr.slice(0, 10) + 'T00:00:00');
    if (!isNaN(parsed.getTime()) && parsed.getTime() > today.getTime()) {
      base = parsed;
    }
  }
  base.setDate(base.getDate() + days);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const SuperAdminPage: React.FC<SuperAdminPageProps> = ({ onBackToDashboard }) => {
  const { isSuperAdmin, firma: currentFirma, refreshProfileAndFirma } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>('firmalar');
  const [loading, setLoading] = useState<boolean>(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [paketler, setPaketler] = useState<Paket[]>([]);
  const [iban, setIban] = useState<string>('');
  const [hesapSahibi, setHesapSahibi] = useState<string>('');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string; isRls?: boolean } | null>(null);
  const [showRlsHelp, setShowRlsHelp] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Firma arama & filtreleme
  const [searchQuery, setSearchQuery] = useState('');
  const [firmaFilter, setFirmaFilter] = useState<FirmaFilter>('all');
  const [expandedFirmaIds, setExpandedFirmaIds] = useState<Record<string, boolean>>({});

  // Firma paket/süre düzenleme modalı
  const [editingFirma, setEditingFirma] = useState<Firma | null>(null);
  const [firmaFormPaketId, setFirmaFormPaketId] = useState<string>('');
  const [firmaFormPaketBitis, setFirmaFormPaketBitis] = useState<string>('');
  const [firmaFormDenemeBitis, setFirmaFormDenemeBitis] = useState<string>('');
  const [firmaFormSinirsiz, setFirmaFormSinirsiz] = useState<boolean>(false);

  // Paket ekleme/düzenleme modalı
  const [showPaketModal, setShowPaketModal] = useState(false);
  const [editingPaket, setEditingPaket] = useState<Paket | null>(null);
  const [paketAd, setPaketAd] = useState('');
  const [paketSureGun, setPaketSureGun] = useState('30');
  const [paketFiyat, setPaketFiyat] = useState('');
  const [paketEkPlasiyer, setPaketEkPlasiyer] = useState('0');
  const [paketAktif, setPaketAktif] = useState(true);

  const loadAllData = useCallback(async () => {
    try {
      setLoading(true);
      const [firmalarRes, profilesRes, paketlerRes, ayarlarRes] = await Promise.all([
        supabase.from('firmalar').select('*').order('unvan', { ascending: true }),
        supabase.from('profiles').select('*').order('ad_soyad', { ascending: true }),
        supabase.from('paketler').select('*').order('fiyat', { ascending: true }),
        supabase.from('ayarlar').select('*'),
      ]);

      const firstError =
        firmalarRes.error || profilesRes.error || paketlerRes.error || ayarlarRes.error;
      if (firstError) {
        const parsed = extractAdminError(firstError, 'Yönetim verileri yüklenemedi.');
        setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
      }

      if (firmalarRes.data) setFirmalar(firmalarRes.data as Firma[]);
      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);
      if (paketlerRes.data) setPaketler(paketlerRes.data as Paket[]);

      if (ayarlarRes.data) {
        let foundIban = '';
        let foundHesap = '';
        (ayarlarRes.data as { anahtar: string; deger: string }[]).forEach((row) => {
          if (row.anahtar === 'iban') foundIban = row.deger || '';
          if (row.anahtar === 'hesap_sahibi') foundHesap = row.deger || '';
        });
        setIban(foundIban);
        setHesapSahibi(foundHesap);
      }
    } catch (err) {
      const parsed = extractAdminError(err, 'Veriler yüklenirken beklenmeyen hata oluştu.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      loadAllData();
    }
  }, [isSuperAdmin, loadAllData]);

  const profilesByFirma = useMemo(() => {
    const map: Record<string, Profile[]> = {};
    profiles.forEach((p) => {
      const key = p.firma_id || '__none__';
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [profiles]);

  const firmaIdSet = useMemo(() => new Set(firmalar.map((f) => f.id)), [firmalar]);

  const orphanProfiles = useMemo(
    () => profiles.filter((p) => !p.firma_id || !firmaIdSet.has(p.firma_id)),
    [profiles, firmaIdSet]
  );

  const paketMap = useMemo(() => {
    const map: Record<string, Paket> = {};
    paketler.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [paketler]);

  const getFirmaStatus = (f: Firma): {
    type: Exclude<FirmaFilter, 'all'>;
    label: string;
    kalanGun: number;
  } => {
    if (f.sinirsiz) {
      return { type: 'unlimited', label: 'Sınırsız Yetki', kalanGun: 9999 };
    }
    const now = Date.now();
    const oneDayMs = 1000 * 60 * 60 * 24;

    if (f.paket_bitis) {
      const dt = new Date(f.paket_bitis);
      if (f.paket_bitis.length <= 10) dt.setHours(23, 59, 59, 999);
      if (!isNaN(dt.getTime()) && dt.getTime() >= now) {
        const kalan = Math.max(1, Math.ceil((dt.getTime() - now) / oneDayMs));
        return { type: 'active_package', label: `Aktif Paket (${kalan} Gün)`, kalanGun: kalan };
      }
    }

    if (f.deneme_bitis) {
      const dt = new Date(f.deneme_bitis);
      if (f.deneme_bitis.length <= 10) dt.setHours(23, 59, 59, 999);
      if (!isNaN(dt.getTime()) && dt.getTime() >= now) {
        const kalan = Math.max(1, Math.ceil((dt.getTime() - now) / oneDayMs));
        return { type: 'active_trial', label: `Deneme (${kalan} Gün)`, kalanGun: kalan };
      }
    }

    return { type: 'expired', label: 'Süresi Doldu', kalanGun: 0 };
  };

  const stats = useMemo(() => {
    let unlimitedCount = 0;
    let activePackageCount = 0;
    let expiredCount = 0;

    firmalar.forEach((f) => {
      const st = getFirmaStatus(f);
      if (st.type === 'unlimited') unlimitedCount++;
      else if (st.type === 'active_package') activePackageCount++;
      else if (st.type === 'expired') expiredCount++;
    });

    return {
      totalFirms: firmalar.length,
      unlimitedCount,
      activePackageCount,
      expiredCount,
      totalUsers: profiles.length,
      activePackages: paketler.filter((p) => p.aktif).length,
    };
  }, [firmalar, profiles, paketler]);

  const filteredFirmalar = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return firmalar.filter((f) => {
      const st = getFirmaStatus(f);
      if (firmaFilter !== 'all' && st.type !== firmaFilter) {
        return false;
      }
      if (!q) return true;
      const firmaUsers = profilesByFirma[f.id] || [];
      const matchesFirma =
        (f.unvan || '').toLowerCase().includes(q) ||
        (f.vergi_no || '').toLowerCase().includes(q) ||
        (f.email || '').toLowerCase().includes(q) ||
        (f.telefon || '').toLowerCase().includes(q);
      const matchesUser = firmaUsers.some(
        (u) =>
          (u.ad_soyad || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.telefon || '').toLowerCase().includes(q)
      );
      return matchesFirma || matchesUser;
    });
  }, [firmalar, firmaFilter, searchQuery, profilesByFirma]);

  // Yetkisiz Erişim Koruması
  if (!isSuperAdmin) {
    return (
      <div className="max-w-lg mx-auto my-12 bg-[#111c2e] border border-red-500/30 rounded-2xl p-8 text-center space-y-4 shadow-xl">
        <div className="w-14 h-14 rounded-2xl bg-red-500/15 text-red-400 flex items-center justify-center mx-auto border border-red-500/30">
          <ShieldCheck className="w-7 h-7" />
        </div>
        <h2 className="text-lg font-extrabold text-white">Süper Admin Yetkisi Gerekli</h2>
        <p className="text-xs text-slate-300 leading-relaxed">
          Bu yönetim ekranı yalnızca Süper Admin hesabı (
          <strong className="text-amber-300">{SUPER_ADMIN_EMAIL}</strong>) tarafından görüntülenebilir.
        </p>
        {onBackToDashboard && (
          <button
            type="button"
            onClick={onBackToDashboard}
            className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs transition"
          >
            Ana Sayfaya Dön
          </button>
        )}
      </div>
    );
  }

  // Hızlı Sınırsız Yetki Ver / Kaldır
  const handleToggleSinirsiz = async (f: Firma) => {
    const yeniDurum = !f.sinirsiz;
    try {
      setSavingId(f.id);
      setFeedback(null);

      const updatePayload: Partial<Firma> = {
        sinirsiz: yeniDurum,
      };
      if (yeniDurum) {
        const currentPaketBitis = f.paket_bitis ? new Date(f.paket_bitis) : null;
        if (!currentPaketBitis || isNaN(currentPaketBitis.getTime()) || currentPaketBitis.getTime() < Date.now()) {
          updatePayload.paket_bitis = '2099-12-31';
        }
        const currentDenemeBitis = f.deneme_bitis ? new Date(f.deneme_bitis) : null;
        if (!currentDenemeBitis || isNaN(currentDenemeBitis.getTime()) || currentDenemeBitis.getTime() < Date.now()) {
          updatePayload.deneme_bitis = '2099-12-31';
        }
      } else {
        if (f.paket_bitis?.startsWith('2099-12-31')) {
          updatePayload.paket_bitis = null;
        }
        if (f.deneme_bitis?.startsWith('2099-12-31')) {
          updatePayload.deneme_bitis = null;
        }
      }

      const { data: updatedRow, error } = await supabase
        .from('firmalar')
        .update(updatePayload)
        .eq('id', f.id)
        .select('*')
        .single();

      if (error) throw error;

      const finalRow = (updatedRow as Firma) || { ...f, ...updatePayload };
      setFirmalar((prev) =>
        prev.map((item) => (item.id === f.id ? finalRow : item))
      );
      if (f.id === currentFirma?.id) {
        await refreshProfileAndFirma();
      }
      setFeedback({
        type: 'success',
        text: `"${f.unvan}" firması için sınırsız yetki ${yeniDurum ? 'tanımlandı (sinirsiz=true, bitiş tarihleri 2099-12-31)' : 'kaldırıldı'}.`,
      });
    } catch (err) {
      const parsed = extractAdminError(err, 'Sınırsız yetki durumu güncellenemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  // Firma Düzenleme Modalını Aç
  const openEditFirmaModal = (f: Firma) => {
    setEditingFirma(f);
    setFirmaFormPaketId(f.paket_id || '');
    setFirmaFormPaketBitis(toDateInputValue(f.paket_bitis));
    setFirmaFormDenemeBitis(toDateInputValue(f.deneme_bitis));
    setFirmaFormSinirsiz(Boolean(f.sinirsiz));
  };

  const handleApplySelectedPackageDuration = () => {
    const selected = paketler.find((p) => p.id === firmaFormPaketId);
    if (!selected) return;
    setFirmaFormPaketBitis(addDaysFromBase(firmaFormPaketBitis, selected.sure_gun));
  };

  const handleSaveFirmaModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFirma) return;
    try {
      setSavingId(editingFirma.id);
      setFeedback(null);

      const effectivePaketBitis =
        firmaFormSinirsiz && !firmaFormPaketBitis ? '2099-12-31' : firmaFormPaketBitis || null;

      const payload = {
        paket_id: firmaFormPaketId || null,
        paket_bitis: effectivePaketBitis,
        deneme_bitis: firmaFormDenemeBitis || null,
        sinirsiz: firmaFormSinirsiz,
      };

      const { data: updatedRow, error } = await supabase
        .from('firmalar')
        .update(payload)
        .eq('id', editingFirma.id)
        .select('*')
        .single();

      if (error) throw error;

      const finalRow = (updatedRow as Firma) || { ...editingFirma, ...payload };
      setFirmalar((prev) =>
        prev.map((item) => (item.id === editingFirma.id ? finalRow : item))
      );
      if (editingFirma.id === currentFirma?.id) {
        await refreshProfileAndFirma();
      }
      setFeedback({
        type: 'success',
        text: `"${editingFirma.unvan}" firmasının paket ve abonelik yetkileri güncellendi.`,
      });
      setEditingFirma(null);
    } catch (err) {
      const parsed = extractAdminError(err, 'Firma abonelik bilgileri güncellenemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  // Kullanıcı Rol Değiştirme
  const handleChangeUserRole = async (u: Profile, newRole: UserRole) => {
    if (u.email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL && newRole !== 'superadmin') {
      setFeedback({
        type: 'error',
        text: `Ana Süper Admin hesabı (${SUPER_ADMIN_EMAIL}) farklı bir role düşürülemez.`,
      });
      return;
    }

    try {
      setSavingId(u.id);
      setFeedback(null);
      const { error } = await supabase
        .from('profiles')
        .update({ rol: newRole })
        .eq('id', u.id);

      if (error) throw error;

      setProfiles((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, rol: newRole } : item))
      );
      setFeedback({
        type: 'success',
        text: `${u.ad_soyad || u.email} kullanıcısının rolü güncellendi.`,
      });
    } catch (err) {
      const parsed = extractAdminError(err, 'Kullanıcı rolü güncellenemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  // Kullanıcı Aktif/Pasif Değiştirme
  const handleToggleUserAktif = async (u: Profile) => {
    if (u.email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL && u.aktif) {
      setFeedback({
        type: 'error',
        text: `Ana Süper Admin hesabı (${SUPER_ADMIN_EMAIL}) pasife alınamaz.`,
      });
      return;
    }

    const yeniDurum = !u.aktif;
    try {
      setSavingId(u.id);
      setFeedback(null);
      const { error } = await supabase
        .from('profiles')
        .update({ aktif: yeniDurum })
        .eq('id', u.id);

      if (error) throw error;

      setProfiles((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, aktif: yeniDurum } : item))
      );
      setFeedback({
        type: 'success',
        text: `${u.ad_soyad || u.email} kullanıcısı ${yeniDurum ? 'aktif edildi' : 'pasife alındı'}.`,
      });
    } catch (err) {
      const parsed = extractAdminError(err, 'Kullanıcı durumu güncellenemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  // Paket Modalı Açma (Yeni veya Düzenle)
  const openNewPaketModal = () => {
    setEditingPaket(null);
    setPaketAd('');
    setPaketSureGun('30');
    setPaketFiyat('');
    setPaketEkPlasiyer('0');
    setPaketAktif(true);
    setShowPaketModal(true);
  };

  const openEditPaketModal = (p: Paket) => {
    setEditingPaket(p);
    setPaketAd(p.ad);
    setPaketSureGun(String(p.sure_gun));
    setPaketFiyat(String(p.fiyat));
    setPaketEkPlasiyer(String(p.ek_plasiyer_ucreti || 0));
    setPaketAktif(p.aktif);
    setShowPaketModal(true);
  };

  const handleSavePaket = async (e: React.FormEvent) => {
    e.preventDefault();
    const ad = paketAd.trim();
    const sureGun = parseInt(paketSureGun, 10);
    const fiyat = parseFloat(paketFiyat.replace(',', '.'));
    const ekPlasiyer = parseFloat((paketEkPlasiyer || '0').replace(',', '.'));

    if (!ad) {
      setFeedback({ type: 'error', text: 'Lütfen paket adı giriniz.' });
      return;
    }
    if (isNaN(sureGun) || sureGun <= 0) {
      setFeedback({ type: 'error', text: 'Süre (gün) 0’dan büyük olmalıdır.' });
      return;
    }
    if (isNaN(fiyat) || fiyat < 0) {
      setFeedback({ type: 'error', text: 'Geçerli bir paket fiyatı giriniz.' });
      return;
    }

    try {
      setSavingId(editingPaket?.id || 'new-paket');
      setFeedback(null);

      const payload = {
        ad,
        sure_gun: sureGun,
        fiyat,
        ek_plasiyer_ucreti: isNaN(ekPlasiyer) || ekPlasiyer < 0 ? 0 : ekPlasiyer,
        aktif: paketAktif,
      };

      if (editingPaket) {
        const { data, error } = await supabase
          .from('paketler')
          .update(payload)
          .eq('id', editingPaket.id)
          .select('*')
          .single();

        if (error) throw error;
        const updated = (data as Paket) || { ...editingPaket, ...payload };
        setPaketler((prev) =>
          prev.map((item) => (item.id === editingPaket.id ? updated : item)).sort((a, b) => a.fiyat - b.fiyat)
        );
        setFeedback({ type: 'success', text: `"${ad}" paketi güncellendi.` });
      } else {
        const { data, error } = await supabase
          .from('paketler')
          .insert(payload)
          .select('*')
          .single();

        if (error) throw error;
        if (data) {
          setPaketler((prev) => [...prev, data as Paket].sort((a, b) => a.fiyat - b.fiyat));
        } else {
          await loadAllData();
        }
        setFeedback({ type: 'success', text: `"${ad}" adlı yeni paket oluşturuldu.` });
      }

      setShowPaketModal(false);
    } catch (err) {
      const parsed = extractAdminError(err, 'Paket kaydedilemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  const handleTogglePaketAktif = async (p: Paket) => {
    const yeniDurum = !p.aktif;
    try {
      setSavingId(p.id);
      setFeedback(null);
      const { error } = await supabase
        .from('paketler')
        .update({ aktif: yeniDurum })
        .eq('id', p.id);

      if (error) throw error;

      setPaketler((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, aktif: yeniDurum } : item))
      );
      setFeedback({
        type: 'success',
        text: `"${p.ad}" paketi ${yeniDurum ? 'satışa açıldı (Aktif)' : 'pasife alındı'}.`,
      });
    } catch (err) {
      const parsed = extractAdminError(err, 'Paket durumu değiştirilemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  const handleDeletePaket = async (p: Paket) => {
    if (!window.confirm(`"${p.ad}" paketini kalıcı olarak silmek istediğinize emin misiniz?`)) {
      return;
    }

    try {
      setSavingId(p.id);
      setFeedback(null);
      const { error } = await supabase.from('paketler').delete().eq('id', p.id);
      if (error) throw error;

      setPaketler((prev) => prev.filter((item) => item.id !== p.id));
      setFeedback({ type: 'success', text: `"${p.ad}" paketi silindi.` });
    } catch (err) {
      const parsed = extractAdminError(err, 'Paket silinemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  // IBAN & Ödeme Ayarlarını Kaydet
  const upsertAyar = async (anahtar: string, deger: string) => {
    const { data: existing, error: selErr } = await supabase
      .from('ayarlar')
      .select('anahtar')
      .eq('anahtar', anahtar)
      .maybeSingle();

    if (selErr) throw selErr;

    if (existing) {
      const { error: updErr } = await supabase
        .from('ayarlar')
        .update({ deger })
        .eq('anahtar', anahtar);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await supabase.from('ayarlar').insert({ anahtar, deger });
      if (insErr) throw insErr;
    }
  };

  const handleSaveAyarlar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingId('ayarlar');
      setFeedback(null);
      await upsertAyar('iban', iban.trim());
      await upsertAyar('hesap_sahibi', hesapSahibi.trim());
      setFeedback({
        type: 'success',
        text: 'Banka havale / EFT ve IBAN bilgileri başarıyla güncellendi.',
      });
    } catch (err) {
      const parsed = extractAdminError(err, 'Ödeme ayarları kaydedilemedi.');
      setFeedback({ type: 'error', text: parsed.message, isRls: parsed.isRls });
    } finally {
      setSavingId(null);
    }
  };

  const rlsSqlSnippet = `-- UYARI: Güvenlik kuralları veritabanında zaten kurulu ve korumalıdır.
-- Bu pencerede SQL çalıştırmayın; mevcut korumaları zayıflatabilir.
-- Değişiklik gerekiyorsa geliştiricinize danışın.`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(rlsSqlSnippet);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* ÜST BAŞLIK KARTI */}
      <div className="bg-gradient-to-r from-[#111c2e] via-[#132036] to-[#111c2e] border border-amber-400/30 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(251,191,36,0.2)]">
              <Crown className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  Süper Admin Yönetim Paneli
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-400 text-slate-950">
                  Tam Yetki
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Yetkili Hesap: <strong className="text-teal-300">{SUPER_ADMIN_EMAIL}</strong> • Paket oluşturma, firma süre uzatma ve sınırsız yetki yönetimi.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              onClick={() => setShowRlsHelp(!showRlsHelp)}
              data-testid="superadmin_rls_sql_button"
              className="px-3.5 py-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-xs font-bold text-amber-300 flex items-center gap-1.5 transition"
            >
              <Code2 className="w-4 h-4" />
              <span>Veritabanı RLS SQL</span>
            </button>

            <button
              type="button"
              onClick={loadAllData}
              disabled={loading}
              data-testid="superadmin_refresh_button"
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white flex items-center gap-2 transition"
            >
              <RefreshCw className={`w-4 h-4 text-teal-400 ${loading ? 'animate-spin' : ''}`} />
              <span>Verileri Yenile</span>
            </button>
          </div>
        </div>

        {/* ÖZET KPI KARTLARI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <div className="p-3.5 rounded-xl bg-black/25 border border-white/[0.06]">
            <div className="text-[11px] text-slate-400 font-semibold">Toplam Firma</div>
            <div className="text-xl font-black text-white mt-0.5">{stats.totalFirms}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{stats.totalUsers} kayıtlı kullanıcı</div>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="text-[11px] text-amber-300 font-semibold">Sınırsız Yetkili</div>
            <div className="text-xl font-black text-amber-300 mt-0.5">{stats.unlimitedCount}</div>
            <div className="text-[10px] text-amber-200/70 mt-0.5">Süresiz tam erişim</div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-[11px] text-emerald-300 font-semibold">Aktif Paketli</div>
            <div className="text-xl font-black text-emerald-300 mt-0.5">{stats.activePackageCount}</div>
            <div className="text-[10px] text-emerald-200/70 mt-0.5">{stats.expiredCount} süresi dolmuş</div>
          </div>

          <div className="p-3.5 rounded-xl bg-teal-500/10 border border-teal-500/20">
            <div className="text-[11px] text-teal-300 font-semibold">Abonelik Paketleri</div>
            <div className="text-xl font-black text-teal-300 mt-0.5">{stats.activePackages}</div>
            <div className="text-[10px] text-teal-200/70 mt-0.5">{paketler.length} toplam tanımlı</div>
          </div>
        </div>
      </div>

      {/* VERİTABANI RLS SQL YARDIMCISI */}
      {showRlsHelp && (
        <div className="p-4 rounded-2xl bg-[#111c2e] border border-amber-400/30 space-y-2.5 shadow-xl">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="text-xs font-extrabold text-amber-300 flex items-center gap-1.5">
                <Code2 className="w-4 h-4" />
                <span>Supabase Veritabanı RLS Politikaları (SQL Editor)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Sınırsız yetkili veya süper admin hesaplarda makbuz kaydederken RLS hatası alırsanız bu SQL kodunu Supabase SQL Editor’de bir kez çalıştırın.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopySql}
                className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 text-xs font-extrabold flex items-center gap-1.5"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'SQL Kopyalandı' : 'SQL Kopyala'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRlsHelp(false)}
                className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <pre className="p-3 rounded-xl bg-black/50 border border-white/10 text-[10px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap">
            {rlsSqlSnippet}
          </pre>
        </div>
      )}

      {/* GERİ BİLDİRİM MESAJI */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border text-xs flex flex-col gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed font-medium">{feedback.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-1 rounded-lg hover:bg-white/10 shrink-0"
              aria-label="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {feedback.isRls && !showRlsHelp && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowRlsHelp(true)}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 hover:text-amber-200 underline"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Gerekli Supabase RLS SQL Politikalarını Göster</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* SEKME SEÇİCİ */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveTab('firmalar')}
          data-testid="superadmin_tab_firmalar"
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition border ${
            activeTab === 'firmalar'
              ? 'bg-teal-400 text-slate-950 border-teal-400 shadow-lg'
              : 'bg-[#111c2e] text-slate-300 border-slate-700/60 hover:text-white'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Firmalar & Sınırsız Yetki ({firmalar.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('paketler')}
          data-testid="superadmin_tab_paketler"
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition border ${
            activeTab === 'paketler'
              ? 'bg-teal-400 text-slate-950 border-teal-400 shadow-lg'
              : 'bg-[#111c2e] text-slate-300 border-slate-700/60 hover:text-white'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Paket Ekle & Düzenle ({paketler.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ayarlar')}
          data-testid="superadmin_tab_ayarlar"
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition border ${
            activeTab === 'ayarlar'
              ? 'bg-teal-400 text-slate-950 border-teal-400 shadow-lg'
              : 'bg-[#111c2e] text-slate-300 border-slate-700/60 hover:text-white'
          }`}
        >
          <Landmark className="w-4 h-4" />
          <span>IBAN & Ödeme Ayarları</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('odemeler')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition border ${
            activeTab === 'odemeler'
              ? 'bg-teal-400 text-slate-950 border-teal-400 shadow-lg'
              : 'bg-[#111c2e] text-slate-300 border-slate-700/60 hover:text-white'
          }`}
        >
          <Landmark className="w-4 h-4" />
          <span>Ödeme Bildirimleri</span>
        </button>
      </div>

      {activeTab === 'odemeler' && <OdemelerPanel />}

      {/* SEKME 1: FİRMALAR & YETKİLER */}
      {activeTab === 'firmalar' && (
        <div className="space-y-4">
          {/* Arama & Filtreler */}
          <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="superadmin_firma_search_input"
                placeholder="Firma ünvanı, vergi no, e-posta veya kullanıcı adı ile ara..."
                className="w-full bg-[#0b1322] border border-slate-700/70 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-400"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(
                [
                  { key: 'all', label: 'Tümü' },
                  { key: 'unlimited', label: 'Sınırsız Yetkili' },
                  { key: 'active_package', label: 'Aktif Paketli' },
                  { key: 'active_trial', label: 'Deneme' },
                  { key: 'expired', label: 'Süresi Dolmuş' },
                ] as { key: FirmaFilter; label: string }[]
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFirmaFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition border ${
                    firmaFilter === f.key
                      ? 'bg-teal-500/20 text-teal-300 border-teal-400/50'
                      : 'bg-black/20 text-slate-400 border-white/5 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center bg-[#111c2e] border border-slate-700/60 rounded-2xl">
              <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <span className="text-xs text-slate-400">Firmalar ve kullanıcılar yükleniyor...</span>
            </div>
          ) : filteredFirmalar.length === 0 ? (
            <div className="p-10 text-center bg-[#111c2e] border border-slate-700/60 rounded-2xl text-xs text-slate-400">
              Arama kriterine uygun firma bulunamadı.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFirmalar.map((f) => {
                const st = getFirmaStatus(f);
                const firmaUsers = profilesByFirma[f.id] || [];
                const activePaket = f.paket_id ? paketMap[f.paket_id] : null;
                const isExpanded = Boolean(expandedFirmaIds[f.id]);
                const isBusy = savingId === f.id;

                return (
                  <div
                    key={f.id}
                    className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-4 sm:p-5 space-y-4 shadow-md hover:border-teal-500/30 transition"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Firma Bilgileri */}
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
                            {f.unvan}
                          </h3>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${
                              st.type === 'unlimited'
                                ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                                : st.type === 'active_package'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : st.type === 'active_trial'
                                ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                : 'bg-red-500/15 text-red-300 border-red-500/30'
                            }`}
                          >
                            {st.label}
                          </span>
                          {activePaket && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-500/10 text-teal-300 border border-teal-500/20">
                              Paket: {activePaket.ad}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                          <span>
                            VKN/TCKN: <strong className="text-slate-200 font-mono">{f.vergi_no || '-'}</strong>
                          </span>
                          {f.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3" />
                              {f.email}
                            </span>
                          )}
                          {f.telefon && (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {f.telefon}
                            </span>
                          )}
                          <span>
                            Paket Bitiş:{' '}
                            <strong className="text-slate-200">{formatDate(f.paket_bitis)}</strong>
                          </span>
                          <span>
                            Deneme Bitiş:{' '}
                            <strong className="text-slate-200">{formatDate(f.deneme_bitis)}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Aksiyon Butonları */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleSinirsiz(f)}
                          data-testid={`toggle_unlimited_${f.id}`}
                          className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border ${
                            f.sinirsiz
                              ? 'bg-amber-400 text-slate-950 border-amber-400 hover:bg-amber-300'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                          }`}
                        >
                          <InfinityIcon className="w-4 h-4" />
                          <span>{f.sinirsiz ? 'Sınırsız Yetkiyi Kaldır' : 'Sınırsız Yetki Ver'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openEditFirmaModal(f)}
                          data-testid={`edit_firma_package_${f.id}`}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold bg-teal-400/15 hover:bg-teal-400/25 text-teal-300 border border-teal-400/30 flex items-center gap-1.5 transition"
                        >
                          <Calendar className="w-4 h-4" />
                          <span>Paket / Süre Ata</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFirmaIds((prev) => ({ ...prev, [f.id]: !prev[f.id] }))
                          }
                          className="min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 flex items-center gap-1.5 transition"
                        >
                          <Users className="w-4 h-4 text-teal-400" />
                          <span>Kullanıcılar ({firmaUsers.length})</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Firma Kullanıcı Listesi (Genişletildiğinde) */}
                    {isExpanded && (
                      <div className="pt-3 border-t border-white/[0.07] space-y-2">
                        {firmaUsers.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic py-2">
                            Bu firmaya bağlı kullanıcı profili bulunamadı.
                          </div>
                        ) : (
                          firmaUsers.map((u) => {
                            const isProtectedMaster =
                              u.email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
                            const uBusy = savingId === u.id;

                            return (
                              <div
                                key={u.id}
                                className="p-3 rounded-xl bg-[#0b1322] border border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-white">
                                      {u.ad_soyad || 'İsimsiz Kullanıcı'}
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                        u.aktif
                                          ? 'bg-emerald-500/15 text-emerald-300'
                                          : 'bg-red-500/15 text-red-300'
                                      }`}
                                    >
                                      {u.aktif ? 'Aktif' : 'Pasif'}
                                    </span>
                                    {isProtectedMaster && (
                                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400/20 text-amber-300">
                                        Ana Süper Admin
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                                    {u.email} {u.telefon ? `• ${u.telefon}` : ''}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  <select
                                    value={u.rol}
                                    disabled={uBusy || isProtectedMaster}
                                    onChange={(e) =>
                                      handleChangeUserRole(u, e.target.value as UserRole)
                                    }
                                    aria-label={`${u.email} rol seçimi`}
                                    className="bg-[#111c2e] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-teal-400 disabled:opacity-60"
                                  >
                                    <option value="ana">Ana Hesap</option>
                                    <option value="plasiyer">Plasiyer</option>
                                    <option value="muhasebeci">Muhasebeci</option>
                                    <option value="superadmin">Süper Admin</option>
                                  </select>

                                  <button
                                    type="button"
                                    disabled={uBusy || isProtectedMaster}
                                    onClick={() => handleToggleUserAktif(u)}
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 border transition disabled:opacity-50 ${
                                      u.aktif
                                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                                    }`}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                    <span>{u.aktif ? 'Pasife Al' : 'Aktif Et'}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Eşleşmeyen / Bağımsız Kullanıcılar */}
          {orphanProfiles.length > 0 && (
            <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-4 sm:p-5 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Diğer / Firmasız Kullanıcı Profilleri ({orphanProfiles.length})
              </h3>
              <div className="space-y-2">
                {orphanProfiles.map((u) => {
                  const isProtectedMaster = u.email?.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
                  return (
                    <div
                      key={u.id}
                      className="p-3 rounded-xl bg-[#0b1322] border border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">{u.ad_soyad || u.email}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={u.rol}
                          disabled={savingId === u.id || isProtectedMaster}
                          onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                          className="bg-[#111c2e] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value="ana">Ana Hesap</option>
                          <option value="plasiyer">Plasiyer</option>
                          <option value="muhasebeci">Muhasebeci</option>
                          <option value="superadmin">Süper Admin</option>
                        </select>
                        <button
                          type="button"
                          disabled={savingId === u.id || isProtectedMaster}
                          onClick={() => handleToggleUserAktif(u)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/5 border border-white/10 text-slate-200"
                        >
                          {u.aktif ? 'Pasife Al' : 'Aktif Et'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SEKME 2: PAKET YÖNETİMİ */}
      {activeTab === 'paketler' && (
        <div className="space-y-4">
          <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-400" />
                <span>Abonelik Paketleri Yönetimi</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Burada eklediğiniz ve aktifleştirdiğiniz paketler müşterilerin "Paket Satın Al" ekranında anında görünür.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewPaketModal}
              data-testid="add_paket_button"
              className="px-4 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-lg transition shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Paket Ekle</span>
            </button>
          </div>

          {paketler.length === 0 ? (
            <div className="p-10 text-center bg-[#111c2e] border border-slate-700/60 rounded-2xl space-y-3">
              <Package className="w-8 h-8 text-slate-500 mx-auto" />
              <div className="text-xs text-slate-300 font-semibold">Henüz tanımlı paket bulunmuyor.</div>
              <button
                type="button"
                onClick={openNewPaketModal}
                className="px-4 py-2 rounded-xl bg-teal-400 text-slate-950 font-bold text-xs"
              >
                İlk Paketi Oluştur
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paketler.map((p) => {
                const assignedCount = firmalar.filter((f) => f.paket_id === p.id).length;
                const isBusy = savingId === p.id;

                return (
                  <div
                    key={p.id}
                    className={`bg-[#111c2e] rounded-2xl p-5 border flex flex-col justify-between gap-4 transition ${
                      p.aktif ? 'border-slate-700/70' : 'border-slate-800 opacity-75'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-base font-extrabold text-white">{p.ad}</h3>
                          <span className="text-[11px] text-slate-400">
                            {assignedCount} firmada tanımlı
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            p.aktif
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-600/20 text-slate-400 border border-slate-600/40'
                          }`}
                        >
                          {p.aktif ? 'Aktif' : 'Pasif'}
                        </span>
                      </div>

                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-black text-teal-400">
                          {formatCurrency(p.fiyat, false)}
                        </span>
                        <span className="text-xs text-slate-400">₺ / {p.sure_gun} Gün</span>
                      </div>

                      <div className="text-xs text-slate-300 space-y-1 pt-2 border-t border-white/[0.06]">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Paket Süresi:</span>
                          <span className="font-bold">{p.sure_gun} Gün</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Ek Plasiyer Ücreti:</span>
                          <span className="font-bold">{formatCurrency(p.ek_plasiyer_ucreti || 0)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openEditPaketModal(p)}
                        data-testid={`edit_paket_${p.id}`}
                        className="flex-1 min-h-[38px] px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold flex items-center justify-center gap-1.5 border border-white/10 transition"
                      >
                        <Pencil className="w-3.5 h-3.5 text-teal-400" />
                        <span>Düzenle</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleTogglePaketAktif(p)}
                        className={`min-h-[38px] px-3 py-2 rounded-xl text-xs font-bold border transition ${
                          p.aktif
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                        }`}
                      >
                        {p.aktif ? 'Pasif Yap' : 'Aktif Et'}
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeletePaket(p)}
                        title="Paketi Sil"
                        aria-label={`${p.ad} paketini sil`}
                        className="min-h-[38px] px-2.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SEKME 3: ÖDEME & IBAN AYARLARI */}
      {activeTab === 'ayarlar' && (
        <div className="bg-[#111c2e] border border-slate-700/60 rounded-2xl p-5 sm:p-6 max-w-2xl space-y-5">
          <div>
            <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
              <Landmark className="w-4 h-4 text-teal-400" />
              <span>Banka Havale / EFT & IBAN Ayarları</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Abonelik satın almak isteyen firmalara gösterilecek banka hesap bilgilerini buradan güncelleyebilirsiniz.
            </p>
          </div>

          <form onSubmit={handleSaveAyarlar} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Hesap Sahibi / Firma Ünvanı
              </label>
              <input
                type="text"
                value={hesapSahibi}
                onChange={(e) => setHesapSahibi(e.target.value)}
                data-testid="superadmin_hesap_sahibi_input"
                placeholder="Örn: Tahsilatım Yazılım A.Ş."
                className="w-full bg-[#0b1322] border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-400"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                IBAN Numarası
              </label>
              <input
                type="text"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                data-testid="superadmin_iban_input"
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                className="w-full bg-[#0b1322] border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-teal-300 placeholder-slate-500 focus:outline-none focus:border-teal-400"
              />
            </div>

            <button
              type="submit"
              disabled={savingId === 'ayarlar'}
              data-testid="superadmin_save_ayarlar_button"
              className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-slate-950 font-extrabold text-xs flex items-center gap-2 shadow-lg transition"
            >
              <Save className="w-4 h-4" />
              <span>{savingId === 'ayarlar' ? 'Kaydediliyor...' : 'Ödeme Bilgilerini Kaydet'}</span>
            </button>
          </form>
        </div>
      )}

      {/* MODAL: FİRMA PAKET & SÜRE ATAMA */}
      {editingFirma && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="bg-[#111c2e] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden my-auto">
            <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-black/20">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-white">
                  Firma Paket & Yetki Düzenle
                </h3>
                <p className="text-xs text-teal-300 font-semibold mt-0.5">{editingFirma.unvan}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingFirma(null)}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveFirmaModal} className="p-4 sm:p-5 space-y-4 text-xs">
              {/* Sınırsız Tam Yetki */}
              <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <InfinityIcon className="w-5 h-5 text-amber-300 shrink-0" />
                  <div>
                    <div className="font-bold text-amber-200">Sınırsız Tam Yetki Ver</div>
                    <div className="text-[11px] text-amber-200/70">
                      Açıldığında süre sınırı olmadan tüm özellikler aktif olur.
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={firmaFormSinirsiz}
                  onChange={(e) => setFirmaFormSinirsiz(e.target.checked)}
                  className="w-5 h-5 accent-amber-400 rounded"
                />
              </label>

              {/* Paket Seçimi */}
              <div>
                <label className="block font-bold text-slate-300 mb-1.5">Tanımlı Paket</label>
                <div className="flex gap-2">
                  <select
                    value={firmaFormPaketId}
                    onChange={(e) => setFirmaFormPaketId(e.target.value)}
                    className="flex-1 bg-[#0b1322] border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-teal-400"
                  >
                    <option value="">Paket Seçiniz (Opsiyonel)</option>
                    {paketler.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.ad} ({p.sure_gun} Gün - {formatCurrency(p.fiyat)})
                      </option>
                    ))}
                  </select>
                  {firmaFormPaketId && (
                    <button
                      type="button"
                      onClick={handleApplySelectedPackageDuration}
                      className="px-3 py-2 rounded-xl bg-teal-400/20 hover:bg-teal-400/30 text-teal-300 font-bold border border-teal-400/30 whitespace-nowrap"
                    >
                      + Süre Ekle
                    </button>
                  )}
                </div>
              </div>

              {/* Hızlı Gün Ekleme Butonları */}
              <div>
                <span className="block text-[11px] font-semibold text-slate-400 mb-1.5">
                  Paket Bitiş Tarihine Hızlı Gün Ekle:
                </span>
                <div className="flex flex-wrap gap-2">
                  {[30, 90, 180, 365].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() =>
                        setFirmaFormPaketBitis(addDaysFromBase(firmaFormPaketBitis, days))
                      }
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-teal-500/20 hover:text-teal-300 text-slate-200 border border-white/10 font-bold transition"
                    >
                      +{days} Gün
                    </button>
                  ))}
                </div>
              </div>

              {/* Paket Bitiş Tarihi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Paket Bitiş Tarihi</label>
                  <div className="flex gap-1.5">
                    <input
                      type="date"
                      value={firmaFormPaketBitis}
                      onChange={(e) => setFirmaFormPaketBitis(e.target.value)}
                      className="flex-1 bg-[#0b1322] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
                    />
                    {firmaFormPaketBitis && (
                      <button
                        type="button"
                        onClick={() => setFirmaFormPaketBitis('')}
                        className="px-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-white"
                        title="Temizle"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Deneme Bitiş Tarihi</label>
                  <div className="flex gap-1.5">
                    <input
                      type="date"
                      value={firmaFormDenemeBitis}
                      onChange={(e) => setFirmaFormDenemeBitis(e.target.value)}
                      className="flex-1 bg-[#0b1322] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
                    />
                    {firmaFormDenemeBitis && (
                      <button
                        type="button"
                        onClick={() => setFirmaFormDenemeBitis('')}
                        className="px-2.5 rounded-xl bg-white/5 text-slate-400 hover:text-white"
                        title="Temizle"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setEditingFirma(null)}
                  className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-bold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingId === editingFirma.id}
                  data-testid="save_firma_package_button"
                  className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-slate-950 font-extrabold flex items-center gap-1.5 shadow-lg"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingId === editingFirma.id ? 'Kaydediliyor...' : 'Kaydet & Uygula'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PAKET EKLE / DÜZENLE */}
      {showPaketModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
          <div className="bg-[#111c2e] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden my-auto">
            <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-black/20">
              <h3 className="text-sm sm:text-base font-extrabold text-white">
                {editingPaket ? 'Paketi Düzenle' : 'Yeni Abonelik Paketi Ekle'}
              </h3>
              <button
                type="button"
                onClick={() => setShowPaketModal(false)}
                className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePaket} className="p-4 sm:p-5 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Paket Adı *</label>
                <input
                  type="text"
                  required
                  value={paketAd}
                  onChange={(e) => setPaketAd(e.target.value)}
                  data-testid="paket_ad_input"
                  placeholder="Örn: Aylık Standart / Yıllık Pro"
                  className="w-full bg-[#0b1322] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-teal-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">Süre (Gün) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={paketSureGun}
                    onChange={(e) => setPaketSureGun(e.target.value)}
                    data-testid="paket_sure_input"
                    placeholder="30"
                    className="w-full bg-[#0b1322] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-teal-400"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-300 mb-1">Fiyat (₺) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={paketFiyat}
                    onChange={(e) => setPaketFiyat(e.target.value)}
                    data-testid="paket_fiyat_input"
                    placeholder="499.00"
                    className="w-full bg-[#0b1322] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">
                  Ek Plasiyer Ücreti (₺)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={paketEkPlasiyer}
                  onChange={(e) => setPaketEkPlasiyer(e.target.value)}
                  data-testid="paket_ek_plasiyer_input"
                  placeholder="0"
                  className="w-full bg-[#0b1322] border border-slate-700 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-teal-400"
                />
              </div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#0b1322] border border-slate-700/70 cursor-pointer">
                <div>
                  <div className="font-bold text-white">Paket Satışta (Aktif)</div>
                  <div className="text-[11px] text-slate-400">
                    Pasif paketler müşterilerin satın alma ekranında gizlenir.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={paketAktif}
                  onChange={(e) => setPaketAktif(e.target.checked)}
                  className="w-5 h-5 accent-teal-400 rounded"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowPaketModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-bold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={savingId !== null}
                  data-testid="save_paket_button"
                  className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-slate-950 font-extrabold flex items-center gap-1.5 shadow-lg"
                >
                  <Save className="w-4 h-4" />
                  <span>{editingPaket ? 'Paketi Güncelle' : 'Paketi Oluştur'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
