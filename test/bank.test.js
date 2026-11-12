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

test('"Share capital & reserves" is owners\' equity, with an en dash in "Non–controlling interests"', () => {
  const page = [
    'Balance Sheets',
    'as at 31 December 2025',
    pad("$'000", 2025, 2024),
    pad('Total assets', '30,000', '29,000'),
    pad('Total liabilities', '18,000', '17,000'),
    pad('Share capital', '1,300', '1,300'),
    pad('Reserves', '9,300', '9,500'),
    pad('Share capital & reserves', '10,600', '10,800'),
    pad('Perpetual securities', '400', '400'),
    pad('Non–controlling interests', '1,000', '800'),
    pad('Total equity', '12,000', '12,000'),
  ].join('\n');
  const [cur] = extractStatements([page], { url: 'x' }).extractions;
  assert.equal(cur.values.equity, 10_600_000);
  assert.equal(cur.values.nonControllingInterests, 1_000_000);
  assert.equal(cur.values.perpetualSecurities, 400_000);
});

test('split financial years ("FY2023/24", "2012-13") read as the year they end in', async () => {
  const { findHeader } = await import('../src/parse/layout.js');
  assert.deepEqual(findHeader(['   (in $ million)', pad('', 'FY2023/24', 'FY2022/23')]).years, [2024, 2023]);
  assert.deepEqual(findHeader(['   $ million', pad('Notes', '2012-13', '2011-12')]).years, [2013, 2012]);
  assert.deepEqual(findHeader(["   $'000", pad('Note', '31/12/2023', '31/12/2022')]).years, [2023, 2022]);
});

test('REIT statement of total return; net current assets closes the current sections', () => {
  const str = [
    'Consolidated Statement of Total Return',
    'Year ended 31 December 2024',
    pad("$'000", 2024, 2023),
    pad('Gross revenue', '1,500', '1,400'),
    pad('Total return for the year', '760', '170'),
    'Attributable to:',
    pad('Unitholders of Example REIT', '750', '160'),
    pad('Perpetual securities holders', '10', '10'),
    'Earnings per Unit (cents)',
    pad('– Basic and diluted', '17.00', '3.60'),
  ].join('\n');
  const bs = [
    'Statement of Financial Position',
    'As at 31 December 2024',
    pad("$'000", 2024, 2023),
    'Current assets',
    pad('Cash and fixed deposits', '100', '90'),
    pad('', '300', '280'),
    pad('Assets held for sale', '50', '0'),
    pad('', '350', '280'),
    'Current liabilities',
    pad('Trade and other payables', '200', '210'),
    pad('', '200', '210'),
    pad('Net current assets', '150', '70'),
    'Non–current liabilities',
    pad('Term loans', '4,000', '4,100'),
    pad('', '4,000', '4,100'),
    pad('Total assets', '18,000', '18,100'),
    pad('Total liabilities', '7,900', '8,000'),
    pad("Unitholders’ funds", '9,800', '9,800'),
    pad('Perpetual securities holders’ funds', '300', '300'),
  ].join('\n');
  const [cur] = extractStatements([str, bs], { url: 'x' }).extractions;
  const v = cur.values;
  assert.equal(v.revenue, 1_500_000);
  assert.equal(v.netIncome, 750_000);
  assert.equal(v.epsDiluted, 0.17);
  assert.equal(v.currentAssets, 350_000); // includes assets held for sale
  assert.equal(v.currentLiabilities, 200_000); // not the non-current subtotal below it
  assert.equal(v.longTermDebt, 4_000_000);
  assert.equal(v.cash, 100_000);
  assert.equal(v.equity, 9_800_000);
  assert.equal(v.perpetualSecurities, 300_000);
});

test('net-assets balance sheet: total assets and liabilities from the segment note, when they agree', () => {
  const bs = [
    'Statements of Financial Position',
    'As at 31 December 2023',
    pad("$'000", 2023, 2022),
    'Current assets',
    pad('Cash and cash equivalents', '3,600', '3,400'),
    pad('', '3,900', '3,600'),
    pad('Net current assets', '3,100', '3,000'),
    pad('Share capital', '5,500', '5,500'),
    pad('Retained earnings', '2,700', '2,500'),
    pad('Total equity', '8,200', '8,000'),
  ].join('\n');
  const note = (year, ta, tl) => [
    'Notes to the financial statements',
    '29. Segment information',
    `      ${year}                     $'000`,
    pad('Segment assets', '9,000'),
    pad('Consolidated total assets', ta),
    pad('Consolidated total liabilities', tl),
  ].join('\n');
  const good = extractStatements([bs, note(2023, '9,150', '950'), note(2022, '8,800', '800')], { url: 'x' }).extractions;
  assert.equal(good[0].values.totalAssets, 9_150_000);
  assert.equal(good[0].values.totalLiabilities, 950_000);
  assert.equal(good[1].values.totalAssets, 8_800_000);
  // figures that don't add up to total equity are left blank
  const bad = extractStatements([bs, note(2023, '9,999', '950')], { url: 'x' }).extractions;
  assert.equal(bad[0].values.totalAssets, undefined);
});

