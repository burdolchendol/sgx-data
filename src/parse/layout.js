// Turns one page of `pdftotext -layout` text into table rows.
// A row is a label plus the figures printed in the table's value columns.
import { parseFigure, detectUnits } from '../units.js';

const NUM_TOKEN = /^(\(?[-−]?[\d,]+(\.\d+)?\)?|-|—|–|−)$/;
// a year row may start with a caption: "In $ millions   Note   2025  2024", "Group  Note  2025  2024"
// a restated comparative may carry a marker: "2024*", "2024(1)"
const YEAR_ROW = /^\s*(?:[A-Za-z0-9$'’‘() ]{0,40}\s{2,})?(?:Notes?\s+)?((19|20)\d{2}(\*+|\(\w\))?\s+){1,7}(19|20)\d{2}(\*+|\(\w\))?\s*$/;
// note references printed between the label and the figures: "15", "B2", "C16", "4.1", "12(a)"
const NOTE_REF = /^([A-Z]?\d{1,2}(\.\d{1,2})?(\([a-z0-9]+\))?)$/;
const isNumToken = (t) => NUM_TOKEN.test(t);

/** Split a layout line into cells: runs of text separated by 2+ spaces. */
export function cells(line) {
  return line.trim().split(/\s{2,}/).filter(Boolean);
}

/**
 * Find the year header row ("2026  2025  2026  2025") and the units printed near it
 * ("S$ Mil", "S$'000", "$m"). Returns null if the page has no year header.
 */
export function findHeader(lines) {
  // date headers ("31 Dec 2024   31 Dec 2023") read as their years
  const DATE = /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+((?:19|20)\d{2})/gi;
  for (let i = 0; i < lines.length; i++) {
    const norm = lines[i].replace(DATE, '$2');
    if (!YEAR_ROW.test(norm)) continue;
    const years = norm.trim().split(/\s+/).map((t) => t.replace(/(\*+|\(\w\))$/, '')).filter((t) => /^(19|20)\d{2}$/.test(t)).map(Number);
    // units are on the same line ("In $ millions"), just below, or just above the years
    const nonEmpty = (from, step) => {
      const out = [];
      for (let j = from; j >= 0 && j < lines.length && out.length < 4; j += step) if (lines[j].trim()) out.push(lines[j]);
      return out;
    };
    // look on the year line and below it first; the lines above are often the statement title
    const below = [norm.replace(/\b(19|20)\d{2}\b/g, ''), ...nonEmpty(i + 1, 1).filter((l) => !/\d[\d,]*\.\d|\d,\d{3}/.test(l))].join('  ');
    const above = nonEmpty(i - 1, -1).join('  ');
    const ub = detectUnits(below.replace(/\bNotes?\b/gi, ''));
    const ua = detectUnits(above.replace(/\bNotes?\b/gi, ''));
    const units = { currency: ub.currency ?? ua.currency, scale: ub.scale ?? ua.scale };
    const near = `${below}  ${above}`;
    // right edge of each year label, to place figures in rows that leave some columns blank
    const colEnds = [...lines[i].matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m.index + 4);
    return { lineIndex: i, years, units, unitsText: near.trim(), colEnds };
  }
  return null;
}

/**
 * For a row with fewer figures than columns ("Basic   2.76   3.56" under Group and Bank columns):
 * put each figure in the column whose year label ends nearest to where the figure ends.
 * Returns one token (or null) per column, or null when a figure doesn't line up with any column.
 */
function placeByPosition(line, colEnds, labelLen) {
  if (!colEnds?.length) return null;
  const gaps = colEnds.slice(1).map((e, j) => e - colEnds[j]);
  const tol = Math.min(8, ...gaps.map((g) => g / 2));
  const out = colEnds.map(() => null);
  let found = 0;
  for (const m of line.matchAll(/\S+/g)) {
    const t = m[0];
    if (!NUM_TOKEN.test(t) || m.index < labelLen) continue;
    const end = m.index + t.length;
    let best = -1; let dist = Infinity;
    colEnds.forEach((e, j) => { const d = Math.abs(e - end + (t.endsWith(')') ? 1 : 0)); if (d < dist) { dist = d; best = j; } });
    if (dist >= tol) continue; // e.g. a note number left of the first column
    if (out[best] != null) return null;
    out[best] = t; found++;
  }
  return found ? out : null;
}

/**
 * Parse rows below the header. Each row: { label, figures: (number|null)[], section, heading, line }.
 * figures has one entry per year column; rows with fewer printed values than columns are skipped,
 * since we can't tell which column a figure belongs to.
 */
export function parseRows(pageText) {
  const lines = pageText.split('\n');
  const header = findHeader(lines);
  if (!header) return { header: null, rows: [] };
  const k = header.years.length;
  const rows = [];
  let section = null;
  let pendingLabel = '';
  let heading = null; // last text-only line, e.g. "Attributable to:"
  for (let i = header.lineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { pendingLabel = ''; continue; }
    const parts = cells(line);
    // drop trailing text cells (side tabs such as "Overview" printed beside the table)
    let end = parts.length;
    while (end > 0 && !isNumToken(parts[end - 1]) && parts.slice(0, end - 1).some(isNumToken)) end--;
    const used = parts.slice(0, end);
    let firstNum = used.findIndex(isNumToken);
    if (firstNum === -1) {
      const text = used.join(' ').trim();
      const sec = text.replace(/^(less|add):\s*/i, '');
      if (/^(current|non-current)\s+(assets|liabilities)$/i.test(sec)) section = sec.toLowerCase();
      else if (/^(share capital|capital and reserves|equity)\b/i.test(text) && !/attributable/i.test(text)) section = 'equity';
      pendingLabel = text;
      if (text) heading = text;
      continue;
    }
    // a cell like "Borrowings (unsecured) 29" keeps its note number inside the text cell
    const labelCells = used.slice(0, firstNum);
    while (labelCells.length > 1 && NOTE_REF.test(labelCells[labelCells.length - 1])) labelCells.pop();
    const nums = used.slice(firstNum);
    let placed = null;
    if (nums.length < k) {
      placed = placeByPosition(line, header.colEnds, firstNum > 0 ? used.slice(0, firstNum).join(' ').length : 0);
      if (!placed) {
        // a line such as "Earnings per share ($)   14" (only a note number): keep it as a heading
        const text = labelCells.join(' ').trim();
        pendingLabel = '';
        if (text) heading = text;
        continue;
      }
    }
    let label = labelCells.join(' ').replace(/\s+\d{1,3}(\(\w\))?$/, '').trim();
    // continuation lines: "Weighted average number ... for calculation of" / " diluted earnings per share"
    if (pendingLabel && (label === '' || /^[a-z(]/.test(label))) label = `${pendingLabel} ${label}`.trim();
    const tokens = placed ?? nums.slice(-k);
    const figures = tokens.map((t) => (t == null ? null : parseFigure(t)));
    const dashes = tokens.map((t) => t != null && /^[-—–−]$/.test(t));
    rows.push({ label, figures: figures.map((f, j) => (f == null && dashes[j] ? 0 : f)), section, heading, line: i });
    pendingLabel = '';
  }
  return { header, rows };
}
