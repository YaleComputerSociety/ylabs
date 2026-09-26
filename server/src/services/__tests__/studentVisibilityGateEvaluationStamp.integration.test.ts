import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => 0),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
  runStudentVisibilityGateForPlans,
} from '../studentVisibilityGateService';
import { classifyRecoverabilityForRecordIds } from '../visibilityRecoverabilityService';

const id = (hex: string) => new mongoose.Types.ObjectId(hex);

const FIELD_BODY =
  'The Example Coastal Systems Laboratory studies shoreline erosion, sediment transport, and coastal adaptation, and it takes Yale undergraduates onto its field season each summer through a posted application with a named faculty mentor.';

const SUBJECT_IDS = {
  describedLab: id('000000000000000000002604'),
  undescribedLab: id('000000000000000000002605'),
  stampedOnly: id('000000000000000000002606'),
  neverDecided: id('000000000000000000002607'),
};

const SEEDED_AT = new Date('2026-01-02T00:00:00.000Z');

const seedRows = () => [
  {
    _id: SUBJECT_IDS.describedLab,
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    slug: 'synthetic-coastal-systems-lab',
    name: 'Example Coastal Systems Laboratory',
    fullDescription: FIELD_BODY,
    shortDescription:
      'A coastal-systems lab that takes Yale undergraduates onto its summer field season.',
    websiteUrl: 'https://lab.example.yale.edu',
    sourceUrls: ['https://lab.example.yale.edu'],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: ['missing_description'],
    studentVisibilityComputedAt: SEEDED_AT,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  },
  {
    _id: SUBJECT_IDS.undescribedLab,
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    slug: 'synthetic-sediment-dynamics-lab',
    name: 'Example Sediment Dynamics Laboratory',
    websiteUrl: 'https://sediment.example.yale.edu',
    sourceUrls: ['https://sediment.example.yale.edu'],
    studentVisibilityTier: 'operator_review',
    studentVisibilityReasons: ['missing_description'],
    studentVisibilityComputedAt: SEEDED_AT,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  },
];

type StoredGateFields = {
  computedAt?: Date;
  evaluatedAt?: Date;
  updatedAt?: Date;
};

const readGateFields = async (): Promise<Map<string, StoredGateFields>> => {
  const docs = await mongoose.connection.db!.collection('research_entities').find({}).toArray();
  return new Map(
    docs.map((doc) => [
      String(doc.slug),
      {
        computedAt: doc.studentVisibilityComputedAt as Date | undefined,
        evaluatedAt: doc.studentVisibilityEvaluatedAt as Date | undefined,
        updatedAt: doc.updatedAt as Date | undefined,
      },
    ]),
  );
};

const applyGatePass = async () => {
  const plans = await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run' });
  const report = await runStudentVisibilityGateForPlans(plans, {
    mode: 'dry-run',
    collection: 'research',
  });
  await applyStudentVisibilityGatePlans(plans);
  return { changed: report.counts.changed, stored: await readGateFields() };
};

describe('the gate records every row it decides, not only the ones it changes (#2604)', () => {
  let memoryServer: MongoMemoryServer | undefined;
  let firstPass: Awaited<ReturnType<typeof applyGatePass>>;
  let secondPass: Awaited<ReturnType<typeof applyGatePass>>;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('student_visibility_evaluation_stamp_test'));
    await mongoose.connection.db!.collection('research_entities').insertMany(seedRows() as any[]);
    firstPass = await applyGatePass();
    // Distinct wall-clock instants, so "the stamp moved forward" is observable rather
    // than an equality that a frozen clock would satisfy either way.
    await new Promise((resolve) => setTimeout(resolve, 30));
    secondPass = await applyGatePass();
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('stamps both the change and the evaluation on the run that changed the row', () => {
    expect(firstPass.changed).toBe(2);
    for (const slug of ['synthetic-coastal-systems-lab', 'synthetic-sediment-dynamics-lab']) {
      const stored = firstPass.stored.get(slug)!;
      expect(stored.computedAt!.getTime()).toBeGreaterThan(SEEDED_AT.getTime());
      expect(stored.evaluatedAt).toEqual(stored.computedAt);
      expect(stored.updatedAt!.getTime()).toBeGreaterThan(SEEDED_AT.getTime());
    }
  });

  it('records a re-gate that changed nothing, which the change stamp alone cannot show', () => {
    expect(secondPass.changed).toBe(0);
    for (const slug of ['synthetic-coastal-systems-lab', 'synthetic-sediment-dynamics-lab']) {
      const before = firstPass.stored.get(slug)!;
      const after = secondPass.stored.get(slug)!;
      expect(after.computedAt).toEqual(before.computedAt);
      expect(after.evaluatedAt!.getTime()).toBeGreaterThan(before.evaluatedAt!.getTime());
    }
  });

  // The stamp-only write must not look like a document change: `updatedAt` is a Meili
  // sortable attribute that the gate deliberately does not resync for unchanged rows,
  // and the materializer breaks duplicate-title ties on it.
  it('leaves updatedAt alone on a row it re-decided without changing', () => {
    for (const slug of ['synthetic-coastal-systems-lab', 'synthetic-sediment-dynamics-lab']) {
      expect(secondPass.stored.get(slug)!.updatedAt).toEqual(firstPass.stored.get(slug)!.updatedAt);
    }
  });

  it('stops calling a row the gate decided and left unchanged never gated', async () => {
    await mongoose.connection.db!.collection('research_entities').insertMany([
      {
        _id: SUBJECT_IDS.stampedOnly,
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        slug: 'synthetic-regated-unchanged-lab',
        name: 'Example Regated Unchanged Laboratory',
        fullDescription: FIELD_BODY,
        sourceUrls: ['https://regated.example.yale.edu'],
        studentVisibilityTier: 'operator_review',
        studentVisibilityReasons: [],
        studentVisibilityEvaluatedAt: new Date(),
      },
      {
        _id: SUBJECT_IDS.neverDecided,
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        slug: 'synthetic-never-decided-lab',
        name: 'Example Never Decided Laboratory',
        fullDescription: FIELD_BODY,
        sourceUrls: ['https://neverdecided.example.yale.edu'],
        studentVisibilityTier: 'operator_review',
        studentVisibilityReasons: [],
      },
    ] as any[]);

    const { byRecordId } = await classifyRecoverabilityForRecordIds([
      String(SUBJECT_IDS.stampedOnly),
      String(SUBJECT_IDS.neverDecided),
    ]);

    expect(byRecordId.get(String(SUBJECT_IDS.stampedOnly))?.bucket).toBe('ceiling');
    expect(byRecordId.get(String(SUBJECT_IDS.neverDecided))?.bucket).toBe('regate');
  });
});
