import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EK_PLASIYER_FIYAT,
  FIRMA_EK_PLASIYER_AYAR_KEY,
  calculatePackageTotalAmount,
  calculateStandaloneEkPlasiyerAmount,
  formatOdemeNoteWithEkPlasiyer,
  formatStandaloneEkPlasiyerNote,
  getEffectiveEkPlasiyer,
  isMissingEkPlasiyerColumnError,
  parseEkPlasiyerFromNote,
  parseFirmaEkPlasiyerMapFromAyarlar,
  parsePaymentRequestMeta,
  resolvePackageEntitlements,
} from '../src/lib/packageEntitlements';
import type { Ayar, Firma, Paket } from '../src/types/database';

function makeFirma(overrides: Partial<Firma> = {}): Firma {
  return {
    id: 'firma-1',
    unvan: 'Test Ticaret Ltd.',
    vergi_no: '1234567890',
    deneme_baslangic: '2026-11-10T00:00:00.000Z',
    deneme_bitis: '2026-11-17T00:00:00.000Z',
    paket_id: null,
    paket_baslangic: null,
    paket_bitis: null,
    sinirsiz: false,
    ek_plasiyer_sayisi: null,
    olusturma_tarihi: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

function makePaket(overrides: Partial<Paket> = {}): Paket {
  return {
    id: 'paket-1',
    ad: 'Başlangıç (Basic) - Aylık',
    sure_gun: 30,
    fiyat: 200,
    ek_plasiyer_ucreti: 100,
    aktif: true,
    ...overrides,
  };
}

test('7 günlük ücretsiz deneme (active_trial) Kurumsal seviye tüm özellikleri açar', () => {
  const ent = resolvePackageEntitlements({
    firma: makeFirma({ ek_plasiyer_sayisi: 1 }),
    activePaket: null,
    periodStatus: 'active_trial',
    isSuperAdmin: false,
  });

  assert.equal(ent.tierKey, 'kurumsal');
  assert.equal(ent.isTrialFullAccess, true);
  assert.equal(ent.canUsePaymentLink, true);
  assert.equal(ent.canUseNfc, true);
  assert.equal(ent.canUseUblImport, true);
  assert.equal(ent.canUseMutabakat, true);
  assert.equal(ent.includedPlasiyerLimit, 9);
  assert.equal(ent.ekPlasiyerSayisi, 1);
  assert.equal(ent.totalPlasiyerLimit, 10);
});

test('Başlangıç (Basic) paketinde Link, NFC ve UBL kapalıdır; dahil plasiyer 1 dir', () => {
  const ent = resolvePackageEntitlements({
    firma: makeFirma({ ek_plasiyer_sayisi: 2 }),
    activePaket: makePaket({ ad: 'Başlangıç (Basic) - Aylık', fiyat: 200 }),
    periodStatus: 'active_package',
    isSuperAdmin: false,
  });

  assert.equal(ent.tierKey, 'baslangic');
  assert.equal(ent.canUsePaymentLink, false);
  assert.equal(ent.canUseNfc, false);
  assert.equal(ent.canUseUblImport, false);
  assert.equal(ent.canUseMutabakat, false);
  assert.equal(ent.includedPlasiyerLimit, 1);
  assert.equal(ent.ekPlasiyerSayisi, 2);
  assert.equal(ent.totalPlasiyerLimit, 3);
});

test('Profesyonel (Plus) paketinde Link ve NFC açıktır, UBL kapalıdır; dahil plasiyer 3 tür', () => {
  const ent = resolvePackageEntitlements({
    firma: makeFirma({ ek_plasiyer_sayisi: 1 }),
    activePaket: makePaket({ ad: 'Profesyonel (Plus) - 6 Aylık', sure_gun: 180, fiyat: 2000 }),
    periodStatus: 'active_package',
    isSuperAdmin: false,
  });

  assert.equal(ent.tierKey, 'profesyonel');
  assert.equal(ent.canUsePaymentLink, true);
  assert.equal(ent.canUseNfc, true);
  assert.equal(ent.canUseUblImport, false);
  assert.equal(ent.canUseMutabakat, false);
  assert.equal(ent.includedPlasiyerLimit, 3);
  assert.equal(ent.totalPlasiyerLimit, 4);
});

test('Kurumsal (Pro) paketinde Link, NFC ve UBL açıktır; dahil plasiyer 9 dur', () => {
  const ent = resolvePackageEntitlements({
    firma: makeFirma({ ek_plasiyer_sayisi: 3 }),
    activePaket: makePaket({ ad: 'Kurumsal (Pro) - Yıllık', sure_gun: 365, fiyat: 5400 }),
    periodStatus: 'active_package',
    isSuperAdmin: false,
  });

  assert.equal(ent.tierKey, 'kurumsal');
  assert.equal(ent.canUsePaymentLink, true);
  assert.equal(ent.canUseNfc, true);
  assert.equal(ent.canUseUblImport, true);
  assert.equal(ent.canUseMutabakat, true);
  assert.equal(ent.includedPlasiyerLimit, 9);
  assert.equal(ent.totalPlasiyerLimit, 12);
});

test('Sınırsız firma veya Süper Admin tüm Kurumsal yetkilere sahiptir', () => {
  const ent = resolvePackageEntitlements({
    firma: makeFirma({ sinirsiz: true }),
    activePaket: makePaket({ ad: 'Başlangıç (Basic) - Aylık' }),
    periodStatus: 'unlimited',
    isSuperAdmin: false,
  });

  assert.equal(ent.isUnlimited, true);
  assert.equal(ent.tierKey, 'kurumsal');
  assert.equal(ent.canUsePaymentLink, true);
  assert.equal(ent.canUseNfc, true);
  assert.equal(ent.canUseUblImport, true);
  assert.equal(ent.canUseMutabakat, true);
});

test('Ek plasiyer ücreti tüm dönemlerde sabit +100 TL olarak toplam tutara eklenir', () => {
  assert.equal(EK_PLASIYER_FIYAT, 100);
  assert.equal(calculatePackageTotalAmount(200, 1), 300); // Aylık Başlangıç + 1 Ek Plasiyer
  assert.equal(calculatePackageTotalAmount(2000, 2), 2200); // 6 Aylık Profesyonel + 2 Ek Plasiyer
  assert.equal(calculatePackageTotalAmount(5400, 3), 5700); // Yıllık Kurumsal + 3 Ek Plasiyer
  assert.equal(calculatePackageTotalAmount(400, 0), 400);
});

test('Sadece ek plasiyer satın alma tutarı 1 plasiyer için 100 TL, 2 plasiyer için 200 TL hesaplanır', () => {
  assert.equal(calculateStandaloneEkPlasiyerAmount(1), 100);
  assert.equal(calculateStandaloneEkPlasiyerAmount(2), 200);
  assert.equal(calculateStandaloneEkPlasiyerAmount(5), 500);
  assert.equal(calculateStandaloneEkPlasiyerAmount(0), 0);
});

test('Ödeme bildirimi notunda normal paket ve sadece ek plasiyer talepleri ayrıştırılır', () => {
  const note = formatOdemeNoteWithEkPlasiyer(3, 'Havale gönderildi', 'Profesyonel (Plus) - 6 Aylık');
  assert.ok(note);
  assert.match(note, /Ek Plasiyer: 3 Adet/);
  assert.match(note, /Havale gönderildi/);
  assert.equal(parseEkPlasiyerFromNote(note), 3);
  assert.deepEqual(parsePaymentRequestMeta(note), {
    isStandaloneEkPlasiyer: false,
    ekPlasiyerAdet: 3,
  });

  const standaloneNote = formatStandaloneEkPlasiyerNote(2, '2 plasiyer eklensin', 'Başlangıç (Basic) - Aylık');
  assert.match(standaloneNote, /Sadece Ek Plasiyer Ekleme/);
  assert.match(standaloneNote, /Ek Plasiyer: \+2 Adet/);
  assert.match(standaloneNote, /Tutar: 200 TL/);
  assert.deepEqual(parsePaymentRequestMeta(standaloneNote), {
    isStandaloneEkPlasiyer: true,
    ekPlasiyerAdet: 2,
  });

  const zeroNote = formatOdemeNoteWithEkPlasiyer(0, '', 'Başlangıç (Basic) - Aylık');
  assert.equal(parseEkPlasiyerFromNote(zeroNote), 0);
  assert.equal(parseEkPlasiyerFromNote('Sadece açıklama'), null);
});

test('Ek plasiyer kontenjanı firmalar kolonu veya ayarlar fallback haritasından okunur', () => {
  const ayarlar: Ayar[] = [
    {
      id: 'a-1',
      anahtar: FIRMA_EK_PLASIYER_AYAR_KEY,
      deger: JSON.stringify({ 'firma-1': 4, 'firma-2': -5 }),
    },
  ];
  const map = parseFirmaEkPlasiyerMapFromAyarlar(ayarlar);
  assert.equal(map['firma-1'], 4);
  assert.equal(map['firma-2'], 0);

  // Kolon doluysa kolon değeri önceliklidir
  assert.equal(getEffectiveEkPlasiyer({ id: 'firma-1', ek_plasiyer_sayisi: 2 }, map), 2);
  // Kolon null ise ayarlar fallback kullanılır
  assert.equal(getEffectiveEkPlasiyer({ id: 'firma-1', ek_plasiyer_sayisi: null }, map), 4);
});

test('Eksik kolon hatası tespiti PostgREST ve Postgres hata kodlarını yakalar', () => {
  assert.equal(isMissingEkPlasiyerColumnError({ code: 'PGRST204', message: 'column not found' }), true);
  assert.equal(isMissingEkPlasiyerColumnError({ code: '42703', message: 'column ek_plasiyer_sayisi does not exist' }), true);
  assert.equal(isMissingEkPlasiyerColumnError({ code: '42501', message: 'permission denied' }), false);
});
