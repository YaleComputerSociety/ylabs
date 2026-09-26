import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertBackfillProgramClassificationsAccepted,
  assertBackfillProgramClassificationsApplyAllowed,
  assertProgramClassificationVisibilityPreserved,
  buildBackfillProgramClassificationsMatch,
  buildBackfillProgramClassificationsOutput,
  describeBackfillProgramClassificationsRefusals,
  describeProgramCategoryRewriteRefusal,
  describeProgramClassificationVisibilityLoss,
  evaluateProgramCategoryRewriteImpact,
  evaluateProgramClassificationVisibilityImpact,
  losesStudentVisibleTier,
  programCategoryIsServedToStudents,
  parseBackfillProgramClassificationsArgs,
  planProgramClassificationWrite,
  projectProgramClassificationWrite,
  writeBackfillProgramClassificationsOutput,
  type ProgramClassificationVisibilityProjection,
} from '../backfillProgramClassifications';
import { classifyProgram } from '../../services/programClassifier';
import { computeProgramStudentVisibility } from '../../services/studentVisibilityTier';

describe('backfillProgramClassifications CLI helpers', () => {
  it('parses apply, limit, and output flags', () => {
    expect(
      parseBackfillProgramClassificationsArgs([
        '--apply',
        '--confirm-program-classification-backfill',
        '--limit=15',
        '--output',
        '/tmp/ylabs-program-classifications.json',
      ]),
    ).toEqual({
      apply: true,
      confirmProgramClassificationBackfill: true,
      confirmStudentVisibilityLoss: false,
      confirmCategoryRewrites: false,
      limit: 15,
      onlyArchiveReview: false,
      output: '/tmp/ylabs-program-classifications.json',
    });
    expect(() => parseBackfillProgramClassificationsArgs(['prod'])).toThrow(
      /Unknown program classification backfill argument: prod/,
    );
    expect(() => parseBackfillProgramClassificationsArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseBackfillProgramClassificationsArgs(['--limit=9007199254740992'])).toThrow(
      /--limit requires a positive integer/,
    );
  });

  it('narrows the scan to stored archive-review rows when the selector is set', () => {
    expect(parseBackfillProgramClassificationsArgs(['--only-archive-review'])).toMatchObject({
      onlyArchiveReview: true,
    });
    expect(() => parseBackfillProgramClassificationsArgs(['--only-archive-review=true'])).toThrow(
      /--only-archive-review does not accept a value/,
    );

    expect(buildBackfillProgramClassificationsMatch({ onlyArchiveReview: true })).toEqual({
      archived: { $ne: true },
      studentFacingCategory: 'Archive / review',
    });
    expect(buildBackfillProgramClassificationsMatch({ onlyArchiveReview: false })).toEqual({
      archived: { $ne: true },
    });
  });

  it('rejects malformed program classification output paths', () => {
    expect(() => parseBackfillProgramClassificationsArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseBackfillProgramClassificationsArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parseBackfillProgramClassificationsArgs([
        '--output',
        '/var/tmp/program-classifications.json',
      ]),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseBackfillProgramClassificationsArgs(['--output', '/tmp/program-classifications.txt']),
    ).toThrow(/--output must point to a \.json report file/);
  });

  it('requires a bounded limit before apply mode can run', () => {
    expect(() =>
      assertBackfillProgramClassificationsApplyAllowed(
        { apply: true, confirmProgramClassificationBackfill: true, limit: Infinity },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--limit is required when --apply is set/);

    expect(
      assertBackfillProgramClassificationsApplyAllowed(
        { apply: true, confirmProgramClassificationBackfill: true, limit: 15 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toMatchObject({ environment: 'beta' });
  });

  it('requires explicit confirmation before program classification backfill apply', () => {
    expect(parseBackfillProgramClassificationsArgs(['--apply', '--limit=15'])).toMatchObject({
      apply: true,
      confirmProgramClassificationBackfill: false,
      limit: 15,
    });
    expect(() =>
      assertBackfillProgramClassificationsApplyAllowed(
        { apply: true, confirmProgramClassificationBackfill: false, limit: 15 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--confirm-program-classification-backfill is required/);
  });

  it('writes the program classification artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-program-classifications-'));
    const output = path.join(dir, 'program-classifications.json');
    const payload = {
      mode: 'dry-run',
      scanned: 5,
      counts: { structured_program: 2 },
    };

    writeBackfillProgramClassificationsOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject(payload);
  });

  it('rejects unsafe program classification artifact writes', () => {
    expect(() =>
      writeBackfillProgramClassificationsOutput(
        { mode: 'dry-run' },
        '/var/tmp/program-classifications.json',
      ),
    ).toThrow(/--output must write under/);
  });

  it('wraps program classification artifacts with target metadata and parsed options', () => {
    const output = buildBackfillProgramClassificationsOutput(
      {
        mode: 'dry-run',
        scanned: 5,
        counts: { structured_program: 2 },
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          confirmProgramClassificationBackfill: false,
          confirmStudentVisibilityLoss: false,
          confirmCategoryRewrites: false,
          limit: 15,
          onlyArchiveReview: false,
          output: '/tmp/ylabs-program-classifications.json',
        },
      },
    );

    expect(output).toEqual({
      mode: 'dry-run',
      scanned: 5,
      counts: { structured_program: 2 },
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        confirmProgramClassificationBackfill: false,
        confirmStudentVisibilityLoss: false,
        confirmCategoryRewrites: false,
        limit: 15,
        onlyArchiveReview: false,
        output: '/tmp/ylabs-program-classifications.json',
      },
    });
  });
});

describe('program classification write plan', () => {
  const storedUndergraduateFundingRow = {
    title: 'Yale College Independent Research Support Award',
    summary:
      'Supports Yale College students conducting independent faculty-sponsored research projects during the academic year.',
    studentFacingCategory: 'Senior research funding',
    sourceUrl: 'https://example-college.invalid/independent-research-support',
    applicationLink: 'https://example-apply.invalid/independent-research-support',
    undergraduateOnly: true,
    yaleCollegeOnly: true,
  };

  const classifyStoredRow = (row: Record<string, unknown>) =>
    classifyProgram({
      title: row.title as string,
      summary: row.summary as string,
      sourceUrl: row.sourceUrl as string,
    });

  it('keeps an optional field the recomputed classification does not speak to', () => {
    const classification = classifyStoredRow(storedUndergraduateFundingRow);
    expect(classification).not.toHaveProperty('undergraduateOnly');
    expect(classification).not.toHaveProperty('yaleCollegeOnly');

    const plan = planProgramClassificationWrite(storedUndergraduateFundingRow, classification);

    expect(plan.set).toEqual(classification);
    expect(plan.retainedOptionalFields).toEqual(['undergraduateOnly', 'yaleCollegeOnly']);
    expect(projectProgramClassificationWrite(storedUndergraduateFundingRow, plan)).toMatchObject({
      undergraduateOnly: true,
      yaleCollegeOnly: true,
      studentFacingCategory: classification.studentFacingCategory,
    });
  });

  it('lets the classification overwrite an audience value it does assert', () => {
    const stored = { ...storedUndergraduateFundingRow, undergraduateOnly: true };
    const plan = planProgramClassificationWrite(stored, {
      ...classifyStoredRow(stored),
      undergraduateOnly: false,
    });

    expect(plan.retainedOptionalFields).toEqual(['yaleCollegeOnly']);
    expect(projectProgramClassificationWrite(stored, plan)).toMatchObject({
      undergraduateOnly: false,
    });
  });

  it('leaves a student-ready program student ready through the real gate', () => {
    const before = computeProgramStudentVisibility(storedUndergraduateFundingRow);
    expect(before.tier).toBe('student_ready');

    const plan = planProgramClassificationWrite(
      storedUndergraduateFundingRow,
      classifyStoredRow(storedUndergraduateFundingRow),
    );
    const after = computeProgramStudentVisibility(
      projectProgramClassificationWrite(storedUndergraduateFundingRow, plan),
    );

    expect(after.tier).toBe('student_ready');
    expect(after.reasons).toContain('undergraduate_relevant');
  });
});

describe('program classification visibility guard', () => {
  it('counts a lost student-visible tier only when the row leaves the served tier', () => {
    expect(
      evaluateProgramClassificationVisibilityImpact([
        { before: 'student_ready', after: 'student_ready' },
        { before: 'student_ready', after: 'operator_review' },
        { before: 'limited_but_safe', after: 'suppressed' },
        { before: 'operator_review', after: 'student_ready' },
      ]),
    ).toEqual({ studentReadyBefore: 2, studentReadyAfter: 2, publicTierLost: 1 });
  });

  it('counts a student_ready row demoted to limited_but_safe as a loss', () => {
    const projections = [
      { before: 'student_ready', after: 'limited_but_safe' },
      { before: 'operator_review', after: 'student_ready' },
    ] satisfies ProgramClassificationVisibilityProjection[];

    expect(projections.map(losesStudentVisibleTier)).toEqual([true, false]);

    const impact = evaluateProgramClassificationVisibilityImpact(projections);
    expect(impact).toEqual({ studentReadyBefore: 1, studentReadyAfter: 1, publicTierLost: 1 });
    expect(
      describeProgramClassificationVisibilityLoss(impact, { confirmStudentVisibilityLoss: false }),
    ).toMatch(/would cost 1 program row\(s\) their student-visible tier/);
    expect(() =>
      assertProgramClassificationVisibilityPreserved(impact, {
        confirmStudentVisibilityLoss: false,
      }),
    ).toThrow(/would cost 1 program row\(s\) their student-visible tier/);
  });

  it('refuses an apply that would cost a program row its student-visible tier', () => {
    const impact = evaluateProgramClassificationVisibilityImpact([
      { before: 'student_ready', after: 'operator_review' },
    ]);

    expect(() =>
      assertProgramClassificationVisibilityPreserved(impact, {
        confirmStudentVisibilityLoss: false,
      }),
    ).toThrow(/would cost 1 program row\(s\) their student-visible tier/);
    expect(() =>
      assertProgramClassificationVisibilityPreserved(impact, {
        confirmStudentVisibilityLoss: true,
      }),
    ).not.toThrow();
  });

  it('refuses an apply that reduces student_ready without demoting any single row below public', () => {
    expect(() =>
      assertProgramClassificationVisibilityPreserved(
        { studentReadyBefore: 5, studentReadyAfter: 4, publicTierLost: 0 },
        { confirmStudentVisibilityLoss: false },
      ),
    ).toThrow(/would reduce student_ready program rows from 5 to 4/);
  });

  it('allows an apply that preserves every student-visible tier', () => {
    const impact = evaluateProgramClassificationVisibilityImpact([
      { before: 'student_ready', after: 'student_ready' },
      { before: 'operator_review', after: 'student_ready' },
    ]);

    expect(
      describeProgramClassificationVisibilityLoss(impact, { confirmStudentVisibilityLoss: false }),
    ).toBeUndefined();
    expect(() =>
      assertProgramClassificationVisibilityPreserved(impact, {
        confirmStudentVisibilityLoss: false,
      }),
    ).not.toThrow();
  });

  it('rejects a valued confirmation flag', () => {
    expect(
      parseBackfillProgramClassificationsArgs(['--confirm-student-visibility-loss']),
    ).toMatchObject({ confirmStudentVisibilityLoss: true });
    expect(() =>
      parseBackfillProgramClassificationsArgs(['--confirm-student-visibility-loss=true']),
    ).toThrow(/--confirm-student-visibility-loss does not accept a value/);
    expect(parseBackfillProgramClassificationsArgs(['--confirm-category-rewrites'])).toMatchObject({
      confirmCategoryRewrites: true,
    });
    expect(() =>
      parseBackfillProgramClassificationsArgs(['--confirm-category-rewrites=true']),
    ).toThrow(/--confirm-category-rewrites does not accept a value/);
  });
});

describe('backfillProgramClassifications served category rewrites (#2925)', () => {
  it('counts only a served row whose stored label is replaced', () => {
    const impact = evaluateProgramCategoryRewriteImpact([
      { before: 'Senior research funding', after: 'Internship program', servedToStudents: true },
      { before: 'Senior research funding', after: 'Internship program', servedToStudents: true },
      { before: 'Senior research funding', after: 'Funding after mentor', servedToStudents: true },
      { before: 'Senior research funding', after: 'Funding after mentor', servedToStudents: false },
      {
        before: 'Research travel funding',
        after: 'Research travel funding',
        servedToStudents: true,
      },
      { before: undefined, after: 'Funding after mentor', servedToStudents: true },
      { before: '', after: 'Funding after mentor', servedToStudents: true },
    ]);

    expect(impact).toEqual({
      rewritten: 4,
      servedRewritten: 3,
      servedCohorts: [
        { change: 'Senior research funding -> Internship program', count: 2 },
        { change: 'Senior research funding -> Funding after mentor', count: 1 },
      ],
    });
  });

  it('reads the stored tier rather than a recomputed one when deciding a row is served', () => {
    expect(programCategoryIsServedToStudents({ studentVisibilityTier: 'student_ready' })).toBe(
      true,
    );
    expect(programCategoryIsServedToStudents({ studentVisibilityTier: 'operator_review' })).toBe(
      false,
    );
    expect(programCategoryIsServedToStudents({})).toBe(false);
  });

  it('refuses an unattended apply that replaces a served label even when no tier moves', () => {
    const categoryRewrites = evaluateProgramCategoryRewriteImpact([
      { before: 'Senior research funding', after: 'Internship program', servedToStudents: true },
    ]);
    const noTierLoss = evaluateProgramClassificationVisibilityImpact([
      { before: 'student_ready', after: 'student_ready' },
    ]);

    expect(
      describeProgramClassificationVisibilityLoss(noTierLoss, {
        confirmStudentVisibilityLoss: false,
      }),
    ).toBeUndefined();
    expect(
      describeProgramCategoryRewriteRefusal(categoryRewrites, { confirmCategoryRewrites: false }),
    ).toMatch(/would replace the served studentFacingCategory on 1 program row\(s\)/);
    expect(() =>
      assertBackfillProgramClassificationsAccepted(noTierLoss, categoryRewrites, {
        confirmStudentVisibilityLoss: false,
        confirmCategoryRewrites: false,
      }),
    ).toThrow(/would replace the served studentFacingCategory on 1 program row\(s\)/);
    expect(() =>
      assertBackfillProgramClassificationsAccepted(noTierLoss, categoryRewrites, {
        confirmStudentVisibilityLoss: false,
        confirmCategoryRewrites: true,
      }),
    ).not.toThrow();
  });

  it('allows an apply that only fills rows with no stored label', () => {
    const categoryRewrites = evaluateProgramCategoryRewriteImpact([
      { before: undefined, after: 'Funding after mentor', servedToStudents: true },
    ]);

    expect(categoryRewrites.servedRewritten).toBe(0);
    expect(
      describeBackfillProgramClassificationsRefusals(
        { studentReadyBefore: 1, studentReadyAfter: 1, publicTierLost: 0 },
        categoryRewrites,
        { confirmStudentVisibilityLoss: false, confirmCategoryRewrites: false },
      ),
    ).toEqual([]);
  });

  it('reports both refusals when an apply demotes a tier and relabels a served row', () => {
    expect(
      describeBackfillProgramClassificationsRefusals(
        { studentReadyBefore: 2, studentReadyAfter: 1, publicTierLost: 1 },
        evaluateProgramCategoryRewriteImpact([
          {
            before: 'Senior research funding',
            after: 'Internship program',
            servedToStudents: true,
          },
        ]),
        { confirmStudentVisibilityLoss: false, confirmCategoryRewrites: false },
      ),
    ).toHaveLength(2);
  });
});
