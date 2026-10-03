import { appendFileSync } from 'node:fs';
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
import { ResearchEntity } from '../../models/researchEntity';
import { Source } from '../../models/source';
import { materializeEntity } from '../entityMaterializer';
import { ScraperOrchestrator } from '../orchestrator';
import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';

beforeEach(clearC4Flags);

const record = (label: string, entity: unknown) => {
  const path = process.env.STATED_LAB_EVIDENCE_FILE;
  if (path) appendFileSync(path, `${label}\t${JSON.stringify(entity)}\n`);
};

const SOURCE_NAME = 'dept-faculty-roster';
const OFFICIAL_ORIGIN = 'https://mcdb.yale.edu';
const RESEARCH_PROSE =
  'The group studies the assembly of cytoskeletal fixtures in dividing cells, using live imaging and targeted genetic perturbation of spindle components.';

type PersistedIdentity = {
  slug: string;
  name?: string;
  kind?: string;
  entityType?: string;
  manuallyLockedFields?: string[];
};

const profileBodies = new Map<string, string>();

const profilePage = (name: string, path: string, body: string): string =>
  `<html><head><title>${name} | MCDB</title><link rel="canonical" href="${OFFICIAL_ORIGIN}${path}"></head><body><main>
     <h1 class="page-title">${name}</h1>
     <div class="person-title">Professor of Fixtures</div>
     <h2>Biography</h2>
     ${body}
     <h2>Research</h2><p>${RESEARCH_PROSE}</p>
   </main></body></html>`;

const rosterPage = (): string =>
  `<html><body><main><ul>${[...profileBodies.keys()]
    .map((path) => `<li><a class="person" href="${path}">${personFor(path)}</a></li>`)
    .join('')}</ul></main></body></html>`;

const PEOPLE: Record<string, string> = {
  '/people/ada-fixture': 'Ada Fixture',
  '/people/bo-otherone': 'Bo Otherone',
};
const personFor = (path: string): string => PEOPLE[path];

const rosterExtractor = (html: string): FacultyEntry[] => {
  const $ = cheerio.load(html);
  return $('a.person')
    .toArray()
    .map((anchor) => ({
      name: $(anchor).text().trim(),
      profileUrl: `${OFFICIAL_ORIGIN}${$(anchor).attr('href')}`,
      topics: ['Cell Biology'],
    }));
};

