import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import {
  createPlasiyer,
  fetchPlasiyerler,
  togglePlasiyerAktif,
  deletePlasiyer,
  PlasiyerItem,
  PLASIYER_RLS_SQL,
} from '../../lib/plasiyerService';
import { deleteFirmaAndAccounts } from '../../lib/accountDeleteHelper';
import {
  getPosConfig,
  savePosConfig,
  PosConfig,
  validatePosConfig,
  generatePaymentLink,
} from '../../lib/posService';
import {
  X,
  Building2,
  Users,
  UserPlus,
  Mail,
  Lock,
  Phone,
  User,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
  Shield,
  CreditCard,
  RefreshCw,
  Power,
  Upload,
  Image as ImageIcon,
  Trash2,
  Globe,
  Share2,
  LogOut,
  MapPin,
  Save,
  Code2,
} from 'lucide-react';
import { openWhatsApp } from '../../lib/linkHelper';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'firma' | 'plasiyer' | 'pos';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'plasiyer',
}) => {
  const { profile, firma, user, isSuperAdmin, periodInfo, refreshProfileAndFirma, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'firma' | 'plasiyer' | 'pos'>(initialTab);

  // Logo Yükleme Durumu
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sanal POS Form Durumu
  const [posConfig, setPosConfig] = useState<PosConfig>(() => getPosConfig(firma?.id));
  const [posMsg, setPosMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [posSaving, setPosSaving] = useState(false);
  const [showPosLinkModal, setShowPosLinkModal] = useState(false);
  const [testLinkTutar, setTestLinkTutar] = useState('500');
  const [generatedLinkInfo, setGeneratedLinkInfo] = useState<{ url: string; message: string; ref: string } | null>(null);

  // Plasiyer Liste Durumu
  const [plasiyerler, setPlasiyerler] = useState<PlasiyerItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Yeni Plasiyer Form Durumu
  const [showAddForm, setShowAddForm] = useState(false);
  const [adSoyad, setAdSoyad] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [telefon, setTelefon] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formWarning, setFormWarning] = useState<string | null>(null);
  const [showRlsSqlHelp, setShowRlsSqlHelp] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Firma Bilgileri Düzenleme Durumu
  const [firmaUnvan, setFirmaUnvan] = useState(firma?.unvan || '');
  const [firmaVergiNo, setFirmaVergiNo] = useState(firma?.vergi_no || '');
  const [firmaVergiDairesi, setFirmaVergiDairesi] = useState(firma?.vergi_dairesi || '');
  const [firmaTelefon, setFirmaTelefon] = useState(firma?.telefon || '');
  const [firmaEmail, setFirmaEmail] = useState(firma?.email || '');
  const [firmaAdres, setFirmaAdres] = useState(firma?.adres || '');
  const [firmaWeb, setFirmaWeb] = useState(firma?.web || '');
  const [firmaSaving, setFirmaSaving] = useState(false);
  const [firmaMsg, setFirmaMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingPlasiyerId, setDeletingPlasiyerId] = useState<string | null>(null);
  const [deletingOwnFirma, setDeletingOwnFirma] = useState(false);

  // Kopyalama bildirim durumu
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const isAnaHesap = profile?.rol === 'ana' || isSuperAdmin;

  // Modal açıldığında veya firma değiştiğinde aktif sekme, firma formu ve POS konfigürasyonunu senkronize et
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
    if (firma?.id) {
      setPosConfig(getPosConfig(firma.id));
    }
    if (isOpen && firma) {
      setFirmaUnvan(firma.unvan || '');
      setFirmaVergiNo(firma.vergi_no || '');
      setFirmaVergiDairesi(firma.vergi_dairesi || '');
      setFirmaTelefon(firma.telefon || '');
      setFirmaEmail(firma.email || '');
      setFirmaAdres(firma.adres || '');
      setFirmaWeb(firma.web || '');
      setFirmaMsg(null);
    }
  }, [isOpen, firma]);

  const loadPlasiyerler = async () => {
    if (!firma?.id) return;
    try {
      setLoadingList(true);
      setListError(null);
      const res = await fetchPlasiyerler(firma.id);
      if (res.error) {
        setListError(res.error);
      } else {
        setPlasiyerler(res.plasiyerler);
      }
    } catch {
      setListError('Plasiyer listesi yüklenemedi.');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'plasiyer' && firma?.id) {
      loadPlasiyerler();
    }
  }, [isOpen, activeTab, firma?.id]);

  if (!isOpen) return null;

  const handleCreatePlasiyerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firma?.id || !profile?.id) return;

    try {
      setSaving(true);
      setFormError(null);
      setFormSuccess(null);
      setFormWarning(null);

      const createdAdSoyad = adSoyad.trim();
      const createdEmail = email.trim().toLowerCase();

      const res = await createPlasiyer({
        ad_soyad: createdAdSoyad,
        email: createdEmail,
        password,
        telefon,
        firma_id: firma.id,
        ana_hesap_id: profile.id,
        firma_unvan: firma.unvan,
      });

      if (!res.success) {
        setFormError(res.error || 'Plasiyer kaydı başarısız oldu.');
        if (res.rlsWarning) {
          setShowRlsSqlHelp(true);
        }
      } else {
        if (res.warning) {
          setFormWarning(res.warning);
          setShowRlsSqlHelp(true);
        } else {
          setFormSuccess(
            `Plasiyer "${createdAdSoyad}" başarıyla oluşturuldu ve firmanıza bağlandı! Belirlediğiniz e-posta (${createdEmail}) ve şifre ile giriş yapabilir.`
          );
        }
        // Formu temizle
        setAdSoyad('');
        setEmail('');
        setPassword('');
        setTelefon('');
        // Listeyi tazele
        await loadPlasiyerler();
      }
    } catch {
      setFormError('Beklenmeyen bir hata oluştu.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAktif = async (p: PlasiyerItem) => {
    const yeniDurum = !p.aktif;
    const res = await togglePlasiyerAktif(p.id, yeniDurum);
    if (res.success) {
      setPlasiyerler((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, aktif: yeniDurum } : item))
      );
    } else {
      alert(res.error || 'Durum güncellenemedi.');
    }
  };

  const handleDeletePlasiyer = async (p: PlasiyerItem) => {
    if (
      !window.confirm(
        `"${p.ad_soyad}" (${p.email}) plasiyer hesabını kalıcı olarak silmek istediğinize emin misiniz?\n\nKestiği makbuzlar firmada korunur ancak plasiyer hesabı silinir.`
      )
    ) {
      return;
    }

    try {
      setDeletingPlasiyerId(p.id);
      const res = await deletePlasiyer(p.id, profile?.id);
      if (res.success) {
        setPlasiyerler((prev) => prev.filter((item) => item.id !== p.id));
        setFormSuccess(`Plasiyer "${p.ad_soyad}" başarıyla silindi.`);
      } else {
        setFormError(res.error || 'Plasiyer silinemedi.');
        if (res.rlsWarning) {
          setShowRlsSqlHelp(true);
        }
      }
    } finally {
      setDeletingPlasiyerId(null);
    }
  };

  const handleDeleteOwnFirma = async () => {
    if (!firma?.id) return;
    if (
      !window.confirm(
        `DİKKAT: "${firma.unvan}" firmasını ve firmaya bağlı TÜM kullanıcı hesaplarını, carileri, makbuzları ve kasa kayıtlarını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!`
      )
    ) {
      return;
    }

    const typed = window.prompt('Onaylamak için firma ünvanını veya SİL yazınız:');
    if (!typed || (typed.trim().toUpperCase() !== 'SİL' && typed.trim().toUpperCase() !== 'SIL' && typed.trim() !== firma.unvan.trim())) {
      return;
    }

    try {
      setDeletingOwnFirma(true);
      setFirmaMsg(null);
      const res = await deleteFirmaAndAccounts(firma.id, profile?.id);
      if (!res.success) {
        setFirmaMsg({
          type: 'error',
          text: res.error || 'Hesap ve firma silinemedi.',
        });
        return;
      }
      onClose();
      await signOut();
    } finally {
      setDeletingOwnFirma(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmail(id);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  // Logo Yükleme İşlemi (Canvas ile optimize edip base64 kaydeder)
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firma?.id) return;

    if (!file.type.startsWith('image/')) {
      setLogoMsg({ type: 'error', text: 'Lütfen geçerli bir resim dosyası seçiniz (PNG, JPG, WEBP).' });
      return;
    }

    try {
      setLogoUploading(true);
      setLogoMsg(null);

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.onload = async () => {
          // Canvas üzerinde ölçekle (Max genişlik 300px, orantılı yükseklik)
          const maxWidth = 300;
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setLogoMsg({ type: 'error', text: 'Görsel işlenemedi.' });
            setLogoUploading(false);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const base64Data = canvas.toDataURL('image/png', 0.9);

          // Supabase firmalar tablosunu güncelle
          const { error: updateErr } = await supabase
            .from('firmalar')
            .update({ logo_data: base64Data })
            .eq('id', firma.id);

          if (updateErr) {
            setLogoMsg({ type: 'error', text: 'Logo veritabanına kaydedilemedi.' });
          } else {
            setLogoMsg({ type: 'success', text: 'Firma logonuz başarıyla kaydedildi!' });
            await refreshProfileAndFirma();
          }
          setLogoUploading(false);
        };
        img.onerror = () => {
          setLogoMsg({ type: 'error', text: 'Görsel yüklenemedi.' });
          setLogoUploading(false);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } catch {
      setLogoMsg({ type: 'error', text: 'Görsel yüklenirken bir hata oluştu.' });
      setLogoUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!firma?.id) return;
    if (!window.confirm('Firma logosunu makbuzlardan kaldırmak istediğinize emin misiniz?')) return;

    try {
      setLogoUploading(true);
      setLogoMsg(null);
      const { error: err } = await supabase
        .from('firmalar')
        .update({ logo_data: null })
        .eq('id', firma.id);

      if (err) {
        setLogoMsg({ type: 'error', text: 'Logo kaldırılamadı.' });
      } else {
        setLogoMsg({ type: 'success', text: 'Firma logosu kaldırıldı.' });
        await refreshProfileAndFirma();
      }
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSaveFirmaInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firma?.id) return;

    const cleanUnvan = firmaUnvan.trim();
    const cleanVergiNo = firmaVergiNo.trim();
    if (!cleanUnvan) {
      setFirmaMsg({ type: 'error', text: 'Firma ünvanı boş bırakılamaz.' });
      return;
    }
    if (!cleanVergiNo) {
      setFirmaMsg({ type: 'error', text: 'Vergi No / TCKN boş bırakılamaz.' });
      return;
    }

    try {
      setFirmaSaving(true);
      setFirmaMsg(null);

      const { error } = await supabase
        .from('firmalar')
        .update({
          unvan: cleanUnvan,
          vergi_no: cleanVergiNo,
          vergi_dairesi: firmaVergiDairesi.trim() || null,
          telefon: firmaTelefon.trim() || null,
          email: firmaEmail.trim() || null,
          adres: firmaAdres.trim() || null,
          web: firmaWeb.trim() || null,
        })
        .eq('id', firma.id);

      if (error) {
        setFirmaMsg({
          type: 'error',
          text: handleSupabaseError(error, 'Firma bilgileri güncellenemedi.', {
            isFirmaUnlimited: Boolean(firma.sinirsiz),
          }),
        });
        return;
      }

      await refreshProfileAndFirma();
      setFirmaMsg({ type: 'success', text: 'Firma bilgileriniz başarıyla güncellendi!' });
    } catch (err) {
      setFirmaMsg({
        type: 'error',
        text: handleSupabaseError(err, 'Firma bilgileri güncellenirken beklenmeyen bir hata oluştu.'),
      });
    } finally {
      setFirmaSaving(false);
    }
  };

  // Sanal POS Ayarları Kaydetme
  const handleSavePosSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPosMsg(null);
    setPosSaving(true);

    try {
      const validation = validatePosConfig(posConfig);
      if (!validation.valid) {
        setPosMsg({ type: 'error', text: validation.message || 'Lütfen eksik alanları doldurunuz.' });
        setPosSaving(false);
        return;
      }

      savePosConfig(posConfig, firma?.id);
      setPosMsg({
        type: 'success',
        text: posConfig.enabled && posConfig.provider !== 'none'
          ? `${posConfig.provider === 'iyzico' ? 'iyzico' : 'PayTR'} Sanal POS entegrasyonu başarıyla kaydedildi ve aktif edildi.`
          : 'Sanal POS ayarları kaydedildi (Pasif).',
      });
    } catch {
      setPosMsg({ type: 'error', text: 'Ayarlar kaydedilirken hata oluştu.' });
    } finally {
      setPosSaving(false);
    }
  };

  const handleGenerateTestPaymentLink = () => {
    const num = parseFloat(testLinkTutar.replace(',', '.'));
    if (isNaN(num) || num <= 0) {
      alert('Lütfen geçerli bir tutar giriniz.');
      return;
    }
    const result = generatePaymentLink({
      amount: num,
      customerName: 'Örnek Müşteri Ltd.',
      config: posConfig,
    });
    setGeneratedLinkInfo({
      url: result.url,
      message: result.message,
      ref: result.referenceNo,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-[#111820] border border-white/10 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* MODAL BAŞLIK */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center shadow-lg">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
                Profil ve Firma Ayarları
              </h2>
              <p className="text-xs text-gray-400">
                {firma?.unvan || 'Firma'} • Yetkili: {profile?.ad_soyad || user?.email}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* TABLAR */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-white/[0.06] bg-black/10 overflow-x-auto">
          <button
            onClick={() => setActiveTab('plasiyer')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'plasiyer'
                ? 'border-teal-400 text-teal-400 bg-teal-500/5'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Plasiyer Yönetimi</span>
            {plasiyerler.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-teal-400 text-black font-extrabold">
                {plasiyerler.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('firma')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'firma'
                ? 'border-teal-400 text-teal-400 bg-teal-500/5'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Firma & Logo & Lisans</span>
          </button>

          <button
            onClick={() => setActiveTab('pos')}
            className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-xs font-bold transition whitespace-nowrap ${
              activeTab === 'pos'
                ? 'border-teal-400 text-teal-400 bg-teal-500/5'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>Sanal POS (iyzico / PayTR)</span>
            {posConfig.enabled && posConfig.provider !== 'none' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* İÇERİK ALANI */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* TAB 1: PLASİYER YÖNETİMİ */}
          {activeTab === 'plasiyer' && (
            <div className="space-y-6">
              {!isAnaHesap ? (
                <div className="p-6 text-center text-xs text-gray-400 bg-black/20 rounded-xl border border-white/5">
                  <Shield className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="font-semibold text-white">Yetkisiz Erişim</p>
                  <p className="mt-1">
                    Plasiyer tanımlama ve yönetme yetkisi yalnızca firmanın Ana Hesabına aittir.
                  </p>
                </div>
              ) : (
                <>
                  {/* BİLGİLENDİRME & HIZLI EKLE BUTONU */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-teal-500/10 via-transparent to-black/20 border border-teal-500/20">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>Firma Plasiyerleri</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-400/20 text-teal-300 border border-teal-400/30">
                          {plasiyerler.filter((p) => p.aktif).length} Aktif / {plasiyerler.length} Toplam
                        </span>
                      </h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Plasiyerler sahada yalnızca kendi kestikleri makbuzları görür ve yeni cari ekleyebilir.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={loadPlasiyerler}
                        title="Listeyi Yenile"
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                      >
                        <RefreshCw className={`w-4 h-4 ${loadingList ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => {
                          setShowAddForm(!showAddForm);
                          setFormError(null);
                          setFormSuccess(null);
                        }}
                        className="px-3.5 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs flex items-center gap-1.5 shadow-[0_0_15px_rgba(45,212,191,0.25)] transition"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>{showAddForm ? 'Formu Kapat' : 'Yeni Plasiyer Tanımla'}</span>
                      </button>
                    </div>
                  </div>

                  {/* YENİ PLASİYER TANIMLAMA FORMU */}
                  {showAddForm && (
                    <div className="p-5 rounded-2xl bg-[#0a0e13] border border-teal-500/30 shadow-xl space-y-4">
                      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                        <div className="flex items-center gap-2 text-teal-400 font-bold text-xs uppercase tracking-wider">
                          <UserPlus className="w-4 h-4" />
                          <span>Yeni Plasiyer Kaydı (Mail ve Şifre)</span>
                        </div>
                        <span className="text-[11px] text-gray-400">
                          Ana hesabın oturumu etkilenmez
                        </span>
                      </div>

                      {formError && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{formError}</span>
                        </div>
                      )}

                      {formWarning && (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{formWarning}</span>
                        </div>
                      )}

                      {formSuccess && (
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{formSuccess}</span>
                        </div>
                      )}

                      <form onSubmit={handleCreatePlasiyerSubmit} className="space-y-4 text-xs">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          {/* Ad Soyad */}
                          <div>
                            <label className="block text-gray-300 font-semibold mb-1">
                              Plasiyer Adı Soyadı *
                            </label>
                            <div className="relative">
                              <User className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" />
                              <input
                                type="text"
                                required
                                value={adSoyad}
                                onChange={(e) => setAdSoyad(e.target.value)}
                                placeholder="Örn: Ahmet Yılmaz"
                                className="w-full bg-[#111820] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>
                          </div>

                          {/* Telefon */}
                          <div>
                            <label className="block text-gray-300 font-semibold mb-1">
                              Telefon Numarası
                            </label>
                            <div className="relative">
                              <Phone className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" />
                              <input
                                type="tel"
                                value={telefon}
                                onChange={(e) => setTelefon(e.target.value)}
                                placeholder="05XX XXX XX XX"
                                className="w-full bg-[#111820] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>
                          </div>

                          {/* E-posta (Giriş için) */}
                          <div>
                            <label className="block text-gray-300 font-semibold mb-1">
                              Giriş E-postası *
                            </label>
                            <div className="relative">
                              <Mail className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" />
                              <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="plasiyer@firma.com"
                                className="w-full bg-[#111820] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>
                            <span className="text-[10px] text-gray-400 mt-1 block">
                              Plasiyerin uygulamaya girerken kullanacağı mail adresi
                            </span>
                          </div>

                          {/* Şifre (Giriş için) */}
                          <div>
                            <label className="block text-gray-300 font-semibold mb-1">
                              Giriş Şifresi * (En az 6 karakter)
                            </label>
                            <div className="relative">
                              <Lock className="w-4 h-4 absolute left-3 top-2.5 text-gray-500" />
                              <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                minLength={6}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-[#111820] border border-white/10 rounded-xl pl-9 pr-9 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2.5 top-2.5 text-gray-400 hover:text-white"
                              >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            <span className="text-[10px] text-gray-400 mt-1 block">
                              Plasiyere ileteceğiniz geçici veya kalıcı giriş şifresi
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.05]">
                          <button
                            type="button"
                            onClick={() => setShowAddForm(false)}
                            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-semibold"
                          >
                            İptal
                          </button>
                          <button
                            type="submit"
                            disabled={saving}
                            className="px-5 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-[#0a0e13] font-bold flex items-center gap-2 shadow-lg"
                          >
                            {saving ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Kaydediliyor...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Plasiyeri Oluştur ve Yetkilendir</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* MEVCUT PLASİYERLER LİSTESİ */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Tanımlı Plasiyer Listesi
                    </h4>

                    {loadingList ? (
                      <div className="p-8 text-center text-xs text-gray-400 bg-black/20 rounded-xl border border-white/5">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-teal-400" />
                        <span>Plasiyerler listeleniyor...</span>
                      </div>
                    ) : listError ? (
                      <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                        {listError}
                      </div>
                    ) : plasiyerler.length === 0 ? (
                      <div className="p-8 text-center bg-black/20 rounded-xl border border-white/5 space-y-2">
                        <Users className="w-8 h-8 text-gray-600 mx-auto" />
                        <div className="text-xs font-semibold text-gray-300">
                          Henüz Tanımlı Plasiyer Bulunmuyor
                        </div>
                        <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
                          Saha personelinize veya satış ekibinize özel kullanıcı adı ve şifre vererek sadece kendi makbuzlarını takip etmelerini sağlayabilirsiniz.
                        </p>
                        <button
                          onClick={() => setShowAddForm(true)}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-400/10 text-teal-400 border border-teal-400/20 text-xs font-bold hover:bg-teal-400/20 transition"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>İlk Plasiyeri Tanımla</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {plasiyerler.map((p) => (
                          <div
                            key={p.id}
                            className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] hover:border-teal-400/30 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                                  p.aktif
                                    ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                                    : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                                }`}
                              >
                                {p.ad_soyad?.charAt(0).toUpperCase() || 'P'}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-white text-xs">
                                    {p.ad_soyad}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                      p.aktif
                                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                    }`}
                                  >
                                    {p.aktif ? 'Aktif' : 'Pasif'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1 flex-wrap">
                                  {/* E-posta & Kopyala */}
                                  <button
                                    onClick={() => handleCopy(p.email, p.id)}
                                    className="flex items-center gap-1 hover:text-teal-400 transition font-mono"
                                    title="E-postayı Kopyala"
                                  >
                                    <Mail className="w-3 h-3" />
                                    <span>{p.email}</span>
                                    {copiedEmail === p.id ? (
                                      <Check className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-gray-500" />
                                    )}
                                  </button>

                                  {p.telefon && (
                                    <>
                                      <span>•</span>
                                      <span className="flex items-center gap-1">
                                        <Phone className="w-3 h-3" />
                                        <span>{p.telefon}</span>
                                      </span>
                                    </>
                                  )}

                                  <span>•</span>
                                  <span className="text-gray-300">
                                    Kestiği Makbuz: <strong className="text-teal-400">{p.toplam_islem_sayisi || 0} Adet</strong>
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* DURUM TOGGLE & SİLME BUTONU */}
                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <button
                                onClick={() => handleToggleAktif(p)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border ${
                                  p.aktif
                                    ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                }`}
                              >
                                <Power className="w-3.5 h-3.5" />
                                <span>{p.aktif ? 'Hesabı Dondur' : 'Aktif Et'}</span>
                              </button>

                              <button
                                type="button"
                                disabled={deletingPlasiyerId === p.id}
                                data-testid={`delete_plasiyer_btn_${p.id}`}
                                onClick={() => handleDeletePlasiyer(p)}
                                title="Plasiyer Hesabını Sil"
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border bg-red-500/10 hover:bg-red-500/20 text-red-300 border-red-500/30 disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>{deletingPlasiyerId === p.id ? 'Siliniyor...' : 'Sil'}</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* VERİTABANI RLS / ONARIM YARDIMCISI */}
                  <div className="pt-2 border-t border-white/[0.06] space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowRlsSqlHelp((prev) => !prev)}
                      data-testid="toggle_plasiyer_rls_sql_btn"
                      className="text-[11px] font-semibold text-amber-300/90 hover:text-amber-200 flex items-center gap-1.5 transition"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      <span>
                        {showRlsSqlHelp
                          ? 'Plasiyer DB / RLS Onarım SQL Kodunu Gizle'
                          : 'Plasiyer listede görünmüyorsa veya carileri göremiyorsa DB / RLS Onarım SQL’i Göster'}
                      </span>
                    </button>

                    {showRlsSqlHelp && (
                      <div className="p-4 rounded-xl bg-[#0a0e13] border border-amber-500/30 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <p className="text-[11px] text-gray-300 leading-relaxed">
                            Daha önce eklediğiniz plasiyerler ana hesapta görünmüyorsa veya plasiyer girişinde cariler boş geliyorsa, bu SQL kodunu{' '}
                            <strong className="text-amber-300">Supabase Dashboard &gt; SQL Editor</strong> kısmında bir kez çalıştırın.
                          </p>
                          <button
                            type="button"
                            data-testid="copy_plasiyer_rls_sql_btn"
                            onClick={() => {
                              navigator.clipboard.writeText(PLASIYER_RLS_SQL);
                              setCopiedSql(true);
                              setTimeout(() => setCopiedSql(false), 2000);
                            }}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-[#0a0e13] font-bold text-[11px] flex items-center gap-1.5 transition"
                          >
                            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedSql ? 'SQL Kopyalandı' : 'SQL Kopyala'}</span>
                          </button>
                        </div>
                        <pre className="p-3 rounded-lg bg-black/50 border border-white/10 text-[10px] text-teal-300 overflow-x-auto max-h-48 font-mono leading-relaxed">
                          {PLASIYER_RLS_SQL}
                        </pre>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2: FİRMA VE LİSANS BİLGİLERİ */}
          {activeTab === 'firma' && (
            <div className="space-y-5 text-xs">
              <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                  <span className="font-bold text-white uppercase text-xs tracking-wider">
                    Firma Bilgileri
                  </span>
                  <span className="text-[11px] text-teal-400 font-semibold">
                    {isAnaHesap ? 'Ana Yönetici Hesabı' : 'Personel Hesabı'}
                  </span>
                </div>

                {/* Yetkili & Hesap Özeti */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-gray-300">
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase font-semibold">Yetkili Ad Soyad</span>
                    <span className="text-white font-semibold">{profile?.ad_soyad || '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px] uppercase font-semibold">Kayıtlı Giriş E-postası</span>
                    <span className="font-mono text-white">{profile?.email || user?.email || '-'}</span>
                  </div>
                </div>

                {firmaMsg && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      firmaMsg.type === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {firmaMsg.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{firmaMsg.text}</span>
                  </div>
                )}

                {isAnaHesap ? (
                  <form onSubmit={handleSaveFirmaInfo} className="space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-gray-300 font-semibold mb-1">
                          Firma Ünvanı *
                        </label>
                        <input
                          type="text"
                          required
                          data-testid="firma_unvan_input"
                          value={firmaUnvan}
                          onChange={(e) => setFirmaUnvan(e.target.value)}
                          placeholder="Örn: Örnek Ticaret Ltd. Şti."
                          className="w-full min-h-[44px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-gray-300 font-semibold mb-1">
                          Vergi No / TCKN *
                        </label>
                        <input
                          type="text"
                          required
                          data-testid="firma_vergi_no_input"
                          value={firmaVergiNo}
                          onChange={(e) => setFirmaVergiNo(e.target.value)}
                          placeholder="10 veya 11 haneli numara"
                          className="w-full min-h-[44px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-gray-300 font-semibold mb-1">
                          Vergi Dairesi
                        </label>
                        <input
                          type="text"
                          data-testid="firma_vergi_dairesi_input"
                          value={firmaVergiDairesi}
                          onChange={(e) => setFirmaVergiDairesi(e.target.value)}
                          placeholder="Örn: Kadıköy V.D."
                          className="w-full min-h-[44px] bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-gray-300 font-semibold mb-1">
                          Firma Telefonu
                        </label>
                        <div className="relative">
                          <Phone className="w-4 h-4 absolute left-3 top-3.5 text-gray-500" />
                          <input
                            type="tel"
                            data-testid="firma_telefon_input"
                            value={firmaTelefon}
                            onChange={(e) => setFirmaTelefon(e.target.value)}
                            placeholder="0212 XXX XX XX / 05XX..."
                            className="w-full min-h-[44px] bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-gray-300 font-semibold mb-1">
                          Firma E-posta (Makbuzlarda Görünür)
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 absolute left-3 top-3.5 text-gray-500" />
                          <input
                            type="email"
                            data-testid="firma_email_input"
                            value={firmaEmail}
                            onChange={(e) => setFirmaEmail(e.target.value)}
                            placeholder="info@firmaniz.com"
                            className="w-full min-h-[44px] bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-gray-300 font-semibold mb-1">
                          Web Sitesi
                        </label>
                        <div className="relative">
                          <Globe className="w-4 h-4 absolute left-3 top-3.5 text-gray-500" />
                          <input
                            type="text"
                            data-testid="firma_web_input"
                            value={firmaWeb}
                            onChange={(e) => setFirmaWeb(e.target.value)}
                            placeholder="www.firmaniz.com"
                            className="w-full min-h-[44px] bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-gray-300 font-semibold mb-1">
                          Firma Adresi
                        </label>
                        <div className="relative">
                          <MapPin className="w-4 h-4 absolute left-3 top-3 text-gray-500" />
                          <textarea
                            rows={2}
                            data-testid="firma_adres_input"
                            value={firmaAdres}
                            onChange={(e) => setFirmaAdres(e.target.value)}
                            placeholder="Mahalle, Cadde/Sokak, No, İlçe / İl"
                            className="w-full bg-[#0a0e13] border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-400 resize-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={firmaSaving}
                        data-testid="save_firma_info_btn"
                        className="min-h-[44px] px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-[#0a0e13] font-bold text-xs flex items-center gap-2 shadow-lg transition"
                      >
                        {firmaSaving ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Güncelleniyor...</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            <span>Bilgileri Güncelle</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-gray-300">
                    <div>
                      <span className="text-gray-500 block text-[10px] uppercase font-semibold">Firma Ünvanı</span>
                      <span className="font-bold text-white text-sm">{firma?.unvan || '-'}</span>
                    </div>

                    <div>
                      <span className="text-gray-500 block text-[10px] uppercase font-semibold">Vergi No / TCKN</span>
                      <span className="font-mono text-white">{firma?.vergi_no || '-'}</span>
                    </div>

                    {firma?.vergi_dairesi && (
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-semibold">Vergi Dairesi</span>
                        <span className="text-white">{firma.vergi_dairesi}</span>
                      </div>
                    )}

                    {firma?.telefon && (
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-semibold">Telefon</span>
                        <span className="text-white">{firma.telefon}</span>
                      </div>
                    )}

                    {firma?.email && (
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-semibold">Firma E-postası</span>
                        <span className="text-white">{firma.email}</span>
                      </div>
                    )}

                    {firma?.web && (
                      <div>
                        <span className="text-gray-500 block text-[10px] uppercase font-semibold">Web Sitesi</span>
                        <span className="text-white">{firma.web}</span>
                      </div>
                    )}

                    {firma?.adres && (
                      <div className="sm:col-span-2">
                        <span className="text-gray-500 block text-[10px] uppercase font-semibold">Adres</span>
                        <span className="text-white">{firma.adres}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* FİRMA LOGOSU ALANI */}
              <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-teal-400" />
                    <span className="font-bold text-white uppercase text-xs tracking-wider">
                      Firma Logosu (Makbuzlar İçin)
                    </span>
                  </div>
                  {firma?.logo_data && (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Aktif Logo Yüklü
                    </span>
                  )}
                </div>

                {logoMsg && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      logoMsg.type === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                    }`}
                  >
                    {logoMsg.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{logoMsg.text}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {/* Logo Önizleme */}
                  <div className="w-48 h-20 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center p-2 relative overflow-hidden bg-[radial-gradient(#ffffff15_1px,transparent_1px)] [background-size:8px_8px]">
                    {firma?.logo_data ? (
                      <img
                        src={firma.logo_data}
                        alt="Firma Logosu"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <div className="text-center text-gray-500 text-[11px] flex flex-col items-center gap-1">
                        <ImageIcon className="w-5 h-5 opacity-40" />
                        <span>Logo Yok</span>
                      </div>
                    )}
                  </div>

                  {/* Logo Eylemleri */}
                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Yükleyeceğiniz logo Tahsilat ve Tediye Makbuzlarınızın üst başlığında ve PDF çıktılarında otomatik olarak basılacaktır. PNG, JPG veya WEBP (önerilen: şeffaf arkaplan).
                    </p>

                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={logoUploading}
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3.5 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-50 shadow-md"
                      >
                        {logoUploading ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>İşleniyor...</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" />
                            <span>{firma?.logo_data ? 'Logoyu Değiştir' : 'Logo Yükle'}</span>
                          </>
                        )}
                      </button>

                      {firma?.logo_data && (
                        <button
                          type="button"
                          disabled={logoUploading}
                          onClick={handleRemoveLogo}
                          className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Kaldır</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* LİSANS & ABONELİK DURUMU */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-teal-500/10 via-transparent to-black/20 border border-teal-500/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-teal-400" />
                    <span className="font-bold text-white uppercase text-xs tracking-wider">
                      Lisans & Kullanım Durumu
                    </span>
                  </div>
                  {firma?.sinirsiz ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-400 text-black">
                      SINIRSIZ TAM ERİŞİM
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-black">
                      {periodInfo.kalanGun} GÜN KALDI
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400">
                  {firma?.sinirsiz
                    ? 'Bu firma hesabı için sınırsız kullanım ve süresiz erişim yetkisi tanımlanmıştır.'
                    : `Hesabınızın kullanım süresi devam etmektedir. Süre bitiminde paket satın alarak devam edebilirsiniz.`}
                </p>
              </div>

              {/* HESABI / FİRMAYI KALICI SİLME ALANI (ANA HESAP) */}
              {isAnaHesap && firma?.id && (
                <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/25 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-red-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Trash2 className="w-4 h-4" />
                        <span>Hesabı ve Firmayı Kalıcı Olarak Sil</span>
                      </h4>
                      <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                        Firmanızı ve bağlı kullanıcı hesaplarını, carileri ve tüm kayıtları kalıcı olarak siler. İşlem öncesi JSON yedeğinizi almanız önerilir.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={deletingOwnFirma}
                      data-testid="delete_own_account_btn"
                      onClick={handleDeleteOwnFirma}
                      className="shrink-0 min-h-[42px] px-4 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40 text-xs font-extrabold flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{deletingOwnFirma ? 'Siliniyor...' : 'Hesabı Sil'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SANAL POS AYARLARI (iyzico / PayTR) */}
          {activeTab === 'pos' && (
            <div className="space-y-6 text-xs">
              {!isAnaHesap ? (
                <div className="p-6 text-center text-xs text-gray-400 bg-black/20 rounded-xl border border-white/5">
                  <Shield className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                  <p className="font-semibold text-white">Yetkisiz Erişim</p>
                  <p className="mt-1">
                    Sanal POS ayarlarını yalnızca firmanın Ana Hesabı yönetebilir.
                  </p>
                </div>
              ) : (
                <>
                  {/* BİLGİ BAŞLIĞI */}
                  <div className="p-4 rounded-xl bg-gradient-to-r from-teal-500/10 via-transparent to-black/20 border border-teal-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <CreditCard className="w-5 h-5 text-teal-400" />
                      <h3 className="text-sm font-bold text-white">
                        Firma Özel Sanal POS Entegrasyonu
                      </h3>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Kendi anlaşmalı <strong>iyzico</strong> veya <strong>PayTR</strong> Sanal POS hesap bilgilerinizi girerek, tahsilat makbuzu keserken doğrudan karttan çekim yapabilir veya müşterinize WhatsApp üzerinden 3D Secure ödeme linki iletebilirsiniz.
                    </p>
                  </div>

                  {posMsg && (
                    <div
                      className={`p-3.5 rounded-xl text-xs flex items-center gap-2 ${
                        posMsg.type === 'success'
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                          : 'bg-red-500/10 border border-red-500/20 text-red-400'
                      }`}
                    >
                      {posMsg.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{posMsg.text}</span>
                    </div>
                  )}

                  <form onSubmit={handleSavePosSubmit} className="space-y-5">
                    {/* SAĞLAYICI SEÇİMİ */}
                    <div>
                      <label className="block text-gray-300 font-bold uppercase tracking-wider text-[11px] mb-2">
                        Sanal POS Altyapısı Sağlayıcısı *
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* iyzico */}
                        <button
                          type="button"
                          onClick={() => setPosConfig({ ...posConfig, provider: 'iyzico', enabled: true })}
                          className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                            posConfig.provider === 'iyzico'
                              ? 'bg-teal-500/15 border-teal-400 text-white shadow-lg'
                              : 'bg-black/30 border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-black text-sm text-teal-400">iyzico</span>
                            {posConfig.provider === 'iyzico' && (
                              <CheckCircle2 className="w-4 h-4 text-teal-400" />
                            )}
                          </div>
                          <span className="text-[11px] text-gray-400">
                            iyzico API Key & Secret Key ile 3D Secure ödeme ve link oluşturma
                          </span>
                        </button>

                        {/* PayTR */}
                        <button
                          type="button"
                          onClick={() => setPosConfig({ ...posConfig, provider: 'paytr', enabled: true })}
                          className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                            posConfig.provider === 'paytr'
                              ? 'bg-teal-500/15 border-teal-400 text-white shadow-lg'
                              : 'bg-black/30 border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-black text-sm text-teal-400">PayTR</span>
                            {posConfig.provider === 'paytr' && (
                              <CheckCircle2 className="w-4 h-4 text-teal-400" />
                            )}
                          </div>
                          <span className="text-[11px] text-gray-400">
                            PayTR Mağaza No, Parola & Secret Salt ile doğrudan entegrasyon
                          </span>
                        </button>

                        {/* Devre Dışı */}
                        <button
                          type="button"
                          onClick={() => setPosConfig({ ...posConfig, provider: 'none', enabled: false })}
                          className={`p-3.5 rounded-xl border text-left transition flex flex-col justify-between ${
                            posConfig.provider === 'none' || !posConfig.enabled
                              ? 'bg-white/10 border-white/30 text-white'
                              : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-xs text-gray-300">Devre Dışı</span>
                            {(posConfig.provider === 'none' || !posConfig.enabled) && (
                              <CheckCircle2 className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                          <span className="text-[11px] text-gray-500">
                            Sanal POS linki kapalı, sadece muhasebesel kart makbuzu kesilir
                          </span>
                        </button>
                      </div>
                    </div>

                    {posConfig.provider !== 'none' && (
                      <div className="p-4 rounded-xl bg-black/30 border border-white/[0.08] space-y-4">
                        {/* AKTİF / PASİF & TEST MODU */}
                        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-white/[0.06]">
                          <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={posConfig.enabled}
                              onChange={(e) => setPosConfig({ ...posConfig, enabled: e.target.checked })}
                              className="w-4 h-4 rounded bg-[#0a0e13] border-white/20 text-teal-400 focus:ring-teal-400"
                            />
                            <span className="text-xs font-bold text-white">Sanal POS ile Tahsilatı Aktif Et</span>
                          </label>

                          <label className="flex items-center gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={posConfig.testMode}
                              onChange={(e) => setPosConfig({ ...posConfig, testMode: e.target.checked })}
                              className="w-4 h-4 rounded bg-[#0a0e13] border-white/20 text-amber-400 focus:ring-amber-400"
                            />
                            <span className="text-xs font-semibold text-amber-300">
                              Test Modu (Sandbox / Simülasyon)
                            </span>
                          </label>
                        </div>

                        {/* iyzico ALANLARI */}
                        {posConfig.provider === 'iyzico' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">
                                iyzico API Key *
                              </label>
                              <input
                                type="text"
                                required
                                value={posConfig.iyzicoApiKey || ''}
                                onChange={(e) => setPosConfig({ ...posConfig, iyzicoApiKey: e.target.value })}
                                placeholder="sandbox-xxx veya canli-api-key"
                                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>

                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">
                                iyzico Secret Key *
                              </label>
                              <input
                                type="password"
                                required
                                value={posConfig.iyzicoSecretKey || ''}
                                onChange={(e) => setPosConfig({ ...posConfig, iyzicoSecretKey: e.target.value })}
                                placeholder="••••••••••••••••"
                                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-gray-300 font-semibold mb-1">
                                iyzico API URL / Ortam
                              </label>
                              <select
                                value={posConfig.iyzicoBaseUrl || 'https://sandbox-api.iyzipay.com'}
                                onChange={(e) => setPosConfig({ ...posConfig, iyzicoBaseUrl: e.target.value })}
                                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-teal-400"
                              >
                                <option value="https://sandbox-api.iyzipay.com">
                                  Sandbox (Test Ortamı) - https://sandbox-api.iyzipay.com
                                </option>
                                <option value="https://api.iyzipay.com">
                                  Canlı Üretim (Production) - https://api.iyzipay.com
                                </option>
                              </select>
                            </div>
                          </div>
                        )}

                        {/* PayTR ALANLARI */}
                        {posConfig.provider === 'paytr' && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">
                                PayTR Mağaza No (Merchant ID) *
                              </label>
                              <input
                                type="text"
                                required
                                value={posConfig.paytrMerchantId || ''}
                                onChange={(e) => setPosConfig({ ...posConfig, paytrMerchantId: e.target.value })}
                                placeholder="Örn: 123456"
                                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>

                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">
                                Mağaza Parolası (Merchant Key) *
                              </label>
                              <input
                                type="password"
                                required
                                value={posConfig.paytrMerchantKey || ''}
                                onChange={(e) => setPosConfig({ ...posConfig, paytrMerchantKey: e.target.value })}
                                placeholder="••••••••"
                                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>

                            <div>
                              <label className="block text-gray-300 font-semibold mb-1">
                                Mağaza Gizli Anahtar (Merchant Salt) *
                              </label>
                              <input
                                type="password"
                                required
                                value={posConfig.paytrMerchantSalt || ''}
                                onChange={(e) => setPosConfig({ ...posConfig, paytrMerchantSalt: e.target.value })}
                                placeholder="••••••••"
                                className="w-full bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-2 text-white font-mono placeholder-gray-500 focus:outline-none focus:border-teal-400"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                      {posConfig.enabled && posConfig.provider !== 'none' && (
                        <button
                          type="button"
                          onClick={() => setShowPosLinkModal(true)}
                          className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 font-semibold"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Örnek Ödeme Linki Testi Yap</span>
                        </button>
                      )}

                      <button
                        type="submit"
                        disabled={posSaving}
                        className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition ml-auto disabled:opacity-50"
                      >
                        {posSaving ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Kaydediliyor...</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            <span>POS Ayarlarını Kaydet</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {/* TEST ÖDEME LİNKİ MODALI */}
                  {showPosLinkModal && (
                    <div className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-teal-300 text-xs">
                          Test Ödeme Linki Oluşturucu ({posConfig.provider.toUpperCase()})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPosLinkModal(false);
                            setGeneratedLinkInfo(null);
                          }}
                          className="text-gray-400 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={testLinkTutar}
                          onChange={(e) => setTestLinkTutar(e.target.value)}
                          placeholder="Tutar (₺)"
                          className="w-32 bg-[#0a0e13] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleGenerateTestPaymentLink}
                          className="px-4 py-1.5 rounded-xl bg-teal-400 text-black font-bold text-xs hover:bg-teal-300 transition"
                        >
                          Link Oluştur
                        </button>
                      </div>

                      {generatedLinkInfo && (
                        <div className="p-3 rounded-lg bg-black/40 border border-white/10 text-xs space-y-2">
                          <div className="text-gray-300 text-[11px] whitespace-pre-line bg-[#0a0e13] p-2.5 rounded border border-white/5 font-mono">
                            {generatedLinkInfo.message}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(generatedLinkInfo.message);
                                alert('Mesaj ve ödeme linki kopyalandı!');
                              }}
                              className="px-3 py-1 rounded bg-teal-400/20 text-teal-300 text-xs font-bold hover:bg-teal-400/30 transition flex items-center gap-1"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>Metni ve Linki Kopyala</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                openWhatsApp(null, generatedLinkInfo.message);
                              }}
                              className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/30 transition flex items-center gap-1"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              <span>WhatsApp ile Gönder</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* MODAL ALT ÇUBUK */}
        <div className="p-4 border-t border-white/[0.08] bg-black/30 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Güvenli çıkış yapmak istediğinize emin misiniz?')) {
                onClose();
                signOut();
              }
            }}
            data-testid="settings_logout_button"
            className="px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 text-xs font-bold flex items-center gap-1.5 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Güvenli Çıkış Yap</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 text-xs font-bold transition"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
