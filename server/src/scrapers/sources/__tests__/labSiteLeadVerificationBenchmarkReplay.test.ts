import axios, { type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import {
  beginBenchmarkCapture,
  beginBenchmarkReplay,
  finishBenchmarkCaptureWithCoverage,
  finishBenchmarkReplay,
  isBenchmarkModeActive,
} from '../../snapshotBenchmarkMode';
import { readLabSite } from '../labSiteLeadVerificationScraper';

const PUBLIC_SITE = 'https://public-lab.example.edu/';
const PRIVATE_SITE = 'http://internal-lab.example.edu/';
const RESOLVER_OUTAGE_SITE = 'https://flaky-lab.example.edu/';

const PUBLIC_HOME =
  '<html><body><h1>Example Lab</h1><p>Principal Investigator Ada Example</p></body></html>';

const dnsError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const resolveLikeTheCapture = (hostname: string) => {
  if (hostname === 'internal-lab.example.edu') return [{ address: '10.0.0.5', family: 4 }];
  if (hostname === 'flaky-lab.example.edu') throw dnsError('EAI_AGAIN');
  return [{ address: '93.184.216.34', family: 4 }];
};

const servePublicHome: AxiosAdapter = async (config) => ({
  data: PUBLIC_HOME,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});

async function readEach(sites: readonly string[]) {
  const readings = [];
  for (const site of sites) readings.push(await readLabSite(site, true));
  return readings;
}

async function captureReadings(sites: readonly string[]) {
  beginBenchmarkCapture();
  const readings = await readEach(sites);
  return { readings, ...finishBenchmarkCaptureWithCoverage() };
}

async function replayReadings(
  sites: readonly string[],
  pages: Parameters<typeof beginBenchmarkReplay>[0],
) {
  beginBenchmarkReplay(pages);
  const readings = await readEach(sites);
  return { readings, ...finishBenchmarkReplay() };
}

describe('lab-site lead verification replays only what its capture froze (#4251)', () => {
  const liveAdapter = axios.defaults.adapter;

  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockImplementation(async (hostname: string) => resolveLikeTheCapture(hostname));
    axios.defaults.adapter = servePublicHome;
  });

  afterEach(() => {
    axios.defaults.adapter = liveAdapter;
    expect(isBenchmarkModeActive()).toBe(false);
  });

  it('serves a frozen site on replay with no miss and no network request', async () => {
    const capture = await captureReadings([PUBLIC_SITE]);
    expect(capture.readings[0]?.html).toContain('Ada Example');

    lookupMock.mockClear();
    const replay = await replayReadings([PUBLIC_SITE], capture.pages);

    expect(replay.readings).toEqual(
      capture.readings.map((reading) => ({ ...reading, fromCache: true })),
    );
    expect(replay.pagesMissed).toBe(0);
    expect(replay.networkBlocks).toBe(0);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('refuses on replay a site whose host the capture refused, instead of asking for a page it never froze', async () => {
    const capture = await captureReadings([PRIVATE_SITE]);
    expect(capture.readings).toEqual([null]);
    expect(capture.unfrozenRequestCount).toBe(0);

    lookupMock.mockClear();
    const replay = await replayReadings([PRIVATE_SITE], capture.pages);

    expect(replay.readings).toEqual([null]);
    expect(replay.pagesMissed).toBe(0);
    expect(replay.networkBlocks).toBe(0);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('never freezes a resolver failure, because it describes the moment rather than the host', async () => {
    const capture = await captureReadings([RESOLVER_OUTAGE_SITE]);
    expect(capture.readings).toEqual([null]);
    expect(capture.pages).toEqual([]);
  });
});
