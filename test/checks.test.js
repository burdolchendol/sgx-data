import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../src/checks.js';

const base = { reportingCurrency: 'SGD', unitsDetected: true };

test('balance check includes NCI and perpetual securities', () => {
  const ok = runChecks({ ...base, totalAssets: 1000, totalLiabilities: 600, equity: 350, nonControllingInterests: 20, perpetualSecurities: 30 });
  assert.equal(ok.failures.length, 0);
  assert.equal(ok.values.totalAssets, 1000);
  assert.equal('perpetualSecurities' in ok.values, false);

  const bad = runChecks({ ...base, totalAssets: 1000, totalLiabilities: 600, equity: 350 });
  assert.equal(bad.failures[0].check, 'balance');
  assert.equal(bad.values.totalAssets, null);
  assert.equal(bad.values.equity, null);
});

test('current assets and cash ordering', () => {
  const r = runChecks({ ...base, totalAssets: 100, currentAssets: 50, cash: 60 });
  assert.deepEqual(r.failures.map((f) => f.check), ['cash']);
  assert.equal(r.values.cash, null);
  assert.equal(r.values.totalAssets, 100);
});

test('EPS check within 5%', () => {
  assert.equal(runChecks({ ...base, netIncome: 395, dilutedShares: 100, epsDiluted: 3.95 }).failures.length, 0);
  const r = runChecks({ ...base, netIncome: 395, dilutedShares: 100, epsDiluted: 4.5 });
  assert.equal(r.failures[0].check, 'eps');
  assert.equal(r.values.epsDiluted, null);
});

test('undetected currency or units blanks the whole year', () => {
  const r = runChecks({ reportingCurrency: null, unitsDetected: true, revenue: 5 });
  assert.equal(r.values.revenue, null);
});
