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

test('portfoyService: tag building, extraction, upsert, and resolvePortfoyDurumu', async () => {
  const {
    buildPortfoyTag,
    extractPortfoyTagFields,
    extractPortfoyMeta,
    upsertPortfoyTagInAciklama,
    resolvePortfoyDurumu,
    isPortfoyEligibleIslem,
  } = await loadTsWithMocks('src/lib/portfoyService.ts', supabaseStub);

  const tag = buildPortfoyTag({
    durum: 'ciro_edildi',
    tarih: '2026-11-19',
    ciroCariId: 'cari-99',
    ciroHedefAd: 'Yıldız [Gıda] | Ltd',
    not: 'Banka teslim | 1. şube',
  });
  assert.ok(tag.startsWith('[PORTFOY:ciro_edildi|'));
  assert.ok(tag.includes('ciroCari=cari-99'));
  assert.ok(tag.includes('ciroAd=Yıldız (Gıda) / Ltd'));

  const parsed = extractPortfoyTagFields(`Müşteri çek açıklaması\n${tag}`);
  assert.equal(parsed?.durum, 'ciro_edildi');
  assert.equal(parsed?.tarih, '2026-11-19');
  assert.equal(parsed?.ciroCariId, 'cari-99');
  assert.equal(parsed?.ciroHedefAd, 'Yıldız (Gıda) / Ltd');
  assert.equal(parsed?.not, 'Banka teslim / 1. şube');

  const updated = upsertPortfoyTagInAciklama(
    'İlk çek notu\n[PORTFOY:portfoyde|tarih=2026-11-01]',
    { durum: 'tahsil_edildi', tarih: '2026-11-19', kasaId: 'kasa-1' }
  );
  assert.ok(!updated.includes('[PORTFOY:portfoyde'));
  assert.ok(updated.includes('İlk çek notu'));
  assert.ok(updated.includes('[PORTFOY:tahsil_edildi|tarih=2026-11-19|kasa=kasa-1]'));

  // Explicit DB column takes precedence over tag
  assert.equal(
    resolvePortfoyDurumu({
      id: '1',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tahsilat',
      tur: 'cek',
      tutar: 5000,
      tarih: '2026-11-10',
      durum: 'aktif',
      iptal: false,
      portfoy_durumu: 'tahsilde',
      aciklama: '[PORTFOY:portfoyde]',
    }),
    'tahsilde'
  );

  // Fallback to tag when portfoy_durumu column is absent
  assert.equal(
    resolvePortfoyDurumu({
      id: '2',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tahsilat',
      tur: 'senet',
      tutar: 3000,
      tarih: '2026-11-10',
      durum: 'aktif',
      iptal: false,
      aciklama: '[PORTFOY:tahsil_edildi|kasa=k-1]',
    }),
    'tahsil_edildi'
  );

  // Fallback for cancelled karsiliksiz check
  const bounced = {
    id: '3',
    firma_id: 'f1',
    cari_id: 'c1',
    tip: 'tahsilat',
    tur: 'cek',
    tutar: 2500,
    tarih: '2026-11-10',
    durum: 'aktif',
    iptal: true,
    iptal_nedeni: 'Karşılıksız Çek/Senet',
  };
  assert.equal(resolvePortfoyDurumu(bounced), 'karsiliksiz');
  assert.equal(isPortfoyEligibleIslem(bounced), true);

  // Regular cancelled check (not karsiliksiz) & capraz rows are excluded
  assert.equal(
    isPortfoyEligibleIslem({
      ...bounced,
      iptal_nedeni: 'Hatalı giriş',
    }),
    false
  );
  assert.equal(
    isPortfoyEligibleIslem({
      id: '4',
      firma_id: 'f1',
      cari_id: 'c1',
      tip: 'tahsilat',
      tur: 'cek',
      tutar: 1000,
      tarih: '2026-11-10',
      belge_no: 'ÇPZ-10',
      durum: 'aktif',
      iptal: false,
    }),
    false
  );

  const meta = extractPortfoyMeta({
    id: '5',
    firma_id: 'f1',
    cari_id: 'c1',
    tip: 'tahsilat',
    tur: 'cek',
    tutar: 1000,
    tarih: '2026-11-10',
    durum: 'aktif',
    iptal: false,
    aciklama: '[CİRO EDİLDİ -> Akdeniz Toptan]',
  });
  assert.equal(meta.durum, 'ciro_edildi');
  assert.equal(meta.ciroHedefAd, 'Akdeniz Toptan');
});

