import express from 'express';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '4000', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL);
const backtestQueue = new Queue('backtest', { connection: redis });

interface BacktestRequest {
  symbol: string;
  strategy: string;
  params: Record<string, number>;
  initialCapital: number;
  positionSizePct: number;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

// Submit a backtest job
app.post('/api/backtest', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  const body = req.body as BacktestRequest;
  if (!body.symbol || !body.strategy || !body.candles?.length) {
    return res.status(400).json({ error: 'Missing required fields: symbol, strategy, candles' });
  }

  const jobId = uuidv4();

  await backtestQueue.add('run', {
    jobId,
    userId,
    ...body,
  }, {
    jobId,
    removeOnComplete: { age: 3600 }, // Keep for 1 hour
    removeOnFail: { age: 3600 },
  });

  return res.json({ jobId, status: 'queued' });
});

// Poll for backtest result
app.get('/api/backtest/:jobId', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  const { jobId } = req.params;

  const job = await backtestQueue.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const jobUserId = (job.data as { userId?: string } | undefined)?.userId;
  if (!jobUserId || jobUserId !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const state = await job.getState();

  if (state === 'completed') {
    return res.json({ status: 'completed', result: job.returnvalue });
  }

  if (state === 'failed') {
    return res.json({ status: 'failed', error: job.failedReason });
  }

  return res.json({ status: state });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'backtest-gateway' });
});

app.listen(PORT, () => {
  console.log(`Backtest gateway listening on port ${PORT}`);
});
