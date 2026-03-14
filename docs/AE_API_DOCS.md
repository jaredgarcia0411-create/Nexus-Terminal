# **AskEdgar API Documentation**

**For AI assistants and developers:** This is the complete reference for the AskEdgar API. It covers every data endpoint, all parameters, authentication, pagination, and includes working examples. You can use this doc to build applications that pull stock dilution data, SEC filing intelligence, float/outstanding share data, and more.

---

## **Data Freshness**

Data is updated within **24 hours** of new SEC filings and news. Stocks that are "in play" (up significantly on the day) are updated more frequently. If you're tracking a day's runners or movers, it's a good idea to re-fetch data for those tickers throughout the day to get the most current information.

---

## **Quick Start**

**Base URL:** `https://eapi.askedgar.io`

**Authentication:** All data endpoints require an API key passed in a header:

API-KEY: your\_api\_key\_here

**Example request (curl):**

curl "https://eapi.askedgar.io/v1/reverse-splits?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

**Example request (Python):**

import requests

response \= requests.get(  
    "https://eapi.askedgar.io/v1/reverse-splits",  
    params={"ticker": "AAPL"},  
    headers={"API-KEY": "your\_api\_key\_here"}  
)  
data \= response.json()

**Example request (JavaScript/fetch):**

const response \= await fetch(  
    "https://eapi.askedgar.io/v1/reverse-splits?ticker=AAPL",  
    { headers: { "API-KEY": "your\_api\_key\_here" } }  
);  
const data \= await response.json();

---

## **Common Patterns (Read This First)**

### **Every response looks like this**

All data endpoints return the same wrapper:

{  
  "status": "success",  
  "count": 42,  
  "results": \[ ... \]  
}

* `status` — `"success"` or `"error"`  
* `count` — total number of results returned  
* `results` — array of data objects (the actual data you want)

### **Pagination**

All list endpoints support pagination with these two query parameters:

| Parameter | Type | Default | Description |
| ----- | ----- | ----- | ----- |
| `page` | integer | `0` | Page number (starts at 0\) |
| `limit` | integer | `100` | Results per page (max per request) |

To get the second page of 50 results: `?page=1&limit=50`

### **Percentage and decimal field conventions**

**Important:** Different fields use different units. Pay attention to this when building UIs or comparisons:

| Fields | Format | Example | Meaning |
| ----- | ----- | ----- | ----- |
| All `gain_*` fields (1-day, 7-day, etc.) | Percentage | `15.0` | 15% gain |
| `feerate` (borrow fee rate) | Percentage | `5.0` | 5% annual cost |
| `short_float` | Decimal | `0.065` | 6.5% of float is short |
| `insider_percent`, `affiliate_percent`, `institutions_percent` | Decimal | `0.125` | 12.5% ownership |

### **Date filtering**

Many endpoints support date filters. Dates are always in `YYYY-MM-DD` format:

| Parameter | Description |
| ----- | ----- |
| `date` | Exact date match |
| `date_from` | Start of date range (inclusive) |
| `date_to` | End of date range (inclusive) |

You can use `date_from` and `date_to` together for a range, or use `date` alone for a single day.

Some endpoints use `filed_at_from` / `filed_at_to` instead — these filter on the SEC filing date rather than the event date. Same format applies.

### **Ticker format**

Tickers should be **uppercase** letters. They may also include numbers, dots (`.`), hyphens (`-`), or carets (`^`). Examples: `AAPL`, `BRK.A`, `SPY`.

If you pass an invalid ticker format, you'll get a validation error.

### **Error responses**

**401 — Invalid or missing API key:**

{  
  "status": "error",  
  "error": {  
    "code": "missing\_api\_key",  
    "message": "API key is required. Pass it in the API-KEY header.",  
    "details": {}  
  },  
  "request\_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab"  
}

**422 — Validation error (bad parameters):**

{  
  "status": "error",  
  "error": {  
    "code": "validation\_error",  
    "message": "Request validation failed.",  
    "details": {  
      "fields": \[  
        {  
          "field": "ticker",  
          "reason": "Value error, Field 'ticker' must contain only uppercase letters, numbers, dots, hyphens, or carets."  
        }  
      \]  
    }  
  },  
  "request\_id": "a1b2c3d4-5678-90ab-cdef-1234567890ab"  
}

### **Rating values**

Several endpoints use a rating system. Where you see a `Rating` type, the allowed values are:

* `"High"`  
* `"Medium"`  
* `"Low"`

### **Risk level values**

Where you see a `RiskLevel` type, the allowed values are:

* `"high"`  
* `"medium"`  
* `"low"`

(Note: ratings are capitalized, risk levels are lowercase.)

---

## **Endpoints**

---

### **1\. Reverse Splits**

**GET** `/v1/reverse-splits`

Look up reverse stock splits. Use this to find which companies have done reverse splits, when they happened, and the split ratio.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker (e.g., `"AAPL"`) |
| `date` | date | No | Exact date (`YYYY-MM-DD`) |
| `date_from` | date | No | Start of date range |
| `date_to` | date | No | End of date range |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/reverse-splits?ticker=AAPL\&date\_from=2020-01-01\&date\_to=2024-12-31" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "execution\_date": "2021-01-01",  
      "split\_from": 2,  
      "split\_to": 1  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `execution_date` | date | When the reverse split took effect |
| `split_from` | number | Original share count in the ratio (e.g., `2` in a 2:1 reverse split means every 2 shares become 1\) |
| `split_to` | number | New share count in the ratio |

---

### **2\. Float, Outstanding, Market Cap & Key Data**

**GET** `/v1/float-outstanding`

Get current float, outstanding shares, market cap, and ownership breakdown for a ticker. Use this for a quick snapshot of a stock's share structure.

#### **What do these terms mean?**

* **Outstanding shares** — Total number of shares that exist (held by all shareholders).  
* **Float** — Shares held by non-affiliates (outstanding minus shares held by officers, directors, and major holders with control).  
* **Tradable float** — The "true" tradable float. Starts from float but also removes restricted shares, shares subject to lock-up agreements, and other non-tradable shares. This is the number of shares actually available to trade on the open market.  
* **Market cap** — Total market value of all outstanding shares (price × outstanding).

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `min_float` | integer | No | Minimum float (number of shares) |
| `max_float` | integer | No | Maximum float |
| `min_outstanding` | integer | No | Minimum outstanding shares |
| `max_outstanding` | integer | No | Maximum outstanding shares |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/float-outstanding?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "float": 1000000,  
      "outstanding": 1000000,  
      "market\_cap\_final": 2500000000.0,  
      "industry": "Technology",  
      "sector": "Electronic Equipment",  
      "country": "United States",  
      "isadr": false,  
      "insider\_percent": 0.125,  
      "affiliate\_percent": 0.45,  
      "institutions\_percent": 0.325  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `float` | integer | Number of shares held by non-affiliates |
| `outstanding` | integer | Total outstanding shares |
| `market_cap_final` | number | Market capitalization in dollars |
| `industry` | string | Industry classification |
| `sector` | string | Sector classification |
| `country` | string | Country of incorporation |
| `isadr` | boolean | Whether this is an American Depositary Receipt (a US-listed share of a foreign company) |
| `insider_percent` | number | Percentage of shares held by insiders (decimal, e.g., `0.125` \= 12.5%) |
| `affiliate_percent` | number | Percentage of shares held by affiliates (officers, directors, large holders with control) |
| `institutions_percent` | number | Percentage of shares held by institutional investors (mutual funds, hedge funds, etc.) |

---

### **3\. Dilution Rating**

**GET** `/v1/dilution-rating`

Get AskEdgar's proprietary dilution risk rating for a stock. This tells you how likely a company is to dilute shareholders through offerings, warrant exercises, or other share issuances.

#### **What is dilution?**

