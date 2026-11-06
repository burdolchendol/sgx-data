import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFullYear, fiscalYearOf, mergeFiscalYears } from '../src/fiscal.js';

test('full-year window is 340 to 390 days', () => {
  assert.equal(isFullYear('2024-01-01', '2024-12-31'), true);
  assert.equal(isFullYear('2024-01-01', '2024-06-30'), false);
  assert.equal(isFullYear('2023-01-01', '2024-03-31'), false); // 15 months
});

test('fiscalYear is the calendar year of periodEnd', () => {
  assert.equal(fiscalYearOf('2025-03-31'), 2025);
});

test('most recently filed figure wins; half years ignored; gaps not wiped', () => {
  const rows = mergeFiscalYears([
    { periodStart: '2023-04-01', periodEnd: '2024-03-31', filed: '2024-05-15', values: { revenue: 100, cash: 7 }, src: { revenue: { url: 'a' } } },
    { periodStart: '2024-04-01', periodEnd: '2025-03-31', filed: '2025-05-15', values: { revenue: 120 }, src: {} },
    // FY2025 report restates FY2024 revenue as a comparative
    { periodStart: '2023-04-01', periodEnd: '2024-03-31', filed: '2025-05-15', values: { revenue: 101, cash: null }, src: { revenue: { url: 'b' } } },
    { periodStart: '2024-04-01', periodEnd: '2024-09-30', filed: '2024-11-10', values: { revenue: 999 }, src: {} },
  ]);
  assert.deepEqual(rows.map((r) => r.fiscalYear), [2024, 2025]);
  assert.equal(rows[0].values.revenue, 101);
  assert.equal(rows[0].src.revenue.url, 'b');
  assert.equal(rows[0].values.cash, 7);
  assert.equal(rows[1].values.revenue, 120);
});
