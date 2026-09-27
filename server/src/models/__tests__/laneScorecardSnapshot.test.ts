import { describe, expect, it } from 'vitest';
import { LaneScorecardSnapshot } from '../laneScorecardSnapshot';

describe('LaneScorecardSnapshot', () => {
  it('stores the ingest-refused count beside emitted on the snapshot row', () => {
    const snapshot = new LaneScorecardSnapshot({
      environment: 'test',
      databaseName: 'ylabs-test',
      benchmarkId: 'synthetic-benchmark',
      sourceName: 'dept-faculty-roster',
      pagesServed: 1,
      pagesMissed: 0,
      emitted: 10,
      refusedAtIngest: 3,
      knownWrong: 0,
      labelsMatched: 0,
      labelCount: 0,
      outputFingerprint: 'fingerprint',
      byField: [{ field: 'websiteUrl', emitted: 10, labeledEntityEmitted: 0, knownWrong: 0 }],
    });

    expect(snapshot.validateSync()).toBeUndefined();
    expect(snapshot.toObject().refusedAtIngest).toBe(3);
  });
});
