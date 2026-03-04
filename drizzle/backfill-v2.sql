-- Backfill v2 trade analytics columns from legacy fields.
-- Idempotent by design: only rows that still look un-migrated are updated.
-- Run only after migration 0005 has been applied.
--
-- Optional dry-run checks before/after:
-- SELECT count(*) AS candidate_rows
-- FROM trades
-- WHERE (execution_count = 1 AND COALESCE(executions, 1) <> 1)
--    OR (net_pnl = 0 AND pnl <> 0)
--    OR (gross_pnl = 0 AND (pnl <> 0 OR COALESCE(commission, 0) <> 0 OR COALESCE(fees, 0) <> 0))
--    OR entry_time IS NULL
--    OR exit_time IS NULL;
--
-- SELECT user_id, id, pnl, gross_pnl, net_pnl, commission, fees, execution_count, executions
-- FROM trades
-- WHERE (execution_count = 1 AND COALESCE(executions, 1) <> 1)
--    OR (net_pnl = 0 AND pnl <> 0)
--    OR (gross_pnl = 0 AND (pnl <> 0 OR COALESCE(commission, 0) <> 0 OR COALESCE(fees, 0) <> 0))
-- LIMIT 25;

UPDATE trades
SET
  execution_count = CASE
    WHEN execution_count = 1 AND COALESCE(executions, 1) <> 1 THEN COALESCE(executions, 1)
    ELSE execution_count
  END,
  net_pnl = CASE
    WHEN net_pnl = 0 AND pnl <> 0 THEN pnl
    ELSE net_pnl
  END,
  gross_pnl = CASE
    WHEN gross_pnl = 0 THEN pnl + COALESCE(commission, 0) + COALESCE(fees, 0)
    ELSE gross_pnl
  END,
  entry_time = COALESCE(entry_time, ''),
  exit_time = COALESCE(exit_time, '')
WHERE
  (execution_count = 1 AND COALESCE(executions, 1) <> 1)
  OR (net_pnl = 0 AND pnl <> 0)
  OR (gross_pnl = 0 AND (pnl <> 0 OR COALESCE(commission, 0) <> 0 OR COALESCE(fees, 0) <> 0))
  OR entry_time IS NULL
  OR exit_time IS NULL;
