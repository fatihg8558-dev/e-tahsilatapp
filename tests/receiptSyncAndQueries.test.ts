import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { getTodayIsoLocal, normalizeDateKey } from '../src/lib/formatters.ts';
import {
  computeDashboardReceiptTotals,
  computeDateRangeKeys,
  isDateKeyInRange,
} from '../src/lib/receiptQueryService.ts';
import { analyzeGelirGiderMakbuzLinks } from '../src/lib/kasaSyncService.ts';
import { computeReceiptInsertBalanceUpdate } from '../src/lib/receiptDeleteHelper.ts';
import { GelirGider } from '../src/types/database.ts';

test('getTodayIsoLocal and normalizeDateKey handle local dates and TR DD.MM.YYYY format', () => {
  const localEarlyMorning = new Date(2026, 10, 18, 0, 15, 0); // 18 Nov 2026 00:15 local
  assert.equal(getTodayIsoLocal(localEarlyMorning), '2026-11-18');
  assert.equal(normalizeDateKey('2026-11-18'), '2026-11-18');
  assert.equal(normalizeDateKey('2026-11-18T23:59:00Z'), '2026-11-18');
  assert.equal(normalizeDateKey('18.11.2026'), '2026-11-18');
  assert.equal(normalizeDateKey(''), '');
});

test('computeDateRangeKeys and isDateKeyInRange filter receipts reliably by local YYYY-MM-DD', () => {
  const refDate = new Date(2026, 10, 18, 14, 0, 0); // Çarşamba, 18 Kasım 2026

  const todayRange = computeDateRangeKeys('today', undefined, undefined, refDate);
  assert.deepEqual(todayRange, { startKey: '2026-11-18', endKey: '2026-11-18' });
  assert.equal(isDateKeyInRange('2026-11-18', todayRange.startKey, todayRange.endKey), true);
  assert.equal(isDateKeyInRange('18.11.2026', todayRange.startKey, todayRange.endKey), true);
  assert.equal(isDateKeyInRange('2026-11-17', todayRange.startKey, todayRange.endKey), false);

  const monthRange = computeDateRangeKeys('month', undefined, undefined, refDate);
  assert.deepEqual(monthRange, { startKey: '2026-11-01', endKey: '2026-11-30' });
  assert.equal(isDateKeyInRange('2026-11-01', monthRange.startKey, monthRange.endKey), true);
  assert.equal(isDateKeyInRange('2026-11-30', monthRange.startKey, monthRange.endKey), true);
  assert.equal(isDateKeyInRange('2026-10-31', monthRange.startKey, monthRange.endKey), false);

  const weekRange = computeDateRangeKeys('week', undefined, undefined, refDate);
  assert.deepEqual(weekRange, { startKey: '2026-11-16', endKey: '2026-11-18' });

  const customRange = computeDateRangeKeys('custom', '2026-11-10', '2026-11-18', refDate);
  assert.equal(isDateKeyInRange('2026-11-15', customRange.startKey, customRange.endKey), true);
  assert.equal(isDateKeyInRange('2026-11-09', customRange.startKey, customRange.endKey), false);
});

test('computeDashboardReceiptTotals counts beyond 50 rows and excludes cancelled receipts', () => {
  const rows = [];
  for (let i = 0; i < 65; i++) {
    rows.push({
      tip: 'tahsilat',
      tutar: 100,
      tarih: i < 5 ? '2026-11-18' : '2026-11-10',
      iptal: false,
    });
  }
  rows.push({ tip: 'tahsilat', tutar: 500, tarih: '18.11.2026', iptal: false });
  rows.push({ tip: 'tediye', tutar: 250, tarih: '2026-11-18', iptal: false });
  rows.push({ tip: 'tahsilat', tutar: 9999, tarih: '2026-11-18', iptal: true });

  const totals = computeDashboardReceiptTotals(rows, '2026-11-18');
  assert.equal(totals.toplamTahsilat, 7000);
  assert.equal(totals.toplamTediye, 250);
  assert.equal(totals.bugunTahsilat, 1000);
  assert.equal(totals.bugunTediye, 250);
});

