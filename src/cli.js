#!/usr/bin/env node
// npm run fetch:sg [-- --only Z74] [--years 15] [--out out/sg]
// Finds each company's annual reports on its IR site, reads the group statements,
// runs the per-year checks and writes out/sg/.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getCached, cachePath } from './http.js';
import { pdfPages, pdfCreationDate } from './pdf.js';
import { extractStatements, dilutedSharesFromNotes } from './parse/statements.js';
import { mergeFiscalYears } from './fiscal.js';
import { runChecks } from './checks.js';
import { writeSnapshot } from './output.js';
import { COMPANIES, reportsByYear } from './sources/companies.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i === -1 ? dflt : args[i + 1]; };
const ONLY = opt('only', null)?.split(',');
const MAX_YEARS = Number(opt('years', 15));
const OUT = opt('out', 'out/sg');
const KEEP_PDFS = process.env.SGX_KEEP_PDFS === '1';
const EXTRACT_DIR = join(process.env.SGX_CACHE_DIR ? join(process.env.SGX_CACHE_DIR, '..') : '.cache', 'extract');

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Read one report, using the cached extraction when this URL was processed before. */
async function readReport(url) {
  const file = join(EXTRACT_DIR, `${sha(url)}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not processed yet */ }
  const buf = await getCached(url);
  const pages = await pdfPages(buf);
  const { extractions, notes } = extractStatements(pages, { url });
  const filed = await pdfCreationDate(buf);
  const fy = extractions[0] ? Number(extractions[0].periodEnd.slice(0, 4)) : null;
  const shares = fy ? dilutedSharesFromNotes(pages, fy) : null;
  if (shares) {
    shares.values.forEach((v, i) => {
      if (v == null || !extractions[i]) return;
      extractions[i].values.dilutedShares = v;
      extractions[i].src.dilutedShares = { url, page: shares.page, label: shares.label };
    });
  }
  for (const e of extractions) e.filed = filed;
  const result = { url, filed, extractions, notes };
  await mkdir(EXTRACT_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(result, null, 1));
  if (!KEEP_PDFS) await rm(cachePath(url), { force: true }); // keep disk use small; the extraction is cached
  return result;
}

async function runCompany(company, failures) {
  const html = (await getCached(company.irPage)).toString('utf8');
  const years = reportsByYear(company.discover(html)).slice(0, MAX_YEARS);
  const extractions = [];
  for (const { year, candidates } of years) {
    let done = false;
    for (const c of candidates) {
      try {
        const r = await readReport(c.url);
        if (!r.extractions.length) { console.warn(`  ${company.ticker} ${year}: nothing read from ${c.url} (${r.notes.join('; ')})`); continue; }
        if (r.notes.length) console.warn(`  ${company.ticker} ${year}: ${r.notes.join('; ')}`);
        extractions.push(...r.extractions);
        console.log(`  ${company.ticker} ${year}: ${c.url.split('/').pop()}`);
        done = true;
        break;
      } catch (err) {
        console.warn(`  ${company.ticker} ${year}: ${c.url} failed: ${err.message}`);
      }
    }
    if (!done) failures.push({ ticker: company.ticker, error: `FY${year} report could not be read` });
  }
  const merged = mergeFiscalYears(extractions, { maxYears: MAX_YEARS });
  let financialCurrency = null;
  for (const y of merged) {
    financialCurrency ??= y.values.reportingCurrency ?? null;
    const { values, failures: f } = runChecks(y.values);
    y.values = values;
    for (const k of Object.keys(y.src)) if (values[k] == null) delete y.src[k];
    for (const x of f) failures.push({ ticker: company.ticker, error: `FY${y.fiscalYear} ${x.check} check failed: ${x.message}` });
  }
  return { company: { ...company, financialCurrency, price: null }, years: merged };
}

const failures = [];
const done = [];
for (const company of COMPANIES.filter((c) => !ONLY || ONLY.includes(c.ticker))) {
  console.log(`${company.ticker} ${company.name}`);
  try { done.push(await runCompany(company, failures)); }
  catch (err) { failures.push({ ticker: company.ticker, error: err.message }); }
}
const index = await writeSnapshot(OUT, done.map(({ company, years }) => ({
  company: { ticker: company.ticker, name: company.name, sector: company.sector, exchange: company.exchange,
    type: company.type, currency: company.currency, financialCurrency: company.financialCurrency, price: null },
  years,
})), failures);
console.log(`wrote ${OUT}: ${index.companies.length} companies, ${failures.length} failures`);
for (const f of failures) console.log(`  ! ${f.ticker}: ${f.error}`);
