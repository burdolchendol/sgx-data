import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatements, dilutedSharesFromNotes, classifyPage, periodEndFrom, yearStart, shiftYears } from '../src/parse/statements.js';
import { isFullYear } from '../src/fiscal.js';
import { loadReport } from './helpers.js';

test('classifyPage: statements yes; notes, summaries and comprehensive income no', () => {
  assert.equal(classifyPage('CONSOLIDATED\nINCOME STATEMENT\nFor the financial year ended 31 March 2026'), 'is');
  assert.equal(classifyPage('STATEMENTS OF\nOverview\nFINANCIAL POSITION\nAs at 31 March 2026'), 'bs');
  assert.equal(classifyPage('Consolidated Statement\nOVERVIEW\nof Cash Flows'), 'cf');
  assert.equal(classifyPage('NOTES TO THE\nFINANCIAL STATEMENTS\nconsolidated income statement'), null);
  assert.equal(classifyPage('Summary Statements of Financial Position'), null);
  assert.equal(classifyPage('Consolidated Statement of\nOVERVIEW\nComprehensive Income\nFor the year\n2021 2020\nItems that may be reclassified to profit or loss'), null);
});

test('period dates', () => {
  assert.equal(periodEndFrom('INCOME STATEMENT\nFor the financial year ended 31 March 2026'), '2026-03-31');
  assert.equal(periodEndFrom('As at 31 December 2024'), '2024-12-31');
  assert.equal(yearStart('2026-03-31'), '2025-04-01');
  assert.ok(isFullYear(yearStart('2024-12-31'), '2024-12-31'));
  assert.equal(shiftYears('2024-02-29', -1), '2023-02-28');
});

test('Singtel FY2026 report: group figures for the current and comparative year', () => {
  const { url, pages } = loadReport('z74-fy2026');
  const { extractions, notes } = extractStatements(pages, { url });
  assert.deepEqual(notes, []);
  const [cur, prior] = extractions;
  assert.equal(cur.periodEnd, '2026-03-31');
  assert.equal(cur.periodStart, '2025-04-01');
  assert.equal(prior.periodEnd, '2025-03-31');
  assert.deepEqual(cur.values, {
    revenue: 14_260_600_000,
    netIncome: 5_606_100_000, // shareholders of the Company, not incl. NCI (5,617.3)
    epsDiluted: 0.3362, // 33.62 cents
    cash: 3_470_400_000,
    currentAssets: 8_924_400_000,
    totalAssets: 50_696_900_000,
    debtCurrent: 1_099_900_000, // 694.9 unsecured + 405.0 secured
    currentLiabilities: 8_581_100_000,
    longTermDebt: 10_578_800_000, // 6,924.2 + 3,654.6; lease liabilities excluded
    totalLiabilities: 21_980_200_000,
    equity: 27_546_800_000,
    perpetualSecurities: 1_012_600_000,
    nonControllingInterests: 157_300_000,
    operatingCashFlow: 4_920_300_000,
    capex: 2_481_600_000,
    dividendsPaid: 3_005_000_000, // final 1,651.3 + interim 1,353.7
    intangiblesInclGoodwill: 9_397_800_000,
    reportingCurrency: 'SGD',
    unitsDetected: true,
  });
  // the comparative column is the prior year, not a copy of the current one
  assert.equal(prior.values.revenue, 14_146_100_000);
  assert.equal(prior.values.netIncome, 4_017_400_000);
  assert.equal(prior.values.totalAssets, 46_783_300_000);
  // company-only columns are never used
  assert.notEqual(cur.values.cash, 93_100_000);
  assert.deepEqual(cur.src.revenue, { url, page: 144, label: 'Operating revenue' });
  assert.equal(cur.src.longTermDebt.page, 147);
});

test('diluted shares come from the EPS note, in units', () => {
  const { pages } = loadReport('z74-fy2026');
  const r = dilutedSharesFromNotes(pages, 2026);
  assert.equal(r.page, 184);
  assert.deepEqual(r.values, [16_557_030_000, 16_558_374_000]);
});

test('older layouts: units below the year row (FY2023) and side tabs inside headings (FY2021)', () => {
  for (const [name, fy, revenue] of [['z74-fy2023', 2023, 14_624_200_000], ['z74-fy2021', 2021, 15_644_000_000]]) {
    const { url, pages } = loadReport(name);
    const { extractions, notes } = extractStatements(pages, { url });
    assert.deepEqual(notes, [], name);
    assert.equal(extractions[0].periodEnd, `${fy}-03-31`);
    assert.equal(Math.round(extractions[0].values.revenue / 1e6), Math.round(revenue / 1e6), name);
    for (const f of ['netIncome', 'totalAssets', 'totalLiabilities', 'equity', 'cash', 'operatingCashFlow', 'capex']) {
      assert.equal(typeof extractions[0].values[f], 'number', `${name} ${f}`);
    }
  }
});
