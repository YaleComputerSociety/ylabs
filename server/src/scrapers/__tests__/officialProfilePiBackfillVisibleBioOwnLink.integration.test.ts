import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import {
  extractOfficialProfilePersonIdentity,
  OfficialProfilePiBackfillScraper,
  selectVisibleProfileBioTargets,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);

const OWN_NETID = 'as5708a';
const OTHER_NETID = 'zz5708b';
const DIRECTORY_NAMESAKE_NETID = 'zc5708';
const OWN_EMAIL = 'avery.synthetic5708@yale.edu';
const COMPOUND_EMAIL = 'averylee.synthetic5708@yale.edu';
const RENAMED_PAGE_URL = 'https://medicine.yale.edu/profile/avery-maidenfixture/';
const SECOND_PAGE_URL = 'https://ysph.yale.edu/profile/avery-secondfixture/';
const NAMESAKE_PAGE_URL = `https://medicine.yale.edu/profile/avery-synthetic-${DIRECTORY_NAMESAKE_NETID}/`;
const COMPOUND_PAGE_URL = 'https://medicine.yale.edu/profile/averylee-synthetic/';

const personPage = (url: string, name: string, email: string): string => `
  <html>
    <head><link rel="canonical" href="${url}" /></head>
    <body>
      <main>
        <h1>${name}</h1>
        <div class="title">Associate Professor of Medicine</div>
        <a href="mailto:${email}">${email}</a>
        <section class="biography">
          ${name} studies cardiac signalling, tissue repair and the clinical outcomes of
          regenerative therapies across a large patient cohort.
        </section>
      </main>
    </body>
  </html>
`;

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL',
  purpose: 'PRIMARY_IDENTITY',
  url,
  verifiedAt: new Date('2026-10-01T00:00:00Z'),
});

