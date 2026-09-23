import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  describeGateRefreshOutcome,
  gateDetailFromNormalizedArtifact,
  storedGateArtifact,
  storedGateScorecardPathLabel,
  storedScorecardSupersedesFile,
  type StoredGateScorecard,
} from '../gateScorecardSnapshotStore';
import {
  buildGateArtifactFreshness,
  chooseGateArtifact,
  deriveDataQualityGate,
  readDataQualityGateArtifact,
  GATE_SCORECARD_MAX_AGE_HOURS,
  type DataQualityGateArtifact,
} from '../adminOperatorBoardService';
import { GATE_SCORECARD_SNAPSHOT_COLLECTION } from '../../models/gateScorecardSnapshot';
import {
  NEVER_COPY_COLLECTIONS,
  assertNoNeverCopyCollections,
} from '../../scripts/mirrorCollectionPolicy';

const MEASURED_AT = new Date('2026-06-07T00:00:00.000Z');

function storedRow(overrides: Partial<StoredGateScorecard> = {}): StoredGateScorecard {
  return {
    gate: 'dataQuality',
    environment: 'beta',
    databaseName: 'Beta',
    measuredAt: MEASURED_AT,
    storedAt: MEASURED_AT,
    refreshRunId: 'run-1',
    evaluated: {
      command: 'yarn beta:data-quality --include-samples',
      exitCode: 0,
      artifactWritten: true,
      artifactPath: '/tmp/ylabs-beta-quality.json',
      artifactGeneratedAt: MEASURED_AT.toISOString(),
      artifactDatabase: 'Beta',
      artifactEnvironment: 'beta',
    },
    summary: {
      promotionReady: false,
      promotionBlockerCount: 3,
      hardErrors: [],
      promotionBlockersByOwner: [],
      recommendedCommands: [],
    },
    ...overrides,
  };
}