test('portfoyService: computePortfoyVadeInfo and computePortfoySummary classify due urgency and totals', async () => {
  const { computePortfoyVadeInfo, computePortfoySummary } = await loadTsWithMocks(
    'src/lib/portfoyService.ts',
    supabaseStub
  );

  const now = new Date(2026, 10, 19, 10, 0, 0); // 2026-11-19

  assert.equal(computePortfoyVadeInfo('2026-11-15', 'portfoyde', now).urgency, 'overdue');
  assert.equal(computePortfoyVadeInfo('2026-11-19', 'portfoyde', now).urgency, 'today');
  assert.equal(computePortfoyVadeInfo('2026-11-23', 'tahsilde', now).urgency, 'upcoming');
  assert.equal(computePortfoyVadeInfo('2026-12-10', 'portfoyde', now).urgency, 'future');
  assert.equal(computePortfoyVadeInfo(null, 'portfoyde', now).urgency, 'none');
  assert.equal(computePortfoyVadeInfo('2026-11-15', 'tahsil_edildi', now).urgency, 'settled');

  const summary = computePortfoySummary(
    [
      {
        id: '1',
        firma_id: 'f1',
        cari_id: 'c1',
        tip: 'tahsilat',
        tur: 'cek',
        tutar: 10000,
        tarih: '2026-11-01',
        vade: '2026-11-15',
        durum: 'aktif',
        iptal: false,
        portfoy_durumu: 'portfoyde',
      },
      {
        id: '2',
        firma_id: 'f1',
        cari_id: 'c1',
        tip: 'tahsilat',
        tur: 'senet',
        tutar: 5000,
        tarih: '2026-11-01',
        vade: '2026-11-19',
        durum: 'aktif',
        iptal: false,
        portfoy_durumu: 'tahsilde',
      },
      {
        id: '3',
        firma_id: 'f1',
        cari_id: 'c1',
        tip: 'tahsilat',
        tur: 'cek',
        tutar: 7500,
        tarih: '2026-11-01',
        vade: '2026-11-10',
        durum: 'aktif',
        iptal: false,
        portfoy_durumu: 'tahsil_edildi',
      },
      {
        id: '4',
        firma_id: 'f1',
        cari_id: 'c1',
        tip: 'tahsilat',
        tur: 'cek',
        tutar: 4000,
        tarih: '2026-11-01',
        vade: '2026-11-25',
        durum: 'aktif',
        iptal: false,
        portfoy_durumu: 'ciro_edildi',
      },
      {
        id: '5',
        firma_id: 'f1',
        cari_id: 'c1',
        tip: 'tahsilat',
        tur: 'cek',
        tutar: 2500,
        tarih: '2026-11-01',
        vade: '2026-11-05',
        durum: 'aktif',
        iptal: true,
        iptal_nedeni: 'Karşılıksız Çek/Senet',
        portfoy_durumu: 'karsiliksiz',
      },
      {
        // Nakit islem should be ignored
        id: '6',
        firma_id: 'f1',
        cari_id: 'c1',
        tip: 'tahsilat',
        tur: 'nakit',
        tutar: 99999,
        tarih: '2026-11-01',
        durum: 'aktif',
        iptal: false,
      },
    ],
    now
  );

  assert.equal(summary.totalCount, 5);
  assert.equal(summary.portfoydeTotal, 10000);
  assert.equal(summary.tahsildeTotal, 5000);
  assert.equal(summary.tahsilEdildiTotal, 7500);
  assert.equal(summary.ciroEdildiTotal, 4000);
  assert.equal(summary.karsiliksizTotal, 2500);
  assert.equal(summary.overdueCount, 1);
  assert.equal(summary.overdueTotal, 10000);
  assert.equal(summary.dueSoonCount, 1);
  assert.equal(summary.dueSoonTotal, 5000);
});

