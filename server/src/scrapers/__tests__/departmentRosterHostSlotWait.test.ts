import http from 'node:http';
import type { AddressInfo, LookupFunction, Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const loopbackOnly: LookupFunction = (_hostname, options, callback) => {
  if ((options as { all?: boolean }).all) {
    (callback as (err: null, addresses: { address: string; family: number }[]) => void)(null, [
      { address: '127.0.0.1', family: 4 },
    ]);
    return;
  }
  callback(null, '127.0.0.1', 4);
};

vi.mock('../../utils/ssrfGuard', async (importOriginal) => {
  const agents = await import('../../utils/connectDeadlineAgents');
  return {
    ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
    assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
    ssrfSafeAgents: () => ({
      httpAgent: new agents.ConnectDeadlineHttpAgent({ lookup: loopbackOnly }),
      httpsAgent: new agents.ConnectDeadlineHttpsAgent({ lookup: loopbackOnly }),
    }),
  };
});

import { enterDevWriteStoppedMode, resetDevWriteStopForTests } from '../../db/devWriteStop';
import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import {
  HostConcurrencyLimiter,
  installScraperHostConcurrencyInterceptor,
} from '../utils/hostConcurrencyLimiter';
import { installScraperFetchDeadlines } from '../utils/scraperFetchDeadlines';
import type { ScraperContext } from '../types';

const SLOT_WAIT_BOUND_MS = 300;
const ROSTER_HOST = 'roster-fixture.yale.edu';
const PROFILE_HOST = 'profiles-fixture.yale.edu';
const PROFILE_ROWS = 3;

const profileLimiter = new HostConcurrencyLimiter(1, { applyHostOverrides: false });

describe('the official-profile-only roster read when a profile host slot is never freed', () => {
  const sockets = new Set<Socket>();
  let server: http.Server;
  let port: number;
  let profileRequests = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/profile/')) profileRequests += 1;
      res.end('<html><body></body></html>');
    });
    server.on('connection', (socket) => sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
    installScraperFetchDeadlines();
    installScraperHostConcurrencyInterceptor(profileLimiter, {
      acquireTimeoutMs: SLOT_WAIT_BOUND_MS,
    });
  });

  afterEach(() => {
    resetDevWriteStopForTests();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const rosterConfig = (onRosterRead: () => void = () => {}): DeptConfig[] => [
    {
      deptKey: 'fixture-medicine',
      deptName: 'Fixture Medicine',
      schoolName: 'Yale School of Fixtures',
      url: `http://${ROSTER_HOST}:${port}/fixture-medicine/people/faculty/`,
      paginated: false,
      officialProfileOnly: true,
      extractor: vi.fn((): FacultyEntry[] => {
        onRosterRead();
        return Array.from({ length: PROFILE_ROWS }, (_unused, index) => ({
          name: `Fixture Person ${String.fromCharCode(65 + index)}`,
          profileUrl: `http://${PROFILE_HOST}:${port}/profile/row-${index}/`,
        }));
      }),
    },
  ];

  const runRoster = async (config: DeptConfig[]): Promise<string[]> => {
    const scraper = new DepartmentRosterScraper(config, null);
    const logs: string[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      options: { dryRun: true, useCache: false, release: false },
      emit: async () => {},
      log: (message) => {
        logs.push(message);
      },
    };
    await scraper.run(ctx);
    return logs.filter((line) => line.startsWith('[profile] fetch failed'));
  };

  it('fails each profile within the slot-wait bound and finishes the lane', async () => {
    const leaked = await profileLimiter.acquire(PROFILE_HOST);
    try {
      const startedAt = Date.now();
      const failures = await runRoster(rosterConfig());
      const elapsedMs = Date.now() - startedAt;

      expect(failures).toHaveLength(PROFILE_ROWS);
      expect(failures.every((line) => /no host slot/.test(line))).toBe(true);
      expect(elapsedMs).toBeLessThan(PROFILE_ROWS * SLOT_WAIT_BOUND_MS + 5_000);
    } finally {
      leaked();
    }
  }, 15_000);

  it('returns the slot of a fetch refused in stopped mode, so the next profile is refused too', async () => {
    const requestsBefore = profileRequests;
    const failures = await runRoster(rosterConfig(() => enterDevWriteStoppedMode('lost')));

    expect(failures).toHaveLength(PROFILE_ROWS);
    expect(failures.every((line) => /Refused a scraper fetch/.test(line))).toBe(true);
    expect(profileRequests).toBe(requestsBefore);
    expect(profileLimiter.activeCount(PROFILE_HOST)).toBe(0);
  }, 15_000);
});
