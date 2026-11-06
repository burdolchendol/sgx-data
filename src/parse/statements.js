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
  // some PDFs space out heading letters ("C O N S O LI DATED  IN C O M E STATEM ENT"): match without spaces too
  const flat = head.replace(/\s+/g, '').toLowerCase();
  if (/notes to the|summary|five-year|ten-year|highlights/i.test(head) || /notestothe|summary|five-year|ten-year/.test(flat)) return null;
  // side tabs ("Overview") can land inside a heading that wraps over two lines
  if (/statements?\b.{0,40}\bof cash flows|cash flow statements?/i.test(head) || /statements?of(\w{0,30})?cashflows|cashflowstatement/.test(flat)) return 'cf';
  if (/statements? of\b.{0,40}\bfinancial position|balance sheets?/i.test(head) || /statements?of(\w{0,30})?financialposition|balancesheets?(?!d)/.test(flat)) return 'bs';
  if (/comprehensive income/i.test(head) && !/income statements?|profit or loss/i.test(head.replace(/comprehensive income/ig, ''))) return null;
  if (/comprehensiveincome/.test(flat) && !/incomestatements?|profitorloss/.test(flat.replace(/comprehensiveincome/g, ''))) return null;
  if (/income statements?|statements? of profit or loss|profit (or|and) loss (account|statement)/i.test(head) || /incomestatements?|statements?ofprofitorloss|profit(or|and)loss(account|statement)/.test(flat)) return 'is';
  return null;
}

/** "For the financial year ended 31 March 2026" / "As at 31 December 2024" -> "2026-03-31". */
export function periodEndFrom(page) {
  const head = top(page, 20);
  const m = head.match(/(?:year ended|as at|as of)\s+(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})/i)
    ?? head.replace(/\s+/g, '').match(/(?:yearended|asat|asof)(\d{1,2})([A-Za-z]+?)((?:19|20)\d{2})/i);
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
  { field: 'revenue', st: 'is', re: /^(total )?(operating )?revenue$|^total income$|^total operating income$|^gross revenue$|^revenue from contracts with customers$/i },
  { field: 'netIncome', st: 'is', re: /^(profit|net profit|profit for the (year|period))?\s*(attributable to:?\s*)?(owners|shareholders|equity holders|ordinary shareholders|unitholders)( of the (company|bank|trust|reit))?$/i, after: /attributable to/i },
  { field: 'epsDilutedCents', st: 'is', re: /^[-–]?\s*diluted( earnings per (share|unit))?(\s*\(([^)]*)\))?$/i, cents: true },
  { field: 'epsBasicCents', st: 'is', re: /^[-–]?\s*basic( earnings per (share|unit))?(\s*\(([^)]*)\))?$/i, cents: true },
  { field: 'totalAssets', st: 'bs', re: /^total assets$/i },
  { field: 'totalLiabilities', st: 'bs', re: /^total liabilities$/i },
  { field: 'currentAssets', st: 'bs', re: /^total current assets$/i },
  { field: 'currentLiabilities', st: 'bs', re: /^total current liabilities$/i },
  { field: 'equity', st: 'bs', re: /^(total )?equity attributable to (owners|shareholders|equity holders|ordinary shareholders)( of the (company|bank))?$/i },
  { field: 'nonControllingInterests', st: 'bs', re: /^non-controlling interests?$/i },
  { field: 'perpetualSecurities', st: 'bs', re: /^perpetual (capital )?securities$|^other equity instruments$/i },
  { field: 'cash', st: 'bs', re: /^(cash and (cash equivalents|bank balances|short-term deposits)|bank balances,? (and )?(other liquid funds|deposits and cash|cash))$/i },
  { field: 'goodwill', st: 'bs', re: /^goodwill$/i },
  { field: 'intangibles', st: 'bs', re: /^(other )?intangible assets( excluding goodwill)?$/i, combined: true },
  { field: 'operatingCashFlow', st: 'cf', re: /^net cash (flows? )?(from|generated from|inflows? from|provided by|used in|(from|generated from|provided by|inflow from)\s*\/\s*\(?used in\)?)( from)? operating activities$/i },
  { field: 'capex', st: 'cf', re: /^(payments? for |purchases? of |acquisitions? of |additions? to |payments? for (the )?(purchase|acquisition) of )(property, plant (and|&) equipment|properties and other fixed assets|fixed assets|vehicles, premises and equipment)$/i, abs: true },
  { field: 'dividendsPaid', st: 'cf', re: /^(final |interim |special )?(one-tier tax[- ]exempt )?dividends? paid (to (owners|shareholders|equity holders|ordinary shareholders)( of the (company|bank))?|on ordinary shares|by the company)$/i, sum: true, abs: true },
];

