import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatements } from '../src/parse/statements.js';
import { mergeFiscalYears } from '../src/fiscal.js';
import { runChecks } from '../src/checks.js';
import { companyJson } from '../src/output.js';
import { COMPANIES, reportsByYear } from '../src/sources/companies.js';
import { loadReport } from './helpers.js';

const extract = (name, filed) => {
  const { url, pages } = loadReport(name);
  return extractStatements(pages, { url }).extractions.map((e) => ({ ...e, filed }));
};

test('fixtures -> merged years -> checks pass on every year (perpetual securities included)', () => {
  const ex = [...extract('z74-fy2021', '2021-06-28'), ...extract('z74-fy2023', '2023-06-21'), ...extract('z74-fy2026', '2026-06-23')];
  const years = mergeFiscalYears(ex);
  assert.deepEqual(years.map((y) => y.fiscalYear), [2020, 2021, 2022, 2023, 2025, 2026]);
  for (const y of years) {
    const { failures } = runChecks(y.values);
    assert.deepEqual(failures, [], `FY${y.fiscalYear}`);
  }
  const json = companyJson(years.map((y) => ({ ...y, values: runChecks(y.values).values })));
  const fy26 = json.fiscalYears.at(-1);
  assert.equal(fy26.filed, '2026-06-23');
  assert.equal(fy26.dividendsPerShare, null); // not read yet: left blank, never estimated
  assert.ok(!('perpetualSecurities' in fy26));
});

test('without perpetual securities, Singtel fails the balance check (the trial bug)', () => {
  const [cur] = extract('z74-fy2026', '2026-06-23');
  const { perpetualSecurities, ...rest } = cur.values;
  assert.ok(perpetualSecurities > 0);
  const { failures, values } = runChecks(rest);
  assert.equal(failures[0].check, 'balance');
  assert.equal(values.totalAssets, null);
});

test('Singtel discovery picks one report per year, statements-only PDFs first', () => {
  const z74 = COMPANIES.find((c) => c.ticker === 'Z74');
  const html = `{&quot;link&quot;:&quot;https://cdn2.singteldigital.com/content/dam/singtel/investorRelations/annualReports/2017/singtelar17-financial-statements.pdf&quot;}
    "https://cdn1.singteldigital.com/content/dam/singtel/investorRelations/annualReports/2017/singtelar17-full-AR.pdf"
    "https://cdn2.singteldigital.com/content/dam/singtel/investorRelations/annualReports/2017/singtelar17-notice-of-agm.pdf"
    "https://cdn2.singteldigital.com/content/dam/singtel/investorRelations/annualReports/2026/AR2026.pdf"
    "https://cdn2.singteldigital.com/content/dam/singtel/investorRelations/annualReports/2015/Singtel_Summary_Financial_Report_2015.pdf"`;
  const years = reportsByYear(z74.discover(html));
  assert.deepEqual(years.map((y) => y.year), [2026, 2017]);
  assert.match(years[1].candidates[0].url, /financial-statements/);
  assert.match(years[1].candidates[1].url, /full-AR/);
});
