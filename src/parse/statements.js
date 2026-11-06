// Reads the group (consolidated) primary statements out of an annual report's text pages
// and returns one extraction per fiscal year column (the current year and the comparative).
import { parseRows, findHeader } from './layout.js';
import { toUnits, centsToUnits, detectUnits } from '../units.js';

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12 };

const top = (page, n = 14) => page.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, n).join(' ');

/** Which primary statement a page is, from its heading. Notes and summaries are not statements. */
export function classifyPage(page) {
  const head = top(page, 7).replace(/\s+/g, ' ');
  if (/notes to the|summary|five-year|ten-year|highlights/i.test(head)) return null;
  // side tabs ("Overview") can land inside a heading that wraps over two lines
  if (/statements?\b.{0,40}\bof cash flows|cash flow statements?/i.test(head)) return 'cf';
  if (/statements? of\b.{0,40}\bfinancial position|balance sheets?/i.test(head)) return 'bs';
  if (/comprehensive income/i.test(head) && !/income statements?|profit or loss/i.test(head.replace(/comprehensive income/ig, ''))) return null;
  if (/income statements?|statements? of profit or loss/i.test(head)) return 'is';
  return null;
}

/** "For the financial year ended 31 March 2026" / "As at 31 December 2024" -> "2026-03-31". */
export function periodEndFrom(page) {
  const m = top(page, 20).match(/(?:year ended|as at|as of)\s+(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})/i);
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

const saysFinancialYear = (page) => /financial year ended|year ended/i.test(top(page, 20));

