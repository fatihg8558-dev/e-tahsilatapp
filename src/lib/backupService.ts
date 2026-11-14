import { supabase, handleSupabaseError } from './supabase';
import { isMissingKasaTableError } from './kasaSql';
import {
  Bildirim,
  Cari,
  Fatura,
  Firma,
  GelirGider,
  Islem,
  Kasa,
  Profile,
} from '../types/database';
import { User } from '@supabase/supabase-js';

export interface AppBackupPayload {
  version: 1;
  app: 'Tahsilatim';
  exported_at: string;
  firma_id: string;
  firma_unvan: string;
  exported_by: {
    id: string;
    email: string;
    ad_soyad: string;
    rol: string;
  };
  data: {
    firma?: Partial<Firma> | null;
    cariler: Cari[];
    islemler: Islem[];
    faturalar: Fatura[];
    kasalar: Kasa[];
    gelir_giderler: GelirGider[];
    bildirimler: Bildirim[];
  };
}

export interface RestorePoint {
  id: string;
  label: string;
  created_at: string;
  created_by: string;
  firma_id: string;
  counts: {
    cariler: number;
    islemler: number;
    faturalar: number;
    kasalar: number;
    gelir_giderler: number;
  };
  payload: AppBackupPayload;
}

export interface RestoreResult {
  success: boolean;
  restored: {
    cariler: number;
    faturalar: number;
    islemler: number;
    kasalar: number;
    gelir_giderler: number;
  };
  warnings: string[];
  error?: string;
}

declare global {
  interface Window {
    __ANDROID_PENDING_TAB__?: string;
    __ANDROID_CEP_POS_CALLBACK__?: Record<string, string>;
    AndroidBridge?: {
      sharePdfFile?: (
        base64Data: string,
        fileName: string,
        targetApp: string,
        recipient: string,
        subject: string,
        caption: string
      ) => boolean;
      sendWhatsApp?: (phone: string, message: string) => boolean;
      openExternal?: (url: string) => boolean;
      saveAndShareTextFile?: (
        content: string,
        fileName: string,
        mimeType: string
      ) => boolean;
      requestPinHomeWidget?: () => boolean;
      getNfcStatus?: () => 'ready' | 'disabled' | 'unsupported' | string;
      openNfcSettings?: () => boolean;
      startNfcReader?: () => 'started' | 'disabled' | 'unsupported' | string;
      stopNfcReader?: () => boolean;
      isCepPosAppInstalled?: () => boolean;
      launchCepPosDeepLink?: (deepLinkUrl?: string) => boolean;
    };
  }
}

const getTodayKey = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const lastBackupStorageKey = (firmaId: string, userId: string) =>
  `tahsilatim_last_backup_${firmaId}_${userId}`;

const fridayDismissStorageKey = (firmaId: string, userId: string) =>
  `tahsilatim_friday_dismissed_${firmaId}_${userId}`;

const restorePointsStorageKey = (firmaId: string) =>
  `tahsilatim_restore_points_${firmaId}`;

export function getLastBackupAt(firmaId?: string, userId?: string): string | null {
  if (!firmaId || !userId) return null;
  try {
    return localStorage.getItem(lastBackupStorageKey(firmaId, userId));
  } catch {
    return null;
  }
}

export function markBackupTakenNow(firmaId?: string, userId?: string): string {
  const nowIso = new Date().toISOString();
  if (firmaId && userId) {
    try {
      localStorage.setItem(lastBackupStorageKey(firmaId, userId), nowIso);
    } catch {
      // ignore
    }
  }
  return nowIso;
}

export function isFridayBackupReminderDue(firmaId?: string, userId?: string): boolean {
  if (!firmaId || !userId) return false;
  const now = new Date();
  // 5 = Cuma (Sunday=0 .. Saturday=6)
  if (now.getDay() !== 5) return false;

  const today = getTodayKey();
  try {
    const dismissedDate = localStorage.getItem(fridayDismissStorageKey(firmaId, userId));
    if (dismissedDate === today) return false;

    const lastBackup = localStorage.getItem(lastBackupStorageKey(firmaId, userId));
    if (lastBackup) {
      const lastDate = new Date(lastBackup);
      const lastKey = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
      if (lastKey === today) return false;
    }
  } catch {
    // ignore
  }
  return true;
}

