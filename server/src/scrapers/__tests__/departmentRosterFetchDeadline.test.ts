import http from 'node:http';
import type { AddressInfo, LookupFunction, Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import {
  installScraperFetchDeadlines,
  type ScraperFetchDeadlineHandle,
} from '../utils/scraperFetchDeadlines';
import type { ObservationInput, ScraperContext } from '../types';

const LANE_DEADLINE_MS = 400;
const FAKE_HOST = 'medicine.yale.edu';

const profilePage = (url: string, name: string): string => `
  <html><head><link rel="canonical" href="${url}"></head><body>
    <main id="page-container">
      <article class="profile-details" aria-label="${name}'s profile">
        <h1 class="person-title">${name}</h1>
        <div class="professional-title">Professor of Fixture Studies</div>
      </article>
    </main>
  </body></html>`;

describe('a dept-faculty-roster run whose profile host stops answering', () => {
  const sockets = new Set<Socket>();
  let server: http.Server;
  let origin: string;
  let deadlines: ScraperFetchDeadlineHandle;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/profile/stalled-fixture/') return;
      if (req.url === '/profile/trickled-fixture/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        const drip = setInterval(() => res.write('<p>'), 50);
        req.on('close', () => clearInterval(drip));
        return;
      }
      if (req.url === '/profile/answered-fixture/') {
        res.end(profilePage(`${origin}/profile/answered-fixture/`, 'Answered Fixture'));
        return;
      }
      res.end('<html><body></body></html>');
    });
    server.on('connection', (socket) => sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    origin = `http://${FAKE_HOST}:${(server.address() as AddressInfo).port}`;
    deadlines = installScraperFetchDeadlines(undefined, {
      overallDeadlineMs: () => LANE_DEADLINE_MS,
    });
  });

  afterAll(async () => {
    deadlines.detach();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const rosterConfig = (): DeptConfig[] => [
    {
      deptKey: 'fixture-medicine',
      deptName: 'Fixture Medicine',
      schoolName: 'Yale School of Fixtures',
      url: `${origin}/fixture-medicine/people/faculty/`,
      paginated: false,
      officialProfileOnly: true,
      extractor: vi.fn((): FacultyEntry[] => [
        { name: 'Stalled Fixture', profileUrl: `${origin}/profile/stalled-fixture/` },
        { name: 'Trickled Fixture', profileUrl: `${origin}/profile/trickled-fixture/` },
        { name: 'Answered Fixture', profileUrl: `${origin}/profile/answered-fixture/` },
      ]),
    },
  ];

  it('records each unanswered profile as a fetch failure and still reads the rest', async () => {
    const scraper = new DepartmentRosterScraper(rosterConfig(), null);
    const emitted: ObservationInput[] = [];
    const logs: string[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (message) => {
        logs.push(message);
      },
    };

    const startedAt = Date.now();
    await scraper.run(ctx);
    const elapsedMs = Date.now() - startedAt;

    const failures = logs.filter((line) => line.startsWith('[profile] fetch failed'));
    expect(failures).toHaveLength(2);
    expect(failures.every((line) => /overall deadline/.test(line))).toBe(true);
    expect(
      emitted.some(
        (o) => o.field === 'title' && o.sourceUrl === `${origin}/profile/answered-fixture/`,
      ),
    ).toBe(true);
    expect(elapsedMs).toBeLessThan(10_000);
  }, 15_000);
});