Dilution happens when a company issues new shares, reducing the ownership percentage of existing shareholders. This is common in small-cap stocks and can significantly impact share price.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `offering_ability` | Rating | No | Filter by offering ability rating (`"High"`, `"Medium"`, or `"Low"`) — whether the company has the legal setup (shelf registrations, ATMs) to issue new shares |
| `dilution` | Rating | No | Filter by dilution rating — how much the share count has already been diluted |
| `offering_frequency` | Rating | No | Filter by how often the company does offerings |
| `cash_need` | Rating | No | Filter by how urgently the company needs cash (based on burn rate) |
| `nasdaq_compliance` | Rating | No | Filter by Nasdaq compliance risk |
| `overall_offering_risk` | Rating | No | Filter by the overall offering risk rating |
| `regsho` | boolean | No | Filter by Reg SHO threshold list status (`true` \= on the list). Stocks on the Reg SHO list have high levels of failed-to-deliver shares. |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/dilution-rating?ticker=ASTC" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "ASTC",  
      "offering\_ability": "Low",  
      "offering\_ability\_desc": "No Shelf, No ATM, No S-1 Offering",  
      "dilution": "Medium",  
      "dilution\_desc": "48.6%",  
      "offering\_frequency": "Low",  
      "offering\_frequency\_desc": "Count of offering types in last 2 yrs: Offerings: 0, Warrant Exercises: 0, PIPEs: 0, ATM Used: 0",  
      "cash\_need": "Medium",  
      "cash\_need\_desc": "The company has 23.23 months of cash left based on quarterly cash burn of $2.90M and estimated current cash of $22.44M.",  
      "nasdaq\_compliance": "",  
      "nasdaq\_compliance\_desc": "",  
      "mgmt\_commentary": "",  
      "overall\_offering\_risk": "Low",  
      "regsho": false,  
      "warrant\_exercise": "Medium",  
      "warrant\_exercise\_desc": "Based on 0 Warrant Exercises and $8,327,725 Warrant Value",  
      "estimated\_cash": 22440000.0,  
      "cash\_burn": 2900000.0,  
      "cash\_remaining\_months": 23.23,  
      "total\_debt\_final": 1500000.0  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `offering_ability` | string | Rating: `"High"`, `"Medium"`, or `"Low"` — does the company have shelf registrations, ATMs, or S-1s that let them issue shares? |
| `offering_ability_desc` | string | Human-readable explanation of the rating |
| `dilution` | string | Rating — how much have outstanding shares increased (diluted) |
| `dilution_desc` | string | Usually a percentage showing how much dilution has occurred |
| `offering_frequency` | string | Rating — how often the company does offerings |
| `offering_frequency_desc` | string | Breakdown of offering types in the last 2 years |
| `cash_need` | string | Rating — how urgently the company needs to raise cash |
| `cash_need_desc` | string | Explanation with months of cash remaining |
| `nasdaq_compliance` | string | Rating — compliance risk with exchange listing requirements |
| `nasdaq_compliance_desc` | string | Details on any compliance issues |
| `mgmt_commentary` | string | Management commentary about the company's plans |
| `overall_offering_risk` | string | Rating — overall risk of future dilutive offerings |
| `regsho` | boolean | Whether the stock is on the Reg SHO threshold list (high failed-to-deliver) |
| `warrant_exercise` | string | Rating for risk of warrants being exercised (which creates new shares) |
| `warrant_exercise_desc` | string | Details about outstanding warrant value and exercise history |
| `estimated_cash` | number | Estimated current cash on hand (dollars) |
| `cash_burn` | number | Quarterly cash burn rate (dollars) |
| `cash_remaining_months` | number | Estimated months of cash remaining at current burn rate |
| `total_debt_final` | number | Total debt (dollars) |

---

### **4\. Nasdaq Compliance**

**GET** `/v1/nasdaq-compliance`

Get Nasdaq compliance deficiency notices and status for stocks. Companies that fall below Nasdaq listing requirements (minimum share price, market cap, etc.) receive deficiency notices and may face delisting.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `date` | date | No | Exact date |
| `date_from` | date | No | Start of date range |
| `date_to` | date | No | End of date range |
| `deficiency` | string | No | Filter by deficiency type (e.g., bid price, market value, etc.) |
| `added_date_from` | date | No | Filter by when the deficiency was added (start) |
| `added_date_to` | date | No | Filter by when the deficiency was added (end) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/nasdaq-compliance?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "date": "2021-01-01",  
      "deficiency": "Bid Price",  
      "company": "Apple Inc.",  
      "market": "NASDAQ",  
      "risk": "Medium",  
      "notes": "Company granted 180-day extension",  
      "notes\_updated": "2021-01-01",  
      "status": "Active"  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `date` | date | Date of the compliance notice |
| `deficiency` | string | Type of listing deficiency (e.g., "Bid Price" means stock fell below $1) |
| `company` | string | Company name |
| `market` | string | Which market/exchange |
| `risk` | string | Risk assessment |
| `notes` | string | Additional notes or updates |
| `notes_updated` | date | When notes were last updated |
| `status` | string | Current status of the compliance issue |

---

### **5\. Offerings**

**GET** `/v1/offerings`

Get stock offerings — when a company sells new or existing shares to raise capital. This includes direct offerings, public offerings, PIPEs, ATM offerings, and more.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `date` | date | No | Exact date |
| `date_from` | date | No | Start of date range |
| `date_to` | date | No | End of date range |
| `headline` | string | No | Search offering headlines (minimum 4 characters) |
| `offering_type` | string | No | Filter by type of offering. Valid values: `"REGISTERED OFFERING"`, `"ATM USED"`, `"PRIVATE PLACEMENT"`, `"DEBT OFFERING"`, `"DEBT CONVERSION"`, `"SHARE ISSUANCE FOR ACQUISITION"`, `"NEW EQUITY LINE"`, `"CREDIT FACILITY"`, `"IPO"`, `"UPLIST"` |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/offerings?ticker=AAPL\&date\_from=2024-01-01" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "headline": "Apple Inc. Announces New Debt Offering",  
      "filed\_at": "2025-02-10",  
      "form\_type": "8-K",  
      "offering\_type": "S-3",  
      "askedgar\_url": "https://askedgar.com/aapl-offering",  
      "selling\_shareholder\_details": "Shares registered for resale by institutional investors.",  
      "shares\_amount": 1000000,  
      "warrants\_amount": 500000,  
      "share\_price": 150.75,  
      "offering\_amount": 150000000,  
      "conversion\_price": 155.0  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `headline` | string | Short description of the offering |
| `filed_at` | date | SEC filing date |
| `form_type` | string | SEC form type (e.g., `"8-K"`, `"S-1"`, `"424B5"`) |
| `offering_type` | string | Type of offering. Values: `"REGISTERED OFFERING"`, `"ATM USED"`, `"PRIVATE PLACEMENT"`, `"DEBT OFFERING"`, `"DEBT CONVERSION"`, `"SHARE ISSUANCE FOR ACQUISITION"`, `"NEW EQUITY LINE"`, `"CREDIT FACILITY"`, `"IPO"`, `"UPLIST"` |
| `askedgar_url` | string | Link to the offering details on AskEdgar |
| `selling_shareholder_details` | string | Details about who is selling shares |
| `shares_amount` | number | Number of shares in the offering |
| `warrants_amount` | number | Number of warrants included in the offering |
| `share_price` | number | Price per share in the offering |
| `offering_amount` | number | Total dollar amount of the offering |
| `conversion_price` | number | Conversion price (if applicable, for convertible offerings) |

---

### **5b. Offerings — Funds & Underwriters (Advanced)**

**GET** `/v1/offerings-advanced`

Same data as `/v1/offerings`, but with additional `investors` and `bank` fields showing which funds participated and which investment bank underwrote the deal.

**Access note:** This endpoint is restricted to institutional/professional-tier API access. Not available to retail traders.

#### **Parameters**

Same as `/v1/offerings`, plus:

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `investors` | string | No | Filter by investor/fund name (text search, partial match) |
| `bank` | string | No | Filter by investment bank name (text search, partial match) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/offerings-advanced?ticker=AAPL\&date\_from=2024-01-01" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Response fields**

Same as `/v1/offerings`, plus:

| Field | Type | Description |
| ----- | ----- | ----- |
| `investors` | string | Names of investors/funds involved in the offering |
| `bank` | string | Investment bank that underwrote the offering |

---

### **6\. Dilution Data (Warrants & Convertibles)**

**GET** `/v1/dilution-data`

Get detailed warrant and convertible security data for a specific ticker. This shows all outstanding warrants and convertible notes/debt that could create new shares if exercised or converted.

