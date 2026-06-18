import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertStaleObservationConflictReviewApplyAllowed,
  applyStaleObservationSupersessions,
  buildStaleObservationDecisionTemplate,
  buildStaleObservationConflictSummary,
  buildStaleObservationConflictReviewOutput,
  normalizeStaleObservationObjectId,
  parseStaleObservationConflictReviewArgs,
  readStaleObservationReviewDecisions,
  validateStaleObservationReviewDecisions,
  writeStaleObservationDecisionTemplate,
  writeStaleObservationConflictReviewOutput,
} from '../staleObservationConflictReview';

describe('stale observation conflict review', () => {
  it('rejects object-shaped observation ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeStaleObservationObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizeStaleObservationObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });

  it('builds a dry-run plan that keeps the latest same-source value', () => {
    const summary = buildStaleObservationConflictSummary({
      sourceName: 'dept-faculty-roster',
      limit: 10,
      sampleSize: 5,
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'dept-cs-ada-lovelace',
          field: 'name',
          observations: [
            {
              id: 'old-lab',
              value: 'Ada Lovelace Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'old-research',
              value: 'Ada Lovelace - Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
            {
              id: 'latest',
              value: 'Ada Lovelace Faculty Research',
              observedAt: new Date('2026-05-03T12:00:00Z'),
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      mode: 'dry-run',
      applyBlocked: true,
      sourceName: 'dept-faculty-roster',
      candidateGroups: 1,
      candidateSupersedeObservations: 2,
      plannedGroups: 1,
      plannedSupersedeObservations: 2,
      planTruncated: false,
      sampledGroups: 1,
      priorityReviewCandidateGroups: 1,
      contextReviewCandidateGroups: 0,
      metadataReviewCandidateGroups: 0,
    });
    expect(summary.samples[0]).toMatchObject({
      sourceName: 'dept-faculty-roster',
      entityType: 'researchEntity',
      entityKey: 'dept-cs-ada-lovelace',
      field: 'name',
      reviewCategory: 'identity_or_routing',
      reviewQueue: 'priority_review',
      keepObservationId: 'latest',
      keepValuePreview: 'Ada Lovelace Faculty Research',
      supersedeObservationIds: ['old-research', 'old-lab'],
      supersedeValuePreviews: ['Ada Lovelace - Research', 'Ada Lovelace Lab'],
    });
    expect(summary.plans[0]).toMatchObject({
      planId: 'dept-faculty-roster:researchEntity:dept-cs-ada-lovelace:name',
      applyBlocked: true,
      applyBlockedReason:
        'Apply mode is intentionally unavailable until this dry-run plan is reviewed and a guarded supersession path is implemented.',
      keepObservationId: 'latest',
      supersedeObservationIds: ['old-research', 'old-lab'],
    });
  });

  it('ignores duplicate active observations that already agree with the latest value', () => {
    const summary = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'user',
          entityKey: 'netid:ada',
          field: 'title',
          observations: [
            {
              id: 'old',
              value: 'Professor',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'latest',
              value: 'Professor',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });

    expect(summary.candidateGroups).toBe(0);
    expect(summary.candidateSupersedeObservations).toBe(0);
    expect(summary.samples).toEqual([]);
  });

  it('filters by source-health review queue and summarizes categories', () => {
    const summary = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      reviewQueue: 'priority_review',
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'priority-entity',
          field: 'description',
          observations: [
            {
              id: 'old-description',
              value: 'Old description',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'latest-description',
              value: 'Latest description',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'metadata-entity',
          field: 'sourceUrls',
          observations: [
            {
              id: 'old-source-urls',
              value: ['https://old.example.edu'],
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'latest-source-urls',
              value: ['https://latest.example.edu'],
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      reviewQueue: 'priority_review',
      candidateGroups: 1,
      priorityReviewCandidateGroups: 1,
      contextReviewCandidateGroups: 0,
      metadataReviewCandidateGroups: 0,
      categoryCounts: [{ category: 'content', count: 1 }],
      fieldCounts: [{ field: 'description', count: 1 }],
      policyBucketCounts: [{ policyBucket: 'stale_description_review', count: 1 }],
      reviewQueues: expect.arrayContaining([
        expect.objectContaining({
          queue: 'priority_review',
          count: 1,
          categories: [{ category: 'content', count: 1 }],
        }),
      ]),
    });
    expect(summary.samples).toHaveLength(1);
    expect(summary.samples[0]).toMatchObject({
      entityKey: 'priority-entity',
      reviewCategory: 'content',
      reviewQueue: 'priority_review',
    });
  });

  it('parses output bounds and blocked apply mode for the wrapper guard', () => {
    expect(
      parseStaleObservationConflictReviewArgs([
        '--apply',
        '--source=dept-faculty-roster',
        '--limit',
        '200',
        '--sample-size=3',
        '--plan-limit',
        '25',
        '--max-apply',
        '10',
        '--confirm-stale-observation-supersession',
        '--queue=priority_review',
        '--category',
        'content',
        '--field=name',
        '--accepted-decisions=/tmp/stale-decisions.json',
        '--allow-empty-decisions',
        '--decision-template-output',
        '/tmp/stale-template.json',
        '--output',
        '/tmp/stale.json',
      ]),
    ).toEqual({
      apply: true,
      sourceName: 'dept-faculty-roster',
      limit: 200,
      sampleSize: 3,
      planLimit: 25,
      maxApply: 10,
      confirmStaleObservationSupersession: true,
      reviewQueue: 'priority_review',
      reviewCategory: 'content',
      field: 'name',
      acceptedDecisions: '/tmp/stale-decisions.json',
      allowEmptyDecisions: true,
      decisionTemplateOutput: '/tmp/stale-template.json',
      output: '/tmp/stale.json',
    });
  });

  it('rejects malformed paired parser values before stale review work starts', () => {
    expect(() =>
      parseStaleObservationConflictReviewArgs(['--limit', '--source=dept-faculty-roster']),
    ).toThrow('--limit requires a number');

    expect(() =>
      parseStaleObservationConflictReviewArgs(['--source', '--limit=10']),
    ).toThrow('--source requires a value');

    expect(() =>
      parseStaleObservationConflictReviewArgs(['--output', '--allow-empty-decisions']),
    ).toThrow('--output requires a path');

    expect(() =>
      parseStaleObservationConflictReviewArgs([
        '--accepted-decisions',
        '--allow-empty-decisions',
      ]),
    ).toThrow('--accepted-decisions requires a path');

    expect(() =>
      parseStaleObservationConflictReviewArgs([
        '--decision-template-output',
        '--allow-empty-decisions',
      ]),
    ).toThrow('--decision-template-output requires a path');

    expect(() =>
      parseStaleObservationConflictReviewArgs(['--output=/var/tmp/stale-review.json']),
    ).toThrow(/--output must write under/);
    expect(() =>
      parseStaleObservationConflictReviewArgs(['--output=/tmp/stale-review.txt']),
    ).toThrow(/--output must point to a \.json report file/);
    expect(() =>
      parseStaleObservationConflictReviewArgs([
        '--accepted-decisions=/var/tmp/stale-decisions.json',
      ]),
    ).toThrow(/--accepted-decisions must write under/);
    expect(() =>
      parseStaleObservationConflictReviewArgs([
        '--decision-template-output=/var/tmp/stale-template.json',
      ]),
    ).toThrow(/--decision-template-output must write under/);

    expect(() =>
      parseStaleObservationConflictReviewArgs(['--max-apply', '--source=dept-faculty-roster']),
    ).toThrow('--max-apply requires a number');

    for (const flag of ['--limit', '--sample-size', '--plan-limit', '--max-apply']) {
      expect(() => parseStaleObservationConflictReviewArgs([`${flag}=1e3`])).toThrow(
        `${flag} must be a positive integer`,
      );
    }

    expect(() =>
      parseStaleObservationConflictReviewArgs([
        '--confirm-stale-observation-supersession=true',
      ]),
    ).toThrow('--confirm-stale-observation-supersession does not accept a value');

    expect(() => parseStaleObservationConflictReviewArgs(['prod'])).toThrow(
      'Unknown stale observation conflict review option: prod',
    );
  });

  it('blocks production apply before stale observation review can connect or write', () => {
    expect(() =>
      assertStaleObservationConflictReviewApplyAllowed(
        {
          apply: true,
          limit: 500,
          sampleSize: 20,
          planLimit: 100,
        },
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Production',
      ),
    ).toThrow(/production writes require CONFIRM_PROD_SCRAPE=true/);
  });

  it('requires accepted decisions when apply mode is enabled', () => {
    expect(() =>
      assertStaleObservationConflictReviewApplyAllowed(
        {
          apply: true,
          limit: 500,
          sampleSize: 20,
          planLimit: 100,
        },
        {
          SCRAPER_ENV: 'beta',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/apply mode requires --accepted-decisions/);
  });

  it('requires max apply and explicit confirmation before stale observation apply can run', () => {
    expect(() =>
      assertStaleObservationConflictReviewApplyAllowed(
        {
          apply: true,
          limit: 500,
          sampleSize: 20,
          planLimit: 100,
          acceptedDecisions: '/tmp/stale-decisions.json',
          confirmStaleObservationSupersession: true,
        },
        {
          SCRAPER_ENV: 'beta',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--max-apply is required/);

    expect(() =>
      assertStaleObservationConflictReviewApplyAllowed(
        {
          apply: true,
          limit: 500,
          sampleSize: 20,
          planLimit: 100,
          maxApply: 10,
          acceptedDecisions: '/tmp/stale-decisions.json',
          confirmStaleObservationSupersession: false,
        },
        {
          SCRAPER_ENV: 'beta',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.mongodb.net/Beta',
      ),
    ).toThrow(/--confirm-stale-observation-supersession is required/);
  });

  it('can treat a missing accepted-decisions artifact as an empty validation probe', () => {
    const missingPath = path.join(
      os.tmpdir(),
      `ylabs-missing-stale-decisions-${Date.now()}.json`,
    );

    expect(readStaleObservationReviewDecisions(missingPath, { allowEmpty: true })).toEqual([]);
    expect(() =>
      readStaleObservationReviewDecisions('/var/tmp/stale-decisions.json', {
        allowEmpty: true,
      }),
    ).toThrow(/--accepted-decisions must write under/);
  });

  it('builds templates and validates accepted supersession decisions without applying', () => {
    const summary = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      planLimit: 2,
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'one',
          field: 'name',
          observations: [
            {
              id: 'one-old',
              value: 'One Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'one-latest',
              value: 'One Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'two',
          field: 'name',
          observations: [
            {
              id: 'two-old',
              value: 'Two Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'two-latest',
              value: 'Two Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });

    const template = buildStaleObservationDecisionTemplate(
      summary.plans,
      '2026-05-31T20:10:00.000Z',
    );

    expect(template).toMatchObject({
      generatedAt: '2026-05-31T20:10:00.000Z',
      applyBlocked: true,
      acceptedDecisionValues: ['supersede_stale_observations', 'defer_review'],
      decisions: [
        {
          planId: 'dept-faculty-roster:researchEntity:one:name',
          keepObservationId: 'one-latest',
          supersedeObservationIds: ['one-old'],
          decision: '',
          reviewedBy: '',
          reviewNote: '',
        },
        {
          planId: 'dept-faculty-roster:researchEntity:two:name',
          keepObservationId: 'two-latest',
          supersedeObservationIds: ['two-old'],
          decision: '',
        },
      ],
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-stale-decision-'));
    const templatePath = path.join(dir, 'template.json');
    writeStaleObservationDecisionTemplate(template, templatePath);
    const writtenTemplate = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    expect(writtenTemplate.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planId: 'dept-faculty-roster:researchEntity:one:name',
          keepObservationId: 'one-latest',
          supersedeObservationIds: ['one-old'],
        }),
      ]),
    );

    const decisionsPath = path.join(dir, 'decisions.json');
    fs.writeFileSync(
      decisionsPath,
      JSON.stringify({
        decisions: [
          {
            planId: 'dept-faculty-roster:researchEntity:one:name',
            decision: 'supersede_stale_observations',
            keepObservationId: 'one-latest',
            supersedeObservationIds: ['one-old'],
            reviewedBy: 'Codex autonomous review',
          },
          {
            planId: 'dept-faculty-roster:researchEntity:two:name',
            decision: 'supersede_stale_observations',
            keepObservationId: 'wrong-keep',
            supersedeObservationIds: ['two-old'],
            reviewedBy: 'Codex autonomous review',
          },
          {
            planId: 'dept-faculty-roster:researchEntity:missing:name',
            decision: 'defer_review',
            reviewedBy: 'Codex autonomous review',
          },
        ],
      }),
    );

    const validation = validateStaleObservationReviewDecisions(
      summary.plans,
      readStaleObservationReviewDecisions(decisionsPath),
      decisionsPath,
    );

    expect(validation).toMatchObject({
      artifactPath: decisionsPath,
      applyBlocked: true,
      totalDecisions: 3,
      validDecisionCount: 1,
      invalidDecisionCount: 2,
      unmatchedPlanDecisionCount: 1,
      duplicatePlanDecisionCount: 0,
      unreviewedPlanCount: 1,
      decisionsByType: [
        { decision: 'supersede_stale_observations', count: 2 },
        { decision: 'defer_review', count: 1 },
      ],
      decisions: [
        {
          planId: 'dept-faculty-roster:researchEntity:one:name',
          status: 'valid',
          errors: [],
        },
        {
          planId: 'dept-faculty-roster:researchEntity:two:name',
          status: 'invalid',
          errors: ['keepObservationId must match the generated plan keepObservationId.'],
        },
        {
          planId: 'dept-faculty-roster:researchEntity:missing:name',
          status: 'invalid',
          errors: ['No generated stale-observation plan matches this planId.'],
        },
      ],
    });
  });

  it('applies only valid stale supersession decisions within the max-apply bound', async () => {
    const summary = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      planLimit: 3,
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'one',
          field: 'name',
          observations: [
            {
              id: 'one-old',
              value: 'One Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'one-latest',
              value: 'One Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'two',
          field: 'name',
          observations: [
            {
              id: 'two-old',
              value: 'Two Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'two-latest',
              value: 'Two Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });
    const validation = validateStaleObservationReviewDecisions(summary.plans, [
      {
        planId: 'dept-faculty-roster:researchEntity:one:name',
        decision: 'supersede_stale_observations',
        keepObservationId: 'one-latest',
        supersedeObservationIds: ['one-old'],
      },
      {
        planId: 'dept-faculty-roster:researchEntity:two:name',
        decision: 'supersede_stale_observations',
        keepObservationId: 'two-latest',
        supersedeObservationIds: ['two-old'],
      },
    ]);
    const superseded: Array<{ ids: string[]; keepId: string }> = [];

    const applySummary = await applyStaleObservationSupersessions({
      plans: summary.plans,
      validation,
      maxApply: 1,
      deps: {
        async countActiveKeepObservations() {
          return 1;
        },
        async supersedeObservations(ids, keepId) {
          superseded.push({ ids, keepId });
          return { matchedCount: ids.length, modifiedCount: ids.length };
        },
      },
    });

    expect(applySummary).toEqual({
      requestedDecisionCount: 2,
      validSupersessionDecisionCount: 2,
      maxApply: 1,
      appliedPlanCount: 1,
      supersedeObservationCount: 1,
      modifiedObservationCount: 1,
      skippedPlanCount: 1,
      skippedPlans: [
        {
          planId: 'dept-faculty-roster:researchEntity:two:name',
          reason: 'max_apply_limit',
        },
      ],
    });
    expect(superseded).toEqual([{ ids: ['one-old'], keepId: 'one-latest' }]);
  });

  it('skips apply rows when the generated keep observation is no longer active', async () => {
    const summary = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'one',
          field: 'name',
          observations: [
            {
              id: 'one-old',
              value: 'One Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'one-latest',
              value: 'One Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });
    const validation = validateStaleObservationReviewDecisions(summary.plans, [
      {
        planId: 'dept-faculty-roster:researchEntity:one:name',
        decision: 'supersede_stale_observations',
        keepObservationId: 'one-latest',
        supersedeObservationIds: ['one-old'],
      },
    ]);

    const applySummary = await applyStaleObservationSupersessions({
      plans: summary.plans,
      validation,
      deps: {
        async countActiveKeepObservations() {
          return 0;
        },
        async supersedeObservations() {
          throw new Error('should not supersede when keep row is inactive');
        },
      },
    });

    expect(applySummary).toMatchObject({
      requestedDecisionCount: 1,
      validSupersessionDecisionCount: 1,
      appliedPlanCount: 0,
      supersedeObservationCount: 0,
      modifiedObservationCount: 0,
      skippedPlanCount: 1,
      skippedPlans: [
        {
          planId: 'dept-faculty-roster:researchEntity:one:name',
          reason: 'keep_observation_not_active',
        },
      ],
    });
  });

  it('writes a review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-stale-conflicts-'));
    const output = path.join(dir, 'review.json');
    const payload = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      groups: [],
    });

    writeStaleObservationConflictReviewOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      candidateGroups: 0,
      applyBlocked: true,
    });
    expect(() =>
      writeStaleObservationConflictReviewOutput(payload, '/var/tmp/stale-review.json'),
    ).toThrow(/--output must write under/);
  });

  it('rejects unsafe stale observation decision template writes', () => {
    const template = buildStaleObservationDecisionTemplate([]);
    expect(() =>
      writeStaleObservationDecisionTemplate(template, '/var/tmp/stale-template.json'),
    ).toThrow(/--decision-template-output must write under/);
  });

  it('wraps review artifacts with target metadata and parsed options', () => {
    const summary = buildStaleObservationConflictSummary({
      sourceName: 'dept-faculty-roster',
      limit: 10,
      sampleSize: 5,
      groups: [],
    });

    const output = buildStaleObservationConflictReviewOutput(summary, {
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        sourceName: 'dept-faculty-roster',
        reviewQueue: 'priority_review',
        limit: 10,
        sampleSize: 5,
        planLimit: 100,
        output: '/tmp/stale.json',
      },
    });

    expect(output).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      options: {
        sourceName: 'dept-faculty-roster',
        reviewQueue: 'priority_review',
        limit: 10,
        sampleSize: 5,
        planLimit: 100,
        output: '/tmp/stale.json',
      },
      mode: 'dry-run',
      sourceName: 'dept-faculty-roster',
      applyBlocked: true,
      candidateGroups: 0,
    });
  });

  it('limits full supersession plans separately from samples', () => {
    const summary = buildStaleObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      planLimit: 1,
      groups: [
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'one',
          field: 'name',
          observations: [
            {
              id: 'one-old',
              value: 'One Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'one-latest',
              value: 'One Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
        {
          sourceName: 'dept-faculty-roster',
          entityType: 'researchEntity',
          entityKey: 'two',
          field: 'name',
          observations: [
            {
              id: 'two-old',
              value: 'Two Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'two-latest',
              value: 'Two Faculty Research',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      candidateGroups: 2,
      plannedGroups: 1,
      plannedSupersedeObservations: 1,
      planTruncated: true,
    });
    expect(summary.plans).toHaveLength(1);
  });

  it('exposes the dry-run command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['observations:stale-conflict-review']).toBe(
      'tsx src/scripts/staleObservationConflictReview.ts',
    );
  });
});
