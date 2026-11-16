import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ROBOTS_POLICY_TTL_MS,
  ROBOTS_UNAVAILABLE_TTL_MS,
  resetRobotsPolicyCacheForTests,
  robotsPolicyFor,
  type RobotsTxtFetcher,
} from '../robotsPolicyCache';
import { robotsAllows } from '../robotsTxt';
import { HostPausedError } from '../hostPausedError';

afterEach(() => resetRobotsPolicyCacheForTests());

const fetcher = (outcome: Awaited<ReturnType<RobotsTxtFetcher>>) =>
  vi.fn<RobotsTxtFetcher>(async () => outcome);

describe('robotsPolicyFor', () => {
  it('reads a host robots.txt at most once a day, under its www spelling too', async () => {
    let at = 0;
    const fetchRobots = fetcher({ status: 200, body: 'User-agent: *\nDisallow: /private/\n' });

    const first = await robotsPolicyFor('www.dept.example.edu', fetchRobots, () => at);
    at += ROBOTS_POLICY_TTL_MS - 1;
    await robotsPolicyFor('dept.example.edu', fetchRobots, () => at);
    expect(fetchRobots).toHaveBeenCalledTimes(1);
    expect(fetchRobots).toHaveBeenCalledWith('www.dept.example.edu');
    expect(robotsAllows(first, '/private/x')).toBe(false);

    at += 1;
    await robotsPolicyFor('dept.example.edu', fetchRobots, () => at);
    expect(fetchRobots).toHaveBeenCalledTimes(2);
  });

  it('shares one read between concurrent callers', async () => {
    const fetchRobots = fetcher({ status: 200, body: '' });

    await Promise.all([1, 2, 3].map(() => robotsPolicyFor('dept.example.edu', fetchRobots)));

    expect(fetchRobots).toHaveBeenCalledTimes(1);
  });

  it('allows everything when robots.txt is missing, for a day', async () => {
    let at = 0;
    const fetchRobots = fetcher({ status: 404, body: '' });

    const policy = await robotsPolicyFor('dept.example.edu', fetchRobots, () => at);
    at += ROBOTS_UNAVAILABLE_TTL_MS + 1;
    await robotsPolicyFor('dept.example.edu', fetchRobots, () => at);

    expect(robotsAllows(policy, '/anything')).toBe(true);
    expect(policy.unavailable).toBeUndefined();
    expect(fetchRobots).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server error', { status: 503, body: '' }],
    ['a throttle', { status: 429, body: '' }],
    [
      'a refused connection',
      { error: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) },
    ],
  ])(
    'falls back to default pacing on %s and asks again in an hour, never treating it as a refusal',
    async (_label, outcome) => {
      let at = 0;
      const fetchRobots = fetcher(outcome as Awaited<ReturnType<RobotsTxtFetcher>>);

      const policy = await robotsPolicyFor('dept.example.edu', fetchRobots, () => at);
      expect(policy).toMatchObject({ rules: [], unavailable: true });
      expect(policy.crawlDelayMs).toBeUndefined();

      at += ROBOTS_UNAVAILABLE_TTL_MS;
      await robotsPolicyFor('dept.example.edu', fetchRobots, () => at);
      expect(fetchRobots).toHaveBeenCalledTimes(2);
    },
  );

  it('falls back the same way when the fetcher itself throws', async () => {
    const fetchRobots = vi.fn<RobotsTxtFetcher>(async () => {
      throw new Error('timeout of 10000ms exceeded');
    });

    await expect(robotsPolicyFor('dept.example.edu', fetchRobots)).resolves.toMatchObject({
      unavailable: true,
    });
  });

  it('rethrows a refusal from our own hooks and caches nothing, since robots.txt was never asked', async () => {
    const paused = new HostPausedError({ host: 'dept.example.edu', until: new Date(60_000) });
    const fetchRobots = vi
      .fn<RobotsTxtFetcher>()
      .mockResolvedValueOnce({ error: paused })
      .mockResolvedValueOnce({ status: 200, body: 'User-agent: *\nDisallow: /private/\n' });

    await expect(robotsPolicyFor('dept.example.edu', fetchRobots)).rejects.toBe(paused);
    const policy = await robotsPolicyFor('dept.example.edu', fetchRobots);

    expect(fetchRobots).toHaveBeenCalledTimes(2);
    expect(robotsAllows(policy, '/private/x')).toBe(false);
  });
});
