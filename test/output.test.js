import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_FIELDS, companyFile } from '../src/fields.js';
import { companyJson, indexEntry, indexJson } from '../src/output.js';

const years = Array.from({ length: 16 }, (_, i) => ({
  fiscalYear: 2010 + i, periodEnd: `${2010 + i}-12-31`, filed: `${2011 + i}-02-10`,
  values: { revenue: i }, src: { revenue: { url: 'https://links.sgx.com/x.pdf', page: 1, label: 'Revenue' } },
}));

test('companyFile sanitises tickers like the website', () => {
  assert.equal(companyFile('D05'), 'D05.json');
  assert.equal(companyFile('A/B 1'), 'A_B_1.json');
});

test('company file keeps 15 years with every field', () => {
  const c = companyJson(years);
  assert.equal(c.fiscalYears.length, 15);
  assert.equal(c.fiscalYears[0].fiscalYear, 2011);
  for (const f of INDEX_FIELDS) assert.ok(f in c.fiscalYears[0]);
  assert.equal(c.fiscalYears[0].netIncome, null);
});

test('index rows are the latest 11 years, positional', () => {
  const e = indexEntry({ ticker: 'D05', name: 'n', exchange: 'SGX Mainboard', type: 'company', currency: 'SGD', financialCurrency: 'SGD' }, years);
  assert.equal(e.years.length, 11);
  assert.equal(e.years[0][0], 2015);
  assert.equal(e.years[0].length, 2 + INDEX_FIELDS.length);
  assert.equal(e.price, null);
  const idx = indexJson([e], [], '2026-11-06T00:00:00.000Z');
  assert.deepEqual(idx.fields, INDEX_FIELDS);
  assert.deepEqual(idx.fx, { asOf: null, rates: {} });
});
