import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const LINK_PREVIEW_AGENTS = [
  'facebookexternalhit',
  'Twitterbot',
  'LinkedInBot',
  'Discordbot',
  'Slackbot-LinkExpanding',
];
const SEARCH_ENGINE_AGENTS = ['Googlebot', 'Bingbot', 'DuckDuckBot', 'GPTBot'];
const SAMPLE_PATHS = ['/', '/research', '/research/synthetic-entity', '/about'];

interface RobotsRule {
  allow: boolean;
  path: string;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
}

const parseRobotsGroups = (text: string): RobotsGroup[] => {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
      }
      current.userAgents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  return groups;
};

const groupFor = (groups: RobotsGroup[], userAgent: string): RobotsGroup | undefined => {
  const token = userAgent.toLowerCase();
  return (
    groups.find((group) => group.userAgents.includes(token)) ??
    groups.find((group) => group.userAgents.includes('*'))
  );
};

const isAllowed = (group: RobotsGroup | undefined, path: string): boolean => {
  const matching = (group?.rules ?? []).filter((rule) => rule.path && path.startsWith(rule.path));
  if (matching.length === 0) return true;
  const longest = Math.max(...matching.map((rule) => rule.path.length));
  return matching.some((rule) => rule.path.length === longest && rule.allow);
};

describe('crawler policy', () => {
  const groups = parseRobotsGroups(readFileSync(join(CLIENT_ROOT, 'public', 'robots.txt'), 'utf8'));

  it.each(LINK_PREVIEW_AGENTS)('lets the %s link preview fetcher read every page', (agent) => {
    const group = groupFor(groups, agent);
    expect(group?.userAgents).toContain(agent.toLowerCase());
    for (const path of SAMPLE_PATHS) {
      expect(isAllowed(group, path), `${agent} is refused ${path}`).toBe(true);
    }
  });

  it.each(SEARCH_ENGINE_AGENTS)('keeps the %s crawler out of every page', (agent) => {
    const group = groupFor(groups, agent);
    expect(group?.userAgents).toEqual(['*']);
    for (const path of SAMPLE_PATHS) {
      expect(isAllowed(group, path), `${agent} may read ${path}`).toBe(false);
    }
  });

  it('keeps the noindex, nofollow robots meta tag in the html shell', () => {
    const document = new DOMParser().parseFromString(
      readFileSync(join(CLIENT_ROOT, 'index.html'), 'utf8'),
      'text/html',
    );
    const robotsMeta = [...document.head.querySelectorAll('meta[name="robots"]')];
    expect(robotsMeta).toHaveLength(1);
    expect(robotsMeta[0].getAttribute('content')).toBe('noindex, nofollow');
  });
});
