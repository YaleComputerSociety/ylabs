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
import { ScraperOrchestrator } from '../orchestrator';
import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';

beforeEach(clearC4Flags);

const SOURCE_NAME = 'dept-faculty-roster';
const OFFICIAL_ORIGIN = 'https://economics.yale.edu';
const SUBJECT = 'Quill Ledgerton';
const SUBJECT_ADDRESS = 'ql123@yale.edu';
const BUSINESS_OFFICE_ADDRESS = 'bo456@yale.edu';

const profile = { subjectContact: '' };

const rosterPage = (): string =>
  `<html><body><main><ul><li><a class="person" href="/people/quill-ledgerton">${SUBJECT}</a><span class="title">Professor of Economics</span></li></ul></main></body></html>`;

const profilePage = (): string => `<!doctype html>
<html><head><title>${SUBJECT} | Department of Economics</title><meta property="og:title" content="${SUBJECT}" /></head>
<body class="site-page site-page--node-person">
  <main><article class="node node--person"><header class="node__header">
    <div class="node__header-content-wrapper"><div class="node__header-content">
      <h1 class="node__title">${SUBJECT}</h1>
      <dl class="node__contact-info"><div class="node__contact-info-group"><dt>Email</dt>
        <dd class="node__contact-info-value">${profile.subjectContact}</dd></div></dl>
    </div></div>
  </header></article></main>
  <footer class="site-footer site-footer--economics"><div class="site-footer__content">
    <div class="site-footer__contact-info">
      <span class="site-footer__contact-info-email"><a href="mailto:${BUSINESS_OFFICE_ADDRESS}">${BUSINESS_OFFICE_ADDRESS}</a></span>
    </div>
  </div></footer>
</body></html>`;

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

const economics: DeptConfig = {
  deptKey: 'economics',
  deptName: 'Economics',
  schoolName: 'Yale Faculty of Arts and Sciences',
  url: `${OFFICIAL_ORIGIN}/people/faculty`,
  paginated: false,
  extractor: rosterExtractor,
};

type LiveObservation = { entityKey: string; field: string; value: unknown };

describe('dept-faculty-roster takes no footer contact as the subject email (#5780), live', () => {
  let replSet: MongoMemoryReplSet;
  let server: http.Server;
  let localOrigin = '';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const body =
        path === '/people/faculty'
          ? rosterPage()
          : path === '/people/quill-ledgerton'
            ? profilePage()
            : '';
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
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
    profile.subjectContact = '';
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
      new DepartmentRosterScraper([economics], null, throughLocalServer, async () => new Map()),
    );
    await orchestrator.run(SOURCE_NAME, {
      dryRun: false,
      useCache: false,
      release: false,
      ignoreWorkPlanner: true,
    });
  };

  const liveIdentity = async () => {
    const live = await Observation.find({
      sourceName: SOURCE_NAME,
      entityType: 'user',
      field: { $in: ['email', 'netid'] },
      superseded: false,
    }).lean<LiveObservation[]>();
    return {
      keys: [...new Set(live.map((obs) => obs.entityKey))].sort(),
      emails: live.filter((obs) => obs.field === 'email').map((obs) => obs.value),
    };
  };

  it('mints no key from the business office footer address, and a second run agrees', async () => {
    await scrape();
    const first = await liveIdentity();
    expect(first.emails).toEqual([]);
    expect(first.keys).not.toContain(`netid:${BUSINESS_OFFICE_ADDRESS.split('@')[0]}`);

    await scrape();
    expect(await liveIdentity()).toEqual(first);
  });

  it('keys the subject by the address in their own contact field, and a second run agrees', async () => {
    profile.subjectContact = `<a href="mailto:${SUBJECT_ADDRESS}">${SUBJECT_ADDRESS}</a>`;
    await scrape();
    const first = await liveIdentity();
    expect(first).toEqual({ keys: ['netid:ql123'], emails: [SUBJECT_ADDRESS] });

    await scrape();
    expect(await liveIdentity()).toEqual(first);
  });
});