test('noteTagHelper: stripInternalSystemTags removes internal system metadata while preserving user/check tags', async () => {
  const { stripInternalSystemTags } = await loadTsWithMocks('src/lib/noteTagHelper.ts');

  const raw = [
    '[ÇEK SATIRI] Yapı Kredi • Çek No: 12345',
    '[DÖVİZ: 1.000 USD × 34.50]',
    '[KARMA-KALEM-1: nakit 5000]',
    '[PORTFOY:tahsilde|tarih=2026-11-19|not=Garanti]',
    '[GS_ONAY:req-1|2500|0|Ahmet|2026-11-19|Teslim]',
    '[GS_RED:Eksik%20say%C4%B1m]',
    '[PORTFOY-TAHSIL:abc-123]',
  ].join('\n');

  const cleaned = stripInternalSystemTags(raw);
  assert.ok(cleaned.includes('[ÇEK SATIRI] Yapı Kredi • Çek No: 12345'));
  assert.ok(cleaned.includes('[DÖVİZ: 1.000 USD × 34.50]'));
  assert.ok(cleaned.includes('[KARMA-KALEM-1: nakit 5000]'));
  assert.ok(!cleaned.includes('[PORTFOY:'));
  assert.ok(!cleaned.includes('[GS_ONAY:'));
  assert.ok(!cleaned.includes('[GS_RED:'));
  assert.ok(!cleaned.includes('[PORTFOY-TAHSIL:'));
});

test('whatsappTemplates builds accurate Turkish reminder templates for vade and cari debt/credit', async () => {
  const { buildVadeHatirlatmaMesaji, buildCariBorcHatirlatmaMesaji } = await loadTsWithMocks(
    'src/lib/whatsappTemplates.ts'
  );

  const overdue = buildVadeHatirlatmaMesaji({
    firmaUnvan: 'Örnek Dağıtım',
    cariUnvan: 'Anadolu Market',
    evrakTur: 'cek',
    belgeNo: 'CK-901',
    tutar: 15000,
    vadeTarihi: '2026-11-15',
    diffDays: -4,
  });
  assert.ok(overdue.includes('Sayın Anadolu Market,'));
  assert.ok(overdue.includes('CK-901 numaralı'));
  assert.ok(overdue.includes('4 gün geçmiştir'));
  assert.ok(overdue.includes('Örnek Dağıtım'));

  const today = buildVadeHatirlatmaMesaji({
    cariUnvan: 'Bora Ticaret',
    evrakTur: 'senet',
    tutar: 4500,
    vadeTarihi: '2026-11-19',
    diffDays: 0,
  });
  assert.ok(today.includes('bugün dolmaktadır'));
  assert.ok(today.includes('senediniz'));

  const upcoming = buildVadeHatirlatmaMesaji({
    cariUnvan: 'Cem Gıda',
    evrakTur: 'cek',
    tutar: 8000,
    vadeTarihi: '2026-11-24',
    diffDays: 5,
  });
  assert.ok(upcoming.includes('5 gün sonra'));

  const bounced = buildVadeHatirlatmaMesaji({
    cariUnvan: 'Deniz Lojistik',
    evrakTur: 'cek',
    belgeNo: 'CK-777',
    tutar: 12000,
    vadeTarihi: '2026-11-10',
    portfoyDurumu: 'karsiliksiz',
  });
  assert.ok(bounced.includes('karşılıksız/ödenmemiş'));

  const debitMsg = buildCariBorcHatirlatmaMesaji({
    firmaUnvan: 'Örnek Dağıtım',
    cariUnvan: 'Anadolu Market',
    bakiye: 22500,
    sonTarih: '19.11.2026',
  });
  assert.ok(debitMsg.includes('açık borç bakiyesi'));

  const creditMsg = buildCariBorcHatirlatmaMesaji({
    firmaUnvan: 'Örnek Dağıtım',
    cariUnvan: 'Tedarikçi A.Ş.',
    bakiye: -8400,
    sonTarih: '19.11.2026',
  });
  assert.ok(creditMsg.includes('alacak bakiyeniz'));
});

