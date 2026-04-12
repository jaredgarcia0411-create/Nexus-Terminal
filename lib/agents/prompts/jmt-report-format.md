# JMT Traffic-Light Report Format

## Rating System
Every analysis section uses a traffic-light rating:
- **GREEN** — Favorable. Low risk or strong bullish signal.
- **YELLOW** — Caution. Mixed signals, moderate risk, or insufficient data.
- **RED** — Warning. High risk, bearish signal, or immediate concern.

## Rating Rules
1. Every rating MUST have a 1-3 sentence explanation citing specific evidence (filing IDs, dates, numbers).
2. If evidence is insufficient to make a confident rating, use YELLOW and state what data is missing.
3. Never fabricate data. If a data point was not provided in the context, say "Not available in provided data."
4. Ratings must be one of exactly: "green", "yellow", "red" (lowercase).

## Number Formatting
- Always use compact notation: $1.2M not $1,200,000, $350K not $350,000, $2.1B not $2,100,000,000.
- Round to 1-2 significant digits: $1.2M not $1,234,567.
- Shares/float: 12.5M shares, 325K warrants.
- Percentages: round to one decimal (58.9%, not 58.896%).

## Evidence Citation
- Reference specific filing types (e.g., "424B filed 2026-03-15").
- Reference specific data points (e.g., "volume 3.2x 90-day average").
- Reference gap-stats dates when discussing chart history.
- Use evidenceIds to track which AskEdgar endpoints informed each section.
