import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
  readIndexedFieldByDocumentId: vi.fn(async () => new Map()),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
  readIndexedFieldByDocumentId: meiliMocks.readIndexedFieldByDocumentId,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { setDirectoryRemovalServingForTest } from '../directoryRemovalServing';
import {
  planStudentVisibilityGate,
  runStudentVisibilityGate,
} from '../studentVisibilityGateService';
import { LEAD_IS_STAFF_OF_SERVED_LAB_REASON } from '../studentVisibilityTier';

const FACULTY_LAB_SLUG = 'synthetic-faculty-neonatal-lab';
const STAFF_ROW_SLUG = 'synthetic-staff-neonatal-lab';
const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

type Persisted = {
  _id: mongoose.Types.ObjectId;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
  manuallyLockedFields?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<Persisted>() as Promise<Persisted>;

describe('the gate holds a staff-led row linked to a served lab (#5876)', () => {
  let replSet: MongoMemoryReplSet;
  let staffPersonId: mongoose.Types.ObjectId;
  let facultyLabId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    setDirectoryRemovalServingForTest(undefined);
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const seedPerson = async (lastName: string, netid: string, title: string) => {
    const personId = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('researchers').insertOne({
      _id: personId,
      schemaVersion: 1,
      displayName: `Robin ${lastName}`,
      profile: { title },
      identifiers: { netid },
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    return personId;
  };

  const seedEdge = (
    personId: mongoose.Types.ObjectId,
    entityId: mongoose.Types.ObjectId,
    role: string,
  ) =>
    mongoose.connection.db!.collection('role_assignments').insertOne({
      schemaVersion: 1,
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role,
      state: 'CURRENT',
      confidence: 1,
      reviewStatus: 'APPROVED',
      archived: false,
    });

  const seedLab = async (slug: string, lastName: string, leadId: mongoose.Types.ObjectId) => {
    const entityId = new mongoose.Types.ObjectId();
    const sourceUrl = `https://medicine.example.edu/labs/${slug}/`;
    await mongoose.connection.db!.collection('research_entities').insertOne({
      _id: entityId,
      slug,
      name: `${lastName} Neonatal Outcomes Lab`,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      activeAtYaleCache: true,
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-lab', sourceUrl },
        fullDescription: { sourceName: 'fixture-lab', sourceUrl },
      },
    });
    await seedEdge(leadId, entityId, 'PI');
    return entityId;
  };

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
      'directory_removals',
    ]) {
      await db.collection(name).deleteMany({});
    }
    setDirectoryRemovalServingForTest(undefined);
    const facultyId = await seedPerson('Quill', 'zz9201', 'Associate Professor of Pediatrics');
    staffPersonId = await seedPerson('Teal', 'zz9202', 'Associate Research Scientist');
    facultyLabId = await seedLab(FACULTY_LAB_SLUG, 'Quill', facultyId);
    await seedLab(STAFF_ROW_SLUG, 'Teal', staffPersonId);
  });

  it('serves the staff-led row while its lead holds no edge on the served lab', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect((await persisted(FACULTY_LAB_SLUG)).studentVisibilityTier).toBe('student_ready');
    const staffRow = await persisted(STAFF_ROW_SLUG);
    expect(staffRow.studentVisibilityTier).toBe('student_ready');
    expect(staffRow.studentVisibilityReasons).not.toContain(LEAD_IS_STAFF_OF_SERVED_LAB_REASON);
  }, 60000);

  it('holds the staff-led row on every pass, writes no lock, and changes nothing the second time', async () => {
    await seedEdge(staffPersonId, facultyLabId, 'STAFF');
    const first = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(first.counts.changed).toBeGreaterThan(0);
    const second = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect(second.counts.changed).toBe(0);

    const staffRow = await persisted(STAFF_ROW_SLUG);
    expect(staffRow.studentVisibilityTier).toBe('suppressed');
    expect(staffRow.studentVisibilityReasons).toContain(LEAD_IS_STAFF_OF_SERVED_LAB_REASON);
    expect(staffRow.manuallyLockedFields ?? []).toEqual([]);
    const facultyLab = await persisted(FACULTY_LAB_SLUG);
    expect(facultyLab.studentVisibilityTier).toBe('student_ready');
    expect(facultyLab.studentVisibilityReasons).not.toContain(LEAD_IS_STAFF_OF_SERVED_LAB_REASON);
  }, 60000);

  it('reaches the same verdict when the pass is scoped to the staff-led row alone', async () => {
    await seedEdge(staffPersonId, facultyLabId, 'STAFF');
    const staffRowId = String((await persisted(STAFF_ROW_SLUG))._id);
    const [plan] = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: [staffRowId],
    });
    expect(plan.recordId).toBe(staffRowId);
    expect(plan.tier).toBe('suppressed');
    expect(plan.reasons).toContain(LEAD_IS_STAFF_OF_SERVED_LAB_REASON);
  }, 60000);
});
