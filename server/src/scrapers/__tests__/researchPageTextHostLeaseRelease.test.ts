import { MongoClient, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DEV_WRITE_LEASE_COLLECTION,
  DEV_WRITE_LEASE_OWNER_ENV,
  acquireDevWriteLease,
  armDevHostLeases,
  ensureDevHostLease,
  releaseHeldDevWriteLeases,
  resetDevWriteLeaseStateForTests,
  setDevWriteLeaseRuntimeForTests,
  type DevWriteLeaseRecord,
} from '../../db/devWriteLease';
import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ScraperContext } from '../types';
import { RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';

const FIRST_HOST = 'first-host.example.edu';
const SECOND_HOST = 'second-host.example.edu';
const LEASE_ON: NodeJS.ProcessEnv = { DEV_WRITE_OWNER: 'test-session' };

let memoryServer: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const lease = (host: string) =>
  db
    .collection<DevWriteLeaseRecord>(DEV_WRITE_LEASE_COLLECTION)
    .findOne({ _id: `development:host:${host}` });

const page = (url: string) => ({
  url,
  html: `<html><body><h1>Research</h1><p>We study how coastal kelp forests recover after marine heatwaves, and the group shares its survey data openly with the community.</p></body></html>`,
});

const rowOn = (host: string, index: number): CandidateDescriptionLab => {
  const url = `https://${host}/lab-${index}/`;
  return {
    _id: String(index).padStart(24, '0'),
    slug: `synthetic-lab-${index}`,
    name: `Synthetic Lab ${index}`,
    websiteUrl: url,
    sourceUrls: [url],
    entityType: 'LAB',
  };
};

const context = (): ScraperContext => ({
  scrapeRunId: 'test-run',
  sourceId: 'test-source',
  sourceName: RESEARCH_PAGE_TEXT_SOURCE,
  sourceWeight: 0.85,
  options: { dryRun: false, useCache: false, release: false, sourceConcurrency: 1 },
  emit: async () => undefined,
  log: () => undefined,
});

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  client = await MongoClient.connect(memoryServer.getUri());
});

afterAll(async () => {
  await client?.close();
  await memoryServer?.stop();
});

beforeEach(async () => {
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  process.env.DEV_WRITE_OWNER = 'test-session';
  db = client.db('Development');
  await db.dropDatabase();
  setDevWriteLeaseRuntimeForTests({ log: () => undefined, stop: () => undefined });
  armDevHostLeases(
    { db, databaseName: db.databaseName, host: 'cluster.example.net' },
    'scrape run research-page-text',
    LEASE_ON,
  );
});

afterEach(async () => {
  await releaseHeldDevWriteLeases();
  resetDevWriteLeaseStateForTests();
  delete process.env[DEV_WRITE_LEASE_OWNER_ENV];
  delete process.env.DEV_WRITE_OWNER;
});

describe('research-page-text host leases', () => {
  it('hands a finished host back mid-run while another host is still being read', async () => {
    const seenWhileReadingSecondHost: Array<Record<string, unknown>> = [];
    const fetchPage = async (url: string) => {
      const host = new URL(url).hostname;
      await ensureDevHostLease(host);
      if (host === SECOND_HOST && seenWhileReadingSecondHost.length === 0) {
        const first = await lease(FIRST_HOST);
        const otherLane = await acquireDevWriteLease(
          { name: `host:${FIRST_HOST}`, command: 'another lane' },
          { db, env: {}, newOwnerId: () => 'another-lane' },
        );
        seenWhileReadingSecondHost.push({
          firstLocked: first?.locked,
          firstReleaseReason: first?.releaseReason,
          secondLocked: (await lease(SECOND_HOST))?.locked,
          otherLaneAcquired: otherLane.acquired,
        });
        await otherLane.release();
      }
      return page(url);
    };
    const lane = new ResearchPageTextScraper({
      fetchPage,
      rowFinder: async () => [
        rowOn(FIRST_HOST, 1),
        rowOn(FIRST_HOST, 2),
        rowOn(SECOND_HOST, 3),
        rowOn(SECOND_HOST, 4),
        rowOn(SECOND_HOST, 5),
      ],
      storedHashLoader: async () => undefined,
      citerCountsLoader: async () => new Map(),
    });

    await lane.run(context());

    expect(seenWhileReadingSecondHost).toEqual([
      {
        firstLocked: false,
        firstReleaseReason: 'host-done',
        secondLocked: true,
        otherLaneAcquired: true,
      },
    ]);
  });

  it('leaves the stop and end-of-run cleanup to release every host still held', async () => {
    const lane = new ResearchPageTextScraper({
      fetchPage: async (url: string) => {
        await ensureDevHostLease(new URL(url).hostname);
        if (new URL(url).hostname === SECOND_HOST) throw new Error('the run is stopped');
        return page(url);
      },
      rowFinder: async () => [rowOn(FIRST_HOST, 1), rowOn(SECOND_HOST, 2)],
      storedHashLoader: async () => undefined,
      citerCountsLoader: async () => new Map(),
      releaseFinishedHost: async () => undefined,
    });

    await lane.run(context());
    expect(await lease(FIRST_HOST)).toMatchObject({ locked: true });
    expect(await lease(SECOND_HOST)).toMatchObject({ locked: true });

    await releaseHeldDevWriteLeases();
    expect(await lease(FIRST_HOST)).toMatchObject({ locked: false });
    expect(await lease(SECOND_HOST)).toMatchObject({ locked: false });
  });
});
