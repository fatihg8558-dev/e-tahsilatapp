import React, { useState, useEffect } from 'react';
import {
  X,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Wallet,
  Copy,
  Check,
  Database,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import { GelirGider, GelirGiderTip, Kasa, KasaTur } from '../../types/database';
import {
  GELIR_KATEGORILERI,
  GIDER_KATEGORILERI,
  KASA_SETUP_SQL,
  KASA_TUR_LABELS,
} from '../../lib/kasaSql';

export async function syncKasaBalanceAfterInsert(
  kasaId: string,
  hedefKasaId: string | null | undefined,
  tip: GelirGiderTip,
  tutar: number,
  prevSourceBalance: number,
  prevTargetBalance: number | null
) {
  const { data: afterSrc } = await supabase
    .from('kasalar')
    .select('guncel_bakiye')
    .eq('id', kasaId)
    .single();

  if (afterSrc && Math.abs(Number(afterSrc.guncel_bakiye) - prevSourceBalance) < 0.001) {
    const nextBalance =
      tip === 'gelir' ? prevSourceBalance + tutar : prevSourceBalance - tutar;
    await supabase.from('kasalar').update({ guncel_bakiye: nextBalance }).eq('id', kasaId);
  }

  if (tip === 'virman' && hedefKasaId && prevTargetBalance !== null) {
    const { data: afterDst } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', hedefKasaId)
      .single();

    if (afterDst && Math.abs(Number(afterDst.guncel_bakiye) - prevTargetBalance) < 0.001) {
      await supabase
        .from('kasalar')
        .update({ guncel_bakiye: prevTargetBalance + tutar })
        .eq('id', hedefKasaId);
    }
  }
}

export async function syncKasaBalanceAfterDelete(item: GelirGider) {
  const { data: beforeSrc } = await supabase
    .from('kasalar')
    .select('guncel_bakiye')
    .eq('id', item.kasa_id)
    .single();
  const prevSource = beforeSrc ? Number(beforeSrc.guncel_bakiye) : null;

  let prevTarget: number | null = null;
  if (item.tip === 'virman' && item.hedef_kasa_id) {
    const { data: beforeDst } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', item.hedef_kasa_id)
      .single();
    prevTarget = beforeDst ? Number(beforeDst.guncel_bakiye) : null;
  }

  const { error: delErr } = await supabase.from('gelir_giderler').delete().eq('id', item.id);
  if (delErr) throw delErr;

  const tutar = Number(item.tutar) || 0;
  if (prevSource !== null) {
    const { data: afterSrc } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', item.kasa_id)
      .single();
    if (afterSrc && Math.abs(Number(afterSrc.guncel_bakiye) - prevSource) < 0.001) {
      const nextSource =
        item.tip === 'gelir' ? prevSource - tutar : prevSource + tutar;
      await supabase
        .from('kasalar')
        .update({ guncel_bakiye: nextSource })
        .eq('id', item.kasa_id);
    }
  }

  if (item.tip === 'virman' && item.hedef_kasa_id && prevTarget !== null) {
    const { data: afterDst } = await supabase
      .from('kasalar')
      .select('guncel_bakiye')
      .eq('id', item.hedef_kasa_id)
      .single();
    if (afterDst && Math.abs(Number(afterDst.guncel_bakiye) - prevTarget) < 0.001) {
      await supabase
        .from('kasalar')
        .update({ guncel_bakiye: prevTarget - tutar })
        .eq('id', item.hedef_kasa_id);
    }
  }
}

interface GelirGiderFormModalProps {
  isOpen: boolean;
  initialTip: GelirGiderTip;
  editingItem?: GelirGider | null;
  kasalar: Kasa[];
  firmaId: string;
  userId?: string;
  onClose: () => void;
  onSaved: () => void;
  onOpenNewKasa: () => void;
}

export const GelirGiderFormModal: React.FC<GelirGiderFormModalProps> = ({
  isOpen,
  initialTip,
  editingItem,
  kasalar,
  firmaId,
  userId,
  onClose,
  onSaved,
  onOpenNewKasa,
}) => {
  const [tip, setTip] = useState<GelirGiderTip>(initialTip);
  const [kasaId, setKasaId] = useState<string>('');
  const [hedefKasaId, setHedefKasaId] = useState<string>('');
  const [kategori, setKategori] = useState<string>('');
  const [tutar, setTutar] = useState<string>('');
  const [tarih, setTarih] = useState<string>(new Date().toISOString().split('T')[0]);
  const [belgeNo, setBelgeNo] = useState<string>('');
  const [aciklama, setAciklama] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingItem) {
      setTip(editingItem.tip);
      setKasaId(editingItem.kasa_id);
      setHedefKasaId(editingItem.hedef_kasa_id || '');
      setKategori(editingItem.kategori);
      setTutar(String(editingItem.tutar));
      setTarih(editingItem.tarih);
      setBelgeNo(editingItem.belge_no || '');
      setAciklama(editingItem.aciklama || '');
    } else {
      setTip(initialTip);
      const aktifKasalar = kasalar.filter((k) => k.aktif);
      setKasaId(aktifKasalar[0]?.id || kasalar[0]?.id || '');
      setHedefKasaId(aktifKasalar[1]?.id || kasalar[1]?.id || '');
      setKategori(
        initialTip === 'virman'
          ? 'Kasa Virmanı'
          : initialTip === 'gelir'
          ? GELIR_KATEGORILERI[0]
          : GIDER_KATEGORILERI[0]
      );
      setTutar('');
      setTarih(new Date().toISOString().split('T')[0]);
      setBelgeNo('');
      setAciklama('');
    }
  }, [isOpen, initialTip, editingItem, kasalar]);

  if (!isOpen) return null;

  const aktifKasalar = kasalar.filter((k) => k.aktif || k.id === kasaId || k.id === hedefKasaId);
  const presets = tip === 'gelir' ? GELIR_KATEGORILERI : tip === 'gider' ? GIDER_KATEGORILERI : ['Kasa Virmanı', 'Bankaya Yatırma', 'Kasaya Çekim', 'POS Çözümleme'];

  const handleTipSwitch = (nextTip: GelirGiderTip) => {
    setTip(nextTip);
    if (nextTip === 'virman') {
      setKategori('Kasa Virmanı');
    } else if (nextTip === 'gelir' && !GELIR_KATEGORILERI.includes(kategori)) {
      setKategori(GELIR_KATEGORILERI[0]);
    } else if (nextTip === 'gider' && !GIDER_KATEGORILERI.includes(kategori)) {
      setKategori(GIDER_KATEGORILERI[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numTutar = parseFloat(tutar.replace(',', '.'));
    if (!kasaId) {
      setError('Lütfen bir kasa veya banka hesabı seçin.');
      return;
    }
    if (tip === 'virman') {
      if (!hedefKasaId) {
        setError('Lütfen virman yapılacak hedef kasa/bankayı seçin.');
        return;
      }
      if (hedefKasaId === kasaId) {
        setError('Kaynak ve hedef kasa aynı olamaz.');
        return;
      }
    }
    if (!kategori.trim()) {
      setError('Lütfen bir kategori girin veya seçin.');
      return;
    }
    if (isNaN(numTutar) || numTutar <= 0) {
      setError('Lütfen 0’dan büyük geçerli bir tutar girin.');
      return;
    }

    try {
      setSaving(true);
      if (editingItem) {
        await syncKasaBalanceAfterDelete(editingItem);
      }

      const { data: srcBefore } = await supabase
        .from('kasalar')
        .select('guncel_bakiye')
        .eq('id', kasaId)
        .single();
      const prevSourceBalance = srcBefore ? Number(srcBefore.guncel_bakiye) : 0;

      let prevTargetBalance: number | null = null;
      if (tip === 'virman' && hedefKasaId) {
        const { data: dstBefore } = await supabase
          .from('kasalar')
          .select('guncel_bakiye')
          .eq('id', hedefKasaId)
          .single();
        prevTargetBalance = dstBefore ? Number(dstBefore.guncel_bakiye) : 0;
      }

      const payload = {
        firma_id: firmaId,
        kasa_id: kasaId,
        hedef_kasa_id: tip === 'virman' ? hedefKasaId : null,
        tip,
        kategori: kategori.trim(),
        tutar: numTutar,
        tarih,
        belge_no: belgeNo.trim() || null,
        aciklama: aciklama.trim() || null,
        yapan_user_id: userId || null,
      };

      const { error: insertErr } = await supabase.from('gelir_giderler').insert(payload);
      if (insertErr) throw insertErr;

      await syncKasaBalanceAfterInsert(
        kasaId,
        tip === 'virman' ? hedefKasaId : null,
        tip,
        numTutar,
        prevSourceBalance,
        prevTargetBalance
      );

      onSaved();
      onClose();
    } catch (err) {
      setError(handleSupabaseError(err, 'Kayıt işlemi sırasında bir hata oluştu.'));
    } finally {
      setSaving(false);
    }
  };

  const titleConfig = {
    gelir: { label: 'Yeni Şirket Geliri Ekle', icon: TrendingUp, accent: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30', btn: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' },
    gider: { label: 'Yeni Masraf / Gider Ekle', icon: TrendingDown, accent: 'text-rose-400 bg-rose-500/15 border-rose-500/30', btn: 'bg-rose-500 hover:bg-rose-400 text-white' },
    virman: { label: 'Kasalar Arası Virman (Transfer)', icon: ArrowLeftRight, accent: 'text-sky-400 bg-sky-500/15 border-sky-500/30', btn: 'bg-sky-400 hover:bg-sky-300 text-slate-950' },
  }[tip];
  const HeaderIcon = titleConfig.icon;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#111820] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl my-auto overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${titleConfig.accent}`}>
              <HeaderIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white">
                {editingItem ? 'Kasa Hareketini Düzenle' : titleConfig.label}
              </h3>
              <p className="text-[11px] text-gray-400">Cari makbuzlardan bağımsız kasa & masraf kaydı</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {/* İşlem Tipi Seçimi */}
          <div className="grid grid-cols-3 gap-2 bg-black/40 p-1 rounded-xl border border-white/[0.07]">
            <button
              type="button"
              onClick={() => handleTipSwitch('gelir')}
              data-testid="modal_tip_gelir"
              className={`py-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                tip === 'gelir' ? 'bg-emerald-500 text-slate-950 shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Gelir</span>
            </button>
            <button
              type="button"
              onClick={() => handleTipSwitch('gider')}
              data-testid="modal_tip_gider"
              className={`py-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                tip === 'gider' ? 'bg-rose-500 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              <span>Gider</span>
            </button>
            <button
              type="button"
              onClick={() => handleTipSwitch('virman')}
              data-testid="modal_tip_virman"
              className={`py-2.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                tip === 'virman' ? 'bg-sky-400 text-slate-950 shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Virman</span>
            </button>
          </div>

          {aktifKasalar.length === 0 ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs space-y-2">
              <p className="font-bold">Henüz tanımlı bir kasa veya banka hesabı bulunmuyor.</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenNewKasa();
                }}
                className="px-3 py-2 rounded-lg bg-amber-400 text-slate-950 font-bold text-xs"
              >
                + İlk Kasa / Bankayı Oluştur
              </button>
            </div>
          ) : (
            <>
              <div className={`grid ${tip === 'virman' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    {tip === 'virman' ? 'Çıkış Kasası / Banka *' : 'Kasa / Banka Hesabı *'}
                  </label>
                  <select
                    value={kasaId}
                    onChange={(e) => setKasaId(e.target.value)}
                    className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
                    required
                  >
                    {aktifKasalar.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.ad} ({KASA_TUR_LABELS[k.tur]})
                      </option>
                    ))}
                  </select>
                </div>

                {tip === 'virman' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                      Giriş (Hedef) Kasası *
                    </label>
                    <select
                      value={hedefKasaId}
                      onChange={(e) => setHedefKasaId(e.target.value)}
                      className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-sky-400"
                      required
                    >
                      <option value="">Hedef Seçiniz...</option>
                      {aktifKasalar
                        .filter((k) => k.id !== kasaId)
                        .map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.ad} ({KASA_TUR_LABELS[k.tur]})
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Kategori & Hızlı Seçenekler */}
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Kategori *
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {presets.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setKategori(p)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                        kategori === p
                          ? 'bg-teal-400/20 text-teal-300 border-teal-400/50'
                          : 'bg-black/30 text-gray-400 border-white/[0.08] hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={kategori}
                  onChange={(e) => setKategori(e.target.value)}
                  placeholder="Kategori adı..."
                  className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Tutar (₺) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={tutar}
                    onChange={(e) => setTutar(e.target.value)}
                    placeholder="0,00"
                    data-testid="kasa_hareket_tutar_input"
                    className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-teal-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Tarih *
                  </label>
                  <input
                    type="date"
                    value={tarih}
                    onChange={(e) => setTarih(e.target.value)}
                    className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Fiş / Fatura No (Opsiyonel)
                  </label>
                  <input
                    type="text"
                    value={belgeNo}
                    onChange={(e) => setBelgeNo(e.target.value)}
                    placeholder="Örn: FTR-2026-001"
                    className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Açıklama (Opsiyonel)
                  </label>
                  <input
                    type="text"
                    value={aciklama}
                    onChange={(e) => setAciklama(e.target.value)}
                    placeholder="Örn: Kasım ayı kira ödemesi"
                    className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition"
            >
              Vazgeç
            </button>
            {aktifKasalar.length > 0 && (
              <button
                type="submit"
                disabled={saving}
                data-testid="kasa_hareket_save_btn"
                className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition flex items-center gap-2 disabled:opacity-50 ${titleConfig.btn}`}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{editingItem ? 'Güncelle' : 'Kaydet'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

interface KasaAccountModalProps {
  isOpen: boolean;
  editingKasa?: Kasa | null;
  firmaId: string;
  onClose: () => void;
  onSaved: () => void;
}

export const KasaAccountModal: React.FC<KasaAccountModalProps> = ({
  isOpen,
  editingKasa,
  firmaId,
  onClose,
  onSaved,
}) => {
  const [ad, setAd] = useState('');
  const [tur, setTur] = useState<KasaTur>('nakit');
  const [bankaAdi, setBankaAdi] = useState('');
  const [iban, setIban] = useState('');
  const [acilisBakiyesi, setAcilisBakiyesi] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingKasa) {
      setAd(editingKasa.ad);
      setTur(editingKasa.tur);
      setBankaAdi(editingKasa.banka_adi || '');
      setIban(editingKasa.iban || '');
      setAcilisBakiyesi(String(editingKasa.acilis_bakiyesi ?? 0));
    } else {
      setAd('');
      setTur('nakit');
      setBankaAdi('');
      setIban('');
      setAcilisBakiyesi('0');
    }
  }, [isOpen, editingKasa]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!ad.trim()) {
      setError('Lütfen kasa veya banka hesabı adını girin.');
      return;
    }

    const parsedAcilis = parseFloat(acilisBakiyesi.replace(',', '.')) || 0;

    try {
      setSaving(true);
      if (editingKasa) {
        const diff = parsedAcilis - Number(editingKasa.acilis_bakiyesi || 0);
        const { error: updErr } = await supabase
          .from('kasalar')
          .update({
            ad: ad.trim(),
            tur,
            banka_adi: tur !== 'nakit' ? bankaAdi.trim() || null : null,
            iban: tur === 'banka' ? iban.trim() || null : null,
            acilis_bakiyesi: parsedAcilis,
            guncel_bakiye: Number(editingKasa.guncel_bakiye || 0) + diff,
          })
          .eq('id', editingKasa.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from('kasalar').insert({
          firma_id: firmaId,
          ad: ad.trim(),
          tur,
          banka_adi: tur !== 'nakit' ? bankaAdi.trim() || null : null,
          iban: tur === 'banka' ? iban.trim() || null : null,
          acilis_bakiyesi: parsedAcilis,
          guncel_bakiye: parsedAcilis,
          aktif: true,
        });
        if (insErr) throw insErr;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(handleSupabaseError(err, 'Kasa/Banka hesabı kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-[#111820] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl my-auto overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white">
                {editingKasa ? 'Kasa / Hesap Düzenle' : 'Yeni Kasa / Banka Hesabı'}
              </h3>
              <p className="text-[11px] text-gray-400">Nakit kasa, banka hesabı veya POS tanımlayın</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 bg-black/40 p-1 rounded-xl border border-white/[0.07]">
            {(['nakit', 'banka', 'pos'] as KasaTur[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTur(t)}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  tur === t ? 'bg-teal-400 text-slate-950 shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t === 'nakit' ? 'Nakit' : t === 'banka' ? 'Banka' : 'POS'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">
              Hesap / Kasa Adı *
            </label>
            <input
              type="text"
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              placeholder={tur === 'nakit' ? 'Örn: Merkez Nakit Kasa' : tur === 'banka' ? 'Örn: Garanti TL Hesabı' : 'Örn: Akbank POS'}
              data-testid="kasa_account_name_input"
              className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
              required
            />
          </div>

          {tur !== 'nakit' && (
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                Banka Adı (Opsiyonel)
              </label>
              <input
                type="text"
                value={bankaAdi}
                onChange={(e) => setBankaAdi(e.target.value)}
                placeholder="Örn: Garanti BBVA"
                className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400"
              />
            </div>
          )}

          {tur === 'banka' && (
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                IBAN (Opsiyonel)
              </label>
              <input
                type="text"
                value={iban}
                onChange={(e) => setIban(e.target.value.toUpperCase())}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-teal-400"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">
              Açılış / Devir Bakiyesi (₺)
            </label>
            <input
              type="number"
              step="0.01"
              value={acilisBakiyesi}
              onChange={(e) => setAcilisBakiyesi(e.target.value)}
              className="w-full bg-[#0b1017] border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-teal-400"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold transition"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={saving}
              data-testid="kasa_account_save_btn"
              className="px-5 py-2.5 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 text-xs font-extrabold transition flex items-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{editingKasa ? 'Güncelle' : 'Kasa Oluştur'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const KasaSqlSetupModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(KASA_SETUP_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#111820] border border-amber-500/40 rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-white">
                Supabase Kasa & Gelir-Gider SQL Kurulumu
              </h3>
              <p className="text-[11px] text-gray-400">
                Supabase &gt; SQL Editor kısmına yapıştırıp bir kez çalıştırın
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          <pre className="bg-[#090d12] border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-teal-300 overflow-x-auto whitespace-pre-wrap select-all">
            {KASA_SETUP_SQL}
          </pre>
        </div>

        <div className="p-4 border-t border-white/[0.07] flex items-center justify-between gap-3">
          <span className="text-[11px] text-gray-400">
            Tablolar oluşturulduktan sonra &quot;Yenile&quot; butonuna basın.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 transition"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Kopyalandı!' : 'SQL Kopyala'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/10 text-white font-bold text-xs"
            >
              Kapat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
