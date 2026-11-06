// Number and unit handling for figures read from SGX statements.

const SCALE_PATTERNS = [
  // order: most specific first
  { re: /\b(billions?|bn)\b/i, scale: 1e9 },
  { re: /\b(millions?|mil|mn)\b/i, scale: 1e6 },
  { re: /['’‘]000|\bthousands?\b|\b000s\b/i, scale: 1e3 },
];

// Currency codes and symbols as printed in table headers, e.g. "S$'000", "US$ million", "RMB'000".
const CURRENCY_PATTERNS = [
  { re: /\bS\$|\bSGD\b|singapore dollars?/i, code: 'SGD' },
  { re: /\bUS\$|\bUSD\b|\b(US|United States) dollars?/i, code: 'USD' },
  { re: /\bRMB\b|\bCNY\b/, code: 'CNY' },
  { re: /\bRM\b|\bMYR\b/, code: 'MYR' },
  { re: /\bHK\$|\bHKD\b/, code: 'HKD' },
  { re: /\bA\$|\bAUD\b/, code: 'AUD' },
  { re: /\bRp\b|\bIDR\b/, code: 'IDR' },
  { re: /\bTHB\b|\bBaht\b/i, code: 'THB' },
  { re: /\bEUR\b|€/, code: 'EUR' },
  { re: /\bGBP\b|£/, code: 'GBP' },
  { re: /\bJPY\b|¥/, code: 'JPY' },
];

/**
 * Detect currency and scale from a table header such as "Group S$'000" or "(in US$ million)".
 * Returns nulls for anything not found: never assumes a default.
 */
export function detectUnits(header) {
  const text = String(header ?? '');
  const currency = CURRENCY_PATTERNS.find((p) => p.re.test(text))?.code ?? null;
  // "$m" style: a bare m right after a currency symbol
  let scale = /\$\s?m\b|\b(RM|RMB|US\$|S\$)\s?m\b|\$\s?['’‘]\s?(m|mil|mn)\b/i.test(text) ? 1e6 : null;
  if (scale == null) scale = SCALE_PATTERNS.find((p) => p.re.test(text))?.scale ?? null;
  return { currency, scale };
}

/**
 * Parse a figure as printed: "1,234", "(1,234)", "-", "—", "nm", "1 234.5".
 * Returns null when it is not a number. Parentheses mean negative.
 */
export function parseFigure(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[−–]/g, '-'); // unicode minus / en dash
  if (s === '' || /^[-—–]+$/.test(s) || /^(n\.?m\.?|n\.?a\.?|nil)$/i.test(s)) return null;
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);
  if (paren) { negative = true; s = paren[1]; }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  s = s.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/** Scale a printed figure into units. Returns null if scale is unknown. */
export function toUnits(value, scale) {
  if (value == null || scale == null) return null;
  // avoid float noise like 1.1 * 1e6 = 1100000.0000000002
  return Math.round(value * scale * 100) / 100;
}

/** Cents to currency units (395 cents -> 3.95). */
export function centsToUnits(cents) {
  if (cents == null) return null;
  return Math.round(cents * 1e4) / 1e6;
}
