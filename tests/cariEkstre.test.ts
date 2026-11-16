import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCariEkstre, formatEkstreBakiye, RawEkstreMovement } from '../src/lib/cariEkstreHelper.ts';

test('buildCariEkstre orders movements chronologically and puts invoice before payment on the same date', () => {
  const movements: RawEkstreMovement[] = [
    // Ödeme array'de faturadan önce gelse bile aynı tarihte faturanın altında olmalı
    {
      id: 'islem-1',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tahsilat',
      tur: 'nakit',
      tutar: 400,
      tarih: '2026-11-14T08:00:00Z',
      makbuz_no: 'THS-0001',
      durum: 'aktif',
      iptal: false,
    },
    {
      id: 'fatura-1',
      firma_id: 'f1',
      cari_id: 'c1',
      fatura_no: 'ACE2026000001',
      tarih: '2026-11-14',
      tutar: 1000,
      yon: 'satis',
    },
    {
      id: 'fatura-0',
      firma_id: 'f1',
      cari_id: 'c1',
      fatura_no: 'ACE2026000000',
      tarih: '2026-10-15',
      tutar: 500,
      yon: 'satis',
    },
  ];

  const res = buildCariEkstre({
    movements,
    currentCariBakiye: 1100,
  });

  assert.equal(res.rows.length, 3);
  assert.equal(res.rows[0].belgeNo, 'ACE2026000000');
  assert.equal(res.rows[0].borc, 500);
  assert.equal(res.rows[0].alacak, 0);
  assert.equal(res.rows[0].bakiye, 500);

  // 14.11.2026 tarihinde önce fatura, sonra ödeme
  assert.equal(res.rows[1].belgeNo, 'ACE2026000001');
  assert.equal(res.rows[1].isInvoice, true);
  assert.equal(res.rows[1].borc, 1000);
  assert.equal(res.rows[1].alacak, 0);
  assert.equal(res.rows[1].bakiye, 1500);

  assert.equal(res.rows[2].belgeNo, 'THS-0001');
  assert.equal(res.rows[2].isPayment, true);
  assert.equal(res.rows[2].borc, 0);
  assert.equal(res.rows[2].alacak, 400);
  assert.equal(res.rows[2].bakiye, 1100);

  assert.equal(res.summary.totalBorc, 1500);
  assert.equal(res.summary.totalAlacak, 400);
  assert.equal(res.summary.closingBalance, 1100);
});

test('buildCariEkstre handles cancelled rows, tediye, alis invoices, and date-range Devreden Bakiye', () => {
  const movements: RawEkstreMovement[] = [
    {
      id: 'f-old',
      firma_id: 'f1',
      cari_id: 'c1',
      fatura_no: 'FAT-01',
      tarih: '2026-10-01',
      tutar: 2000,
      yon: 'satis',
    },
    {
      id: 'i-old',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tahsilat',
      tur: 'nakit',
      tutar: 500,
      tarih: '2026-10-05',
      makbuz_no: 'THS-01',
      durum: 'aktif',
      iptal: false,
    },
    {
      id: 'i-cancelled',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tahsilat',
      tur: 'nakit',
      tutar: 999,
      tarih: '2026-10-20',
      makbuz_no: 'THS-02',
      durum: 'aktif',
      iptal: true,
    },
    {
      id: 'f-alis',
      firma_id: 'f1',
      cari_id: 'c1',
      fatura_no: 'ALIS-01',
      tarih: '2026-10-25',
      tutar: 1800,
      yon: 'alis',
    },
    {
      id: 'i-tediye',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tediye',
      tur: 'nakit',
      tutar: 300,
      tarih: '2026-10-25',
      makbuz_no: 'TDY-01',
      durum: 'aktif',
      iptal: false,
    },
  ];

  // Toplam gerçek bakiye = 2000 - 500 - 1800 + 300 = 0
  const filtered = buildCariEkstre({
    movements,
    startDate: '2026-10-15',
    endDate: '2026-10-31',
    currentCariBakiye: 0,
  });

  // Devreden Bakiye (+1500), İptal (0), Alış (-1800 -> -300), Tediye (+300 -> 0)
  assert.equal(filtered.rows.length, 4);
  assert.equal(filtered.rows[0].isOpeningRow, true);
  assert.equal(filtered.rows[0].tipLabel, 'DEVREDEN BAKİYE');
  assert.equal(filtered.rows[0].bakiye, 1500);

  assert.equal(filtered.rows[1].isCancelled, true);
  assert.equal(filtered.rows[1].borc, 0);
  assert.equal(filtered.rows[1].alacak, 0);
  assert.equal(filtered.rows[1].bakiye, 1500);

  // Aynı tarihte (25.10.2026) alış faturası tediye ödemesinin üstünde
  assert.equal(filtered.rows[2].belgeNo, 'ALIS-01');
  assert.equal(filtered.rows[2].alacak, 1800);
  assert.equal(filtered.rows[2].bakiye, -300);

  assert.equal(filtered.rows[3].belgeNo, 'TDY-01');
  assert.equal(filtered.rows[3].borc, 300);
  assert.equal(filtered.rows[3].bakiye, 0);

  assert.equal(filtered.summary.openingBalance, 1500);
  assert.equal(filtered.summary.totalBorc, 300);
  assert.equal(filtered.summary.totalAlacak, 1800);
  assert.equal(filtered.summary.closingBalance, 0);
  assert.match(formatEkstreBakiye(1500), /\(B\)$/);
  assert.match(formatEkstreBakiye(-300), /\(A\)$/);
});