test('cariRiskAndMutabakat evaluates risk thresholds and computes balance verification accurately', async () => {
  const { evaluateCariRiskStatus, computeCariBalanceVerification } = await loadTsWithMocks(
    'src/lib/cariRiskAndMutabakat.ts',
    supabaseStub
  );

  assert.equal(
    evaluateCariRiskStatus({ currentBakiye: 50000, riskLimit: null }).level,
    'none'
  );
  assert.equal(
    evaluateCariRiskStatus({ currentBakiye: 40000, riskLimit: 100000 }).level,
    'ok'
  );
  const warn = evaluateCariRiskStatus({
    currentBakiye: 70000,
    pendingDelta: 15000,
    riskLimit: 100000,
  });
  assert.equal(warn.level, 'warning');
  assert.equal(warn.percent, 85);
  assert.equal(warn.remainingLimit, 15000);

  const exceeded = evaluateCariRiskStatus({
    currentBakiye: 90000,
    pendingDelta: 25000,
    riskLimit: 100000,
  });
  assert.equal(exceeded.level, 'exceeded');
  assert.equal(exceeded.overageAmount, 15000);

  const matching = computeCariBalanceVerification({
    cari: { id: 'c1', unvan: 'Cari A', tur: 'alici', bakiye: 6500 },
    faturalar: [
      { cari_id: 'c1', yon: 'satis', tutar: 10000 },
      { cari_id: 'c1', yon: 'alis', tutar: 2000 },
      { cari_id: 'other', yon: 'satis', tutar: 99999 },
    ],
    islemler: [
      { cari_id: 'c1', tip: 'tahsilat', tutar: 2500, iptal: false },
      { cari_id: 'c1', tip: 'tediye', tutar: 1000, iptal: false },
      { cari_id: 'c1', tip: 'tahsilat', tutar: 5000, iptal: true }, // iptal ignored
    ],
  });
  assert.equal(matching.calculatedBakiye, 6500);
  assert.equal(matching.hasDiscrepancy, false);
  assert.equal(matching.diff, 0);

  const drifted = computeCariBalanceVerification({
    cari: { id: 'c1', unvan: 'Cari A', tur: 'alici', bakiye: 8000 },
    faturalar: [{ cari_id: 'c1', yon: 'satis', tutar: 10000 }],
    islemler: [{ cari_id: 'c1', tip: 'tahsilat', tutar: 3500, iptal: false }],
  });
  assert.equal(drifted.calculatedBakiye, 6500);
  assert.equal(drifted.hasDiscrepancy, true);
  assert.equal(drifted.diff, 1500);
});

test('UI entry points for Portfoy, WhatsApp, and Risk/Audit are wired across pages and AppLayout', () => {
  const appSrc = fs.readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8');
  assert.ok(appSrc.includes("'portfoy'"));
  assert.ok(appSrc.includes('CekSenetPortfoyPage'));

  const layoutSrc = fs.readFileSync(path.join(rootDir, 'src/components/layout/AppLayout.tsx'), 'utf8');
  assert.ok(layoutSrc.includes('data-testid="nav_portfoy_desktop"'));
  assert.ok(layoutSrc.includes('data-testid="nav_portfoy_mobile"'));

  const dashSrc = fs.readFileSync(path.join(rootDir, 'src/pages/DashboardPage.tsx'), 'utf8');
  assert.ok(dashSrc.includes('data-testid="dashboard_open_portfoy_btn"'));
  assert.ok(dashSrc.includes('WhatsAppReminderModal'));

  const carilerSrc = fs.readFileSync(path.join(rootDir, 'src/pages/CarilerPage.tsx'), 'utf8');
  assert.ok(carilerSrc.includes('data-testid="cariler_audit_balances_btn"'));
  assert.ok(carilerSrc.includes('data-testid="cari_risk_limit_input"'));
  assert.ok(carilerSrc.includes('data-testid="ekstre_balance_verification_strip"'));
  assert.ok(carilerSrc.includes('WhatsAppReminderModal'));

  const islemFormSrc = fs.readFileSync(path.join(rootDir, 'src/pages/IslemFormPage.tsx'), 'utf8');
  assert.ok(islemFormSrc.includes('data-testid="islem_risk_limit_warning"'));

  const ublSrc = fs.readFileSync(path.join(rootDir, 'src/components/cari/UblImportModal.tsx'), 'utf8');
  assert.ok(ublSrc.includes('ubl_risk_warning_'));
});
