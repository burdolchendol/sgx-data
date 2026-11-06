# AGENTS.md: Singapore (SGX) data scraper

Standing instructions for anyone, human or coding agent, working in this repository. Read this file in full before changing anything.

## What this project is

This project builds a **free, regularly refreshed data snapshot of companies listed on the Singapore Exchange (SGX)**: their annual financial statements and their share prices.

The snapshot feeds the Singapore market of an existing stock-screening website, **`burdolchendol/react_final_project`**. That website already does the same thing for US companies, using SEC data. **This project's only job is to produce the Singapore snapshot in the exact format described below.** All screening, ratios, rules and display stay in the website repo.

The finished snapshot is published by this repo's GitHub Action. The website's own refresh workflow then downloads it (see "Publishing").

## Ground rules

1. **Zero cost.** Use only free sources. No paid APIs or subscriptions. If an AI model is used to read PDFs, its key goes in GitHub Secrets / `.env`, never in the code. The run must also work, with less coverage, without that key.
2. **Information only.** The website is not financial advice. Don't add buy or sell signals here.
3. **Never invent or estimate a number.** If a figure can't be found or fails a check, leave it `null`. A blank is better than a wrong number.
4. **Every number must be traceable.** Store a link to the document it came from (see `src` below), so a user can click through and check it.
5. **Be polite to servers.** Throttle requests (at most about 1 request a second to any one host, with backoff on 429/5xx). Cache downloads, and never re-download a document you already have. Identify yourself with a sensible User-Agent, but **never hardcode a personal email address**. Read it from an environment variable.
6. **Respect the sites' terms.** Check the terms of use and `robots.txt` of SGX and any other site before scraping, and note what you found in the README.
7. **Don't commit bulk data to `main`.** Downloaded PDFs, caches and the snapshot itself are git-ignored (`.cache/`, `out/`).
8. **Don't suggest emailing anyone.** Don't offer to draft or send emails to data providers, exchanges or companies (for example asking for permission or a licence). Work with the sources that are openly available, and if one is blocked, say so and suggest another source instead.
9. **The user's computer should not get clogged.** Stream or delete large files after use, and keep memory use modest so a full run works on a normal laptop and in GitHub Actions (7 GB RAM, about 14 GB disk).

## Sources to evaluate (research done so far)

| Source | What it gives | Notes |
|---|---|---|
| SGX company announcements (sgx.com, "Financial Statements" category) | Official full-year and half-year results and annual reports, as **PDFs** | Free and covers every listed company. The SGX JSON API (`api.sgx.com`) refuses requests without a token the web page generates, so a headless browser may be needed. See github.com/wongcingshen/SGXFinancials for one working approach: headless browser, keyword page scoring, then AI extraction with balance checks. |
| Yahoo Finance, `.SI` tickers (e.g. `D05.SI`) | Daily prices, plus about 4 years of annual statements | Unofficial and rate-limited. Fine for **prices**. Fundamentals are too short for Graham's 10-year tests, but useful as a cross-check or fallback. |
| ACRA open data (data.gov.sg) | Company register: name, UEN, industry code (SSIC), auditor | **No financial figures.** Only for metadata such as industry and auditor. |
| data.gov.sg (other) | Market-wide statistics only | Nothing at company level. |
| Defeat Beta (Hugging Face) | Used by the website for US prices | **US only.** There is no Singapore data. |

The expected design is **prices from Yahoo `.SI`, and financial statements from SGX annual results PDFs**, with Yahoo fundamentals as a fallback or cross-check. Confirm this with the user before building something different.

## Which companies

- Include every **primary listing of shares on the SGX Mainboard and Catalist**, including REITs and business trusts. Mark those with `type` (see below).
- Exclude ETFs, structured warrants, daily leverage certificates, bonds, preference shares, and secondary listings that already file with the SEC (for example companies also listed in the US).
- Use the **SGX stock code** as the ticker, for example `D05` for DBS, `Z74` for Singtel and `C6L` for Singapore Airlines. The Yahoo symbol is the code plus `.SI`.

## Output contract (must match exactly)

