import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, Minus, Pencil, Trash2, Loader2, ShieldAlert } from 'lucide-react';
import { supabase, handleSupabaseError } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { exportToExcel, printPdfReport } from '../lib/exportService';
import { formatCurrency, formatDate } from '../lib/formatters';
import type { Kasa, GelirGider, GelirGiderTip, KasaTur } from '../types/database';

interface Props {
  onNavigate: (tab: string, state?: unknown) => void;
  initialModal?: 'gelir' | 'gider';
}

const inp = 'w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-400';
const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
const GELIR_KAT = ['Peşin Satış', 'Hizmet Geliri', 'Faiz/Nemalandırma', 'Kira Geliri', 'Kur Farkı Geliri', 'Ortak Sermaye Girişi', 'Diğer Gelir'];
const GIDER_KAT = ['Kira', 'Maaş & Personel', 'Elektrik/Su/Doğalgaz', 'İnternet & Telefon', 'Yakıt & Ulaşım', 'Yemek & İkram', 'Vergi & SGK', 'Kargo & Nakliye', 'Bakım & Onarım', 'Reklam & Pazarlama', 'Kırtasiye & Ofis', 'Banka Masrafı', 'Diğer Gider'];
const TIP_AD: Record<GelirGiderTip, string> = { gelir: 'Gelir', gider: 'Gider', virman: 'Virman' };
const TUR_AD: Record<KasaTur, string> = { nakit: 'Nakit', banka: 'Banka', pos: 'POS' };

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; };
const isMissing = (e: any) => e?.code === '42P01' || e?.code === 'PGRST205' || /schema cache|does not exist/i.test(e?.message ?? '');

type ModalState = { tip: GelirGiderTip; edit?: GelirGider } | null;

