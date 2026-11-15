import { MongoClient, ObjectId, type Db } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  buildServedCorpusScoreboard,
  formatServedCorpusScoreboardReport,
} from '../servedCorpusScoreboardCore';
import {
  countServedReadingsUnconfirmedSinceRefusal,
  loadServedSustainedRefusalReadings,
  parseSustainedRefusalHosts,
  type StoredResearchPageReading,
} from '../servedSustainedRefusalReadings';

const REFUSING_HOST = 'refusing-host.example.org';
const OTHER_HOST = 'answering-host.example.org';
const FIRST_REFUSED_AT = '2026-11-01T00:00:00.000Z';
const BEFORE = new Date('2026-10-20T00:00:00.000Z');
const AFTER = new Date('2026-11-05T00:00:00.000Z');
const flag = {
  firstRefusedAt: FIRST_REFUSED_AT,
  confirmingRefusalAt: '2026-11-15T00:00:00.000Z',
  runs: 3,
};

const reading = (
  entityKey: string,
  urls: string[],
  observedAt: Date = BEFORE,
): StoredResearchPageReading => ({ entityKey, urls, observedAt });

const served = (...slugs: string[]) => ({ ids: new Set<string>(), slugs: new Set(slugs) });

describe('countServedReadingsUnconfirmedSinceRefusal', () => {
  it('counts a served reading drawn only on the flagged host and read before it began refusing', () => {
    const result = countServedReadingsUnconfirmedSinceRefusal({
      flaggedHosts: { [REFUSING_HOST]: flag },
      readings: [
        reading('synthetic-only-refusing', [
          `https://${REFUSING_HOST}/research`,
          `https://www.${REFUSING_HOST}/people/synthetic`,
        ]),
      ],
      served: served('synthetic-only-refusing'),
    });
    expect(result).toEqual([{ host: REFUSING_HOST, ...flag, servedReadingsUnconfirmed: 1 }]);
  });

  it('leaves out a reading that also draws on another host, an unserved row, and one read since', () => {
    const result = countServedReadingsUnconfirmedSinceRefusal({
      flaggedHosts: { [REFUSING_HOST]: flag },
      readings: [
        reading('synthetic-mixed', [`https://${REFUSING_HOST}/a`, `https://${OTHER_HOST}/b`]),
        reading('synthetic-unserved', [`https://${REFUSING_HOST}/a`]),
        reading('synthetic-read-since', [`https://${REFUSING_HOST}/a`], AFTER),
        reading('synthetic-no-pages', []),
      ],
      served: served('synthetic-mixed', 'synthetic-read-since', 'synthetic-no-pages'),
    });
    expect(result).toEqual([{ host: REFUSING_HOST, ...flag, servedReadingsUnconfirmed: 0 }]);
  });

  it("reads only each row's newest reading", () => {
    const result = countServedReadingsUnconfirmedSinceRefusal({
      flaggedHosts: { [REFUSING_HOST]: flag },
      readings: [
        reading('synthetic-moved-on', [`https://${REFUSING_HOST}/old`], new Date('2026-09-01')),
        reading('synthetic-moved-on', [`https://${OTHER_HOST}/new`], BEFORE),
      ],
      served: served('synthetic-moved-on'),
    });
    expect(result[0].servedReadingsUnconfirmed).toBe(0);
  });

  it('counts nothing for a host that is not flagged', () => {
    expect(
      countServedReadingsUnconfirmedSinceRefusal({
        flaggedHosts: {},
        readings: [reading('synthetic-only-refusing', [`https://${REFUSING_HOST}/a`])],
        served: served('synthetic-only-refusing'),
      }),
    ).toEqual([]);
  });
});

describe('parseSustainedRefusalHosts', () => {
  it('keeps well-formed entries and drops malformed ones', () => {
    expect(
      parseSustainedRefusalHosts({
        [REFUSING_HOST]: { ...flag, rowsUnconfirmed: 4 },
        'bad-date.example.org': { ...flag, firstRefusedAt: 'not a date' },
        'no-runs.example.org': {
          firstRefusedAt: FIRST_REFUSED_AT,
          confirmingRefusalAt: FIRST_REFUSED_AT,
        },
      }),
    ).toEqual({ [REFUSING_HOST]: flag });
    expect(parseSustainedRefusalHosts(undefined)).toEqual({});
  });
});

