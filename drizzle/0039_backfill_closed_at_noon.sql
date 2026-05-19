-- Backfill trades.closed_at from midnight UTC to noon UTC so the journal
-- calendar buckets each trade on the correct local day. Trades imported
-- before this fix had closed_at = `${day}T00:00:00Z`, which formatted to
-- the previous day in any timezone west of GMT (the user saw trades on
-- Sundays even though the market is closed).
UPDATE "trades"
SET "closed_at" = "closed_at" + INTERVAL '12 hours'
WHERE "closed_at" IS NOT NULL
  AND "closed_at"::time = TIME '00:00:00';
