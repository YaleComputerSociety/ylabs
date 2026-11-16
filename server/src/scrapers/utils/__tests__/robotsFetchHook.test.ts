import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PRIVATE_HOSTS = new Set(['169.254.169.254', 'metadata.internal']);

const SSRF_SAFE_AGENTS = vi.hoisted(() => ({
  httpAgent: { ssrfSafe: 'http' },
  httpsAgent: { ssrfSafe: 'https' },
}));

vi.mock('../../../utils/ssrfGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/ssrfGuard')>();
  return {
    ...actual,
    assertPublicHttpUrl: async (raw: string) => {
      const url = new URL(raw);
      if (PRIVATE_HOSTS.has(url.hostname)) {
        throw new actual.SsrfBlockedError('blocked', 'private-address');
      }
      return url;
    },
    ssrfSafeAgents: () => SSRF_SAFE_AGENTS,
  };
});

import { resolveHostThrottle } from '../hostConcurrencyLimiter';
import { HostPausedError } from '../hostPausedError';
import { resetHostCrawlDelaysForTests } from '../hostThrottlePolicy';
import { machineHostBudgetFor } from '../machineHostBudget';
import { isRefusedBeforeSending } from '../httpFetch';
import { isNotObserved } from '../notObserved';
import {
  installRobotsPolicyInterceptor,
  RobotsDisallowedError,
  ROBOTS_TXT_FETCH_KEY,
} from '../robotsFetchHook';
import { resetRobotsPolicyCacheForTests } from '../robotsPolicyCache';

const ROBOTS_BY_HOST: Record<string, string | Error> = {
  'polite.example.edu': 'User-agent: *\nDisallow: /private/\nCrawl-delay: 30\n',
  'open.example.edu': 'User-agent: *\nAllow: /\n',
  'broken.example.edu': new Error('connect ECONNRESET'),
  'www.split.example.edu': 'User-agent: *\nDisallow: /private/\n',
  'query.example.edu': 'User-agent: *\nDisallow: /*?print=\n',
  'paused.example.edu': 'User-agent: *\nDisallow: /private/\n',
  'brief.example.edu': 'User-agent: *\nCrawl-delay: 1\n',
};

const pausedHosts = new Set<string>();

const sent: string[] = [];
const robotsRequestConfigs: InternalAxiosRequestConfig[] = [];

const stubNetwork: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const url = new URL(String(config.url));
  sent.push(`${url.hostname}${url.pathname}`);
  if (url.pathname === '/robots.txt') robotsRequestConfigs.push(config);
  if (url.pathname === '/robots.txt' && url.hostname === 'redirecting.example.edu') {
    return {
      data: '',
      status: 302,
      statusText: 'Found',
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      config,
    };
  }
  if (url.pathname === '/robots.txt') {
    const robots = ROBOTS_BY_HOST[url.hostname];
    if (robots instanceof Error) throw robots;
    if (robots === undefined) {
      return { data: '', status: 404, statusText: 'Not Found', headers: {}, config };
    }
    return { data: robots, status: 200, statusText: 'OK', headers: {}, config };
  }
  return { data: 'page', status: 200, statusText: 'OK', headers: {}, config };
};

const DEFAULTS = { concurrency: 4, minIntervalMs: 0 };

let originalAdapter: typeof axios.defaults.adapter;

beforeAll(() => {
  originalAdapter = axios.defaults.adapter;
  axios.defaults.adapter = stubNetwork;
  installRobotsPolicyInterceptor();
  axios.interceptors.request.use((config) => {
    const host = new URL(String(config.url)).hostname;
    const isRobotsFetch = (config as unknown as Record<string, unknown>)[ROBOTS_TXT_FETCH_KEY];
    if (isRobotsFetch && pausedHosts.has(host)) {
      throw new HostPausedError({ host, until: new Date(Date.now() + 60_000) });
    }
    return config;
  });
});

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

beforeEach(() => {
  sent.length = 0;
  robotsRequestConfigs.length = 0;
  pausedHosts.clear();
  resetRobotsPolicyCacheForTests();
  resetHostCrawlDelaysForTests();
});

