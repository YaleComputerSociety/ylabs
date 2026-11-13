import { describe, expect, it } from 'vitest';

import {
  ROBOTS_CRAWL_DELAY_MAX_MS,
  ROBOTS_PRODUCT_TOKEN,
  ROBOTS_TXT_MAX_BYTES,
  parseRobotsTxt,
  robotsAllows,
} from '../robotsTxt';

const DRUPAL_7_DEFAULT = `
# robots.txt
User-agent: *
Crawl-delay: 10
# Directories
Disallow: /includes/
Disallow: /misc/
Disallow: /modules/
# Paths (clean URLs)
Disallow: /admin/
Disallow: /search/
Disallow: /user/login/
# Paths (no clean URLs)
Disallow: /?q=admin/
Disallow: /?q=search/
`;

describe('parseRobotsTxt', () => {
  it('reads a Drupal 7 default: its Disallow lines and a 10 s Crawl-delay for every agent', () => {
    const policy = parseRobotsTxt(DRUPAL_7_DEFAULT);

    expect(policy.crawlDelayMs).toBe(10_000);
    expect(robotsAllows(policy, '/people/faculty')).toBe(true);
    expect(robotsAllows(policy, '/search/node?keys=kelp')).toBe(false);
    expect(robotsAllows(policy, '/?q=admin/config')).toBe(false);
    expect(robotsAllows(policy, '/robots.txt')).toBe(true);
  });

  it('uses the group naming our product token instead of the * group', () => {
    const policy = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: ${ROBOTS_PRODUCT_TOKEN}
Disallow: /private/
Crawl-delay: 3
`);

    expect(robotsAllows(policy, '/research')).toBe(true);
    expect(robotsAllows(policy, '/private/notes')).toBe(false);
    expect(policy.crawlDelayMs).toBe(3_000);
  });

  it('matches our product token case-insensitively and merges every group naming it', () => {
    const policy = parseRobotsTxt(`
User-agent: OtherBot
User-agent: ${ROBOTS_PRODUCT_TOKEN.toUpperCase()}
Disallow: /a/

User-agent: ${ROBOTS_PRODUCT_TOKEN}
Disallow: /b/
`);

    expect(robotsAllows(policy, '/a/x')).toBe(false);
    expect(robotsAllows(policy, '/b/x')).toBe(false);
    expect(robotsAllows(policy, '/c/x')).toBe(true);
  });

  it('allows everything when no group names us or *', () => {
    const policy = parseRobotsTxt('User-agent: OtherBot\nDisallow: /\n');

    expect(robotsAllows(policy, '/anything')).toBe(true);
  });

  it('lets the longest rule decide, and an allow win a tie', () => {
    const policy = parseRobotsTxt(`
User-agent: *
Disallow: /people/
Allow: /people/faculty/
Disallow: /tie
Allow: /tie
`);

    expect(robotsAllows(policy, '/people/staff/a')).toBe(false);
    expect(robotsAllows(policy, '/people/faculty/a')).toBe(true);
    expect(robotsAllows(policy, '/tie')).toBe(true);
  });

  it('honours * wildcards and the $ end anchor', () => {
    const policy = parseRobotsTxt(`
User-agent: *
Disallow: /*.pdf$
Disallow: /*/print
`);

    expect(robotsAllows(policy, '/files/cv.pdf')).toBe(false);
    expect(robotsAllows(policy, '/files/cv.pdf?download=1')).toBe(true);
    expect(robotsAllows(policy, '/news/item/print')).toBe(false);
    expect(robotsAllows(policy, '/news/item')).toBe(true);
  });

  it('treats an empty Disallow as allowing everything', () => {
    expect(robotsAllows(parseRobotsTxt('User-agent: *\nDisallow:\n'), '/x')).toBe(true);
  });

  it('clamps a Crawl-delay to 10 s, ignores an unreadable one, and keeps the larger of two', () => {
    expect(parseRobotsTxt('User-agent: *\nCrawl-delay: 120\n').crawlDelayMs).toBe(
      ROBOTS_CRAWL_DELAY_MAX_MS,
    );
    expect(parseRobotsTxt('User-agent: *\nCrawl-delay: soon\n').crawlDelayMs).toBeUndefined();
    expect(
      parseRobotsTxt('User-agent: *\nCrawl-delay: 2\n\nUser-agent: *\nCrawl-delay: 4.5\n')
        .crawlDelayMs,
    ).toBe(4_500);
  });

  it('matches percent-encoded and plain spellings of the same path', () => {
    const policy = parseRobotsTxt('User-agent: *\nDisallow: /caf%C3%A9/\n');

    expect(robotsAllows(policy, '/café/menu')).toBe(false);
  });

  it('ignores anything past the size RFC 9309 asks crawlers to read', () => {
    const padding = '#'.repeat(ROBOTS_TXT_MAX_BYTES);
    const policy = parseRobotsTxt(`User-agent: *\n${padding}\nDisallow: /late/\n`);

    expect(robotsAllows(policy, '/late/x')).toBe(true);
  });
});