Write one folder, `out/sg/`, with this layout. The website reads it as `public/data/sg/`.

```
out/sg/
  index.json                 every company, compact
  companies/<TICKER>.json    one per company: full annual history with sources
  prices/<TICKER>.json       one per company: weekly price history
```

File names: replace any character that is not `A-Z a-z 0-9 . -` in the ticker with `_` (the same rule as the website's `companyFile()`).

### `index.json`

The numbers in the examples below are made up to show the format. They are not real figures.

```json
{
  "market": "sg",
  "label": "Singapore",
  "currency": "SGD",
  "universe": "all",
  "generatedAt": "2026-11-06T06:00:00.000Z",
  "fields": ["revenue", "netIncome", "epsDiluted", "dilutedShares", "totalAssets", "totalLiabilities",
             "currentAssets", "currentLiabilities", "equity", "longTermDebt", "operatingCashFlow",
             "capex", "dividendsPerShare", "dividendsPaid",
             "debtCurrent", "longTermDebtCurrent", "shortTermBorrowings", "cash", "goodwill", "intangibles",
             "intangiblesInclGoodwill"],
  "fx": { "asOf": null, "rates": {} },
  "companies": [
    {
      "ticker": "D05",
      "name": "DBS Group Holdings Ltd",
      "sector": "Banks",
      "exchange": "SGX Mainboard",
      "type": "company",
      "currency": "SGD",
      "financialCurrency": "SGD",
      "price": { "last": 38.12, "asOf": "2026-10-31", "prev": 37.80, "avg10w": 37.25 },
      "years": [[2024, "2024-12-31", 22297000000, 11289000000, 3.95, null, null]]
    }
  ],
  "failures": [{ "ticker": "XYZ", "error": "Annual report PDF not found" }]
}
```

- `fields` must be **exactly** the list above, in that order. It's the website's `INDEX_FIELDS`, from `src/final_project/data/snapshotFormat.js` in the website repo, so copy it from there if it has changed.
- `years` holds the **latest 11 fiscal years**, oldest first. Each row is `[fiscalYear, periodEnd, ...one value per entry in fields]`, using `null` when a figure is unknown. The example row above is shortened.
- `currency` is the **quote currency** of the shares on SGX. That's usually SGD, but some SGX shares trade in USD.
- `financialCurrency` is the currency the financial statements are reported in. That's often SGD, but many SGX companies report in USD, RMB (CNY), MYR and so on. **Store figures as reported. Do not convert them.** The website handles currency conversion.
- `type` is `"company"`, `"reit"` or `"trust"`.
- `price` uses weekly closes (see prices below):
  - `last` is the latest weekly close and `asOf` is its date
  - `prev` is the close of the week before
  - `avg10w` is the average of the last 10 weekly closes, or omitted if there are fewer than 10
  - `price` is `null` if no price was found
- `fx` stays empty. The website fills in exchange rates itself.
- `failures` lists companies that couldn't be processed, with a short reason.

### `companies/<TICKER>.json`

```json
{
  "fiscalYears": [
    {
      "fiscalYear": 2024,
      "periodEnd": "2024-12-31",
      "revenue": 22297000000,
      "netIncome": 11289000000,
      "epsDiluted": 3.95,
      "...": "every field in INDEX_FIELDS",
      "filed": "2025-02-10",
      "src": {
        "revenue": { "url": "https://links.sgx.com/...pdf", "page": 112, "label": "Total income" },
        "netIncome": { "url": "https://links.sgx.com/...pdf", "page": 112, "label": "Net profit attributable to shareholders" }
      }
    }
  ]
}
```

- Keep up to **15 fiscal years**, oldest first.
- `src` maps each field to the document it came from. `page` and `label` (the line name as printed in the statement) are strongly encouraged, so a user can find the number quickly. The US version stores an SEC accession number (`accn`) instead. The website will be updated to show `src` links for Singapore.
- `filed` is the date of the document used.

### `prices/<TICKER>.json`

```json
{
  "history": [["2021-11-05", 33.10], ["2021-11-12", 33.42]],
  "source": { "label": "Yahoo Finance", "url": "https://finance.yahoo.com/quote/D05.SI/history/" }
}
```

- **Weekly**: the last close of each week, for the **last 5 years**, oldest first, as `[date, close]` in the quote currency.

## Field definitions (Singapore statements, SFRS(I), which is the same as IFRS)

All money is in **units** of the reporting currency. Convert "S$'000" and "S$ million" tables into units. Values are **group, consolidated** figures, never the company-only columns that Singapore reports also print.

| Field | Period | Take from | Notes |
|---|---|---|---|
| revenue | full year | Income statement: "Revenue", or "Total income" for banks and "Gross revenue" for REITs | |
| netIncome | full year | "Profit attributable to owners/equity holders of the Company" | Not total profit including non-controlling interests. |
| epsDiluted | full year | "Diluted earnings per share" | Convert cents to currency units (395 cents → 3.95). If there's no diluted EPS, use basic. |
| dilutedShares | full year | Weighted average diluted shares, from the EPS note | |
| totalAssets, totalLiabilities | year end | Balance sheet totals | |
| currentAssets, currentLiabilities | year end | Balance sheet | `null` for banks, which don't split current and non-current. |
| equity | year end | "Equity attributable to owners of the Company" | |
| longTermDebt | year end | Non-current borrowings, loans and bonds | Lease liabilities are not debt. |
| debtCurrent | year end | Current borrowings, including the current portion of long-term loans | Fill this, or the next two fields, but not both. |
| longTermDebtCurrent, shortTermBorrowings | year end | Only when they're shown separately | |
| cash | year end | "Cash and cash equivalents" | |
| goodwill, intangibles | year end | Balance sheet or intangibles note | Use `intangiblesInclGoodwill` if only a combined figure is shown. |
| operatingCashFlow | full year | "Net cash from operating activities" | |
| capex | full year | "Purchase of property, plant and equipment" | Store as a **positive** number. |
| dividendsPerShare | full year | Dividends declared for that financial year (interim + final) | Convert cents to currency units. For REITs, use distribution per unit. |
| dividendsPaid | full year | "Dividends paid to owners of the Company", from the cash-flow statement | Store as positive. |

**Fiscal year rules** (the same as the US side):
- Use only **full-year** figures: audited annual report, or full-year results. The period must be 340 to 390 days long. Half-year results are ignored.
- When a year appears in several documents, because the next year's report shows it as a comparative, **the most recently published figure wins**, since it may be restated.
- `fiscalYear` is the calendar year of `periodEnd`. For example, a year ending 31 March 2025 is labelled 2025.

## Checks before a company is accepted

Run these checks for every year, and record failures in `failures` or leave the affected fields `null`:
- totalAssets ≈ totalLiabilities + equity + non-controlling interests (within 1%)
- currentAssets ≤ totalAssets, and cash ≤ currentAssets when both are present
- netIncome ÷ dilutedShares ≈ epsDiluted (within 5%) when all three are present
- The reporting currency and units are detected, never assumed.
- If AI extraction is used, store the raw extracted text or JSON in the cache, so a run can be re-checked without paying again.

## Publishing

- A scheduled GitHub Action (weekly, e.g. Mondays) runs the scrape and packs `out/sg/` as `sg-snapshot.tar.gz`. It publishes this as an asset on a rolling GitHub Release, e.g. tag `sg-latest`, replacing the previous asset. Nothing is committed to `main`.
- **Only incremental work each week:** fetch new announcements and refresh prices. Don't re-read PDFs already processed.
- The website repo's `refresh-data.yml` will download that asset into `public/data/sg/` and switch on the "Singapore" button. That step is done **in the website repo, not here**.

## Done means

1. A full run produces `out/sg/` matching the contract above, for the whole SGX universe.
2. A spot check of 3 companies (suggested: D05 DBS, Z74 Singtel, C6L Singapore Airlines) matches their annual reports, with `src` links that open the right document.
3. Tests run on saved fixtures, with no network needed, and cover parsing, unit conversion, the fiscal-year rules and the checks.
4. The README explains how to run it locally (`npm run fetch:sg` or similar), which environment variables are needed, and what the sites' terms allow.
