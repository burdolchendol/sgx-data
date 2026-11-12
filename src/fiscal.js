// Fiscal-year rules shared with the US side.

const DAY = 86_400_000;

export function periodDays(periodStart, periodEnd) {
  return Math.round((Date.parse(periodEnd) - Date.parse(periodStart)) / DAY) + 1;
}

/** A full year is 340 to 390 days long (inclusive of both ends). */
export function isFullYear(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return false;
  const d = periodDays(periodStart, periodEnd);
  return d >= 340 && d <= 390;
}

/** fiscalYear is the calendar year of periodEnd: FY ending 31 Mar 2025 -> 2025. */
export function fiscalYearOf(periodEnd) {
  return Number(String(periodEnd).slice(0, 4));
}

/**
 * Merge per-document extractions into one row per fiscal year.
 * Each extraction: { periodStart, periodEnd, filed, values: {field: n|null}, src: {field: {...}} }.
 * Only full-year periods are kept. When a year appears in several documents, the most
 * recently filed document wins field by field (it may be a restatement). A newer document
 * that has no figure for a field does not wipe an older one.
 */
export function mergeFiscalYears(extractions, { maxYears = 15 } = {}) {
  const byYear = new Map();
  const sorted = extractions
    .filter((e) => isFullYear(e.periodStart, e.periodEnd))
    .sort((a, b) => String(a.filed).localeCompare(String(b.filed)));
  for (const e of sorted) {
    const fy = fiscalYearOf(e.periodEnd);
    const row = byYear.get(fy) ?? { fiscalYear: fy, periodEnd: e.periodEnd, values: {}, src: {}, filed: e.filed };
    row.periodEnd = e.periodEnd;
    for (const [field, v] of Object.entries(e.values ?? {})) {
      if (v == null) continue;
      row.values[field] = v;
      if (e.src?.[field]) row.src[field] = e.src[field];
    }
    row.filed = e.filed;
    byYear.set(fy, row);
  }
  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear).slice(-maxYears);
}
