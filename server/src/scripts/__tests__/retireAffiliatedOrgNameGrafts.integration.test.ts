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
