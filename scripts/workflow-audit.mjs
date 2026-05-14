import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const includeCrossTool = process.argv.includes('--include-cross-tool');

function read(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

const agentsGuide = read('AGENTS.md');
check(
  agentsGuide.includes('npm run typecheck:services'),
  'AGENTS.md should mention `npm run typecheck:services` for `services/` changes.',
);
check(
  agentsGuide.includes('npm run workflow:audit'),
  'AGENTS.md should mention `npm run workflow:audit` for workflow asset changes.',
);

check(
  agentsGuide.includes('lib/validations/') &&
    !agentsGuide.includes('Schemas live in `lib/validations/trades.ts` and `lib/validations/system.ts`.'),
  'AGENTS.md should describe `lib/validations/` generally instead of claiming only two schema files exist.',
);

const readme = read('README.md');
check(
  !/Discord report import|JARVIS_/i.test(readme),
  'README.md should not reference retired Discord import routes or JARVIS_* env vars.',
);

const validationMatrix = read('docs/VALIDATION_MATRIX.md');
check(
  validationMatrix.includes('npm run typecheck:services') &&
    !/services\/backtest-gateway|services\/backtest-worker/.test(validationMatrix),
  'docs/VALIDATION_MATRIX.md should use `npm run typecheck:services`, not deleted service package paths.',
);

const vercelOpsSkill = read('codex-skills/nexus-vercel-ops/SKILL.md');
check(
  vercelOpsSkill.includes('/api/cron/agent-retention') &&
    vercelOpsSkill.includes('/api/cron/mdr-sweep') &&
    !vercelOpsSkill.includes('/api/discord/cron/sync'),
  'codex-skills/nexus-vercel-ops/SKILL.md should match live vercel.json crons.',
);

for (const skillName of [
  'task-orchestrator',
  'nexus-execute',
  'nexus-status',
  'nexus-debug',
  'nexus-review',
  'nexus-security-audit',
  'nexus-askedgar-debug',
]) {
  check(
    existsSync(path.join(rootDir, 'codex-skills', skillName, 'SKILL.md')),
    `codex-skills/${skillName}/SKILL.md should exist for tracked Codex workflow skills.`,
  );
  check(
    existsSync(path.join(rootDir, 'codex-skills', skillName, 'agents', 'openai.yaml')),
    `codex-skills/${skillName}/agents/openai.yaml should exist for tracked Codex workflow skill metadata.`,
  );
}

const futurePlans = read('docs/FUTURE-PLANS.md');
check(
  futurePlans.includes('/api/cron/agent-retention') &&
    futurePlans.includes('/api/cron/mdr-sweep') &&
    !futurePlans.includes('/api/discord/cron/sync'),
  'docs/FUTURE-PLANS.md staging cron notes should match live vercel.json crons.',
);

const deepResearchSkill = read('codex-skills/nexus-deep-research/SKILL.md');
const deepResearchMetadata = read('codex-skills/nexus-deep-research/agents/openai.yaml');
const deepResearchSubagentPatterns = read('codex-skills/nexus-deep-research/references/subagent-patterns.md');
check(
  !/always use parallel subagents/i.test(deepResearchSkill),
  'codex-skills/nexus-deep-research/SKILL.md should not require parallel subagents for every run.',
);
check(
  !/do not skip delegation/i.test(deepResearchSkill),
  'codex-skills/nexus-deep-research/SKILL.md should allow local-only passes when delegation adds no value.',
);
check(
  !/Every invocation of this skill should use parallel subagents|do not skip delegation/i.test(deepResearchSubagentPatterns),
  'codex-skills/nexus-deep-research/references/subagent-patterns.md should match optional delegation policy.',
);
check(
  !/investigate a topic in parallel|Parallel research/i.test(deepResearchMetadata),
  'codex-skills/nexus-deep-research/agents/openai.yaml should not present parallel work as mandatory.',
);

if (includeCrossTool) {
  const claudeDoc = read('.claude/CLAUDE.md');
  check(
    claudeDoc.includes('`AGENTS.md` is the canonical workflow and repo guidance.'),
    '.claude/CLAUDE.md should declare AGENTS.md as the canonical source.',
  );

  const claudeSettings = JSON.parse(read('.claude/settings.json'));
  const preToolUseEntries = Array.isArray(claudeSettings.hooks?.PreToolUse)
    ? claudeSettings.hooks.PreToolUse
    : [];
  check(
    preToolUseEntries.some((entry) => {
      if (typeof entry.matcher !== 'string') return false;
      return entry.matcher.split('|').includes('MultiEdit');
    }),
    '.claude/settings.json should cover MultiEdit in the pre-write env guard.',
  );

  for (const hookPath of ['.claude/hooks/protect-env.sh', '.claude/hooks/migration-guard.sh']) {
    const hookSource = read(hookPath);
    check(!/\bjq\b/.test(hookSource), `${hookPath} should not depend on jq.`);
  }

  const opencodeCommandsDir = path.join(rootDir, '.opencode', 'commands');
  for (const fileName of readdirSync(opencodeCommandsDir)) {
    if (!fileName.endsWith('.md')) continue;
    const commandBody = read(path.join('.opencode', 'commands', fileName));
    const match = /^agent:\s*([A-Za-z0-9_-]+)\s*$/m.exec(commandBody);
    if (!match) continue;

    const agentName = match[1];
    check(
      existsSync(path.join(rootDir, '.opencode', 'agents', `${agentName}.md`)),
      `.opencode/commands/${fileName} references missing agent "${agentName}".`,
    );
  }

  check(
    !existsSync(path.join(rootDir, '.opencode', 'agents', 'remi.md')),
    '.opencode/agents/remi.md should be removed or archived because it is not Nexus-specific.',
  );
}

if (failures.length > 0) {
  console.error('workflow:audit failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('workflow:audit passed');