**Note:** This is the only data endpoint where `ticker` is **required**.

**Coming soon:** `price_protection`, `bank`, and `fund` fields will be added to dilution data results in a future update.

#### **Why this matters**

Warrants give holders the right to buy new shares at a set price. Convertible notes let holders convert debt into shares. Both create new shares when exercised/converted, diluting existing shareholders.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | **Yes** | Stock ticker (required) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/dilution-data?ticker=WNW" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

The results array contains a mix of **Warrant** and **Convertible** objects. You can tell them apart by their fields.

**Warrant example:**

{  
  "details": "May 2022 \- Warrants",  
  "warrants\_amount": 285714.0,  
  "warrants\_remaining": 285714.0,  
  "warrants\_exercise\_price": 21.0,  
  "registered": "Not Registered",  
  "prefunded\_cost": 0,  
  "exercisable\_date": "2022-05-05",  
  "expiration\_date": "2027-05-05",  
  "filed\_at": "2022-05-05",  
  "askedgar\_url": "https://app.askedgar.io/filing?ticker=WNW&..."  
}

**Convertible example:**

{  
  "details": "May 2024 \- Convertible Note",  
  "conversion\_price": 0.5,  
  "registered": "Not Registered",  
  "convertible\_date": "2024-05-17",  
  "maturity\_date": "2025-05-17",  
  "offering\_amount": 1000000.0,  
  "convertible\_debt\_remaining": 1000000.0,  
  "underlying\_shares\_remaining": 2000000.0,  
  "filed\_at": "2024-05-17",  
  "askedgar\_url": "https://app.askedgar.io/filing?ticker=WNW&..."  
}

#### **Warrant fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `details` | string | Description of the warrant issuance |
| `warrants_amount` | number | Total warrants originally issued |
| `warrants_remaining` | number | Warrants still outstanding (not yet exercised) |
| `warrants_exercise_price` | number | Price per share the holder pays to exercise the warrant |
| `registered` | string | Whether the shares underlying these warrants are registered for resale (e.g., `"Not Registered"`, `"Registered"`) |
| `prefunded_cost` | number | Cost already paid for pre-funded warrants (these are almost certain to be exercised) |
| `exercisable_date` | string | Date when warrants become exercisable |
| `expiration_date` | string | Date when warrants expire |
| `filed_at` | string | SEC filing date |
| `askedgar_url` | string | Link to the filing on AskEdgar |

#### **Convertible fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `details` | string | Description of the convertible security |
| `conversion_price` | number | Price at which debt converts to shares |
| `registered` | string | Whether the shares underlying this convertible are registered for resale |
| `convertible_date` | string | Date the convertible was issued |
| `maturity_date` | string | Date the convertible debt matures |
| `offering_amount` | number | Original dollar amount of the convertible offering |
| `convertible_debt_remaining` | number | Dollar amount of debt not yet converted |
| `underlying_shares_remaining` | number | Number of shares that would be created if all remaining debt converts |
| `filed_at` | string | SEC filing date |
| `askedgar_url` | string | Link to the filing on AskEdgar |

---

### **7\. Dilution Data — Funds & Underwriters (Advanced)**

**GET** `/v1/dilution-data-advanced`

This is the same data as `/v1/dilution-data` (warrants and convertibles), but with additional fields showing which banks underwrote the deal, which funds/investors participated, and what price protection provisions were negotiated.

**Access note:** This endpoint is restricted to institutional/professional-tier API access. Not available to retail traders.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `owner` | string | No | Filter by fund/investor name |
| `price_protection` | string | No | Filter by type of price protection in the deal (e.g., anti-dilution provisions). This is a text search (partial match) — you can search for terms like `"full ratchet"`, `"weighted average"`, etc. |
| `bank` | string | No | Filter by investment bank name |
| `date` | date | No | Exact date |
| `date_from` | date | No | Start of date range |
| `date_to` | date | No | End of date range |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/dilution-data-advanced?ticker=WNW" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

Returns the same Warrant and Convertible objects as `/v1/dilution-data`, with additional fields for banks, funds, and price protection details.

---

### **8\. Historical Float & Market Cap (Pro)**

**GET** `/v1/historical-float-pro`

Get historical float, outstanding shares, and ownership data over time, sourced directly from SEC filings. This lets you track how a company's share structure has changed.

**Note on ADRs:** ADR data is less accurate than non-ADR data due to complexities in ADS ratio adjustments. Use the `is_adr` filter to exclude ADRs if you need higher accuracy.

**Note:** The `reported_date` is the "as of" date — the date the share counts are reported as of, not when the filing was submitted. For example, a filing submitted on 3/31/2025 might report shares outstanding as of 12/31/2024. Use `filed_at` for when the document was actually filed with the SEC.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `is_foreign_company` | boolean | No | Filter for foreign companies |
| `is_adr` | boolean | No | Filter for ADRs. Set `false` to exclude ADRs for more accurate data. |
| `latest_data` | boolean | No | Set `true` to get only the most recent data point per ticker (default: `false`) |
| `filed_at_from` | date | No | SEC filing date range start |
| `filed_at_to` | date | No | SEC filing date range end |
| `reported_date_from` | date | No | "As of" date range start (the date the data describes, not the filing date) |
| `reported_date_to` | date | No | "As of" date range end |
| `min_float` | integer | No | Minimum float |
| `max_float` | integer | No | Maximum float |
| `min_outstanding_shares` | integer | No | Minimum outstanding shares |
| `max_outstanding_shares` | integer | No | Maximum outstanding shares |
| `min_affiliate_percent` | number | No | Minimum affiliate ownership % (decimal) |
| `max_affiliate_percent` | number | No | Maximum affiliate ownership % |
| `min_institutions_percent` | number | No | Minimum institutional ownership % |
| `max_institutions_percent` | number | No | Maximum institutional ownership % |
| `min_insider_percent` | number | No | Minimum insider ownership % |
| `max_insider_percent` | number | No | Maximum insider ownership % |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/historical-float-pro?ticker=STRG\&latest\_data=true" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "STRG",  
      "filed\_at": "2023-05-15",  
      "form\_type": "10-K",  
      "document\_url": "https://www.sec.gov/Archives/edgar/data/1803096/...",  
      "reported\_date": "2023-05-15",  
      "outstanding\_shares": 2868000,  
      "float": 868000,  
      "tradable\_float": 750000,  
      "affiliate\_shares": 2000000,  
      "five\_percent\_shareholders": 2000000,  
      "insider\_shares": 2000000,  
      "affiliate\_percent": 0.691,  
      "institutions\_percent": 0.691,  
      "insider\_percent": 0.691,  
      "details": "Ownership / FinancialReport",  
      "ownership\_source": "",  
      "source\_date": "",  
      "cik": "1803096",  
      "foreign\_company": false,  
      "ads\_ratio": 0.691,  
      "is\_adr": false,  
      "number\_classes": 0,  
      "classes\_details": "",  
      "oldtickers": "STRG-OLD,STRG-PREV",  
      "market\_cap": 2500000000  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `filed_at` | date | Date the SEC document was filed |
| `form_type` | string | SEC form type (e.g., `"10-K"` \= annual report, `"10-Q"` \= quarterly report) |
| `document_url` | string | Direct URL to the SEC filing |
| `reported_date` | date | The "as of" date for the share data. A filing submitted on 3/31/2025 might report data as of 12/31/2024 — this field would show `2024-12-31`. |
| `outstanding_shares` | integer | Total outstanding shares (ADR-adjusted if applicable) |
| `float` | integer | Shares held by non-affiliates (ADR-adjusted if applicable) |
| `tradable_float` | integer | True tradable float — float minus restricted shares, lock-ups, and other non-tradable shares (ADR-adjusted if applicable) |
| `affiliate_shares` | integer | Shares held by affiliates |
| `five_percent_shareholders` | integer | Shares held by 5%+ shareholders |
| `insider_shares` | integer | Shares held by insiders |
| `affiliate_percent` | number | Affiliate ownership percentage (decimal) |
| `institutions_percent` | number | Institutional ownership percentage (decimal) |
| `insider_percent` | number | Insider ownership percentage (decimal) |
| `details` | string | Source description of the data |
| `ownership_source` | string | Where ownership data came from (⚠️ currently may show incorrect values — fix in progress) |
| `source_date` | date | Date of ownership source |
| `cik` | string | SEC Central Index Key (unique company identifier) |
| `foreign_company` | boolean | Whether this is a foreign company |
| `ads_ratio` | number | ADS (American Depositary Share) ratio for ADRs |
| `is_adr` | boolean | Whether this is an ADR |
| `number_classes` | integer | Number of share classes |
| `classes_details` | string | Details about different share classes |
| `oldtickers` | string | Comma-separated list of previous ticker symbols |
| `market_cap` | integer | Market capitalization |

