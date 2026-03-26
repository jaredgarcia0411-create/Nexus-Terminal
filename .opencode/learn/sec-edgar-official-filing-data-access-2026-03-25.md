# SEC EDGAR Official Filing Data Access Crash Course
**Researched**: 2026-03-25
**Sources**: SEC official docs and codebase analysis
**Context**: Evaluating whether official SEC sources can replace or complement AskEdgar-like dilution/offering data for a retail trading research product.

---

## Concept Overview

The SEC gives you strong raw access to filings, filing metadata, and XBRL-extracted financial facts, but it does not give you an AskEdgar-style normalized dilution/offering intelligence layer. Official SEC sources are best thought of as infrastructure: reliable filing transport, indexing, and some structured financial data, with product-grade interpretation left to you.

For a retail trading research product, the practical split is: use SEC official feeds/APIs for canonical filing discovery and source documents, use XBRL endpoints for standardized financial facts where they exist, and build your own parser/normalizer for dilution, offerings, warrants, convertibles, shelf usage, and financing risk.

## How It Works

SEC access breaks into a few distinct layers:

1. `data.sec.gov` JSON APIs for company submission history and XBRL facts.
2. `sec.gov/Archives/edgar/...` directories for filing text, filing detail pages, directory indexes, daily/full indexes, feeds, oldloads, and bulk ZIPs.
3. Search tools on `sec.gov` for company search, latest filings, and full-text search.
4. DERA data sets for periodic bulk extracts of structured financial statement data and notes.

These layers are complementary, not interchangeable:

- `submissions` is good for “what did this filer submit, and when?”
- `companyfacts` / `companyconcept` / `frames` are good for comparable XBRL-tagged facts.
- EDGAR Archives are the source of truth for the actual filing package and raw exhibits.
- Full-text search is useful for discovery, but not a documented API contract.
- DERA data sets are bulk analytics inputs, not real-time event feeds.

## How It Applies Here

In this repo, AskEdgar currently supplies already-normalized dilution and offering intelligence, including endpoint concepts like `dilution-rating`, `dilution-data`, `offerings`, `registrations`, `agreements`, `equity-lines`, and `historical-float-pro`. That is much richer than what the SEC directly publishes.

If you replace or reduce AskEdgar dependence, the safest architecture is:

1. Use SEC official sources as your canonical ingestion layer.
2. Store raw filing metadata + filing documents locally.
3. Build your own extraction pipeline for financing events from S-1/S-3/F-1/F-3/424B/8-K/6-K/exhibits.
4. Use XBRL company facts only for standardized balance sheet / cash runway context, not for most dilution event detection.

## Codebase Evidence

- `lib/jarvis/askedgar.ts`: current product depends on AskEdgar endpoints like `/v1/dilution-rating`, `/v1/dilution-data`, `/v1/offerings`, `/v1/registrations`, and `/v1/equity-lines`.
- `components/trading/ResearchReportSections.tsx`: UI expects normalized concepts like baby-shelf status, offering amount, equity lines, reverse splits, and registration details.
- `lib/jarvis/prompts.ts`: research output schema assumes pre-structured dilution, offering frequency, offering ability, agreements, and filing title data.

## Official SEC Access Options

### 1) Submissions JSON

Purpose: recent filing history and filer metadata.

Base pattern:

- `https://data.sec.gov/submissions/CIK##########.json`

Exact example:

- `https://data.sec.gov/submissions/CIK0000320193.json`

What you get:

- filer metadata
- current and former names
- ticker/exchange associations for public companies
- recent filings in compact columnar arrays
- pointers to older filing-history JSON fragments when history exceeds the built-in window

Limitations:

- not a full parser of filing content
- no normalized financing terms
- no opinionated event labels like “ATM established”, “convertible reset”, or “toxic warrant overhang”
- compact arrays require your code to map columns correctly

Practical implication:

- good primary index for per-company filing timelines
- not enough on its own for dilution research

Source:

- `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`

### 2) Company Facts JSON

Purpose: all standardized XBRL company facts in one file.

Base pattern:

- `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`

Exact example:

- `https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json`

What you get:

- taxonomy-organized facts (`us-gaap`, `dei`, `ifrs-full`, etc.)
- units, filing references, periods, accession numbers, forms, and filing dates

Limitations:

- only standardized XBRL facts, not narrative financing interpretation
- no extraction of unstructured exhibit terms
- custom company-specific extensions are not the comparable aggregation target described by the SEC APIs page
- many dilution-relevant facts are absent, inconsistently tagged, or only embedded in narrative text

Practical implication:

- useful for cash, debt, shares outstanding, and some runway inputs
- weak as a standalone source for offerings/warrants/PIPE/ELOC intelligence

Sources:

- `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`
- `https://www.sec.gov/dera/data/financial-statement-data-sets`

### 3) Company Concept JSON

Purpose: one company + one XBRL tag across filings.

Base pattern:

- `https://data.sec.gov/api/xbrl/companyconcept/CIK##########/{taxonomy}/{tag}.json`

Exact example:

- `https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/CommonStockSharesOutstanding.json`

Best use:

- focused history for one metric without loading full company facts
- good for charting a single concept like shares outstanding or cash

Limitations:

- only works when the concept is tagged and standardized
- corporate actions can make time series non-trivial to interpret without split-aware normalization

Practical implication:

- useful building block for “shares outstanding trend” widgets
- still not a financing-event parser

Source:

- `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`

### 4) XBRL Frames JSON

Purpose: one comparable fact per reporting entity for a requested calendar frame.

Base pattern:

- `https://data.sec.gov/api/xbrl/frames/{taxonomy}/{tag}/{unit}/{frame}.json`

Exact example:

- `https://data.sec.gov/api/xbrl/frames/us-gaap/CommonStockSharesOutstanding/shares/CY2024Q4I.json`

What it solves:

- cross-company screening for one standardized fact in one calendar period

Limitations:

- SEC explicitly warns that reporting periods only approximately align to calendar quarters/years
- frame assembly picks filings that “most closely fit” the requested period
- not appropriate for exact legal/event interpretation

Practical implication:

- useful for broad screening dashboards
- risky if used naively for strict event timing or exact quarter-over-quarter alerts

Source:

- `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`

### 5) Filing Indexes and Raw Archive Access

Purpose: direct access to actual filings and machine-crawlable archive structure.

Key official locations:

- Daily indexes: `https://www.sec.gov/Archives/edgar/daily-index/`
- Full indexes: `https://www.sec.gov/Archives/edgar/full-index/`
- Feed archives: `https://www.sec.gov/Archives/edgar/Feed/`
- Oldloads: `https://www.sec.gov/Archives/edgar/Oldloads/`

Exact filing examples from SEC docs:

- Complete submission text: `https://www.sec.gov/Archives/edgar/data/1122304/0001193125-15-118890.txt`
- Filing package path: `https://www.sec.gov/Archives/edgar/data/1122304/000119312515118890/0001193125-15-118890.txt`
- Filing detail page: `https://www.sec.gov/Archives/edgar/data/1122304/0001193125-15-118890-index.html`
- SGML header: `https://www.sec.gov/Archives/edgar/data/1122304/000119312515118890/0001193125-15-118890.hdr.sgml`
- Directory index JSON pattern: `https://www.sec.gov/Archives/edgar/data/51143/000104746917001061/index.json`

What index files contain:

- company name
- form type
- CIK
- date filed
- file name/path

Important archive detail:

- directories often expose hidden `index.html`, `index.xml`, and `index.json`
- daily indexes are incremental; full/quarterly indexes are rebuilt and may reflect later corrections
- post-acceptance corrections can create historical mismatches until rebuild cycles catch up

Practical implication:

- this is the raw backbone you need for a serious filings product
- you can reliably discover and fetch source documents, but you must parse and classify them yourself

Source:

- `https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data`

### 6) Full-Text Search Options

Official options:

- EDGAR Full-Text Search UI: `https://www.sec.gov/edgar/search/`
- Latest Filings UI: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent`
- Older Boolean archive search: `https://www.sec.gov/cgi-bin/srch-edgar`