const BORROWING = /borrowings|loans|bonds|notes|debt securities|debentures/i;
const NOT_DEBT = /lease|receivable|payable to|derivative/i;

/**
 * pages: array of page texts (1-based page = index + 1). url: document link stored in src.
 * pageRef(i): { url, page } for page index i, when the report is split across several PDFs.
 * Returns { extractions: [{ periodStart, periodEnd, values, src }], notes: string[] }.
 */
export function extractStatements(pages, { url, pageRef = (i) => ({ url, page: i + 1 }) } = {}) {
  const notes = [];
  const found = { is: [], bs: [], cf: [] };
  pages.forEach((p, i) => {
    const k = classifyPage(p);
    if (k && findHeader(p.split('\n'))) found[k].push(i); // contents pages have no year header
  });
  for (const k of ['is', 'bs', 'cf']) if (!found[k].length) notes.push(`no ${k} page found`);

  // group consecutive pages into runs. A run is usable when it has a period date, table units and
  // a key line (highlights and review pages often have the first two). The income statement is the
  // first usable run; the balance sheet and cash-flow runs are the usable ones closest after it,
  // since the primary statements are printed together.
  const KEY = { is: /revenue|total (operating )?income|profit before (income )?tax/i, bs: /^(total (assets|liabilities|equity)|net assets)$/i, cf: /operating activities/i };
  const groupsOf = (idx) => {
    const groups = [];
    for (const i of idx) {
      const last = groups.at(-1);
      if (last && i === last.at(-1) + 1) last.push(i); else groups.push([i]);
    }
    return groups;
  };
  const usable = (k) => groupsOf(found[k]).filter((g) => periodEndFrom(pages[g[0]])
    && findHeader(pages[g[0]].split('\n'))?.units.scale
    && g.some((i) => parseRows(pages[i]).rows.some((r) => KEY[k].test(r.label))));
  const runs = { is: usable('is')[0] ?? [] };
  const base = runs.is[0] ?? -1;
  for (const k of ['bs', 'cf']) {
    const u = usable(k);
    runs[k] = (base >= 0 ? u.slice().sort((a, b) => Math.abs(a[0] - base) - Math.abs(b[0] - base))[0] : null) ?? u[0] ?? [];
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
  const scales = new Set();

  const take = (col, field, value, page, label) => {
    if (value == null) return;
    cols[col].values[field] = value;
    cols[col].src[field] = { ...pageRef(page), label };
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
      scales.add(scale);
      if (cur) currency ??= cur;
      if (cur && currency && cur !== currency) { unitsOk = false; notes.push(`currency mismatch ${cur} vs ${currency}`); }
      const ci = [header.years.indexOf(fy), header.years.indexOf(fy - 1)];
      if (ci[0] === -1) { notes.push(`${st} p${pi + 1}: no ${fy} column`); continue; }
      let afterAttributable = false;
      let prevLabel = '';
      for (const [ri, row] of rows.entries()) {
        const nextLabel = (rows[ri + 1]?.label ?? '').replace(/\s+/g, ' ').trim();
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
          // "Share capital ... reserves" then an unlabeled subtotal then "Non-controlling interests":
          // the subtotal is equity attributable to owners
          if (st === 'bs' && label === '' && section === 'equity' && cols[c].values.equity == null && !cols[c].values.perpetualSecurities && /^non-controlling interests?$/i.test(nextLabel)) take(c, 'equity', units(), pi, 'Equity attributable to owners of the Company (subtotal)');
          for (const r of RULES) {
            if (r.st !== st || !r.re.test(label)) continue;
            if (r.field === 'netIncome' && !afterAttributable && !/attributable/i.test(label)) continue;
            if (r.field === 'cash' && section && section !== 'current assets') continue;
            let v;
            if (r.cents) {
              // EPS is printed in cents or in currency units; the label or its heading says which
              const ctx = `${label} ${row.heading ?? ''}`;
              if (/cents/i.test(ctx)) v = centsToUnits(raw);
              else if (/\((S?\$|US\$|SGD|USD|RM|RMB|HK\$)\)|dollars?/i.test(ctx)) v = raw;
              else continue; // unknown unit: leave blank
            } else v = toUnits(raw, scale);
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

  // the primary statements of one report share their units; if they don't, a unit was misread
  if (scales.size > 1) { unitsOk = false; notes.push(`statements disagree on units (${[...scales].join(', ')})`); }

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
  if (!currency) {
    // tables printed in bare "$": use the report's own statement of its presentation currency
    currency = presentationCurrency(pages);
    for (const e of extractions) { e.values.reportingCurrency = currency; e.values.unitsDetected = unitsOk && currency != null; }
    if (!currency) notes.push('reporting currency not detected');
  }
  return { extractions, notes };
}

/** "The financial statements are presented in Singapore dollars" -> "SGD"; null if not stated. */
export function presentationCurrency(pages) {
  const re = /(?:presented|expressed|stated|reported|denominated)(?:\s+[a-z]+){0,5}?\s+in\s+(?:the\s+)?(Singapore dollars?|S\$|SGD|United States dollars?|US dollars?|US\$|USD|Renminbi|RMB|Malaysian Ringgit|Ringgit|Hong Kong dollars?|HK\$|Australian dollars?)/i;
  const map = [[/singapore|S\$|SGD/i, 'SGD'], [/united states|US|USD/i, 'USD'], [/renminbi|RMB/i, 'CNY'], [/ringgit/i, 'MYR'], [/hong kong|HK/i, 'HKD'], [/australian/i, 'AUD']];
  for (const p of pages) {
    const m = p.replace(/\s+/g, ' ').match(re);
    if (m) return map.find(([r]) => r.test(m[1]))?.[1] ?? null;
  }
  return null;
}

/**
 * Weighted average diluted shares from the EPS note ("Weighted average number of ordinary shares
 * ... diluted earnings per share  16,557,030  16,558,374", in '000). Returns [current, prior] in units.
 */
export function dilutedSharesFromNotes(pages, fy) {
  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi];
    if (!/EARNINGS PER (SHARE|UNIT)/i.test(p) || !/weighted average/i.test(p)) continue;
    const { header, rows } = parseRows(p.slice(p.search(/EARNINGS PER (SHARE|UNIT)/i)));
    if (!header) continue;
    const ci = [header.years.indexOf(fy), header.years.indexOf(fy - 1)];
    // "Weighted average ... for diluted EPS"; a weighted-average row under a heading about dilution;
    // or a bare "Diluted" row under a "Weighted average number of ordinary shares ('000)" heading
    const row = rows.find((r) => /weighted average.*dilut/i.test(r.label))
      ?? rows.filter((r) => /weighted average/i.test(r.label) && /dilut/i.test(r.heading ?? '')).at(-1)
      ?? rows.find((r) => /^diluted$/i.test(r.label) && /weighted average/i.test(r.heading ?? ''));
    if (!row || ci[0] === -1) continue;
    // units printed with the row or the nearest heading above it ("(’000)") beat the table's ("In $ millions")
    let near = null;
    for (const r of rows.slice(0, rows.indexOf(row) + 1)) near = detectUnits(`${r.label} ${r.heading ?? ''}`).scale ?? near;
    const scale = near ?? header.units.scale
      ?? (/no\.? of shares|number of shares/i.test(header.unitsText) ? 1 : null);
    if (!scale) continue;
    return { page: pi + 1, label: row.label, values: ci.map((i) => (i === -1 ? null : toUnits(row.figures[i], scale))) };
  }
  return null;
}
