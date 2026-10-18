import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  centerMemberRelationshipObservationsForEntityKey,
  type CenterMember,
} from '../sources/centersInstitutesScraper';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const CENTER_SLUG = 'center-synthetic-umbrella';
const MEMBER_NAME = 'Quinn Synthetic';
const MEMBER_SITE = 'https://quinn-synthetic.example.edu/';
const PROMOTED_LAB_SLUG = 'faculty-research-area-quinn-synthetic';
const DEPT_ROW_SLUG = 'dept-cs-quinn-synthetic';

const materializeRelationshipFor = async (member: CenterMember) => {
  const observations = centerMemberRelationshipObservationsForEntityKey(
    CENTER_SLUG,
    member,
    'https://synthetic-umbrella.example.edu/people/',
  );
  await appendObservations(observations, {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return materializeEntity('researchEntityRelationship', {
    entityKey: observations[0]!.entityKey,
  });
};

const leadRow = async (slug: string, entityType: string, websiteUrl: string, personId: unknown) => {
  const row = await ResearchEntity.create({
    slug,
    name: `${slug} row`,
    kind: entityType === 'LAB' ? 'lab' : 'individual',
    entityType,
    websiteUrl,
    archived: false,
  });
  await RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: row._id },
    role: 'PI',
    state: 'UNKNOWN',
    confidence: 0.9,
  });
  return row;
};

const edges = async () =>
  (await ResearchEntityRelationship.find({ archived: { $ne: true } }).lean()) as any[];

describe('center relationships reach the member row the roster links (#5068)', () => {
  let replSet: MongoMemoryReplSet;
  let researcherId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'research_entity_relationships',
      'researchers',
      'role_assignments',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: CENTER_SLUG,
      name: 'Synthetic Umbrella Center',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: MEMBER_NAME,
      profileLinks: [],
      archived: false,
    });
    researcherId = researcher._id as mongoose.Types.ObjectId;
  });

  it('links a lab promoted from a faculty research row as an affiliated lab', async () => {
    const lab = await leadRow(PROMOTED_LAB_SLUG, 'LAB', 'https://group.example.edu/', researcherId);

    const result = await materializeRelationshipFor({ name: MEMBER_NAME });

    expect(result.skipped).toBeUndefined();
    const written = await edges();
    expect(written).toHaveLength(1);
    expect(String(written[0].targetResearchEntityId)).toBe(String(lab._id));
    expect(written[0].relationshipType).toBe('AFFILIATED_LAB');
  });

  it('reaches a row no name key names when it serves the linked site and the person leads it', async () => {
    const row = await leadRow(
      DEPT_ROW_SLUG,
      'FACULTY_RESEARCH_AREA',
      'https://www.quinn-synthetic.example.edu',
      researcherId,
    );

    const result = await materializeRelationshipFor({
      name: MEMBER_NAME,
      profileUrl: 'http://quinn-synthetic.example.edu/',
    });

    expect(result.skipped).toBeUndefined();
    const written = await edges();
    expect(written).toHaveLength(1);
    expect(String(written[0].targetResearchEntityId)).toBe(String(row._id));
    expect(written[0].relationshipType).toBe('MEMBER_RESEARCH_AREA');
  });

  it('skips a row at the linked site that somebody else leads', async () => {
    const other = await Researcher.create({
      displayName: 'Rowan Synthetic',
      profileLinks: [],
      archived: false,
    });
    await leadRow(DEPT_ROW_SLUG, 'FACULTY_RESEARCH_AREA', MEMBER_SITE, other._id);

    const result = await materializeRelationshipFor({ name: MEMBER_NAME, profileUrl: MEMBER_SITE });

    expect(result.skipped).toBe('target-not-resolved');
    expect(await edges()).toHaveLength(0);
  });

  it('skips when the listed name resolves to more than one researcher', async () => {
    await Researcher.create({ displayName: MEMBER_NAME, profileLinks: [], archived: false });
    await leadRow(DEPT_ROW_SLUG, 'FACULTY_RESEARCH_AREA', MEMBER_SITE, researcherId);

    const result = await materializeRelationshipFor({ name: MEMBER_NAME, profileUrl: MEMBER_SITE });

    expect(result.skipped).toBe('target-not-resolved');
    expect(await edges()).toHaveLength(0);
  });

  it('mints nothing for a listed member with no row', async () => {
    const before = await ResearchEntity.countDocuments({});

    const result = await materializeRelationshipFor({ name: MEMBER_NAME, profileUrl: MEMBER_SITE });

    expect(result.skipped).toBe('target-not-resolved');
    expect(await ResearchEntity.countDocuments({})).toBe(before);
    expect(await edges()).toHaveLength(0);
  });
});
