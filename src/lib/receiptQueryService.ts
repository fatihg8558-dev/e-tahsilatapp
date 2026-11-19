import { supabase, handleSupabaseError } from './supabase';
import { Islem, IslemDurum, IslemTip } from '../types/database';
import { getTodayIsoLocal, normalizeDateKey } from './formatters';
import { resolvePortfoyDurumu } from './portfoyService';

export type DateRangeFilter = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export function computeDateRangeKeys(
  filter: DateRangeFilter,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date()
): { startKey: string | null; endKey: string | null } {
  const todayKey = getTodayIsoLocal(now);

  if (filter === 'today') {
    return { startKey: todayKey, endKey: todayKey };
  }
  if (filter === 'week') {
    const dayOfWeek = now.getDay() || 7; // 1 = Pazartesi, 7 = Pazar
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
    return { startKey: getTodayIsoLocal(start), endKey: todayKey };
  }
  if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startKey: getTodayIsoLocal(start), endKey: getTodayIsoLocal(end) };
  }
  if (filter === 'year') {
    return { startKey: `${now.getFullYear()}-01-01`, endKey: `${now.getFullYear()}-12-31` };
  }
  if (filter === 'custom') {
    return {
      startKey: customStart ? normalizeDateKey(customStart) || null : null,
      endKey: customEnd ? normalizeDateKey(customEnd) || null : null,
    };
  }
  return { startKey: null, endKey: null };
}

export function isDateKeyInRange(
  tarih: string | null | undefined,
  startKey: string | null,
  endKey: string | null
): boolean {
  if (!startKey && !endKey) return true;
  const itemKey = normalizeDateKey(tarih);
  if (!itemKey) return false;
  if (startKey && itemKey < startKey) return false;
  if (endKey && itemKey > endKey) return false;
  return true;
}

export function computeDashboardReceiptTotals(
  rows: Array<{
    tip: string;
    tutar: number | string | null | undefined;
    tarih?: string | null;
    iptal?: boolean | null;
  }>,
  todayStr: string = getTodayIsoLocal()
): {
  toplamTahsilat: number;
  toplamTediye: number;
  bugunTahsilat: number;
  bugunTediye: number;
} {
  let toplamTahsilat = 0;
  let toplamTediye = 0;
  let bugunTahsilat = 0;
  let bugunTediye = 0;

  for (const islem of rows) {
    if (islem.iptal) continue;
    const tutar = Number(islem.tutar) || 0;
    if (islem.tip === 'tahsilat') toplamTahsilat += tutar;
    else if (islem.tip === 'tediye') toplamTediye += tutar;

    const itemDateKey = normalizeDateKey(islem.tarih);
    if (itemDateKey && itemDateKey === todayStr) {
      if (islem.tip === 'tahsilat') bugunTahsilat += tutar;
      else if (islem.tip === 'tediye') bugunTediye += tutar;
    }
  }

  return { toplamTahsilat, toplamTediye, bugunTahsilat, bugunTediye };
}

export interface VadeItem {
  islem: Islem;
  diffDays: number;
  durumLabel: string;
  durumClass: string;
}

export interface DashboardReceiptsSnapshot {
  toplamTahsilat: number;
  toplamTediye: number;
  bugunTahsilat: number;
  bugunTediye: number;
  sonIslemler: Islem[];
  vadesiYaklasanlar: VadeItem[];
  aktifCariSayisi: number;
  bekleyenBildirimSayisi: number;
}

export const EMPTY_DASHBOARD_SNAPSHOT: DashboardReceiptsSnapshot = {
  toplamTahsilat: 0,
  toplamTediye: 0,
  bugunTahsilat: 0,
  bugunTediye: 0,
  sonIslemler: [],
  vadesiYaklasanlar: [],
  aktifCariSayisi: 0,
  bekleyenBildirimSayisi: 0,
};

const FULL_SELECT =
  '*, cariler:cari_id(unvan, vergi_tc_no, telefon, email), profiles:yapan_user_id(ad_soyad)';
