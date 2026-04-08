import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { requireServiceAuth, requireServiceKey } from '@/lib/agents/admin';
import { getAgentDb } from '@/lib/agents/db';
import { agentConversations, agentJobs } from '@/lib/db/schema';
import { dbUnavailable, ensureUser } from '@/lib/server-db-utils';
import { serviceChatGetQuerySchema, serviceChatPostSchema } from '@/lib/validations/agents';

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readFailureClass(stepLog: unknown): string | null {
  if (!Array.isArray(stepLog) || stepLog.length === 0) {
    return null;
  }

  const lastEntry = stepLog[stepLog.length - 1];
  if (!lastEntry || typeof lastEntry !== 'object') {
    return null;
  }

  const failureClass = (lastEntry as { errorClass?: unknown }).errorClass;
  return typeof failureClass === 'string' && failureClass.trim() ? failureClass : null;
}

function parseServiceChatQuery(request: Request) {
  const result = serviceChatGetQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!result.success) {
    return {
      error: Response.json(
        { error: 'Validation failed', details: z.flattenError(result.error) },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}

export async function POST(request: Request) {
  try {
    const bodyState = await parseAndValidate(request, serviceChatPostSchema);
    if (bodyState.error) return bodyState.error;

    const authState = requireServiceAuth(request, bodyState.data);
    if (authState instanceof Response) return authState;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const user = await ensureUser(db, authState.user);
    const sessionId = bodyState.data.session_id ?? randomUUID();
    const conversationId = randomUUID();
    const jobId = randomUUID();

    await db.insert(agentConversations).values({
      id: conversationId,
      userId: user.id,
      agentId: 'orchestrator',
      sessionId,
      role: 'user',
      content: bodyState.data.message,
      channel: 'discord',
    });

    await db.insert(agentJobs).values({
      id: jobId,
      agentId: 'orchestrator',
      userId: user.id,
      jobType: 'chat',
      status: 'queued',
      input: {
        message: bodyState.data.message,
        session_id: sessionId,
        channel: 'discord',
        discord_user_id: authState.discordUserId,
      },
      priority: 0,
      maxAttempts: 3,
    });

    return Response.json(
      {
        job_id: jobId,
        session_id: sessionId,
        agent_id: 'orchestrator',
      },
      { status: 201 },
    );
  } catch (error) {
    logRouteError('agents.service-chat.post', error);
    return internalServerError();
  }
}

export async function GET(request: Request) {
  try {
    const queryState = parseServiceChatQuery(request);
    if (queryState.error) return queryState.error;

    const authError = requireServiceKey(request);
    if (authError) return authError;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const [job] = await db.select({
      id: agentJobs.id,
      agentId: agentJobs.agentId,
      status: agentJobs.status,
      progressNote: agentJobs.progressNote,
      input: agentJobs.input,
      result: agentJobs.result,
      errorMessage: agentJobs.errorMessage,
      stepLog: agentJobs.stepLog,
    })
      .from(agentJobs)
      .where(eq(agentJobs.id, queryState.data.job_id))
      .limit(1);

    if (!job) {
      return Response.json({ error: 'job not found' }, { status: 404 });
    }

    const input = readRecord(job.input);
    const result = readRecord(job.result);

    if (job.status === 'queued') {
      return Response.json({
        status: 'queued',
        job_id: job.id,
        agent_id: job.agentId,
        progress_note: null,
      });
    }

    if (job.status === 'processing') {
      return Response.json({
        status: 'processing',
        job_id: job.id,
        agent_id: job.agentId,
        progress_note: job.progressNote,
      });
    }

    if (job.status === 'completed') {
      if (result.routed === true) {
        return Response.json({
          status: 'completed',
          job_id: job.id,
          agent_id: job.agentId,
          result: {
            routed: true,
            specialistJobId:
              typeof result.specialistJobId === 'string' ? result.specialistJobId : null,
          },
        });
      }

      const sessionId = typeof result.session_id === 'string'
        ? result.session_id
        : typeof input.session_id === 'string'
          ? input.session_id
          : null;
      const message = typeof result.content === 'string'
        ? result.content
        : typeof result.message === 'string'
          ? result.message
          : '';

      return Response.json({
        status: 'completed',
        job_id: job.id,
        agent_id: job.agentId,
        session_id: sessionId,
        result: {
          message,
        },
      });
    }

    return Response.json({
      status: 'failed',
      job_id: job.id,
      agent_id: job.agentId,
      error: {
        message: job.errorMessage,
        failureClass: readFailureClass(job.stepLog),
      },
    });
  } catch (error) {
    logRouteError('agents.service-chat.get', error);
    return internalServerError();
  }
}
