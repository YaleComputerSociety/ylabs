import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertStudentVisibilityBackfillApplyAllowed,
  buildStudentVisibilityBackfillOutput,
  parseStudentVisibilityBackfillArgs,
  writeStudentVisibilityBackfillOutput,
} from '../backfillStudentVisibilityTiers';
import {
  buildCollectionReport,
  nextRepairActionForReasons,
  type StudentVisibilityPlannedUpdate,
} from '../studentVisibilityBackfillReport';

const update = (
  overrides: Partial<StudentVisibilityPlannedUpdate>,
): StudentVisibilityPlannedUpdate => ({
  id: 'entity-1',
  label: 'Example Lab',
  currentTier: undefined,
  tier: 'operator_review',
  computedTier: 'operator_review',
  reasons: ['missing_lead'],
  ...overrides,
});

describe('studentVisibilityBackfillReport', () => {
  it('blocks research applies when computed public tiers collapse to zero', () => {
    const report = buildCollectionReport(
      [
        update({ id: 'entity-1', reasons: ['missing_lead', 'missing_action_evidence'] }),
        update({ id: 'entity-2', reasons: ['missing_description'] }),
      ],
      { collectionName: 'research' },
    );

    expect(report.publicCount).toBe(0);
    expect(report.applySafety.safeToApply).toBe(false);
    expect(report.applySafety.recommendation).toBe('repair_source_materialization_first');
    expect(report.applySafety.blockers[0]).toContain('computed public tier count 0');
    expect(report.reasonCounts).toMatchObject({
      missing_lead: 1,
      missing_description: 1,
      missing_action_evidence: 1,
    });
  });

  it('allows credible public-tier distributions', () => {
    const report = buildCollectionReport(
      [
        update({
          id: 'entity-1',
          tier: 'student_ready',
          computedTier: 'student_ready',
          reasons: ['source_backed_description', 'concrete_next_step'],
        }),
        update({
          id: 'entity-2',
          tier: 'limited_but_safe',
          computedTier: 'limited_but_safe',
          reasons: ['source_backed_description', 'missing_action_evidence'],
        }),
      ],
      { collectionName: 'research' },
    );

    expect(report.publicCount).toBe(1);
    expect(report.applySafety).toMatchObject({
      safeToApply: true,
      recommendation: 'apply',
      blockers: [],
    });
  });

  it('flags large current-public collapses even when public count is nonzero', () => {
    const report = buildCollectionReport(
      [
        update({
          id: 'entity-1',
          currentTier: 'student_ready',
          tier: 'operator_review',
          computedTier: 'operator_review',
        }),
        update({
          id: 'entity-2',
          currentTier: 'student_ready',
          tier: 'operator_review',
          computedTier: 'operator_review',
        }),
        update({
          id: 'entity-3',
          currentTier: 'student_ready',
          tier: 'student_ready',
          computedTier: 'student_ready',
        }),
      ],
      { collectionName: 'research', maxPublicCollapseRatio: 0.5 },
    );

    expect(report.currentPublicCount).toBe(3);
    expect(report.publicCount).toBe(1);
    expect(report.applySafety.safeToApply).toBe(false);
    expect(report.applySafety.blockers.join(' ')).toContain('would collapse current public count');
  });

  it('rejects unsafe reason sample sizes before building samples', () => {
    expect(() =>
      buildCollectionReport([update({ id: 'entity-1' })], {
        collectionName: 'research',
        reasonSampleSize: 9007199254740992,
      }),
    ).toThrow('--reason-sample-size must be a safe positive integer');
  });

  it('rejects unsafe minimum public counts before evaluating apply safety', () => {
    expect(() =>
      buildCollectionReport([update({ id: 'entity-1' })], {
        collectionName: 'research',
        minimumPublicCount: 9007199254740992,
      }),
    ).toThrow('--minimum-public-count must be a safe non-negative integer');
  });

  it('rejects unsafe public collapse ratios before evaluating apply safety', () => {
    expect(() =>
      buildCollectionReport([update({ id: 'entity-1' })], {
        collectionName: 'research',
        maxPublicCollapseRatio: Number.POSITIVE_INFINITY,
      }),
    ).toThrow('--max-public-collapse-ratio must be a finite non-negative number');
  });

  it('maps reason sets to the highest-leverage repair action', () => {
    expect(nextRepairActionForReasons(['missing_lead', 'missing_description'])).toBe(
      'Attach a source-backed PI, director, or lead member.',
    );
    expect(nextRepairActionForReasons(['missing_action_evidence'])).toBe(
      'Add source-backed access or pathway evidence only if it exists.',
    );
  });
});

