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
import type { ObservationInput } from '../types';
import { ScraperOrchestrator } from '../orchestrator';
import {
  DepartmentRosterScraper,
  pickRosterTitleForRunEnd,
  type DeptConfig,
  type FacultyEntry,
  type HeldRosterTitle,
} from '../sources/departmentRosterScraper';

beforeEach(clearC4Flags);

const SOURCE_NAME = 'dept-faculty-roster';
const OFFICIAL_ORIGIN = 'https://chem.yale.edu';
const PERSON_KEY = 'netid:qt456';

const firstListing = { title: '', fromProfilePage: false };
const secondListing = { title: '' };

const rosterHtml = (title: string): string =>
  `<html><body><main><ul><li><a class="person" href="/people/quill-tamsin">Quill Tamsin</a><span class="title">${title}</span></li></ul></main></body></html>`;

const extractorFor =
  (profileFlag: () => boolean) =>
  (html: string): FacultyEntry[] => {
    const $ = cheerio.load(html);
    return $('li')
      .toArray()
      .map((item) => ({
        name: $(item).find('a.person').text().trim(),
        profileUrl: `${OFFICIAL_ORIGIN}${$(item).find('a.person').attr('href')}`,
        title: $(item).find('.title').text().trim() || undefined,
        email: 'qt456@yale.edu',
        titleFromProfilePage: profileFlag(),
      }));
  };

const chemistry: DeptConfig = {
  deptKey: 'chemistry',
  deptName: 'Chemistry',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: `${OFFICIAL_ORIGIN}/people/faculty`,
  paginated: false,
  extractor: extractorFor(() => firstListing.fromProfilePage),
};

const physics: DeptConfig = {
  deptKey: 'physics',
  deptName: 'Physics',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: `${OFFICIAL_ORIGIN}/people/other`,
  paginated: false,
  extractor: extractorFor(() => false),
};

const held = (
  value: string,
  overrides: Partial<Omit<HeldRosterTitle, 'observation'>> = {},
): HeldRosterTitle => ({
  observation: {
    entityType: 'user',
    entityKey: PERSON_KEY,
    field: 'title',
    value,
  } as ObservationInput,
  fromProfilePage: false,
  fromHomeDepartmentRoster: true,
  ...overrides,
});

describe('pickRosterTitleForRunEnd (#5801)', () => {
  it('emits the person profile read over any listing', () => {
    const pick = pickRosterTitleForRunEnd(
      [held('Professor of Physics'), held('Professor of Chemistry', { fromProfilePage: true })],
      false,
    );
    expect(pick).toMatchObject({ outcome: 'profile' });
    expect(pick.observation?.value).toBe('Professor of Chemistry');
  });

  it('withholds a listing title when the lane holds a stored profile read', () => {
    expect(pickRosterTitleForRunEnd([held('Lecturer')], true)).toEqual({
      outcome: 'withheld-beside-stored-profile-read',
    });
  });

  it('emits one listing title when every listing agrees', () => {
    const pick = pickRosterTitleForRunEnd(
      [held('Professor of Chemistry'), held('Professor of  Chemistry')],
      false,
    );
    expect(pick.outcome).toBe('listing');
  });

  it('lets a faculty appointment outrank a staff listing', () => {
    const pick = pickRosterTitleForRunEnd(
      [held('Department Administrator'), held('Professor of Chemistry')],
      false,
    );
    expect(pick.observation?.value).toBe('Professor of Chemistry');
  });

  it('lets the one home-department listing decide between faculty listings', () => {
    const pick = pickRosterTitleForRunEnd(
      [
        held('Professor of Chemistry'),
        held('Adjunct Professor of Physics', { fromHomeDepartmentRoster: false }),
      ],
      false,
    );
    expect(pick).toMatchObject({ outcome: 'home-department-listing' });
    expect(pick.observation?.value).toBe('Professor of Chemistry');
  });

  it('emits nothing when listings still disagree', () => {
    expect(
      pickRosterTitleForRunEnd(
        [held('Professor of Chemistry'), held('Professor of Physics')],
        false,
      ),
    ).toEqual({ outcome: 'conflicting-listings' });
  });

  it('emits nothing when two profile reads disagree and no home roster decides', () => {
    expect(
      pickRosterTitleForRunEnd(
        [
          held('Professor of Chemistry', {
            fromProfilePage: true,
            fromHomeDepartmentRoster: false,
          }),
          held('Professor of Physics', { fromProfilePage: true, fromHomeDepartmentRoster: false }),
        ],
        false,
      ),
    ).toEqual({ outcome: 'conflicting-profile-reads' });
  });
});

