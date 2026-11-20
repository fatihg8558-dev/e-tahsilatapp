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

/**
 * Minimal synchronous/async React hook harness for testing useQuery across re-renders
 * when receiptRefreshKey changes.
 */
function createHookHarness(hookFn) {
  let states = [];
  let refs = [];
  let memos = [];
  let callbacks = [];
  let effects = [];
  let cleanups = [];
  let hookIdx = { state: 0, ref: 0, memo: 0, cb: 0, effect: 0 };
  let latestResult;
  let currentArgs;
  let scheduled = false;

  const depsChanged = (prev, next) => {
    if (!prev || !next) return true;
    if (prev.length !== next.length) return true;
    return next.some((v, i) => !Object.is(v, prev[i]));
  };

  const reactMock = {
    useState(initial) {
      const idx = hookIdx.state++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? initial() : initial;
      }
      const setState = (updater) => {
        const next = typeof updater === 'function' ? updater(states[idx]) : updater;
        if (!Object.is(next, states[idx])) {
          states[idx] = next;
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(() => {
              scheduled = false;
              render(currentArgs);
            });
          }
        }
      };
      return [states[idx], setState];
    },
    useRef(initial) {
      const idx = hookIdx.ref++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx];
    },
    useMemo(factory, deps) {
      const idx = hookIdx.memo++;
      const prev = memos[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        memos[idx] = { value: factory(), deps };
      }
      return memos[idx].value;
    },
    useCallback(fn, deps) {
      const idx = hookIdx.cb++;
      const prev = callbacks[idx];
      if (!prev || depsChanged(prev.deps, deps)) {
        callbacks[idx] = { fn, deps };
      }
      return callbacks[idx].fn;
    },
    useEffect(fn, deps) {
      const idx = hookIdx.effect++;
      effects.push({ idx, fn, deps });
    },
  };

  function render(args) {
    currentArgs = args;
    hookIdx = { state: 0, ref: 0, memo: 0, cb: 0, effect: 0 };
    effects = [];
    latestResult = hookFn(args);
    for (const eff of effects) {
      const prev = cleanups[eff.idx];
      if (!prev || depsChanged(prev.deps, eff.deps)) {
        if (prev?.cleanup) prev.cleanup();
        const cleanup = eff.fn();
        cleanups[eff.idx] = { deps: eff.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      }
    }
    return latestResult;
  }

  return {
    render,
    get current() {
      return latestResult;
    },
    unmount() {
      for (const c of cleanups) c?.cleanup?.();
    },
  };
}

