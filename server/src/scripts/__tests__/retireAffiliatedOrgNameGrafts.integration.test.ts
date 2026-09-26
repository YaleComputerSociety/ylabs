import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { applyRows, loadOrgNameGrafts } from '../retireAffiliatedOrgNameGrafts';

const ENTITY_KEY = 'dept-econ-rafferty-duchamp';
const AFFILIATION_GRAFT = 'Yale School of Management';
const OWN_NAME = 'Rafferty Duchamp Faculty Research';
const MICROSITE_URL = 'https://www.example.com/rafferty-duchamp/';

describe('retireAffiliatedOrgNameGrafts finishes the repair on the document (#2351)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: OWN_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...overrides,
    });

  const seedGraftObservation = async (overrides: Record<string, unknown> = {}) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'displayName',
      value: AFFILIATION_GRAFT,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: MICROSITE_URL,
      confidence: 0.95,
      observedAt: new Date('2026-08-25T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  it('clears the served displayName in the same pass that retires the observation', async () => {
    await seedEntity({
      displayName: AFFILIATION_GRAFT,
      fieldProvenance: { displayName: { sourceName: 'lab-microsite-description-llm' } },
    });
    await seedGraftObservation();

    const rows = await loadOrgNameGrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].documentStillServesGraft).toBe(true);

    const applied = await applyRows(rows);
    expect(applied.rolledBack).toBe(1);
    expect(applied.documentFieldsCorrected).toBe(1);

    const entity = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{
      displayName?: string;
      fieldProvenance?: Record<string, unknown>;
      name?: string;
    }>();
    expect(entity?.displayName).toBeUndefined();
    expect((entity?.fieldProvenance || {}).displayName).toBeUndefined();
    expect(entity?.name).toBe(OWN_NAME);
  });

  it('still sees a graft a previous run retired but left on the document', async () => {
    await seedEntity({ displayName: AFFILIATION_GRAFT });
    await seedGraftObservation({
      superseded: true,
      rollback: { rolledBackAt: new Date('2026-09-01T01:11:00Z'), reason: 'earlier run' },
    });

    const rows = await loadOrgNameGrafts();
    expect(rows).toHaveLength(1);

    const applied = await applyRows(rows);
    expect(applied.rolledBack).toBe(0);
    expect(applied.documentFieldsCorrected).toBe(1);
    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ displayName?: string }>())
        ?.displayName,
    ).toBeUndefined();
  });

  it('drops a retired graft the document no longer serves so the repair terminates', async () => {
    await seedEntity();
    await seedGraftObservation({
      superseded: true,
      rollback: { rolledBackAt: new Date('2026-09-01T01:11:00Z'), reason: 'earlier run' },
    });

    expect(await loadOrgNameGrafts()).toHaveLength(0);
  });

  it('renames rather than blanks a grafted name when an observation survives', async () => {
    await seedEntity({ name: AFFILIATION_GRAFT });
    await seedGraftObservation({ field: 'name' });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'name',
      value: OWN_NAME,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://economics.example.edu/people',
      confidence: 0.7,
      observedAt: new Date('2026-08-28T00:00:00Z'),
      superseded: false,
    });

    const rows = await loadOrgNameGrafts();
    expect(rows[0].replacementNameAfterRollback).toBe(OWN_NAME);

    await applyRows(rows);

    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ name?: string }>())?.name,
    ).toBe(OWN_NAME);
  });

  it('heals a stored graft that materialization normalized away from the observation value', async () => {
    await seedEntity({ displayName: `${AFFILIATION_GRAFT} - Accounting` });
    await seedGraftObservation({
      superseded: true,
      rollback: { rolledBackAt: new Date('2026-09-01T01:11:00Z'), reason: 'earlier run' },
    });

    const rows = await loadOrgNameGrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].documentStillServesGraft).toBe(true);

    expect((await applyRows(rows)).documentFieldsCorrected).toBe(1);
    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ displayName?: string }>())
        ?.displayName,
    ).toBeUndefined();
  });

  it('refuses to rename onto a survivor that is itself an umbrella organization', async () => {
    await seedEntity({ name: AFFILIATION_GRAFT });
    await seedGraftObservation({ field: 'name' });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'name',
      value: 'Yale Comprehensive Cancer Center',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://medicine.example.edu/profile/rafferty-duchamp/',
      confidence: 0.8,
      observedAt: new Date('2026-08-28T00:00:00Z'),
      superseded: false,
    });

    const rows = await loadOrgNameGrafts();
    expect(rows[0].replacementNameAfterRollback).toBe('');
    expect(rows[0].needsRescrapeToRename).toBe(true);

    await applyRows(rows);

    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ name?: string }>())?.name,
    ).toBe(AFFILIATION_GRAFT);
  });

  it('heals a normalized foreign-lab name the surname roster is the only witness for', async () => {
    const labSlug = 'ysm-faculty-alexa-sliby';
    const ownName = 'Alexa Sliby Faculty Research';
    const labSite = 'https://www.girgentilab.example.org/home';
    await Researcher.create([{ displayName: 'Matthew Girgenti' }, { displayName: 'Alexa Sliby' }]);
    await ResearchEntity.create({
      slug: labSlug,
      name: 'Girgenti Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    const graftSource = {
      entityType: 'researchEntity' as const,
      entityKey: labSlug,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: 'https://medicine.example.edu/profile/alexa-sliby/',
      confidence: 0.8,
      observedAt: new Date('2026-08-25T00:00:00Z'),
      superseded: false,
    };
    await Observation.create({
      ...graftSource,
      field: 'name',
      value: 'Girgenti Lab - Yale School of Medicine',
      superseded: true,
      rollback: { rolledBackAt: new Date('2026-09-01T01:11:00Z'), reason: 'earlier run' },
    });
    await Observation.create({ ...graftSource, field: 'websiteUrl', value: labSite });
    await Observation.create({
      ...graftSource,
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://medicine.example.edu/people',
      field: 'name',
      value: ownName,
      confidence: 0.7,
    });

    const rows = await loadOrgNameGrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('ANOTHER_PERSONS_LAB');
    expect(rows[0].documentGraftedFields).toEqual([{ field: 'name', storedName: 'Girgenti Lab' }]);
    expect(rows[0].replacementNameAfterRollback).toBe(ownName);

    const applied = await applyRows(rows);
    expect(applied.documentFieldsCorrected).toBe(1);
    // This source emits `entityKey` and never `entityId`, so a row that took its id
    // off the observation left the re-gate with nothing to do and the renamed record
    // kept the tier the old name earned (#2368).
    expect(applied.regated).toBe(1);
    expect(applied.regateSkippedReason).toBeUndefined();
    const repaired = await ResearchEntity.findOne({ slug: labSlug }).lean<{
      name?: string;
      studentVisibilityTier?: string;
    }>();
    expect(repaired?.name).toBe(ownName);
    expect(repaired?.studentVisibilityTier).not.toBe('student_ready');
  });

  it('leaves a lab named after its own lead alone when the slug names the research', async () => {
    const labSlug = 'yale-sleep-neurobiology-lab';
    const lead = await Researcher.create({ displayName: 'Matthew Girgenti' });
    const lab = await ResearchEntity.create({
      slug: labSlug,
      name: 'Girgenti Lab',
      displayName: 'Girgenti Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: lab._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: labSlug,
      field: 'name',
      value: 'Girgenti Lab',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://girgentilab.example.org/',
      confidence: 0.95,
      observedAt: new Date('2026-08-25T00:00:00Z'),
      superseded: false,
    });

    expect(await loadOrgNameGrafts()).toHaveLength(0);
  });

  it('leaves an endowed organization named after its own lead alone', async () => {
    const slug = 'ysm-faculty-metal-geochemistry';
    const lead = await Researcher.create({ displayName: 'Matthew Girgenti' });
    const record = await ResearchEntity.create({
      slug,
      name: 'Girgenti Center',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: record._id },
      role: 'DIRECTOR',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'name',
      value: 'Girgenti Center',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://girgenticenter.example.org/',
      confidence: 0.95,
      observedAt: new Date('2026-08-25T00:00:00Z'),
      superseded: false,
    });

    expect(await loadOrgNameGrafts()).toHaveLength(0);
  });

  it('leaves a manually locked field alone', async () => {
    await seedEntity({ displayName: AFFILIATION_GRAFT, manuallyLockedFields: ['displayName'] });
    await seedGraftObservation();

    await applyRows(await loadOrgNameGrafts());

    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ displayName?: string }>())
        ?.displayName,
    ).toBe(AFFILIATION_GRAFT);
  });
});

