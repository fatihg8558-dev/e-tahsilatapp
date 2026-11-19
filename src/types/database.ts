export type UserRole = 'ana' | 'plasiyer' | 'muhasebeci' | 'superadmin';
export type CariTur = 'alici' | 'tedarikci';
export type IslemTip = 'tahsilat' | 'tediye';
export type IslemTur = 'nakit' | 'kredi_karti' | 'cek' | 'senet';
export type IslemDurum = 'aktif' | 'plasiyerde' | 'aktarildi';
export type FaturaYon = 'alis' | 'satis';
export type BildirimDurum = 'bekliyor' | 'onaylandi' | 'red';
export type PortfoyDurum =
  | 'portfoyde'
  | 'tahsilde'
  | 'tahsil_edildi'
  | 'ciro_edildi'
  | 'karsiliksiz';
export type GunSonuOnayDurum = 'onay_bekliyor' | 'onaylandi' | 'reddedildi';

export interface Firma {
  id: string;
  unvan: string;
  vergi_no: string;
  vergi_dairesi?: string | null;
  adres?: string | null;
  telefon?: string | null;
  email?: string | null;
  web?: string | null;
  logo_data?: string | null;
  paket_id?: string | null;
  paket_bitis?: string | null;
  deneme_bitis?: string | null;
  sinirsiz?: boolean | null;
  ek_plasiyer_sayisi?: number | null;
}

export interface Profile {
  id: string;
  firma_id: string;
  ana_hesap_id?: string | null;
  rol: UserRole;
  ad_soyad: string;
  telefon?: string | null;
  email: string;
  aktif: boolean;
}

export interface Cari {
  id: string;
  firma_id: string;
  unvan: string;
  vergi_tc_no?: string | null;
  telefon?: string | null;
  email?: string | null;
  bakiye: number;
  tur: CariTur;
  risk_limiti?: number | null;
}

export interface Islem {
  id: string;
  firma_id: string;
  cari_id: string;
  tip: IslemTip;
  tur: IslemTur;
  tutar: number;
  tarih: string;
  aciklama?: string | null;
  belge_no?: string | null;
  vade?: string | null;
  banka_adi?: string | null;
  yapan_user_id?: string | null;
  durum: IslemDurum;
  makbuz_no?: string | null;
  iptal: boolean;
  iptal_nedeni?: string | null;
  iptal_tarihi?: string | null;
  iptal_eden?: string | null;
  portfoy_durumu?: PortfoyDurum | null;
  portfoy_not?: string | null;
  ciro_cari_id?: string | null;
  tahsil_kasa_id?: string | null;
  portfoy_islem_tarihi?: string | null;
  // Join fields
  cariler?: Cari | null;
  profiles?: { ad_soyad: string } | null;
}

export interface GunSonuKapanis {
  id: string;
  firma_id: string;
  plasiyer_user_id: string;
  plasiyer_ad?: string | null;
  kapanis_tarihi: string;
  beklenen_nakit: number;
  sayilan_nakit: number | null;
  kasa_farki: number;
  kart_toplam: number;
  cek_toplam: number;
  senet_toplam: number;
  islem_idler: string[];
  teslim_notu?: string | null;
  durum: GunSonuOnayDurum;
  red_nedeni?: string | null;
  onaylayan_user_id?: string | null;
  onay_tarihi?: string | null;
  created_at?: string;
}

export interface Fatura {
  id: string;
  firma_id: string;
  cari_id: string;
  fatura_no: string;
  tarih: string;
  tutar: number;
  yon: FaturaYon;
}

export interface Bildirim {
  id: string;
  gonderen_firma_id: string;
  alici_firma_id: string;
  islem_id?: string | null;
  gonderen_unvan: string;
  gonderen_vergi_no: string;
  tip: IslemTip;
  tur: IslemTur;
  tutar: number;
  tarih: string;
  aciklama?: string | null;
  belge_no?: string | null;
  vade?: string | null;
  banka_adi?: string | null;
  durum: BildirimDurum;
}

export interface Paket {
  id: string;
  ad: string;
  sure_gun: number;
  fiyat: number;
  ek_plasiyer_ucreti: number;
  aktif: boolean;
  ozellikler?: string[] | string | null;
}

export interface Ayar {
  id?: string;
  anahtar: string;
  deger: string;
}


export type KasaTur = 'nakit' | 'banka' | 'pos';
export type GelirGiderTip = 'gelir' | 'gider' | 'virman';

export interface Kasa {
  id: string;
  firma_id: string;
  ad: string;
  tur: KasaTur;
  banka_adi: string | null;
  iban: string | null;
  acilis_bakiyesi: number;
  guncel_bakiye: number;
  aktif: boolean;
  created_at: string;
}

export interface GelirGider {
  id: string;
  firma_id: string;
  kasa_id: string;
  hedef_kasa_id: string | null;
  tip: GelirGiderTip;
  kategori: string | null;
  tutar: number;
  tarih: string;
  aciklama: string | null;
  belge_no: string | null;
  yapan_user_id: string | null;
  created_at: string;
}
