import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  isBlockingVisibilityReason,
  isUnexplainedHeldVisibilityPlan,
  planStudentVisibilityGate,
  runStudentVisibilityGateForPlans,
  studentVisibilityGateUnexplainedHeldBlocker,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const ORGANIZATIONAL_BODY =
  'The Yale Initiative for Example Coastal Systems convenes faculty and students across geology, ecology, and engineering to study coastal erosion, sediment transport, and shoreline adaptation, and it runs a visiting-scholar programme and an annual field season.';

const id = (hex: string) => new mongoose.Types.ObjectId(hex);

const SUBJECT_IDS = {
  organizationalSparseCard: id('000000000000000000002818'),
  labSparseCard: id('000000000000000000002819'),
  overriddenToReview: id('00000000000000000000281a'),
  noBodyAtAll: id('00000000000000000000281b'),
  exemptCardOverUnusableBody: id('00000000000000000000281c'),
};

const seedRows = () => [
  {
    _id: SUBJECT_IDS.organizationalSparseCard,
    kind: 'initiative',
    entityType: 'INITIATIVE',
    archived: false,
    slug: 'initiative-example-coastal-systems',
    name: 'Yale Initiative for Example Coastal Systems',
    fullDescription: ORGANIZATIONAL_BODY,
    websiteUrl: 'https://coastal.example.yale.edu',
    sourceUrls: ['https://coastal.example.yale.edu'],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
  },
  {
    _id: SUBJECT_IDS.labSparseCard,
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    slug: 'lab-example-coastal-systems',
    name: 'Example Coastal Systems Laboratory',
    fullDescription: ORGANIZATIONAL_BODY,
    websiteUrl: 'https://lab.example.yale.edu',
    sourceUrls: ['https://lab.example.yale.edu'],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: [],
  },
  {
    _id: SUBJECT_IDS.overriddenToReview,
    kind: 'initiative',
    entityType: 'INITIATIVE',
    archived: false,
    slug: 'initiative-example-held-by-operator',
    name: 'Yale Initiative for Example Held Systems',
    fullDescription: ORGANIZATIONAL_BODY,
    websiteUrl: 'https://held.example.yale.edu',
    sourceUrls: ['https://held.example.yale.edu'],
    studentVisibilityOverrideTier: 'operator_review',
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: [],
  },
  {
    _id: SUBJECT_IDS.noBodyAtAll,
    kind: 'initiative',
    entityType: 'INITIATIVE',
    archived: false,
    slug: 'initiative-example-no-body',
    name: 'Yale Initiative for Example Nothing',
    websiteUrl: 'https://nothing.example.yale.edu',
    sourceUrls: ['https://nothing.example.yale.edu'],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: [],
  },
  {
    _id: SUBJECT_IDS.exemptCardOverUnusableBody,
    kind: 'program',
    entityType: 'PROGRAM',
    archived: false,
    slug: 'program-example-coastal-fellowship',
    name: 'Yale Example Coastal Systems Summer Fellowship',
    fullDescription: 'April 3, 2024 | News | Read more about the new director announcement.',
    shortDescription:
      'The fellowship supports undergraduates spending a summer on coastal-systems fieldwork with a faculty mentor.',
    websiteUrl: 'https://coastal.example.yale.edu/fellowship',
    sourceUrls: ['https://coastal.example.yale.edu/fellowship'],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
  },
];

const AUDIENCE_UNKNOWN_PROGRAM_ID = id('00000000000000000000281d');

const seedPrograms = () => [
  {
    _id: AUDIENCE_UNKNOWN_PROGRAM_ID,
    archived: false,
    title: 'Example Coastal Systems Center Research Internship',
    programKind: 'CENTER_INTERNSHIP',
    entryMode: 'APPLY_TO_PROGRAM',
    studentFacingCategory: 'Research internship',
    description:
      'The centre places students with its research groups for a term of paid coastal-systems research work.',
    sourceUrl: 'https://coastal.example.yale.edu/internship',
    applicationLink: 'https://coastal.example.yale.edu/internship/apply',
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: [],
  },
];

let memoryServer: MongoMemoryServer | undefined;
let plans: StudentVisibilityGatePlan[] = [];
let allPlans: StudentVisibilityGatePlan[] = [];

const planFor = (recordId: mongoose.Types.ObjectId): StudentVisibilityGatePlan => {
  const plan = plans.find((candidate) => candidate.recordId === String(recordId));
  if (!plan) throw new Error(`no gate plan for ${String(recordId)}`);
  return plan;
};

