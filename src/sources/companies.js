// Companies covered so far, and where each publishes its annual reports.
// SGX's own filing pages block automated clients, so reports come from each company's
// investor-relations site. See README ("Sources and terms") for what each site allows.
//
// discover({ getText, years }) returns candidates [{ year, urls, rank }]: `year` is the fiscal
// year the report covers, `urls` is one PDF, or several when a report is split into sections,
// and the lowest rank is tried first (statements-only PDFs are smaller downloads).

/** Every absolute PDF link in a page, with relative links resolved against `base`. */
export function pdfLinks(html, base) {
  const text = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\u002F/g, '/');
  const out = new Set();
  for (const m of text.matchAll(/["'(]([^"'()\s<>\\]+\.pdf)(?:\?[^"'\s<>]*)?["')]/gi)) {
    try { out.add(new URL(m[1], base).href); } catch { /* not a URL */ }
  }
  for (const m of text.matchAll(/https?:\/\/[^"'\s<>\\]+\.pdf/gi)) out.add(m[0]);
  return [...out];
}

const one = (year, url, rank = 0) => ({ year, urls: [url], rank });
const SKIP = /chinese|summary|SFR|circular|letter|proxy|notice|minutes|request|voting|highlights|sustainability|corrigendum|buyback|_cn\b/i;

export const COMPANIES = [
  {
    ticker: 'Z74',
    name: 'Singapore Telecommunications Limited',
    sector: 'Telecommunications',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    async discover({ getText }) {
      const page = 'https://www.singtel.com/about-us/investor-relations/annual-reports';
      const out = [];
      for (const url of pdfLinks(await getText(page), page)) {
        if (SKIP.test(url)) continue;
        const m = url.match(/\/annual[Rr]eports?\/(\d{4})\//) ?? url.match(/\/annualreport\/(\d{4})\//);
        if (!m) continue;
        const file = url.split('/').pop();
        // Singtel's year ends 31 March, so the 2026 report covers FY2026
        if (/financial[-_]?statements|financials|_Finance/i.test(file)) out.push(one(Number(m[1]), url, 0));
        else if (/annual[-_]?report|(^|[-_])AR\d{2,4}|ar\d{2}-full|AR\d{4}/i.test(file)) out.push(one(Number(m[1]), url, 1));
      }
      return out;
    },
  },
  {
    ticker: 'U11',
    name: 'United Overseas Bank Limited',
    sector: 'Banks',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    async discover({ getText }) {
      const page = 'https://www.uob.com.sg/investor-relations/financial/group-annual-reports.html';
      return pdfLinks(await getText(page), page)
        .filter((u) => /annual[-_]report[-_](\d{4})\.pdf$/i.test(u) && !SKIP.test(u))
        .map((u) => one(Number(u.match(/(\d{4})\.pdf$/)[1]), u));
    },
  },
  {
    ticker: 'S63',
    name: 'Singapore Technologies Engineering Ltd',
    sector: 'Industrials',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    async discover({ getText }) {
      const page = 'https://www.stengg.com/en/investor-relations/annual-reports/';
      return pdfLinks(await getText(page), page)
        .filter((u) => /annual-report-(\d{4})\.pdf$/i.test(u))
        .map((u) => one(Number(u.match(/(\d{4})\.pdf$/)[1]), u));
    },
  },
  {
    ticker: 'BN4',
    name: 'Keppel Ltd.',
    sector: 'Industrials',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    // one microsite per year; newer years split the statements into separate PDFs
    async discover({ getText, years }) {
      const out = [];
      for (const year of years) {
        const page = `https://www.keppel.com/annualreport${year}/`;
        let links;
        try { links = pdfLinks(await getText(page), page); } catch { continue; }
        // some years link to the bare keppel.com host; use www.keppel.com, the same site
        links = links.map((u) => u.replace('://keppel.com/', '://www.keppel.com/'));
        const full = links.find((u) => /(full-report|ar\d{4}\.pdf$|-ar-?\d{2}\.pdf$)/i.test(u) && !/financial-review/.test(u));
        const fin = links.find((u) => /financial-report\.pdf$/i.test(u));
        const part = (re) => links.find((u) => /\/financial-report\//.test(u) && re.test(u));
        const sections = [part(/profit-or-loss/i), part(/balance-sheets?|financial-position/i), part(/cash-flows/i), part(/notes-to/i)];
        if (fin) out.push(one(year, fin, 0));
        if (sections.slice(0, 3).every(Boolean)) out.push({ year, urls: sections.filter(Boolean), rank: 1 });
        if (full) out.push(one(year, full, 2));
      }
      return out;
    },
  },
  {
    ticker: 'F34',
    name: 'Wilmar International Limited',
    sector: 'Consumer Staples',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    // Wilmar's report archive is a script-built page; each year's microsite has a fixed PDF path
    async discover({ years }) {
      return years.map((y) => one(y, `https://www.wilmar-international.com/annualreport${y}/documents/Wilmar-AR${String(y).slice(2)}-Full.pdf`));
    },
  },
  {
    ticker: 'C52',
    name: 'ComfortDelGro Corporation Limited',
    sector: 'Industrials',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    // the annual-reports page is built by script; the site's public WordPress media list has the PDFs
    async discover({ getText }) {
      const api = 'https://www.comfortdelgro.com/wp-json/wp/v2/media?search=annual%20report&per_page=100&_fields=source_url';
      const items = JSON.parse(await getText(api));
      return items.map((x) => x.source_url)
        .filter((u) => /CDG/i.test(u) && /annual-report/i.test(u) && /\.pdf$/i.test(u) && !SKIP.test(u))
        .map((u) => {
          const y = u.match(/Annual-Report-?(\d{4})/i) ?? u.match(/FY(\d{4})/i);
          return y ? one(Number(y[1]), u) : null;
        })
        .filter(Boolean);
    },
  },
  {
    ticker: '9CI',
    name: 'CapitaLand Investment Limited',
    sector: 'Real Estate',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    async discover({ years }) {
      return years.filter((y) => y >= 2021).map((y) => one(y,
        `https://www.capitaland.com/content/dam/capitalandinvestment/investor-relations/publications/CapitaLand-Investment-Limited-Annual-Report-${y}.pdf`));
    },
  },
  {
    ticker: 'LVR',
    name: '17LIVE Group Limited',
    sector: 'Communication Services',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    // investor.17.live answers automated clients with an AWS WAF challenge, so its report list can't be
    // read. These are its annual reports (listed December 2023); download them by hand into
    // <--local folder>/LVR/ and the run reads them from there. Each link stays the src.
    async discover() {
      const base = 'https://investor.17.live/newsroom/';
      return [
        one(2025, `${base}20260401_172541_LVR_TJ4LMQVHNAMDHD0J.1.pdf`),
        one(2024, `${base}20250407_073532_LVR_WHNJ8QL8LC7KQZO1.1.pdf`),
        one(2023, `${base}20240408_061835_LVR_D9463THUW3PAQDQS.1.pdf`),
      ];
    },
  },
];

/** Candidates grouped by year, newest year first; within a year, lowest rank first. */
export function reportsByYear(candidates) {
  const byYear = new Map();
  for (const c of candidates) byYear.set(c.year, [...(byYear.get(c.year) ?? []), c]);
  return [...byYear.entries()].sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, candidates: list.sort((a, b) => a.rank - b.rank) }));
}