---

### **9\. News & Filings**

**GET** `/v1/news`

Get news articles and SEC filings for a ticker. You can filter to show only news, only filings, or both.

#### **Understanding `form_type`**

The `form_type` field tells you what kind of record this is:

* `"news"` — News article (has `body`, `title`, `author`, and `channels` fields)  
* `"grok"` — AI-generated summary from Grok for tickers that were up 20%+ on a given day  
* `"jmt415"` — Commentary from analyst jmt415 on a given day  
* **SEC filing types** — Summarized filings. Supported types: `10-Q`, `10-K`, `20-F`, `6-K`, `8-K`, `424B5`, `424B1`, `424B4`, `424B3`, `S-1`, `F-1`, `S-3`, `F-3`, `F-10`, `DEF 14A`, `PRE 14A`, `4`, `3`, `SCHEDULE 13G`, `SCHEDULE 13D`

**Important:** The `body`, `title`, `author`, and `channels` fields are **only populated for `form_type = "news"`**. For SEC filings, use the `summary` field instead.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `date` | date | No | Exact date |
| `date_from` | date | No | Start of date range |
| `date_to` | date | No | End of date range |
| `tag` | string | No | Filter by tag. Valid values: `"Earnings"`, `"Contracts"`, `"Expansion Plans"`, `"Product Launches"`, `"Dividends"`, `"Mergers"`, `"Acquisitions"`, `"Management Changes"`, `"FDA"`, `"Divestures"`, `"Restructuring"`, `"Financial Trouble"`, `"Offerings"`, `"Dilution"`, `"Legal Disputes"`, `"Payment Defaults"`, `"Credit Rating Changes"`, `"Operational Disruptions"`, `"Accounting Changes"`, `"Workforce Reduction"`, `"Investor Conferences"`, `"Delisting Actions"`, `"IPOs"`, `"Name Changes"`, `"Offer for sale"`, `"Earnings Calls"`, `"Partnerships"`, `"License Agreements"`, `"Upcoming Events"`, `"Financial Performance"`, `"Insider Selling"`, `"Insider Buying"`, `"Positive Data"`, `"Negative Data"`, `"Clinical Trials"`, `"Stock Splits"`, `"Executive Compensation"`, `"Cryptocurrency"`, `"Patents"`, `"Bankruptcy"`, `"Buyback"`, `"Capital Structure"`, `"Financing Activity"`, `"Cannabis"`, `"Shareholder Vote"`, `"AI"`, `"Cash Runway"`, `"Other"` |
| `query` | string | No | Full-text search across news content |
| `hide_news` | boolean | No | Set `true` to hide news articles and show only SEC filings (default: `false`) |
| `hide_filings` | boolean | No | Set `true` to hide SEC filings and show only news (default: `false`) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/news?ticker=AAPL\&date\_from=2025-01-01\&hide\_filings=true" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "filed\_at": "2025-02-10",  
      "created\_at": "2025-02-10T15:30:00",  
      "form\_type": "news",  
      "file\_no": "001-123456",  
      "summary": "Apple announces new product launch",  
      "body": "Apple Inc. today announced the launch of its new innovative product...",  
      "tags": \["nasdaq", "technology", "earnings"\],  
      "channels": \["tech", "finance", "breaking"\],  
      "title": "Apple Unveils Revolutionary New Technology",  
      "author": "Financial News Reporter",  
      "document\_url": "https://www.benzinga.com/..."  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `filed_at` | date | Date of the filing or article |
| `created_at` | datetime | Timestamp when the record was created |
| `form_type` | string | Record type: `"news"`, `"grok"`, `"jmt415"`, or an SEC form type (e.g., `"8-K"`, `"10-Q"`, `"S-1"`) |
| `file_no` | string | SEC file number (empty for news) |
| `summary` | string | Short summary (available for all record types) |
| `body` | string | Full text content (**news only** — empty for filings) |
| `tags` | array of strings | Topic tags from a fixed list (see `tag` parameter above for all valid values) |
| `channels` | array of strings | Distribution channels (**news only** — deprecated, may be removed) |
| `title` | string | Article title (**news only** — empty for filings) |
| `author` | string | Author name (**news only** — empty for filings) |
| `document_url` | string | URL to the original document |

---

### **10\. SEC Registrations (Shelf, ATM, Equity Line)**

**GET** `/v1/registrations`

Get SEC registration filings — these are the legal documents companies file before they can sell new shares. Includes shelf registrations, equity lines, At-The-Market (ATM) programs, and share resale registrations.

#### **Why this matters**

A company needs an effective registration before it can sell new shares to the public. Tracking registrations helps you anticipate future offerings and potential dilution.

#### **Key concepts**

* **Shelf registration** — Lets a company sell shares over time (up to 3 years) without filing a new registration each time.  
* **ATM (At-The-Market)** — A program that lets a company sell shares gradually at market prices.  
* **Baby shelf limit** — Companies with public float under $75M can only sell up to 1/3 of their public float in a 12-month period.  
* **Equity line** — An arrangement where an investor commits to buying shares over time.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `filed_at_from` | date | No | Filing date range start |
| `filed_at_to` | date | No | Filing date range end |
| `effective_date_from` | date | No | Effective date range start |
| `effective_date_to` | date | No | Effective date range end |
| `effective_status` | boolean | No | `true` \= currently effective, `false` \= not yet effective or expired |
| `expiration_date_from` | date | No | Expiration date range start |
| `expiration_date_to` | date | No | Expiration date range end |
| `min_calculated_raisable_amount` | number | No | Minimum amount the company can still raise |
| `max_calculated_raisable_amount` | number | No | Maximum amount the company can still raise |
| `file_no` | string | No | SEC file number |
| `bank` | string | No | Filter by investment bank |
| `min_amount_sold_to_date` | number | No | Minimum amount already sold |
| `max_amount_sold_to_date` | number | No | Maximum amount already sold |
| `min_total_raised` | number | No | Minimum total raised |
| `max_total_raised` | number | No | Maximum total raised |
| `min_offering_amount` | number | No | Minimum registration amount |
| `max_offering_amount` | number | No | Maximum registration amount |
| `over_baby_shelf` | boolean | No | `true` \= company is over the baby shelf limit (public float under $75M), meaning they're limited in how much they can sell |
| `is_atm` | boolean | No | `true` \= this is an ATM program |
| `form_type` | string | No | SEC form type (e.g., `"S-3"`, `"S-1"`, `"F-3"`) |
| `type` | string | No | Registration type |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/registrations?ticker=AAPL\&effective\_status=true" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `headline` | string | Description of the registration |
| `filed_at` | date | SEC filing date |
| `effective_date` | date | Date the registration became effective |
| `effective_status` | boolean | Whether the registration is currently effective |
| `expiration_date` | date | When the registration expires |
| `offering_amount` | number | Total amount registered (dollars) |
| `details` | string | Additional details |
| `60_day_high` | number | Highest stock price in the last 60 days |
| `amount_sold_12_mos` | number | Amount sold under this registration in the last 12 months |
| `total_raised` | number | Total amount raised under this registration |
| `baby_shelf_raisable_amount` | number | Maximum amount that can be raised under baby shelf rules |
| `over_baby_shelf` | boolean | Whether the company exceeds the baby shelf threshold |
| `file_no` | string | SEC file number |
| `is_atm` | boolean | Whether this is an ATM program |
| `bank` | string | Investment bank running the ATM |
| `amount_remaining_atm` | number | Amount remaining in the ATM program |
| `document_url` | string | URL to the SEC document |
| `askedgar_url` | string | Link to view on AskEdgar |