What SEC says:

- only Full-Text Search indexes filing text content
- other EDGAR searches mainly index filing header metadata
- Full-Text Search indexes XML content, but does not preserve XML element names as searchable structure

Examples from SEC docs:

- Form D item query via Boolean archive search: `https://www.sec.gov/cgi-bin/srch-edgar?text=items%3D04.1&first=2019&last=2019`
- EIN full-text example: `https://www.sec.gov/edgar/search/#/q=%252274%25202099724%2522&dateRange=all`

Critical limitation:

- SEC documents a search product, not a stable public search API contract
- for programmatic ingestion, the SEC’s official API documentation focuses on `submissions` and XBRL APIs, not full-text search endpoints

Practical implication:

- fine for analyst workflows and spot checks
- do not build core production ingestion on undocumented browser search calls
- for filing discovery at scale, prefer indexes + archive paths + your own parsing

Sources:

- `https://www.sec.gov/edgar/search/`
- `https://www.sec.gov/about/webmaster-frequently-asked-questions#full-text`

### 7) Bulk Data Availability

Official bulk ZIPs from the EDGAR APIs page:

- Company facts bulk ZIP: `https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip`
- Submissions bulk ZIP: `https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip`

Other important bulk sources:

- Financial Statement Data Sets: quarterly ZIPs from `https://www.sec.gov/dera/data/financial-statement-data-sets`
- Financial Statement and Notes Data Sets: monthly/quarterly ZIPs from `https://www.sec.gov/dera/data/financial-statement-and-notes-data-set`
- Structured disclosure RSS monthly archive: `https://www.sec.gov/Archives/edgar/monthly/`

Update cadence:

- `submissions` and XBRL APIs update near real time
- API bulk ZIPs are republished nightly around 3:00 a.m. ET
- financial statement data sets are periodic, not real-time

Practical implication:

- for a production product, nightly bulk sync + intraday incremental polling is the sensible pattern
- do not repeatedly rehydrate whole company histories from live endpoints if bulk archives can seed your store

Sources:

- `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`
- `https://www.sec.gov/dera/data/financial-statement-data-sets`
- `https://www.sec.gov/dera/data/financial-statement-and-notes-data-set`

### 8) RSS / Near-Real-Time Feed Options

Official RSS examples:

- US GAAP / IFRS structured filings: `https://www.sec.gov/Archives/edgar/usgaap.rss.xml`
- Mutual fund risk/return XBRL: `https://www.sec.gov/Archives/edgar/xbrl-rr.rss.xml`
- Inline XBRL filings: `https://www.sec.gov/Archives/edgar/xbrl-inline.rss.xml`
- All XBRL filings: `https://www.sec.gov/Archives/edgar/xbrlrss.all.xml`

What SEC says:

- updated every 10 minutes, Monday-Friday, 6am-10pm EST
- format may change without prior notice

Practical implication:

- helpful for alerting and lightweight monitors
- not enough by itself for offering/dilution intelligence because it is still metadata + filing links, not normalized analysis

Source:

- `https://www.sec.gov/structureddata/rss-feeds-submitted-filings`

## Rate Limits, Fair Access, and Headers

SEC guidance:

- current max request rate: `10 requests/second`
- SEC may limit or block traffic to preserve fair access
- botnets and undeclared automated tools are not allowed
- declare a descriptive `User-Agent`

SEC sample header style:

```http
User-Agent: My Company Name admin@mycompany.com
Accept-Encoding: gzip, deflate
Host: www.sec.gov
```

Additional implementation detail:

- `data.sec.gov` does not support CORS
- SEC says automated access must comply with the SEC privacy/security policy

Practical implication:

- call SEC from your server, not directly from the browser
- centralize throttling across workers
- use backoff and caching aggressively
- attach a real contact email in `User-Agent`

Sources:

- `https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data`
- `https://www.sec.gov/about/webmaster-frequently-asked-questions#developers`
- `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`

## What The SEC Does NOT Directly Normalize