test('IslemlerPage and DashboardPage wire receiptRefreshKey into useQuery queryKey and App.tsx increments it', () => {
  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  const islemlerSrc = fs.readFileSync(path.join(rootDir, 'src/pages/IslemlerPage.tsx'), 'utf8');
  const dashboardSrc = fs.readFileSync(path.join(rootDir, 'src/pages/DashboardPage.tsx'), 'utf8');
  const performansSrc = fs.readFileSync(path.join(rootDir, 'src/pages/PlasiyerPerformansPage.tsx'), 'utf8');

  const gunSonuRaporlarSrc = fs.readFileSync(path.join(rootDir, 'src/pages/GunSonuRaporlarPage.tsx'), 'utf8');

  assert.match(appSrc, /const handleIslemSuccess = [\s\S]*?setReceiptRefreshKey\(\(k\) => k \+ 1\)/);
  assert.match(appSrc, /<DashboardPage[\s\S]*?refreshKey=\{receiptRefreshKey\}/);
  assert.match(appSrc, /<IslemlerPage[\s\S]*?refreshKey=\{receiptRefreshKey\}/);
  assert.match(appSrc, /<GunSonuRaporlarPage[\s\S]*?refreshKey=\{receiptRefreshKey\}/);
  assert.match(gunSonuRaporlarSrc, /<PlasiyerPerformansPage[\s\S]*?refreshKey=\{refreshKey\}/);
  assert.match(appSrc, /<MakbuzModal[\s\S]*?onDeleted=\{[\s\S]*?setReceiptRefreshKey\(\(k\) => k \+ 1\)/);

  assert.match(islemlerSrc, /useQuery<Islem\[\]>\(\{[\s\S]*?queryKey:\s*\[[\s\S]*?'islemler'[\s\S]*?refreshKey[\s\S]*?\]/);
  assert.match(islemlerSrc, /data-receipt-refresh-key=\{refreshKey\}/);
  assert.match(dashboardSrc, /useQuery<DashboardReceiptsSnapshot>\(\{[\s\S]*?queryKey:\s*\[[\s\S]*?'dashboard-receipts'[\s\S]*?refreshKey[\s\S]*?\]/);
  assert.match(dashboardSrc, /data-receipt-refresh-key=\{refreshKey\}/);
  assert.match(performansSrc, /useQuery<Islem\[\]>\(\{[\s\S]*?queryKey:\s*\[[\s\S]*?'plasiyer-performans'[\s\S]*?refreshKey[\s\S]*?\]/);
});

test('useQuery automatically refetches and updates data when receiptRefreshKey increments', async () => {
  let capturedHarness;
  let capturedReactMock;

  // Build harness first, then load useQuery against its react mock
  const tempHarness = createHookHarness(() => null);
  tempHarness.unmount();

  let states = [];
  let refs = [];
  let memos = [];
  let callbacks = [];
  let cleanups = [];
  let hookIdx = { state: 0, ref: 0, memo: 0, cb: 0, effect: 0 };
  let pendingEffects = [];
  let latestResult;
  let latestArgs;
  let scheduled = false;

  const depsChanged = (prev, next) => {
    if (!prev || !next) return true;
    if (prev.length !== next.length) return true;
    return next.some((v, i) => !Object.is(v, prev[i]));
  };

  let renderFn;
  capturedReactMock = {
    useState(initial) {
      const idx = hookIdx.state++;
      if (!(idx in states)) states[idx] = typeof initial === 'function' ? initial() : initial;
      const setState = (updater) => {
        const next = typeof updater === 'function' ? updater(states[idx]) : updater;
        if (!Object.is(next, states[idx])) {
          states[idx] = next;
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(() => {
              scheduled = false;
              renderFn(latestArgs);
            });
          }
        }
      };
      return [states[idx], setState];
    },
    useRef(initial) {
      const idx = hookIdx.ref++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx];
    },
    useMemo(factory, deps) {
      const idx = hookIdx.memo++;
      const prev = memos[idx];
      if (!prev || depsChanged(prev.deps, deps)) memos[idx] = { value: factory(), deps };
      return memos[idx].value;
    },
    useCallback(fn, deps) {
      const idx = hookIdx.cb++;
      const prev = callbacks[idx];
      if (!prev || depsChanged(prev.deps, deps)) callbacks[idx] = { fn, deps };
      return callbacks[idx].fn;
    },
    useEffect(fn, deps) {
      const idx = hookIdx.effect++;
      pendingEffects.push({ idx, fn, deps });
    },
  };

  const { useQuery } = await loadTsWithMocks('src/hooks/useQuery.ts', {
    react: capturedReactMock,
  });

  renderFn = (args) => {
    latestArgs = args;
    hookIdx = { state: 0, ref: 0, memo: 0, cb: 0, effect: 0 };
    pendingEffects = [];
    latestResult = useQuery(args);
    for (const eff of pendingEffects) {
      const prev = cleanups[eff.idx];
      if (!prev || depsChanged(prev.deps, eff.deps)) {
        if (prev?.cleanup) prev.cleanup();
        const cleanup = eff.fn();
        cleanups[eff.idx] = { deps: eff.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
      }
    }
    return latestResult;
  };

  const batches = [
    [{ id: '1', makbuz_no: 'MKB-001', tutar: 500 }],
    [
      { id: '1', makbuz_no: 'MKB-001', tutar: 500 },
      { id: '2', makbuz_no: 'MKB-002', tutar: 1250 },
    ],
  ];
  let fetchCalls = 0;

  const queryFn = async () => {
    const idx = Math.min(fetchCalls++, batches.length - 1);
    return batches[idx];
  };

  // Initial mount with receiptRefreshKey = 0
  renderFn({
    queryKey: ['islemler', 'firma-1', null, null, 'all', 'all', '', '', 0],
    enabled: true,
    initialData: [],
    refetchOnWindowFocus: false,
    queryFn,
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 1);
  assert.equal(latestResult.data.length, 1);
  assert.equal(latestResult.refetchCount, 1);

  // Trigger receiptRefreshKey = 1 (new receipt saved)
  renderFn({
    queryKey: ['islemler', 'firma-1', null, null, 'all', 'all', '', '', 1],
    enabled: true,
    initialData: [],
    refetchOnWindowFocus: false,
    queryFn,
  });

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 2);
  assert.equal(latestResult.data.length, 2);
  assert.equal(latestResult.data[1].makbuz_no, 'MKB-002');
  assert.equal(latestResult.refetchCount, 2);

  for (const c of cleanups) c?.cleanup?.();
  void capturedHarness;
});

test('receiptQueryService falls back cleanly if profiles relationship join fails', async () => {
  const selectLog = [];
  const fakeReceipt = {
    id: 'r-100',
    firma_id: 'firma-1',
    cari_id: 'cari-1',
    tip: 'tahsilat',
    tur: 'kredi_karti',
    tutar: 2500,
    tarih: new Date().toISOString().split('T')[0],
    durum: 'aktif',
    iptal: false,
    makbuz_no: 'MKB-100',
  };

  const makeChain = (table, selectClause) => {
    const chain = {
      eq() { return chain; },
      in() { return chain; },
      not() { return chain; },
      gte() { return chain; },
      lte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      then(resolve) {
        if (table === 'islemler') {
          selectLog.push(selectClause);
          if (selectClause.includes('profiles:yapan_user_id')) {
            return resolve({ data: null, error: { message: 'Could not find a relationship between islemler and profiles' } });
          }
          return resolve({ data: [fakeReceipt], error: null });
        }
        return resolve({ data: [], count: 3, error: null });
      },
    };
    return chain;
  };

  const supabaseMock = {
    from(table) {
      return {
        select(selectClause) {
          return makeChain(table, selectClause);
        },
      };
    },
  };

  const { fetchIslemlerList, fetchDashboardReceiptsSnapshot } = await loadTsWithMocks(
    'src/lib/receiptQueryService.ts',
    {
      '@supabase/supabase-js': {
        createClient() {
          return supabaseMock;
        },
      },
    }
  );

  const list = await fetchIslemlerList({ firmaId: 'firma-1' });
  assert.equal(list.length, 1);
  assert.equal(list[0].makbuz_no, 'MKB-100');
  assert.ok(selectLog.some((s) => s.includes('profiles:yapan_user_id')));
  assert.ok(selectLog.some((s) => !s.includes('profiles:yapan_user_id')));

  const snap = await fetchDashboardReceiptsSnapshot({
    firmaId: 'firma-1',
    vadeAraligiGun: 15,
  });
  assert.equal(snap.sonIslemler.length, 1);
  assert.equal(snap.toplamTahsilat, 2500);
  assert.equal(snap.aktifCariSayisi, 3);
});