export function dismissFridayBackupReminder(firmaId?: string, userId?: string): void {
  if (!firmaId || !userId) return;
  try {
    localStorage.setItem(fridayDismissStorageKey(firmaId, userId), getTodayKey());
  } catch {
    // ignore
  }
}

export function getNextFridayLabel(): string {
  const now = new Date();
  const day = now.getDay();
  if (day === 5) return 'Bugün Cuma (Yedekleme Günü)';
  const diff = (5 - day + 7) % 7 || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  return next.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });
}

/**
 * Kullanıcının rolüne göre erişebildiği tüm uygulama verilerini JSON yedek paketi olarak toplar.
 */
export async function createAppBackupPayload(
  firma: Firma,
  profile: Profile | null,
  user: User | null
): Promise<AppBackupPayload> {
  const firmaId = firma.id;
  const isPlasiyer = profile?.rol === 'plasiyer';

  // 1. Cariler
  const { data: carilerData, error: carilerErr } = await supabase
    .from('cariler')
    .select('*')
    .eq('firma_id', firmaId)
    .order('unvan', { ascending: true });
  if (carilerErr) throw carilerErr;

  // 2. İşlemler (Plasiyer sadece kendi kestiği işlemleri, diğer roller tüm firmayı yedekler)
  let islemlerQuery = supabase
    .from('islemler')
    .select('*')
    .eq('firma_id', firmaId)
    .order('tarih', { ascending: false });
  if (isPlasiyer && profile?.id) {
    islemlerQuery = islemlerQuery.eq('yapan_user_id', profile.id);
  }
  const { data: islemlerData, error: islemlerErr } = await islemlerQuery;
  if (islemlerErr) throw islemlerErr;

  // 3. Faturalar (varsa)
  let faturalarData: Fatura[] = [];
  const { data: fatRes, error: fatErr } = await supabase
    .from('faturalar')
    .select('*')
    .eq('firma_id', firmaId);
  if (!fatErr && fatRes) {
    faturalarData = fatRes as Fatura[];
  }

  // 4. Kasalar & Gelir-Gider (Plasiyer harici roller ve kasa tablosu kurulmuşsa)
  let kasalarData: Kasa[] = [];
  let gelirGiderData: GelirGider[] = [];
  if (!isPlasiyer) {
    const { data: kasaRes, error: kasaErr } = await supabase
      .from('kasalar')
      .select('*')
      .eq('firma_id', firmaId);
    if (!kasaErr && kasaRes) {
      kasalarData = kasaRes as Kasa[];
    } else if (kasaErr && !isMissingKasaTableError(kasaErr)) {
      console.warn('Backup kasalar warning:', kasaErr);
    }

    const { data: ggRes, error: ggErr } = await supabase
      .from('gelir_giderler')
      .select('*')
      .eq('firma_id', firmaId);
    if (!ggErr && ggRes) {
      gelirGiderData = ggRes as GelirGider[];
    } else if (ggErr && !isMissingKasaTableError(ggErr)) {
      console.warn('Backup gelir_giderler warning:', ggErr);
    }
  }

  // 5. Bildirimler (varsa)
  let bildirimlerData: Bildirim[] = [];
  if (!isPlasiyer) {
    const { data: bRes, error: bErr } = await supabase
      .from('bildirimler')
      .select('*')
      .eq('alici_firma_id', firmaId);
    if (!bErr && bRes) {
      bildirimlerData = bRes as Bildirim[];
    }
  }

  const safeFirma: Partial<Firma> = {
    id: firma.id,
    unvan: firma.unvan,
    vergi_no: firma.vergi_no,
    vergi_dairesi: firma.vergi_dairesi ?? null,
    adres: firma.adres ?? null,
    telefon: firma.telefon ?? null,
    email: firma.email ?? null,
    web: firma.web ?? null,
  };

  return {
    version: 1,
    app: 'Tahsilatim',
    exported_at: new Date().toISOString(),
    firma_id: firma.id,
    firma_unvan: firma.unvan || 'Firma',
    exported_by: {
      id: profile?.id || user?.id || '',
      email: profile?.email || user?.email || '',
      ad_soyad: profile?.ad_soyad || user?.email || 'Kullanıcı',
      rol: profile?.rol || 'ana',
    },
    data: {
      firma: safeFirma,
      cariler: (carilerData as Cari[]) || [],
      islemler: (islemlerData as Islem[]) || [],
      faturalar: faturalarData,
      kasalar: kasalarData,
      gelir_giderler: gelirGiderData,
      bildirimler: bildirimlerData,
    },
  };
}