describe('gate scorecard snapshot store', () => {
  it('stores only gate detail, leaving status and provenance to the row', () => {
    const detail = gateDetailFromNormalizedArtifact({
      artifactStatus: 'loaded',
      artifactPath: '/tmp/ylabs-beta-quality.json',
      generatedAt: MEASURED_AT.toISOString(),
      promotionReady: false,
      promotionBlockerCount: 3,
    });

    expect(detail).toEqual({ promotionReady: false, promotionBlockerCount: 3 });
  });

  it('renders a stored row as a loaded verdict the gate can judge', () => {
    const artifact = storedGateArtifact<DataQualityGateArtifact>(
      storedRow(),
      GATE_SCORECARD_MAX_AGE_HOURS,
      new Date('2026-06-07T00:30:00.000Z'),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'loaded',
      artifactPath: `${GATE_SCORECARD_SNAPSHOT_COLLECTION}:dataQuality`,
      generatedAt: MEASURED_AT.toISOString(),
      promotionReady: false,
      promotionBlockerCount: 3,
    });
    expect(deriveDataQualityGate(artifact)).toMatchObject({ status: 'blocked' });
  });

  it('downgrades a stored row past the TTL to a rerun rather than a live verdict', () => {
    const artifact = storedGateArtifact<DataQualityGateArtifact>(
      storedRow(),
      GATE_SCORECARD_MAX_AGE_HOURS,
      new Date(MEASURED_AT.getTime() + (GATE_SCORECARD_MAX_AGE_HOURS + 1) * 60 * 60 * 1000),
    );

    expect(artifact).toMatchObject({
      artifactStatus: 'stale',
      ageHours: GATE_SCORECARD_MAX_AGE_HOURS + 1,
    });
    expect(deriveDataQualityGate(artifact)).toMatchObject({ status: 'manual' });
  });

  it('names the refresh run that could not evaluate the gate', () => {
    const artifact = storedGateArtifact<DataQualityGateArtifact>(
      storedRow({
        summary: undefined,
        refreshRunId: 'run-7',
        evaluated: {
          command: 'yarn beta:data-quality --include-samples',
          exitCode: 2,
          artifactWritten: false,
          failureReason: 'the feeder wrote no scorecard',
        },
      }),
      GATE_SCORECARD_MAX_AGE_HOURS,
      new Date('2026-06-07T00:30:00.000Z'),
    );

    expect(artifact).toMatchObject({ artifactStatus: 'invalid' });
    expect((artifact as { error: string }).error).toContain('run-7');
    expect((artifact as { error: string }).error).toContain('the feeder wrote no scorecard');
    expect((artifact as { error: string }).error).toContain('exit 2');
  });

  it('records a failed refresh instead of leaving the previous verdict stored', () => {
    expect(describeGateRefreshOutcome(false, undefined)).toEqual({
      failureReason: 'the feeder wrote no scorecard',
    });
    expect(describeGateRefreshOutcome(true, undefined)).toEqual({
      failureReason: 'the scorecard could not be read back',
    });
    expect(describeGateRefreshOutcome(true, { artifactStatus: 'invalid' })).toEqual({
      failureReason: 'the scorecard read back as invalid',
    });
    expect(
      describeGateRefreshOutcome(true, { artifactStatus: 'loaded', promotionReady: true }),
    ).toEqual({ summary: { promotionReady: true } });
  });

  it('yields to an artifact file only when the file is the newer measurement', () => {
    const row = storedRow();
    expect(storedScorecardSupersedesFile(row, undefined)).toBe(true);
    expect(storedScorecardSupersedesFile(row, MEASURED_AT.toISOString())).toBe(true);
    expect(storedScorecardSupersedesFile(row, 'not a timestamp')).toBe(true);
    expect(storedScorecardSupersedesFile(row, '2026-06-07T01:00:00.000Z')).toBe(false);
    expect(storedScorecardSupersedesFile(undefined, undefined)).toBe(false);
  });

  it('serves the stored verdict when the deploy wiped the artifact file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-gate-snapshot-'));
    const wipedPath = path.join(dir, 'ylabs-beta-quality.json');
    const fileArtifact = readDataQualityGateArtifact(wipedPath);

    expect(fileArtifact).toBeUndefined();
    expect(
      chooseGateArtifact(fileArtifact, storedRow(), new Date('2026-06-07T00:30:00.000Z')),
    ).toMatchObject({ artifactStatus: 'loaded', promotionBlockerCount: 3 });
  });

  it('prefers a hand-run artifact file generated after the stored row', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-gate-snapshot-'));
    const artifactPath = path.join(dir, 'ylabs-beta-quality.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-06-07T00:20:00.000Z',
        summary: { promotionReady: true, promotionBlockerCount: 0 },
      }),
    );
    const now = new Date('2026-06-07T00:30:00.000Z');

    expect(
      chooseGateArtifact(readDataQualityGateArtifact(artifactPath, now), storedRow(), now),
    ).toMatchObject({ artifactStatus: 'loaded', artifactPath, promotionBlockerCount: 0 });
  });

  it('lets a failed refresh replace the older file it failed to rewrite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-gate-snapshot-'));
    const artifactPath = path.join(dir, 'ylabs-beta-quality.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        generatedAt: '2026-06-06T23:50:00.000Z',
        summary: { promotionReady: true, promotionBlockerCount: 0 },
      }),
    );
    const now = new Date('2026-06-07T00:30:00.000Z');
    const failedRefresh = storedRow({
      summary: undefined,
      evaluated: {
        command: 'yarn beta:data-quality --include-samples',
        exitCode: 2,
        artifactWritten: false,
        failureReason: 'the feeder wrote no scorecard',
      },
    });

    expect(readDataQualityGateArtifact(artifactPath, now)).toMatchObject({
      artifactStatus: 'loaded',
      promotionReady: true,
    });
    expect(
      chooseGateArtifact(readDataQualityGateArtifact(artifactPath, now), failedRefresh, now),
    ).toMatchObject({ artifactStatus: 'invalid' });
  });

  it('reports stored provenance in the freshness strip instead of a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-gate-snapshot-'));
    const previous = process.env.BETA_DATA_QUALITY_SCORECARD_PATH;
    process.env.BETA_DATA_QUALITY_SCORECARD_PATH = path.join(dir, 'does-not-exist.json');
    try {
      const freshness = buildGateArtifactFreshness(
        new Date('2026-06-07T00:30:00.000Z'),
        new Map([['dataQuality', storedRow()]]),
      );

      expect(freshness.find((row) => row.gate === 'dataQuality')).toMatchObject({
        status: 'fresh',
        exists: true,
        path: storedGateScorecardPathLabel('dataQuality'),
        generatedAt: MEASURED_AT.toISOString(),
        ageMinutes: 30,
        db: 'Beta',
        environment: 'beta',
      });
      expect(freshness.find((row) => row.gate === 'productionCopy')).toMatchObject({
        status: 'missing',
      });
    } finally {
      if (previous === undefined) delete process.env.BETA_DATA_QUALITY_SCORECARD_PATH;
      else process.env.BETA_DATA_QUALITY_SCORECARD_PATH = previous;
    }
  });

  it('marks a gate whose stored refresh produced nothing as unreadable, not fresh', () => {
    const freshness = buildGateArtifactFreshness(
      new Date('2026-06-07T00:30:00.000Z'),
      new Map([
        [
          'dataQuality',
          storedRow({
            summary: undefined,
            evaluated: {
              command: 'yarn beta:data-quality --include-samples',
              exitCode: 2,
              artifactWritten: false,
              failureReason: 'the feeder wrote no scorecard',
            },
          }),
        ],
      ]),
    );

    expect(freshness.find((row) => row.gate === 'dataQuality')).toMatchObject({
      status: 'unreadable',
    });
  });

  it('keeps gate verdicts out of the promotion copy set', () => {
    expect(NEVER_COPY_COLLECTIONS).toContain(GATE_SCORECARD_SNAPSHOT_COLLECTION);
    expect(() => assertNoNeverCopyCollections([GATE_SCORECARD_SNAPSHOT_COLLECTION])).toThrow(
      /Refusing to mirror environment-local collections/,
    );
  });
});