---

### **11\. Agreements (Registration Rights, Participation Rights, Equity Restrictions)**

**GET** `/v1/agreements`

Get registration rights agreements, participation rights agreements, and equity restriction agreements. These are contractual provisions tied to securities deals.

#### **Key concepts**

* **Registration rights** — Investors negotiate the right to have their shares registered for public sale. Includes deadlines and penalties if the company fails to register on time.  
* **Participation rights** — Existing investors get the right to participate in future offerings to maintain their ownership percentage.  
* **Equity restrictions** — Lock-up or standstill provisions that prevent selling shares for a specified period.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `agreement_type` | string | No | Filter by agreement type. Valid values: `"registration_rights"`, `"equity_restriction"`, `"participation_rights"` |
| `filed_at_from` | date | No | Filing date range start |
| `filed_at_to` | date | No | Filing date range end |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/agreements?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "agreement\_type": "registration\_rights",  
      "is\_registration\_rights": true,  
      "is\_restriction\_present": false,  
      "is\_right\_of\_participation": false,  
      "investor\_names": "Vanguard, BlackRock",  
      "filed\_at": "2024-01-15",  
      "registration\_deadline": 90,  
      "effective\_deadline": 120,  
      "penalties": "1% per month",  
      "effective\_deadline\_date": "2024-05-15",  
      "registration\_deadline\_date": "2024-04-15",  
      "details": "Registration rights agreement details",  
      "form\_type": "8-K",  
      "restriction\_date": "",  
      "duration\_in\_days": 0,  
      "exempt\_issuances": "",  
      "participation\_percentage": "",  
      "askedgar\_url": "https://app.askedgar.io/filing?ticker=AAPL&..."  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `agreement_type` | string | Type of agreement |
| `is_registration_rights` | boolean | Whether this includes registration rights |
| `is_restriction_present` | boolean | Whether this includes equity restrictions |
| `is_right_of_participation` | boolean | Whether this includes participation rights |
| `investor_names` | string | Names of investors in the agreement |
| `filed_at` | date | SEC filing date |
| `registration_deadline` | integer | Days until registration must be filed |
| `effective_deadline` | integer | Days until registration must become effective |
| `penalties` | string | Penalty for missing deadlines (e.g., "1% per month") |
| `effective_deadline_date` | date | Calculated effective deadline date |
| `registration_deadline_date` | date | Calculated registration deadline date |
| `details` | string | Full details of the agreement |
| `form_type` | string | SEC form type |
| `restriction_date` | date | Date equity restrictions apply |
| `duration_in_days` | integer | Duration of restriction/lock-up in days |
| `exempt_issuances` | string | Issuances exempt from the agreement |
| `participation_percentage` | string | Participation right percentage |
| `askedgar_url` | string | Link to view on AskEdgar |

---

### **12\. Pump & Dump Tracker**

**GET** `/v1/pump-and-dump-tracker`

Track stocks that show characteristics of potential pump-and-dump schemes. Includes risk ratings, IPO data, lock-up expirations, liquidation history, and more.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `ipo_date_from` | date | No | IPO date range start |
| `ipo_date_to` | date | No | IPO date range end |
| `lock_up_expiration_from` | date | No | Lock-up expiration range start |
| `lock_up_expiration_to` | date | No | Lock-up expiration range end |
| `underwriters` | string | No | Filter by underwriter name |
| `min_number_liquidations` | integer | No | Minimum number of liquidation events |
| `max_number_liquidations` | integer | No | Maximum number of liquidation events |
| `min_tradable_float` | integer | No | Minimum tradable float |
| `max_tradable_float` | integer | No | Maximum tradable float |
| `min_outstanding_shares` | integer | No | Minimum outstanding shares |
| `max_outstanding_shares` | integer | No | Maximum outstanding shares |
| `min_market_cap` | integer | No | Minimum market cap |
| `max_market_cap` | integer | No | Maximum market cap |
| `country` | string | No | Filter by country (e.g., `"CN"`, `"US"`) |
| `isadr` | boolean | No | Filter for ADRs |
| `min_gain_1_day` | number | No | Min 1-day price change (%) |
| `max_gain_1_day` | number | No | Max 1-day price change (%) |
| `min_gain_7_day` | number | No | Min 7-day price change (%) |
| `max_gain_7_day` | number | No | Max 7-day price change (%) |
| `min_gain_14_day` | number | No | Min 14-day price change (%) |
| `max_gain_14_day` | number | No | Max 14-day price change (%) |
| `min_gain_30_day` | number | No | Min 30-day price change (%) |
| `max_gain_30_day` | number | No | Max 30-day price change (%) |
| `is_asian` | boolean | No | Filter for Asian-origin companies |
| `known_underwriter` | boolean | No | Whether the underwriter is a known/tracked entity |
| `known_ipo_underwriter` | boolean | No | Whether the IPO underwriter is a known/tracked entity |
| `last_liquidation_date_from` | date | No | Last liquidation date range start |
| `last_liquidation_date_to` | date | No | Last liquidation date range end |
| `country_risk` | RiskLevel | No | Country risk (`"high"` \= Asian countries, `"medium"`, `"low"`) |
| `scam_risk` | RiskLevel | No | Coordinated pump evidence (`"high"` \= recent evidence on messaging platforms, `"medium"` \= older/limited evidence, `"low"` \= none) |
| `float_risk` | RiskLevel | No | Float risk (`"high"` \= under 5M tradable float, `"medium"`, `"low"`) |
| `underwriter_risk` | RiskLevel | No | Underwriter risk (`"high"` \= underwriter linked to prior pump & dumps, `"medium"`, `"low"`) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/pump-and-dump-tracker?country\_risk=high\&scam\_risk=high\&limit=10" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "ABCD",  
      "ipo\_date": "2023-01-15",  
      "lock\_up\_expiration": "2023-07-15",  
      "underwriters": "Example Underwriter LLC",  
      "number\_liquidations": 3,  
      "tradable\_float": 2500000,  
      "outstanding\_shares": 10000000,  
      "market\_cap": 15000000,  
      "country": "CN",  
      "insider\_names": "John Doe, Jane Smith",  
      "exchange": "NASDAQ",  
      "industry": "Biotechnology",  
      "sector": "Healthcare",  
      "isadr": false,  
      "gain\_1\_day": \-15.5,  
      "gain\_7\_day": \-30.25,  
      "gain\_14\_day": \-45.0,  
      "gain\_30\_day": \-60.75,  
      "num\_splits": 2,  
      "last\_split\_date": "2023-06-01",  
      "is\_asian": true,  
      "known\_underwriter": true,  
      "known\_ipo\_underwriter": true,  
      "last\_liquidation\_date": "2023-09-01",  
      "underwriter\_risk": "high",  
      "country\_risk": "high",  
      "float\_risk": "high",  
      "liquidation\_history": "high",  
      "scam\_risk": "high",  
      "scam\_description": "Suspected pump and dump scheme",  
      "last\_post\_date": "2023-10-01",  
      "relevant\_url": "https://example.com/report"  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `ipo_date` | date | IPO date |
| `lock_up_expiration` | date | When the IPO lock-up period expires (insiders can sell after this) |
| `underwriters` | string | Underwriter names |
| `number_liquidations` | integer | Number of times insiders/major holders liquidated |
| `tradable_float` | integer | Tradable float shares |
| `outstanding_shares` | integer | Total outstanding shares |
| `market_cap` | integer | Market capitalization |
| `country` | string | Country code |
| `insider_names` | string | Names of insiders |
| `exchange` | string | Stock exchange |
| `industry` | string | Industry |
| `sector` | string | Sector |
| `isadr` | boolean | Is an ADR |
| `gain_1_day` | number | 1-day price change (percentage, e.g., `-15.5` \= down 15.5%) |
| `gain_7_day` | number | 7-day price change (percentage) |
| `gain_14_day` | number | 14-day price change (percentage) |
| `gain_30_day` | number | 30-day price change (percentage) |
| `num_splits` | integer | Number of reverse splits |
| `last_split_date` | date | Date of last reverse split |
| `is_asian` | boolean | Whether the company is Asian-origin |
| `known_underwriter` | boolean | Whether the underwriter is in AskEdgar's tracked underwriter database |
| `known_ipo_underwriter` | boolean | Whether the IPO underwriter is tracked |
| `last_liquidation_date` | date | Date of most recent liquidation |
| `underwriter_risk` | string | `"high"` if the underwriter has previously underwritten a stock involved in a coordinated pump & dump. `"medium"` or `"low"` otherwise. |
| `country_risk` | string | `"high"` for companies based in Asian countries. `"medium"` or `"low"` otherwise. |
| `float_risk` | string | `"high"` if tradable float is under 5M shares (low float \= easier to manipulate). `"medium"` or `"low"` otherwise. |
| `liquidation_history` | string | Liquidation history risk level |
| `scam_risk` | string | Whether evidence of coordinated pump activity was found (e.g., on WhatsApp, Telegram, Discord). `"high"` \= recent posts (last 30 days) with multiple indicators of coordination. `"medium"` \= older posts or limited evidence. `"low"` \= no evidence found. |
| `scam_description` | string | Description of scam indicators |
| `last_post_date` | date | Date of last related post/report |
| `relevant_url` | string | URL to relevant report or discussion |

