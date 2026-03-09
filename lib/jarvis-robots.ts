const DEFAULT_ROBOTS_CACHE_TTL_MS = 3_600_000;
const ROBOTS_FETCH_TIMEOUT_MS = 5_000;
const ROBOT_USER_AGENT = 'Nexus-Jarvis';
const ROBOT_USER_AGENT_HEADER = 'Nexus-Jarvis/1.0';

interface ParsedRules {
  allow: string[];
  disallow: string[];
}

interface CachedRobotsRules {
  rulesByAgent: Map<string, ParsedRules>;
  fetchedAt: number;
}

const robotsCache = new Map<string, CachedRobotsRules>();

function getRobotsCacheTtlMs() {
  const value = Number(process.env.JARVIS_ROBOTS_CACHE_TTL_MS);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_ROBOTS_CACHE_TTL_MS;
  return value;
}

function normalizeRulePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === '/') return '/';
  return trimmed.split('*')[0].trim();
}

function parseRobotsTxt(content: string) {
  const rulesByAgent = new Map<string, ParsedRules>();
  let activeAgents: string[] = [];

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const withoutComment = rawLine.split('#', 1)[0]?.trim() ?? '';
    if (!withoutComment) continue;

    const separator = withoutComment.indexOf(':');
    if (separator <= -1) continue;

    const field = withoutComment.slice(0, separator).trim().toLowerCase();
    const value = withoutComment.slice(separator + 1).trim();

    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      if (!agent) {
        activeAgents = [];
        continue;
      }

      const existing = rulesByAgent.get(agent);
      if (!existing) {
        rulesByAgent.set(agent, { allow: [], disallow: [] });
      }

      if (!activeAgents.includes(agent)) {
        activeAgents.push(agent);
      }
      continue;
    }

    if ((field === 'allow' || field === 'disallow') && activeAgents.length > 0) {
      const normalized = normalizeRulePath(value);
      for (const agent of activeAgents) {
        const rules = rulesByAgent.get(agent);
        if (!rules) continue;
        if (field === 'allow') {
          rules.allow.push(normalized);
        } else {
          rules.disallow.push(normalized);
        }
      }
      continue;
    }

    if (field !== 'allow' && field !== 'disallow') {
      activeAgents = [];
    }
  }

  return rulesByAgent;
}

function matchesPrefix(pathname: string, rule: string) {
  if (!rule) return false;
  if (rule === '/') return true;
  return pathname.startsWith(rule);
}

function evaluatePath(pathname: string, rules: ParsedRules) {
  const matchingAllow = rules.allow
    .filter((rule) => matchesPrefix(pathname, rule))
    .sort((a, b) => b.length - a.length)[0] ?? null;
  const matchingDisallow = rules.disallow
    .filter((rule) => matchesPrefix(pathname, rule))
    .sort((a, b) => b.length - a.length)[0] ?? null;

  if (!matchingAllow && !matchingDisallow) return true;
  if (matchingAllow && !matchingDisallow) return true;
  if (!matchingAllow && matchingDisallow) return false;
  return (matchingAllow?.length ?? 0) >= (matchingDisallow?.length ?? 0);
}

async function loadRulesForOrigin(origin: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROBOTS_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': ROBOT_USER_AGENT_HEADER },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (response.status === 404) {
      return new Map<string, ParsedRules>();
    }

    if (!response.ok) {
      return null;
    }

    const content = await response.text();
    return parseRobotsTxt(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isRobotAllowed(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const ttlMs = getRobotsCacheTtlMs();
  const now = Date.now();
  const cached = robotsCache.get(parsed.origin);
  if (cached && now - cached.fetchedAt <= ttlMs) {
    const specific = cached.rulesByAgent.get(ROBOT_USER_AGENT.toLowerCase());
    const wildcard = cached.rulesByAgent.get('*');
    if (specific) return evaluatePath(parsed.pathname, specific);
    if (wildcard) return evaluatePath(parsed.pathname, wildcard);
    return true;
  }

  const rulesByAgent = await loadRulesForOrigin(parsed.origin);
  if (!rulesByAgent) return true;

  robotsCache.set(parsed.origin, {
    rulesByAgent,
    fetchedAt: now,
  });

  const specific = rulesByAgent.get(ROBOT_USER_AGENT.toLowerCase());
  const wildcard = rulesByAgent.get('*');
  if (specific) return evaluatePath(parsed.pathname, specific);
  if (wildcard) return evaluatePath(parsed.pathname, wildcard);
  return true;
}

export function clearRobotsCache(): void {
  robotsCache.clear();
}
