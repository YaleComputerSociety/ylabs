import { SCRAPER_USER_AGENT } from './scraperUserAgent';

/** RFC 9309 asks crawlers to read at least 500 KiB of a robots.txt; anything past it is ignored. */
export const ROBOTS_TXT_MAX_BYTES = 500 * 1024;
export const ROBOTS_CRAWL_DELAY_MAX_MS = 10_000;

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelayMs?: number;
  /** True when the policy is the fail-open default for an unreadable robots.txt. */
  unavailable?: boolean;
}

export const ALLOW_ALL_ROBOTS_POLICY: RobotsPolicy = { rules: [] };

/** The product token robots.txt groups are matched against: the first word of our User-Agent. */
export const ROBOTS_PRODUCT_TOKEN = SCRAPER_USER_AGENT.split(/[\s/]/)[0].toLowerCase();

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelayMs?: number;
}

const crawlDelayMs = (value: string): number | undefined => {
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(ROBOTS_CRAWL_DELAY_MAX_MS, Math.round(seconds * 1000));
};

function parseGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let collectingAgents = false;
  for (const rawLine of text.slice(0, ROBOTS_TXT_MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    if (!current) continue;
    collectingAgents = false;
    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
      else if (key === 'disallow') current.rules.push({ allow: true, pattern: '' });
    } else if (key === 'crawl-delay') {
      const delay = crawlDelayMs(value);
      if (delay !== undefined) current.crawlDelayMs = delay;
    }
  }
  return groups;
}

const agentMatches = (agent: string, token: string): boolean =>
  agent !== '*' && (agent === token || token.startsWith(agent) || agent.startsWith(token));

/**
 * The rules a robots.txt sets for us: every group naming our product token, merged, or else every
 * `*` group, merged (RFC 9309 §2.2.1). A file with neither leaves everything allowed.
 */
export function parseRobotsTxt(text: string, token: string = ROBOTS_PRODUCT_TOKEN): RobotsPolicy {
  const groups = parseGroups(text);
  const wanted = token.toLowerCase();
  const named = groups.filter((group) => group.agents.some((agent) => agentMatches(agent, wanted)));
  const chosen = named.length > 0 ? named : groups.filter((group) => group.agents.includes('*'));
  const delays = chosen.flatMap((group) =>
    group.crawlDelayMs === undefined ? [] : [group.crawlDelayMs],
  );
  return {
    rules: chosen.flatMap((group) => group.rules.filter((rule) => rule.pattern !== '')),
    ...(delays.length > 0 ? { crawlDelayMs: Math.max(...delays) } : {}),
  };
}

const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split('*').map(escapeRegExp).join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

const normalizedPath = (pathWithQuery: string): string => {
  const path = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  try {
    return encodeURI(decodeURI(path));
  } catch {
    return path;
  }
};

/**
 * Whether a path may be fetched: the longest matching rule decides, and an allow wins a tie
 * (RFC 9309 §2.2.2). `/robots.txt` itself is always allowed.
 */
export function robotsAllows(policy: RobotsPolicy, pathWithQuery: string): boolean {
  const path = normalizedPath(pathWithQuery);
  if (path === '/robots.txt') return true;
  let best: RobotsRule | undefined;
  for (const rule of policy.rules) {
    if (!patternMatches(normalizedPath(rule.pattern), path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
