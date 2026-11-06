# sgx-data

Builds the Singapore (SGX) snapshot for the stock-screening website (`burdolchendol/react_final_project`): annual financial statements for SGX-listed companies, written to `out/sg/` in the format described in [AGENTS.md](AGENTS.md).

Status: trial. v1 has financial statements only and no share prices (`price` is `null`). It covers 8 companies:

| Ticker | Company | Years read | Notes |
|---|---|---|---|
| Z74 | Singtel | FY2012–FY2026 | Complete |
| U11 | UOB (bank) | FY2011–FY2025 | Bank layout, so no current/non-current split |
| S63 | ST Engineering | FY2020–FY2025 | No FY2022 PDF on its site; FY2022 comes from the FY2023 report |
| F34 | Wilmar (reports in US$) | FY2024–FY2025 | Only the FY2025 report has a fixed PDF link |
| C52 | ComfortDelGro | FY2013–14, FY2023–24 | Its site's media list only returns some years |
| 9CI | CapitaLand Investment | FY2020–FY2025 | Balance sheet prints net assets only, so totalAssets is blank; the EPS check rejects FY2021–22 share counts |
| BN4 | Keppel | FY2017–FY2025 | Partial: several older layouts not read yet |
| LVR | 17LIVE (reports in US$) | FY2022–FY2025 | Its site blocks automated clients, so the reports are downloaded by hand (see `--local`) |

## Run it

Requirements: Node 20 or later, plus poppler's `pdftotext` and `pdfinfo` (`apt-get install poppler-utils`, or `brew install poppler`).

```sh
npm run fetch:sg                  # every company in src/sources/companies.js
npm run fetch:sg -- --only Z74    # one company
npm run fetch:sg -- --local ~/sgx_data   # also read reports downloaded by hand
npm test                          # offline tests on saved fixtures
```

Environment variables (all optional):

| Variable | Use |
|---|---|
| `SGX_SCRAPER_CONTACT` | Contact added to the User-Agent, e.g. an email address. Never hardcode it. |
| `SGX_CACHE_DIR` | Download cache (default `.cache/http`). Processed reports are cached in `.cache/extract`. |
| `SGX_LOCAL_DIR` | Same as `--local`: a folder of reports downloaded by hand, as `<folder>/<TICKER>/<file name>`. The file name must match the report's link in `src/sources/companies.js`, which stays the `src`. These files are never deleted. |
| `SGX_KEEP_PDFS=1` | Keep downloaded PDFs. By default each PDF is deleted once it has been read, and only the extracted figures are kept, so a run doesn't fill the disk and a report is never downloaded twice. |

## How it works

1. `src/sources/companies.js` lists each company and how to find its reports: links on its IR page, a fixed yearly URL pattern, or the site's public media list. Reports are grouped by fiscal year. Statements-only PDFs are tried before the full annual report, because they are smaller downloads. A report split into section PDFs is read as one.
2. `src/http.js` downloads with at most about one request a second per host, backs off on 429 and 5xx, and caches everything.
3. `src/pdf.js` converts the PDF to text with `pdftotext -layout`, which keeps table columns aligned. Two-page spreads are split into their halves.
4. `src/parse/` finds the group income statement, balance sheet and cash-flow statement and reads the year header and units (for example `S$ Mil`). It takes the group columns, never the company-only ones. A group that prints only a statement of comprehensive income (no separate income statement) is read from that page. Both the current year and the comparative year are read, each by its own year column.
5. `src/fiscal.js` keeps full years only. When a year appears in more than one report, the most recently filed report wins.
6. `src/checks.js` runs the AGENTS.md checks on every year. The balance check includes non-controlling interests and perpetual securities. The EPS check allows for the rounding of the printed EPS (a loss of US$0.0051 a share prints as `(0.01)`). Any figure that fails is set to `null` and reported in `failures`.

`filed` is the PDF's creation date, because the companies' own sites don't publish a filing date.

Not read yet, so left `null`: `dividendsPerShare` (it is printed only in prose), goodwill split out from other intangibles, and the separate `longTermDebtCurrent`/`shortTermBorrowings` split. Current borrowings go in `debtCurrent`.

## Sources and terms (checked 2026-11-06)

| Source | robots.txt | Terms / access | Used? |
|---|---|---|---|
| SGX (`www.sgx.com`, `api.sgx.com`, `links.sgx.com`) | `www.sgx.com` allows everything | The announcements API and every `links.sgx.com` page return an Akamai "Access Denied" to automated clients. SGX Data Direct terms allow internal use only, with no redistribution. | No. We don't work around the block. |
| Singtel (`www.singtel.com`, `cdn2.singteldigital.com`, `media.aws.singtel.com`) | Allows everything except `/business/node/` | No website clause found against downloading or linking | Yes (Z74) |
| DBS (`www.dbs.com`) | Allows everything except campaign pages | The [terms](https://www.dbs.com/terms/default.page) forbid storing or hyperlinking DBS materials without written consent | Not yet. This needs the owner's decision. |
| UOB (`www.uob.com.sg`) | `*` allowed; generic tools such as curl and Python-urllib are disallowed, so we send our own named User-Agent | Not checked in detail | Yes (U11) |
| ST Engineering (`www.stengg.com`) | Allows everything except CMS folders | Not checked in detail | Yes (S63) |
| Keppel (`www.keppel.com`) | No robots.txt | Not checked in detail | Yes (BN4) |
| Wilmar (`www.wilmar-international.com`) | Allows everything, including AI crawlers | Not checked in detail | Yes (F34) |
| ComfortDelGro (`www.comfortdelgro.com`) | Allows everything except `/wp-admin/` | Not checked in detail | Yes (C52) |
| CapitaLand (`www.capitaland.com`) | Allows everything except a few event pages; signals `ai-input=yes` | Not checked in detail | Yes (9CI) |
| 17LIVE (`investor.17.live`) | Could not be read: the site answers automated clients with an AWS WAF challenge | — | Reports downloaded by hand and read with `--local` (LVR) |
| Singapore Airlines (`www.singaporeair.com`) | Blocked | The firewall returns `WAF_Custom_Deny` to automated clients | No |
| OCBC, Sembcorp, Genting Singapore, CICT, SATS, ThaiBev | — | Bot protection (Incapsula, Cloudflare or AWS challenge) or the connection is refused | No |
| CDL, Venture, Mapletree | `Disallow: /` for all or most bots | — | No |
| Yahoo Finance | Blocks AI crawlers | The terms ban automated collection | No |
