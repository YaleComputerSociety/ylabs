import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SHELL_ONLY_TOPIC = 'Shell Only Topic';

const gate = vi.hoisted(() => ({
  simulatedAreas: [] as string[][],
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/studentVisibilityTier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/studentVisibilityTier')>();
  return {
    ...actual,
    computeResearchEntityStudentVisibility: (input: { entity: { researchAreas?: string[] } }) => {
      const areas = input.entity.researchAreas || [];
      gate.simulatedAreas.push(areas);
      return areas.includes(SHELL_ONLY_TOPIC)
        ? { tier: 'student_ready', reasons: [] }
        : { tier: 'operator_review', reasons: ['missing_card_description'] };
    },
  };
});

import { resolveNonDemotingMerge } from '../dedupeResearchEntitiesByPi';

describe('never-demote prediction reads only the topics the merge carries', () => {
  let replSet: MongoMemoryReplSet;
  const survivorId = new mongoose.Types.ObjectId();
  const shellId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    gate.simulatedAreas = [];
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('research_entities').insertMany([
      {
        _id: survivorId,
        slug: 'bbs-synthetic-survivor',
        name: 'Synthetic Survivor',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
        studentVisibilityTier: 'operator_review',
        researchAreas: ['Survivor Topic'],
      },
      {
        _id: shellId,
        slug: 'nih-pi-synthetic-shell',
        name: 'Synthetic Shell',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
        studentVisibilityTier: 'student_ready',
        researchAreas: [SHELL_ONLY_TOPIC],
      },
    ]);
  });

  const survivorKept = (resolution: { defer: boolean; canonicalId: mongoose.Types.ObjectId }) =>
    !resolution.defer && resolution.canonicalId.equals(survivorId);

  it('does not keep a survivor whose card only derives from a low-trust shell topic', async () => {
    const resolution = await resolveNonDemotingMerge(survivorId, [shellId]);

    expect(survivorKept(resolution)).toBe(false);
    expect(gate.simulatedAreas[0]).toEqual(['Survivor Topic']);
  });

  it('predicts the survivor from the planned carry when the plan supplies it', async () => {
    const resolution = await resolveNonDemotingMerge(survivorId, [shellId], {
      mergedResearchAreas: ['Survivor Topic'],
      mergedSourceUrls: [],
      mergedDepartments: [],
    });

    expect(survivorKept(resolution)).toBe(false);
    expect(gate.simulatedAreas[0]).toEqual(['Survivor Topic']);
  });

  it('keeps the survivor when the planned carry really brings the topic over', async () => {
    const resolution = await resolveNonDemotingMerge(survivorId, [shellId], {
      mergedResearchAreas: [SHELL_ONLY_TOPIC],
      mergedSourceUrls: [],
      mergedDepartments: [],
    });

    expect(survivorKept(resolution)).toBe(true);
  });
});