/** The day after the same date one year earlier: a 12-month period ending on periodEnd. */
export function yearStart(periodEnd) {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function shiftYears(periodEnd, years) {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Group columns come first in Singapore reports; refuse pages that put "Company" first. */
function groupFirst(page, headerLine) {
  const above = page.split('\n').slice(0, headerLine).join(' ');
  const g = above.search(/\bGroup\b/);
  const c = above.search(/\bCompany\b(?!\s*(\(|of|'s))/);
  return !(c !== -1 && g !== -1 && c < g);
}

// Field rules: statement, label pattern, and how to combine matches.
const RULES = [
  { field: 'revenue', st: 'is', re: /^(total )?(operating )?revenue$|^total income$|^gross revenue$|^revenue from contracts with customers$/i },
  { field: 'netIncome', st: 'is', re: /^(profit|net profit|profit for the (year|period))?\s*(attributable to:?\s*)?(owners|shareholders|equity holders|ordinary shareholders|unitholders)( of the (company|bank|trust|reit))?$/i, after: /attributable to/i },
  { field: 'epsDilutedCents', st: 'is', re: /diluted(\s*\(cents\))?$|^- diluted/i, cents: true },
  { field: 'epsBasicCents', st: 'is', re: /basic(\s*\(cents\))?$|^- basic/i, cents: true },
  { field: 'totalAssets', st: 'bs', re: /^total assets$/i },
  { field: 'totalLiabilities', st: 'bs', re: /^total liabilities$/i },
  { field: 'currentAssets', st: 'bs', re: /^total current assets$/i },
  { field: 'currentLiabilities', st: 'bs', re: /^total current liabilities$/i },
  { field: 'equity', st: 'bs', re: /^(total )?equity attributable to (owners|shareholders|equity holders|ordinary shareholders)( of the (company|bank))?$/i },
  { field: 'nonControllingInterests', st: 'bs', re: /^non-controlling interests?$/i },
  { field: 'perpetualSecurities', st: 'bs', re: /^perpetual (capital )?securities$|^other equity instruments$/i },
  { field: 'cash', st: 'bs', re: /^cash and (cash equivalents|bank balances)$/i },
  { field: 'goodwill', st: 'bs', re: /^goodwill$/i },
  { field: 'intangibles', st: 'bs', re: /^(other )?intangible assets( excluding goodwill)?$/i, combined: true },
  { field: 'operatingCashFlow', st: 'cf', re: /^net cash (from|generated from|inflow from|provided by|(from|generated from)\/\(used in\)) operating activities$/i },
  { field: 'capex', st: 'cf', re: /^(payment for |payments for )?(purchases?|acquisitions?|additions?) (of|to) property, plant and equipment$/i, abs: true },
  { field: 'dividendsPaid', st: 'cf', re: /^(final |interim |special )?dividends? paid to (owners|shareholders|equity holders)( of the (company|bank))?$/i, sum: true, abs: true },
];

const BORROWING = /borrowings|loans|bonds|notes|debt securities|debentures/i;
const NOT_DEBT = /lease|receivable|payable to|derivative/i;

/**
 * pages: array of page texts (1-based page = index + 1). url: document link stored in src.
 * Returns { extractions: [{ periodStart, periodEnd, values, src }], notes: string[] }.
 */
export function extractStatements(pages, { url } = {}) {
  const notes = [];
  const found = { is: [], bs: [], cf: [] };
  pages.forEach((p, i) => {
    const k = classifyPage(p);
    if (k && findHeader(p.split('\n'))) found[k].push(i); // contents pages have no year header
  });
  for (const k of ['is', 'bs', 'cf']) if (!found[k].length) notes.push(`no ${k} page found`);

  // keep only the first run of consecutive pages for each statement (the group statement)
  const runs = {};
  for (const k of Object.keys(found)) {
    const idx = found[k];
    const run = idx.length ? [idx[0]] : [];
    for (let j = 1; j < idx.length && idx[j] === run[run.length - 1] + 1; j++) run.push(idx[j]);
    runs[k] = run;
  }

  const anchor = runs.is[0] ?? runs.bs[0] ?? runs.cf[0];
  if (anchor == null) return { extractions: [], notes };
  const periodEnd = periodEndFrom(pages[runs.is[0] ?? runs.cf[0] ?? anchor]);
  if (!periodEnd) { notes.push('period end not found'); return { extractions: [], notes }; }
  const fullYear = runs.is.length ? saysFinancialYear(pages[runs.is[0]]) : true;
  if (!fullYear) { notes.push('income statement is not for a financial year'); return { extractions: [], notes }; }
  const fy = Number(periodEnd.slice(0, 4));

  // columns: [current, prior] per statement
  const cols = [{ values: {}, src: {}, periodEnd }, { values: {}, src: {}, periodEnd: shiftYears(periodEnd, -1) }];
  let currency = null;
  let unitsOk = true;

  const take = (col, field, value, page, label) => {
    if (value == null) return;
    cols[col].values[field] = value;
    cols[col].src[field] = { url, page: page + 1, label };
  };

  for (const st of ['is', 'bs', 'cf']) {
    let section = null;
    for (const pi of runs[st]) {
      const { header, rows } = parseRows(pages[pi]);
      if (!header) { notes.push(`${st} p${pi + 1}: no year header`); continue; }
      if (!groupFirst(pages[pi], header.lineIndex)) { notes.push(`${st} p${pi + 1}: company columns before group`); continue; }
      const { scale } = header.units;
      const cur = header.units.currency ?? detectUnits(top(pages[pi], 25)).currency;
      if (!scale) { unitsOk = false; notes.push(`${st} p${pi + 1}: units not detected`); continue; }
      if (cur) currency ??= cur;
      if (cur && currency && cur !== currency) { unitsOk = false; notes.push(`currency mismatch ${cur} vs ${currency}`); }
      const ci = [header.years.indexOf(fy), header.years.indexOf(fy - 1)];
      if (ci[0] === -1) { notes.push(`${st} p${pi + 1}: no ${fy} column`); continue; }
      let afterAttributable = false;
      let prevLabel = '';
      for (const row of rows) {
        if (row.section && row.section !== section) { section = row.section; }
        const label = row.label.replace(/\s+/g, ' ').trim();
        if (/attributable to:?$/i.test(prevLabel) || /^attributable to/i.test(label) || /attributable to/i.test(row.heading ?? '')) afterAttributable = true;
        for (const [c, colIdx] of ci.entries()) {
          if (colIdx === -1) continue;
          const raw = row.figures[colIdx];
          if (raw == null) continue;
          const units = (cents) => (cents ? centsToUnits(raw) : toUnits(raw, scale));
          // section subtotals printed without a label
          if (st === 'bs' && label === '' && section === 'current assets') take(c, 'currentAssets', units(), pi, 'Current assets (total)');
          if (st === 'bs' && label === '' && section === 'current liabilities') take(c, 'currentLiabilities', units(), pi, 'Current liabilities (total)');
          for (const r of RULES) {
            if (r.st !== st || !r.re.test(label)) continue;
            if (r.field === 'netIncome' && !afterAttributable && !/attributable/i.test(label)) continue;
            if (r.field === 'cash' && section && section !== 'current assets') continue;
            let v = r.cents ? centsToUnits(raw) : toUnits(raw, scale);
            if (r.abs) v = Math.abs(v);
            const prev = cols[c].values[r.field];
            if (r.sum && prev != null) { take(c, r.field, prev + v, pi, `${cols[c].src[r.field].label} + ${label}`); continue; }
            if (prev != null) continue; // first match wins (group statement before any segment table)
            take(c, r.field, v, pi, label);
          }
          // debt, by balance-sheet section; leases are not debt
          if (st === 'bs' && BORROWING.test(label) && !NOT_DEBT.test(label)) {
            const field = section === 'current liabilities' ? 'debtCurrent' : section === 'non-current liabilities' ? 'longTermDebt' : null;
            if (field) {
              const v = toUnits(raw, scale);
              const prev = cols[c].values[field];
              take(c, field, (prev ?? 0) + v, pi, prev != null ? `${cols[c].src[field].label} + ${label}` : label);
            }
          }
        }
        prevLabel = label;
      }
    }
  }

  const extractions = cols.map((col) => {
    const v = col.values;
    // diluted EPS, else basic (AGENTS.md)
    if (v.epsDilutedCents != null) { v.epsDiluted = v.epsDilutedCents; }
    else if (v.epsBasicCents != null) { v.epsDiluted = v.epsBasicCents; col.src.epsDilutedCents = col.src.epsBasicCents; }
    if (col.src.epsDilutedCents) col.src.epsDiluted = col.src.epsDilutedCents;
    delete v.epsDilutedCents; delete v.epsBasicCents; delete col.src.epsDilutedCents; delete col.src.epsBasicCents;
    // a single "intangible assets" line with no separate goodwill line is the combined figure
    if (v.intangibles != null && v.goodwill == null && /^intangible assets$/i.test(col.src.intangibles?.label ?? '')) {
      v.intangiblesInclGoodwill = v.intangibles; col.src.intangiblesInclGoodwill = col.src.intangibles;
      delete v.intangibles; delete col.src.intangibles;
    }
    v.reportingCurrency = currency;
    v.unitsDetected = unitsOk && currency != null;
    return { periodStart: yearStart(col.periodEnd), periodEnd: col.periodEnd, values: v, src: col.src };
  });
  if (!currency) notes.push('reporting currency not detected');
  return { extractions, notes };
}

/**
 * Weighted average diluted shares from the EPS note ("Weighted average number of ordinary shares
 * ... diluted earnings per share  16,557,030  16,558,374", in '000). Returns [current, prior] in units.
 */
export function dilutedSharesFromNotes(pages, fy) {
  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi];
    if (!/EARNINGS PER (SHARE|UNIT)/.test(p) || !/weighted average/i.test(p)) continue;
    const { header, rows } = parseRows(p.slice(p.search(/EARNINGS PER (SHARE|UNIT)/)));
    if (!header) continue;
    const scale = header.units.scale ?? (/no\.? of shares|number of shares/i.test(header.unitsText) ? 1 : null);
    if (!scale) continue;
    const ci = [header.years.indexOf(fy), header.years.indexOf(fy - 1)];
    const row = rows.find((r) => /weighted average.*diluted/i.test(r.label));
    if (!row || ci[0] === -1) continue;
    return { page: pi + 1, label: row.label, values: ci.map((i) => (i === -1 ? null : toUnits(row.figures[i], scale))) };
  }
  return null;
}
