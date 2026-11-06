// Turns one page of `pdftotext -layout` text into table rows.
// A row is a label plus the figures printed in the table's value columns.
import { parseFigure, detectUnits } from '../units.js';

const NUM_TOKEN = /^(\(?-?[\d,]+(\.\d+)?\)?|-|—|–)$/;
const YEAR_ROW = /^\s*((19|20)\d{2}\s+){1,7}(19|20)\d{2}\s*$/;
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
  for (let i = 0; i < lines.length; i++) {
    if (!YEAR_ROW.test(lines[i])) continue;
    const years = lines[i].trim().split(/\s+/).map(Number);
    // units are usually on the line just below (sometimes above) the years
    const nonEmpty = (from, step) => {
      const out = [];
      for (let j = from; j >= 0 && j < lines.length && out.length < 4; j += step) if (lines[j].trim()) out.push(lines[j]);
      return out;
    };
    const near = [...nonEmpty(i + 1, 1).filter((l) => !/\d[\d,]*\.\d|\d,\d{3}/.test(l)), ...nonEmpty(i - 1, -1)].join('  ');
    const units = detectUnits(near.replace(/\bNotes?\b/gi, ''));
    return { lineIndex: i, years, units, unitsText: near.trim() };
  }
  return null;
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
      if (/^(current|non-current)\s+(assets|liabilities)$/i.test(text)) section = text.toLowerCase();
      else if (/^(share capital|capital and reserves|equity)\b/i.test(text) && !/attributable/i.test(text)) section = 'equity';
      pendingLabel = text;
      if (text) heading = text;
      continue;
    }
    // a cell like "Borrowings (unsecured) 29" keeps its note number inside the text cell
    const labelCells = used.slice(0, firstNum);
    const nums = used.slice(firstNum);
    if (nums.length < k) { pendingLabel = ''; continue; }
    let label = labelCells.join(' ').replace(/\s+\d{1,3}(\(\w\))?$/, '').trim();
    // continuation lines: "Weighted average number ... for calculation of" / " diluted earnings per share"
    if (pendingLabel && (label === '' || /^[a-z(]/.test(label))) label = `${pendingLabel} ${label}`.trim();
    const figures = nums.slice(-k).map(parseFigure);
    const dashes = nums.slice(-k).map((t) => /^[-—–]$/.test(t));
    rows.push({ label, figures: figures.map((f, j) => (f == null && dashes[j] ? 0 : f)), section, heading, line: i });
    pendingLabel = '';
  }
  return { header, rows };
}
