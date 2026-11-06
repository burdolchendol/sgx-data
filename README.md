# sgx-data

Builds the Singapore (SGX) snapshot for the stock-screening website (`burdolchendol/react_final_project`): annual financial statements for SGX-listed companies, written to `out/sg/` in the format described in [AGENTS.md](AGENTS.md).

Status: trial. v1 has financial statements only and no share prices (`price` is `null`). It covers Singtel (Z74) for FY2012 to FY2026.

## Run it

Requirements: Node 20 or later, plus poppler's `pdftotext` and `pdfinfo` (`apt-get install poppler-utils`, or `brew install poppler`).

```sh
npm run fetch:sg                  # every company in src/sources/companies.js
npm run fetch:sg -- --only Z74    # one company
npm test                          # offline tests on saved fixtures
```

Environment variables (all optional):

| Variable | Use |
|---|---|
| `SGX_SCRAPER_CONTACT` | Contact added to the User-Agent, e.g. an email address. Never hardcode it. |
| `SGX_CACHE_DIR` | Download cache (default `.cache/http`). Processed reports are cached in `.cache/extract`. |
| `SGX_KEEP_PDFS=1` | Keep downloaded PDFs. By default each PDF is deleted once it has been read, and only the extracted figures are kept, so a run doesn't fill the disk and a report is never downloaded twice. |

## How it works

1. `src/sources/companies.js` lists each company and its investor-relations page. The page's PDF links are grouped by fiscal year. Statements-only PDFs are tried before the full annual report, because they are smaller downloads.
2. `src/http.js` downloads with at most about one request a second per host, backs off on 429 and 5xx, and caches everything.
3. `src/pdf.js` converts the PDF to text with `pdftotext -layout`, which keeps table columns aligned.
4. `src/parse/` finds the group income statement, balance sheet and cash-flow statement and reads the year header and units (for example `S$ Mil`). It takes the group columns, never the company-only ones. Both the current year and the comparative year are read, each by its own year column.
5. `src/fiscal.js` keeps full years only. When a year appears in more than one report, the most recently filed report wins.
6. `src/checks.js` runs the AGENTS.md checks on every year. The balance check includes non-controlling interests and perpetual securities. Any figure that fails is set to `null` and reported in `failures`.

`filed` is the PDF's creation date, because the companies' own sites don't publish a filing date.

Not read yet, so left `null`: `dividendsPerShare` (it is printed only in prose), goodwill split out from other intangibles, and the separate `longTermDebtCurrent`/`shortTermBorrowings` split. Current borrowings go in `debtCurrent`.

## Sources and terms (checked 2026-11-06)

| Source | robots.txt | Terms / access | Used? |
|---|---|---|---|
| SGX (`www.sgx.com`, `api.sgx.com`, `links.sgx.com`) | `www.sgx.com` allows everything | The announcements API and every `links.sgx.com` page return an Akamai "Access Denied" to automated clients. SGX Data Direct terms allow internal use only, with no redistribution. | No. We don't work around the block. |
| Singtel (`www.singtel.com`, `cdn2.singteldigital.com`, `media.aws.singtel.com`) | Allows everything except `/business/node/` | No website clause found against downloading or linking | Yes (Z74) |
| DBS (`www.dbs.com`) | Allows everything except campaign pages | The [terms](https://www.dbs.com/terms/default.page) forbid storing or hyperlinking DBS materials without written consent | Not yet. This needs the owner's decision. |
| Singapore Airlines (`www.singaporeair.com`) | Blocked | The firewall returns `WAF_Custom_Deny` to automated clients | No |
| Yahoo Finance | Blocks AI crawlers | The terms ban automated collection | No |