/**
 * JSON yedek dosyasını indirir (Web tarayıcısında direkt indirir, Android APK içinde paylaşım/kayıt menüsü açar).
 */
export function downloadJsonBackup(payload: AppBackupPayload): string {
  const jsonText = JSON.stringify(payload, null, 2);
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  const cleanName = (payload.firma_unvan || 'tahsilatim')
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöç_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const fileName = `tahsilatim_yedek_${cleanName || 'firma'}_${stamp}.json`;

  if (typeof window !== 'undefined' && window.AndroidBridge?.saveAndShareTextFile) {
    const handled = window.AndroidBridge.saveAndShareTextFile(
      jsonText,
      fileName,
      'application/json'
    );
    if (handled) {
      markBackupTakenNow(payload.firma_id, payload.exported_by.id);
      return fileName;
    }
  }

  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  markBackupTakenNow(payload.firma_id, payload.exported_by.id);
  return fileName;
}

export function getRestorePoints(firmaId?: string): RestorePoint[] {
  if (!firmaId) return [];
  try {
    const raw = localStorage.getItem(restorePointsStorageKey(firmaId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RestorePoint[]) : [];
  } catch {
    return [];
  }
}

export function saveRestorePoint(
  firmaId: string,
  label: string,
  payload: AppBackupPayload
): RestorePoint {
  const existing = getRestorePoints(firmaId);
  const newPoint: RestorePoint = {
    id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: label.trim() || `Geri Yükleme Noktası (${new Date().toLocaleString('tr-TR')})`,
    created_at: new Date().toISOString(),
    created_by: payload.exported_by.ad_soyad || payload.exported_by.email || 'Kullanıcı',
    firma_id: firmaId,
    counts: {
      cariler: payload.data.cariler.length,
      islemler: payload.data.islemler.length,
      faturalar: payload.data.faturalar.length,
      kasalar: payload.data.kasalar.length,
      gelir_giderler: payload.data.gelir_giderler.length,
    },
    payload,
  };

  let list = [newPoint, ...existing].slice(0, 5);
  while (list.length > 0) {
    try {
      localStorage.setItem(restorePointsStorageKey(firmaId), JSON.stringify(list));
      break;
    } catch {
      // localStorage kotası dolarsa en eski noktayı düşür
      if (list.length === 1) {
        throw new Error('Tarayıcı/cihaz depolama alanı dolu. Lütfen JSON dosyası olarak indirip saklayınız.');
      }
      list = list.slice(0, list.length - 1);
    }
  }

  markBackupTakenNow(firmaId, payload.exported_by.id);
  return newPoint;
}

export function deleteRestorePoint(firmaId: string, pointId: string): RestorePoint[] {
  const next = getRestorePoints(firmaId).filter((p) => p.id !== pointId);
  try {
    localStorage.setItem(restorePointsStorageKey(firmaId), JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function parseBackupJson(rawText: string): AppBackupPayload {
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Seçilen dosya geçerli bir JSON formatında değil.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.data ||
    !Array.isArray(parsed.data.cariler) ||
    !Array.isArray(parsed.data.islemler)
  ) {
    throw new Error('Bu dosya geçerli bir Tahsilatım JSON yedek dosyası değil.');
  }

  return {
    version: 1,
    app: 'Tahsilatim',
    exported_at: parsed.exported_at || new Date().toISOString(),
    firma_id: parsed.firma_id || '',
    firma_unvan: parsed.firma_unvan || 'Yedek Firma',
    exported_by: parsed.exported_by || {
      id: '',
      email: '',
      ad_soyad: 'Kullanıcı',
      rol: 'ana',
    },
    data: {
      firma: parsed.data.firma || null,
      cariler: parsed.data.cariler || [],
      islemler: parsed.data.islemler || [],
      faturalar: Array.isArray(parsed.data.faturalar) ? parsed.data.faturalar : [],
      kasalar: Array.isArray(parsed.data.kasalar) ? parsed.data.kasalar : [],
      gelir_giderler: Array.isArray(parsed.data.gelir_giderler)
        ? parsed.data.gelir_giderler
        : [],
      bildirimler: Array.isArray(parsed.data.bildirimler) ? parsed.data.bildirimler : [],
    },
  };
}

/**
 * JSON yedekten veya geri yükleme noktasından verileri güvenli sırayla veritabanına geri yükler.
 * İşlem öncesi otomatik bir güvenlik geri yükleme noktası alır.
 */
export async function restoreFromBackupPayload(
  payload: AppBackupPayload,
  currentFirma: Firma,
  currentProfile: Profile | null,
  currentUser: User | null
): Promise<RestoreResult> {
  const targetFirmaId = currentFirma.id;
  const isPlasiyer = currentProfile?.rol === 'plasiyer';
  const currentUserId = currentProfile?.id || currentUser?.id || null;
  const warnings: string[] = [];
  const restored = {
    cariler: 0,
    faturalar: 0,
    islemler: 0,
    kasalar: 0,
    gelir_giderler: 0,
  };

  try {
    // 0. Geri yükleme öncesi otomatik güvenlik anlık görüntüsü al
    try {
      const preSnapshot = await createAppBackupPayload(
        currentFirma,
        currentProfile,
        currentUser
      );
      saveRestorePoint(
        targetFirmaId,
        `Geri Yükleme Öncesi Otomatik (${new Date().toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        })})`,
        preSnapshot
      );
    } catch {
      warnings.push('Geri yükleme öncesi otomatik nokta cihaz hafızasına kaydedilemedi.');
    }

    // 1. Cariler
    const carilerRows = (payload.data.cariler || []).map((c) => ({
      id: c.id,
      firma_id: targetFirmaId,
      unvan: c.unvan,
      vergi_tc_no: c.vergi_tc_no ?? null,
      telefon: c.telefon ?? null,
      email: c.email ?? null,
      bakiye: Number(c.bakiye) || 0,
      tur: c.tur || 'alici',
    }));

    if (carilerRows.length > 0) {
      const { error: cErr } = await supabase
        .from('cariler')
        .upsert(carilerRows, { onConflict: 'id' });
      if (cErr) {
        throw new Error(`Cariler geri yüklenemedi: ${handleSupabaseError(cErr)}`);
      }
      restored.cariler = carilerRows.length;
    }

    // 2. Faturalar
    const faturalarRows = (payload.data.faturalar || []).map((f) => ({
      id: f.id,
      firma_id: targetFirmaId,
      cari_id: f.cari_id,
      fatura_no: f.fatura_no,
      tarih: f.tarih,
      tutar: Number(f.tutar) || 0,
      yon: f.yon,
    }));

    if (faturalarRows.length > 0 && !isPlasiyer) {
      const { error: fErr } = await supabase
        .from('faturalar')
        .upsert(faturalarRows, { onConflict: 'id' });
      if (fErr) {
        warnings.push(`Faturalar kısmen atlandı: ${handleSupabaseError(fErr)}`);
      } else {
        restored.faturalar = faturalarRows.length;
      }
    }

    // 3. İşlemler (Makbuzlar)
    const rawIslemler = isPlasiyer
      ? (payload.data.islemler || []).filter(
          (i) => !i.yapan_user_id || i.yapan_user_id === currentUserId
        )
      : payload.data.islemler || [];

    const islemlerRows = rawIslemler.map((i) => ({
      id: i.id,
      firma_id: targetFirmaId,
      cari_id: i.cari_id,
      tip: i.tip,
      tur: i.tur,
      tutar: Number(i.tutar) || 0,
      tarih: i.tarih,
      aciklama: i.aciklama ?? null,
      belge_no: i.belge_no ?? null,
      vade: i.vade ?? null,
      banka_adi: i.banka_adi ?? null,
      yapan_user_id: isPlasiyer ? currentUserId : i.yapan_user_id ?? currentUserId,
      durum: i.durum || 'aktif',
      makbuz_no: i.makbuz_no ?? null,
      iptal: Boolean(i.iptal),
      iptal_nedeni: i.iptal_nedeni ?? null,
      iptal_tarihi: i.iptal_tarihi ?? null,
      iptal_eden: i.iptal_eden ?? null,
    }));

    if (islemlerRows.length > 0) {
      const { error: iErr } = await supabase
        .from('islemler')
        .upsert(islemlerRows, { onConflict: 'id' });

      if (iErr) {
        // Eski yapan_user_id silinmiş bir kullanıcıya aitse mevcut kullanıcıyla tekrar dene
        const fallbackRows = islemlerRows.map((r) => ({
          ...r,
          yapan_user_id: currentUserId,
        }));
        const { error: retryErr } = await supabase
          .from('islemler')
          .upsert(fallbackRows, { onConflict: 'id' });

        if (retryErr) {
          warnings.push(`Makbuzlar geri yüklenirken hata: ${handleSupabaseError(retryErr)}`);
        } else {
          restored.islemler = fallbackRows.length;
        }
      } else {
        restored.islemler = islemlerRows.length;
      }
    }

    // 4. Kasalar & Gelir-Gider (Plasiyer harici roller için)
    if (!isPlasiyer) {
      const kasalarRows = (payload.data.kasalar || []).map((k) => ({
        id: k.id,
        firma_id: targetFirmaId,
        ad: k.ad,
        tur: k.tur,
        banka_adi: k.banka_adi ?? null,
        iban: k.iban ?? null,
        acilis_bakiyesi: Number(k.acilis_bakiyesi) || 0,
        guncel_bakiye: Number(k.guncel_bakiye) || 0,
        aktif: k.aktif ?? true,
      }));

      if (kasalarRows.length > 0) {
        const { error: kErr } = await supabase
          .from('kasalar')
          .upsert(kasalarRows, { onConflict: 'id' });
        if (kErr && !isMissingKasaTableError(kErr)) {
          warnings.push(`Kasalar geri yüklenemedi: ${handleSupabaseError(kErr)}`);
        } else if (!kErr) {
          restored.kasalar = kasalarRows.length;
        }
      }

      const ggRows = (payload.data.gelir_giderler || []).map((g) => ({
        id: g.id,
        firma_id: targetFirmaId,
        kasa_id: g.kasa_id,
        hedef_kasa_id: g.hedef_kasa_id ?? null,
        tip: g.tip,
        kategori: g.kategori || 'Diğer',
        tutar: Number(g.tutar) || 0,
        tarih: g.tarih,
        aciklama: g.aciklama ?? null,
        belge_no: g.belge_no ?? null,
        yapan_user_id: currentUserId,
      }));

      if (ggRows.length > 0) {
        const { error: ggErr } = await supabase
          .from('gelir_giderler')
          .upsert(ggRows, { onConflict: 'id' });
        if (ggErr && !isMissingKasaTableError(ggErr)) {
          warnings.push(`Gelir/Gider kayıtları atlandı: ${handleSupabaseError(ggErr)}`);
        } else if (!ggErr) {
          restored.gelir_giderler = ggRows.length;
        }
      }
    }

    return {
      success: true,
      restored,
      warnings,
    };
  } catch (err: unknown) {
    return {
      success: false,
      restored,
      warnings,
      error: handleSupabaseError(err, 'Yedek geri yüklenirken hata oluştu.'),
    };
  }
}
