import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import { Bildirim, Islem } from '../../types/database';
import { formatCurrency, formatDate } from '../../lib/formatters';
import {
  Bell,
  X,
  CheckCircle2,
  XCircle,
  CalendarClock,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ChevronRight,
  Inbox,
  AlertCircle,
} from 'lucide-react';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMakbuz: (islem: Islem) => void;
  onNavigateTab: (tab: string) => void;
  onBadgeUpdated?: () => void;
}

interface VadeAlertItem {
  islem: Islem;
  diffDays: number;
  durumLabel: string;
  durumClass: string;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  onOpenMakbuz,
  onNavigateTab,
  onBadgeUpdated,
}) => {
  const { firma } = useAuth();
  const [activeTab, setActiveTab] = useState<'gelen' | 'vade'>('gelen');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bildirimler, setBildirimler] = useState<Bildirim[]>([]);
  const [vadeAlerts, setVadeAlerts] = useState<VadeAlertItem[]>([]);

  const loadNotifications = useCallback(async () => {
    if (!firma?.id) return;
    try {
      setLoading(true);
      setError(null);

      const [bildirimRes, cekSenetRes] = await Promise.all([
        supabase
          .from('bildirimler')
          .select('*')
          .eq('alici_firma_id', firma.id)
          .order('tarih', { ascending: false })
          .order('id', { ascending: false })
          .limit(30),
        supabase
          .from('islemler')
          .select('*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)')
          .eq('firma_id', firma.id)
          .in('tur', ['cek', 'senet'])
          .eq('iptal', false)
          .not('vade', 'is', null)
          .order('vade', { ascending: true }),
      ]);

      if (bildirimRes.error) {
        setError(handleSupabaseError(bildirimRes.error, 'Bildirimler yüklenemedi.'));
      } else if (bildirimRes.data) {
        setBildirimler(bildirimRes.data as Bildirim[]);
      }

      if (!cekSenetRes.error && cekSenetRes.data) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const alerts: VadeAlertItem[] = [];

        cekSenetRes.data.forEach((item: any) => {
          const aciklamaUpper = (item.aciklama || '').toUpperCase();
          if (aciklamaUpper.includes('CİRO') || aciklamaUpper.includes('CIRO') || item.durum === 'ciro') {
            return;
          }
          if (!item.vade) return;
          const cleanVade = String(item.vade).trim();
          let vDate: Date | null = null;

          if (/^\d{4}-\d{2}-\d{2}/.test(cleanVade)) {
            const parts = cleanVade.slice(0, 10).split('-');
            vDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(cleanVade)) {
            const parts = cleanVade.split('.');
            vDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
          }

          if (!vDate || isNaN(vDate.getTime())) return;
          vDate.setHours(0, 0, 0, 0);

          const diffDays = Math.round((vDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays <= 15 && diffDays >= -60) {
            let durumLabel = '';
            let durumClass = '';
            if (diffDays < 0) {
              durumLabel = `${Math.abs(diffDays)} GÜN GEÇTİ`;
              durumClass = 'bg-red-500/20 text-red-300 border-red-500/40';
            } else if (diffDays === 0) {
              durumLabel = 'BUGÜN VADESİ';
              durumClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
            } else if (diffDays === 1) {
              durumLabel = 'YARIN';
              durumClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
            } else {
              durumLabel = `${diffDays} GÜN KALDI`;
              durumClass = 'bg-teal-500/15 text-teal-300 border-teal-500/30';
            }
            alerts.push({ islem: item as Islem, diffDays, durumLabel, durumClass });
          }
        });

        alerts.sort((a, b) => a.diffDays - b.diffDays);
        setVadeAlerts(alerts);
      }
    } catch (err) {
      setError(handleSupabaseError(err, 'Bildirimler alınırken hata oluştu.'));
    } finally {
      setLoading(false);
    }
  }, [firma?.id]);

  useEffect(() => {
    if (isOpen && firma?.id) {
      loadNotifications();
    }
  }, [isOpen, firma?.id, loadNotifications]);

  if (!isOpen) return null;

  const pendingCount = bildirimler.filter((b) => b.durum === 'bekliyor').length;

  const handleUpdateBildirim = async (b: Bildirim, durum: 'onaylandi' | 'red') => {
    try {
      setUpdatingId(b.id);
      setError(null);
      const { error: updErr } = await supabase
        .from('bildirimler')
        .update({ durum })
        .eq('id', b.id);

      if (updErr) throw updErr;

      setBildirimler((prev) =>
        prev.map((item) => (item.id === b.id ? { ...item, durum } : item))
      );
      onBadgeUpdated?.();
    } catch (err) {
      setError(handleSupabaseError(err, 'Bildirim durumu güncellenemedi.'));
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-[#111c2e] border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* BAŞLIK */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-black/25">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 flex items-center justify-center relative">
              <Bell className="w-5 h-5" />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 min-w-[18px] h-[18px] rounded-full bg-teal-400 text-slate-950 text-[10px] font-black flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white tracking-tight">Bildirim Merkezi</h2>
              <p className="text-[11px] text-slate-400">
                Gelen firma bildirimleri ve yaklaşan çek/senet vadeleri
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadNotifications}
              disabled={loading}
              title="Bildirimleri Yenile"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Kapat"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* SEKMELER */}
        <div className="flex items-center gap-2 px-4 sm:px-5 pt-3 border-b border-white/[0.07] bg-black/15">
          <button
            type="button"
            onClick={() => setActiveTab('gelen')}
            data-testid="notifications_tab_gelen"
            className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-xs font-bold transition ${
              activeTab === 'gelen'
                ? 'border-teal-400 text-teal-400 bg-teal-500/5'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Inbox className="w-4 h-4" />
            <span>Gelen Bildirimler</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-teal-400/20 text-teal-300 font-extrabold">
              {pendingCount > 0 ? `${pendingCount} Yeni` : bildirimler.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('vade')}
            data-testid="notifications_tab_vade"
            className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 text-xs font-bold transition ${
              activeTab === 'vade'
                ? 'border-amber-400 text-amber-300 bg-amber-500/5'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <CalendarClock className="w-4 h-4" />
            <span>Vade Hatırlatıcıları</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-400/20 text-amber-300 font-extrabold">
              {vadeAlerts.length}
            </span>
          </button>
        </div>

        {/* İÇERİK */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center">
              <div className="w-7 h-7 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <span className="text-xs text-slate-400">Bildirimler yükleniyor...</span>
            </div>
          ) : activeTab === 'gelen' ? (
            bildirimler.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Bell className="w-10 h-10 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-200">Henüz gelen bildiriminiz yok</div>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Karşı firmalardan gönderilen tahsilat veya tediye bildirimleri burada görüntülenir.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {bildirimler.map((b) => (
                  <div
                    key={b.id}
                    className="p-3.5 rounded-xl bg-[#0b1322] border border-white/[0.07] space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold text-white truncate">
                            {b.gonderen_unvan}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              b.durum === 'bekliyor'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : b.durum === 'onaylandi'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : 'bg-red-500/15 text-red-300 border border-red-500/30'
                            }`}
                          >
                            {b.durum === 'bekliyor'
                              ? 'Onay Bekliyor'
                              : b.durum === 'onaylandi'
                              ? 'Onaylandı'
                              : 'Reddedildi'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                          <span>VKN: {b.gonderen_vergi_no}</span>
                          <span>•</span>
                          <span className="uppercase">{b.tip} / {b.tur.replace('_', ' ')}</span>
                          <span>•</span>
                          <span>{formatDate(b.tarih)}</span>
                          {b.belge_no && (
                            <>
                              <span>•</span>
                              <span>No: {b.belge_no}</span>
                            </>
                          )}
                        </div>
                        {b.aciklama && (
                          <p className="text-[11px] text-slate-300 mt-1.5 bg-white/[0.03] px-2.5 py-1.5 rounded-lg">
                            {b.aciklama}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-teal-400 font-mono">
                          {formatCurrency(b.tutar)}
                        </div>
                      </div>
                    </div>

                    {b.durum === 'bekliyor' && (
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.05]">
                        <button
                          type="button"
                          disabled={updatingId === b.id}
                          onClick={() => handleUpdateBildirim(b, 'red')}
                          className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-bold flex items-center gap-1 transition"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reddet</span>
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === b.id}
                          onClick={() => handleUpdateBildirim(b, 'onaylandi')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1 transition"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Onayla</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : vadeAlerts.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-teal-400/70 mx-auto" />
              <div className="text-sm font-bold text-slate-200">Yaklaşan veya gecikmiş vade yok</div>
              <p className="text-xs text-slate-400">
                Önümüzdeki 15 gün içinde vadesi gelen çek veya senet kaydı bulunmuyor.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {vadeAlerts.map((item) => (
                <button
                  key={item.islem.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenMakbuz(item.islem);
                  }}
                  className="w-full text-left p-3.5 rounded-xl bg-[#0b1322] hover:bg-white/[0.04] border border-white/[0.07] hover:border-teal-400/30 transition flex items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        item.islem.tip === 'tahsilat'
                          ? 'bg-teal-500/15 text-teal-400'
                          : 'bg-orange-500/15 text-orange-400'
                      }`}
                    >
                      {item.islem.tip === 'tahsilat' ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-white truncate">
                          {item.islem.cariler?.unvan || 'Cari'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${item.durumClass}`}>
                          {item.durumLabel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {item.islem.tur === 'cek' ? 'Çek' : 'Senet'} • Vade:{' '}
                        <strong className="text-slate-200">{formatDate(item.islem.vade)}</strong>
                        {item.islem.belge_no ? ` • No: ${item.islem.belge_no}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <span className="text-xs font-black text-white font-mono">
                      {formatCurrency(item.islem.tutar)}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ALT ÇUBUK */}
        <div className="p-3.5 sm:p-4 border-t border-white/[0.08] bg-black/25 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onNavigateTab('islemler');
            }}
            className="text-xs font-bold text-teal-400 hover:text-teal-300 flex items-center gap-1"
          >
            <span>Tüm İşlemleri Gör</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-bold transition"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