const CARI_ONLY_SELECT = '*, cariler:cari_id(unvan, vergi_tc_no, telefon, email)';

export async function fetchIslemlerList(params: {
  firmaId: string;
  userId?: string | null;
  rol?: string | null;
  filterUserId?: string | null;
  tipFilter?: 'all' | IslemTip;
  durumFilter?: 'all' | IslemDurum;
  startDate?: string;
  endDate?: string;
}): Promise<Islem[]> {
  const buildQuery = (selectClause: string) => {
    let query = supabase
      .from('islemler')
      .select(selectClause)
      .eq('firma_id', params.firmaId)
      .order('tarih', { ascending: false })
      .order('id', { ascending: false });

    if (params.rol === 'plasiyer' && params.userId) {
      query = query.eq('yapan_user_id', params.userId);
    } else if (params.filterUserId && params.filterUserId !== 'all') {
      query = query.eq('yapan_user_id', params.filterUserId);
    }
    if (params.tipFilter && params.tipFilter !== 'all') {
      query = query.eq('tip', params.tipFilter);
    }
    if (params.durumFilter && params.durumFilter !== 'all') {
      query = query.eq('durum', params.durumFilter);
    }
    if (params.startDate) {
      query = query.gte('tarih', params.startDate);
    }
    if (params.endDate) {
      query = query.lte('tarih', params.endDate);
    }
    return query;
  };

  let { data, error } = await buildQuery(FULL_SELECT);
  if (error) {
    const fallback = await buildQuery(CARI_ONLY_SELECT);
    if (!fallback.error) {
      data = fallback.data;
      error = null;
    } else {
      const bare = await buildQuery('*');
      if (!bare.error) {
        data = bare.data;
        error = null;
      } else {
        throw new Error(handleSupabaseError(error, 'İşlemler yüklenirken hata oluştu.'));
      }
    }
  }

  return ((data as unknown) as Islem[]) || [];
}

