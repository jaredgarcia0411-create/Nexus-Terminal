import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

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

const deepResearchSkill = read('codex-skills/nexus-deep-research/SKILL.md');
check(
  !/always use parallel subagents/i.test(deepResearchSkill),
  'codex-skills/nexus-deep-research/SKILL.md should not require parallel subagents for every run.',
);
check(
  !/do not skip delegation/i.test(deepResearchSkill),
  'codex-skills/nexus-deep-research/SKILL.md should allow local-only passes when delegation adds no value.',
);

if (failures.length > 0) {
  console.error('workflow:audit failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('workflow:audit passed');
