import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Source } from '../../models/source';
import { resolveAllFields } from '../confidenceResolver';
import { buildObservationFingerprint } from '../observationStore';
import { ScraperOrchestrator } from '../orchestrator';
import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';

beforeEach(clearC4Flags);

const SOURCE_NAME = 'dept-faculty-roster';
const OFFICIAL_ORIGIN = 'https://chem.yale.edu';

const listing = { name: 'Quill Ledgerton', title: '' };

const rosterPage = (): string =>
  `<html><body><main><ul><li><a class="person" href="/people/quill-ledgerton">${listing.name}</a><span class="title">${listing.title}</span></li></ul></main></body></html>`;

const rosterExtractor = (html: string): FacultyEntry[] => {
  const $ = cheerio.load(html);
  return $('li')
    .toArray()
    .map((item) => ({
      name: $(item).find('a.person').text().trim(),
      profileUrl: `${OFFICIAL_ORIGIN}${$(item).find('a.person').attr('href')}`,
      title: $(item).find('.title').text().trim() || undefined,
    }));
};

const config = (): DeptConfig[] => [
  {
    deptKey: 'chemistry',
    deptName: 'Chemistry',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: `${OFFICIAL_ORIGIN}/people/faculty`,
    paginated: false,
    extractor: rosterExtractor,
  },
];

type LiveTyping = { entityKey: string; value: string; observationFingerprint?: string };

describe('dept-faculty-roster types a person by their own listed title (#5750), live', () => {
  let replSet: MongoMemoryReplSet;
  let server: http.Server;
  let localOrigin = '';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      if (path === '/people/faculty') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(rosterPage());
      }
      res.writeHead(404);
      return res.end('');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    localOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'sources', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    await Source.create({
      name: SOURCE_NAME,
      displayName: 'Department faculty rosters',
      defaultWeight: 0.7,
    });
  });

  const throughLocalServer = async (url: string): Promise<string> => {
    const response = await fetch(url.replace(OFFICIAL_ORIGIN, localOrigin));
    return response.ok ? response.text() : '';
  };

  const scrape = async (): Promise<void> => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(
      new DepartmentRosterScraper(config(), null, throughLocalServer, async () => new Map()),
    );
    await orchestrator.run(SOURCE_NAME, {
      dryRun: false,
      useCache: false,
      release: false,
      ignoreWorkPlanner: true,
    });
  };

  const liveTypings = async (): Promise<LiveTyping[]> =>
    Observation.find({
      sourceName: SOURCE_NAME,
      entityType: 'user',
      field: 'userType',
      superseded: false,
    }).lean<LiveTyping[]>();

  const resolvedUserType = async (entityKey: string) => {
    const observations = await Observation.find({
      entityType: 'user',
      entityKey,
      superseded: false,
    }).lean<any[]>();
    return resolveAllFields(observations).userType;
  };

  it('types a person whose own title is a staff role as staff, not faculty', async () => {
    listing.title = 'Senior Administrative Assistant';
    await scrape();

    const typings = await liveTypings();
    expect(typings.map((typing) => typing.value)).toEqual(['staff']);
  });

  it('keeps faculty for a title that states a faculty appointment beside a staff role', async () => {
    listing.title = 'Associate Professor of Chemistry; Program Manager';
    await scrape();

    expect((await liveTypings()).map((typing) => typing.value)).toEqual(['faculty']);
  });

  it('replaces the faculty typing an earlier read stamped, and a second run changes nothing', async () => {
    listing.title = 'Financial Analyst';
    await scrape();
    const [first] = await liveTypings();
    const entityKey = first.entityKey;
    await Observation.updateMany(
      { sourceName: SOURCE_NAME, entityType: 'user', entityKey, field: 'userType' },
      {
        $set: {
          value: 'faculty',
          observationFingerprint: buildObservationFingerprint({
            sourceName: `${SOURCE_NAME}-pre-5750`,
            entityType: 'user',
            entityKey,
            field: 'userType',
            value: 'faculty',
          }),
        },
      },
    );
    expect((await resolvedUserType(entityKey))?.value).toBe('faculty');

    await scrape();
    const afterFix = await liveTypings();
    expect(afterFix.map((typing) => typing.value)).toEqual(['staff']);
    const resolved = await resolvedUserType(entityKey);
    expect(resolved?.value).toBe('staff');
    expect(resolved?.hasConflict).toBe(false);

    await scrape();
    const rerun = await liveTypings();
    expect(rerun.map((typing) => typing.value)).toEqual(['staff']);
    expect((await resolvedUserType(entityKey))?.value).toBe('staff');
  });
});