const GRAFTED_SITE = 'https://www.example.com/krause-lab/';
const FOREIGN_LAB_GRAFT = 'Krause Lab';
const PROFILE_URL = 'https://www.example.com/profile/rafferty-duchamp/';

describe('retireAffiliatedOrgNameGrafts finishes the website half of the graft (#2529)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  /**
   * The state the 2026-09-01 apply left behind: the name observation retired and
   * the document name already correct, while the same graft's website is still
   * asserted and still served.
   */
  const seedHalfRepairedGraft = async (
    entityOverrides: Record<string, unknown> = {},
    graftedName: string = FOREIGN_LAB_GRAFT,
  ) => {
    // A surname roster the eponym check can recognize, so "Krause Lab" is refusable
    // as somebody else's lab rather than merely an unrecognized string.
    await Researcher.create({ netId: 'wk0001', displayName: 'Wilhelmina Krause' });
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: OWN_NAME,
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: GRAFTED_SITE,
      sourceUrls: [PROFILE_URL, GRAFTED_SITE],
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...entityOverrides,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'name',
      value: graftedName,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: PROFILE_URL,
      confidence: 0.8,
      observedAt: new Date('2026-08-26T00:00:00Z'),
      superseded: true,
      rollback: { rolledBackAt: new Date('2026-09-01T01:11:00Z'), reason: 'the #2234 pass' },
    });
    return Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'websiteUrl',
      value: GRAFTED_SITE,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: PROFILE_URL,
      confidence: 0.8,
      observedAt: new Date('2026-08-26T00:00:00Z'),
      superseded: false,
    });
  };

  it('still finds a row whose name half was repaired but whose website half was not', async () => {
    await seedHalfRepairedGraft();

    const rows = await loadOrgNameGrafts();

    expect(rows).toHaveLength(1);
    expect(rows[0].documentStillServesGraft).toBe(true);
    expect(rows[0].graftedWebsiteUrl).toBe(GRAFTED_SITE);
    expect(rows[0].websiteSurvivorExists).toBe(false);
  });

  it('retires the website observation and clears the field the withheld scrape cannot', async () => {
    const websiteObservation = await seedHalfRepairedGraft();

    const applied = await applyRows(await loadOrgNameGrafts());
    expect(applied.documentFieldsCorrected).toBe(1);

    const entity = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{
      websiteUrl?: string;
      sourceUrls?: string[];
      fieldProvenance?: Record<string, unknown>;
    }>();
    expect(entity?.websiteUrl).toBeUndefined();
    expect(entity?.sourceUrls).toEqual([PROFILE_URL]);
    expect((entity?.fieldProvenance || {}).websiteUrl).toBeUndefined();

    const retired = await Observation.findById(websiteObservation._id).lean<{
      superseded?: boolean;
      rollback?: { reason?: string };
    }>();
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toContain('#2529');
  });

  it('leaves the website for rematerialization when another source still asserts one', async () => {
    await seedHalfRepairedGraft();
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'websiteUrl',
      value: 'https://www.example.com/duchamp-own-site/',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: PROFILE_URL,
      confidence: 0.7,
      observedAt: new Date('2026-09-05T00:00:00Z'),
      superseded: false,
    });

    const rows = await loadOrgNameGrafts();
    expect(rows[0].websiteSurvivorExists).toBe(true);

    await applyRows(rows);

    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ websiteUrl?: string }>())
        ?.websiteUrl,
    ).toBe(GRAFTED_SITE);
  });

  it('leaves a manually locked websiteUrl alone', async () => {
    await seedHalfRepairedGraft({ manuallyLockedFields: ['websiteUrl'] });

    await applyRows(await loadOrgNameGrafts());

    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ websiteUrl?: string }>())
        ?.websiteUrl,
    ).toBe(GRAFTED_SITE);
  });

  it('reports rather than clears an umbrella-organization site the person may direct', async () => {
    // The report case of #2529: the guard refuses "Yale School of Management" as her
    // name, but she may well direct it, so the website is a decision and not a repair.
    await seedHalfRepairedGraft(
      {
        websiteUrl: 'https://www.example.com/school-of-management/',
        sourceUrls: [PROFILE_URL, 'https://www.example.com/school-of-management/'],
      },
      AFFILIATION_GRAFT,
    );
    await Observation.updateOne(
      { entityKey: ENTITY_KEY, field: 'websiteUrl' },
      { $set: { value: 'https://www.example.com/school-of-management/' } },
    );

    const rows = await loadOrgNameGrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('AFFILIATED_ORGANIZATION');
    expect(rows[0].graftedWebsiteUrl).toBe('');
    expect(rows[0].websiteNeedsDirectorshipReview).toBe(
      'https://www.example.com/school-of-management/',
    );

    await applyRows(rows);

    expect(
      (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ websiteUrl?: string }>())
        ?.websiteUrl,
    ).toBe('https://www.example.com/school-of-management/');
  });

  it('flags a shared academic host organization name a member row serves (#2360)', async () => {
    // The name clears every name-axis rule: it wears a research-home head noun, it is
    // nobody's eponym, and it came off a faculty-directory page shape that produces
    // dozens of correct lab names. The shared host the row cites is what identifies
    // the owner.
    const hostOrganizationName = 'Computer Systems Lab at Yale';
    const memberSlug = 'nih-pi-quilla-marrowbane';
    const directoryUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/';
    await ResearchEntity.create({
      slug: memberSlug,
      name: hostOrganizationName,
      displayName: hostOrganizationName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: 'https://csl.yale.edu/',
      sourceUrls: [directoryUrl, 'https://csl.yale.edu/'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    for (const field of ['name', 'displayName']) {
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: memberSlug,
        field,
        value: hostOrganizationName,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: directoryUrl,
        confidence: 0.95,
        observedAt: new Date('2026-08-22T00:00:00Z'),
        superseded: false,
      });
    }
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: memberSlug,
      field: 'name',
      value: 'Quilla Marrowbane Lab',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'nih-reporter',
      sourceUrl: 'https://reporter.nih.gov/project-details/1',
      confidence: 0.9,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });

    const rows = (await loadOrgNameGrafts()).filter((row) => row.entitySlug === memberSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('SHARED_HOST_ORGANIZATION');
    expect(rows[0].replacementNameAfterRollback).toBe('Quilla Marrowbane Lab');

    await applyRows(rows);

    const entity = await ResearchEntity.findOne({ slug: memberSlug }).lean<{
      name?: string;
      displayName?: string;
    }>();
    expect(entity?.name).toBe('Quilla Marrowbane Lab');
    expect(entity?.displayName).not.toBe(hostOrganizationName);
  });

  it('leaves a member own lab name on the same shared host alone (#2360)', async () => {
    const ownName = 'Analog and RF Circuits (ARC) Lab at Yale';
    const memberSlug = 'nsf-pi-quilla-marrowbane';
    const directoryUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/';
    await ResearchEntity.create({
      slug: memberSlug,
      name: ownName,
      displayName: ownName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: 'https://csl.yale.edu/~quilla/',
      sourceUrls: [directoryUrl, 'https://csl.yale.edu/~quilla/'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: memberSlug,
      field: 'name',
      value: ownName,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: directoryUrl,
      confidence: 0.95,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });

    expect((await loadOrgNameGrafts()).filter((row) => row.entitySlug === memberSlug)).toHaveLength(
      0,
    );
  });

  it('keeps a shared host label that is the row own surname (#2360)', async () => {
    // The lab vocabulary is the only one that sees this eponym: "Ursula Laboratory"
    // wears a lab head noun, so the organization-eponym check the umbrella arm uses
    // finds nothing and a repair judging on it alone would retire the name of the
    // person the host is named for.
    const memberSlug = 'dept-chem-robin-ursula';
    const profileUrl = 'https://chemistry.yale.edu/people/robin-ursula/';
    await ResearchEntity.create({
      slug: memberSlug,
      name: 'Ursula Laboratory',
      displayName: 'Ursula Laboratory',
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: 'https://ursula.chem.yale.edu/~robin/',
      sourceUrls: [profileUrl, 'https://ursula.chem.yale.edu/'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: memberSlug,
      field: 'name',
      value: 'Ursula Laboratory',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: profileUrl,
      confidence: 0.95,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });

    expect((await loadOrgNameGrafts()).filter((row) => row.entitySlug === memberSlug)).toHaveLength(
      0,
    );
  });

  it('flags a shared host name the row cites only in sourceUrls (#2360)', async () => {
    // The resolver already refuses a shared host's root as a person-scoped row's
    // websiteUrl (#2359), so on exactly the rows this arm is for the field holds a
    // personal site and the citation is the surviving evidence.
    const hostOrganizationName = 'Computer Systems Lab at Yale';
    const memberSlug = 'nih-pi-ottoline-fenwick';
    const directoryUrl =
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/ottoline-fenwick/';
    await ResearchEntity.create({
      slug: memberSlug,
      name: hostOrganizationName,
      displayName: hostOrganizationName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: 'https://www.example.com/ottoline-fenwick/',
      sourceUrls: [directoryUrl, 'https://csl.yale.edu/'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    for (const field of ['name', 'displayName']) {
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: memberSlug,
        field,
        value: hostOrganizationName,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: directoryUrl,
        confidence: 0.95,
        observedAt: new Date('2026-08-22T00:00:00Z'),
        superseded: false,
      });
    }

    const rows = (await loadOrgNameGrafts()).filter((row) => row.entitySlug === memberSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('SHARED_HOST_ORGANIZATION');
  });

  it('leaves a topical name whose initials collide with a cited deep page alone (#2360)', async () => {
    // The host-name test accepts a name whose initials spell the host label, which is
    // loose enough that only a citation OF the host itself - its root or a `~user`
    // tenant page - may feed it. A directory page that merely lives on the host is a
    // reference and not a claim.
    const topicalName = 'Statistical Theory and Applied Topics';
    const memberSlug = 'dept-stat-ottoline-fenwick';
    await ResearchEntity.create({
      slug: memberSlug,
      name: topicalName,
      displayName: topicalName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: 'https://www.example.com/ottoline-fenwick/',
      sourceUrls: ['https://stat.yale.edu/people/ottoline-fenwick'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: memberSlug,
      field: 'name',
      value: topicalName,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://stat.yale.edu/people/ottoline-fenwick',
      confidence: 0.95,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });

    expect((await loadOrgNameGrafts()).filter((row) => row.entitySlug === memberSlug)).toHaveLength(
      0,
    );
  });

  it('reaches a shared host organization name from the faculty-directory source too (#2360)', async () => {
    // `ysm-faculty-directory` IS a faculty directory, which is where this graft is
    // read from, so sequencing the arm after that branch left it reachable from the
    // one source it is least about.
    const hostOrganizationName = 'Computer Systems Lab at Yale';
    const memberSlug = 'nih-pi-marlow-pennybright';
    const profileUrl = 'https://medicine.yale.edu/faculty/marlow-pennybright/';
    await ResearchEntity.create({
      slug: memberSlug,
      name: hostOrganizationName,
      displayName: hostOrganizationName,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: 'https://csl.yale.edu/',
      sourceUrls: [profileUrl, 'https://csl.yale.edu/'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: memberSlug,
      field: 'name',
      value: hostOrganizationName,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: profileUrl,
      confidence: 0.8,
      observedAt: new Date('2026-08-22T00:00:00Z'),
      superseded: false,
    });

    const rows = (await loadOrgNameGrafts()).filter((row) => row.entitySlug === memberSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('SHARED_HOST_ORGANIZATION');
  });

  it('leaves the host organization own record naming itself, whichever source asserted it (#2360)', async () => {
    const hostOrganizationName = 'Computer Systems Lab at Yale';
    const organizationSlug = 'computer-systems-lab-at-yale';
    await ResearchEntity.create({
      slug: organizationSlug,
      name: hostOrganizationName,
      displayName: hostOrganizationName,
      entityType: 'CENTER',
      kind: 'center',
      websiteUrl: 'https://csl.yale.edu/',
      sourceUrls: ['https://csl.yale.edu/'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    for (const sourceName of ['ysm-faculty-directory', 'lab-microsite-description-llm']) {
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: organizationSlug,
        field: 'name',
        value: hostOrganizationName,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName,
        sourceUrl: 'https://csl.yale.edu/',
        confidence: 0.9,
        observedAt: new Date('2026-08-22T00:00:00Z'),
        superseded: false,
      });
    }

    expect(
      (await loadOrgNameGrafts()).filter((row) => row.entitySlug === organizationSlug),
    ).toHaveLength(0);
  });

  it('does not touch a website the document no longer serves', async () => {
    await seedHalfRepairedGraft({ websiteUrl: 'https://www.example.com/rehomed-by-2385/' });

    const rows = await loadOrgNameGrafts();

    expect(rows).toHaveLength(0);
  });
});

const BACKFILL_ENTITY_KEY = 'ysm-faculty-david-fiellin';
const BACKFILL_LEAD = 'David Fiellin';
const BACKFILL_OWN_NAME = 'David Fiellin Faculty Research';
const BACKFILL_ORG_GRAFT = 'Program in Addiction Medicine';
const BACKFILL_PROFILE_URL = 'https://www.example.com/profile/david-fiellin/';

describe('retireAffiliatedOrgNameGrafts reaches the profile-backfill graft (#2913)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  /**
   * The shape the graft actually takes: one source asserts the organization's name
   * AND an organization `entityType` in the same batch at a confidence that outranks
   * the roster's own `<Person> Faculty Research`, so the type it wrote is what the
   * person-scoped name guard would read.
   */
  const seedBackfillGraft = async (entityOverrides: Record<string, unknown> = {}) => {
    const lead = await Researcher.create({ displayName: BACKFILL_LEAD });
    const entity = await ResearchEntity.create({
      slug: BACKFILL_ENTITY_KEY,
      name: BACKFILL_ORG_GRAFT,
      displayName: BACKFILL_ORG_GRAFT,
      kind: 'initiative',
      entityType: 'INITIATIVE',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...entityOverrides,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
    for (const field of ['name', 'displayName']) {
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: BACKFILL_ENTITY_KEY,
        field,
        value: BACKFILL_ORG_GRAFT,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'official-profile-pi-backfill',
        sourceUrl: BACKFILL_PROFILE_URL,
        confidence: 0.96,
        observedAt: new Date('2026-09-10T00:00:00Z'),
        superseded: false,
      });
    }
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: BACKFILL_ENTITY_KEY,
      field: 'name',
      value: BACKFILL_OWN_NAME,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: BACKFILL_PROFILE_URL,
      confidence: 0.8,
      observedAt: new Date('2026-09-10T00:00:00Z'),
      superseded: false,
    });
    return entity;
  };

  it('loads the graft and restores the name the roster asserts', async () => {
    await seedBackfillGraft();

    const rows = await loadOrgNameGrafts();
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceName).toBe('official-profile-pi-backfill');
    expect(rows[0].verdict).toBe('AFFILIATED_ORGANIZATION');
    expect(rows[0].replacementNameAfterRollback).toBe(BACKFILL_OWN_NAME);

    const applied = await applyRows(rows);
    expect(applied.rolledBack).toBe(2);

    const repaired = await ResearchEntity.findOne({ slug: BACKFILL_ENTITY_KEY }).lean<{
      name?: string;
      displayName?: string;
    }>();
    expect(repaired?.name).toBe(BACKFILL_OWN_NAME);
    expect(repaired?.displayName).toBeUndefined();
  });

  it('leaves an organization-keyed record own name alone', async () => {
    const lead = await Researcher.create({ displayName: 'Alan Rooney' });
    const centre = await ResearchEntity.create({
      slug: 'rooney-center-for-metal-geochemistry',
      name: 'Rooney Center for Metal Geochemistry',
      displayName: 'Rooney Center for Metal Geochemistry',
      kind: 'center',
      entityType: 'CENTER',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: centre._id },
      role: 'DIRECTOR',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'rooney-center-for-metal-geochemistry',
      field: 'name',
      value: 'Rooney Center for Metal Geochemistry',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://www.example.com/profile/alan-rooney/',
      confidence: 0.96,
      observedAt: new Date('2026-09-10T00:00:00Z'),
      superseded: false,
    });

    expect(await loadOrgNameGrafts()).toHaveLength(0);
  });
});
