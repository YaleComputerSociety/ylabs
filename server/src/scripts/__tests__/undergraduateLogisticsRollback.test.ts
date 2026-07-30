import { describe, expect, it } from 'vitest';
import {
  buildUndergraduateLogisticsRollbackPlan,
  undergraduateLogisticsRollbackObservationFilter,
  selectUndergraduateLogisticsRollbackPredecessors,
} from '../undergraduateLogisticsRollback';

describe('undergraduate logistics rollback planning', () => {
  it('builds a bounded idempotent plan from source-run observations', () => {
    const plan = buildUndergraduateLogisticsRollbackPlan([
      {
        _id: '64b000000000000000000001',
        entityId: '64b000000000000000000010',
        entityKey: 'sample-lab',
        observationFingerprint: 'source|researchEntity|sample-lab|field',
      },
      {
        _id: '64b000000000000000000001',
        entityId: '64b000000000000000000010',
        entityKey: 'sample-lab',
        observationFingerprint: 'source|researchEntity|sample-lab|field',
      },
    ]);

    expect(plan).toEqual({
      observationIds: ['64b000000000000000000001'],
      entityIds: ['64b000000000000000000010'],
      entityKeys: ['sample-lab'],
      observationFingerprints: ['source|researchEntity|sample-lab|field'],
    });
    expect(buildUndergraduateLogisticsRollbackPlan([])).toEqual({
      observationIds: [],
      entityIds: [],
      entityKeys: [],
      observationFingerprints: [],
    });
  });

  it('restores only the newest predecessor for each rolled-back fingerprint', () => {
    expect(
      selectUndergraduateLogisticsRollbackPredecessors([
        { _id: '64b000000000000000000001', observationFingerprint: 'first' },
        { _id: '64b000000000000000000002', observationFingerprint: 'first' },
        { _id: '64b000000000000000000003', observationFingerprint: 'second' },
      ]),
    ).toEqual(['64b000000000000000000001', '64b000000000000000000003']);
  });

  it('reconstructs the bounded plan after a partial rollback failure', () => {
    const filter = undergraduateLogisticsRollbackObservationFilter('64b000000000000000000099');

    expect(filter).toMatchObject({
      scrapeRunId: '64b000000000000000000099',
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      $or: [{ superseded: false }, { 'rollback.rolledBackAt': { $exists: true } }],
    });
    expect(filter.field.$in).toHaveLength(5);
  });
});
