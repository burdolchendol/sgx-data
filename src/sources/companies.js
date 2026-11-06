// Companies covered so far, and where each publishes its annual reports.
// SGX's own filing pages block automated clients, so reports come from each company's
// investor-relations site. See README ("Sources and terms") for what each site allows.
//
// discover(html) gets the IR page and returns [{ year, url, rank }]: one report per fiscal year
// is used, lowest rank first (rank 0 = financial statements only, which is a smaller download).

const pdfLinks = (html) => {
  const text = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\\u002F/g, '/');
  return [...new Set(text.match(/https?:\/\/[^"'\s<>\\]+\.pdf/gi) ?? [])];
};

export const COMPANIES = [
  {
    ticker: 'Z74',
    name: 'Singapore Telecommunications Limited',
    sector: 'Telecommunications',
    exchange: 'SGX Mainboard',
    type: 'company',
    currency: 'SGD',
    irPage: 'https://www.singtel.com/about-us/investor-relations/annual-reports',
    discover(html) {
      const out = [];
      for (const url of pdfLinks(html)) {
        if (/chinese|summary|SFR|circular|letter|proxy|notice|minutes|request|voting|highlights/i.test(url)) continue;
        const m = url.match(/\/annual[Rr]eports?\/(\d{4})\//) ?? url.match(/\/annualreport\/(\d{4})\//);
        if (!m) continue;
        const file = url.split('/').pop();
        if (/financial[-_]?statements|financials|_Finance/i.test(file)) out.push({ year: Number(m[1]), url, rank: 0 });
        else if (/annual[-_]?report|(^|[-_])AR\d{2,4}|ar\d{2}-full|AR\d{4}/i.test(file)) out.push({ year: Number(m[1]), url, rank: 1 });
      }
      return out;
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
