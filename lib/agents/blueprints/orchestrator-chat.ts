import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { agentConversations, agentJobs, agentRegistry } from '@/lib/db/schema';
import { callLlm } from '@/lib/agents/llm-client';
import type { AgentId, Blueprint, MacroSummaryReport, StepResult } from '@/lib/agents/types';

const RESEARCH_COMMAND = /^\s*\/research\s+/;
const SWING_COMMAND = /^\s*\/(?:swing|momentum)\s+/;
const SMALL_CAP_KEYWORDS = /\b(dilution|offering|ATM|shelf|424B|S-3|short[- ]sell)\b/i;
const SWING_KEYWORDS = /\b(MDR|multi[- ]day[- ]runner|parabolic|momentum|breakout)\b/i;
const TICKER_PATTERN = /\b[A-Z]{1,5}\b/g;
const SLASH_COMMAND_PREFIX = /^\s*\/(?:research|swing|momentum)\s+/i;

const chatInputSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  channel: z.enum(['web', 'discord']).default('discord'),
});

const routeDecisionSchema = z.object({
  decision: z.enum(['handle-directly', 'route-to-specialist', 'fallback-to-self']),
  targetAgentId: z.enum(['orchestrator', 'small-cap-trader', 'swing-trader']).nullable(),
  specialistJobType: z.enum(['research']).nullable(),
  specialistJobId: z.string().nullable(),
  warning: z.string().nullable(),
  message: z.string(),
});

type RouteDecision = z.infer<typeof routeDecisionSchema>;

function completedResult<T>(
  data: T,
  options?: {
    durationMs?: number;
    tokensUsed?: number;
    sourceIds?: string[];
    upstreamStepIds?: string[];
    model?: string;
    artifacts?: Record<string, unknown>;
  },
): StepResult<T> {
  return {
    status: 'completed',
    data,
    ...(options?.artifacts ? { artifacts: options.artifacts } : {}),
    metrics: {
      durationMs: options?.durationMs ?? 0,
      ...(options?.tokensUsed === undefined ? {} : { tokensUsed: options.tokensUsed }),
      attempt: 1,
    },
    provenance: {
      sourceIds: options?.sourceIds ?? [],
      ...(options?.model ? { model: options.model } : {}),
      upstreamStepIds: options?.upstreamStepIds ?? [],
      timestamp: new Date().toISOString(),
    },
  };
}

function classifyTargetAgent(message: string): Extract<AgentId, 'small-cap-trader' | 'swing-trader'> | null {
  if (RESEARCH_COMMAND.test(message)) {
    return 'small-cap-trader';
  }

  if (SWING_COMMAND.test(message)) {
    return 'swing-trader';
  }

  if (SMALL_CAP_KEYWORDS.test(message)) {
    return 'small-cap-trader';
  }

  if (SWING_KEYWORDS.test(message)) {
    return 'swing-trader';
  }

  return null;
}

function extractTicker(message: string): string | null {
  const trimmedMessage = message.trim();
  const commandBody = trimmedMessage.replace(SLASH_COMMAND_PREFIX, '');
  const searchText = commandBody !== trimmedMessage ? commandBody : trimmedMessage;
  const matches = searchText.match(TICKER_PATTERN) ?? [];

  if (matches.length === 0) {
    return null;
  }

  return commandBody !== trimmedMessage
    ? matches[matches.length - 1] ?? null
    : matches[0] ?? null;
}

async function loadOrchestratorSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('@/lib/agents/prompts-loader');
  return buildLlmSystemPrompt('orchestrator');
}