export const KasaGelirGiderPage: React.FC<Props> = ({ onNavigate, initialModal }) => {
  const { firma, profile } = useAuth();
  const firmaId = firma?.id;
  const [kasalar, setKasalar] = useState<Kasa[]>([]);
  const [hareketler, setHareketler] = useState<GelirGider[]>([]);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'defter' | 'kasalar' | 'ozet'>('defter');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [fTip, setFTip] = useState('');
  const [fKasa, setFKasa] = useState('');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<ModalState>(initialModal ? { tip: initialModal } : null);
  const [kasaModal, setKasaModal] = useState<{ edit?: Kasa } | null>(null);
  const [ozet, setOzet] = useState<Record<string, number> | null>(null);

  const load = useCallback(async () => {
    if (!firmaId) return;
    setLoading(true);
    setErr('');
    const k = await supabase.from('kasalar').select('*').eq('firma_id', firmaId).order('created_at');
    if (k.error) {
      setLoading(false);
      if (isMissing(k.error)) setSetup(true); else setErr(handleSupabaseError(k.error));
      return;
    }
    const g = await supabase.from('gelir_giderler').select('*').eq('firma_id', firmaId)
      .gte('tarih', from).lte('tarih', to).order('tarih', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
    if (g.error) setErr(handleSupabaseError(g.error));
    setKasalar((k.data ?? []) as Kasa[]);
    setHareketler((g.data ?? []) as GelirGider[]);
    setLoading(false);
  }, [firmaId, from, to]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'ozet' || !firmaId) return;
    (async () => {
      const { data } = await supabase.from('islemler').select('tip,tur,tutar')
        .eq('firma_id', firmaId).eq('iptal', false).in('durum', ['aktif', 'aktarildi']).in('tur', ['nakit', 'kredi_karti'])
        .gte('tarih', from).lte('tarih', to).limit(5000);
      const o: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { const key = `${r.tip}_${r.tur}`; o[key] = (o[key] ?? 0) + Number(r.tutar); });
      setOzet(o);
    })();
  }, [tab, firmaId, from, to]);

  const kasaAd = useMemo(() => Object.fromEntries(kasalar.map((k) => [k.id, k.ad])), [kasalar]);
  const aktifKasalar = kasalar.filter((k) => k.aktif);
  const liste = hareketler.filter((h) =>
    (!fTip || h.tip === fTip) && (!fKasa || h.kasa_id === fKasa || h.hedef_kasa_id === fKasa) &&
    (!q || `${h.kategori ?? ''} ${h.aciklama ?? ''} ${h.belge_no ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  const sum = (tip: GelirGiderTip) => hareketler.filter((h) => h.tip === tip).reduce((a, h) => a + Number(h.tutar), 0);
  const nakitTop = kasalar.filter((k) => k.aktif && k.tur === 'nakit').reduce((a, k) => a + Number(k.guncel_bakiye), 0);
  const bankaTop = kasalar.filter((k) => k.aktif && k.tur !== 'nakit').reduce((a, k) => a + Number(k.guncel_bakiye), 0);
  const gelir = sum('gelir');
  const gider = sum('gider');

  const openModal = (tip: GelirGiderTip, edit?: GelirGider) => {
    if (aktifKasalar.length === 0) { setErr('Önce bir kasa veya banka hesabı ekleyin.'); setKasaModal({}); return; }
    if (tip === 'virman' && aktifKasalar.length < 2) { setErr('Virman için en az iki aktif kasa gerekir.'); return; }
    setModal({ tip, edit });
  };
  const sil = async (h: GelirGider) => {
    if (!window.confirm('Bu kayıt silinsin mi? Kasa bakiyesi otomatik düzeltilir.')) return;
    const { error } = await supabase.from('gelir_giderler').delete().eq('id', h.id);
    if (error) setErr(handleSupabaseError(error)); else load();
  };
  const silKasa = async (k: Kasa) => {
    if (!window.confirm(`"${k.ad}" silinsin mi?`)) return;
    const { error } = await supabase.from('kasalar').delete().eq('id', k.id);
    if (error) setErr(error.code === '23503' ? 'Bu kasada hareket kayıtları var. Silmek yerine pasif yapın.' : handleSupabaseError(error)); else load();
  };

  const rowsFor = () => liste.map((h) => [formatDate(h.tarih), TIP_AD[h.tip], h.tip === 'virman' ? `${kasaAd[h.kasa_id] ?? ''} → ${kasaAd[h.hedef_kasa_id ?? ''] ?? ''}` : kasaAd[h.kasa_id] ?? '', h.kategori ?? '', h.aciklama ?? '', h.belge_no ?? '', Number(h.tutar)] as (string | number)[]);
  const HEAD = ['Tarih', 'Tip', 'Kasa', 'Kategori', 'Açıklama', 'Belge No', 'Tutar'];

  if (profile?.rol === 'plasiyer') {
    return <div className="max-w-xl mx-auto p-6 text-center text-gray-300"><ShieldAlert className="w-8 h-8 text-amber-400 mx-auto mb-3" />Bu bölüm ana hesap ve muhasebeci içindir.</div>;
  }
  if (setup) {
    return (
      <div className={card + ' max-w-xl mx-auto text-sm text-gray-300'}>
        <p className="font-bold text-white mb-2">Kasa modülü için veritabanı kurulumu gerekli</p>
        Süper admin, Supabase SQL Editor'da <b>kasa_kurulum.sql</b> dosyasını bir kez çalıştırmalıdır. Sonra bu sayfayı yenileyin.
      </div>
    );
  }

  const tabBtn = (k: typeof tab, l: string) => (
    <button key={k} onClick={() => setTab(k)} className={'px-4 py-2 rounded-xl text-sm font-semibold ' + (tab === k ? 'bg-teal-400 text-[#0a0e13]' : 'bg-white/5 text-gray-300')}>{l}</button>
  );
  const kpi = (l: string, v: string, sub?: string, c = 'text-white') => (
    <div className={card}><p className="text-[11px] text-gray-400 uppercase font-semibold">{l}</p><p className={'text-xl font-black mt-1 ' + c}>{v}</p>{sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}</div>
  );

  return (
    <div className="max-w-6xl mx-auto w-full space-y-5">
      <div className="grid md:grid-cols-2 gap-3">
        <div className={card}>
          <p className="text-xs font-bold text-white mb-3">Şirket İçi Kasa & Masraf Girişi <span className="text-gray-400 font-normal">(cari bakiyesini etkilemez)</span></p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openModal('gelir')} className="px-3 py-2 rounded-xl text-xs font-bold bg-teal-400 text-[#0a0e13] inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Gelir Ekle</button>
            <button onClick={() => openModal('gider')} className="px-3 py-2 rounded-xl text-xs font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 inline-flex items-center gap-1"><Minus className="w-3.5 h-3.5" />Gider / Masraf Ekle</button>
            <button onClick={() => openModal('virman')} className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-white">Kasa Virman</button>
            <button onClick={() => setKasaModal({})} className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-white">Yeni Kasa / Banka</button>
          </div>
        </div>
        <div className={card}>
          <p className="text-xs font-bold text-white mb-3">Cari Makbuz Girişi <span className="text-gray-400 font-normal">(müşteri/tedarikçi hesabı)</span></p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onNavigate('tahsilat')} className="px-3 py-2 rounded-xl text-xs font-bold bg-teal-400/15 text-teal-300 border border-teal-400/30 inline-flex items-center gap-1"><ArrowDownLeft className="w-3.5 h-3.5" />Tahsilat Makbuzu</button>
            <button onClick={() => onNavigate('tediye')} className="px-3 py-2 rounded-xl text-xs font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30 inline-flex items-center gap-1"><ArrowUpRight className="w-3.5 h-3.5" />Tediye Makbuzu</button>
          </div>
        </div>
      </div>

      {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpi('Nakit Kasalar Toplamı', formatCurrency(nakitTop))}
        {kpi('Banka & POS Toplamı', formatCurrency(bankaTop))}
        {kpi('Dönem Gelirler', formatCurrency(gelir), undefined, 'text-teal-300')}
        {kpi('Dönem Giderler', formatCurrency(gider), 'Net: ' + formatCurrency(gelir - gider), 'text-orange-300')}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabBtn('defter', 'Gelir & Gider Defteri')}{tabBtn('kasalar', 'Kasalar & Hesaplar')}{tabBtn('ozet', 'Tahsilat / Tediye Kasa Özeti')}
      </div>

      {tab !== 'kasalar' && (
        <div className={card + ' grid grid-cols-2 md:grid-cols-6 gap-2'}>
          <label className="text-[11px] text-gray-400">Başlangıç<input type="date" className={inp + ' mt-1'} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-[11px] text-gray-400">Bitiş<input type="date" className={inp + ' mt-1'} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          {tab === 'defter' && (
            <>
              <label className="text-[11px] text-gray-400">Tip<select className={inp + ' mt-1'} value={fTip} onChange={(e) => setFTip(e.target.value)}><option value="">Tümü</option><option value="gelir">Gelir</option><option value="gider">Gider</option><option value="virman">Virman</option></select></label>
              <label className="text-[11px] text-gray-400">Kasa<select className={inp + ' mt-1'} value={fKasa} onChange={(e) => setFKasa(e.target.value)}><option value="">Tümü</option>{kasalar.map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</select></label>
              <label className="text-[11px] text-gray-400 col-span-2">Ara<input className={inp + ' mt-1'} placeholder="Kategori, açıklama, belge no" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            </>
          )}
        </div>
      )}

      {loading && <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />}

      {tab === 'defter' && !loading && (
        <div className="space-y-2">
          <div className="flex gap-2 justify-end">
            <button onClick={() => exportToExcel(`gelir-gider-${from}-${to}`, HEAD, rowsFor())} className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-white">Excel (CSV)</button>
            <button onClick={() => printPdfReport('Gelir & Gider Defteri', `${formatDate(from)} - ${formatDate(to)}`, HEAD, rowsFor(), [{ label: 'Gelir', value: formatCurrency(gelir) }, { label: 'Gider', value: formatCurrency(gider) }, { label: 'Net', value: formatCurrency(gelir - gider) }])} className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-white">PDF</button>
          </div>
          {liste.length === 0 && <p className="text-sm text-gray-400">Bu dönemde kayıt yok.</p>}
          {liste.map((h) => (
            <div key={h.id} className={card + ' flex flex-wrap items-center justify-between gap-3'}>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">
                  <span className={h.tip === 'gelir' ? 'text-teal-300' : h.tip === 'gider' ? 'text-orange-300' : 'text-sky-300'}>{TIP_AD[h.tip]}</span>
                  {h.kategori ? ` · ${h.kategori}` : ''}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(h.tarih)} · {h.tip === 'virman' ? `${kasaAd[h.kasa_id] ?? ''} → ${kasaAd[h.hedef_kasa_id ?? ''] ?? ''}` : kasaAd[h.kasa_id]}
                  {h.belge_no ? ` · Belge: ${h.belge_no}` : ''}{h.aciklama ? ` · ${h.aciklama}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-black text-white">{formatCurrency(Number(h.tutar))}</span>
                <button aria-label="Düzenle" onClick={() => openModal(h.tip, h)} className="p-2 rounded-lg bg-white/10 text-gray-200"><Pencil className="w-4 h-4" /></button>
                <button aria-label="Sil" onClick={() => sil(h)} className="p-2 rounded-lg bg-red-500/15 text-red-300"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'kasalar' && !loading && (
        <div className="grid md:grid-cols-2 gap-3">
          {kasalar.length === 0 && <p className="text-sm text-gray-400">Henüz kasa yok. "Yeni Kasa / Banka" ile ekleyin.</p>}
          {kasalar.map((k) => (
            <div key={k.id} className={card + (k.aktif ? '' : ' opacity-60')}>
              <div className="flex justify-between items-start">
                <div><p className="font-bold text-white">{k.ad}</p><p className="text-xs text-gray-400">{TUR_AD[k.tur]}{k.banka_adi ? ` · ${k.banka_adi}` : ''}{k.aktif ? '' : ' · Pasif'}</p></div>
                <p className="text-lg font-black text-white">{formatCurrency(Number(k.guncel_bakiye))}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setModal({ tip: 'gelir', edit: undefined })} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-400/15 text-teal-300">+ Gelir</button>
                <button onClick={() => setModal({ tip: 'gider', edit: undefined })} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-500/15 text-orange-300">− Gider</button>
                <button onClick={() => setKasaModal({ edit: k })} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 text-white">Düzenle</button>
                <button onClick={() => silKasa(k)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-300">Sil</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'ozet' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Salt okunur özet. Yalnızca iptal edilmemiş ve plasiyerden aktarılmış (veya doğrudan alınmış) nakit ve kredi kartı makbuzları sayılır; masraf kayıtlarıyla karışmaz.</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpi('Tahsilat · Nakit', formatCurrency(ozet?.tahsilat_nakit ?? 0), undefined, 'text-teal-300')}
            {kpi('Tahsilat · Kredi Kartı', formatCurrency(ozet?.tahsilat_kredi_karti ?? 0), undefined, 'text-teal-300')}
            {kpi('Tediye · Nakit', formatCurrency(ozet?.tediye_nakit ?? 0), undefined, 'text-orange-300')}
            {kpi('Tediye · Kredi Kartı', formatCurrency(ozet?.tediye_kredi_karti ?? 0), undefined, 'text-orange-300')}
          </div>
          <button onClick={() => onNavigate('islemler')} className="px-4 py-2.5 rounded-xl bg-white/10 text-white text-sm font-bold">Tüm Makbuzlara Git</button>
        </div>
      )}

      {modal && <HareketModal tip={modal.tip} edit={modal.edit} kasalar={aktifKasalar} firmaId={firmaId!} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {kasaModal && <KasaModal edit={kasaModal.edit} firmaId={firmaId!} onClose={() => setKasaModal(null)} onSaved={() => { setKasaModal(null); load(); }} />}
    </div>
  );
};

const Shell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
    <div className="w-full max-w-lg rounded-2xl bg-[#0d131a] border border-white/10 p-5 pb-8 my-4" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-base font-black text-white mb-4">{title}</h3>
      {children}
    </div>
  </div>
);

const HareketModal: React.FC<{ tip: GelirGiderTip; edit?: GelirGider; kasalar: Kasa[]; firmaId: string; onClose: () => void; onSaved: () => void }> = ({ tip, edit, kasalar, firmaId, onClose, onSaved }) => {
  const [kasa, setKasa] = useState(edit?.kasa_id ?? kasalar[0]?.id ?? '');
  const [hedef, setHedef] = useState(edit?.hedef_kasa_id ?? kasalar.find((k) => k.id !== (edit?.kasa_id ?? kasalar[0]?.id))?.id ?? '');
  const [kat, setKat] = useState(edit?.kategori ?? '');
  const [tutar, setTutar] = useState(edit ? String(edit.tutar) : '');
  const [tarih, setTarih] = useState(edit?.tarih ?? today());
  const [acik, setAcik] = useState(edit?.aciklama ?? '');
  const [belge, setBelge] = useState(edit?.belge_no ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const kats = tip === 'gelir' ? GELIR_KAT : tip === 'gider' ? GIDER_KAT : [];

  const save = async () => {
    const t = Number(tutar.replace(',', '.'));
    if (!(t > 0)) return setErr('Geçerli bir tutar girin.');
    if (!kasa) return setErr('Kasa seçin.');
    if (tip === 'virman' && (!hedef || hedef === kasa)) return setErr('Farklı bir hedef kasa seçin.');
    setBusy(true);
    const payload = { firma_id: firmaId, kasa_id: kasa, hedef_kasa_id: tip === 'virman' ? hedef : null, tip, kategori: kat.trim() || null, tutar: t, tarih, aciklama: acik.trim() || null, belge_no: belge.trim() || null };
    const r = edit ? await supabase.from('gelir_giderler').update(payload).eq('id', edit.id) : await supabase.from('gelir_giderler').insert(payload);
    setBusy(false);
    if (r.error) return setErr(handleSupabaseError(r.error));
    onSaved();
  };
  return (
    <Shell title={(edit ? 'Düzenle · ' : '') + (tip === 'gelir' ? 'Gelir Ekle' : tip === 'gider' ? 'Gider / Masraf Ekle' : 'Kasa Virman')} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-xs text-gray-400">{tip === 'virman' ? 'Çıkış kasası' : 'Kasa'}
          <select className={inp + ' mt-1'} value={kasa} onChange={(e) => setKasa(e.target.value)}>{kasalar.map((k) => <option key={k.id} value={k.id}>{k.ad} ({formatCurrency(Number(k.guncel_bakiye))})</option>)}</select></label>
        {tip === 'virman' && (
          <label className="block text-xs text-gray-400">Hedef kasa
            <select className={inp + ' mt-1'} value={hedef} onChange={(e) => setHedef(e.target.value)}>{kasalar.filter((k) => k.id !== kasa).map((k) => <option key={k.id} value={k.id}>{k.ad}</option>)}</select></label>
        )}
        {kats.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-1">Kategori</p>
            <div className="flex flex-wrap gap-1.5">{kats.map((c) => <button key={c} type="button" onClick={() => setKat(c)} className={'px-2.5 py-1 rounded-lg text-xs ' + (kat === c ? 'bg-teal-400 text-[#0a0e13] font-bold' : 'bg-white/5 text-gray-300')}>{c}</button>)}</div>
            <input className={inp + ' mt-2'} placeholder="veya kendi kategoriniz" value={kat} onChange={(e) => setKat(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">Tutar (₺)<input className={inp + ' mt-1'} inputMode="decimal" value={tutar} onChange={(e) => setTutar(e.target.value)} onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} /></label>
          <label className="text-xs text-gray-400">Tarih<input type="date" className={inp + ' mt-1'} value={tarih} onChange={(e) => setTarih(e.target.value)} /></label>
        </div>
        <input className={inp} placeholder="Belge no (isteğe bağlı)" value={belge} onChange={(e) => setBelge(e.target.value)} />
        <input className={inp} placeholder="Açıklama (isteğe bağlı)" value={acik} onChange={(e) => setAcik(e.target.value)} onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-xl bg-teal-400 text-[#0a0e13] text-sm font-bold disabled:opacity-60">{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/5 text-gray-300 text-sm font-semibold">Vazgeç</button>
        </div>
      </div>
    </Shell>
  );
};

const KasaModal: React.FC<{ edit?: Kasa; firmaId: string; onClose: () => void; onSaved: () => void }> = ({ edit, firmaId, onClose, onSaved }) => {
  const [ad, setAd] = useState(edit?.ad ?? '');
  const [tur, setTur] = useState<KasaTur>(edit?.tur ?? 'nakit');
  const [banka, setBanka] = useState(edit?.banka_adi ?? '');
  const [iban, setIban] = useState(edit?.iban ?? '');
  const [acilis, setAcilis] = useState(edit ? String(edit.acilis_bakiyesi) : '0');
  const [aktif, setAktif] = useState(edit?.aktif ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    const a = Number(acilis.replace(',', '.'));
    if (!ad.trim()) return setErr('Kasa adı girin.');
    if (Number.isNaN(a)) return setErr('Açılış bakiyesi sayı olmalı.');
    setBusy(true);
    const payload = { firma_id: firmaId, ad: ad.trim(), tur, banka_adi: tur === 'nakit' ? null : banka.trim() || null, iban: tur === 'banka' ? iban.trim() || null : null, acilis_bakiyesi: a, aktif };
    const r = edit ? await supabase.from('kasalar').update(payload).eq('id', edit.id) : await supabase.from('kasalar').insert(payload);
    setBusy(false);
    if (r.error) return setErr(handleSupabaseError(r.error));
    onSaved();
  };
  return (
    <Shell title={edit ? 'Kasa / Hesap Düzenle' : 'Yeni Kasa / Banka'} onClose={onClose}>
      <div className="space-y-3">
        <input className={inp} placeholder="Ad (örn. Merkez Kasa, Ziraat Bankası)" value={ad} onChange={(e) => setAd(e.target.value)} />
        <select className={inp} value={tur} onChange={(e) => setTur(e.target.value as KasaTur)}><option value="nakit">Nakit kasa</option><option value="banka">Banka hesabı</option><option value="pos">POS</option></select>
        {tur !== 'nakit' && <input className={inp} placeholder="Banka adı" value={banka} onChange={(e) => setBanka(e.target.value)} />}
        {tur === 'banka' && <input className={inp} placeholder="IBAN (isteğe bağlı)" value={iban} onChange={(e) => setIban(e.target.value)} />}
        <label className="block text-xs text-gray-400">Açılış bakiyesi (₺)<input className={inp + ' mt-1'} inputMode="decimal" value={acilis} onChange={(e) => setAcilis(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-gray-200 min-h-[44px]"><input type="checkbox" className="w-5 h-5 accent-teal-400" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />Aktif</label>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-xl bg-teal-400 text-[#0a0e13] text-sm font-bold disabled:opacity-60">{busy ? 'Kaydediliyor…' : 'Kaydet'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/5 text-gray-300 text-sm font-semibold">Vazgeç</button>
        </div>
      </div>
    </Shell>
  );
};
