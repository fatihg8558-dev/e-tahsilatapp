import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARILER_AND_FATURALAR_DELETE_RLS_SQL,
  computeFaturaDeleteBalanceUpdate,
} from '../src/lib/cariDeleteHelper.ts';
import {
  getUblInvoiceSnapshot,
  removeUblInvoiceSnapshotAsync,
  saveUblInvoiceSnapshots,
  StorageLike,
} from '../src/lib/ublInvoiceStore.ts';
import { ParsedUblInvoice } from '../src/lib/ublParser.ts';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem(k: string) {
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, v: string) {
      map.set(k, v);
    },
  };
}

function makeInvoice(faturaNo: string, amount: number): ParsedUblInvoice {
  return {
    faturaNo,
    uuid: 'uuid-1',
    tarih: '2026-11-18',
    profileId: 'TICARIFATURA',
    invoiceTypeCode: 'SATIS',
    currencyCode: 'TRY',
    exchangeRate: 1,
    originalAmount: amount,
    tutarTL: amount,
    supplier: { unvan: 'Satıcı A.Ş.', vkn: '1111111111' },
    customer: { unvan: 'Alıcı Ltd.', vkn: '2222222222' },
    detectedYon: 'satis',
    detectionReason: 'test',
    notes: [],
    lines: [],
    totals: {
      lineExtensionAmount: amount,
      allowanceTotalAmount: 0,
      taxExclusiveAmount: amount,
      taxTotalAmount: 0,
      taxInclusiveAmount: amount,
      payableAmount: amount,
      taxSubtotals: [],
    },
  };
}

test('computeFaturaDeleteBalanceUpdate reverses Satis and Alis balances without double counting', () => {
  // Satış faturası silinince trigger çalışmadıysa cari borçtan düşülür (-tutar)
  const satisNoTrigger = computeFaturaDeleteBalanceUpdate({
    beforeVal: 1500,
    afterVal: 1500,
    tutar: 500,
    yon: 'satis',
  });
  assert.deepEqual(satisNoTrigger, { shouldUpdateClient: true, nextBakiye: 1000 });

  // Alış faturası silinince trigger çalışmadıysa cariye +tutar geri eklenir
  const alisNoTrigger = computeFaturaDeleteBalanceUpdate({
    beforeVal: -1200,
    afterVal: -1200,
    tutar: 1200,
    yon: 'alis',
  });
  assert.deepEqual(alisNoTrigger, { shouldUpdateClient: true, nextBakiye: 0 });

  // Veritabanı trigger'ı zaten bakiyeyi 1500 -> 1000 yaptıysa tekrar müdahale etmez
  const alreadyUpdatedByTrigger = computeFaturaDeleteBalanceUpdate({
    beforeVal: 1500,
    afterVal: 1000,
    tutar: 500,
    yon: 'satis',
  });
  assert.deepEqual(alreadyUpdatedByTrigger, { shouldUpdateClient: false, nextBakiye: 1000 });
});

test('removeUblInvoiceSnapshotAsync removes only target invoice snapshot', async () => {
  const storage = createMemoryStorage();
  saveUblInvoiceSnapshots(
    'firma-1',
    [
      { yon: 'satis', parsed: makeInvoice('FAT-001', 1000) },
      { yon: 'satis', parsed: makeInvoice('FAT-002', 2000) },
    ],
    storage
  );

  await removeUblInvoiceSnapshotAsync('firma-1', 'FAT-001', 'satis', storage);
  assert.equal(getUblInvoiceSnapshot('firma-1', 'FAT-001', 'satis', storage), null);
  const kept = getUblInvoiceSnapshot('firma-1', 'FAT-002', 'satis', storage);
  assert.ok(kept);
  assert.equal(kept.invoice.faturaNo, 'FAT-002');
});

test('CARILER_AND_FATURALAR_DELETE_RLS_SQL covers cariler, faturalar, and islemler DELETE policies', () => {
  assert.ok(CARILER_AND_FATURALAR_DELETE_RLS_SQL.includes('ON public.cariler FOR DELETE'));
  assert.ok(CARILER_AND_FATURALAR_DELETE_RLS_SQL.includes('ON public.faturalar FOR DELETE'));
  assert.ok(CARILER_AND_FATURALAR_DELETE_RLS_SQL.includes('ON public.islemler FOR DELETE'));
});

test('CariDeleteModals keep all hooks before early return null and CarilerPage exposes invoice delete buttons', () => {
  const modalsSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/cari/CariDeleteModals.tsx'),
    'utf8'
  );
  assert.ok(modalsSrc.includes('data-testid="delete_cari_cascade_checkbox"'));
  assert.ok(modalsSrc.includes('data-testid="confirm_delete_cari_button"'));
  assert.ok(modalsSrc.includes('data-testid="confirm_delete_fatura_button"'));

  const carilerSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/CarilerPage.tsx'),
    'utf8'
  );
  assert.ok(carilerSrc.includes('data-testid="ekstre_delete_invoice_btn"'));
  assert.ok(carilerSrc.includes('data-testid="ekstre_delete_invoice_btn_mobile"'));
  assert.ok(carilerSrc.includes('DeleteCariConfirmModal'));
  assert.ok(carilerSrc.includes('DeleteFaturaConfirmModal'));
});
