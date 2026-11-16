import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate } from '../lib/formatters';
import { Ayar } from '../types/database';
import {
  FIRMA_EK_PLASIYER_AYAR_KEY,
  isMissingEkPlasiyerColumnError,
  parseEkPlasiyerFromNote,
  parseFirmaEkPlasiyerMapFromAyarlar,
  parsePaymentRequestMeta,
  sanitizeEkPlasiyerCount,
} from '../lib/packageEntitlements';

const card = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
const DURUM: Record<string, [string, string]> = {
  bekliyor: ['Onay bekliyor', 'text-amber-300'],
  onaylandi: ['Onaylandı', 'text-teal-300'],
  red: ['Reddedildi', 'text-red-400'],
};

export const OdemelerPanel: React.FC = () => {
  const { firma: currentFirma, refreshProfileAndFirma } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [fm, setFm] = useState<Record<string, any>>({});
  const [pk, setPk] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [o, f, p] = await Promise.all([
      supabase.from('odeme_bildirimleri').select('*').order('tarih', { ascending: false }).limit(50),
      supabase.from('firmalar').select('id,unvan,vergi_no,paket_id'),
      supabase.from('paketler').select('id,ad,sure_gun'),
    ]);
    if (o.error) setMsg('Okunamadı: ' + o.error.message);
    setRows(o.data ?? []);
    setFm(Object.fromEntries((f.data ?? []).map((x: any) => [x.id, x])));
    setPk(Object.fromEntries((p.data ?? []).map((x: any) => [x.id, x])));
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const readCurrentEkPlasiyer = async (firmaId: string): Promise<number> => {
    const { data, error } = await supabase
      .from('firmalar')
      .select('id,ek_plasiyer_sayisi')
      .eq('id', firmaId)
      .maybeSingle();

    if (!error && data && typeof (data as { ek_plasiyer_sayisi?: unknown }).ek_plasiyer_sayisi === 'number') {
      return sanitizeEkPlasiyerCount((data as { ek_plasiyer_sayisi?: unknown }).ek_plasiyer_sayisi);
    }

    const { data: ayarRow } = await supabase
      .from('ayarlar')
      .select('*')
      .eq('anahtar', FIRMA_EK_PLASIYER_AYAR_KEY)
      .maybeSingle();

    if (ayarRow) {
      const map = parseFirmaEkPlasiyerMapFromAyarlar([ayarRow as Ayar]);
      return sanitizeEkPlasiyerCount(map[firmaId] ?? 0);
    }
    return 0;
  };

  const upsertAyarEkPlasiyerMap = async (firmaId: string, nextEkCount: number) => {
    const { data: ayarRow } = await supabase
      .from('ayarlar')
      .select('*')
      .eq('anahtar', FIRMA_EK_PLASIYER_AYAR_KEY)
      .maybeSingle();

    const existingMap = ayarRow
      ? parseFirmaEkPlasiyerMapFromAyarlar([ayarRow as Ayar])
      : {};
    const nextMap = {
      ...existingMap,
      [firmaId]: sanitizeEkPlasiyerCount(nextEkCount),
    };
    if (ayarRow?.id) {
      await supabase
        .from('ayarlar')
        .update({ deger: JSON.stringify(nextMap) })
        .eq('id', ayarRow.id);
    } else {
      await supabase
        .from('ayarlar')
        .insert({ anahtar: FIRMA_EK_PLASIYER_AYAR_KEY, deger: JSON.stringify(nextMap) });
    }
  };

  const syncApprovedQuotaToFirma = async (
    firmaId: string,
    paketId: string | null | undefined,
    requestedEkPlasiyer: number | null
  ) => {
    const updatePayload: Record<string, unknown> = {};
    if (paketId) {
      updatePayload.paket_id = paketId;
    }
    if (requestedEkPlasiyer !== null) {
      updatePayload.ek_plasiyer_sayisi = sanitizeEkPlasiyerCount(requestedEkPlasiyer);
    }

    if (Object.keys(updatePayload).length === 0) return;

    const { error: upErr } = await supabase
      .from('firmalar')
      .update(updatePayload)
      .eq('id', firmaId);

    if (upErr && requestedEkPlasiyer !== null && isMissingEkPlasiyerColumnError(upErr)) {
      if (paketId) {
        await supabase.from('firmalar').update({ paket_id: paketId }).eq('id', firmaId);
      }
      await upsertAyarEkPlasiyerMap(firmaId, requestedEkPlasiyer);
    }
  };

  const dekont = async (yol: string) => {
    const { data, error } = await supabase.storage.from('dekontlar').createSignedUrl(yol, 300);
    if (error || !data) return setMsg('Dekont açılamadı: ' + (error?.message ?? ''));
    window.open(data.signedUrl, '_blank');
  };

  const islem = async (b: any, onay: boolean) => {
    const meta = parsePaymentRequestMeta(b['not']);
    const confirmText = !onay
      ? 'Bildirim reddedilsin mi?'
      : meta.isStandaloneEkPlasiyer
      ? `Sadece ek plasiyer ödemesi onaylansın mı? Paket bitiş tarihi değişmeden firmanın ek plasiyer kotasına +${meta.ekPlasiyerAdet ?? 1} adet eklenecektir.`
      : 'Ödeme onaylanıp firmanın süresi ve kotası güncellensin mi?';

    if (!window.confirm(confirmText)) {
      return;
    }

    // SADECE EK PLASİYER SATIN ALMA: Paket bitiş tarihi değişmez, sadece mevcut ek plasiyer üzerine eklenir
    if (onay && meta.isStandaloneEkPlasiyer) {
      const addedCount = Math.max(1, meta.ekPlasiyerAdet ?? 1);
      const { error: markErr } = await supabase
        .from('odeme_bildirimleri')
        .update({ durum: 'onaylandi' })
        .eq('id', b.id);

      if (markErr) {
        setMsg('Bildirim onaylanamadı: ' + markErr.message);
        load();
        return;
      }

      const currentEk = await readCurrentEkPlasiyer(b.firma_id);
      const nextEk = sanitizeEkPlasiyerCount(currentEk + addedCount);

      const { error: firmaUpErr } = await supabase
        .from('firmalar')
        .update({ ek_plasiyer_sayisi: nextEk })
        .eq('id', b.firma_id);

      if (firmaUpErr) {
        if (isMissingEkPlasiyerColumnError(firmaUpErr)) {
          await upsertAyarEkPlasiyerMap(b.firma_id, nextEk);
        } else {
          setMsg('Kota güncellenemedi: ' + firmaUpErr.message);
          load();
          return;
        }
      }

      if (b.firma_id === currentFirma?.id) {
        await refreshProfileAndFirma();
      }
      setMsg(
        `Onaylandı (Sadece Ek Plasiyer). Paket süresi korundu · Eklenen: +${addedCount} · Toplam Ek Plasiyer: ${nextEk}`
      );
      load();
      return;
    }

    const { data, error } = await supabase.rpc(onay ? 'odeme_onayla' : 'odeme_reddet', { p_id: b.id });
    if (error) {
      setMsg('Hata: ' + error.message);
      load();
      return;
    }

    if (onay) {
      const requestedEk = meta.ekPlasiyerAdet ?? parseEkPlasiyerFromNote(b['not']);
      await syncApprovedQuotaToFirma(b.firma_id, b.paket_id, requestedEk);
      if (b.firma_id === currentFirma?.id) {
        await refreshProfileAndFirma();
      }
      const ekText = requestedEk !== null ? ` · Ek Plasiyer Kotası: ${requestedEk}` : '';
      setMsg(`Onaylandı. Yeni bitiş: ${formatDate(data as string)}${ekText}`);
    } else {
      setMsg('Reddedildi.');
    }
    load();
  };

  return (
    <div className="space-y-3">
      {msg && <div className="rounded-xl border border-teal-400/30 bg-teal-400/10 p-3 text-sm text-teal-200">{msg}</div>}
      {loading && <Loader2 className="w-5 h-5 text-teal-400 animate-spin" />}
      {!loading && rows.length === 0 && <p className="text-sm text-gray-400">Henüz ödeme bildirimi yok.</p>}
      {rows.map((b) => {
        const [dl, dc] = DURUM[b.durum] ?? [b.durum, 'text-gray-300'];
        const meta = parsePaymentRequestMeta(b['not']);
        const requestedEk = meta.ekPlasiyerAdet ?? parseEkPlasiyerFromNote(b['not']);
        return (
          <div key={b.id} className={card}>
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-white">
                    {fm[b.firma_id]?.unvan ?? 'Firma'}{' '}
                    <span className="text-xs text-gray-400 font-normal">· {fm[b.firma_id]?.vergi_no}</span>
                  </p>
                  {meta.isStandaloneEkPlasiyer && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-teal-400/20 text-teal-300 border border-teal-400/30">
                      Sadece Ek Plasiyer · Süre Değişmez
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-300 mt-1">
                  {meta.isStandaloneEkPlasiyer
                    ? `Sadece Ek Plasiyer (+${requestedEk ?? 1} Adet)`
                    : `${pk[b.paket_id]?.ad ?? 'Paket'}${
                        requestedEk !== null && requestedEk > 0 ? ` (+${requestedEk} Ek Plasiyer)` : ''
                      }`}{' '}
                  · {formatCurrency(b.tutar)} · {formatDate(b.tarih)}
                </p>
                {b['not'] && <p className="text-xs text-gray-400 mt-1 whitespace-pre-line">Not: {b['not']}</p>}
              </div>
              <span className={'text-sm font-bold ' + dc}>{dl}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {b.dekont_url && (
                <button
                  onClick={() => dekont(b.dekont_url)}
                  className="px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-white"
                >
                  Dekontu aç
                </button>
              )}
              {b.durum === 'bekliyor' && (
                <>
                  <button
                    onClick={() => islem(b, true)}
                    data-testid={`approve_odeme_${b.id}`}
                    className="px-3 py-2 rounded-xl text-xs font-bold bg-teal-400 text-[#0a0e13]"
                  >
                    {meta.isStandaloneEkPlasiyer ? 'Onayla & Ek Plasiyer Ekle' : 'Onayla ve süreyi uzat'}
                  </button>
                  <button
                    onClick={() => islem(b, false)}
                    className="px-3 py-2 rounded-xl text-xs font-bold bg-red-500/20 text-red-300"
                  >
                    Reddet
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
