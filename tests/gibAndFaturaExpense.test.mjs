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

function buildFakeSupabaseMock(initialState) {
  function createQuery(table) {
    const filters = [];
    const inFilters = [];
    const ilikeFilters = [];
    let pendingInsert = null;
    let pendingUpdate = null;
    let isDelete = false;
    let limitCount = null;
    let wantSingle = false;

    const matchRows = () => {
      const rows = initialState[table] || [];
      return rows.filter((row) => {
        for (const [col, val] of filters) {
          if (row[col] !== val) return false;
        }
        for (const [col, vals] of inFilters) {
          if (!Array.isArray(vals) || !vals.includes(row[col])) return false;
        }
        for (const [col, pattern] of ilikeFilters) {
          const needle = String(pattern).replace(/%/g, '').toLowerCase();
          if (!String(row[col] || '').toLowerCase().includes(needle)) return false;
        }
        return true;
      });
    };

    const execute = async () => {
      if (!initialState[table]) initialState[table] = [];
      if (pendingInsert) {
        const inserted = pendingInsert.map((item, idx) => ({
          id: item.id || `${table}-${initialState[table].length + idx + 1}`,
          ...item,
        }));
        initialState[table].push(...inserted);
        return { data: wantSingle ? inserted[0] : inserted, error: null };
      }

      const matched = matchRows();
      if (pendingUpdate) {
        for (const row of matched) {
          Object.assign(row, pendingUpdate);
        }
        return { data: wantSingle ? matched[0] ?? null : matched, error: null };
      }

      if (isDelete) {
        const matchedIds = new Set(matched.map((r) => r.id));
        initialState[table] = initialState[table].filter((r) => !matchedIds.has(r.id));
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
      in(col, vals) {
        inFilters.push([col, vals]);
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

  return {
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
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
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
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
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

test('faturaExpenseService handles both gider and gelir movements, dedupes, and rolls back on delete', async () => {
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

  const {
    buildFaturaKasaTag,
    extractFaturaNoFromAciklama,
    fetchExpenseSyncedFaturaNos,
    postFaturaAsKasaGider,
    postFaturaAsKasaHareket,
    removeFaturaFromKasa,
  } = await loadTsWithMocks('src/lib/faturaExpenseService.ts', buildFakeSupabaseMock(state));

  assert.equal(buildFaturaKasaTag('abc2026001'), '[FATURA:ABC2026001]');
  assert.equal(
    extractFaturaNoFromAciklama('[FATURA:ABC2026001] Tedarikçi A.Ş. · Fatura Giderleştirme'),
    'ABC2026001'
  );

  // 1. Post alis fatura as kasa gider
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

  // 3. Post satis fatura as kasa gelir
  const gelirPost = await postFaturaAsKasaHareket({
    firmaId: 'firma-1',
    faturaNo: 'SAT202600002',
    cariUnvan: 'Müşteri A.Ş.',
    tutar: 1500,
    tarih: '2026-11-20',
    tip: 'gelir',
    kasaId: 'kasa-1',
    kategori: 'Mal / Hizmet Satış Geliri',
    userId: 'user-1',
    knownKasalar: state.kasalar,
  });
  assert.equal(gelirPost.posted, true);
  assert.equal(state.kasalar[0].guncel_bakiye, 9000);

  // 4. fetchExpenseSyncedFaturaNos returns both keys
  const syncedSet = await fetchExpenseSyncedFaturaNos('firma-1');
  assert.equal(syncedSet.has('GIB202600001'), true);
  assert.equal(syncedSet.has('SAT202600002'), true);

  // 5. Rolling back both restores exact starting balance
  await removeFaturaFromKasa('GIB202600001', 'firma-1');
  await removeFaturaFromKasa('SAT202600002', 'firma-1');
  assert.equal(state.gelir_giderler.length, 0);
  assert.equal(state.kasalar[0].guncel_bakiye, 10000);
});

test('manualFaturaService calculates VAT, blocks duplicate fatura numbers, updates cari balance, and optionally syncs kasa', async () => {
  const state = {
    cariler: [
      { id: 'cari-alici', firma_id: 'firma-1', unvan: 'Müşteri Ltd.', tur: 'alici', bakiye: 1000 },
      { id: 'cari-tedarikci', firma_id: 'firma-1', unvan: 'Tedarik A.Ş.', tur: 'tedarikci', bakiye: 0 },
    ],
    faturalar: [],
    kasalar: [
      { id: 'kasa-1', firma_id: 'firma-1', ad: 'Merkez Kasa', tur: 'nakit', guncel_bakiye: 5000, aktif: true },
    ],
    gelir_giderler: [],
  };

  const {
    calculateGrossFromNetAndVat,
    splitGrossToNetAndVat,
    createManualFaturaRecord,
  } = await loadTsWithMocks('src/lib/manualFaturaService.ts', buildFakeSupabaseMock(state));

  assert.equal(calculateGrossFromNetAndVat(1000, 20), 1200);
  assert.deepEqual(splitGrossToNetAndVat(1200, 20), { matrah: 1000, kdvTutar: 200 });

  // 1. Satış faturası (cari bakiyesi +tutar olur, kasa senkronu kapalı)
  const satisRes = await createManualFaturaRecord({
    firmaId: 'firma-1',
    firma: { id: 'firma-1', unvan: 'Benim Firmam', vergi_no: '1111111111' },
    cari: state.cariler[0],
    faturaNo: 'SAT2026-001',
    tarih: '2026-11-20',
    yon: 'satis',
    toplamTutar: 1200,
    kdvOrani: 20,
    syncToKasa: false,
  });
  assert.equal(satisRes.success, true);
  assert.equal(state.cariler[0].bakiye, 2200);
  assert.equal(state.kasalar[0].guncel_bakiye, 5000);

  // 2. Aynı fatura numarası ve yönde mükerrer engellenir
  const dupRes = await createManualFaturaRecord({
    firmaId: 'firma-1',
    cari: state.cariler[0],
    faturaNo: 'sat2026-001',
    tarih: '2026-11-20',
    yon: 'satis',
    toplamTutar: 1200,
  });
  assert.equal(dupRes.success, false);
  assert.match(dupRes.error || '', /zaten kayıtlı/);

  // 3. Alış faturası + Kasaya gider işle (cari -800, kasa -800)
  const alisRes = await createManualFaturaRecord({
    firmaId: 'firma-1',
    cari: state.cariler[1],
    faturaNo: 'ALS2026-009',
    tarih: '2026-11-20',
    yon: 'alis',
    toplamTutar: 800,
    kdvOrani: 20,
    syncToKasa: true,
    kasaId: 'kasa-1',
    kasaKategori: 'Mal / Hizmet Alımı',
    knownKasalar: state.kasalar,
  });
  assert.equal(alisRes.success, true);
  assert.equal(alisRes.kasaPosted, true);
  assert.equal(state.cariler[1].bakiye, -800);
  assert.equal(state.kasalar[0].guncel_bakiye, 4200);
  assert.equal(state.gelir_giderler.length, 1);
  assert.equal(state.gelir_giderler[0].tip, 'gider');
});

test('mutabakatService parses URL query, builds public URL, creates record, and submits approval/dispute', async () => {
  const state = {
    cari_mutabakatlar: [],
  };

  const {
    parseMutabakatCodeFromSearch,
    buildMutabakatPublicUrl,
    describeMutabakatBalance,
    buildMutabakatWhatsAppMessage,
    createCloudMutabakatRecord,
    fetchMutabakatByCode,
    submitCounterpartyMutabakatResponse,
  } = await loadTsWithMocks('src/lib/mutabakatService.ts', buildFakeSupabaseMock(state));

  assert.equal(parseMutabakatCodeFromSearch('?mutabakat=MTB-AB123'), 'MTB-AB123');
  assert.equal(parseMutabakatCodeFromSearch('?pos_pay=123'), null);

  const url = buildMutabakatPublicUrl('MTB-AB123', null, 'https://tahsilatim.vercel.app/');
  assert.equal(url, 'https://tahsilatim.vercel.app/?mutabakat=MTB-AB123');

  assert.match(describeMutabakatBalance(4500).yonLabel, /Borç Bakiyeniz/);
  assert.match(describeMutabakatBalance(-2000).yonLabel, /Alacak Bakiyeniz/);

  const created = await createCloudMutabakatRecord({
    firma: { id: 'firma-1', unvan: 'Örnek A.Ş.', vergi_no: '1234567890', telefon: '05550000000' },
    cari: { id: 'cari-1', unvan: 'Karşı Firma Ltd.', vergi_tc_no: '9999999999' },
    mutabakatTarihi: '2026-11-20',
    donemBaslik: 'Kasım 2026 Mutabakatı',
    bakiye: 4500,
    faturaSayisi: 2,
    islemSayisi: 1,
    ozetKalemler: [
      { tarih: '2026-11-10', tip: 'Satış Faturası', belgeNo: 'SAT001', borc: 5000, alacak: 0 },
      { tarih: '2026-11-12', tip: 'Tahsilat', belgeNo: 'THS001', borc: 0, alacak: 500 },
    ],
  });
  assert.ok(created.record);
  assert.equal(created.record.durum, 'bekliyor');

  const waMsg = buildMutabakatWhatsAppMessage({
    firmaUnvan: 'Örnek A.Ş.',
    cariUnvan: 'Karşı Firma Ltd.',
    mutabakatTarihi: '2026-11-20',
    bakiye: 4500,
    mutabakatUrl: buildMutabakatPublicUrl(created.record.mutabakat_kodu, null, 'https://tahsilatim.vercel.app'),
    mutabakatKodu: created.record.mutabakat_kodu,
  });
  assert.ok(waMsg.includes(created.record.mutabakat_kodu));
  assert.ok(waMsg.includes('https://tahsilatim.vercel.app/?mutabakat='));

  const fetched = await fetchMutabakatByCode(created.record.mutabakat_kodu);
  assert.equal(fetched.record?.cari_unvan, 'Karşı Firma Ltd.');

  // Approve mutabakat
  const approved = await submitCounterpartyMutabakatResponse({
    mutabakatKodu: created.record.mutabakat_kodu,
    durum: 'mutabik',
    cevaplayanAd: 'Mehmet Kaya',
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.record?.durum, 'mutabik');
  assert.equal(approved.record?.cevaplayan_ad, 'Mehmet Kaya');

  // Cannot answer a second time after finalized
  const secondTry = await submitCounterpartyMutabakatResponse({
    mutabakatKodu: created.record.mutabakat_kodu,
    durum: 'itiraz',
    cevaplayanAd: 'Ali',
    itirazNotu: 'Fark',
  });
  assert.equal(secondTry.ok, false);
});

test('GİB fetching is removed while all tiers gain manual fatura (web-only) & mutabakat PDF/link', async () => {
  const prevWindow = globalThis.window;
  try {
    const { isWebPlatform, isAndroidNativeBridge } = await loadTsWithMocks('src/lib/platform.ts');
    globalThis.window = { innerWidth: 390 };
    assert.equal(isWebPlatform(), true);
    assert.equal(isAndroidNativeBridge(), false);

    globalThis.window = { innerWidth: 390, AndroidBridge: {} };
    assert.equal(isWebPlatform(), false);
    assert.equal(isAndroidNativeBridge(), true);

    // 1. Deleted obsolete GİB files stay deleted
    assert.equal(fs.existsSync(path.join(rootDir, 'src/lib/gibService.ts')), false);
    assert.equal(fs.existsSync(path.join(rootDir, 'src/lib/gibEdgeFunctionCode.ts')), false);
    assert.equal(fs.existsSync(path.join(rootDir, 'supabase/functions/gib-portal-proxy/index.ts')), false);

    // 2. SettingsModal & UblImportModal no longer contain GİB Portal fetching UI
    const settingsSrc = fs.readFileSync(path.join(rootDir, 'src/components/settings/SettingsModal.tsx'), 'utf8');
    assert.equal(settingsSrc.includes('settings_tab_gib'), false);
    assert.ok(settingsSrc.includes('data-testid="pin_home_widget_btn"'));

    const ublSrc = fs.readFileSync(path.join(rootDir, 'src/components/cari/UblImportModal.tsx'), 'utf8');
    assert.equal(ublSrc.includes('ubl_tab_gib'), false);
    assert.equal(ublSrc.includes('gib_fetch_invoices_btn'), false);
    assert.ok(ublSrc.includes('accept=".xml,.ubl,.zip'));
    assert.ok(ublSrc.includes('data-testid="ubl_bulk_giderlestir_btn"'));

    // 3. packageCatalog includes manual fatura on ALL tiers while keeping UBL & Cari Mutabakat Kurumsal-only
    const { PACKAGE_TIERS, COMPARISON_FEATURE_ROWS } = await loadTsWithMocks('src/lib/packageCatalog.ts');
    for (const pkgId of ['baslangic', 'profesyonel', 'kurumsal']) {
      const pkg = PACKAGE_TIERS.find((p) => p.key === pkgId);
      assert.ok(pkg, `${pkgId} package should exist`);
      assert.ok(
        pkg.features.some((f) => f.label.includes('Elle Alış/Satış Faturası') && f.included),
        `${pkgId} should include Elle Alış/Satış Faturası`
      );
      const ublFeature = pkg.features.find((f) => f.label.includes('UBL / XML'));
      assert.equal(ublFeature?.included, pkgId === 'kurumsal');
      const mutabakatFeature = pkg.features.find((f) => f.label.includes('Cari Mutabakat'));
      assert.equal(mutabakatFeature?.included, pkgId === 'kurumsal');
    }
    const mutabakatRow = COMPARISON_FEATURE_ROWS.find((r) => r.label.includes('Cari Mutabakat'));
    assert.deepEqual(mutabakatRow?.values, { baslangic: false, profesyonel: false, kurumsal: true });

    // 4. CarilerPage & KasaGelirGiderPage & App.tsx wire Web-only manual fatura & Kurumsal-gated mutabakat link/PDF
    const carilerSrc = fs.readFileSync(path.join(rootDir, 'src/pages/CarilerPage.tsx'), 'utf8');
    assert.ok(carilerSrc.includes('data-testid="open_manual_fatura_button"'));
    assert.ok(carilerSrc.includes('data-testid="ekstre_manual_fatura_btn"'));
    assert.ok(carilerSrc.includes('data-testid="ekstre_mutabakat_modal_btn"'));
    assert.ok(carilerSrc.includes('entitlements.canUseMutabakat'));
    assert.ok(carilerSrc.includes('data-testid="mutabakat_lock_badge"'));
    assert.ok(carilerSrc.includes('<ManualFaturaModal'));
    assert.ok(carilerSrc.includes('<MutabakatMektubuModal'));

    const kasaSrc = fs.readFileSync(path.join(rootDir, 'src/pages/KasaGelirGiderPage.tsx'), 'utf8');
    assert.ok(kasaSrc.includes('data-testid="kasa_open_manual_fatura_btn"'));
    assert.ok(kasaSrc.includes('defaultSyncToKasa={true}'));

    const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
    assert.ok(appSrc.includes("if (tab === 'portfoy' && !isWeb) return false;"));
    assert.ok(appSrc.includes('parseMutabakatCodeFromSearch'));
    assert.ok(appSrc.includes('<MutabakatLandingPage'));
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

test('mutabakatService bulk listing, 1-click negative filtering, stats, and discrepancy helpers work accurately', async () => {
  const state = {
    cari_mutabakatlar: [
      {
        id: 'm-1',
        firma_id: 'firma-1',
        cari_id: 'cari-1',
        mutabakat_kodu: 'MTB-001',
        firma_unvan: 'Örnek A.Ş.',
        cari_unvan: 'Alfa Ltd.',
        mutabakat_tarihi: '2026-11-20',
        donem_baslik: 'Kasım 2026',
        bakiye: 12000,
        durum: 'itiraz',
        cevaplayan_ad: 'Ali Veli',
        itiraz_tutari: 10500,
        itiraz_notu: 'FT-88 henüz işlenmemiş',
        cevap_tarihi: '2026-11-20T10:00:00Z',
        created_at: '2026-11-19T09:00:00Z',
      },
      {
        id: 'm-2',
        firma_id: 'firma-1',
        cari_id: 'cari-2',
        mutabakat_kodu: 'MTB-002',
        firma_unvan: 'Örnek A.Ş.',
        cari_unvan: 'Beta Ticaret',
        mutabakat_tarihi: '2026-11-20',
        donem_baslik: 'Kasım 2026',
        bakiye: 5000,
        durum: 'mutabik',
        cevaplayan_ad: 'Ayşe Demir',
        cevap_tarihi: '2026-11-20T11:00:00Z',
        created_at: '2026-11-19T10:00:00Z',
      },
      {
        id: 'm-3',
        firma_id: 'firma-1',
        cari_id: 'cari-3',
        mutabakat_kodu: 'MTB-003',
        firma_unvan: 'Örnek A.Ş.',
        cari_unvan: 'Gamma Sanayi',
        mutabakat_tarihi: '2026-11-20',
        donem_baslik: 'Kasım 2026',
        bakiye: -3000,
        durum: 'bekliyor',
        created_at: '2026-11-19T11:00:00Z',
      },
      {
        id: 'm-other',
        firma_id: 'firma-2',
        cari_id: 'cari-x',
        mutabakat_kodu: 'MTB-999',
        firma_unvan: 'Başka Firma',
        cari_unvan: 'Diğer Cari',
        mutabakat_tarihi: '2026-11-20',
        bakiye: 100,
        durum: 'itiraz',
        created_at: '2026-11-19T12:00:00Z',
      },
    ],
  };

  const {
    fetchAllMutabakatlarForFirma,
    computeItirazDiscrepancy,
    computeMutabakatStats,
    filterMutabakatRecords,
  } = await loadTsWithMocks('src/lib/mutabakatService.ts', buildFakeSupabaseMock(state));

  const { records, missingTable } = await fetchAllMutabakatlarForFirma('firma-1');
  assert.equal(Boolean(missingTable), false);
  assert.equal(records.length, 3);

  const stats = computeMutabakatStats(records);
  assert.deepEqual(stats, {
    total: 3,
    itirazCount: 1,
    mutabikCount: 1,
    bekliyorCount: 1,
    totalItirazDiscrepancy: 1500,
  });

  // Discrepancy calculation: |12000 - 10500| => 10500 - 12000 = -1500
  assert.equal(computeItirazDiscrepancy(records[0]), -1500);
  assert.equal(computeItirazDiscrepancy(records[1]), null);

  // 1-click negative filter returns only 'itiraz' records
  const negativeOnly = filterMutabakatRecords(records, 'itiraz', '');
  assert.equal(negativeOnly.length, 1);
  assert.equal(negativeOnly[0].mutabakat_kodu, 'MTB-001');

  // Search within filter narrows down by itiraz_notu / cari_unvan / code
  const searchedNote = filterMutabakatRecords(records, 'all', 'ft-88');
  assert.equal(searchedNote.length, 1);
  assert.equal(searchedNote[0].cari_unvan, 'Alfa Ltd.');

  const searchedApproved = filterMutabakatRecords(records, 'mutabik', 'beta');
  assert.equal(searchedApproved.length, 1);
  assert.equal(searchedApproved[0].mutabakat_kodu, 'MTB-002');
});

test('MutabakatlarPage, GunSonuRaporlarPage, and simplified collapsible Hesabim sidebar are wired cleanly', () => {
  const mutabakatPageSrc = fs.readFileSync(path.join(rootDir, 'src/pages/MutabakatlarPage.tsx'), 'utf8');
  assert.ok(mutabakatPageSrc.includes('entitlements.canUseMutabakat'));
  assert.ok(mutabakatPageSrc.includes('data-testid="mutabakat_kurumsal_lock_screen"'));
  assert.ok(mutabakatPageSrc.includes('data-testid="mutabakat_filter_itiraz"'));
  assert.ok(mutabakatPageSrc.includes('data-testid="mutabakat_quick_negative_btn"'));
  assert.ok(mutabakatPageSrc.includes('data-testid="mutabakat_create_new_btn"'));

  const gunSonuRaporlarSrc = fs.readFileSync(path.join(rootDir, 'src/pages/GunSonuRaporlarPage.tsx'), 'utf8');
  assert.ok(gunSonuRaporlarSrc.includes('data-testid="gun_sonu_raporlar_tab_gun_sonu"'));
  assert.ok(gunSonuRaporlarSrc.includes('data-testid="gun_sonu_raporlar_tab_performans"'));
  assert.ok(gunSonuRaporlarSrc.includes('<PlasiyerGunSonuPage'));
  assert.ok(gunSonuRaporlarSrc.includes('<PlasiyerPerformansPage'));

  const layoutSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/AppLayout.tsx'), 'utf8');
  assert.ok(layoutSrc.includes('const [hesabimOpen, setHesabimOpen] = useState(false);'));
  assert.ok(layoutSrc.includes('data-testid="nav_makbuz_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_mutabakat_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_hesabim_toggle_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_hesabim_toggle_mobile"'));
  assert.ok(layoutSrc.includes('data-testid="nav_gun_sonu_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_gun_sonu_mobile"'));

  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes("effectiveTab === 'mutabakat'"));
  assert.ok(appSrc.includes('<MutabakatlarPage'));
  assert.ok(appSrc.includes('<GunSonuRaporlarPage'));
  assert.ok(appSrc.includes("effectiveTab === 'makbuz'"));
});