---

### **13\. Stock Screener**

**GET** `/v1/screener`

Screen stocks by a wide range of financial criteria. This is the most flexible endpoint — you can filter by market cap, price, volume, float, short interest, performance, and much more.

#### **Parameters**

**Basic filters:**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `industry` | string | No | Filter by industry (use `/v1/screener/options?field=industry` to get valid values) |
| `sector` | string | No | Filter by sector (use `/v1/screener/options?field=sector` for values) |
| `country` | string | No | Filter by country (use `/v1/screener/options?field=country` for values) |
| `exchange` | string | No | Filter by exchange (use `/v1/screener/options?field=exchange` for values) |
| `state` | string | No | Filter by US state (use `/v1/screener/options?field=state` for values) |
| `currency` | string | No | Filter by currency (use `/v1/screener/options?field=currency` for values) |
| `isadr` | boolean | No | Filter for ADRs |
| `isactivelytrading` | boolean | No | Filter for actively trading stocks |
| `pending_s1` | boolean | No | Filter for stocks with a pending S-1 registration (upcoming IPO or offering) |
| `ipodate_from` | date | No | IPO date range start |
| `ipodate_to` | date | No | IPO date range end |

**Price & market cap filters:**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `min_market_cap` / `max_market_cap` | integer | Market cap range |
| `min_price` / `max_price` | number | Stock price range |

**Volume filters:**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `min_averagevolume` / `max_averagevolume` | integer | Average daily volume range |
| `min_median_volume_60` / `max_median_volume_60` | integer | Median volume over 60 days |
| `min_today_volume` / `max_today_volume` | integer | Today's trading volume |
| `min_vol_change` / `max_vol_change` | number | Volume change percentage vs. average |

**Share structure filters:**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `min_outstanding` / `max_outstanding` | integer | Outstanding shares range |
| `min_float` / `max_float` | integer | Float range (shares held by non-affiliates) |
| `min_tradable_float` / `max_tradable_float` | integer | Tradable float range (float minus restricted/locked-up shares — the "true" tradable float) |

**Short selling filters:**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `min_short_interest` / `max_short_interest` | integer | Short interest (number of shares sold short) |
| `min_short_float` / `max_short_float` | number | Short float as a decimal (shares short ÷ float). `0.15` \= 15% of float is short. |
| `min_days_to_cover` / `max_days_to_cover` | number | Days to cover (short interest ÷ average daily volume) |
| `min_available` / `max_available` | integer | Shares available to borrow for short selling |
| `min_feerate` / `max_feerate` | number | Short borrow fee rate as a percentage (e.g., `5.0` \= 5% annual cost to borrow). Higher \= harder to borrow, more expensive to short. |

**Price performance filters (values are percentages, e.g., `15.0` \= 15%):**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `min_gain_1_day` / `max_gain_1_day` | number | 1-day price change |
| `min_gain_2_day` / `max_gain_2_day` | number | 2-day price change |
| `min_gain_3_day` / `max_gain_3_day` | number | 3-day price change |
| `min_gain_7_day` / `max_gain_7_day` | number | 7-day price change |
| `min_gain_14_day` / `max_gain_14_day` | number | 14-day price change |
| `min_gain_30_day` / `max_gain_30_day` | number | 30-day price change |
| `min_gain_60_day` / `max_gain_60_day` | number | 60-day price change |
| `min_gain_90_day` / `max_gain_90_day` | number | 90-day price change |
| `min_gain_180_day` / `max_gain_180_day` | number | 180-day price change |
| `min_gain_365_day` / `max_gain_365_day` | number | 365-day price change |

**Other filters:**

| Parameter | Type | Description |
| ----- | ----- | ----- |
| `min_num_gaps` / `max_num_gaps` | integer | Number of times the stock gapped up 30%+ (opened 30%+ higher than previous close) |
| `min_num_runners` / `max_num_runners` | integer | Number of times the stock ran up 30%+ in a single day |
| `min_ratio_debt_to_equity` / `max_ratio_debt_to_equity` | number | Debt-to-equity ratio |
| `min_avg_gap` / `max_avg_gap` | number | Average gap-up size (%) |

**Pagination:**

| Parameter | Type | Default |
| ----- | ----- | ----- |
| `page` | integer | `0` |
| `limit` | integer | `100` |

#### **Example request**

Find low-float stocks under $5 with high short interest:

curl "https://eapi.askedgar.io/v1/screener?max\_price=5\&max\_float=5000000\&min\_short\_float=0.15\&isactivelytrading=true" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "market\_cap": 2500000000,  
      "price": 150.25,  
      "averagevolume": 50000000,  
      "country": "US",  
      "exchange": "NASDAQ",  
      "industry": "Technology",  
      "sector": "Consumer Electronics",  
      "state": "CA",  
      "city": "Cupertino",  
      "ipodate": "1980-12-12",  
      "isadr": false,  
      "isactivelytrading": true,  
      "cik": "0000320193",  
      "cusip": "037833100",  
      "currency": "USD",  
      "outstanding": 15500000000,  
      "float": 15400000000,  
      "tradable\_float": 15400000000,  
      "ratio\_debt\_to\_equity": 1.5,  
      "market\_cap\_final": 2500000000,  
      "short\_interest": 100000000,  
      "days\_to\_cover": 1.5,  
      "median\_volume\_60": 48000000,  
      "today\_volume": 55000000,  
      "avg\_gap": 0.5,  
      "available": 5000000,  
      "feerate": 0.003,  
      "pending\_s1": false,  
      "num\_gaps": 5,  
      "num\_runners": 3,  
      "gain\_1\_day": 0.015,  
      "gain\_2\_day": 0.025,  
      "gain\_3\_day": 0.03,  
      "gain\_7\_day": 0.05,  
      "gain\_14\_day": 0.08,  
      "gain\_30\_day": 0.1,  
      "gain\_60\_day": 0.15,  
      "gain\_90\_day": 0.2,  
      "gain\_180\_day": 0.25,  
      "gain\_365\_day": 0.35,  
      "vol\_change": 14.58,  
      "short\_float": 0.0065  
    }  
  \]  
}

---

### **14\. Screener Options (Get Valid Filter Values)**

**GET** `/v1/screener/options`

Get the list of valid values for a screener dropdown field. Use this before calling the screener to know what values you can pass.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `field` | string | **Yes** | Which field to get options for. Valid values: `"industry"`, `"sector"`, `"country"`, `"exchange"`, `"state"`, `"currency"` |

#### **Example request**

curl "https://eapi.askedgar.io/v1/screener/options?field=sector" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 15,  
  "results": \[  
    "Technology",  
    "Healthcare",  
    "Financial Services",  
    "Consumer Cyclical",  
    "..."  
  \]  
}

---

### **15\. Right of First Refusal & Tail Financings (ROFR)**

**GET** `/v1/rofr`

Get Right of First Refusal (ROFR) and Tail Financing data from SEC filings. These are contractual provisions in underwriting agreements.

**Access note:** This endpoint is restricted to institutional/professional-tier API access. Not available to retail traders.

#### **What are these?**

