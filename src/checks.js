// Checks run on every fiscal year before it is accepted.
// A failed check nulls the fields involved (a blank beats a wrong number) and is reported.

const within = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
const has = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * values: the year's fields, plus helper figures that are not output fields:
 *   nonControllingInterests, perpetualSecurities (other equity instruments, e.g. Singtel's
 *   perpetual capital securities), reportingCurrency, unitsDetected.
 * Returns { values: cleaned copy without helper keys, failures: [{check, message, fields}] }.
 */
export function runChecks(values) {
  const v = { ...values };
  const failures = [];
  const fail = (check, message, fields) => failures.push({ check, message, fields });

  if (!v.reportingCurrency) fail('currency', 'reporting currency not detected', ['*']);
  if (!v.unitsDetected) fail('units', 'table units not detected', ['*']);

  if (has(v.totalAssets) && has(v.totalLiabilities) && has(v.equity)) {
    const rhs = v.totalLiabilities + v.equity
      + (has(v.nonControllingInterests) ? v.nonControllingInterests : 0)
      + (has(v.perpetualSecurities) ? v.perpetualSecurities : 0);
    if (!within(v.totalAssets, rhs, 0.01)) {
      fail('balance', `totalAssets ${v.totalAssets} vs liabilities+equity+NCI+perpetuals ${rhs}`,
        ['totalAssets', 'totalLiabilities', 'equity']);
    }
  }

  if (has(v.currentAssets) && has(v.totalAssets) && v.currentAssets > v.totalAssets) {
    fail('currentAssets', 'currentAssets > totalAssets', ['currentAssets']);
  }
  if (has(v.cash) && has(v.currentAssets) && v.cash > v.currentAssets) {
    fail('cash', 'cash > currentAssets', ['cash', 'currentAssets']);
  }

  if (has(v.netIncome) && has(v.dilutedShares) && has(v.epsDiluted) && v.dilutedShares !== 0) {
    const implied = v.netIncome / v.dilutedShares;
    // EPS is printed rounded (e.g. "(0.01)" for -0.0051), so also allow half of its last printed digit
    const decimals = (String(Math.abs(v.epsDiluted)).split('.')[1] ?? '').length;
    const rounding = decimals ? 0.5 * 10 ** -decimals : 0;
    if (!within(implied, v.epsDiluted, 0.05) && Math.abs(implied - v.epsDiluted) > rounding + 1e-12) {
      fail('eps', `netIncome/dilutedShares ${implied.toFixed(4)} vs epsDiluted ${v.epsDiluted}`,
        ['netIncome', 'dilutedShares', 'epsDiluted']);
    }
  }

  if (has(v.debtCurrent) && (has(v.longTermDebtCurrent) || has(v.shortTermBorrowings))) {
    fail('debtCurrent', 'debtCurrent and its split are both filled', ['longTermDebtCurrent', 'shortTermBorrowings']);
  }

  const out = { ...v };
  for (const k of ['nonControllingInterests', 'perpetualSecurities', 'reportingCurrency', 'unitsDetected']) delete out[k];
  for (const f of failures) {
    const fields = f.fields.includes('*') ? Object.keys(out) : f.fields;
    for (const k of fields) out[k] = null;
  }
  return { values: out, failures };
}