test('Jardine-style statements: three columns a year, "31st December", EPS in US$ or US¢, split labels', () => {
  const row = (label, ...figs) => label.padEnd(36) + figs.map((f) => String(f).padStart(12)).join('');
  const is = [
    'Consolidated Profit and Loss Account',
    'for the year ended 31st December 2025',
    ''.padEnd(36) + '2025'.padStart(36) + '2024'.padStart(36),
    row('', 'Underlying', 'Non-', '', 'Underlying', 'Non-'),
    row('', 'business', 'trading', '', 'business', 'trading'),
    row('', 'performance', 'items', 'Total', 'performance', 'items', 'Total'),
    row('Note', 'US$m', 'US$m', 'US$m', 'US$m', 'US$m', 'US$m'),
    row('Revenue                3', '33,817', '400', '34,217', '34,864', '915', '35,779'),
    row('Profit before tax', '4,362', '(161)', '4,201', '4,470', '(3,039)', '1,431'),
    'Attributable to:',
    'Shareholders of the',
    row('  Company            8&9', '1,681', '(572)', '1,109', '1,518', '(1,986)', '(468)'),
    row('Non-controlling interests', '1,884', '298', '2,182', '2,126', '(1,103)', '1,023'),
    row('', 'US$', '', 'US$', 'US$', '', 'US$'),
    'Earnings per share',
    row('– diluted               8', '5.72', '', '3.77', '5.23', '', '(1.61)'),
  ].join('\n');
  const [cur, prior] = extractStatements([is], { url: 'x' }).extractions;
  assert.equal(cur.periodEnd, '2025-12-31');
  assert.equal(cur.values.revenue, 34_217_000_000);
  assert.equal(prior.values.revenue, 35_779_000_000);
  assert.equal(cur.values.netIncome, 1_109_000_000);
  assert.equal(prior.values.netIncome, -468_000_000);
  assert.equal(cur.values.epsDiluted, 3.77);
  // EPS printed with "cents" beside each figure
  const cdl = [
    'CONSOLIDATED STATEMENT OF PROFIT OR LOSS',
    'Year ended 31 December 2025',
    pad("$'000", 2025, 2024),
    pad('Revenue', '3,587,000', '3,271,000'),
    'Profit attributable to owners of the Company:',
    pad('– Ordinary shareholders', '620,276', '190,849'),
    pad('– Preference shareholders', '9,407', '10,467'),
    pad('', '629,683', '201,316'),
    'Earnings per share',
    pad('– Diluted', '67.9 cents', '21.3 cents'),
  ].join('\n');
  const [c] = extractStatements([cdl], { url: 'x' }).extractions;
  // the ordinary shareholders' line is taken (what EPS is based on)
  assert.equal(c.values.netIncome, 620_276_000);
  assert.equal(c.values.epsDiluted, 0.679);
});

test('REIT headers: "FY23/24" and "FY2026" columns, a bare date under the title, perpetual securities holders', () => {
  const bs = [
    'Statements of Financial Position',
    '31 March 2024',
    pad('', 'FY23/24', 'FY22/23'),
    pad('', "S$'000", "S$'000"),
    pad('Total assets', '13,812,335', '13,423,195'),
    pad('Total liabilities', '6,327,903', '5,900,771'),
    pad('Net assets', '7,484,432', '7,522,424'),
    'Represented by:',
    pad('Unitholders’ funds', '6,884,841', '6,926,920'),
    pad('Perpetual securities holders', '581,545', '581,505'),
    pad('Non-controlling interest', '18,046', '13,999'),
  ].join('\n');
  const [cur] = extractStatements([bs], { url: 'x' }).extractions;
  assert.equal(cur.periodEnd, '2024-03-31');
  const { values, failures } = runChecks(cur.values);
  assert.deepEqual(failures, []);
  assert.equal(values.totalAssets, 13_812_335_000);
  assert.equal(cur.values.perpetualSecurities, 581_545_000);
  const is = ['Consolidated Income Statement', 'for the financial year ended 31 March 2026', pad('', 'FY2026', 'FY2025'), pad('Note', '$ million', '$ million'), pad('Revenue', '6,345.5', '5,821.1')].join('\n');
  assert.equal(extractStatements([is], { url: 'x' }).extractions[0].values.revenue, 6_345_500_000);
});
