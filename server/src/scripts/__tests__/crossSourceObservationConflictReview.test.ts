import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildCrossSourceObservationDecisionTemplate,
  buildCrossSourceObservationConflictSummary,
  buildCrossSourceObservationConflictReviewOutput,
  parseCrossSourceObservationConflictReviewArgs,
  readCrossSourceObservationReviewDecisions,
  validateCrossSourceObservationReviewDecisions,
  writeCrossSourceObservationConflictReviewOutput,
} from '../crossSourceObservationConflictReview';

describe('cross-source observation conflict review', () => {
  it('builds dry-run plans for active conflicts between sources without choosing a winner', () => {
    const summary = buildCrossSourceObservationConflictSummary({
      sourceName: 'department-undergrad-research',
      limit: 10,
      sampleSize: 5,
      planLimit: 5,
      groups: [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-cs-ada-lovelace',
          field: 'description',
          observations: [
            {
              id: 'dept-page',
              sourceName: 'department-undergrad-research',
              value: 'Students can contact ada@yale.edu about projects.',
              observedAt: new Date('2026-05-01T12:00:00Z'),
              confidence: 0.7,
            },
            {
              id: 'faculty-roster',
              sourceName: 'dept-faculty-roster',
              value: 'Faculty profile research summary',
              observedAt: new Date('2026-05-01T12:00:00Z'),
              confidence: 0.7,
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      mode: 'dry-run',
      applyBlocked: true,
      sourceName: 'department-undergrad-research',
      candidateGroups: 1,
      plannedGroups: 1,
      priorityReviewCandidateGroups: 1,
      contextReviewCandidateGroups: 0,
      metadataReviewCandidateGroups: 0,
      categoryCounts: [{ category: 'content', count: 1 }],
      fieldCounts: [{ field: 'description', count: 1 }],
      sourcePairCounts: [
        {
          sourcePair: ['department-undergrad-research', 'dept-faculty-roster'],
          count: 1,
        },
      ],
      policyBucketCounts: [{ policyBucket: 'description_policy_review', count: 1 }],
    });
    expect(summary.samples[0]).toMatchObject({
      entityType: 'researchEntity',
      entityKey: 'dept-cs-ada-lovelace',
      field: 'description',
      reviewCategory: 'content',
      reviewQueue: 'priority_review',
      policyBucket: 'description_policy_review',
      sourceConflictScope: 'cross_source',
      sourceNames: ['department-undergrad-research', 'dept-faculty-roster'],
      valuePreviewsBySource: [
        {
          sourceName: 'department-undergrad-research',
          observationIds: ['dept-page'],
          valuePreviews: ['Students can contact [email redacted] about projects.'],
        },
        {
          sourceName: 'dept-faculty-roster',
          observationIds: ['faculty-roster'],
          valuePreviews: ['Faculty profile research summary'],
        },
      ],
    });
    expect(summary.plans[0]).toMatchObject({
      planId: 'researchEntity:dept-cs-ada-lovelace:description',
      policyBucket: 'description_policy_review',
      proposedAction: 'review_source_precedence_or_field_policy',
      applyBlocked: true,
      observationIdsBySource: [
        { sourceName: 'department-undergrad-research', observationIds: ['dept-page'] },
        { sourceName: 'dept-faculty-roster', observationIds: ['faculty-roster'] },
      ],
    });
  });

  it('ignores same-source disagreements because the stale review owns that path', () => {
    const summary = buildCrossSourceObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      groups: [
        {
          entityType: 'researchEntity',
          entityKey: 'same-source',
          field: 'name',
          observations: [
            {
              id: 'old',
              sourceName: 'dept-faculty-roster',
              value: 'Old Lab',
              observedAt: new Date('2026-05-01T12:00:00Z'),
            },
            {
              id: 'new',
              sourceName: 'dept-faculty-roster',
              value: 'New Lab',
              observedAt: new Date('2026-05-02T12:00:00Z'),
            },
          ],
        },
      ],
    });

    expect(summary.candidateGroups).toBe(0);
    expect(summary.samples).toEqual([]);
    expect(summary.plans).toEqual([]);
  });

  it('parses filters and blocks apply mode', () => {
    expect(
      parseCrossSourceObservationConflictReviewArgs([
        '--source=department-undergrad-research',
        '--limit',
        '200',
        '--sample-size=3',
        '--plan-limit',
        '25',
        '--queue=priority_review',
        '--category',
        'content',
        '--field=description',
        '--accepted-decisions',
        '/tmp/cross-source-accepted-decisions.json',
        '--allow-empty-decisions',
        '--decision-template-output=/tmp/cross-source-decision-template.json',
        '--output',
        '/tmp/cross-source.json',
      ]),
    ).toEqual({
      sourceName: 'department-undergrad-research',
      limit: 200,
      sampleSize: 3,
      planLimit: 25,
      reviewQueue: 'priority_review',
      reviewCategory: 'content',
      field: 'description',
      acceptedDecisions: '/tmp/cross-source-accepted-decisions.json',
      allowEmptyDecisions: true,
      decisionTemplateOutput: '/tmp/cross-source-decision-template.json',
      output: '/tmp/cross-source.json',
    });

    expect(() => parseCrossSourceObservationConflictReviewArgs(['--apply'])).toThrow(
      /apply mode is blocked/i,
    );
  });

  it('rejects malformed paired parser values before cross-source review work starts', () => {
    expect(() =>
      parseCrossSourceObservationConflictReviewArgs([
        '--limit',
        '--source=department-undergrad-research',
      ]),
    ).toThrow('--limit requires a number');
    expect(() =>
      parseCrossSourceObservationConflictReviewArgs(['--limit=9007199254740992']),
    ).toThrow('--limit must be a positive integer');
    expect(() =>
      parseCrossSourceObservationConflictReviewArgs(['--sample-size=9007199254740992']),
    ).toThrow('--sample-size must be a positive integer');
    expect(() =>
      parseCrossSourceObservationConflictReviewArgs(['--plan-limit=9007199254740992']),
    ).toThrow('--plan-limit must be a positive integer');

    expect(() =>
      parseCrossSourceObservationConflictReviewArgs(['--source', '--limit=10']),
    ).toThrow('--source requires a value');

    expect(() =>
      parseCrossSourceObservationConflictReviewArgs(['--output', '--allow-empty-decisions']),
    ).toThrow('--output requires a path');

    expect(() =>
      parseCrossSourceObservationConflictReviewArgs([
        '--accepted-decisions',
        '--allow-empty-decisions',
      ]),
    ).toThrow('--accepted-decisions requires a path');

    expect(() =>
      parseCrossSourceObservationConflictReviewArgs([
        '--decision-template-output',
        '--allow-empty-decisions',
      ]),
    ).toThrow('--decision-template-output requires a path');

    expect(() => parseCrossSourceObservationConflictReviewArgs(['prod'])).toThrow(
      'Unknown cross-source observation conflict review option: prod',
    );
  });

  it('can treat a missing accepted-decisions artifact as an empty validation probe', () => {
    const missingPath = path.join(
      os.tmpdir(),
      `ylabs-missing-cross-source-decisions-${Date.now()}.json`,
    );

    expect(
      readCrossSourceObservationReviewDecisions(missingPath, { allowEmpty: true }),
    ).toEqual([]);
  });

  it('builds reviewer decision templates from cross-source plans', () => {
    const summary = buildCrossSourceObservationConflictSummary({
      sourceName: 'department-undergrad-research',
      limit: 10,
      sampleSize: 5,
      planLimit: 5,
      groups: [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-cs-ada-lovelace',
          field: 'description',
          observations: [
            {
              id: 'dept-page',
              sourceName: 'department-undergrad-research',
              value: 'Department description',
              observedAt: new Date('2026-05-01T12:00:00Z'),
              confidence: 0.7,
            },
            {
              id: 'faculty-roster',
              sourceName: 'dept-faculty-roster',
              value: 'Faculty roster description',
              observedAt: new Date('2026-05-01T12:00:00Z'),
              confidence: 0.7,
            },
          ],
        },
      ],
    });

    const template = buildCrossSourceObservationDecisionTemplate(
      summary.plans,
      '2026-05-31T20:15:00.000Z',
    );

    expect(template).toMatchObject({
      generatedAt: '2026-05-31T20:15:00.000Z',
      applyBlocked: true,
      acceptedDecisionValues: ['prefer_source', 'accept_current_resolver', 'defer_review'],
      decisions: [
        {
          planId: 'researchEntity:dept-cs-ada-lovelace:description',
          entityType: 'researchEntity',
          entityKey: 'dept-cs-ada-lovelace',
          field: 'description',
          reviewCategory: 'content',
          reviewQueue: 'priority_review',
          policyBucket: 'description_policy_review',
          sourceNames: ['department-undergrad-research', 'dept-faculty-roster'],
          observationIdsBySource: [
            { sourceName: 'department-undergrad-research', observationIds: ['dept-page'] },
            { sourceName: 'dept-faculty-roster', observationIds: ['faculty-roster'] },
          ],
          decision: '',
          preferredSourceName: '',
          reviewedBy: '',
          reviewNote: '',
        },
      ],
    });
  });

  it('validates accepted reviewer decisions against generated cross-source plans', () => {
    const summary = buildCrossSourceObservationConflictSummary({
      sourceName: 'department-undergrad-research',
      limit: 10,
      sampleSize: 5,
      planLimit: 5,
      groups: [
        {
          entityType: 'researchEntity',
          entityKey: 'dept-cs-ada-lovelace',
          field: 'description',
          observations: [
            {
              id: 'dept-page',
              sourceName: 'department-undergrad-research',
              value: 'Department description',
              observedAt: new Date('2026-05-01T12:00:00Z'),
              confidence: 0.7,
            },
            {
              id: 'faculty-roster',
              sourceName: 'dept-faculty-roster',
              value: 'Faculty roster description',
              observedAt: new Date('2026-05-01T12:00:00Z'),
              confidence: 0.7,
            },
          ],
        },
      ],
    });
    const plan = summary.plans[0];

    const valid = validateCrossSourceObservationReviewDecisions(
      summary.plans,
      [
        {
          planId: plan.planId,
          decision: 'prefer_source',
          preferredSourceName: 'dept-faculty-roster',
          sourceNames: plan.sourceNames,
          observationIdsBySource: plan.observationIdsBySource,
          reviewedBy: 'Codex autonomous review',
        },
      ],
      '/tmp/cross-source-decisions.json',
    );
    expect(valid).toMatchObject({
      artifactPath: '/tmp/cross-source-decisions.json',
      applyBlocked: true,
      totalDecisions: 1,
      validDecisionCount: 1,
      invalidDecisionCount: 0,
      unreviewedPlanCount: 0,
      decisionsByType: [{ decision: 'prefer_source', count: 1 }],
      decisions: [
        {
          planId: plan.planId,
          status: 'valid',
          errors: [],
        },
      ],
    });

    const invalid = validateCrossSourceObservationReviewDecisions(summary.plans, [
      {
        planId: plan.planId,
        decision: 'prefer_source',
        preferredSourceName: 'unknown-source',
        sourceNames: ['department-undergrad-research'],
        observationIdsBySource: [],
      },
      {
        planId: 'missing-plan',
        decision: 'accept_current_resolver',
      },
    ]);

    expect(invalid.invalidDecisionCount).toBe(2);
    expect(invalid.unmatchedPlanDecisionCount).toBe(1);
    expect(invalid.decisions).toEqual([
      expect.objectContaining({
        planId: plan.planId,
        status: 'invalid',
        errors: expect.arrayContaining([
          'preferredSourceName must be one of the generated plan sourceNames',
          'sourceNames must match the generated plan when provided',
          'observationIdsBySource must match the generated plan when provided',
        ]),
      }),
      expect.objectContaining({
        planId: 'missing-plan',
        status: 'invalid',
        errors: expect.arrayContaining(['planId is not present in generated plans']),
      }),
    ]);
  });

  it('writes a review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-cross-source-'));
    const output = path.join(dir, 'review.json');
    const payload = buildCrossSourceObservationConflictSummary({
      limit: 10,
      sampleSize: 5,
      groups: [],
    });

    writeCrossSourceObservationConflictReviewOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      candidateGroups: 0,
      applyBlocked: true,
    });
  });

  it('wraps review artifacts with target metadata and parsed options', () => {
    const summary = buildCrossSourceObservationConflictSummary({
      sourceName: 'department-undergrad-research',
      limit: 10,
      sampleSize: 5,
      groups: [],
    });

    const output = buildCrossSourceObservationConflictReviewOutput(summary, {
      environment: 'beta',
      db: 'Beta',
      options: {
        sourceName: 'department-undergrad-research',
        reviewQueue: 'priority_review',
        limit: 10,
        sampleSize: 5,
        planLimit: 100,
        output: '/tmp/cross-source.json',
      },
    });

    expect(output).toMatchObject({
      environment: 'beta',
      db: 'Beta',
      options: {
        sourceName: 'department-undergrad-research',
        reviewQueue: 'priority_review',
        limit: 10,
        sampleSize: 5,
        planLimit: 100,
        output: '/tmp/cross-source.json',
      },
      mode: 'dry-run',
      sourceName: 'department-undergrad-research',
      applyBlocked: true,
      candidateGroups: 0,
    });
  });

  it('exposes the dry-run command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['observations:cross-source-conflict-review']).toBe(
      'tsx src/scripts/crossSourceObservationConflictReview.ts',
    );
  });
});