This is the biggest product gap versus AskEdgar-like services.

The SEC does **not** directly give you:

1. A normalized “dilution risk” score.
2. A normalized “offering ability” or baby-shelf calculation.
3. A parsed warrant/convertible/PIPE/ELOC database across issuers.
4. Extracted pricing/reset/floor/penalty terms from securities purchase agreements.
5. A unified mapping of financing events like ATM setup, shelf takedown, direct offering, registered direct, or equity line drawdown.
6. Clean retail-ready summaries of which filings are actually dilution-relevant.
7. Full normalization of custom XBRL extensions into comparable cross-company concepts.
8. Searchable structured fields for many narrative disclosures buried in HTML, XML, PDF, or exhibit text.

Even where filings are structured, the SEC repeatedly frames its datasets as “as filed” extracts and warns that they are not substitutes for the filings themselves.

Practical implication:

- your moat is not access, it is normalization
- replacing AskEdgar means building event extraction and legal-financing interpretation yourself

## Practical Product Implications For A Retail Trading Research Product

### Recommended ingestion stack

1. Seed issuers from `company_tickers.json` / submissions bulk ZIP.
2. Use `submissions` JSON for per-issuer recent filing history.
3. Use daily/full indexes for broad filing discovery and reconciliation.
4. Fetch filing detail pages + raw filing text/exhibits from Archives.
5. Use XBRL company facts for cash/debt/shares context where tags are reliable.
6. Run your own parser/classifier over offering-related forms and exhibits.

### Best SEC-backed use cases

- filing alerts
- filing timelines
- financial fact trend charts
- company-level document retrieval
- cross-company screens on standard XBRL metrics

### Hard parts you still must build

- offering taxonomy and event classification
- warrant / convertible extraction
- shelf capacity and baby-shelf math
- “is this actually dilutive?” decision logic
- entity resolution across subsidiaries, agents, and filing variants
- exhibit parsing for pricing tables and legal covenants

### What is realistic

- SEC data can absolutely power a filings-first retail research product
- SEC data alone does not magically produce AskEdgar-grade dilution intelligence
- the replacement cost is mostly parsing, normalization, and QA, not access licensing

## Recommended Default Approach

Use official SEC sources as the system of record, but keep an internal normalized research layer that transforms raw filings into the product concepts your UI already expects.

Concretely: treat `submissions` + EDGAR indexes as discovery, EDGAR Archives as source documents, XBRL APIs as supporting fundamentals, and your own parser as the layer that recreates AskEdgar-style fields like offerings, registrations, agreements, equity lines, and dilution risk.

## Action Checklist

- [ ] Build a server-side SEC client with shared throttling, caching, retries, and declared `User-Agent`.
- [ ] Mirror `submissions.zip` and `companyfacts.zip` nightly.
- [ ] Ingest daily/full indexes for reconciliation and broad discovery.
- [ ] Create parsers for `S-1`, `S-3`, `F-1`, `F-3`, `424B*`, `8-K`, `6-K`, and financing exhibits.
- [ ] Store raw filing text and extracted structured financing events separately.
- [ ] Re-map existing UI concepts in `components/trading/ResearchReportSections.tsx` to internally-derived SEC-backed fields.

## Known Unknowns

- SEC documentation is slightly inconsistent on Full-Text Search scope: the search UI says filings since 2001, while `SEC Data Resources` still describes it as covering the last four years. The UI appears newer, but this is worth validating before promising historical coverage in-product.
- SEC search tools are documented as user-facing tools; the stable public API contract is much clearer for `submissions` and XBRL than for full-text search.
- Some dilution-relevant disclosures may appear in PDFs, scans, or poorly structured exhibits, which raises OCR/document-quality questions outside the core SEC API docs.

## Related Topics

- EDGAR form-type taxonomy for offerings and resale registrations
- Parsing securities purchase agreements and warrant exhibits
- XBRL taxonomy coverage limits for capital-structure analysis

## Follow-up Questions

---
*To continue learning, use: `/research more about SEC EDGAR offerings parsing` or ask follow-up questions*
