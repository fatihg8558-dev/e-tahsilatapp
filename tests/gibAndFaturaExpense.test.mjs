import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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

/**
 * Helper: Builds a standard ZIP archive buffer in memory (supporting Stored=0 and Deflate=8).
 */
function buildTestZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const rawBuf = Buffer.from(entry.content, 'utf8');
    const method = entry.deflate ? 8 : 0;
    const payload = entry.deflate ? zlib.deflateRawSync(rawBuf) : rawBuf;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header sig
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8); // compression method
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14); // crc32 (not checked by extractor)
    localHeader.writeUInt32LE(payload.length, 18); // compressed size
    localHeader.writeUInt32LE(rawBuf.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir sig
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD sig
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

test('zipExtractor extracts stored and deflated .xml/.ubl entries and ignores macOS junk/non-XML files', async () => {
  const { extractXmlFilesFromZip } = await loadTsWithMocks('src/lib/zipExtractor.ts');

  const zipBuffer = buildTestZip([
    { name: 'faturalar/GIB2026000000001.xml', content: '\uFEFF<Invoice><ID>GIB001</ID></Invoice>', deflate: true },
    { name: 'GIB2026000000002.ubl', content: '<Invoice><ID>GIB002</ID></Invoice>', deflate: false },
    { name: '__MACOSX/._GIB2026000000001.xml', content: 'junk', deflate: false },
    { name: 'ozet.pdf', content: '%PDF-1.4', deflate: false },
  ]);

  const arrayBuffer = zipBuffer.buffer.slice(
    zipBuffer.byteOffset,
    zipBuffer.byteOffset + zipBuffer.byteLength
  );
  const extracted = await extractXmlFilesFromZip(arrayBuffer);

  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].name, 'GIB2026000000001.xml');
  assert.equal(extracted[0].text, '<Invoice><ID>GIB001</ID></Invoice>');
  assert.equal(extracted[1].name, 'GIB2026000000002.ubl');
  assert.equal(extracted[1].text, '<Invoice><ID>GIB002</ID></Invoice>');

  await assert.rejects(
    () => extractXmlFilesFromZip(new Uint8Array([1, 2, 3]).buffer),
    /Geçersiz veya boş ZIP arşivi/
  );
});

