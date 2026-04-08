import {
  orchestratorChatBlueprint,
} from './blueprints/orchestrator-chat';
import {
  orchestratorMacroSummaryBlueprint,
} from './blueprints/orchestrator-macro-summary';
import {
  smallCapResearchBlueprint,
} from './blueprints/small-cap-research';
import {
  swingTraderResearchBlueprint,
} from './blueprints/swing-trader-research';
import {
  NotImplementedBlueprintError,
} from './types';
import type {
  AgentConfig,
  AgentId,
  AgentJob,
  Blueprint,
} from './types';

function notImplementedBlueprint(name: string): Blueprint {
  return {
    id: name,
    description: `Blueprint stub for ${name}.`,
    steps: [{
      name: 'not-implemented',
      type: 'code',
      metadata: {
        canRetry: false,
        timeoutMs: 1000,
        maxRepairAttempts: 0,
        sideEffect: false,
      },
      run: async () => {
        throw new NotImplementedBlueprintError(name);
      },
    }],
  };
}

function resolveFromCapabilities(agentId: AgentId, job: AgentJob): Blueprint {
  const config = AGENT_CONFIGS[agentId];
  if (!config.capabilities.includes(job.jobType)) {
    throw new Error(`agent ${agentId} does not support ${job.jobType}`);
  }

  const blueprint = config.blueprints[job.jobType];
  if (!blueprint) {
    throw new Error(`missing blueprint for ${agentId}/${job.jobType}`);
  }

  return blueprint;
}

export const AGENT_CONFIGS: Record<AgentId, AgentConfig> = {
  orchestrator: {
    id: 'orchestrator',
    displayName: 'Orchestrator',
    llmLane: 'interactive',
    temperature: 0.3,
    capabilities: ['chat', 'macro-summary'],
    rolePromptPath: 'lib/agents/prompts/orchestrator.md',
    blueprints: {
      chat: orchestratorChatBlueprint,
      'macro-summary': orchestratorMacroSummaryBlueprint,
    },
    blueprintResolver: (job) => resolveFromCapabilities('orchestrator', job),
  },
  'small-cap-trader': {
    id: 'small-cap-trader',
    displayName: 'Small Cap Trader',
    llmLane: 'background',
    temperature: 0.2,
    capabilities: ['research', 'pre-market-scan'],
    rolePromptPath: 'lib/agents/prompts/small-cap.md',
    blueprints: {
      research: smallCapResearchBlueprint,
      'pre-market-scan': notImplementedBlueprint('small-cap-trader:pre-market-scan'),
    },
    blueprintResolver: (job) => resolveFromCapabilities('small-cap-trader', job),
  },
  'swing-trader': {
    id: 'swing-trader',
    displayName: 'Swing Trader',
    llmLane: 'background',
    temperature: 0.2,
    capabilities: ['research', 'momentum-scan', 'pattern-check'],
    rolePromptPath: 'lib/agents/prompts/swing-trader.md',
    blueprints: {
      research: swingTraderResearchBlueprint,
      'momentum-scan': notImplementedBlueprint('swing-trader:momentum-scan'),
      'pattern-check': notImplementedBlueprint('swing-trader:pattern-check'),
    },
    blueprintResolver: (job) => resolveFromCapabilities('swing-trader', job),
  },
};

export function resolveBlueprint(job: AgentJob): Blueprint {
  const config = AGENT_CONFIGS[job.agentId as AgentId];
  if (!config) {
    throw new Error(`unknown agent: ${job.agentId}`);
  }

  return config.blueprintResolver(job);
}