describe('dept-faculty-roster resolves a lab name the profile states the person leads (#4468), live', () => {
  let replSet: MongoMemoryReplSet;
  let server: http.Server;
  let localOrigin = '';
  const requested: string[] = [];

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      requested.push(path);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (path === '/people/faculty') return res.end(rosterPage());
      const body = profileBodies.get(path);
      if (body === undefined) {
        res.writeHead(404);
        return res.end('');
      }
      return res.end(profilePage(personFor(path), path, body));
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
    for (const name of [
      'observations',
      'research_entities',
      'researchers',
      'sources',
      'scrape_runs',
    ]) {
      await db.collection(name).deleteMany({});
    }
    profileBodies.clear();
    requested.length = 0;
    await Source.create({
      name: SOURCE_NAME,
      displayName: 'Department faculty rosters',
      defaultWeight: 0.7,
    });
  });

  const config = (): DeptConfig[] => [
    {
      deptKey: 'mcdb',
      deptName: 'Molecular, Cellular and Developmental Biology',
      schoolName: 'Yale Faculty of Arts and Sciences',
      url: `${OFFICIAL_ORIGIN}/people/faculty`,
      paginated: false,
      extractor: rosterExtractor,
    },
  ];

  const throughLocalServer = async (url: string): Promise<string> => {
    const response = await fetch(url.replace(OFFICIAL_ORIGIN, localOrigin));
    return response.ok ? response.text() : '';
  };

  const scrapeAndResolve = async (): Promise<PersistedIdentity | null> => {
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
    const nameObservation = await Observation.findOne({
      sourceName: SOURCE_NAME,
      entityType: 'researchEntity',
      field: 'name',
      entityKey: /ada-fixture/,
      superseded: false,
    }).lean<{ entityKey: string }>();
    if (!nameObservation) return null;
    await materializeEntity('researchEntity', { entityKey: nameObservation.entityKey });
    return ResearchEntity.findOne({ slug: nameObservation.entityKey }).lean<PersistedIdentity>();
  };

  const withAdaProfile = (body: string) => {
    profileBodies.set('/people/ada-fixture', body);
    profileBodies.set(
      '/people/bo-otherone',
      '<p>Bo Otherone studies membrane trafficking in yeast.</p>',
    );
  };

  it('adopts the stated name with LAB type and kind, and no lock', async () => {
    withAdaProfile(
      '<p>Ada Fixture studies cell division. Dr. Fixture directs the Cytoskeleton Dynamics Lab, an interdisciplinary research group.</p>',
    );
    const entity = await scrapeAndResolve();
    record('STATED', entity);
    expect(requested).toContain('/people/ada-fixture');
    expect(entity?.name).toBe('Cytoskeleton Dynamics Lab');
    expect(entity?.kind).toBe('lab');
    expect(entity?.entityType).toBe('LAB');
    expect(entity?.manuallyLockedFields ?? []).toEqual([]);
  });

  it('replaces the person-scoped fallback once the profile states the lab, and re-derives it on a second run', async () => {
    withAdaProfile('<p>Ada Fixture studies cell division in model organisms.</p>');
    const before = await scrapeAndResolve();
    record('FALLBACK', before);
    expect(before?.name).toMatch(/^Ada Fixture /);

    withAdaProfile(
      '<p>Ada Fixture studies cell division. Dr. Fixture directs the Cytoskeleton Dynamics Lab.</p>',
    );
    const after = await scrapeAndResolve();
    record('AFTER', after);
    expect(after?.slug).toBe(before?.slug);
    expect(after?.name).toBe('Cytoskeleton Dynamics Lab');
    expect(after?.entityType).toBe('LAB');

    const again = await scrapeAndResolve();
    record('RERUN', again);
    expect(again?.name).toBe('Cytoskeleton Dynamics Lab');
    expect(again?.manuallyLockedFields ?? []).toEqual([]);
  });

  it('outranks the composed person-named lab when the profile also links a lab website', async () => {
    withAdaProfile(
      '<p>Ada Fixture studies cell division. Dr. Fixture directs the Cytoskeleton Dynamics Lab.</p><p><a href="https://fixturelab.org/">Lab website</a></p>',
    );
    const entity = await scrapeAndResolve();
    record('STATED_WITH_LINK', entity);
    expect(entity?.name).toBe('Cytoskeleton Dynamics Lab');
    expect(entity?.entityType).toBe('LAB');
    expect(entity?.manuallyLockedFields ?? []).toEqual([]);
  });

  it.each([
    [
      'a lab merely mentioned',
      '<p>Ada Fixture collaborates with the Cytoskeleton Dynamics Lab.</p>',
    ],
    [
      'anchor text of a lab link',
      '<p>Ada Fixture studies cell division in model organisms.</p><p><a href="https://fixturelab.org/">Cytoskeleton Dynamics Lab</a></p>',
    ],
    [
      'a lab someone else directs',
      '<p>Ada Fixture works with Dr. Otherone, who directs the Cytoskeleton Dynamics Lab.</p>',
    ],
    [
      'a same-surname relative',
      '<p>Ada Fixture studies cell division. Her husband John Fixture directs the Spindle Mechanics Lab.</p>',
    ],
    [
      'a lab eponymous for another roster person',
      '<p>Ada Fixture studies cell division. Dr. Fixture directs the Otherone Lab.</p>',
    ],
    [
      'a service facility',
      '<p>Ada Fixture studies cell division. Dr. Fixture directs the Proteomics Laboratory Core.</p>',
    ],
    [
      'a core facility laboratory',
      '<p>Ada Fixture studies cell division. Dr. Fixture directs the Flow Cytometry Core Laboratory.</p>',
    ],
    [
      'two different labs',
      '<p>Dr. Fixture directs the Cytoskeleton Dynamics Lab. Dr. Fixture also leads the Spindle Mechanics Lab.</p>',
    ],
    [
      'a second lab whose name is refused',
      '<p>Dr. Fixture directs the Spindle Mechanics Lab. Dr. Fixture also directs the Laboratory of Neural Circuits.</p>',
    ],
  ])('never adopts %s', async (label, body) => {
    withAdaProfile(body);
    const entity = await scrapeAndResolve();
    record(`REFUSED ${label}`, entity);
    expect(requested).toContain('/people/ada-fixture');
    expect(entity?.name).toBeTruthy();
    expect(entity?.name).not.toMatch(/Cytoskeleton|Spindle|Otherone|Proteomics|Cytometry/);
    expect(entity?.name).toMatch(/^Ada Fixture /);
  });
});