* **Right of First Refusal (ROFR)** — The investment bank gets first dibs on the company's next offering. If the company wants to raise capital again, the bank has the right to be the underwriter before anyone else is considered.  
* **Tail Financing** — If the company does a deal with an investor that the bank originally introduced, the bank still receives a fee — even after the engagement has ended. This protects banks from being cut out of deals they helped create.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `filed_at_from` | date | No | Filing date range start |
| `filed_at_to` | date | No | Filing date range end |
| `bank_name` | string | No | Filter by bank name |
| `right_of_first_refusal_present` | boolean | No | `true` \= only show filings with ROFR |
| `tail_financing_payments_present` | boolean | No | `true` \= only show filings with tail financing |
| `right_of_first_refusal_duration_min` | number | No | Minimum ROFR duration (days) |
| `right_of_first_refusal_duration_max` | number | No | Maximum ROFR duration (days) |
| `tail_financing_payments_duration_min` | number | No | Minimum tail financing duration (days) |
| `tail_financing_payments_duration_max` | number | No | Maximum tail financing duration (days) |
| `right_of_first_refusal_end_date_from` | date | No | ROFR end date range start |
| `right_of_first_refusal_end_date_to` | date | No | ROFR end date range end |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/rofr?ticker=AAPL\&right\_of\_first\_refusal\_present=true" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "document\_url": "https://www.sec.gov/...",  
      "form\_type": "8-K",  
      "filed\_at": "2024-01-15",  
      "offering\_type": "ATM",  
      "bank\_name": "Goldman Sachs",  
      "right\_of\_first\_refusal\_present": true,  
      "right\_of\_first\_refusal\_details": "ROFR details...",  
      "right\_of\_first\_refusal\_duration": 180,  
      "right\_of\_first\_refusal\_type": "exclusive",  
      "right\_of\_first\_refusal\_end\_date": "2025-07-15",  
      "tail\_financing\_payments\_present": true,  
      "tail\_financing\_payments\_duration": 90,  
      "askedgar\_url": "https://app.askedgar.io/filing?ticker=AAPL&..."  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `document_url` | string | URL to the SEC filing |
| `form_type` | string | SEC form type |
| `filed_at` | date | SEC filing date |
| `offering_type` | string | Type of offering (e.g., `"ATM"`) |
| `bank_name` | string | Name of the investment bank |
| `right_of_first_refusal_present` | boolean | Whether a ROFR provision exists |
| `right_of_first_refusal_details` | string | Details of the ROFR provision |
| `right_of_first_refusal_duration` | number | Duration of the ROFR in days |
| `right_of_first_refusal_type` | string | Type of ROFR (e.g., `"exclusive"`) |
| `right_of_first_refusal_end_date` | date | When the ROFR expires |
| `tail_financing_payments_present` | boolean | Whether tail financing provisions exist |
| `tail_financing_payments_duration` | number | Duration of the tail financing period in days |
| `askedgar_url` | string | Link to view on AskEdgar |

---

### **16\. Ownership**

**GET** `/v1/ownership`

Get ownership data for a specific ticker, grouped by reported date. Shows who owns shares (executives, directors, large investors) and how much they hold.

**Note:** `ticker` is **required** for this endpoint.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | **Yes** | Stock ticker (required) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/ownership?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

Results are grouped by `reported_date`, each containing an array of `owners`:

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "reported\_date": "2024-01-12",  
      "owners": \[  
        {  
          "ticker": "AAPL",  
          "filed\_at": "2024-01-15",  
          "form\_type": "4",  
          "reported\_date": "2024-01-12",  
          "owner\_name": "John Doe",  
          "owner\_type": "Director",  
          "title": "Director",  
          "common\_shares\_amount": 50000,  
          "preferred\_shares\_amount": 0,  
          "options\_amount": 0,  
          "warrants\_amount": 0,  
          "shares\_underlying\_convertibles": 0,  
          "outstanding\_shares\_final": 15500000000,  
          "cik": "0000320193",  
          "document\_url": "https://www.sec.gov/...",  
          "classes\_details": "",  
          "source\_table": ""  
        }  
      \]  
    }  
  \]  
}

#### **Owner fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `filed_at` | date | SEC filing date |
| `form_type` | string | SEC form type (commonly `"4"` for insider transactions) |
| `reported_date` | date | Date the ownership was reported as of |
| `owner_name` | string | Name of the owner |
| `owner_type` | string | Type of owner. Values: `"Executive"`, `"Director"`, `"10+ Percent Investor"`, `"5-10 Percent Investor"` |
| `title` | string | Title/role of the owner (e.g., `"CEO"`, `"Director"`) |
| `common_shares_amount` | integer | Number of common shares held |
| `preferred_shares_amount` | integer | Number of preferred shares held |
| `options_amount` | integer | Number of options held |
| `warrants_amount` | integer | Number of warrants held |
| `shares_underlying_convertibles` | integer | Shares underlying convertible securities |
| `outstanding_shares_final` | number | Total outstanding shares at time of report |
| `cik` | string | SEC Central Index Key |
| `document_url` | string | URL to the SEC filing |

---

### **17\. AI Chart Analysis (Gap Analysis)**

**GET** `/v1/ai-chart-analysis`

Get AI-generated chart analysis for a stock. This analyzes how a stock has historically performed on gap-up days (days where the stock opens significantly higher than the previous close).

**Generated within a few minutes of a ticker hitting \+20% on the day.** There is no websocket or webhook — poll this endpoint to check for new analysis.

**Note:** `ticker` is **required** for this endpoint. Returns the latest analysis.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | **Yes** | Stock ticker (required) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/ai-chart-analysis?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "ticker": "AAPL",  
      "gain\_percentage": 45.5,  
      "chart\_count": 10,  
      "analysis\_text": "Bullish pattern detected...",  
      "volume": 55000000,  
      "price": 150.25,  
      "rating": "green",  
      "created\_at": "2025-02-10T15:30:00",  
      "post\_url": "https://..."  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `gain_percentage` | number | How much the stock was up when analysis was generated (percentage) |
| `chart_count` | integer | Number of historical gap-up days analyzed |
| `analysis_text` | string | AI-generated chart analysis text |
| `volume` | integer | Trading volume at time of analysis |
| `price` | number | Stock price at time of analysis |
| `rating` | string | Gap performance rating: `"green"` (closes strong more often than weak), `"yellow"` (mixed results), `"orange"` (mostly closes weak on gaps), `"red"` (always closes weak on gaps) |
| `created_at` | datetime | When the analysis was generated |
| `post_url` | string | URL to the published analysis |

---

### **18\. Research Reports**

Three endpoints provide AI-generated research reports at different levels of detail. All three require `ticker`. **There is no websocket or webhook — poll these endpoints to check for new reports.**

* **Full report** (`/v1/research-reports`) and **TLDR** (`/v1/research-reports-tldr`) — generated within a few minutes of a ticker hitting \+40% on the day.  
* **Short report** (`/v1/research-reports-short`) — pulls from more data sources, generated within 10–15 minutes of a ticker hitting \+40% on the day.

#### **18a. Full Research Report**

**GET** `/v1/research-reports`

Returns the most comprehensive AI-generated research report.

curl "https://eapi.askedgar.io/v1/research-reports?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

**Response fields:**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `gain_percentage` | number | How much the stock was up (percentage) |
| `report_text` | string | Full research report text |
| `volume` | integer | Trading volume |
| `price` | number | Stock price |
| `market_cap` | integer | Market capitalization |
| `created_at` | datetime | When the report was generated |
| `post_url` | string | URL to the published report |

#### **18b. Short Research Report**

**GET** `/v1/research-reports-short`

Returns a condensed version of the research report that pulls from more data sources. Takes slightly longer to generate (10–15 minutes vs a few minutes for the full report).

curl "https://eapi.askedgar.io/v1/research-reports-short?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

**Response fields:** Same as full report, plus:

| Field | Type | Description |
| ----- | ----- | ----- |
| `tradable_float` | integer | Tradable float |
| `outstanding` | integer | Outstanding shares |
| `country` | string | Country |
| `industry` | string | Industry |

#### **18c. TLDR Research Report**

**GET** `/v1/research-reports-tldr`

Returns the shortest summary — a quick TLDR.