describe('studentVisibilityBackfill CLI helpers', () => {
  it('parses apply, collection, limit, and output flags', () => {
    expect(
      parseStudentVisibilityBackfillArgs([
        '--apply',
        '--confirm-student-visibility-backfill',
        '--collection=research',
        '--limit=25',
        '--output',
        '/tmp/ylabs-student-visibility-backfill.json',
      ]),
    ).toEqual({
      apply: true,
      confirmStudentVisibilityBackfill: true,
      collection: 'research',
      limit: 25,
      output: '/tmp/ylabs-student-visibility-backfill.json',
    });
  });

  it('rejects malformed student visibility backfill arguments', () => {
    expect(() => parseStudentVisibilityBackfillArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseStudentVisibilityBackfillArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseStudentVisibilityBackfillArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseStudentVisibilityBackfillArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseStudentVisibilityBackfillArgs(['--output=/etc/ylabs-report.json'])).toThrow(
      /must write under/,
    );
  });

  it('requires a bounded limit before apply mode can run', () => {
    expect(() =>
      assertStudentVisibilityBackfillApplyAllowed(
        { apply: true, confirmStudentVisibilityBackfill: true, limit: Infinity },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--limit is required when --apply is set/);

    expect(
      assertStudentVisibilityBackfillApplyAllowed(
        { apply: true, confirmStudentVisibilityBackfill: true, limit: 25 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toMatchObject({ environment: 'beta' });
  });

  it('requires explicit confirmation before student visibility backfill apply', () => {
    expect(parseStudentVisibilityBackfillArgs(['--apply', '--limit=25'])).toMatchObject({
      apply: true,
      confirmStudentVisibilityBackfill: false,
      limit: 25,
    });
    expect(() =>
      assertStudentVisibilityBackfillApplyAllowed(
        { apply: true, confirmStudentVisibilityBackfill: false, limit: 25 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--confirm-student-visibility-backfill is required/);
  });

  it('writes the student visibility backfill artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-student-visibility-backfill-'));
    const output = path.join(dir, 'student-visibility-backfill.json');
    const payload = {
      mode: 'dry-run',
      scanned: { research: 2, programs: 0 },
    };

    writeStudentVisibilityBackfillOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('rejects unsafe student visibility backfill output writes', () => {
    expect(() =>
      writeStudentVisibilityBackfillOutput({ mode: 'dry-run' }, '/etc/ylabs-report.json'),
    ).toThrow(/must write under/);
  });

  it('wraps student visibility artifacts with target metadata and parsed options', () => {
    const output = buildStudentVisibilityBackfillOutput(
      {
        mode: 'dry-run',
        scanned: { research: 2, programs: 0 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmStudentVisibilityBackfill: false,
          collection: 'research',
          limit: 25,
          output: '/tmp/ylabs-student-visibility-backfill.json',
        },
      },
    );

    expect(output).toEqual({
      mode: 'dry-run',
      scanned: { research: 2, programs: 0 },
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmStudentVisibilityBackfill: false,
        collection: 'research',
        limit: 25,
        output: '/tmp/ylabs-student-visibility-backfill.json',
      },
    });
  });
});
