import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import {
  OfficialProfilePiBackfillScraper,
  selectVisibleProfileBioTargets,
  visibleBioPageAddressContradictsPerson,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';

const NETID = 'as5787a';
const STORED_EMAIL = 'avery.s.synthetic5787@yale.edu';
const PAGE_EMAIL = 'avery.synthetic5787@yale.edu';
const PAGE_URL = 'https://medicine.yale.edu/profile/avery-synthetic/';

const personPage = (url: string, email: string): string => `
  <html>
    <head><link rel="canonical" href="${url}" /></head>
    <body>
      <main>
        <h1>Avery Synthetic</h1>
        <div class="title">Associate Professor of Medicine</div>
        <a href="mailto:${email}">${email}</a>
        <section class="biography">
          Avery Synthetic studies cardiac signalling, tissue repair and the clinical outcomes of
          regenerative therapies across a large patient cohort.
        </section>
      </main>
    </body>
  </html>
`;

const visibleBioContext = (emitted: ObservationInput[]): ScraperContext => ({
  scrapeRunId: 'run-5787',
  sourceId: 'source-5787',
  sourceName: 'official-profile-pi-backfill',
  sourceWeight: 0.95,
  options: {
    dryRun: true,
    useCache: false,
    release: false,
    only: ['visible-profile-bio-backfill'],
  },
  emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
    emitted.push(...(Array.isArray(obs) ? obs : [obs]));
  }),
  log: vi.fn(),
});

const readPage = async (email: string): Promise<ObservationInput[]> => {
  const emitted: ObservationInput[] = [];
  await new OfficialProfilePiBackfillScraper(
    vi.fn(async (url: string) => personPage(url, email)),
    vi.fn(async () => []),
    undefined,
    selectVisibleProfileBioTargets,
    vi.fn(async () => []),
    vi.fn(async () => []),
    0,
  ).run(visibleBioContext(emitted));
  return emitted;
};

describe("a namesake's page is not read as the person's own (#5787)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['researchers', 'role_assignments', 'research_entities', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
  });

  const seedLeadOfRowCitingPage = async (
    storedEmail: string,
    ownLinks: string[] = [],
  ): Promise<void> => {
    const entity = await ResearchEntity.create({
      slug: 'avery-synthetic',
      name: 'Avery Synthetic',
      kind: 'lab',
      websiteUrl: PAGE_URL,
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Avery Synthetic',
      identifiers: { netid: NETID, email: storedEmail },
      profileLinks: ownLinks.map((url) => ({
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url,
        verifiedAt: new Date('2026-10-01T00:00:00Z'),
      })),
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
  };

  const seedDirectoryEmail = async (netid: string, email: string) =>
    Observation.create({
      entityType: 'user',
      entityKey: `netid:${netid}`,
      field: 'email',
      value: email,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-directory',
      confidence: 0.95,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
    });

  it('writes nothing under the netid when the page states another address and only the name ties it', async () => {
    await seedLeadOfRowCitingPage(STORED_EMAIL);

    const emitted = await readPage(PAGE_EMAIL);

    expect(emitted.filter((o) => o.entityKey === `netid:${NETID}`)).toEqual([]);
  });

  it('reads the page when the directory pairs its address with the person', async () => {
    await seedLeadOfRowCitingPage(STORED_EMAIL);
    await seedDirectoryEmail(NETID, PAGE_EMAIL);

    const emitted = await readPage(PAGE_EMAIL);

    expect(emitted.find((o) => o.field === 'email')).toEqual(
      expect.objectContaining({ entityKey: `netid:${NETID}`, value: PAGE_EMAIL }),
    );
  });

  it("reads the page when it is one the person's own record links", async () => {
    await seedLeadOfRowCitingPage(STORED_EMAIL, [PAGE_URL]);

    const emitted = await readPage(PAGE_EMAIL);

    expect(emitted.some((o) => o.entityKey === `netid:${NETID}`)).toBe(true);
  });

  it('reads the page when the stored address is the netid mailbox', async () => {
    await seedLeadOfRowCitingPage(`${NETID}@yale.edu`);

    const emitted = await readPage(PAGE_EMAIL);

    expect(emitted.some((o) => o.entityKey === `netid:${NETID}`)).toBe(true);
  });

  it('reads the page when it states the stored address', async () => {
    await seedLeadOfRowCitingPage(STORED_EMAIL);

    const emitted = await readPage(STORED_EMAIL);

    expect(emitted.find((o) => o.field === 'email')).toEqual(
      expect.objectContaining({ entityKey: `netid:${NETID}`, value: STORED_EMAIL }),
    );
  });
});

describe('visibleBioPageAddressContradictsPerson (#5787)', () => {
  const identity = { email: PAGE_EMAIL, canonicalUrl: PAGE_URL, fetchedUrl: PAGE_URL };
  const person = { netid: NETID, email: STORED_EMAIL };

  it('contradicts on a different stored address with no witness', () => {
    expect(visibleBioPageAddressContradictsPerson(identity, person, new Map())).toBe(true);
  });

  it('is spared by a page that states the netid, or an ORCID witnessed elsewhere', () => {
    expect(
      visibleBioPageAddressContradictsPerson(
        { ...identity, profileNetid: NETID },
        person,
        new Map(),
      ),
    ).toBe(false);
    expect(visibleBioPageAddressContradictsPerson(identity, person, new Map(), true)).toBe(false);
  });

  it('claims nothing when either address is missing', () => {
    expect(
      visibleBioPageAddressContradictsPerson({ ...identity, email: '' }, person, new Map()),
    ).toBe(false);
    expect(
      visibleBioPageAddressContradictsPerson(identity, { netid: NETID, email: '' }, new Map()),
    ).toBe(false);
  });
});
