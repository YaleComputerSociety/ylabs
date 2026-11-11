import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import {
  applyResearchEntityDedupeMergeGroup,
  loadSamePiCandidateRows,
} from '../dedupeResearchEntitiesByPi';
import {
  buildFundingResearchEntityDedupePlan,
  buildNameAgreedSharedPersonResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  buildSharedPersonIdResearchEntityDedupePlan,
} from '../researchEntityPiDedupeCore';

const ids = {
  lead: new mongoose.Types.ObjectId(),
  coPi: new mongoose.Types.ObjectId(),
  sharedLab: new mongoose.Types.ObjectId(),
  coPiShell: new mongoose.Types.ObjectId(),
  coPiOwnLab: new mongoose.Types.ObjectId(),
  coPiFundingShell: new mongoose.Types.ObjectId(),
  leadProject: new mongoose.Types.ObjectId(),
};

const db = () => {
  const handle = mongoose.connection.db;
  if (!handle) throw new Error('no db');
  return handle;
};

const leadObservation = (
  entityId: mongoose.Types.ObjectId,
  slug: string,
  personId: mongoose.Types.ObjectId,
  sourceName: string,
) => ({
  entityType: 'researchEntity',
  entityId,
  entityKey: slug,
  field: 'inferredPiUserId',
  value: String(personId),
  sourceName,
  sourceUrl: `https://${sourceName}.example.org/${slug}`,
  confidence: 0.9,
  observedAt: new Date('2026-09-01T00:00:00Z'),
  superseded: false,
});

const leadEdge = (
  entityId: mongoose.Types.ObjectId,
  personId: mongoose.Types.ObjectId,
  sourceName: string,
) => ({
  personId,
  target: { kind: 'RESEARCH_ENTITY', id: entityId },
  role: 'PI',
  state: 'CURRENT',
  confidence: 0.9,
  reviewStatus: 'UNREVIEWED',
  archived: false,
  rosterProvenance: { sourceName },
});

async function seed(
  options: { coPiOwnLab?: boolean; coPiFundingShell?: boolean; leadProject?: boolean } = {},
) {
  await db()
    .collection('researchers')
    .insertMany([
      { _id: ids.lead, displayName: 'Ada Quill', archived: false },
      { _id: ids.coPi, displayName: 'Wren Ortolan', archived: false },
    ]);
  const entities: Record<string, unknown>[] = [
    {
      _id: ids.sharedLab,
      slug: 'coastal-sediment-lab',
      name: 'Coastal Sediment Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://coastal.example.edu/',
      sourceUrls: ['https://coastal.example.edu/'],
      archived: false,
    },
    {
      _id: ids.coPiShell,
      slug: 'faculty-research-area-wren-ortolan',
      name: 'Wren Ortolan Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      sourceUrls: ['https://dept.example.edu/people/wren-ortolan'],
      archived: false,
    },
  ];
  const edges = [
    leadEdge(ids.sharedLab, ids.lead, 'dept-faculty-roster'),
    leadEdge(ids.sharedLab, ids.coPi, 'nih-reporter'),
    leadEdge(ids.coPiShell, ids.coPi, 'dept-faculty-roster'),
  ];
  const observations = [
    leadObservation(ids.sharedLab, 'coastal-sediment-lab', ids.lead, 'dept-faculty-roster'),
    leadObservation(ids.sharedLab, 'coastal-sediment-lab', ids.coPi, 'nih-reporter'),
    leadObservation(
      ids.coPiShell,
      'faculty-research-area-wren-ortolan',
      ids.coPi,
      'dept-faculty-roster',
    ),
  ];
  if (options.coPiOwnLab) {
    entities.push({
      _id: ids.coPiOwnLab,
      slug: 'ortolan-tidal-lab',
      name: 'Tidal Flats Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://tidal.example.edu/',
      sourceUrls: ['https://tidal.example.edu/'],
      archived: false,
    });
    edges.push(leadEdge(ids.coPiOwnLab, ids.coPi, 'lab-microsite'));
    observations.push(
      leadObservation(ids.coPiOwnLab, 'ortolan-tidal-lab', ids.coPi, 'lab-microsite'),
    );
  }
  if (options.coPiFundingShell) {
    entities.push({
      _id: ids.coPiFundingShell,
      slug: 'nih-pi-wren-ortolan',
      name: 'Wren Ortolan Lab',
      kind: 'lab',
      entityType: 'LAB',
      sourceUrls: ['https://reporter.nih.gov/project-details/00000001'],
      fundingAgencies: ['NIH'],
      archived: false,
    });
    edges.push(leadEdge(ids.coPiFundingShell, ids.coPi, 'nih-reporter'));
    observations.push(
      leadObservation(ids.coPiFundingShell, 'nih-pi-wren-ortolan', ids.coPi, 'nih-reporter'),
    );
  }
  if (options.leadProject) {
    entities.push({
      _id: ids.leadProject,
      slug: 'harbor-survey-project',
      name: 'Harbor Survey Project',
      kind: 'lab',
      entityType: 'LAB',
      sourceUrls: ['https://dept.example.edu/projects/harbor-survey'],
      archived: false,
    });
    edges.push(leadEdge(ids.leadProject, ids.lead, 'dept-faculty-roster'));
    observations.push(
      leadObservation(ids.leadProject, 'harbor-survey-project', ids.lead, 'dept-faculty-roster'),
    );
  }
  await db().collection('research_entities').insertMany(entities);
  await db().collection('role_assignments').insertMany(edges);
  await db().collection('observations').insertMany(observations);
}

