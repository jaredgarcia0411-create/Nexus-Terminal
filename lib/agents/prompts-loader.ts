import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentId } from './types';

const PROMPTS_DIR = path.join(process.cwd(), 'lib/agents/prompts');

function readPromptFile(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8');
}

const GLOBAL_POLICY_PROMPT = readPromptFile('global-policy.md');
const JMT_REPORT_FORMAT_PROMPT = readPromptFile('jmt-report-format.md');

const ROLE_PROMPTS: Record<AgentId, string> = {
  orchestrator: readPromptFile('orchestrator.md'),
  'small-cap-trader': readPromptFile('small-cap.md'),
  'swing-trader': readPromptFile('swing-trader.md'),
};

export function loadGlobalPolicyPrompt(): string {
  return GLOBAL_POLICY_PROMPT;
}

export function loadRolePrompt(agentId: AgentId): string {
  return ROLE_PROMPTS[agentId];
}

export function loadJmtFormatPrompt(): string {
  return JMT_REPORT_FORMAT_PROMPT;
}

export function buildLlmSystemPrompt(agentId: AgentId): string {
  const parts = [loadGlobalPolicyPrompt()];

  if (agentId === 'small-cap-trader' || agentId === 'swing-trader') {
    parts.push(JMT_REPORT_FORMAT_PROMPT);
  }

  parts.push(loadRolePrompt(agentId));
  return parts.join('\n\n---\n\n');
}
