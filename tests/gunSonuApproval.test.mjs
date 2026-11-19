import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const rootDir = process.cwd();

async function loadTsWithMocks(relPath, mocks = {}) {
  const absPath = path.join(rootDir, relPath);
  const result = await esbuild.build({
    entryPoints: [absPath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: {
      'import.meta.env': '{}',
    },
    external: ['react', 'react-dom', '@supabase/supabase-js', 'lucide-react'],
  });

  const code = result.outputFiles[0].text;
  const mod = { exports: {} };
  const customRequire = (id) => {
    if (id in mocks) return mocks[id];
    return require(id);
  };
  const fn = new Function('exports', 'require', 'module', code);
  fn(mod.exports, customRequire, mod);
  return mod.exports;
}

const supabaseStub = {
  '@supabase/supabase-js': {
    createClient() {
      return {
        from() {
          return {};
        },
      };
    },
  },
};

test('gunSonuApprovalService builds, parses, upserts, and strips GS_ONAY and GS_RED tags cleanly', async () => {
  const {
    buildGsOnayTag,
    parseGsOnayTag,
    parseGsRedTag,
    upsertGsOnayTagInAciklama,
    upsertGsRedTagInAciklama,
    stripGsTagsFromAciklama,
  } = await loadTsWithMocks('src/lib/gunSonuApprovalService.ts', supabaseStub);

  const tag = buildGsOnayTag({
    requestId: 'req-42',
    sayilanNakit: 12450.5,
    kasaFarki: -49.5,
    plasiyerAd: 'Ahmet Yılmaz',
    tarih: '2026-11-19',
    not: 'Akşam teslimatı [kasa 1]',
  });
  assert.ok(tag.startsWith('[GS_ONAY:'));

  const parsed = parseGsOnayTag(`Müşteri tahsilatı\n${tag}`);
  assert.ok(parsed);
  assert.equal(parsed.requestId, 'req-42');
  assert.equal(parsed.sayilanNakit, 12450.5);
  assert.equal(parsed.kasaFarki, -49.5);
  assert.equal(parsed.plasiyerAd, 'Ahmet Yılmaz');
  assert.equal(parsed.tarih, '2026-11-19');
  assert.equal(parsed.not, 'Akşam teslimatı [kasa 1]');

  // Upserting GS_RED removes GS_ONAY and replaces with GS_RED while keeping user note
  const withOnay = upsertGsOnayTagInAciklama('Fatura bedeli tahsil edildi', {
    requestId: 'req-42',
    sayilanNakit: 5000,
    kasaFarki: 0,
    plasiyerAd: 'Ahmet',
    tarih: '2026-11-19',
    not: '',
  });
  assert.ok(withOnay.includes('Fatura bedeli tahsil edildi'));
  assert.ok(parseGsOnayTag(withOnay));

  const withRed = upsertGsRedTagInAciklama(withOnay, 'Nakit sayım fişi eksik, kontrol ediniz');
  assert.ok(withRed.includes('Fatura bedeli tahsil edildi'));
  assert.equal(parseGsOnayTag(withRed), null);
  assert.equal(parseGsRedTag(withRed), 'Nakit sayım fişi eksik, kontrol ediniz');

  const stripped = stripGsTagsFromAciklama(withRed);
  assert.equal(stripped, 'Fatura bedeli tahsil edildi');
});

test('PlasiyerGunSonuPage and AppLayout wire Ana Hesap approval queue and pending badge counts', () => {
  const gsSrc = fs.readFileSync(path.join(rootDir, 'src/pages/PlasiyerGunSonuPage.tsx'), 'utf8');
  assert.ok(gsSrc.includes('data-testid="gun_sonu_approval_queue"'));
  assert.ok(gsSrc.includes('data-testid="gun_sonu_submit_approval_btn"'));
  assert.ok(gsSrc.includes('approveGunSonuRequest'));
  assert.ok(gsSrc.includes('rejectGunSonuRequest'));
  assert.ok(gsSrc.includes('submitPlasiyerGunSonuForApproval'));

  const layoutSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/AppLayout.tsx'), 'utf8');
  assert.ok(layoutSrc.includes('fetchPendingGunSonuApprovalCount'));
  assert.ok(layoutSrc.includes('data-testid="nav_gun_sonu_badge_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_gun_sonu_badge_mobile"'));

  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes('setNotificationRefreshKey'));
});
