import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Signal } from '../../models/signal';
import { entityHasHostedUndergraduates } from '../../services/hostedUndergraduates';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import { materializeEntity } from '../entityMaterializer';
import { ROSTER_ALUMNI_PROGRAM_NAME } from '../sources/labMicrositeUndergradLLMExtractor';

const FELLOWSHIP_LANE = 'undergrad-fellowships-recipients';
const LAB_ROSTER_LANE = 'lab-microsite-undergrad-llm';
const ROSTER = 'https://syntheticdept.example.org/people/synthetic/alumni';
const PAGE = 'https://syntheticdept.example.org/people/synthetic';
const ESSAYS = 'https://syntheticdept.example.org/senior-essays';

const MOVED_ESSAY = { year: 2024, programName: 'Cognitive Science senior essay', count: 2 };
const MOVED_THESIS = {
  year: 2023,
  programName: 'Earth and Planetary Sciences senior thesis',
  count: 1,
};
const KEPT_FELLOWSHIP = {
  year: 2025,
  programName: 'STARS II (Science, Technology and Research Scholars)',
  count: 1,
};

const seed = (
  entityKey: string,
  field: string,
  value: unknown,
  sourceName = 'synthetic-profile-lane',
  sourceUrl = PAGE,
  confidence = 0.8,
) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl,
    confidence,
    observedAt: new Date('2026-09-01T00:00:00Z'),
    superseded: false,
  });

async function seedProfile(entityKey: string, advisees: unknown[]) {
  await seed(entityKey, 'slug', entityKey);
  await seed(entityKey, 'name', 'Synthetic Faculty Research');
  await seed(entityKey, 'entityType', 'FACULTY_RESEARCH_AREA');
  await seed(entityKey, 'kind', 'faculty_research');
  await seed(entityKey, 'sourceUrls', [PAGE]);
  await seed(entityKey, 'pastUndergradAdvisees', advisees, FELLOWSHIP_LANE, ESSAYS);
}

const resolve = (entityKey: string) => materializeEntity('researchEntity', { entityKey }, {});

const stored = (entityKey: string) => ResearchEntity.findOne({ slug: entityKey }).lean<any>();

async function liveSignalKeys(entityKey: string): Promise<string[]> {
  const row = await stored(entityKey);
  const signals = await Signal.find({ researchEntityId: row?._id, archived: { $ne: true } }).lean();
  return signals.map((signal: any) => String(signal.derivationKey));
}

describe('advisee entries from the pages moved to mentors are withdrawn on resolve (#5591)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('leaves a row whose only advisee evidence is a moved page with no stored entry, signal or hosted flag', async () => {
    await seedProfile('synthetic-essay-adviser', [MOVED_ESSAY, MOVED_THESIS]);
    await resolve('synthetic-essay-adviser');

    const row = await stored('synthetic-essay-adviser');
    expect(row?.pastUndergradAdvisees ?? []).toEqual([]);
    expect(await liveSignalKeys('synthetic-essay-adviser')).not.toContain('signal:PAST_UNDERGRADS');
    expect(entityHasHostedUndergraduates(row)).toBe(false);
    expect(toPublicResearchEntityDto(row)).not.toHaveProperty('pastUndergradAdvisees');
  }, 120000);

  it('keeps a fellowship entry the lane still reads beside a moved one', async () => {
    await seedProfile('synthetic-fellowship-adviser', [KEPT_FELLOWSHIP, MOVED_THESIS]);
    await resolve('synthetic-fellowship-adviser');

    const row = await stored('synthetic-fellowship-adviser');
    expect(row?.pastUndergradAdvisees).toEqual([expect.objectContaining(KEPT_FELLOWSHIP)]);
    expect(await liveSignalKeys('synthetic-fellowship-adviser')).toContain(
      'signal:PAST_UNDERGRADS',
    );
    expect(entityHasHostedUndergraduates(row)).toBe(true);
  }, 120000);

  it('lets a lab roster alumni count fill the field when the fellowship lane states only moved pages', async () => {
    const rosterAlumni = { programName: ROSTER_ALUMNI_PROGRAM_NAME, count: 3 };
    await seedProfile('synthetic-roster-adviser', [MOVED_ESSAY]);
    await seed(
      'synthetic-roster-adviser',
      'pastUndergradAdvisees',
      [rosterAlumni],
      LAB_ROSTER_LANE,
      ROSTER,
      0.5,
    );
    await resolve('synthetic-roster-adviser');

    const row = await stored('synthetic-roster-adviser');
    expect(row?.pastUndergradAdvisees).toEqual([expect.objectContaining(rosterAlumni)]);
    expect(entityHasHostedUndergraduates(row)).toBe(true);
    const signal = await Signal.findOne({
      researchEntityId: row?._id,
      derivationKey: 'signal:PAST_UNDERGRADS',
      archived: { $ne: true },
    }).lean<any>();
    expect(signal?.source?.url).toBe(ROSTER);
  }, 120000);

  it('clears a moved entry a row already stored, and a second pass changes nothing', async () => {
    await seedProfile('synthetic-stored-adviser', [MOVED_ESSAY]);
    await resolve('synthetic-stored-adviser');
    await ResearchEntity.updateOne(
      { slug: 'synthetic-stored-adviser' },
      { $set: { pastUndergradAdvisees: [MOVED_ESSAY] } },
    );

    await resolve('synthetic-stored-adviser');
    const cleared = await stored('synthetic-stored-adviser');
    expect(cleared?.pastUndergradAdvisees ?? []).toEqual([]);
    expect(entityHasHostedUndergraduates(cleared)).toBe(false);

    await resolve('synthetic-stored-adviser');
    const again = await stored('synthetic-stored-adviser');
    expect(again?.pastUndergradAdvisees ?? []).toEqual(cleared?.pastUndergradAdvisees ?? []);
  }, 120000);
});