test('faturaExpenseService tags, deduplicates, posts kasa gider, and cleans up on delete', async () => {
  const state = {
    kasalar: [
      {
        id: 'kasa-1',
        firma_id: 'firma-1',
        ad: 'Merkez Kasa',
        tur: 'nakit',
        guncel_bakiye: 10000,
        aktif: true,
      },
    ],
    gelir_giderler: [],
  };

  function createQuery(table) {
    const filters = [];
    const ilikeFilters = [];
    let pendingInsert = null;
    let pendingUpdate = null;
    let isDelete = false;
    let limitCount = null;
    let wantSingle = false;

    const matchRows = () => {
      return state[table].filter((row) => {
        for (const [col, val] of filters) {
          if (row[col] !== val) return false;
        }
        for (const [col, pattern] of ilikeFilters) {
          const needle = String(pattern).replace(/%/g, '').toLowerCase();
          if (!String(row[col] || '').toLowerCase().includes(needle)) return false;
        }
        return true;
      });
    };

    const execute = async () => {
      if (pendingInsert) {
        const inserted = pendingInsert.map((item, idx) => ({
          id: `${table}-${state[table].length + idx + 1}`,
          ...item,
        }));
        state[table].push(...inserted);
        return { data: wantSingle ? inserted[0] : inserted, error: null };
      }

      const matched = matchRows();
      if (pendingUpdate) {
        for (const row of matched) {
          Object.assign(row, pendingUpdate);
        }
        return { data: matched, error: null };
      }

      if (isDelete) {
        const matchedIds = new Set(matched.map((r) => r.id));
        state[table] = state[table].filter((r) => !matchedIds.has(r.id));
        return { data: matched, error: null };
      }

      const sliced = limitCount !== null ? matched.slice(0, limitCount) : matched;
      return { data: wantSingle ? sliced[0] ?? null : sliced, error: null };
    };

    const builder = {
      select() { return builder; },
      insert(payload) {
        pendingInsert = Array.isArray(payload) ? payload : [payload];
        return builder;
      },
      update(patch) {
        pendingUpdate = patch;
        return builder;
      },
      delete() {
        isDelete = true;
        return builder;
      },
      eq(col, val) {
        filters.push([col, val]);
        return builder;
      },
      ilike(col, pat) {
        ilikeFilters.push([col, pat]);
        return builder;
      },
      order() { return builder; },
      limit(n) {
        limitCount = n;
        return builder;
      },
      single() {
        wantSingle = true;
        return execute();
      },
      maybeSingle() {
        wantSingle = true;
        return execute();
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };
    return builder;
  }

  const fakeSupabaseMock = {
    '@supabase/supabase-js': {
      createClient() {
        return {
          from(table) {
            return createQuery(table);
          },
          auth: {
            async getSession() {
              return { data: { session: null } };
            },
          },
        };
      },
    },
  };

  const {
    buildFaturaKasaTag,
    extractFaturaNoFromAciklama,
    fetchExpenseSyncedFaturaNos,
    postFaturaAsKasaGider,
    removeFaturaFromKasa,
  } = await loadTsWithMocks('src/lib/faturaExpenseService.ts', fakeSupabaseMock);

  assert.equal(buildFaturaKasaTag('abc2026001'), '[FATURA:ABC2026001]');
  assert.equal(
    extractFaturaNoFromAciklama('[FATURA:ABC2026001] Tedarikçi A.Ş. · Fatura Giderleştirme'),
    'ABC2026001'
  );

  // 1. Post fatura as kasa gider
  const firstPost = await postFaturaAsKasaGider({
    firmaId: 'firma-1',
    faturaNo: 'GIB202600001',
    cariUnvan: 'Anadolu Tedarik A.Ş.',
    tutar: 2500,
    tarih: '2026-11-19',
    kasaId: 'kasa-1',
    kategori: 'Mal / Hizmet Alımı',
    userId: 'user-1',
    knownKasalar: state.kasalar,
  });

  assert.equal(firstPost.posted, true);
  assert.equal(firstPost.kasaAd, 'Merkez Kasa');
  assert.equal(state.gelir_giderler.length, 1);
  assert.equal(state.kasalar[0].guncel_bakiye, 7500);

  // 2. Duplicate guard skips posting same fatura again
  const dupPost = await postFaturaAsKasaGider({
    firmaId: 'firma-1',
    faturaNo: 'gib202600001',
    cariUnvan: 'Anadolu Tedarik A.Ş.',
    tutar: 2500,
    tarih: '2026-11-19',
    kasaId: 'kasa-1',
    knownKasalar: state.kasalar,
  });
  assert.equal(dupPost.posted, false);
  assert.equal(dupPost.skippedDuplicate, true);
  assert.equal(state.kasalar[0].guncel_bakiye, 7500);

  // 3. fetchExpenseSyncedFaturaNos returns synced fatura key
  const syncedSet = await fetchExpenseSyncedFaturaNos('firma-1');
  assert.equal(syncedSet.has('GIB202600001'), true);

  // 4. Deleting fatura rolls back kasa gider and restores balance
  await removeFaturaFromKasa('GIB202600001', 'firma-1');
  assert.equal(state.gelir_giderler.length, 0);
  assert.equal(state.kasalar[0].guncel_bakiye, 10000);
});

test('gibService resolves URL and handles fetch_invoices and test_login proxy responses', async () => {
  const prevFetch = globalThis.fetch;
  try {
    const supabaseStub = {
      '@supabase/supabase-js': {
        createClient() {
          return {
            from() { return {}; },
            auth: {
              async getSession() {
                return { data: { session: { access_token: 'jwt-token-123' } } };
              },
            },
          };
        },
      },
    };

    const {
      resolveGibFunctionUrl,
      testGibConnection,
      fetchGibInvoices,
    } = await loadTsWithMocks('src/lib/gibService.ts', supabaseStub);

    assert.ok(resolveGibFunctionUrl().endsWith('/functions/v1/gib-portal-proxy'));
    assert.equal(
      resolveGibFunctionUrl('https://custom.example.com/gib-proxy/'),
      'https://custom.example.com/gib-proxy'
    );

    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === 'test_login') {
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, message: 'GİB test bağlantısı başarılı' };
          },
        };
      }
      if (body.action === 'fetch_invoices') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              invoices: [
                {
                  ettn: 'ettn-1',
                  belgeNumarasi: 'GIB2026000001',
                  tarih: '2026-11-18',
                  yon: 'alis',
                  tip: 'SATIS',
                  unvan: 'Tedarikçi Ltd',
                  vkn: '1234567890',
                  toplamTutar: 1200,
                  paraBirimi: 'TRY',
                },
              ],
            };
          },
        };
      }
      return { ok: false, status: 404, async json() { return {}; } };
    };

    const testRes = await testGibConnection({
      firmaId: 'firma-1',
      settings: {
        kullaniciKodu: '111111',
        sifreSet: true,
        ortam: 'prod',
        varsayilanGiderKasaId: '',
        varsayilanGiderKategori: 'Mal / Hizmet Alımı',
      },
    });
    assert.equal(testRes.ok, true);

    const fetchRes = await fetchGibInvoices({
      firmaId: 'firma-1',
      settings: {
        kullaniciKodu: '111111',
        sifreSet: true,
        ortam: 'prod',
        varsayilanGiderKasaId: '',
        varsayilanGiderKategori: 'Mal / Hizmet Alımı',
      },
      startDate: '2026-11-01',
      endDate: '2026-11-19',
      direction: 'alis',
    });
    assert.equal(fetchRes.ok, true);
    assert.equal(fetchRes.invoices.length, 1);
    assert.equal(fetchRes.invoices[0].belgeNumarasi, 'GIB2026000001');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('platform gating hides UBL import & Cek/Senet Portfoy on Android APK, keeps mobile web open, and moves widget pin to Settings', async () => {
  const prevWindow = globalThis.window;
  try {
    const { isWebPlatform, isAndroidNativeBridge } = await loadTsWithMocks('src/lib/platform.ts');

    // 1. Mobile web browser (no AndroidBridge) -> isWebPlatform() === true
    globalThis.window = { innerWidth: 390 };
    assert.equal(isWebPlatform(), true);
    assert.equal(isAndroidNativeBridge(), false);

    // Android APK WebView (AndroidBridge present) -> isWebPlatform() === false
    globalThis.window = { innerWidth: 390, AndroidBridge: {} };
    assert.equal(isWebPlatform(), false);
    assert.equal(isAndroidNativeBridge(), true);

    // 2. CarilerPage gates UBL import button & modal behind isWebPlatform()
    const carilerSrc = fs.readFileSync(path.join(rootDir, 'src/pages/CarilerPage.tsx'), 'utf8');
    assert.ok(carilerSrc.includes('{isWebPlatform() && ('));
    assert.ok(carilerSrc.includes('open_ubl_import_button'));
    assert.ok(carilerSrc.includes('<UblImportModal'));

    // 3. AppLayout gates portfoy desktop & mobile nav behind isWebPlatform()
    const layoutSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/AppLayout.tsx'), 'utf8');
    assert.ok(layoutSrc.includes('isWebPlatform()'));
    assert.ok(layoutSrc.includes('nav_portfoy_desktop'));
    assert.ok(layoutSrc.includes('nav_portfoy_mobile'));
    assert.ok(layoutSrc.includes('openSettingsModal'));

    // 4. App.tsx blocks 'portfoy' tab when !isWeb
    const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
    assert.ok(appSrc.includes("if (tab === 'portfoy' && !isWeb) return false;"));
    assert.ok(appSrc.includes("effectiveTab === 'portfoy' && isWebPlatform()"));

    // 5. DashboardPage no longer has pin_home_widget_btn; SettingsModal has it
    const dashSrc = fs.readFileSync(path.join(rootDir, 'src/pages/DashboardPage.tsx'), 'utf8');
    assert.equal(dashSrc.includes('pin_home_widget_btn'), false);
    assert.ok(dashSrc.includes('{isWebPlatform() && ('));

    const settingsSrc = fs.readFileSync(path.join(rootDir, 'src/components/settings/SettingsModal.tsx'), 'utf8');
    assert.ok(settingsSrc.includes('data-testid="pin_home_widget_btn"'));
    assert.ok(settingsSrc.includes('data-testid="settings_tab_gib"'));
    assert.ok(settingsSrc.includes('data-testid="settings_gib_panel"'));

    // 6. UblImportModal has ZIP, GİB Portal, and Giderleştir controls
    const ublSrc = fs.readFileSync(path.join(rootDir, 'src/components/cari/UblImportModal.tsx'), 'utf8');
    assert.ok(ublSrc.includes('accept=".xml,.ubl,.zip'));
    assert.ok(ublSrc.includes('data-testid="ubl_tab_gib"'));
    assert.ok(ublSrc.includes('data-testid="gib_fetch_invoices_btn"'));
    assert.ok(ublSrc.includes('data-testid="ubl_bulk_giderlestir_btn"'));
    assert.ok(ublSrc.includes('postFaturaAsKasaGider'));
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});