describe('every held research row records why it is held (#2818)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('student_visibility_held_rows_test'));
    await mongoose.connection.db!.collection('research_entities').insertMany(seedRows() as any[]);
    await mongoose.connection.db!.collection('fellowships').insertMany(seedPrograms() as any[]);
    plans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run' });
    allPlans = await planStudentVisibilityGate({ collection: 'all', mode: 'dry-run' });
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('holds no row at operator_review with neither a hard blocker nor an operator override', () => {
    const unexplained = plans.filter(isUnexplainedHeldVisibilityPlan);

    expect(unexplained.map((plan) => plan.label)).toEqual([]);
  });

  it('reports the same invariant as a gate-run counter', async () => {
    const report = await runStudentVisibilityGateForPlans(plans, {
      mode: 'dry-run',
      collection: 'research',
    });

    expect(report.counts.unexplainedHeld).toBe(0);
  });

  it('publishes the organizational row whose lab-style card is exempt', () => {
    const plan = planFor(SUBJECT_IDS.organizationalSparseCard);

    expect(plan.reasons).not.toContain('missing_card_description');
    expect(plan.tier).toBe('student_ready');
  });

  it('holds the lab row in the same state on a recorded card blocker', () => {
    const plan = planFor(SUBJECT_IDS.labSparseCard);

    expect(plan.tier).toBe('operator_review');
    expect(plan.reasons.filter(isBlockingVisibilityReason)).toContain('missing_card_description');
  });

  it('counts an explicit operator hold as explained by the override itself', () => {
    const plan = planFor(SUBJECT_IDS.overriddenToReview);

    expect(plan.tier).toBe('operator_review');
    expect(plan.reasons.filter(isBlockingVisibilityReason)).toEqual([]);
    expect(plan.reasons).toContain('operator_override');
    expect(isUnexplainedHeldVisibilityPlan(plan)).toBe(false);
  });

  it('holds the body-less organizational row on a recorded description blocker', () => {
    const plan = planFor(SUBJECT_IDS.noBodyAtAll);

    expect(plan.tier).toBe('operator_review');
    expect(plan.reasons.filter(isBlockingVisibilityReason)).toContain('missing_description');
  });

  it('holds the exempt-card row whose body fails the invariant on a recorded blocker', () => {
    const plan = planFor(SUBJECT_IDS.exemptCardOverUnusableBody);

    expect(plan.tier).toBe('operator_review');
    expect(plan.reasons).not.toContain('missing_card_description');
    expect(plan.reasons.filter(isBlockingVisibilityReason)).toContain(
      'public_description_invariant_failed',
    );
  });

  it('raises an apply blocker only when the counter is non-zero', async () => {
    const report = await runStudentVisibilityGateForPlans(plans, {
      mode: 'dry-run',
      collection: 'research',
    });

    expect(
      studentVisibilityGateUnexplainedHeldBlocker(report.counts.unexplainedHeld),
    ).toBeUndefined();
    expect(studentVisibilityGateUnexplainedHeldBlocker(3)).toContain('3 row(s)');
  });

  it('does not refuse a whole-corpus apply over a program hold the invariant cannot describe', async () => {
    const programPlan = allPlans.find(
      (plan) => plan.recordId === String(AUDIENCE_UNKNOWN_PROGRAM_ID),
    );

    expect(programPlan?.tier).toBe('operator_review');
    expect(programPlan?.reasons.filter(isBlockingVisibilityReason)).toEqual([]);
    expect(programPlan?.reasons).not.toContain('operator_override');
    expect(isUnexplainedHeldVisibilityPlan(programPlan!)).toBe(false);

    const report = await runStudentVisibilityGateForPlans(allPlans, {
      mode: 'dry-run',
      collection: 'all',
    });

    expect(report.counts.unexplainedHeld).toBe(0);
    expect(
      studentVisibilityGateUnexplainedHeldBlocker(report.counts.unexplainedHeld),
    ).toBeUndefined();
  });

  it('flags a held plan that records no blocker at all, so the invariant is not vacuous', () => {
    const plan = {
      ...planFor(SUBJECT_IDS.noBodyAtAll),
      tier: 'operator_review' as const,
      reasons: ['source_backed_description', 'concrete_next_step'],
    };

    expect(isUnexplainedHeldVisibilityPlan(plan)).toBe(true);
  });
});
