# Database and Queue Solutions for Agent Coordination and Job Management Crash Course

**Researched**: 2026-03-23
**Sources**: PostgreSQL 18.3 docs, RabbitMQ tutorials, Redis patterns, Neon pricing docs, Kafka docs, Nexus Terminal AGENTIC_EXPANSION_V2 spec
**Context**: Codebase-specific research for autonomous agent framework in Nexus Terminal

---

## Concept Overview

Agent coordination systems require reliable job queuing, state persistence, and inter-process communication. Three architectural approaches exist: PostgreSQL-as-queue (SKIP LOCKED pattern), dedicated message brokers (Redis/RabbitMQ/Kafka), and hybrid systems. The choice depends on scale, latency requirements, and operational complexity.

## How It Works

Agent systems coordinate through:
1. **Job queuing**: Producers create jobs, consumers claim and process them
2. **State persistence**: Agent memory, session state, and results storage  
3. **Coordination primitives**: Locks, semaphores, leader election for agent coordination
4. **Event pub/sub**: For real-time notifications between agents

## How It Applies Here

Nexus Terminal's AGENTIC_EXPANSION_V2 spec mandates **Postgres as the backbone** — all inter-agent communication, state, memory, and job coordination flows through Postgres. No Redis, message brokers, or new infrastructure. This aligns with the project's existing Drizzle ORM setup and Neon PostgreSQL deployment.

## Codebase Evidence

- `lib/db/schema.ts:109`: Existing `agent_memory` table stores agent context with TTL
- `AGENTIC_EXPANSION_V2.md`: Detailed 6-table schema for agent coordination (agent_registry, agent_jobs, agent_job_steps, agent_memory, agent_reports, agent_state_snapshots)
- Current deployment uses Neon PostgreSQL free tier (100 projects, 100 CU-hrs/month per project, 0.5GB storage per project)

## Technology Comparison

### 1. PostgreSQL SKIP LOCKED Pattern vs Dedicated Queue Systems

**PostgreSQL SKIP LOCKED (Recommended for Nexus Terminal)**
```
-- Dequeue job with FOR UPDATE SKIP LOCKED
WITH next_job AS (
  SELECT id FROM agent_jobs 
  WHERE status = 'queued' 
  AND agent_id = 'small-cap-trader'
  ORDER BY priority DESC, created_at ASC 
  FOR UPDATE SKIP LOCKED 
  LIMIT 1
)
UPDATE agent_jobs 
SET status = 'processing', 
    started_at = NOW(),
    claimed_by = $1
WHERE id = (SELECT id FROM next_job)
RETURNING *;
```
- **Pros**: No new infrastructure, ACID guarantees, joins with agent state, built-in backups
- **Cons**: Higher latency (5-50ms vs <1ms), connection pool limits, table contention at high scale
- **Scale limit**: ~1K-10K jobs/sec on Neon free tier (2 CU, 8GB RAM)

**Redis (Pub/Sub + Lists)**
- **Pros**: Sub-ms latency, high throughput (100K+/sec), rich data structures
- **Cons**: Volatile memory, no joins, separate infrastructure, persistence complexity
- **Use case**: Real-time notifications, ephemeral state, rate limiting

**RabbitMQ (AMQP)**
- **Pros**: Message guarantees, dead letter queues, routing flexibility, mature
- **Cons**: Operational overhead, separate deployment, no SQL queries
- **Use case**: Enterprise workflows, complex routing, guaranteed delivery

**Kafka**
- **Pros**: High throughput, replayability, stream processing, retention policies
- **Cons**: Heavy infrastructure, operational complexity, overkill for small scale
- **Use case**: Event streaming, data pipelines, high-volume log processing

### 2. Neon PostgreSQL Free Tier Limitations for Agent Coordination

**Neon Free Tier (Current Setup)**
- 100 projects (databases) - each agent service = 1 project
- 100 CU-hrs/month per project (Compute Units = ~1 vCPU + 4GB RAM)
- 0.5GB storage per project
- 6-hour time travel/restores
- Autoscaling up to 2 CU (8GB RAM)

**Agent Coordination Impact**
- **Good**: 3 agents (orchestrator, small-cap-trader, long-term-investor) fit within 100 projects
- **Compute**: Each agent idle → scale to zero, only pay for active processing time
- **Storage**: 0.5GB enough for job queue + memory tables (~500K jobs with metadata)
- **Limitation**: 100 CU-hrs = ~4 days continuous 1 CU runtime, or ~13 hours/day at 1 CU
- **Upgrade path**: Launch plan ($0.106/CU-hr, 16 CU max) when scale exceeds free tier

**Alternatives to Neon Free Tier**
- **Supabase**: Similar limits, slightly more generous free tier (500MB storage, 2GB bandwidth)
- **Railway**: $5/month starter, simpler pricing but less Postgres-specific features
- **Self-hosted Postgres**: $0 infrastructure cost, but operational burden, no autoscaling
- **Render**: $7/month for Postgres, includes 1GB storage, predictable pricing