curl "https://eapi.askedgar.io/v1/research-reports-tldr?ticker=AAPL" \\  
  \-H "API-KEY: your\_api\_key\_here"

**Response fields:**

| Field | Type | Description |
| ----- | ----- | ----- |
| `ticker` | string | Stock ticker |
| `gain_percentage` | number | How much the stock was up (percentage) |
| `tldr_text` | string | Very short TLDR summary |
| `report_id` | integer | ID linking to the full report |
| `price` | number | Stock price |
| `market_cap` | integer | Market capitalization |
| `tradable_float` | integer | Tradable float |
| `outstanding` | integer | Outstanding shares |
| `country` | string | Country |
| `industry` | string | Industry |
| `created_at` | datetime | When generated |
| `post_url` | string | URL to published report |

---

### **19\. Market Strength**

**GET** `/v1/market-strength`

AI-generated analysis of overall small-cap market strength. The AI is fed data on the day's top gappers (whether they closed red/green, broke premarket highs, broke 11am highs, closed over VWAP, etc.), multi-day runners, active sectors, news catalysts, prices, floats, and other data points. It then produces an analysis of the overall strength of the small-cap market and any active themes.

**Generated daily at 2:30 AM CST.**

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `date` | date | No | Specific date (`YYYY-MM-DD`) |
| `latest` | boolean | No | Set `true` to get the most recent analysis (default: `false`) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/market-strength?latest=true" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "date": "2024-01-01",  
      "analysis": "Market analysis text...",  
      "performance": "Market performance text..."  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `date` | date | Date of the analysis |
| `analysis` | string | AI-generated market analysis narrative |
| `performance` | string | AI-generated market performance summary |

---

### **20\. Filing Titles**

**GET** `/v1/filing-titles`

Look up AI-generated filing titles and headlines. Instead of just showing the SEC form type (e.g., "8-K"), the `headline` field provides a human-readable one-liner describing what the filing is actually about. Useful for quickly understanding filings without reading them.

#### **Parameters**

| Parameter | Type | Required | Description |
| ----- | ----- | ----- | ----- |
| `ticker` | string | No | Filter by stock ticker |
| `document_url` | string | No | Filter by SEC document URL |
| `cik` | string | No | Filter by SEC Central Index Key |
| `accession_number` | string | No | Filter by SEC accession number |
| `form_type` | string | No | Filter by SEC form type (e.g., `"10-K"`, `"8-K"`) |
| `page` | integer | No | Page number (default: `0`) |
| `limit` | integer | No | Results per page (default: `100`) |

#### **Example request**

curl "https://eapi.askedgar.io/v1/filing-titles?ticker=AAPL\&form\_type=10-K" \\  
  \-H "API-KEY: your\_api\_key\_here"

#### **Example response**

{  
  "status": "success",  
  "count": 1,  
  "results": \[  
    {  
      "accession\_number": "0001234567-24-000001",  
      "cik": "0000320193",  
      "ticker": "AAPL",  
      "headline": "Annual Report",  
      "filed\_at": "2024-01-15",  
      "file\_no": "001-123456",  
      "form\_type": "10-K",  
      "document\_url": "https://www.sec.gov/..."  
    }  
  \]  
}

#### **Response fields**

| Field | Type | Description |
| ----- | ----- | ----- |
| `accession_number` | string | SEC accession number (unique filing identifier) |
| `cik` | string | SEC Central Index Key |
| `ticker` | string | Stock ticker |
| `headline` | string | AI-generated one-liner describing what the filing is about (e.g., "Announces $50M ATM offering program" instead of just "8-K") |
| `filed_at` | date | Filing date |
| `file_no` | string | SEC file number |
| `form_type` | string | SEC form type |
| `document_url` | string | URL to the SEC document |

---

## **Common Use Cases (Recipes)**

Here are typical workflows a developer might want to build:

### **"Show me the dilution risk for a stock"**

1. Call `/v1/dilution-rating?ticker=XXXX` to get the overall risk profile  
2. Call `/v1/dilution-data?ticker=XXXX` to see specific warrants and convertibles  
3. Call `/v1/registrations?ticker=XXXX&effective_status=true` to see active shelf registrations

### **"Find risky small-cap stocks"**

1. Call `/v1/screener?max_market_cap=300000000&max_float=5000000&isactivelytrading=true`  
2. For each result, call `/v1/dilution-rating?ticker=XXXX` to check dilution risk

### **"Get recent offerings for a ticker"**

1. Call `/v1/offerings?ticker=XXXX&date_from=2024-01-01`  
2. Call `/v1/dilution-data-advanced?ticker=XXXX` to see which funds and banks were involved (institutional access)

### **"Get an AI report on a stock that's running"**

1. When a stock is up 20%+: poll `/v1/ai-chart-analysis?ticker=XXXX` for gap-day performance analysis  
2. When a stock is up 40%+: poll `/v1/research-reports-tldr?ticker=XXXX` for a quick summary (available within minutes)  
3. Wait 10-15 min, then call `/v1/research-reports-short?ticker=XXXX` for the deeper report with more sources  
4. Call `/v1/research-reports?ticker=XXXX` for the full deep-dive

### **"Check today's market conditions"**

1. Call `/v1/market-strength?latest=true` for AI analysis of small-cap market strength (updated daily at 2:30 AM CST)

### **"Check if a stock might be a pump & dump"**

1. Call `/v1/pump-and-dump-tracker?ticker=XXXX`  
2. Look at `scam_risk`, `country_risk`, `float_risk`, and `underwriter_risk` fields

### **"Track how a company's float has changed over time"**

1. Call `/v1/historical-float-pro?ticker=XXXX` to get all historical data points  
2. Plot `outstanding_shares` and `float` over `reported_date` to visualize dilution

---

## **Full Endpoint Summary**

| Endpoint | Method | Auth | Description |
| ----- | ----- | ----- | ----- |
| `/v1/reverse-splits` | GET | API-KEY | Reverse stock splits |
| `/v1/float-outstanding` | GET | API-KEY | Current float, outstanding, market cap, ownership |
| `/v1/dilution-rating` | GET | API-KEY | Dilution risk ratings |
| `/v1/nasdaq-compliance` | GET | API-KEY | Nasdaq compliance deficiency notices |
| `/v1/offerings` | GET | API-KEY | Stock offerings (ATM, PIPE, direct, etc.) |
| `/v1/offerings-advanced` | GET | API-KEY | Offerings \+ fund & bank details (institutional access only) |
| `/v1/dilution-data` | GET | API-KEY | Warrants & convertibles (ticker required) |
| `/v1/dilution-data-advanced` | GET | API-KEY | Dilution data \+ bank, fund & price protection details (institutional access only) |
| `/v1/historical-float-pro` | GET | API-KEY | Historical float & market cap from SEC filings |
| `/v1/news` | GET | API-KEY | News articles & SEC filings |
| `/v1/registrations` | GET | API-KEY | SEC registrations (shelf, ATM, equity line) |
| `/v1/agreements` | GET | API-KEY | Registration rights, participation rights, equity restrictions |
| `/v1/rofr` | GET | API-KEY | Right of first refusal & tail financing data (institutional access only) |
| `/v1/ownership` | GET | API-KEY | Ownership data grouped by reported date (ticker required) |
| `/v1/pump-and-dump-tracker` | GET | API-KEY | Pump & dump risk tracker |
| `/v1/screener` | GET | API-KEY | Stock screener with 60+ filters |
| `/v1/screener/options` | GET | API-KEY | Valid values for screener dropdown filters |
| `/v1/ai-chart-analysis` | GET | API-KEY | AI gap analysis — generated within minutes of \+20% (ticker required) |
| `/v1/research-reports` | GET | API-KEY | Full AI research report — generated within minutes of \+40% (ticker required) |
| `/v1/research-reports-short` | GET | API-KEY | Short AI research report — more sources, 10-15 min after \+40% (ticker required) |
| `/v1/research-reports-tldr` | GET | API-KEY | TLDR AI research report — generated within minutes of \+40% (ticker required) |
| `/v1/market-strength` | GET | API-KEY | AI analysis of small-cap market strength (generated daily 2:30 AM CST) |
| `/v1/filing-titles` | GET | API-KEY | AI-generated human-readable filing headlines |

