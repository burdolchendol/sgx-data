// One saved report per layout family, so a parser change that breaks any of them shows up offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatements, dilutedSharesFromNotes } from '../src/parse/statements.js';
import { runChecks } from '../src/checks.js';
import { loadReport } from './helpers.js';

const read = (name) => {
  const { url, pages } = loadReport(name);
  const r = extractStatements(pages, { url });
  const fy = Number(r.extractions[0]?.periodEnd.slice(0, 4));
  return { ...r, shares: dilutedSharesFromNotes(pages, fy) };
};
const M = (v) => (v == null ? v : Math.round(v / 1e6));

test('UOB FY2025 (bank): total operating income, EPS printed in dollars, shares in thousands', () => {
  const { extractions: [cur, prior], notes, shares } = read('u11-fy2025');
  assert.deepEqual(notes, []);
  assert.equal(cur.values.reportingCurrency, 'SGD'); // tables say "$"; the notes say Singapore Dollars
  assert.equal(M(cur.values.revenue), 13808);
  assert.equal(M(cur.values.netIncome), 4682);
  assert.equal(cur.values.epsDiluted, 2.75); // "Earnings per share ($)": not cents
  assert.equal(M(cur.values.totalAssets), 572061);
  assert.equal(cur.values.currentAssets, undefined); // banks don't split current / non-current
  assert.equal(M(prior.values.netIncome), 6045);
  assert.deepEqual(shares.values, [1_671_416_000, 1_681_194_000]);
  assert.deepEqual(runChecks(cur.values).failures, []);
});

test('ST Engineering FY2024: letter-spaced headings, $’000 tables, note codes like "B2"', () => {
  const { extractions: [cur], notes, shares } = read('s63-fy2024');
  assert.deepEqual(notes, []);
  assert.equal(M(cur.values.revenue), 11276);
  assert.equal(M(cur.values.netIncome), 702);
  assert.equal(M(cur.values.cash), 431); // "Bank balances and other liquid funds"
  assert.equal(shares.values[0], 3_141_914_000);
  assert.deepEqual(runChecks({ ...cur.values, dilutedShares: shares.values[0] }).failures, []);
});

test('Wilmar FY2025: two printed pages per PDF page, reported in US$', () => {
  const { extractions: [cur], notes } = read('f34-fy2025');
  assert.deepEqual(notes, []);
  assert.equal(cur.values.reportingCurrency, 'USD');
  assert.equal(M(cur.values.revenue), 70416);
  assert.equal(M(cur.values.netIncome), 1411);
  assert.equal(M(cur.values.capex), 1026); // "Payments for property, plant and equipment"
  assert.equal(M(cur.values.dividendsPaid), 663); // "Dividends paid by the Company"
  assert.deepEqual(runChecks(cur.values).failures, []);
});

test('CapitaLand Investment FY2025: "net assets" balance sheet, $’M tables, date column headers', () => {
  const { extractions: [cur], notes, shares } = read('9ci-fy2025');
  assert.deepEqual(notes, []);
  assert.equal(M(cur.values.revenue), 2133);
  assert.equal(M(cur.values.currentAssets), 3230);
  assert.equal(M(cur.values.currentLiabilities), 2266); // under "Less: current liabilities"
  assert.equal(M(cur.values.equity), 12579); // label wrapped over two lines
  assert.equal(cur.values.totalAssets, undefined); // not printed, so not computed
  assert.equal(cur.values.epsDiluted, 0.029);
  assert.equal(shares.values[0], 5_051_413_000); // "(’000)" from the heading above the row
});

test('ComfortDelGro FY2024: "31 Dec 2024" column headers and $’mil tables', () => {
  const { extractions: [cur], notes } = read('c52-fy2024');
  assert.deepEqual(notes, []);
  assert.equal(M(cur.values.revenue), 4477);
  assert.equal(M(cur.values.totalAssets), 5726);
  assert.equal(M(cur.values.goodwill), 1104);
  assert.deepEqual(runChecks(cur.values).failures, []);
});

test('17LIVE FY2025: one "statement of comprehensive income", US$’000, loss attributable to owners', () => {
  const { extractions: [cur, prior], notes, shares } = read('lvr-fy2025');
  assert.deepEqual(notes, []);
  assert.equal(cur.values.reportingCurrency, 'USD');
  assert.equal(M(cur.values.revenue), 159); // "Operating revenue" 158,797
  assert.equal(cur.values.netIncome, -924_000); // "Loss for the year, attributable to owners of the Company"
  assert.equal(cur.values.epsDiluted, -0.01); // "Basic and diluted", in US$
  assert.deepEqual(shares.values, [180_291_000, 177_625_000]); // basic count; the note says diluted is the same
  assert.equal(prior.values.netIncome, -3_268_000);
  assert.deepEqual(runChecks({ ...cur.values, dilutedShares: shares.values[0] }).failures, []); // -0.0051 prints as (0.01)
});

test('17LIVE FY2023: no non-controlling interests, so total equity is the owners’ equity (negative in 2022)', () => {
  const { extractions: [cur, prior], notes, shares } = read('lvr-fy2023');
  assert.deepEqual(notes, []);
  assert.equal(M(cur.values.equity), 91);
  assert.equal(prior.values.equity, -183_198_000);
  assert.equal(cur.values.epsDiluted, -6.14);
  assert.deepEqual(runChecks({ ...prior.values, dilutedShares: shares.values[1] }).failures, []);
});
