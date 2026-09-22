import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  planStudentVisibilityGate,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const SHARED_SITE = 'https://quill-estuary.example.org/research';

const SHELL_ID = new mongoose.Types.ObjectId('000000000000000000001890');
const LAB_ID = new mongoose.Types.ObjectId('000000000000000000001891');
const PERSON_ID = new mongoose.Types.ObjectId('000000000000000000001892');

const SHORT_CARD =
  'Studies estuary nitrogen cycling across Long Island Sound salt marsh restoration sites.';
const FULL_BODY =
  'The group studies estuary nitrogen cycling across Long Island Sound salt marsh restoration sites, pairing seasonal porewater chemistry with sediment core incubations and remote-sensed vegetation change to explain why restored marshes retain nitrogen at very different rates.';

const seedRows = () => [
  {
    _id: SHELL_ID,
    slug: 'faculty-research-area-robin-quill',
    name: 'Robin Quill Faculty Research',
    displayName: 'Robin Quill Faculty Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    archived: false,
    shortDescription: SHORT_CARD,
    fullDescription: FULL_BODY,
    sourceUrls: [SHARED_SITE],
    // Public today, so the exact-URL contest reads this row as the canonical while
    // the same-PI dedupe reads the concrete lab as the canonical. The two verdicts
    // together are what left the pair with no student-visible card (#1890).
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
  },
  {
    _id: LAB_ID,
    slug: 'lab-quill-estuary',
    name: 'Quill Estuary Lab',
    displayName: 'Quill Estuary Lab',
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    shortDescription: SHORT_CARD,
    fullDescription: FULL_BODY,
    websiteUrl: SHARED_SITE,
    sourceUrls: [SHARED_SITE],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: [],
  },
];

const DUPLICATE_REASONS = ['duplicate_risk', 'exact_url_duplicate_risk'];

const duplicateReasonsOf = (plan: StudentVisibilityGatePlan): string[] =>
  plan.reasons.filter((reason) => DUPLICATE_REASONS.includes(reason));

let memoryServer: MongoMemoryServer | undefined;
let plans: StudentVisibilityGatePlan[] = [];

const planFor = (recordId: mongoose.Types.ObjectId, from = plans): StudentVisibilityGatePlan => {
  const plan = from.find((candidate) => candidate.recordId === String(recordId));
  if (!plan) throw new Error(`no gate plan for ${String(recordId)}`);
  return plan;
};

describe('a duplicate-url group always leaves one student-visible card (#1890)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('duplicate_url_group_survivor_test'));
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertMany(seedRows() as any[]);
    await db.collection('researchers').insertOne({
      _id: PERSON_ID,
      displayName: 'Robin Quill',
      firstName: 'Robin',
      lastName: 'Quill',
      netid: 'fixturequill',
      archived: false,
      profile: { title: 'Professor of Environmental Health Sciences' },
    });
    await db.collection('role_assignments').insertMany(
      [SHELL_ID, LAB_ID].map((entityId) => ({
        personId: PERSON_ID,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'PI',
        state: 'CURRENT',
        archived: false,
        verifiedAt: new Date(),
        source: { name: 'fixture-roster', url: SHARED_SITE },
      })),
    );
    plans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run' });
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('withdraws the duplicate hold from exactly one member of the pair', () => {
    const released = [SHELL_ID, LAB_ID].filter(
      (recordId) => duplicateReasonsOf(planFor(recordId)).length === 0,
    );
    const held = [SHELL_ID, LAB_ID].filter((recordId) =>
      duplicateReasonsOf(planFor(recordId)).includes('duplicate_risk'),
    );

    expect(released.map(String)).toHaveLength(1);
    expect(held.map(String)).toHaveLength(1);
  });

  it('reaches the same duplicate verdict when the gate is run over one record', async () => {
    for (const recordId of [SHELL_ID, LAB_ID]) {
      const targetedPlans = await planStudentVisibilityGate({
        collection: 'research',
        mode: 'dry-run',
        recordIds: [String(recordId)],
      });

      expect(targetedPlans.map((plan) => plan.recordId)).toEqual([String(recordId)]);
      expect(duplicateReasonsOf(planFor(recordId, targetedPlans))).toEqual(
        duplicateReasonsOf(planFor(recordId)),
      );
    }
  });
});
