import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatements, dilutedSharesFromNotes } from '../src/parse/statements.js';
import { runChecks } from '../src/checks.js';
import { ligatures } from '../src/pdf.js';

// A made-up bank laid out the way DBS prints its statements (the figures are invented): no current
// split, owners' equity as "Shareholders' funds" with other equity instruments above it, footnote
// markers after labels, cash only in the cash-flow statement, EPS "per ordinary share".
const pad = (label, ...figs) => label.padEnd(60) + figs.map((f) => String(f).padStart(12)).join('');
const is = [
  'Consolidated Income Statement',
  'for the year ended 31 December 2024',
  pad('In S$ millions', 2024, 2023),
  pad('Total income', '1,000', '900'),
  pad('Profit before tax', '500', '450'),
  pad('Income tax expense', '(100)', '(90)'),
  pad('Net profit', '400', '360'),
  '',
  'Attributable to:',
  pad('Shareholders of the parent', '390', '350'),
  pad('Non-controlling interests', '10', '10'),
  '',
  pad('Basic earnings per ordinary share ($)', '1.95', '1.75'),
  pad('Diluted earnings per ordinary share ($)', '1.95', '1.75'),
].join('\n');
const bs = [
  'Consolidated Balance Sheet',
  'at 31 December 2024',
  pad('In S$ millions', 2024, 2023),
  'Assets',
  pad('Loans and advances to customers', '15,000', '14,000'),
  pad('Total assets', '20,000', '18,000'),
  'Liabilities',
  pad('Deposits and balances from customers', '17,000', '15,400'),
  pad('Total liabilities', '18,000', '16,200'),
  'Equity',
  pad('Share capital', '1,000', '1,000'),
  pad('Other equity instruments (1)', '100', '100'),
  pad('Revenue reserves', '800', '600'),
  pad("Shareholders' funds", '1,900', '1,700'),
  pad('Non-controlling interests', '100', '100'),
  pad('Total equity', '2,000', '1,800'),
].join('\n');
const cf = ligatures([
  'Consolidated Cash ȵow Statement',
  'for the year ended 31 December 2024',
  pad('In S$ millions', 2024, 2023),
  pad('Net cash generated from operating activities (1)', '700', '650'),
  pad('Acquisition of properties and other fixed assets', '(50)', '(40)'),
  pad('Dividends paid to shareholders of the Company, net of scrip dividends', '(200)', '(180)'),
  pad('Cash and cash equivalents at 31 December', '1,200', '1,100'),
].join('\n'));
const note = [
  'Notes to the financial statements',
  '13. Earnings Per Ordinary Share',
  pad('', 'The Group'),
  pad("Number of shares ('000)", 2024, 2023),
  pad('Weighted average number of ordinary shares in issue (basic and diluted)  (a)', '200,000', '200,000'),
  '',
  pad('In S$ millions', 2024, 2023),
  pad('Net profit attributable to shareholders', '390', '350'),
].join('\n');

test('bank layout: shareholders of the parent, shareholders\' funds, cash from the cash-flow statement', () => {
  const { extractions } = extractStatements([is, bs, cf, note], { url: 'x' });
  const [cur, prev] = extractions;
  assert.equal(cur.periodEnd, '2024-12-31');
  const v = cur.values;
  assert.equal(v.revenue, 1000e6);
  assert.equal(v.netIncome, 390e6);
  assert.equal(v.epsDiluted, 1.95);
  assert.equal(v.equity, 1900e6);
  assert.ok(!('perpetualSecurities' in v)); // already inside shareholders' funds
  assert.equal(v.cash, 1200e6);
  assert.equal(v.operatingCashFlow, 700e6);
  assert.equal(v.capex, 50e6);
  assert.equal(v.dividendsPaid, 200e6);
  assert.equal(prev.values.cash, 1100e6);
  const shares = dilutedSharesFromNotes([is, bs, cf, note], 2024);
  assert.deepEqual(shares.values, [200e6, 200e6]);
  assert.deepEqual(runChecks({ ...v, dilutedShares: shares.values[0] }).failures, []);
});

test('ligatures are spelled out', () => {
  assert.equal(ligatures('Cash ﬂows from ﬁnancing'), 'Cash flows from financing');
  assert.equal(ligatures('Cash ȵows from ȴnancing'), 'Cash flows from financing');
});
