import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatDate } from '../lib/formatters';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
const DURUM: Record<string, [string, string]> = {
  bekliyor: ['Onay bekliyor', 'text-amber-300'],
  onaylandi: ['Onaylandı', 'text-teal-300'],
  red: ['Reddedildi', 'text-red-400'],
};

export const OdemelerPanel: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [fm, setFm] = useState<Record<string, any>>({});
  const [pk, setPk] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [o, f, p] = await Promise.all([
      supabase.from('odeme_bildirimleri').select('*').order('tarih', { ascending: false }).limit(50),
      supabase.from('firmalar').select('id,unvan,vergi_no'),
      supabase.from('paketler').select('id,ad,sure_gun'),
    ]);
    if (o.error) setMsg('Okunamadı: ' + o.error.message);
    setRows(o.data ?? []);
    setFm(Object.fromEntries((f.data ?? []).map((x: any) => [x.id, x])));
    setPk(Object.fromEntries((p.data ?? []).map((x: any) => [x.id, x])));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const dekont = async (yol: string) => {
    const { data, error } = await supabase.storage.from('dekontlar').createSignedUrl(yol, 300);
    if (error || !data) return setMsg('Dekont açılamadı: ' + (error?.message ?? ''));
    window.open(data.signedUrl, '_blank');
  };
  const islem = async (id: string, onay: boolean) => {
    if (!window.confirm(onay ? 'Ödeme onaylanıp firmanın süresi uzatılsın mı?' : 'Bildirim reddedilsin mi?')) return;
    const { data, error } = await supabase.rpc(onay ? 'odeme_onayla' : 'odeme_reddet', { p_id: id });
    setMsg(error ? 'Hata: ' + error.message : onay ? 'Onaylandı. Yeni bitiş: ' + formatDate(data as string) : 'Reddedildi.');
    load();
  };

  return (
    <div className="space-y-3">
      {msg && <div className="rounded-xl border border-teal-400/30 bg-teal-400/10 p-3 text-sm text-teal-200">{msg}</div>}
      {loading && <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />}
      {!loading && rows.length === 0 && <p className="text-sm text-gray-400">Henüz ödeme bildirimi yok.</p>}
      {rows.map((b) => {
        const [dl, dc] = DURUM[b.durum] ?? [b.durum, 'text-gray-300'];
        return (
          <div key={b.id} className={card}>
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="font-bold text-white">{fm[b.firma_id]?.unvan ?? 'Firma'} <span className="text-xs text-gray-400 font-normal">· {fm[b.firma_id]?.vergi_no}</span></p>
                <p className="text-xs text-gray-300 mt-1">
                  {pk[b.paket_id]?.ad ?? 'Paket'} · {formatCurrency(b.tutar)} · {formatDate(b.tarih)}
                </p>
                {b['not'] && <p className="text-xs text-gray-400 mt-1">Not: {b['not']}</p>}
              </div>
              <span className={'text-sm font-bold ' + dc}>{dl}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {b.dekont_url && <button onClick={() => dekont(b.dekont_url)} className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-white">Dekontu aç</button>}
              {b.durum === 'bekliyor' && (
                <>
                  <button onClick={() => islem(b.id, true)} className="px-3 py-2 rounded-xl text-xs font-bold bg-teal-400 text-[#0a0e13]">Onayla ve süreyi uzat</button>
                  <button onClick={() => islem(b.id, false)} className="px-3 py-2 rounded-xl text-xs font-bold bg-red-500/20 text-red-300">Reddet</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