describe('pickRosterTitleForRunEnd across runs (#6345)', () => {
  it('withholds a staff-only listing while the lane holds a live faculty title', () => {
    expect(pickRosterTitleForRunEnd([held('Laboratory Manager')], false, true)).toEqual({
      outcome: 'withheld-beside-live-faculty-title',
    });
  });

  it('still emits a listing that states a faculty appointment', () => {
    const pick = pickRosterTitleForRunEnd([held('Lecturer in Chemistry')], false, true);
    expect(pick.outcome).toBe('listing');
    expect(pick.observation?.value).toBe('Lecturer in Chemistry');
  });

  it('lets a fresh profile read replace the live faculty title', () => {
    const pick = pickRosterTitleForRunEnd(
      [held('Laboratory Manager', { fromProfilePage: true })],
      false,
      true,
    );
    expect(pick.outcome).toBe('profile');
    expect(pick.observation?.value).toBe('Laboratory Manager');
  });

  it('emits the staff listing once no faculty title is live', () => {
    const pick = pickRosterTitleForRunEnd([held('Laboratory Manager')], false, false);
    expect(pick.outcome).toBe('listing');
    expect(pick.observation?.value).toBe('Laboratory Manager');
  });
});

describe('dept-faculty-roster holds titles to the end of the run (#5801), live', () => {
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
        return res.end(rosterHtml(firstListing.title));
      }
      if (path === '/people/other') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(rosterHtml(secondListing.title));
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
    firstListing.title = '';
    firstListing.fromProfilePage = false;
    secondListing.title = '';
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

  const scrape = async (configs: DeptConfig[]): Promise<void> => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(
      new DepartmentRosterScraper(configs, null, throughLocalServer, async () => new Map()),
    );
    await orchestrator.run(SOURCE_NAME, {
      dryRun: false,
      useCache: false,
      release: false,
      ignoreWorkPlanner: true,
    });
  };

  const liveTitles = async (): Promise<string[]> =>
    (
      await Observation.find({
        sourceName: SOURCE_NAME,
        entityType: 'user',
        entityKey: PERSON_KEY,
        field: 'title',
        superseded: false,
      }).lean<Array<{ value: string }>>()
    ).map((title) => title.value);

  it('keeps one title for a person listed under two configs, not whichever was read last', async () => {
    firstListing.title = 'Professor of Chemistry';
    secondListing.title = 'Department Administrator';
    await scrape([chemistry, physics]);
    expect(await liveTitles()).toEqual(['Professor of Chemistry']);

    await scrape([physics, chemistry]);
    expect(await liveTitles()).toEqual(['Professor of Chemistry']);
  });

  it('never lets a later listing title replace the lane own profile read', async () => {
    firstListing.title = 'Associate Professor of Chemistry';
    firstListing.fromProfilePage = true;
    await scrape([chemistry]);
    expect(await liveTitles()).toEqual(['Associate Professor of Chemistry']);

    secondListing.title = 'Lecturer in Physics';
    await scrape([physics]);
    expect(await liveTitles()).toEqual(['Associate Professor of Chemistry']);
  });

  it('keeps a faculty title when a later run reads only a staff listing (#6345)', async () => {
    firstListing.title = 'Professor of Chemistry';
    await scrape([chemistry]);
    expect(await liveTitles()).toEqual(['Professor of Chemistry']);

    secondListing.title = 'Laboratory Manager';
    await scrape([physics]);
    expect(await liveTitles()).toEqual(['Professor of Chemistry']);
  });

  it('takes the staff listing when the faculty title is no longer live (#6345)', async () => {
    firstListing.title = 'Professor of Chemistry';
    await scrape([chemistry]);
    await Observation.updateMany(
      { sourceName: SOURCE_NAME, entityKey: PERSON_KEY, field: 'title' },
      { $set: { superseded: true } },
    );

    secondListing.title = 'Laboratory Manager';
    await scrape([physics]);
    expect(await liveTitles()).toEqual(['Laboratory Manager']);
  });

  it('does not let a truncated faculty title block a staff listing (#6345)', async () => {
    await mongoose.connection.db!.collection('observations').insertOne({
      sourceName: SOURCE_NAME,
      entityType: 'user',
      entityKey: PERSON_KEY,
      field: 'title',
      value: 'Professor of',
      superseded: false,
      observedAt: new Date('2026-11-01T00:00:00Z'),
    });

    secondListing.title = 'Laboratory Manager';
    await scrape([physics]);
    expect(await liveTitles()).toContain('Laboratory Manager');
  });

  it('leaves the stored title standing when a later run reads only disagreeing listings', async () => {
    firstListing.title = 'Professor of Chemistry';
    await scrape([chemistry]);
    expect(await liveTitles()).toEqual(['Professor of Chemistry']);

    firstListing.title = 'Professor of Chemistry and Biochemistry';
    secondListing.title = 'Professor of Physics';
    await scrape([chemistry, physics]);
    expect(await liveTitles()).toEqual(['Professor of Chemistry']);
    expect(
      await Observation.countDocuments({
        sourceName: SOURCE_NAME,
        entityKey: PERSON_KEY,
        assertsNoValueFor: 'title',
      }),
    ).toBe(0);
  });
});
