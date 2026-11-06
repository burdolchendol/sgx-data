#!/usr/bin/env node
// npm run fetch:sg [-- --only Z74] [--years 15] [--out out/sg]
// Finds each company's annual reports on its IR site, reads the group statements,
// runs the per-year checks and writes out/sg/.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { getCached, cachePath } from './http.js';
import { pdfPrintedPages, pdfCreationDate } from './pdf.js';
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

/**
 * Read one report (one PDF, or several section PDFs read as one), using the cached extraction
 * when these URLs were processed before.
 */
async function readReport(urls) {
  const key = urls.join(' ');
  const file = join(EXTRACT_DIR, `${sha(key)}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not processed yet */ }
  const bufs = [];
  let filed = null;
  for (const url of urls) {
    const buf = await getCached(url);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF (the site returned a web page)');
    bufs.push({ url, buf });
    const d = await pdfCreationDate(buf);
    if (d && (!filed || d > filed)) filed = d;
  }
  const read = async (split) => {
    const pages = [];
    const refs = [];
    for (const { url, buf } of bufs) {
      const { pages: p, pageNo } = await pdfPrintedPages(buf, { split });
      p.forEach((_, i) => refs.push({ url, page: pageNo[i] }));
      pages.push(...p);
    }
    return { pages, refs, ...extractStatements(pages, { url: urls[0], pageRef: (i) => refs[i] }) };
  };
  let r = await read(null);
  // two printed pages side by side on one sheet: read each half as its own page
  if (r.notes.some((n) => /^no (is|bs|cf) page found$/.test(n))) {
    const halves = await read(true);
    const missing = (x) => x.notes.filter((n) => /^no (is|bs|cf) page found$/.test(n)).length;
    if (missing(halves) < missing(r)) r = halves;
  }
  const { pages, refs, extractions, notes } = r;
  const fy = extractions[0] ? Number(extractions[0].periodEnd.slice(0, 4)) : null;
  const shares = fy ? dilutedSharesFromNotes(pages, fy) : null;
  if (shares) {
    shares.values.forEach((v, i) => {
      if (v == null || !extractions[i]) return;
      extractions[i].values.dilutedShares = v;
      extractions[i].src.dilutedShares = { ...refs[shares.page - 1], label: shares.label };
    });
  }
  for (const e of extractions) e.filed = filed;
  const result = { urls, filed, extractions, notes };
  await mkdir(EXTRACT_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(result, null, 1));
  if (!KEEP_PDFS) for (const url of urls) await rm(cachePath(url), { force: true }); // the extraction is cached
  return result;
}

async function runCompany(company, failures) {
  const thisYear = new Date().getUTCFullYear();
  const wanted = Array.from({ length: MAX_YEARS + 1 }, (_, i) => thisYear - i);
  const getText = async (url) => (await getCached(url)).toString('utf8');
  const years = reportsByYear(await company.discover({ getText, years: wanted })).slice(0, MAX_YEARS);
  const extractions = [];
  const unread = [];
  for (const { year, candidates } of years) {
    let done = false;
    for (const c of candidates) {
      try {
        const r = await readReport(c.urls);
        const name = c.urls.map((u) => decodeURIComponent(u.split('/').pop())).join(' + ');
        if (!r.extractions.length) { console.warn(`  ${company.ticker} ${year}: nothing read from ${name} (${r.notes.join('; ')})`); continue; }
        if (r.notes.length) console.warn(`  ${company.ticker} ${year}: ${r.notes.join('; ')}`);
        extractions.push(...r.extractions);
        console.log(`  ${company.ticker} ${year}: ${name}`);
        done = true;
        break;
      } catch (err) {
        console.warn(`  ${company.ticker} ${year}: ${c.urls[0]} failed: ${err.message}`);
      }
    }
    if (!done) unread.push(year);
  }
  const merged = mergeFiscalYears(extractions, { maxYears: MAX_YEARS });
  // a year whose own report is missing is still covered when a later report shows it as a comparative
  const have = new Set(merged.map((y) => y.fiscalYear));
  const missing = unread.filter((y) => !have.has(y) && y < thisYear).sort((a, b) => a - b);
  if (missing.length) {
    const span = missing.length > 2 ? `FY${missing[0]}–FY${missing.at(-1)} (${missing.length} years)` : missing.map((y) => `FY${y}`).join(', ');
    failures.push({ ticker: company.ticker, error: `no readable annual report for ${span}` });
  }
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