const personPageDeclaringAddress = (url: string, name: string, email: string): string =>
  personPage(url, name, email).replace(
    '</head>',
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name,
      email,
    })}</script></head>`,
  );

const visibleBioContext = (emitted: ObservationInput[]): ScraperContext => ({
  scrapeRunId: 'run-5708',
  sourceId: 'source-5708',
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

const scraperReading = (fetcher: (url: string) => Promise<string>) =>
  new OfficialProfilePiBackfillScraper(
    vi.fn(fetcher),
    vi.fn(async () => []),
    undefined,
    selectVisibleProfileBioTargets,
    vi.fn(async () => []),
    vi.fn(async () => []),
    0,
  );

describe('visible profile bio backfill selects by the person own official link (#5708)', () => {
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

  const seedLead = async (
    displayName: string,
    profileUrls: string[],
    email = OWN_EMAIL,
  ): Promise<mongoose.Types.ObjectId> => {
    const entity = await ResearchEntity.create({
      slug: 'fixture-cardiac-lab',
      name: 'Fixture Cardiac Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName,
      identifiers: { netid: OWN_NETID, email },
      profileLinks: profileUrls.map(officialLink),
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
    return researcher._id as mongoose.Types.ObjectId;
  };

  const seedOtherHolder = async (url: string) =>
    Researcher.create({
      displayName: 'Jordan Fixture',
      identifiers: { netid: OTHER_NETID },
      profileLinks: [officialLink(url)],
      status: 'ACTIVE',
      archived: false,
    });

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

  it('selects a held official link whose slug does not match the name', async () => {
    const researcherId = await seedLead('Avery Synthetic', [RENAMED_PAGE_URL]);

    const targets = await selectVisibleProfileBioTargets(10);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ _id: String(researcherId), netid: OWN_NETID });
    expect(targets[0].visibleBioProfileUrls).toEqual([RENAMED_PAGE_URL]);
  });

  it('does not select a held link another live researcher also holds', async () => {
    await seedLead('Avery Synthetic', [RENAMED_PAGE_URL]);
    await seedOtherHolder(RENAMED_PAGE_URL);

    await expect(selectVisibleProfileBioTargets(10)).resolves.toEqual([]);
  });

  it('drops a name-matching link another live researcher also holds', async () => {
    const nameMatchingUrl = 'https://medicine.yale.edu/profile/avery-synthetic/';
    await seedLead('Avery Synthetic', [nameMatchingUrl]);
    await seedOtherHolder(nameMatchingUrl);

    await expect(selectVisibleProfileBioTargets(10)).resolves.toEqual([]);
  });

  it('selects nothing when a legacy record holds two different official links', async () => {
    const researcherId = await seedLead('Avery Synthetic', [RENAMED_PAGE_URL]);
    await Researcher.collection.updateOne(
      { _id: researcherId },
      { $push: { profileLinks: officialLink(SECOND_PAGE_URL) } as any },
    );

    await expect(selectVisibleProfileBioTargets(10)).resolves.toEqual([]);
  });

  it('refuses before reading a held link whose slug ends in another directory netid', async () => {
    await seedLead('Avery Synthetic', [NAMESAKE_PAGE_URL]);
    await seedDirectoryEmail(DIRECTORY_NAMESAKE_NETID, 'avery.namesake5708@yale.edu');
    const emitted: ObservationInput[] = [];
    const fetcher = vi.fn(async (url: string) =>
      personPage(url, 'Avery Synthetic', 'avery.namesake5708@yale.edu'),
    );

    await expect(selectVisibleProfileBioTargets(10)).resolves.toEqual([]);
    const result = await scraperReading(fetcher).run(visibleBioContext(emitted));

    expect(fetcher).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result).toMatchObject({ observationCount: 0 });
  });

  it("emits the person's own address from a held link with a non-matching slug", async () => {
    await seedLead('Avery Synthetic', [RENAMED_PAGE_URL]);
    const emitted: ObservationInput[] = [];

    await scraperReading(async (url) => personPage(url, 'Avery Synthetic', OWN_EMAIL)).run(
      visibleBioContext(emitted),
    );

    expect(emitted.filter((o) => o.field === 'email')).toEqual([
      expect.objectContaining({ entityKey: `netid:${OWN_NETID}`, value: OWN_EMAIL }),
    ]);
  });

  it('emits from a compound given name when the directory pairs the page address with the person', async () => {
    await seedLead('Avery Lee Synthetic', [COMPOUND_PAGE_URL], COMPOUND_EMAIL);
    await seedDirectoryEmail(OWN_NETID, COMPOUND_EMAIL);
    const emitted: ObservationInput[] = [];

    await scraperReading(async (url) => personPage(url, 'Averylee Synthetic', COMPOUND_EMAIL)).run(
      visibleBioContext(emitted),
    );

    expect(emitted.filter((o) => o.field === 'email')).toEqual([
      expect.objectContaining({ entityKey: `netid:${OWN_NETID}`, value: COMPOUND_EMAIL }),
    ]);
  });

  it('keeps refusing a compound given name the directory does not pair with the person', async () => {
    await seedLead('Avery Lee Synthetic', [COMPOUND_PAGE_URL], COMPOUND_EMAIL);
    const emitted: ObservationInput[] = [];

    await scraperReading(async (url) => personPage(url, 'Averylee Synthetic', COMPOUND_EMAIL)).run(
      visibleBioContext(emitted),
    );

    expect(emitted).toEqual([]);
  });

  it('keeps refusing a page whose address the directory pairs with somebody else', async () => {
    await seedLead('Avery Lee Synthetic', [COMPOUND_PAGE_URL], COMPOUND_EMAIL);
    await seedDirectoryEmail(OTHER_NETID, COMPOUND_EMAIL);
    const emitted: ObservationInput[] = [];

    await scraperReading(async (url) => personPage(url, 'Averylee Synthetic', COMPOUND_EMAIL)).run(
      visibleBioContext(emitted),
    );

    expect(emitted).toEqual([]);
  });

  it('selects and emits the same thing when run twice', async () => {
    await seedLead('Avery Synthetic', [RENAMED_PAGE_URL]);
    const read = async (url: string) => personPage(url, 'Avery Synthetic', OWN_EMAIL);

    const firstTargets = await selectVisibleProfileBioTargets(10);
    const secondTargets = await selectVisibleProfileBioTargets(10);
    const firstEmitted: ObservationInput[] = [];
    const secondEmitted: ObservationInput[] = [];
    await scraperReading(read).run(visibleBioContext(firstEmitted));
    await scraperReading(read).run(visibleBioContext(secondEmitted));

    expect(secondTargets).toEqual(firstTargets);
    expect(firstEmitted.length).toBeGreaterThan(0);
    expect(secondEmitted).toEqual(firstEmitted);
  });

  describe('the directory stand-in for the name check', () => {
    const DOTTED_PLACEHOLDER_NETID = 'averylee.synthetic5708';
    const compoundTarget = (netid: string) => ({
      _id: 'researcher-5708',
      netid,
      email: COMPOUND_EMAIL,
      fname: 'Avery',
      lname: 'Lee Synthetic',
      name: 'Avery Lee Synthetic',
      displayName: 'Avery Lee Synthetic',
      slug: 'avery-lee-synthetic',
    });
    const readWithDirectoryPairing = (netid: string) =>
      extractOfficialProfilePersonIdentity(
        personPage(COMPOUND_PAGE_URL, 'Averylee Synthetic', COMPOUND_EMAIL),
        COMPOUND_PAGE_URL,
        compoundTarget(netid),
        {
          requireEmail: false,
          directoryNetidsByAddress: new Map([[COMPOUND_EMAIL, new Set([netid])]]),
        },
      );

    it('accepts a disagreeing name when the directory pairs the address with a real netid', () => {
      expect(readWithDirectoryPairing(OWN_NETID)).toMatchObject({ email: COMPOUND_EMAIL });
    });

    it('refuses a disagreeing name when the paired netid is a dotted placeholder', () => {
      expect(readWithDirectoryPairing(DOTTED_PLACEHOLDER_NETID)).toBeNull();
    });
  });

  describe('a netid whose initials agree with neither the page name nor the address', () => {
    const UNRELATED_NETID = 'qx5708';
    const MARRIED_NETID = 'am5708';
    const MAIDEN_PAGE_URL = 'https://medicine.yale.edu/profile/avery-maidenfixture/';
    const MAIDEN_EMAIL = 'avery.maidenfixture5708@yale.edu';
    const OTHER_ADDRESS = 'dfixture5708@yale.edu';

    const seedNetidLead = async (
      netid: string,
      displayName: string,
      url: string,
      email: string,
      orcid?: string,
    ) => {
      const entity = await ResearchEntity.create({
        slug: 'fixture-initials-lab',
        name: 'Fixture Initials Lab',
        kind: 'lab',
        studentVisibilityTier: 'student_ready',
        archived: false,
      });
      const researcher = await Researcher.create({
        displayName,
        identifiers: { netid, email, ...(orcid ? { orcid } : {}) },
        profileLinks: [officialLink(url)],
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

    const emittedFrom = async (pageName: string, url: string, email: string, orcid = '') => {
      const emitted: ObservationInput[] = [];
      await scraperReading(async (fetched) =>
        personPageDeclaringAddress(fetched, pageName, email).replace(
          '</main>',
          orcid ? `<a href="https://orcid.org/${orcid}">ORCID</a></main>` : '</main>',
        ),
      ).run(visibleBioContext(emitted));
      return emitted;
    };

    const FIXTURE_ORCID = SYNTHETIC_ORCID_1;
    const OTHER_PAGE_URL = 'https://ysph.yale.edu/profile/devon-fixture/';

    const seedOrcidObservation = async (netid: string, sourceUrl: string) =>
      Observation.create({
        entityType: 'user',
        entityKey: `netid:${netid}`,
        field: 'orcid',
        value: FIXTURE_ORCID,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'ysph-faculty-fixture',
        sourceUrl,
        confidence: 0.9,
        observedAt: new Date('2026-11-01T00:00:00Z'),
        superseded: false,
      });

    it('files no address the netid does not tie when only the page name agrees with the netid (#5979)', async () => {
      const hyphenNetid = 'aj5708';
      const hyphenAddress = 'kestrel.fixture5708@yale.edu';
      await seedNetidLead(hyphenNetid, 'Avery Jules-Fixture', RENAMED_PAGE_URL, hyphenAddress);

      const emitted = await emittedFrom('Avery Jules-Fixture', RENAMED_PAGE_URL, hyphenAddress);

      expect(emitted.filter((o) => o.field === 'email')).toEqual([]);
    });

    it('files the address when the netid takes its initials from a hyphenated surname and the address agrees', async () => {
      const hyphenNetid = 'aj5708';
      const hyphenAddress = 'avery.jules-fixture5708@yale.edu';
      await seedNetidLead(hyphenNetid, 'Avery Jules-Fixture', RENAMED_PAGE_URL, hyphenAddress);

      const emitted = await emittedFrom('Avery Jules-Fixture', RENAMED_PAGE_URL, hyphenAddress);

      expect(emitted.filter((o) => o.field === 'email')).toEqual([
        expect.objectContaining({ entityKey: `netid:${hyphenNetid}`, value: hyphenAddress }),
      ]);
    });

    it('emits when another page already asserted the ORCID this page states', async () => {
      await seedNetidLead(
        UNRELATED_NETID,
        'Devon Fixture',
        RENAMED_PAGE_URL,
        OTHER_ADDRESS,
        FIXTURE_ORCID,
      );
      await seedOrcidObservation(UNRELATED_NETID, OTHER_PAGE_URL);

      const emitted = await emittedFrom(
        'Devon Fixture',
        RENAMED_PAGE_URL,
        OTHER_ADDRESS,
        FIXTURE_ORCID,
      );

      expect(emitted.filter((o) => o.field === 'email')).toEqual([
        expect.objectContaining({ entityKey: `netid:${UNRELATED_NETID}`, value: OTHER_ADDRESS }),
      ]);
    });

    it('refuses when the only ORCID assertion was read from this same page', async () => {
      await seedNetidLead(
        UNRELATED_NETID,
        'Devon Fixture',
        RENAMED_PAGE_URL,
        OTHER_ADDRESS,
        FIXTURE_ORCID,
      );
      await seedOrcidObservation(UNRELATED_NETID, RENAMED_PAGE_URL);

      await expect(
        emittedFrom('Devon Fixture', RENAMED_PAGE_URL, OTHER_ADDRESS, FIXTURE_ORCID),
      ).resolves.toEqual([]);
    });

    it('refuses identity fields without a witness, a stored address copied from the page included', async () => {
      await seedNetidLead(UNRELATED_NETID, 'Devon Fixture', RENAMED_PAGE_URL, OTHER_ADDRESS);

      await expect(emittedFrom('Devon Fixture', RENAMED_PAGE_URL, OTHER_ADDRESS)).resolves.toEqual(
        [],
      );
    });

    it('emits when the directory pairs the address with the person own netid', async () => {
      await seedNetidLead(UNRELATED_NETID, 'Devon Fixture', RENAMED_PAGE_URL, OTHER_ADDRESS);
      await seedDirectoryEmail(UNRELATED_NETID, OTHER_ADDRESS);

      const emitted = await emittedFrom('Devon Fixture', RENAMED_PAGE_URL, OTHER_ADDRESS);

      expect(emitted.filter((o) => o.field === 'email')).toEqual([
        expect.objectContaining({ entityKey: `netid:${UNRELATED_NETID}`, value: OTHER_ADDRESS }),
      ]);
    });

    it('emits when only the page name disagrees, the married-name shape', async () => {
      await seedNetidLead(MARRIED_NETID, 'Avery Synthetic', MAIDEN_PAGE_URL, MAIDEN_EMAIL);

      const emitted = await emittedFrom('Avery Synthetic', MAIDEN_PAGE_URL, MAIDEN_EMAIL);

      expect(emitted.filter((o) => o.field === 'email')).toEqual([
        expect.objectContaining({ entityKey: `netid:${MARRIED_NETID}`, value: MAIDEN_EMAIL }),
      ]);
    });
  });
});