describe('loadServedSustainedRefusalReadings against a synthetic flagged host', () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  const servedFilter = { studentVisibilityTier: 'student_ready', archived: { $ne: true } };
  const servedId = new ObjectId();
  const archivedId = new ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db('synthetic-scoreboard');
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    await db.dropDatabase();
    await db.collection('research_entities').insertMany([
      { _id: servedId, slug: 'synthetic-served-lab', studentVisibilityTier: 'student_ready' },
      {
        _id: archivedId,
        slug: 'synthetic-archived-lab',
        studentVisibilityTier: 'student_ready',
        archived: true,
      },
    ]);
    const pageReading = (entityId: ObjectId, superseded = false) => ({
      entityType: 'researchEntity',
      entityId,
      field: 'researchPageText',
      sourceName: 'research-page-text',
      superseded,
      observedAt: BEFORE,
      value: [{ url: `https://${REFUSING_HOST}/research`, text: 'Synthetic research text.' }],
    });
    await db
      .collection('observations')
      .insertMany([
        pageReading(servedId),
        pageReading(archivedId),
        pageReading(new ObjectId(), true),
      ]);
  });

  const insertRun = (startedAt: string, status: string, sustainedRefusalHosts?: unknown) =>
    db.collection('scrape_runs').insertOne({
      sourceName: 'research-page-text',
      status,
      startedAt: new Date(startedAt),
      metrics: sustainedRefusalHosts ? { sustainedRefusalHosts } : {},
    });

  it('counts the served reading behind a host the newest successful run flags', async () => {
    await insertRun('2026-11-15T00:00:00.000Z', 'success', {
      [REFUSING_HOST]: { ...flag, rowsUnconfirmed: 2 },
    });
    await insertRun('2026-11-16T00:00:00.000Z', 'failure');
    const before = await db.collection('observations').countDocuments();

    const result = await loadServedSustainedRefusalReadings(db, servedFilter);

    expect(result).toEqual({
      runStartedAt: '2026-11-15T00:00:00.000Z',
      hosts: [{ host: REFUSING_HOST, ...flag, servedReadingsUnconfirmed: 1 }],
    });
    expect(await db.collection('observations').countDocuments()).toBe(before);
  });

  it('reports none flagged once the newest successful run no longer flags the host', async () => {
    await insertRun('2026-11-15T00:00:00.000Z', 'success', { [REFUSING_HOST]: flag });
    await insertRun('2026-11-16T00:00:00.000Z', 'success');

    expect(await loadServedSustainedRefusalReadings(db, servedFilter)).toEqual({
      runStartedAt: '2026-11-16T00:00:00.000Z',
      hosts: [],
    });
  });

  it('says so when no research-page-text run has succeeded', async () => {
    expect(await loadServedSustainedRefusalReadings(db, servedFilter)).toEqual({
      runStartedAt: null,
      hosts: [],
    });
  });
});

describe('the scoreboard shows the count', () => {
  const build = (
    sustainedRefusal?: Parameters<typeof buildServedCorpusScoreboard>[0]['sustainedRefusal'],
  ) =>
    buildServedCorpusScoreboard({
      environment: 'development',
      databaseName: 'Development',
      corpus: { researchEntities: 10, studentReadyNotArchived: 5 },
      baseline: [],
      rows: [],
      sustainedRefusal,
    });

  it('prints one line per flagged host with its unconfirmed-since date', () => {
    const report = formatServedCorpusScoreboardReport(
      [
        build({
          runStartedAt: '2026-11-15T00:00:00.000Z',
          hosts: [{ host: REFUSING_HOST, ...flag, servedReadingsUnconfirmed: 3 }],
        }),
      ],
      200,
    );
    expect(report).toMatch(/unconfirmed, sustained refusal\s+\| 3/);
    expect(report).toContain(
      `${REFUSING_HOST}: 3 served readings draw only on it, unconfirmed since ${FIRST_REFUSED_AT}`,
    );
  });

  it('reads none flagged when no host is flagged', () => {
    const report = formatServedCorpusScoreboardReport([build()], 200);
    expect(report).toMatch(/unconfirmed, sustained refusal\s+\| none flagged/);
    expect(report).toContain('no successful research-page-text run found');
  });
});