test('analyzeGelirGiderMakbuzLinks detects missing or unclosed islemler records for [MAKBUZ:id] entries', () => {
  const hareketler: GelirGider[] = [
    {
      id: 'gg-1',
      firma_id: 'f1',
      kasa_id: 'k1',
      tip: 'gelir',
      kategori: 'Cari Tahsilat (Nakit)',
      tutar: 1500,
      tarih: '2026-11-18',
      aciklama: '[MAKBUZ:islem-ok] Atlas Gıda',
    },
    {
      id: 'gg-2',
      firma_id: 'f1',
      kasa_id: 'k1',
      tip: 'gelir',
      kategori: 'Cari Tahsilat (Nakit)',
      tutar: 2500,
      tarih: '2026-11-18',
      aciklama: '[MAKBUZ:islem-hidden] Örnek Market',
    },
    {
      id: 'gg-3',
      firma_id: 'f1',
      kasa_id: 'k1',
      tip: 'gelir',
      kategori: 'Cari Tahsilat (Nakit)',
      tutar: 800,
      tarih: '2026-11-18',
      aciklama: '[MAKBUZ:islem-stuck] Deniz Ticaret',
    },
    {
      id: 'gg-4',
      firma_id: 'f1',
      kasa_id: 'k1',
      tip: 'gelir',
      kategori: 'Peşin Satış',
      tutar: 400,
      tarih: '2026-11-18',
      aciklama: 'Şirket içi kasa girişi',
    },
  ];

  const analysis = analyzeGelirGiderMakbuzLinks(hareketler, [
    { id: 'islem-ok', durum: 'aktarildi' },
    { id: 'islem-stuck', durum: 'plasiyerde' },
  ]);

  assert.deepEqual(analysis.linkedMakbuzIds, ['islem-ok', 'islem-hidden', 'islem-stuck']);
  assert.deepEqual(analysis.missingIslemIds, ['islem-hidden']);
  assert.deepEqual(analysis.stillPlasiyerdeIds, ['islem-stuck']);
});

test('computeReceiptInsertBalanceUpdate prevents double-counting when DB trigger ran and updates when trigger missed', () => {
  // Trigger worked: tahsilat of 1000 reduced balance from 5000 to 4000
  const triggerRan = computeReceiptInsertBalanceUpdate({
    beforeVal: 5000,
    afterVal: 4000,
    tutar: 1000,
    tip: 'tahsilat',
  });
  assert.equal(triggerRan.shouldUpdateClient, false);

  // Trigger did NOT run: balance stayed at 5000 after tahsilat of 1000
  const triggerMissedTahsilat = computeReceiptInsertBalanceUpdate({
    beforeVal: 5000,
    afterVal: 5000,
    tutar: 1000,
    tip: 'tahsilat',
  });
  assert.equal(triggerMissedTahsilat.shouldUpdateClient, true);
  assert.equal(triggerMissedTahsilat.nextBakiye, 4000);

  // Trigger did NOT run: balance stayed at 5000 after tediye of 1250
  const triggerMissedTediye = computeReceiptInsertBalanceUpdate({
    beforeVal: 5000,
    afterVal: 5000,
    tutar: 1250,
    tip: 'tediye',
  });
  assert.equal(triggerMissedTediye.shouldUpdateClient, true);
  assert.equal(triggerMissedTediye.nextBakiye, 6250);
});

test('syncIslemToKasa checks islemler update errors instead of silently desyncing kasa', () => {
  const kasaSyncSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/kasaSyncService.ts'),
    'utf8'
  );
  assert.ok(kasaSyncSrc.includes('const { data: updatedStatusRows, error: statusErr }'));
  assert.ok(kasaSyncSrc.includes("Makbuz durumu \"aktarildi\" olarak güncellenemedi"));

  const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(appSrc, /<KasaGelirGiderPage[\s\S]*?onTransferSuccess=/);
});