function formatRecentTrades(trades: unknown[]): string {
  return trades
    .map((trade) => {
      if (!trade || typeof trade !== 'object') return null;
      const t = trade as Record<string, unknown>;
      const symbol = t.symbol ?? t.ticker ?? '???';
      const pnl = typeof t.grossPnl === 'number' ? t.grossPnl : (typeof t.pnl === 'number' ? t.pnl : null);
      const direction = typeof t.direction === 'string' ? t.direction.toLowerCase() : '?';
      const date = typeof t.date === 'string' ? t.date : '';
      const pnlStr = pnl !== null
        ? (pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`)
        : 'n/a';
      return `${symbol}: ${pnlStr} (${direction}${date ? `, ${date}` : ''})`;
    })
    .filter(Boolean)
    .join('\n');
}

function formatMacroContext(macro: MacroSummaryReport): string {
  const drivers = Array.isArray(macro.drivers) ? macro.drivers : [];
  const deskImplications = Array.isArray(macro.deskImplications) ? macro.deskImplications : [];
  const lines = [
    `Bias: ${macro.marketBias} (${macro.confidence} confidence)`,
    `Summary: ${typeof macro.summary === 'string' ? macro.summary : ''}`,
    drivers.length > 0
      ? `Drivers: ${drivers.map((driver) => `${driver.driver} (${driver.impact})`).join('; ')}`
      : null,
    deskImplications.length > 0
      ? `Desk: ${deskImplications.join('; ')}`
      : null,
  ];

  return lines.filter(Boolean).join('\n');
}

function buildSynthesisPrompt(
  route: RouteDecision,
  chatInput: z.infer<typeof chatInputSchema>,
  context: {
    conversationHistory: unknown[];
    macroSummary: MacroSummaryReport | null;
    recentTrades: unknown[];
  },
): string {
  const sections = [
    `Channel: ${chatInput.channel}`,
    route.warning ? `Warning: ${route.warning}` : null,
    `User message:\n${chatInput.message.trim()}`,
    context.macroSummary ? `Latest macro summary:\n${formatMacroContext(context.macroSummary)}` : null,
    context.recentTrades.length > 0
      ? `Recent trades:\n${formatRecentTrades(context.recentTrades.slice(0, 5))}`
      : null,
    context.conversationHistory.length > 0
      ? `Recent conversation:\n${JSON.stringify(context.conversationHistory.slice(0, 5))}`
      : null,
    'Respond with plain prose text directly to the user. Keep it concise and actionable.',
    'IMPORTANT: Do NOT wrap your response in JSON. Do NOT use code fences. Return plain text only.',
  ];

  return sections.filter(Boolean).join('\n\n');
}

export const orchestratorChatBlueprint: Blueprint = {
  id: 'orchestrator:chat',
  description: 'V1 Orchestrator chat — deterministic routing + self-synthesis fallback.',
  steps: [
    {
      name: 'classify-and-route',
      type: 'code',
      inputSchema: chatInputSchema,
      outputSchema: routeDecisionSchema,
      metadata: { canRetry: true, timeoutMs: 5000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput, job, db }) => {
        const startedAt = Date.now();
        const chatInput = chatInputSchema.parse(jobInput);
        const trimmedMessage = chatInput.message.trim();
        const targetAgentId = classifyTargetAgent(trimmedMessage);

        if (!targetAgentId) {
          return completedResult<RouteDecision>({
            decision: 'handle-directly',
            targetAgentId: null,
            specialistJobType: null,
            specialistJobId: null,
            warning: null,
            message: trimmedMessage,
          }, {
            durationMs: Date.now() - startedAt,
          });
        }

        const [registryRow] = await db.select({
          status: agentRegistry.status,
        })
          .from(agentRegistry)
          .where(eq(agentRegistry.id, targetAgentId))
          .limit(1);

        const status = typeof registryRow?.status === 'string' && registryRow.status.trim()
          ? registryRow.status
          : 'offline';

        if (status !== 'online') {
          return completedResult<RouteDecision>({
            decision: 'fallback-to-self',
            targetAgentId,
            specialistJobType: 'research',
            specialistJobId: null,
            warning: `${targetAgentId} is ${status}, handling request directly`,
            message: trimmedMessage,
          }, {
            durationMs: Date.now() - startedAt,
            sourceIds: [`agent-registry:${targetAgentId}`],
          });
        }

        const specialistJobId = randomUUID();
        const specialistJobInput = {
          ticker: extractTicker(trimmedMessage),
          originator_job_id: job.id,
          origin_channel_id: chatInput.channel,
        };
        await db.insert(agentJobs).values({
          id: specialistJobId,
          agentId: targetAgentId,
          userId: job.userId,
          jobType: 'research',
          status: 'queued',
          input: specialistJobInput,
        });

        return completedResult<RouteDecision>({
          decision: 'route-to-specialist',
          targetAgentId,
          specialistJobType: 'research',
          specialistJobId,
          warning: null,
          message: 'routed',
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [`agent-registry:${targetAgentId}`],
        });
      },
    },
    {
      name: 'synthesize-response',
      type: 'llm',
      inputSchema: routeDecisionSchema,
      outputSchema: z.object({ content: z.string().min(1) }),
      metadata: {
        canRetry: true,
        timeoutMs: 30000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'interactive',
        skipWhenRouted: true,
      },
      run: async ({ jobInput, previousOutput, context, db, job }) => {
        const chatInput = chatInputSchema.parse(jobInput);
        const route = routeDecisionSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadOrchestratorSystemPrompt(),
          userMessage: buildSynthesisPrompt(route, chatInput, context),
          temperature: 0.3,
        }, 'interactive');

        let content = llmResponse.content;

        // Guard: if the LLM returned JSON despite prose instructions, extract the text
        if (content.startsWith('{') || content.startsWith('```')) {
          try {
            const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
            const jsonStr = fenceMatch ? fenceMatch[1] ?? content : content;
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
            const extracted = parsed.content ?? parsed.response ?? parsed.message ?? parsed.text;
            if (typeof extracted === 'string' && extracted.trim().length > 0) {
              content = extracted.trim();
            }
          } catch {
            // Not valid JSON — use raw content as-is
          }
        }

        await db.insert(agentConversations).values({
          id: randomUUID(),
          userId: job.userId,
          agentId: 'orchestrator',
          sessionId: chatInput.session_id ?? job.id,
          role: 'assistant',
          content,
          channel: chatInput.channel,
        });

        return completedResult({
          content,
        }, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['classify-and-route'],
          artifacts: {
            inputTokens: llmResponse.inputTokens,
            outputTokens: llmResponse.outputTokens,
            modelUsed: llmResponse.modelUsed,
          },
        });
      },
    },
  ],
};