### 3. Connection Pooling Strategies for Multiple Agents

**Neon's Built-in Connection Pooling**
- Uses pgBouncer in transaction pooling mode
- Supports up to 10,000 connections (far beyond agent needs)
- Each agent service should use connection pooling

**Agent Connection Pattern**
```typescript
// Each agent maintains 1-3 persistent connections
import { drizzle } from 'drizzle-orm/neon-http';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Heartbeat every 30s
setInterval(async () => {
  await db.execute(sql`UPDATE agent_registry 
    SET last_heartbeat = NOW(), status = 'online' 
    WHERE id = ${agentId}`);
}, 30000);
```

**Optimization Rules**
1. **One pool per agent process** (not per job)
2. **Max 3 connections per agent** (idle agents use 1)
3. **Use HTTP mode** for reads, WebSocket for transactions
4. **Monitor connection counts** in Neon console

**Scaling Issues**
- Neon Free tier: Max 1 WebSocket connection per project → agents share 1 WS for writes
- Solution: Use HTTP for reads, batch writes, or upgrade to paid plan for more WS connections

### 4. Schema Design Patterns for Agent Coordination

**Nexus Terminal's AGENTIC_EXPANSION_V2 Schema (Recommended)**

```
agent_registry           -- Health tracking
├── id (orchestrator|small-cap-trader|long-term-investor)
├── status (online|offline|degraded)
├── last_heartbeat
└── capabilities (JSONB)

agent_jobs              -- Queue with SKIP LOCKED
├── id (UUID)
├── agent_id (target agent)
├── status (queued|processing|completed|failed)
├── priority (0-10)
├── input (JSONB)
├── output (JSONB)
└── FOR UPDATE SKIP LOCKED pattern

agent_job_steps         -- Blueprint execution tracking
├── job_id
├── step_index
├── step_type (code|llm)
├── status (pending|running|completed|failed)
└── result (JSONB)

agent_memory           -- Existing, extended
├── category (trade_insight|user_preference|strategy_note)
├── key
├── value
├── value_json (JSONB)
└── expires_at (TTL)

agent_reports          -- User review queue
├── job_id
├── status (pending_review|approved|rejected)
├── reviewed_at
└── user_notes

agent_state_snapshots  -- Crash recovery
├── agent_id
├── snapshot (JSONB)
└── created_at
```

**Key Design Decisions**
1. **Composite keys**: `(user_id, id)` for multi-tenancy
2. **JSONB for flexibility**: Input/output/state as JSONB, indexed GIN when queried
3. **TTL via expires_at**: Auto-cleanup via cron job
4. **Blueprints in code**: Step definitions in TypeScript, not DB

### 5. Backup and Migration Strategies for Agent State

**Neon's Built-in Features**
- **Branching**: Instant copies for testing agent changes
- **Time travel**: 6-hour window (free), 7-30 days (paid)
- **Point-in-time recovery**: Restore to any second in retention window

**Agent State Backup Strategy**
1. **Critical state**: Jobs table (recreate from logs if lost)
2. **Important state**: Agent memory (recreate from LLM context if lost)  
3. **Ephemeral state**: Step execution (safe to lose)

**Migration Approach**
```
-- 1. Schema changes via Drizzle migrations
npm run db:generate
npm run db:migrate

-- 2. Data migration scripts
-- Example: Add priority column with default
ALTER TABLE agent_jobs ADD COLUMN priority INTEGER DEFAULT 5;

-- 3. Blueprint versioning
agent_jobs.blueprint_version TEXT DEFAULT '1.0.0'
```

**Disaster Recovery Plan**
1. **Neon restore**: From latest branch or time travel point
2. **Export/Import**: `pg_dump` critical tables weekly
3. **Replay capability**: Jobs can be recreated from audit logs

### 6. SKIP LOCKED Implementation Details

**PostgreSQL Locking for Job Queues**
```sql
-- Optimal SKIP LOCKED pattern
UPDATE agent_jobs
SET status = 'processing',
    started_at = NOW(),
    claimed_by = $agent_id
WHERE id = (
  SELECT id FROM agent_jobs
  WHERE status = 'queued'
    AND agent_id = $target_agent
    AND (scheduled_at IS NULL OR scheduled_at <= NOW())
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

**Index Requirements**
```sql
CREATE INDEX idx_agent_jobs_dequeue ON agent_jobs 
  (agent_id, status, priority DESC, created_at)
  WHERE status = 'queued';
```

**Concurrency Notes**
- Multiple agents can run same SELECT → SKIP LOCKED prevents double-processing
- Deadlock risk low with simple UPDATE pattern
- Use `NOWAIT` for timeout control: `FOR UPDATE SKIP LOCKED NOWAIT`

## Code Examples

### Basic Agent Job Queue Implementation

```typescript
// lib/agent/queue.ts
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { agentJobs } from '@/lib/db/schema';

