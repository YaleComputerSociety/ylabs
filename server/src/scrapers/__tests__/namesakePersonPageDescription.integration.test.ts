import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import {
  bestMaterializationProvenanceSourceUrl,
  materializeEntity,
  officialLeadProfileSourceUrl,
  withObservedPersonPages,
} from '../entityMaterializer';
import { everyCitedPersonPageUrl } from '../utils/namesakePersonPageDescriptions';

const SLUG = 'faculty-research-area-dana-quillfeather';
const OWN_PAGE = 'https://medicine.yale.edu/profile/dana-quillfeather/';
const NAMESAKE_PAGE = 'https://law.yale.edu/people/robert-quillfeather';
const OWN_TEXT =
  'Her research examines how coastal kelp forests recover after marine heatwaves, combining long-term field surveys with models of sea urchin grazing across rocky shores.';
const NAMESAKE_TEXT =
  'Robert Quillfeather writes on maritime contract law and the history of admiralty courts, with a focus on how shipping disputes were settled in early modern ports.';

describe("a namesake's person page in a person row's description resolve (#5764)", () => {
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
    for (const name of ['observations', 'research_entities'])
      await db.collection(name).deleteMany({});
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Dana Quillfeather',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
      sourceUrls: [NAMESAKE_PAGE],
    });
  });

  const seed = (
    field: string,
    value: string,
    sourceUrl: string,
    sourceName: string,
    confidence = 0.8,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence,
      observedAt: new Date(),
      superseded: false,
    });

  it("serves the row's own text over a namesake page, and writes no observation", async () => {
    await seed('fullDescription', OWN_TEXT, OWN_PAGE, 'dept-faculty-roster', 0.6);
    await seed('fullDescription', NAMESAKE_TEXT, NAMESAKE_PAGE, 'ysm-faculty-directory', 0.95);
    const before = await Observation.find().lean();
    const result = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
    expect(result.plannedSet?.fullDescription).toBe(OWN_TEXT);
    const after = await Observation.find().lean();
    expect(after.map((obs) => String(obs.value))).toEqual(before.map((obs) => String(obs.value)));
  });

  it('keeps a lone person page the row cites, because nothing names another owner', async () => {
    await seed('fullDescription', NAMESAKE_TEXT, NAMESAKE_PAGE, 'ysm-faculty-directory', 0.95);
    const result = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
    expect(result.plannedSet?.fullDescription).toBe(NAMESAKE_TEXT);
  });
});

describe("the sourceUrls projections refuse a namesake's page (#5764)", () => {
  const identity = {
    slug: SLUG,
    name: 'Dana Quillfeather',
    citedPersonPageUrls: [NAMESAKE_PAGE],
  };
  const lead = {
    field: 'inferredPiUserKey',
    value: 'example-netid',
    sourceUrl: NAMESAKE_PAGE,
    confidence: 0.99,
  };

  it('does not copy the namesake page as the lead profile once the row cites its own page', () => {
    expect(officialLeadProfileSourceUrl([lead], undefined, [], identity)).toBe(NAMESAKE_PAGE);
    expect(
      officialLeadProfileSourceUrl(
        [lead],
        undefined,
        [],
        withObservedPersonPages(identity, everyCitedPersonPageUrl([{ sourceUrl: OWN_PAGE }])),
      ),
    ).toBeUndefined();
  });

  it('does not take the namesake page as provenance once the row cites its own page', () => {
    const observations = [
      { field: 'fullDescription', value: NAMESAKE_TEXT, sourceUrl: NAMESAKE_PAGE, confidence: 0.9 },
    ];
    expect(bestMaterializationProvenanceSourceUrl(observations, undefined, identity)).toBe(
      NAMESAKE_PAGE,
    );
    expect(
      bestMaterializationProvenanceSourceUrl(
        observations,
        undefined,
        withObservedPersonPages(identity, [OWN_PAGE]),
      ),
    ).toBeUndefined();
  });
});