describe('the robots.txt hook (#6213)', () => {
  it('refuses a disallowed path before sending it, as a request that observed nothing', async () => {
    const failure = await axios.get('https://polite.example.edu/private/page').catch((e) => e);

    expect(failure).toBeInstanceOf(RobotsDisallowedError);
    expect(isNotObserved(failure)).toBe(true);
    expect(isRefusedBeforeSending(failure)).toBe(true);
    expect(sent).toEqual(['polite.example.edu/robots.txt']);
  });

  it('sends an allowed path after reading robots.txt once', async () => {
    await axios.get('https://polite.example.edu/public/one');
    await axios.get('https://polite.example.edu/public/two');

    expect(sent).toEqual([
      'polite.example.edu/robots.txt',
      'polite.example.edu/public/one',
      'polite.example.edu/public/two',
    ]);
  });

  it('lengthens the host spacing by its Crawl-delay, clamped to 10 seconds, in both budgets', async () => {
    await axios.get('https://polite.example.edu/public/one');

    expect(resolveHostThrottle('polite.example.edu', DEFAULTS).minIntervalMs).toBe(10_000);
    expect(machineHostBudgetFor('polite.example.edu').minIntervalMs).toBe(10_000);
  });

  it('never lets a Crawl-delay shorter than the floor shorten it', async () => {
    await axios.get('https://brief.example.edu/page');

    expect(
      resolveHostThrottle('brief.example.edu', { concurrency: 1, minIntervalMs: 1_500 }),
    ).toEqual({ concurrency: 1, minIntervalMs: 1_500 });
    expect(machineHostBudgetFor('brief.example.edu').minIntervalMs).toBeGreaterThanOrEqual(1_000);
  });

  it('reads robots.txt over the SSRF-safe agents and follows no redirect itself', async () => {
    await axios.get('https://open.example.edu/page');

    expect(robotsRequestConfigs).toHaveLength(1);
    const [config] = robotsRequestConfigs;
    expect(config.httpAgent).toEqual(SSRF_SAFE_AGENTS.httpAgent);
    expect(config.httpsAgent).toEqual(SSRF_SAFE_AGENTS.httpsAgent);
    expect(config.maxRedirects).toBe(0);
  });

  it('never sends a robots.txt request to a private address a redirect points at', async () => {
    await axios.get('https://redirecting.example.edu/page');

    expect(sent).toEqual(['redirecting.example.edu/robots.txt', 'redirecting.example.edu/page']);
    expect(sent.some((entry) => entry.startsWith('169.254.169.254'))).toBe(false);
  });

  it('never checks robots.txt for a machine API host', async () => {
    await axios.get('https://api.nsf.gov/services/v1/awards.json');

    expect(sent).toEqual(['api.nsf.gov/services/v1/awards.json']);
  });

  it('never checks robots.txt for a request that is not a page read', async () => {
    await axios.post('https://polite.example.edu/private/search', { q: 'x' });

    expect(sent).toEqual(['polite.example.edu/private/search']);
  });

  it('falls back to default pacing and allows the request when robots.txt cannot be read', async () => {
    await axios.get('https://broken.example.edu/anything');

    expect(sent).toEqual(['broken.example.edu/robots.txt', 'broken.example.edu/anything']);
    expect(resolveHostThrottle('broken.example.edu', DEFAULTS).minIntervalMs).toBe(0);
  });

  it('treats a host with no robots.txt as allowing everything', async () => {
    await axios.get('https://missing.example.edu/private/page');

    expect(sent).toEqual(['missing.example.edu/robots.txt', 'missing.example.edu/private/page']);
  });

  it('never applies robots.txt to a model API host the scraper does not crawl', async () => {
    await axios.get('https://api.openai.com/v1/models');

    expect(sent).toEqual(['api.openai.com/v1/models']);
  });

  it('reads robots.txt from the www host that was requested, not the bare domain', async () => {
    const failure = await axios.get('https://www.split.example.edu/private/page').catch((e) => e);

    expect(failure).toBeInstanceOf(RobotsDisallowedError);
    expect(sent).toEqual(['www.split.example.edu/robots.txt']);
  });

  it('matches Disallow rules against query parameters passed separately from the URL', async () => {
    const failure = await axios
      .get('https://query.example.edu/search', { params: { print: '1' } })
      .catch((e) => e);

    expect(failure).toBeInstanceOf(RobotsDisallowedError);
    expect(sent).toEqual(['query.example.edu/robots.txt']);
  });

  it('asks robots.txt again once a host pause that refused the read has cleared', async () => {
    pausedHosts.add('paused.example.edu');
    const whilePaused = await axios.get('https://paused.example.edu/private/page').catch((e) => e);
    expect(whilePaused).toBeInstanceOf(HostPausedError);
    expect(sent).toEqual([]);

    pausedHosts.clear();
    const afterPause = await axios.get('https://paused.example.edu/private/page').catch((e) => e);

    expect(afterPause).toBeInstanceOf(RobotsDisallowedError);
    expect(sent).toEqual(['paused.example.edu/robots.txt']);
  });
});
