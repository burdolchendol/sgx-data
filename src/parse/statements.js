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
  if (/income statements?|statements? of profit or loss|profit (or|and) loss (account|statement)|statements? of total return/i.test(head) || /incomestatements?|statements?ofprofitorloss|profit(or|and)loss(account|statement)|statements?oftotalreturn/.test(flat)) return 'is';
  return null;
}

/**
 * A single "statement of comprehensive income" that also carries profit or loss (some groups print
 * no separate income statement). Used only when a report has no income statement page.
 */
export function isCombinedIncomeStatement(page) {
  const head = top(page, 7).replace(/\s+/g, ' ');
  if (/notes to the|summary|five-year|ten-year|highlights/i.test(head)) return false;
  if (!/statements? of\b.{0,40}\bcomprehensive income/i.test(head) && !/statements?of(\w{0,30})?comprehensiveincome/.test(head.replace(/\s+/g, '').toLowerCase())) return false;
  return /revenue|total income/i.test(page) && /(profit|loss)[^\n]{0,40}before (income )?tax/i.test(page);
}

/** "For the financial year ended 31 March 2026" / "As at 31 December 2024" -> "2026-03-31". */
export function periodEndFrom(page) {
  const head = top(page, 20);
  const m = head.match(/(?:year ended|as at|as of|\bat)\s+(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})/i)
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
  { field: 'netIncome', st: 'is', re: /^((net )?(profit|loss|profit\s*\/\s*\(loss\)|\(loss\)\s*\/\s*profit)( for the (year|period))?,?)?\s*(attributable to:?\s*)?(owners|shareholders|equity holders|ordinary shareholders|unitholders)( of the (company|bank|trust|reit|parent))?$|^(total return (for the (year|period) )?(attributable to:?\s*)?)?unitholders( of [\w&'’., -]+)?$/i, after: /attributable to/i },
  { field: 'epsDilutedCents', st: 'is', re: /^[-–]?\s*(basic and )?diluted( earnings per (ordinary )?(share|unit))?(\s*\(([^)]*)\))?$/i, cents: true },
  { field: 'epsBasicCents', st: 'is', re: /^[-–]?\s*basic( earnings per (ordinary )?(share|unit))?(\s*\(([^)]*)\))?$/i, cents: true },
  { field: 'totalAssets', st: 'bs', re: /^total assets$/i },
  { field: 'totalLiabilities', st: 'bs', re: /^total liabilities$/i },
  { field: 'currentAssets', st: 'bs', re: /^total current assets$/i },
  { field: 'currentLiabilities', st: 'bs', re: /^total current liabilities$/i },
  { field: 'equity', st: 'bs', re: /^(total )?equity attributable to (owners|shareholders|equity holders|ordinary shareholders)( of the (company|bank))?$|^(total )?shareholders['’]? funds$|^share capital (&|and) reserves$|^(total )?unitholders['’]? funds$/i },
  { field: 'totalEquity', st: 'bs', re: /^total (equity|deficit|capital deficiency)$/i },
  { field: 'nonControllingInterests', st: 'bs', re: /^(non[-–—]\s?controlling|minority) interests?$/i },
  { field: 'subsidiaryEquityInstruments', st: 'bs', re: /^(other equity instruments|perpetual (capital )?securities) issued by (a )?subsidiar(y|ies)$/i },
  { field: 'perpetualSecurities', st: 'bs', re: /^perpetual (capital )?securities( holders['’]? funds)?$|^other equity instruments$/i },
  { field: 'cash', st: 'bs', re: /^(cash and (cash equivalents|bank balances|short-term deposits)|bank balances,? (and )?(other liquid funds|deposits and cash|cash)|cash and fixed deposits)$/i },
  { field: 'cashAtYearEnd', st: 'cf', re: /^cash and cash equivalents,? at (31 (december|march|june|september)|(the )?end of (the )?(financial )?(year|period))$/i },
  { field: 'goodwill', st: 'bs', re: /^goodwill$/i },
  { field: 'intangibles', st: 'bs', re: /^(other )?intangible assets( excluding goodwill)?$/i, combined: true },
  { field: 'operatingCashFlow', st: 'cf', re: /^net cash (flows? )?(from|generated from|inflows? from|provided by|used in|(from|generated from|provided by|inflow from)\s*\/\s*\(?used in\)?|\(?used in\)?\s*\/\s*(generated from|from|provided by))( from)? operating activities$/i },
  { field: 'capex', st: 'cf', re: /^capital expenditure$|^(payments? for |purchases? of |acquisitions? of |additions? to |payments? for (the )?(purchase|acquisition) of )(property, plant (and|&) equipment|property and equipment|properties and other fixed assets|fixed assets|vehicles, premises and equipment)( and (software|intangible assets))?$/i, abs: true },
  { field: 'dividendsPaid', st: 'cf', re: /^(final |interim |special )?(one-tier tax[- ]exempt )?dividends? paid (to (owners|shareholders|equity holders|ordinary shareholders)( of the (company|bank))?|on ordinary shares|by the company)(,? net of scrip dividends?)?$|^dividends paid$|^distributions? paid to unitholders$|^distributions to unitholders$/i, sum: true, abs: true },
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
  // no separate income statement: read profit or loss from a combined comprehensive income statement
  if (!found.is.length) {
    pages.forEach((p, i) => { if (isCombinedIncomeStatement(p) && findHeader(p.split('\n'))) found.is.push(i); });
  }
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
  // a statement carried over to the next page without repeating its title (SGX 2024: liabilities and
  // equity on the page after the assets): same year columns, and lines that belong to that statement
  const MORE = { is: /attributable to|earnings per (ordinary )?(share|unit)/i, bs: /^(total liabilities|total equity|net assets)$/i, cf: /^net cash .*(investing|financing) activities$|^cash flows from (investing|financing) activities$/i };
  for (const k of ['is', 'bs', 'cf']) {
    const run = runs[k];
    const years = run.length ? findHeader(pages[run[0]].split('\n'))?.years.join() : null;
    for (let next = run.at(-1) + 1; years && next < pages.length; next++) {
      const p = pages[next];
      if (classifyPage(p) || isCombinedIncomeStatement(p) || /notes to the|statements? of changes in equity/i.test(top(p, 7))) break;
      if (findHeader(p.split('\n'))?.years.join() !== years) break;
      const { rows } = parseRows(p);
      if (rows.some((r) => /^balance at\b/i.test(r.label)) || !rows.some((r) => MORE[k].test(r.label.replace(/\s+/g, ' ').trim()))) break;
      run.push(next);
    }
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

  let seq = 0;
  const take = (col, field, value, page, label) => {
    if (value == null) return;
    cols[col].values[field] = value;
    cols[col].src[field] = { ...pageRef(page), label };
    (cols[col].order ??= {})[field] ??= seq++;
  };

  for (const st of ['is', 'bs', 'cf']) {
    let section = null;
    let runScale = null;
    for (const pi of runs[st]) {
      const { header, rows } = parseRows(pages[pi]);
      if (!header) { notes.push(`${st} p${pi + 1}: no year header`); continue; }
      if (!groupFirst(pages[pi], header.lineIndex)) { notes.push(`${st} p${pi + 1}: company columns before group`); continue; }
      // a continuation page that doesn't repeat the units reads in the units of the run's first page
      const scale = header.units.scale ?? runScale;
      runScale ??= header.units.scale;
      const cur = header.units.currency ?? detectUnits(top(pages[pi], 25)).currency;
      if (!scale) { unitsOk = false; notes.push(`${st} p${pi + 1}: units not detected`); continue; }
      scales.add(scale);
      if (cur) currency ??= cur;
      if (cur && currency && cur !== currency) { unitsOk = false; notes.push(`currency mismatch ${cur} vs ${currency}`); }
      const ci = [header.years.indexOf(fy), header.years.indexOf(fy - 1)];
      if (ci[0] === -1) { notes.push(`${st} p${pi + 1}: no ${fy} column`); continue; }
      let afterAttributable = false;
      let currentClosed = false; // past "Net current assets": later unlabeled totals aren't current items
      let prevLabel = '';
      for (const [ri, row] of rows.entries()) {
        const nextLabel = (rows[ri + 1]?.label ?? '').replace(/\s+/g, ' ').trim();
        if (row.section && row.section !== section) { section = row.section; }
        const label = row.label.replace(/\s+/g, ' ').trim();
        if (/^net current (assets|liabilities)/i.test(label)) currentClosed = true;
        if (/attributable to:?$/i.test(prevLabel) || /^attributable to/i.test(label) || /attributable to/i.test(row.heading ?? '')) afterAttributable = true;
        for (const [c, colIdx] of ci.entries()) {
          if (colIdx === -1) continue;
          const raw = row.figures[colIdx];
          if (raw == null) continue;
          const units = (cents) => (cents ? centsToUnits(raw) : toUnits(raw, scale));
          // section subtotals printed without a label
          // (the last one before "Net current assets" wins: it includes assets held for sale)
          if (st === 'bs' && label === '' && section === 'current assets' && !currentClosed) take(c, 'currentAssets', units(), pi, 'Current assets (total)');
          if (st === 'bs' && label === '' && section === 'current liabilities' && !currentClosed) take(c, 'currentLiabilities', units(), pi, 'Current liabilities (total)');
          // "Operating revenue" heading, its lines, then an unlabeled total (SGX)
          if (st === 'is' && label === '' && /^(total )?(operating )?revenues?$/i.test((row.heading ?? '').trim())) take(c, 'revenue', units(), pi, `${row.heading.trim()} (total)`);
          // "Share capital ... reserves" then an unlabeled subtotal then "Non-controlling interests":
          // the subtotal is equity attributable to owners (perpetual securities above it are inside it when an
          // "Attributable to equity holders" heading opens the section, as at OCBC)
          if (st === 'bs' && label === '' && section === 'equity' && cols[c].values.equity == null && (!cols[c].values.perpetualSecurities || afterAttributable) && /^non[-–—]\s?controlling interests?$|^(other equity instruments|perpetual (capital )?securities) issued by (a )?subsidiar(y|ies)$/i.test(nextLabel)) take(c, 'equity', units(), pi, 'Equity attributable to owners of the Company (subtotal)');
          // footnote markers after the label ("(1)", "(a)"); a dash or bullet before it ("– Ordinary shareholders")
          const ruleLabel = label.replace(/\s*\((\d{1,2}|[a-z]|note \d+)\)$/i, '').replace(/^[–—•]\s*/, '');
          for (const r of RULES) {
            if (r.st !== st || !r.re.test(ruleLabel)) continue;
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
    // perpetual securities printed above the owners' equity subtotal ("Shareholders' funds") are part of it
    if (v.perpetualSecurities != null && v.equity != null && col.order?.perpetualSecurities < col.order?.equity) delete v.perpetualSecurities;
    // equity instruments issued by a subsidiary belong to non-controlling holders (OCBC 2025)
    if (v.subsidiaryEquityInstruments != null) v.nonControllingInterests = (v.nonControllingInterests ?? 0) + v.subsidiaryEquityInstruments;
    delete v.subsidiaryEquityInstruments; delete col.src.subsidiaryEquityInstruments;
    // banks show no "cash and cash equivalents" line on the balance sheet: take the cash-flow statement's
    if (v.cash == null && v.cashAtYearEnd != null) { v.cash = v.cashAtYearEnd; col.src.cash = col.src.cashAtYearEnd; }
    delete v.cashAtYearEnd; delete col.src.cashAtYearEnd;
    // no non-controlling interests line: all equity belongs to the owners, so total equity is the figure
    if (v.equity == null && v.totalEquity != null && !('nonControllingInterests' in v) && !('perpetualSecurities' in v)) { v.equity = v.totalEquity; col.src.equity = col.src.totalEquity; }
    delete v.totalEquity; delete col.src.totalEquity;
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
  // "presented in Singapore dollars", "presented in the functional currency of the Company which is
  // Singapore Dollars" (Genting Singapore), "All figures are in Singapore Dollars"
  const re = /(?:(?:presented|expressed|stated|reported|denominated)(?:\s+[a-z]+){0,5}?\s+in\s+(?:the\s+)?(?:functional currency of the (?:company|group),? which is\s+)?|all (?:figures|amounts) (?:are )?in\s+)(Singapore dollars?|S\$|SGD|United States dollars?|US dollars?|US\$|USD|Renminbi|RMB|Malaysian Ringgit|Ringgit|Hong Kong dollars?|HK\$|Australian dollars?)/i;
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
    if (!/EARNINGS PER (ORDINARY )?(SHARE|UNIT)/i.test(p) || !/weighted average/i.test(p)) continue;
    const note = p.slice(p.search(/EARNINGS PER (ORDINARY )?(SHARE|UNIT)/i));
    // the share count can sit in its own small table above the profit table (DBS: "Number of shares
    // (millions)" or "('000)"), so read it block by block first, then the note as a whole
    const blocks = [...note.split(/\n\s*\n/).filter((b) => /weighted average/i.test(b)), note];
    for (const text of blocks) {
      const { header, rows } = parseRows(text);
      if (!header) continue;
      const ci = [header.years.indexOf(fy), header.years.indexOf(fy - 1)];
      // "Weighted average ... for diluted EPS"; a weighted-average row under a heading about dilution;
      // or a bare "Diluted" row under a "Weighted average number of ordinary shares ('000)" heading
      const row = rows.find((r) => /weighted average.*dilut/i.test(r.label))
        ?? rows.filter((r) => /weighted average/i.test(r.label) && /dilut/i.test(r.heading ?? '')).at(-1)
        ?? rows.find((r) => /^diluted$/i.test(r.label) && /weighted average/i.test(r.heading ?? ''))
        // only a basic count, and the note says diluted EPS is the same as basic
        ?? (/diluted earnings per (share|unit)\w*\s+(is|are)\s+(the\s+)?(same as|similar to|equal to|identical to)\s+(the\s+)?basic|no (potential(ly)? )?dilutive/i.test(p.replace(/\s+/g, ' '))
          ? rows.find((r) => /weighted average/i.test(r.label) && /basic/i.test(r.label)) : undefined);
      if (!row || ci[0] === -1) continue;
      // units printed with the row or the nearest heading above it ("(’000)") beat the table's ("In $ millions")
      let near = null;
      for (const r of rows.slice(0, rows.indexOf(row) + 1)) near = detectUnits(`${r.label} ${r.heading ?? ''}`).scale ?? near;
      const scale = near ?? header.units.scale
        ?? (/no\.? of shares|number of shares/i.test(header.unitsText) ? 1 : null);
      if (!scale) continue;
      return { page: pi + 1, label: row.label, values: ci.map((i) => (i === -1 ? null : toUnits(row.figures[i], scale))) };
    }
  }
  return null;
}
