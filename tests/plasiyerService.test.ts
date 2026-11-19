import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  PLASIYER_RLS_SQL,
  buildSafePlasiyerProfilePayload,
  formatPlasiyerWriteError,
  isAnaHesapForeignKeyError,
} from '../src/lib/plasiyerService.ts';

test('isAnaHesapForeignKeyError detects profiles_ana_hesap_id_fkey and 23503 ana_hesap_id violations', () => {
  assert.equal(
    isAnaHesapForeignKeyError({
      code: '23503',
      message: 'insert or update on table "profiles" violates foreign key constraint "profiles_ana_hesap_id_fkey"',
    }),
    true
  );

  assert.equal(
    isAnaHesapForeignKeyError({
      message: 'Key (ana_hesap_id)=(123) is not present in table "profiles".',
      details: 'foreign key constraint',
    }),
    true
  );

  assert.equal(
    isAnaHesapForeignKeyError({
      code: '23503',
      message: 'insert or update on table "cariler" violates foreign key constraint "cariler_firma_id_fkey"',
    }),
    false
  );

  assert.equal(isAnaHesapForeignKeyError(null), false);
});

test('buildSafePlasiyerProfilePayload normalizes blank ana_hesap_id to null', () => {
  const withBlank = buildSafePlasiyerProfilePayload({
    id: 'user-1',
    firma_id: 'firma-1',
    ana_hesap_id: '   ',
    ad_soyad: 'Ali Kaya',
    telefon: null,
    email: 'ali@firma.com',
  });
  assert.equal(withBlank.ana_hesap_id, null);
  assert.equal(withBlank.rol, 'plasiyer');

  const withValid = buildSafePlasiyerProfilePayload({
    id: 'user-2',
    firma_id: 'firma-1',
    ana_hesap_id: 'ana-1',
    ad_soyad: 'Ayşe Demir',
    telefon: '05551112233',
    email: 'ayse@firma.com',
  });
  assert.equal(withValid.ana_hesap_id, 'ana-1');
});

test('formatPlasiyerWriteError distinguishes FK errors, RLS errors, and generic errors', () => {
  const fkRes = formatPlasiyerWriteError(
    {
      code: '23503',
      message: 'insert or update on table "profiles" violates foreign key constraint "profiles_ana_hesap_id_fkey"',
    },
    null
  );
  assert.equal(fkRes.rlsWarning, true);
  assert.ok(fkRes.error.includes('ana_hesap_id'));
  assert.ok(fkRes.error.includes('yabancı anahtar (FK)'));

  const rlsRes = formatPlasiyerWriteError(
    {
      code: '42501',
      message: 'new row violates row-level security policy for table "profiles"',
    },
    null
  );
  assert.equal(rlsRes.rlsWarning, true);
  assert.ok(rlsRes.error.includes('RLS'));

  const genericRes = formatPlasiyerWriteError(
    { message: 'network timeout while connecting to supabase' },
    null
  );
  assert.equal(genericRes.rlsWarning, false);
  assert.equal(genericRes.error, 'network timeout while connecting to supabase');
});

test('PLASIYER_RLS_SQL cleans dangling ana_hesap_id, enforces ON DELETE SET NULL, and covers profiles + islemler RLS', () => {
  assert.ok(PLASIYER_RLS_SQL.includes('SET ana_hesap_id = NULL'));
  assert.ok(PLASIYER_RLS_SQL.includes('ON DELETE SET NULL'));
  assert.ok(PLASIYER_RLS_SQL.includes('profiles_self_or_ana_insert'));
  assert.ok(PLASIYER_RLS_SQL.includes('ON public.profiles FOR INSERT'));
  assert.ok(PLASIYER_RLS_SQL.includes('EXISTS (\n        SELECT 1 FROM public.profiles ap'));
  assert.ok(PLASIYER_RLS_SQL.includes('islemler_firma_select'));
  assert.ok(PLASIYER_RLS_SQL.includes('islemler_firma_update'));
  assert.ok(PLASIYER_RLS_SQL.includes('UPDATE public.islemler i'));
});

test('accountDeleteHelper clears ana_hesap_id before deleting profiles', () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/accountDeleteHelper.ts'),
    'utf8'
  );
  assert.ok(src.includes(".update({ ana_hesap_id: null }).eq('ana_hesap_id', userId)"));
  assert.ok(src.includes(".update({ ana_hesap_id: null }).eq('firma_id', firmaId)"));
});
