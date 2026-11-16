import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FileText,
  Landmark,
  Minus,
  Plus,
  Upload,
  UserPlus,
  Users,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/formatters';
import { Ayar } from '../../types/database';
import {
  EK_PLASIYER_FIYAT,
  calculateStandaloneEkPlasiyerAmount,
  formatStandaloneEkPlasiyerNote,
} from '../../lib/packageEntitlements';
import { formatTlInteger } from '../../lib/packageCatalog';

interface StandaloneEkPlasiyerPanelProps {
  compact?: boolean;
  initialExpanded?: boolean;
  ibanProp?: string;
  hesapSahibiProp?: string;
  onSubmitted?: () => void;
}

const QUICK_QUANTITIES = [1, 2, 3, 5];

export const StandaloneEkPlasiyerPanel: React.FC<StandaloneEkPlasiyerPanelProps> = ({
  compact = false,
  initialExpanded = false,
  ibanProp,
  hesapSahibiProp,
  onSubmitted,
}) => {
  const { firma, profile, entitlements, periodInfo } = useAuth();
  const [adet, setAdet] = useState<number>(1);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState<boolean>(initialExpanded);
  const [iban, setIban] = useState<string>(ibanProp || '');
  const [hesapSahibi, setHesapSahibi] = useState<string>(hesapSahibiProp || '');
  const [fallbackPaketId, setFallbackPaketId] = useState<string | null>(firma?.paket_id ?? null);
  const [copiedIban, setCopiedIban] = useState(false);
  const [dosya, setDosya] = useState<File | null>(null);
  const [aciklama, setAciklama] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (initialExpanded) {
      setIsCheckoutOpen(true);
    }
  }, [initialExpanded]);

  useEffect(() => {
    if (ibanProp) setIban(ibanProp);
    if (hesapSahibiProp) setHesapSahibi(hesapSahibiProp);
  }, [ibanProp, hesapSahibiProp]);

  useEffect(() => {
    if (firma?.paket_id) {
      setFallbackPaketId(firma.paket_id);
    }
  }, [firma?.paket_id]);

  useEffect(() => {
    let cancelled = false;
    const loadBankAndPaketRef = async () => {
      try {
        if (!ibanProp || !hesapSahibiProp) {
          const { data: ayarData } = await supabase.from('ayarlar').select('*');
          if (!cancelled && ayarData) {
            (ayarData as Ayar[]).forEach((row) => {
              if (row.anahtar === 'iban' && !ibanProp) setIban(row.deger);
              if (row.anahtar === 'hesap_sahibi' && !hesapSahibiProp) setHesapSahibi(row.deger);
            });
          }
        }
        if (!firma?.paket_id) {
          const { data: paketRows } = await supabase
            .from('paketler')
            .select('id')
            .eq('aktif', true)
            .order('fiyat', { ascending: true })
            .limit(1);
          if (!cancelled && paketRows && paketRows.length > 0) {
            setFallbackPaketId(paketRows[0].id);
          }
        }
      } catch {
        // sessiz geç
      }
    };
    loadBankAndPaketRef();
    return () => {
      cancelled = true;
    };
  }, [firma?.paket_id, ibanProp, hesapSahibiProp]);

  if (!firma?.id) return null;

  const totalAmount = calculateStandaloneEkPlasiyerAmount(adet, EK_PLASIYER_FIYAT);
  const newTotalPlasiyerLimit = entitlements.totalPlasiyerLimit + adet;
  const isAna = profile?.rol === 'ana';

  const handleCopyIban = () => {
    if (!iban) return;
    navigator.clipboard.writeText(iban);
    setCopiedIban(true);
    setTimeout(() => setCopiedIban(false), 2000);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleSubmit = async () => {
    if (!firma?.id) return;
    if (!isAna) {
      setErrorMsg('Ek plasiyer satın alma bildirimi yalnızca firmanın Ana Hesabı tarafından yapılabilir.');
      return;
    }
    if (!dosya) {
      setErrorMsg('Lütfen dekont dosyasını seçin.');
      return;
    }
    if (dosya.size > 5 * 1024 * 1024) {
      setErrorMsg('Dosya 5 MB’tan küçük olmalı.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(dosya.type)) {
      setErrorMsg('Yalnızca JPG, PNG veya PDF yükleyebilirsiniz.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');

    const ext = dosya.type === 'application/pdf' ? 'pdf' : dosya.type === 'image/png' ? 'png' : 'jpg';
    const yol = `${firma.id}/ek-plasiyer-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('dekontlar').upload(yol, dosya, { contentType: dosya.type });

    if (up.error) {
      setSubmitting(false);
      setErrorMsg('Dekont yüklenemedi: ' + up.error.message);
      return;
    }

    const note = formatStandaloneEkPlasiyerNote(adet, aciklama, entitlements.sourceLabel);

    const insertPayload: Record<string, unknown> = {
      firma_id: firma.id,
      tutar: totalAmount,
      dekont_url: yol,
      durum: 'bekliyor',
      tarih: new Date().toISOString(),
      not: note,
    };

    if (firma.paket_id || fallbackPaketId) {
      insertPayload.paket_id = firma.paket_id || fallbackPaketId;
    }

    const ins = await supabase.from('odeme_bildirimleri').insert(insertPayload);
    setSubmitting(false);

    if (ins.error) {
      setErrorMsg('Bildirim kaydedilemedi: ' + ins.error.message);
      return;
    }

    setDosya(null);
    setAciklama('');
    setIsCheckoutOpen(false);
    setSuccessMsg(
      `${adet} ek plasiyer (${formatCurrency(totalAmount)}) için ödeme bildiriminiz alındı. Onaylandığında mevcut paket süreniz değişmeden plasiyer kotanız +${adet} artırılacaktır.`
    );
    if (onSubmitted) {
      onSubmitted();
    }
  };

  return (
    <section
      id="standalone_ek_plasiyer_section"
      data-testid="standalone_ek_plasiyer_panel"
      className={`rounded-2xl border border-teal-400/30 bg-gradient-to-br from-[#111820] via-[#111820] to-teal-950/20 shadow-[0_0_25px_rgba(45,212,191,0.07)] ${
        compact ? 'p-4 space-y-3.5' : 'p-5 sm:p-6 mb-6 space-y-4'
      }`}
    >
      {/* ÜST BAŞLIK & FİYAT ÖZETİ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-300 flex items-center justify-center shrink-0">
              <UserPlus className="w-4 h-4" />
            </div>
            <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
              Mevcut Pakete Ek Plasiyer Satın Al
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-400/20 text-teal-300 border border-teal-400/30">
              +{formatTlInteger(EK_PLASIYER_FIYAT)} / Adet
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-gray-300 leading-relaxed">
            Mevcut paketinizin bitiş süresi değişmez. 1 plasiyer <strong className="text-white">100 TL</strong>, 2 plasiyer <strong className="text-white">200 TL</strong> sabit ücretle eklenir; eklenen plasiyerler paket özelliklerinizi ve kalan sürenizi (
            <strong className="text-teal-300">
              {periodInfo.status === 'unlimited' ? 'Sınırsız' : `${periodInfo.kalanGun} gün`}
            </strong>
            ) otomatik kullanır.
          </p>
        </div>

        <div className="flex items-center justify-between md:justify-end gap-3 bg-black/35 border border-white/[0.08] rounded-xl px-4 py-2.5 shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              Sadece Ek Plasiyer Tutarı
            </div>
            <div
              data-testid="standalone_ek_total_amount"
              className="text-xl sm:text-2xl font-black text-teal-300 leading-tight"
            >
              {formatCurrency(totalAmount)}
            </div>
          </div>
          <div className="text-right border-l border-white/10 pl-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
              Yeni Kota
            </div>
            <div className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-1 mt-0.5">
              <Users className="w-3.5 h-3.5 text-teal-400" />
              <span>{newTotalPlasiyerLimit} Plasiyer</span>
            </div>
          </div>
        </div>
      </div>

      {/* ADET SEÇİMİ: HIZLI BUTONLAR + STEPPER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-black/30 border border-white/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_QUANTITIES.map((qty) => {
            const isSelected = adet === qty;
            return (
              <button
                key={qty}
                type="button"
                data-testid={`standalone_ek_quick_${qty}`}
                onClick={() => {
                  setAdet(qty);
                  setSuccessMsg('');
                }}
                className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                  isSelected
                    ? 'bg-teal-400 text-[#0a0e13] border-teal-300 shadow'
                    : 'bg-white/[0.04] hover:bg-white/[0.09] text-gray-200 border-white/10'
                }`}
              >
                +{qty} Plasiyer · {formatTlInteger(qty * EK_PLASIYER_FIYAT)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 bg-[#0a0e13] border border-white/10 rounded-xl p-1.5 shrink-0">
          <button
            type="button"
            data-testid="standalone_ek_minus_btn"
            onClick={() => setAdet((prev) => Math.max(1, prev - 1))}
            disabled={adet <= 1}
            aria-label="Alınacak ek plasiyer azalt"
            className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/15 disabled:opacity-40 text-white flex items-center justify-center transition"
          >
            <Minus className="w-4 h-4" />
          </button>
          <div className="min-w-[82px] text-center px-2">
            <div
              data-testid="standalone_ek_count_value"
              className="text-base font-black text-teal-300 leading-tight"
            >
              +{adet}
            </div>
            <div className="text-[10px] text-gray-400 font-semibold">Ek Plasiyer</div>
          </div>
          <button
            type="button"
            data-testid="standalone_ek_plus_btn"
            onClick={() => setAdet((prev) => Math.min(50, prev + 1))}
            aria-label="Alınacak ek plasiyer artır"
            className="w-10 h-10 rounded-lg bg-teal-400 hover:bg-teal-300 text-[#0a0e13] flex items-center justify-center font-bold transition"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KOTA ÖNİZLEME & ÖDEME AÇMA BUTONU */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="text-gray-300">
          Mevcut kota:{' '}
          <strong className="text-white">{entitlements.totalPlasiyerLimit} Plasiyer</strong>{' '}
          <span className="text-gray-400">
            ({entitlements.includedPlasiyerLimit} Dahil + {entitlements.ekPlasiyerSayisi} Ek)
          </span>{' '}
          → Onay sonrası:{' '}
          <strong className="text-teal-300">{newTotalPlasiyerLimit} Plasiyer</strong>
        </div>

        <button
          type="button"
          data-testid="standalone_ek_toggle_checkout_btn"
          onClick={() => {
            setIsCheckoutOpen((prev) => !prev);
            setErrorMsg('');
          }}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg transition shrink-0"
        >
          <Upload className="w-4 h-4" />
          <span>
            {isCheckoutOpen
              ? 'Ödeme Formunu Gizle'
              : `Dekont Yükle & Satın Al (${formatCurrency(totalAmount)})`}
          </span>
          {isCheckoutOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {successMsg && (
        <div
          data-testid="standalone_ek_success_banner"
          className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-start gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* HAVALE / EFT & DEKONT YÜKLEME BÖLÜMÜ */}
      {isCheckoutOpen && (
        <div className="pt-3 border-t border-white/[0.08] space-y-4">
          {!isAna && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Ek plasiyer ödeme bildirimi yalnızca firmanın Ana Hesabı tarafından gönderilebilir.</span>
            </div>
          )}

          {/* IBAN & HESAP BİLGİLERİ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 uppercase font-semibold">
                <Landmark className="w-3.5 h-3.5 text-teal-400" />
                <span>Hesap Sahibi</span>
              </div>
              <div className="text-xs sm:text-sm font-bold text-white mt-1">
                {hesapSahibi || 'Tahsilatım Yazılım A.Ş.'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] text-gray-400 uppercase font-semibold">
                  IBAN Numarası ({formatCurrency(totalAmount)} Havale/EFT)
                </div>
                <div className="text-xs font-mono font-bold text-teal-400 mt-1 tracking-wider break-all">
                  {iban || 'TR00 0000 0000 0000 0000 0000 00'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyIban}
                title="IBAN Kopyala"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-300 hover:text-teal-400 hover:bg-teal-500/10 rounded-xl transition shrink-0"
              >
                {copiedIban ? <CheckCircle2 className="w-5 h-5 text-teal-400" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* DEKONT YÜKLEME */}
          <label className="block cursor-pointer">
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              data-testid="standalone_ek_file_input"
              onChange={(e) => {
                setDosya(e.target.files?.[0] ?? null);
                setErrorMsg('');
              }}
              className="sr-only"
            />
            <div className="min-h-[88px] rounded-2xl border-2 border-dashed border-teal-400/30 hover:border-teal-400/60 bg-teal-400/[0.03] hover:bg-teal-400/[0.06] p-4 flex flex-col items-center justify-center text-center transition">
              {dosya ? (
                <div className="flex items-center gap-3 text-left w-full max-w-md justify-between bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-5 h-5 text-teal-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{dosya.name}</div>
                      <div className="text-[11px] text-gray-400">{formatFileSize(dosya.size)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setDosya(null);
                    }}
                    aria-label="Seçili dekont dosyasını kaldır"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-5 h-5 text-teal-400 mb-1" />
                  <span className="text-xs font-bold text-white">
                    {formatCurrency(totalAmount)} Ek Plasiyer Dekontunu Seçin
                  </span>
                  <span className="text-[11px] text-gray-400 mt-0.5">
                    JPG, PNG veya PDF (en fazla 5 MB)
                  </span>
                </>
              )}
            </div>
          </label>

          {/* AÇIKLAMA */}
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Açıklama / Not (İsteğe Bağlı)
            </label>
            <input
              type="text"
              data-testid="standalone_ek_note_input"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              placeholder="Örn: 2 ek plasiyer için havale gönderildi"
              className="w-full min-h-[44px] rounded-xl bg-[#0a0e13] border border-white/10 px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-teal-400"
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              disabled={submitting || !isAna}
              onClick={handleSubmit}
              data-testid="standalone_ek_submit_btn"
              className="flex-1 min-h-[46px] px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-[#0a0e13] text-xs font-extrabold shadow-lg flex items-center justify-center gap-2 transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {submitting
                  ? 'Gönderiliyor…'
                  : `Ek Plasiyer Ödeme Bildirimini Gönder (${formatCurrency(totalAmount)})`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCheckoutOpen(false);
                setErrorMsg('');
              }}
              className="min-h-[46px] px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold transition"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
