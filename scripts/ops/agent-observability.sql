-- name: queue-depth
-- Eligible queued jobs awaiting a worker.
SELECT count(*) AS queued_jobs
FROM agent_jobs
WHERE status = 'queued'
  AND (next_retry_at IS NULL OR next_retry_at <= now());

-- name: oldest-queued-job-age
-- Age (seconds) of the oldest eligible queued job.
SELECT extract(epoch FROM (now() - min(created_at)))::int AS oldest_age_seconds
FROM agent_jobs
WHERE status = 'queued'
  AND (next_retry_at IS NULL OR next_retry_at <= now());

-- name: stuck-processing
-- Jobs in processing past lease expiry or with stale heartbeat.
-- Threshold = 10 × JOB_LEASE_HEARTBEAT_INTERVAL_MS.
-- With JOB_LEASE_HEARTBEAT_INTERVAL_MS = 60s in lib/agents/worker.ts:23, the stale-heartbeat threshold is 10 minutes.
SELECT id, agent_id, locked_by, lock_expires_at, last_heartbeat_at
FROM agent_jobs
WHERE status = 'processing'
  AND (lock_expires_at < now() OR last_heartbeat_at < now() - interval '10 minutes');

-- name: missed-macro-summary
-- Today's macro-summary scheduled run row, if present.
-- `agent_scheduled_runs.trading_date` is stored as ISO `YYYY-MM-DD` text in the live schema/runtime.
-- Zero rows after the configured cron hour means the run was missed.
SELECT id, status, started_at, completed_at, job_id
FROM agent_scheduled_runs
WHERE agent_id = 'orchestrator'
  AND trigger_type = 'macro-summary'
  AND trading_date = to_char((now() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD');

-- name: delivery-failures-by-day
-- Failed Discord deliveries grouped by UTC day, last 7 days.
SELECT date_trunc('day', created_at) AS day, count(*) AS failed_deliveries
FROM agent_reports
WHERE status = 'delivery_failed'
  AND created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- name: agent-heartbeat-freshness
-- Last heartbeat per agent and the seconds since.
SELECT id, status, last_heartbeat,
       extract(epoch FROM (now() - last_heartbeat))::int AS seconds_since_heartbeat
FROM agent_registry
ORDER BY id;

-- name: token-totals-today
-- Token usage and cost by lane, current UTC day.
SELECT lane,
       sum(input_tokens + output_tokens) AS total_tokens,
       sum(estimated_cost_cents) AS total_cost_cents,
       count(*) AS total_requests
FROM agent_request_log
WHERE created_at >= date_trunc('day', now())
GROUP BY lane;