export async function fetchDashboardReceiptsSnapshot(params: {
  firmaId: string;
  userId?: string | null;
  rol?: string | null;
  vadeAraligiGun: number;
}): Promise<DashboardReceiptsSnapshot> {
  const buildRecentQuery = (selectClause: string) => {
    let query = supabase
      .from('islemler')
      .select(selectClause)
      .eq('firma_id', params.firmaId)
      .order('tarih', { ascending: false })
      .order('id', { ascending: false });

    if (params.rol === 'plasiyer' && params.userId) {
      query = query.eq('yapan_user_id', params.userId);
    }

    return query.limit(8);
  };

  let totalsQuery = supabase
    .from('islemler')
    .select('id, tip, tutar, tarih, iptal')
    .eq('firma_id', params.firmaId);

  if (params.rol === 'plasiyer' && params.userId) {
    totalsQuery = totalsQuery.eq('yapan_user_id', params.userId);
  }

  let { data: islemlerData, error: islemlerErr } = await buildRecentQuery(FULL_SELECT);
  if (islemlerErr) {
    const fallback = await buildRecentQuery(CARI_ONLY_SELECT);
    if (!fallback.error) {
      islemlerData = fallback.data;
      islemlerErr = null;
    } else {
      const bare = await buildRecentQuery('*');
      if (!bare.error) {
        islemlerData = bare.data;
        islemlerErr = null;
      } else {
        throw new Error(
          handleSupabaseError(islemlerErr, 'Gösterge verileri yüklenirken bir hata oluştu.')
        );
      }
    }
  }

  const sonIslemler = ((islemlerData as unknown) as Islem[]) || [];

  const { data: allTotalsRows, error: totalsErr } = await totalsQuery;
  const rowsForTotals =
    !totalsErr && allTotalsRows
      ? (allTotalsRows as Array<{
          tip: string;
          tutar: number | string;
          tarih?: string | null;
          iptal?: boolean | null;
        }>)
      : sonIslemler;

  const { toplamTahsilat, toplamTediye, bugunTahsilat, bugunTediye } =
    computeDashboardReceiptTotals(rowsForTotals, getTodayIsoLocal());

  // 2. Vadesi Yaklaşan Çek ve Senetler
  const { data: cekSenetData, error: cekSenetErr } = await supabase
    .from('islemler')
    .select(CARI_ONLY_SELECT)
    .eq('firma_id', params.firmaId)
    .in('tur', ['cek', 'senet'])
    .eq('iptal', false)
    .not('vade', 'is', null)
    .order('vade', { ascending: true });

  const vadesiYaklasanlar: VadeItem[] = [];
  if (!cekSenetErr && cekSenetData) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    ((cekSenetData as unknown) as Islem[]).forEach((item) => {
      const portfoyDurum = resolvePortfoyDurumu(item);
      if (
        portfoyDurum === 'tahsil_edildi' ||
        portfoyDurum === 'ciro_edildi' ||
        portfoyDurum === 'karsiliksiz'
      ) {
        return;
      }
      const aciklamaUpper = (item.aciklama || '').toUpperCase();
      if (
        aciklamaUpper.includes('CİRO') ||
        aciklamaUpper.includes('CIRO') ||
        (item.durum as string) === 'ciro'
      ) {
        return;
      }

      if (!item.vade) return;
      const cleanVade = item.vade.trim();
      let vDate: Date | null = null;

      if (/^\d{4}-\d{2}-\d{2}$/.test(cleanVade)) {
        const parts = cleanVade.split('-');
        vDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(cleanVade)) {
        const parts = cleanVade.split('.');
        vDate = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      }

      if (!vDate || isNaN(vDate.getTime())) return;
      vDate.setHours(0, 0, 0, 0);

      const diffMs = vDate.getTime() - now.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= params.vadeAraligiGun && diffDays >= -60) {
        let durumLabel = '';
        let durumClass = '';

        if (diffDays < 0) {
          durumLabel = `${Math.abs(diffDays)} GÜN GEÇTİ`;
          durumClass = 'bg-red-500/20 text-red-300 border-red-500/40 font-bold';
        } else if (diffDays === 0) {
          durumLabel = 'BUGÜN VADESİ GELİYOR';
          durumClass = 'bg-amber-500/25 text-amber-300 border-amber-500/50 font-black animate-pulse';
        } else if (diffDays === 1) {
          durumLabel = 'YARIN VADESİ';
          durumClass = 'bg-amber-500/15 text-amber-300 border-amber-500/30 font-bold';
        } else if (diffDays <= 7) {
          durumLabel = `${diffDays} GÜN KALDI`;
          durumClass = 'bg-teal-500/20 text-teal-300 border-teal-500/30 font-bold';
        } else {
          durumLabel = `${diffDays} gün kaldı`;
          durumClass = 'bg-blue-500/10 text-blue-300 border-blue-500/20 font-medium';
        }

        vadesiYaklasanlar.push({
          islem: item,
          diffDays,
          durumLabel,
          durumClass,
        });
      }
    });

    vadesiYaklasanlar.sort((a, b) => a.diffDays - b.diffDays);
  }

  // 3 & 4. Cari ve Bildirim sayıları
  const [{ count: cariCount }, { count: notifCount }] = await Promise.all([
    supabase
      .from('cariler')
      .select('*', { count: 'exact', head: true })
      .eq('firma_id', params.firmaId),
    supabase
      .from('bildirimler')
      .select('*', { count: 'exact', head: true })
      .eq('alici_firma_id', params.firmaId)
      .eq('durum', 'bekliyor'),
  ]);

  return {
    toplamTahsilat,
    toplamTediye,
    bugunTahsilat,
    bugunTediye,
    sonIslemler,
    vadesiYaklasanlar,
    aktifCariSayisi: cariCount ?? 0,
    bekleyenBildirimSayisi: notifCount ?? 0,
  };
}
