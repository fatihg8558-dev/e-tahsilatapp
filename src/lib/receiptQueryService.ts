import { supabase, handleSupabaseError } from './supabase';
import { Islem, IslemDurum, IslemTip } from '../types/database';

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

    return query.limit(50);
  };

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

  const typedIslemler = ((islemlerData as unknown) as Islem[]) || [];
  const sonIslemler = typedIslemler.slice(0, 8);

  const todayStr = new Date().toISOString().split('T')[0];
  let toplamTahsilat = 0;
  let toplamTediye = 0;
  let bugunTahsilat = 0;
  let bugunTediye = 0;

  typedIslemler.forEach((islem) => {
    if (!islem.iptal) {
      const tutar = Number(islem.tutar) || 0;
      if (islem.tip === 'tahsilat') toplamTahsilat += tutar;
      else if (islem.tip === 'tediye') toplamTediye += tutar;

      if (islem.tarih && islem.tarih.startsWith(todayStr)) {
        if (islem.tip === 'tahsilat') bugunTahsilat += tutar;
        else if (islem.tip === 'tediye') bugunTediye += tutar;
      }
    }
  });

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
