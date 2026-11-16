import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCorpusCoverageCounts } from '../corpusQualityReport';
import { readCorpusQualityLiveMetrics } from '../corpusQualityLiveMetrics';
import { auditStudentReadyPublicDescriptions } from '../researchEntityPublicDescriptionAuditService';

const row = (id: string, overrides: Record<string, unknown>) => ({
  _id: new mongoose.Types.ObjectId(id),
  slug: `fixture-${id.slice(-4)}`,
  name: `Fixture Lab ${id.slice(-4)}`,
  entityType: 'LAB',
  kind: 'lab',
  archived: false,
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

let memoryServer: MongoMemoryServer | undefined;

describe('served-row instruments exclude a held row (#6394)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('served_row_instruments_test'));
    await mongoose.connection
      .db!.collection('research_entities')
      .insertMany([
        row('000000000000000000006394', {}),
        row('000000000000000000006395', { studentVisibilityOverrideTier: 'operator_review' }),
        row('000000000000000000006396', { archived: true }),
      ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('counts only the unheld, unarchived row as served in the coverage counts', async () => {
    const counts = await readCorpusCoverageCounts();
    expect(counts.studentReady).toBe(1);
    expect(counts.byTier).toEqual(
      expect.arrayContaining([
        { tier: 'student_ready', count: 1 },
        { tier: 'operator_review', count: 1 },
      ]),
    );
  });

  it('counts only the unheld, unarchived row as served in the live metrics', async () => {
    const live = await readCorpusQualityLiveMetrics(new Date('2026-11-16T00:00:00.000Z'));
    expect(live.coverage.studentReady).toBe(1);
    expect(live.coverage.byTier).toEqual(
      expect.arrayContaining([
        { tier: 'student_ready', count: 1 },
        { tier: 'operator_review', count: 1 },
      ]),
    );
  });

  it('audits only the unheld, unarchived row', async () => {
    const report = await auditStudentReadyPublicDescriptions();
    expect(report.counts.scanned).toBe(1);
  });
});
