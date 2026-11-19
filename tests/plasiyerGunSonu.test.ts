import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGunSonuShareSummary,
  computeCashCountReconciliation,
  computePlasiyerGunSonuSummary,
  parseTrCurrencyInput,
} from '../src/lib/plasiyerGunSonuService.ts';
import { Islem, Profile } from '../src/types/database.ts';

function makeIslem(overrides: Partial<Islem>): Islem {
  return {
    id: overrides.id || 'islem-1',
    firma_id: 'firma-1',
    cari_id: 'cari-1',
    tip: 'tahsilat',
    tur: 'nakit',
    tutar: 1000,
    tarih: '2026-11-18',
    durum: 'plasiyerde',
    iptal: false,
    ...overrides,
  };
}

test('parseTrCurrencyInput parses Turkish and dot-formatted cash counts cleanly', () => {
  assert.equal(parseTrCurrencyInput(''), null);
  assert.equal(parseTrCurrencyInput('  '), null);
  assert.equal(parseTrCurrencyInput('0'), 0);
  assert.equal(parseTrCurrencyInput('12.500,75'), 12500.75);
  assert.equal(parseTrCurrencyInput('1250,5'), 1250.5);
  assert.equal(parseTrCurrencyInput('1250.50'), 1250.5);
  assert.equal(parseTrCurrencyInput('1.250'), 1250);
  assert.equal(parseTrCurrencyInput('-100'), null);
});

test('computePlasiyerGunSonuSummary groups pending vs transferred receipts and excludes iptal & capraz rows', () => {
  const plasiyerler: Profile[] = [
    {
      id: 'p1',
      firma_id: 'firma-1',
      rol: 'plasiyer',
      ad_soyad: 'Ahmet Yılmaz',
      email: 'ahmet@firma.com',
      aktif: true,
    },
    {
      id: 'p2',
      firma_id: 'firma-1',
      rol: 'plasiyer',
      ad_soyad: 'Mehmet Kaya',
      email: 'mehmet@firma.com',
      aktif: true,
    },
  ];

  const rows: Islem[] = [
    makeIslem({ id: '1', tip: 'tahsilat', tur: 'nakit', tutar: 3000, durum: 'plasiyerde', yapan_user_id: 'p1' }),
    makeIslem({ id: '2', tip: 'tediye', tur: 'nakit', tutar: 500, durum: 'plasiyerde', yapan_user_id: 'p1' }),
    makeIslem({ id: '3', tip: 'tahsilat', tur: 'kredi_karti', tutar: 1500, durum: 'plasiyerde', yapan_user_id: 'p1' }),
    makeIslem({ id: '4', tip: 'tahsilat', tur: 'cek', tutar: 4000, durum: 'plasiyerde', yapan_user_id: 'p2' }),
    makeIslem({ id: '5', tip: 'tahsilat', tur: 'senet', tutar: 2000, durum: 'aktarildi', yapan_user_id: 'p2' }),
    makeIslem({ id: '6', tip: 'tahsilat', tur: 'nakit', tutar: 9999, iptal: true, yapan_user_id: 'p1' }),
    makeIslem({ id: '7', tip: 'tahsilat', tur: 'nakit', tutar: 8888, belge_no: 'ÇPZ-001', yapan_user_id: 'p1' }),
  ];

  const s = computePlasiyerGunSonuSummary(rows, plasiyerler);
  assert.equal(s.validCount, 5);
  assert.equal(s.iptalCount, 1);
  assert.equal(s.pendingCount, 4);
  assert.equal(s.transferredCount, 1);
  assert.equal(s.netNakit, 2500);
  assert.equal(s.pendingNetNakit, 2500);
  assert.equal(s.pendingByTur.kredi_karti.net, 1500);
  assert.equal(s.pendingByTur.cek.net, 4000);
  assert.equal(s.netSenet, 2000);
  assert.equal(s.perPlasiyer.length, 2);

  const p1Summary = s.perPlasiyer.find((p) => p.plasiyerId === 'p1');
  assert.ok(p1Summary);
  assert.equal(p1Summary.plasiyerAd, 'Ahmet Yılmaz');
  assert.equal(p1Summary.pendingCount, 3);
  assert.equal(p1Summary.pendingNetNakit, 2500);
  assert.equal(p1Summary.pendingKart, 1500);
});

test('computeCashCountReconciliation computes match, surplus, shortage, and empty states', () => {
  assert.equal(computeCashCountReconciliation(2500, '').status, 'empty');

  const exact = computeCashCountReconciliation(2500, '2.500,00');
  assert.equal(exact.status, 'match');
  assert.equal(exact.difference, 0);

  const surplus = computeCashCountReconciliation(2500, '2650');
  assert.equal(surplus.status, 'surplus');
  assert.equal(surplus.difference, 150);

  const shortage = computeCashCountReconciliation(2500, '2400,50');
  assert.equal(shortage.status, 'shortage');
  assert.equal(shortage.difference, -99.5);
});

test('buildGunSonuShareSummary includes totals, reconciliation status, and handover note', () => {
  const summary = computePlasiyerGunSonuSummary([
    makeIslem({ id: '1', tip: 'tahsilat', tur: 'nakit', tutar: 1200, durum: 'plasiyerde' }),
  ]);
  const rec = computeCashCountReconciliation(1200, '1200');
  const txt = buildGunSonuShareSummary({
    firmaUnvan: 'Örnek Ticaret A.Ş.',
    plasiyerAd: 'Ahmet Yılmaz',
    dateLabel: '18.11.2026',
    summary,
    reconciliation: rec,
    note: 'Merkez kasaya teslim edildi',
  });

  assert.ok(txt.includes('Örnek Ticaret A.Ş.'));
  assert.ok(txt.includes('Ahmet Yılmaz'));
  assert.ok(txt.includes('Tam Mutabakat'));
  assert.ok(txt.includes('Merkez kasaya teslim edildi'));
});

test('Gun Sonu navigation and UI entry points are wired across App, AppLayout, Kasa, and Performans', () => {
  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes("'gun_sonu'"));
  assert.ok(appSrc.includes('PlasiyerGunSonuPage'));

  const layoutSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/layout/AppLayout.tsx'), 'utf8');
  assert.ok(layoutSrc.includes('data-testid="nav_gun_sonu_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_gun_sonu_mobile"'));

  const kasaSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/KasaGelirGiderPage.tsx'), 'utf8');
  assert.ok(kasaSrc.includes('data-testid="kasa_go_gun_sonu_btn"'));

  const perfSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/PlasiyerPerformansPage.tsx'), 'utf8');
  assert.ok(perfSrc.includes('data-testid="performans_go_gun_sonu_btn"'));
});
