// Writes out/sg/ in the website's snapshot format.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INDEX_FIELDS, companyFile } from './fields.js';

const val = (x) => (x === undefined ? null : x);

/** companies/<TICKER>.json body: up to 15 years, oldest first. */
export function companyJson(years) {
  return {
    fiscalYears: years.slice(-15).map((y) => {
      const row = { fiscalYear: y.fiscalYear, periodEnd: y.periodEnd };
      for (const f of INDEX_FIELDS) row[f] = val(y.values[f]);
      row.filed = y.filed ?? null;
      row.src = y.src ?? {};
      return row;
    }),
  };
}

/** index.json entry: latest 11 years as positional rows. */
export function indexEntry(company, years) {
  return {
    ticker: company.ticker,
    name: company.name,
    sector: company.sector ?? null,
    exchange: company.exchange,
    type: company.type,
    currency: company.currency,
    financialCurrency: company.financialCurrency,
    price: company.price ?? null,
    years: years.slice(-11).map((y) => [y.fiscalYear, y.periodEnd, ...INDEX_FIELDS.map((f) => val(y.values[f]))]),
  };
}

export function indexJson(entries, failures, generatedAt = new Date().toISOString()) {
  return {
    market: 'sg',
    label: 'Singapore',
    currency: 'SGD',
    universe: 'all',
    generatedAt,
    fields: [...INDEX_FIELDS],
    fx: { asOf: null, rates: {} },
    companies: entries,
    failures,
  };
}

/** companies: [{ company, years }]. v1 writes no prices/ files (prices are out of scope). */
export async function writeSnapshot(outDir, companies, failures) {
  await mkdir(join(outDir, 'companies'), { recursive: true });
  for (const { company, years } of companies) {
    await writeFile(join(outDir, 'companies', companyFile(company.ticker)), JSON.stringify(companyJson(years)));
  }
  const index = indexJson(companies.map(({ company, years }) => indexEntry(company, years)), failures);
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
  return index;
}