const allPlans = async () => {
  const rows = await loadSamePiCandidateRows(1000, { includeRetiredMembers: true });
  return {
    rows,
    plans: [
      ...buildResearchEntityPiDedupePlan(rows),
      ...buildSharedPersonIdResearchEntityDedupePlan(rows),
      ...buildNameAgreedSharedPersonResearchEntityDedupePlan(rows),
      ...buildFundingResearchEntityDedupePlan(rows),
    ],
  };
};

const touchesSharedLab = (plan: { canonicalEntityId: string; duplicateEntityIds: string[] }) =>
  [plan.canonicalEntityId, ...plan.duplicateEntityIds].includes(String(ids.sharedLab));

describe('PI folds never treat a grant co-PI listing as a same-row witness (#5776)', () => {
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
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'observations']) {
      await db().collection(name).deleteMany({});
    }
  });

  it('keeps a row the co-PI holds only through a grant out of the co-PI cluster', async () => {
    await seed();
    const { rows, plans } = await allPlans();
    expect(plans.filter(touchesSharedLab)).toEqual([]);
    const coPiRow = rows.find((row) => row.userId === String(ids.coPi));
    expect(coPiRow?.entities.map((entity) => entity.id)).toEqual([String(ids.coPiShell)]);
    expect(coPiRow?.grantCoPiListedEntityIds).toEqual([String(ids.sharedLab)]);
  });

  it('still lets the row lead its own lead cluster', async () => {
    await seed();
    const { rows } = await allPlans();
    const leadRow = rows.find((row) => row.userId === String(ids.lead));
    expect(leadRow?.entities.map((entity) => entity.id)).toEqual([String(ids.sharedLab)]);
    expect(leadRow?.grantCoPiListedEntityIds).toBeUndefined();
  });

  it('still folds the co-PI shell into a lab the co-PI leads on non-grant evidence', async () => {
    await seed({ coPiOwnLab: true });
    const { plans } = await allPlans();
    expect(plans.filter(touchesSharedLab)).toEqual([]);
    expect(
      buildResearchEntityPiDedupePlan(
        (await loadSamePiCandidateRows(1000, { includeRetiredMembers: true })).filter(
          (row) => row.userId === String(ids.coPi),
        ),
      ).map((plan) => [plan.canonicalEntityId, plan.duplicateEntityIds]),
    ).toEqual([[String(ids.coPiOwnLab), [String(ids.coPiShell)]]]);
  });

  it('keeps a funding shell whose sole lead is the grant PI in that PI cluster', async () => {
    await seed({ coPiFundingShell: true });
    const { rows } = await allPlans();
    const coPiRow = rows.find((row) => row.userId === String(ids.coPi));
    expect(coPiRow?.entities.map((entity) => entity.id).sort()).toEqual(
      [String(ids.coPiShell), String(ids.coPiFundingShell)].sort(),
    );
  });

  it('still quarantines the shared row as multi-person in the shared-person lanes', async () => {
    await seed({ leadProject: true });
    const rows = await loadSamePiCandidateRows(1000, { includeRetiredMembers: true });
    expect(buildSharedPersonIdResearchEntityDedupePlan(rows).filter(touchesSharedLab)).toEqual([]);
  });

  it('plans nothing new on a second run after the legitimate fold applies', async () => {
    await seed({ coPiOwnLab: true });
    const first = (await allPlans()).plans.filter((plan) => plan.userId === String(ids.coPi));
    const legitimate = first.find((plan) => plan.canonicalEntityId === String(ids.coPiOwnLab));
    expect(legitimate).toBeDefined();
    await applyResearchEntityDedupeMergeGroup(legitimate!, {
      deleteDuplicates: false,
      relinkReferences: true,
    });
    const second = (await allPlans()).plans;
    expect(second).toEqual([]);
    const sharedLab = await db().collection('research_entities').findOne({ _id: ids.sharedLab });
    expect(sharedLab?.archived).toBe(false);
    expect(sharedLab?.mergedFrom ?? []).toEqual([]);
  });
});
