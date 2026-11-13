import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { LAB_SITE_LEAD_VERIFICATION_SOURCE } from '../../scrapers/utils/labSiteLeadVerification';
import { rematerializeSlug } from '../rematerializeResearchEntities';
import { parseRematerializeResearchEntitiesArgs } from '../rematerializeResearchEntitiesCore';

const PROFILE_HOST = 'https://medicine.yale.edu/profile';

const seedResearcher = (displayName: string, profileSlug: string) =>
  Researcher.create({
    displayName,
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: `${PROFILE_HOST}/${profileSlug}/`,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    archived: false,
  });

const verification = (
  site: string,
  owner: mongoose.Types.ObjectId,
  other: mongoose.Types.ObjectId,
  otherVerdict: 'CONFIRMED' | 'CONTRADICTED',
  observedAt: string,
) => ({
  state: otherVerdict === 'CONTRADICTED' ? 'contradicted' : 'verified',
  checkedUrl: site,
  pagesRead: 1,
  confirmedCount: otherVerdict === 'CONTRADICTED' ? 1 : 2,
  contradictedCount: otherVerdict === 'CONTRADICTED' ? 1 : 0,
  unstatedCount: 0,
  leads: [
    {
      personId: String(owner),
      role: 'PI',
      verdict: 'CONFIRMED',
      matchedBy: 'OFFICIAL_PROFILE_LINK',
      evidenceUrl: site,
    },
    otherVerdict === 'CONTRADICTED'
      ? {
          personId: String(other),
          role: 'PI',
          verdict: 'CONTRADICTED',
          matchedBy: 'NONE',
          evidenceUrl: site,
          contradictedBy: 'NAMED_AS_LEAD',
        }
      : {
          personId: String(other),
          role: 'PI',
          verdict: 'CONFIRMED',
          matchedBy: 'OFFICIAL_PROFILE_LINK',
          evidenceUrl: site,
        },
  ],
  observedAt,
});

const seedLab = async (slug: string, name: string) => {
  const site = `https://medicine.yale.edu/lab/${slug}/`;
  const owner = await seedResearcher(`${name} Owner`, `${slug}-owner`);
  const other = await seedResearcher(`${name} Trainee`, `${slug}-trainee`);
  const row = await ResearchEntity.create({
    slug,
    name,
    entityType: 'LAB',
    websiteUrl: site,
    sourceUrls: [site],
    studentVisibilityTier: 'student_ready',
    archived: false,
    leadVerification: verification(site, owner._id, other._id, 'CONFIRMED', '2026-05-01T00:00:00Z'),
  });
  await RoleAssignment.collection.insertOne({
    personId: owner._id,
    target: { kind: 'RESEARCH_ENTITY', id: row._id },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    confidence: 0.9,
    rosterProvenance: { sourceName: 'ysm-faculty-directory', sourceUrl: site },
  });
  await RoleAssignment.collection.insertOne({
    personId: other._id,
    target: { kind: 'RESEARCH_ENTITY', id: row._id },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    confidence: 0.9,
  });
  const observe = (field: string, value: unknown, sourceName: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: site,
      confidence: 0.9,
      observedAt: new Date('2026-06-01T00:00:00Z'),
      superseded: false,
    });
  await observe(
    'leadVerification',
    verification(site, owner._id, other._id, 'CONTRADICTED', '2026-06-01T00:00:00Z'),
    LAB_SITE_LEAD_VERIFICATION_SOURCE,
  );
  await observe('name', `${name} Renamed`, 'synthetic-lab-directory');
  return { row, owner, other };
};

const edgeStates = async (rowId: unknown) => {
  const edges = await RoleAssignment.find({ 'target.id': rowId })
    .select('personId state')
    .lean<Array<{ personId: unknown; state?: string }>>();
  return new Map(
    edges.map((edge) => [String(edge.personId), edge.state === 'HISTORICAL' ? 'ended' : 'live']),
  );
};

const storedVerdict = async (slug: string, personId: unknown) => {
  const row = await ResearchEntity.findOne({ slug })
    .select('leadVerification')
    .lean<{ leadVerification?: { leads?: Array<{ personId?: unknown; verdict?: string }> } }>();
  return row?.leadVerification?.leads?.find((lead) => String(lead.personId) === String(personId))
    ?.verdict;
};

const resolveLeadEdges = (slug: string) =>
  materializeEntity('researchEntity', { entityKey: slug }, { leadEdgesOnly: true });

describe('--only-fields=leadVerification feeds a new verdict to the leadEdges resolve (#5962)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('leaves the edge live while the stored verdict predates the contradiction', async () => {
    const asked = await seedLab('synthetic-quill-lab', 'Synthetic Quill Lab');

    await resolveLeadEdges(asked.row.slug);

    expect(await edgeStates(asked.row._id)).toEqual(
      new Map([
        [String(asked.owner._id), 'live'],
        [String(asked.other._id), 'live'],
      ]),
    );
  });

  it('ends only the asked row sourceless contradicted edge and writes no other field', async () => {
    const asked = await seedLab('synthetic-quill-lab', 'Synthetic Quill Lab');
    const bystander = await seedLab('synthetic-nimbus-lab', 'Synthetic Nimbus Lab');
    const args = parseRematerializeResearchEntitiesArgs([
      `--slugs=${asked.row.slug}`,
      '--only-fields=leadVerification',
    ]);

    const dryRun = await rematerializeSlug(args.slugs[0], false, args.onlyFields, false, false);
    const applied = await rematerializeSlug(args.slugs[0], true, args.onlyFields, false, false);
    const secondDryRun = await rematerializeSlug(
      args.slugs[0],
      false,
      args.onlyFields,
      false,
      false,
    );
    await resolveLeadEdges(asked.row.slug);

    for (const report of [dryRun, applied, secondDryRun]) {
      expect(report.found).toBe(true);
      expect(report.entityId).toBe(String(asked.row._id));
    }
    expect(secondDryRun.changes).toEqual([]);
    expect(dryRun.changes.map((change) => change.field)).toEqual(['leadVerification']);
    expect(applied.changes.map((change) => change.field)).toEqual(['leadVerification']);
    expect(await storedVerdict(asked.row.slug, asked.other._id)).toBe('CONTRADICTED');
    expect(await storedVerdict(bystander.row.slug, bystander.other._id)).toBe('CONFIRMED');
    expect((await ResearchEntity.findOne({ slug: asked.row.slug }).lean())?.name).toBe(
      'Synthetic Quill Lab',
    );
    expect(await edgeStates(asked.row._id)).toEqual(
      new Map([
        [String(asked.owner._id), 'live'],
        [String(asked.other._id), 'ended'],
      ]),
    );
    expect(await edgeStates(bystander.row._id)).toEqual(
      new Map([
        [String(bystander.owner._id), 'live'],
        [String(bystander.other._id), 'live'],
      ]),
    );
  });
});