export async function claimNextJob(db: Db, agentId: string) {
  // SKIP LOCKED pattern via raw SQL
  const result = await db.execute(sql`
    UPDATE agent_jobs
    SET status = 'processing',
        started_at = NOW(),
        claimed_by = ${agentId}
    WHERE id = (
      SELECT id FROM agent_jobs
      WHERE status = 'queued'
        AND agent_id = ${agentId}
        AND (scheduled_at IS NULL OR scheduled_at <= NOW())
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  
  return result.rows[0] || null;
}

export async function completeJob(db: Db, jobId: string, output: any) {
  await db.update(agentJobs)
    .set({
      status: 'completed',
      completedAt: new Date(),
      output: output,
      executionTimeMs: sql`EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000`
    })
    .where(eq(agentJobs.id, jobId));
}
```

### Agent Coordination Service

```typescript
// services/agent-orchestrator/src/coordinator.ts
export class AgentCoordinator {
  private db: Db;
  private agentId: string;
  
  constructor(agentId: string) {
    this.agentId = agentId;
    this.db = drizzle(process.env.DATABASE_URL!);
  }
  
  async run() {
    // Heartbeat
    setInterval(() => this.heartbeat(), 30000);
    
    // Job processing loop
    while (true) {
      const job = await claimNextJob(this.db, this.agentId);
      if (!job) {
        await sleep(1000); // Poll interval
        continue;
      }
      
      try {
        const result = await this.processJob(job);
        await completeJob(this.db, job.id, result);
        
        // Create report for user review
        await this.createReport(job, result);
      } catch (error) {
        await this.failJob(job.id, error);
      }
    }
  }
}
```

## Best Practices

1. **Stick with Postgres SKIP LOCKED** for Nexus Terminal - aligns with existing stack, no new infra
2. **Design for idempotency** - jobs should be replayable if failed
3. **Use Neon's branching** for testing agent changes before production
4. **Monitor CU usage** - scale down agents when idle (scale to zero)
5. **Implement dead letter queue** - move stuck jobs to manual review
6. **Version your blueprints** - track changes to job processing logic
7. **Log comprehensively** - each job step should be auditable

## Common Pitfalls

**Pitfall**: Not indexing the dequeue query, causing full table scans
**Solution**: Create composite index `(agent_id, status, priority DESC, created_at)` with partial WHERE clause

**Pitfall**: Agents holding connections open indefinitely
**Solution**: Use connection pooling with idle timeout, implement heartbeat to detect dead agents

**Pitfall**: Job state inconsistency after crashes
**Solution**: Use agent_state_snapshots table, implement job timeouts (mark stuck jobs as failed after X minutes)

**Pitfall**: Neon free tier connection limits blocking multiple agents
**Solution**: Upgrade to Launch plan ($0.106/CU-hr) when running 3+ agents with WebSocket transactions

## Recommended Default Approach

For Nexus Terminal's autonomous agent framework:

1. **PostgreSQL SKIP LOCKED** pattern for job queue (no Redis/RabbitMQ)
2. **Neon Launch plan** ($0.106/CU-hr) from day one - free tier too limiting for 3 agents
3. **Connection pooling** with 3 connections per agent max
4. **Schema as defined in AGENTIC_EXPANSION_V2.md** with 6 tables
5. **Backup via Neon time travel** + weekly pg_dump exports
6. **Monitor CU usage** in Neon console, set autoscaling limits

**Rationale**: This uses existing infrastructure (Drizzle, Neon), minimizes operational complexity, and provides adequate scale for small team usage. The 100 CU-hr free tier limit would be exhausted quickly with 3 constantly polling agents.

## Action Checklist

- [ ] Implement `agent_jobs` table with SKIP LOCKED pattern in `lib/db/schema.ts`
- [ ] Create job queue utilities in `lib/agent/queue.ts`
- [ ] Set up Neon Launch plan ($15-30/month estimated)
- [ ] Build agent coordinator service with heartbeat
- [ ] Implement blueprint engine for job steps
- [ ] Add user review queue interface to web UI
- [ ] Set up monitoring for CU usage and job throughput

## Known Unknowns

- Exact throughput limits of Neon free tier for SKIP LOCKED queries
- Whether 100 CU-hrs/month is sufficient for proof-of-concept with 3 agents
- Latency impact of HTTP vs WebSocket connections for job processing
- Optimal poll interval for agents (1s vs 5s vs 10s)

## Related Topics

- Drizzle ORM migration patterns
- Neon PostgreSQL branching workflows  
- Docker Compose for multi-agent deployment
- LLM cost optimization for agent steps

## Follow-up Questions

*To continue learning, use: `/research more about [Topic]` or ask follow-up questions*

---