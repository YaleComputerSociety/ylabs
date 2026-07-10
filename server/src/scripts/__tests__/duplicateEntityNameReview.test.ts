import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildDuplicateEntityNameReviewOutput,
  buildDuplicateEntityNameReviewDecisionTemplate,
  buildDuplicateEntityNameReviewPlans,
  buildDuplicateEntityNameMergeGroups,
  assertDuplicateEntityNameReviewApplyAllowed,
  normalizeDuplicateEntityNameReviewObjectId,
  parseDuplicateEntityNameReviewArgs,
  readDuplicateEntityNameReviewDecisions,
  selectDuplicateEntityNamePlansForAcceptedMergeApply,
  writeDuplicateEntityNameReviewDecisionTemplate,
  validateDuplicateEntityNameReviewDecisions,
  writeDuplicateEntityNameReviewOutput,
} from '../duplicateEntityNameReview';

const DUPLICATE_NAME_APPLY_STATUS =
  'Accepted duplicate-name decisions can drive apply mode for shared-website, zero-reference cross-department, or specific-website cross-department merge_into_canonical plans; ambiguous manual disambiguation decisions remain review-only.';

describe('duplicate entity name review CLI helpers', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeDuplicateEntityNameReviewObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizeDuplicateEntityNameReviewObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });

  it('parses bounded dry-run artifact options and guarded apply mode', () => {
    expect(
      parseDuplicateEntityNameReviewArgs([
        '--limit=500',
        '--category=shared_website_merge_review',
        '--plan-limit',
        '25',
        '--accepted-decisions=/tmp/ylabs-duplicate-name-decisions.json',
        '--allow-empty-decisions',
        '--decision-template-output',
        '/tmp/ylabs-duplicate-name-decision-template.json',
        '--output',
        '/tmp/ylabs-duplicate-entity-name-review.json',
      ]),
    ).toEqual({
      apply: false,
      confirmDuplicateEntityNameReview: false,
      limit: 500,
      limitProvided: true,
      category: 'shared_website_merge_review',
      planLimit: 25,
      maxApply: 10,
      acceptedDecisions: '/tmp/ylabs-duplicate-name-decisions.json',
      allowEmptyDecisions: true,
      decisionTemplateOutput: '/tmp/ylabs-duplicate-name-decision-template.json',
      output: '/tmp/ylabs-duplicate-entity-name-review.json',
    });

    expect(
      parseDuplicateEntityNameReviewArgs([
        '--apply',
        '--confirm-duplicate-entity-name-review',
        '--limit',
        '10000',
        '--max-apply=11',
        '--accepted-decisions',
        '/tmp/decisions.json',
      ]),
    ).toMatchObject({
      apply: true,
      confirmDuplicateEntityNameReview: true,
      limit: 10000,
      limitProvided: true,
      maxApply: 11,
      acceptedDecisions: '/tmp/decisions.json',
    });
  });

  it('requires explicit confirmation before duplicate-name review apply', () => {
    expect(
      parseDuplicateEntityNameReviewArgs([
        '--apply',
        '--limit=25',
        '--accepted-decisions=/tmp/decisions.json',
      ]),
    ).toMatchObject({
      apply: true,
      confirmDuplicateEntityNameReview: false,
      limit: 25,
      limitProvided: true,
      acceptedDecisions: '/tmp/decisions.json',
    });

    expect(() =>
      assertDuplicateEntityNameReviewApplyAllowed({
        apply: true,
        confirmDuplicateEntityNameReview: false,
        limitProvided: true,
        acceptedDecisions: '/tmp/decisions.json',
        maxApply: 10,
        plannedDuplicateEntities: 1,
      }),
    ).toThrow(/--confirm-duplicate-entity-name-review is required/);
  });

  it('rejects malformed paired CLI values before running duplicate-name review', () => {
    expect(() => parseDuplicateEntityNameReviewArgs(['--output', '--apply'])).toThrow(
      '--output requires a path',
    );
    expect(() => parseDuplicateEntityNameReviewArgs(['--limit', '--category=same_label_disambiguation'])).toThrow(
      '--limit requires a number',
    );
    expect(() => parseDuplicateEntityNameReviewArgs(['--category', '--plan-limit=5'])).toThrow(
      '--category requires a value',
    );
    expect(() => parseDuplicateEntityNameReviewArgs(['--accepted-decisions', '--allow-empty-decisions'])).toThrow(
      '--accepted-decisions requires a path',
    );
    expect(() => parseDuplicateEntityNameReviewArgs(['--decision-template-output=--apply'])).toThrow(
      '--decision-template-output requires a path',
    );
    expect(() => parseDuplicateEntityNameReviewArgs(['--output=/var/tmp/duplicate-review.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseDuplicateEntityNameReviewArgs(['--output=/tmp/duplicate-review.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
    expect(() =>
      parseDuplicateEntityNameReviewArgs([
        '--accepted-decisions=/var/tmp/duplicate-review-decisions.json',
      ]),
    ).toThrow(/--accepted-decisions must write under/);
    expect(() =>
      parseDuplicateEntityNameReviewArgs([
        '--decision-template-output=/var/tmp/duplicate-review-template.json',
      ]),
    ).toThrow(/--decision-template-output must write under/);
    for (const flag of ['--limit', '--plan-limit', '--max-apply']) {
      expect(() => parseDuplicateEntityNameReviewArgs([`${flag}=1e3`])).toThrow(
        `${flag} must be a positive integer`,
      );
    }
    expect(() => parseDuplicateEntityNameReviewArgs(['prod'])).toThrow(
      'Unknown duplicate-name review option: prod',
    );
  });

  it('builds bounded category-specific dry-run plans without choosing a canonical entity', () => {
    const planSummary = buildDuplicateEntityNameReviewPlans(
      [
        {
          normalizedName: 'example lab',
          count: 2,
          reviewCategory: 'shared_website_merge_review',
          entities: [
            {
              id: 'entity-a',
              name: 'Example Lab',
              slug: 'example-lab-a',
              departments: ['Chemistry'],
              websiteUrl: 'https://example.yale.edu/',
            },
            {
              id: 'entity-b',
              name: 'Example Lab',
              slug: 'example-lab-b',
              departments: ['Biology'],
              websiteUrl: 'https://example.yale.edu',
            },
          ],
        },
        {
          normalizedName: 'different lab',
          count: 2,
          reviewCategory: 'same_label_disambiguation',
          entities: [
            { id: 'entity-c', name: 'Different Lab' },
            { id: 'entity-d', name: 'Different Lab' },
          ],
        },
      ],
      {
        category: 'shared_website_merge_review',
        planLimit: 1,
        referenceImpactByEntityId: {
          'entity-a': {
            entryPathways: 2,
            accessSignals: 1,
            contactRoutes: 1,
            researchEntityMembers: 1,
            researchScholarlyLinks: 0,
            researchScholarlyAttributions: 0,
            postedOpportunities: 0,
            listings: 0,
            observations: 3,
          },
          'entity-b': {
            entryPathways: 0,
            accessSignals: 0,
            contactRoutes: 0,
            researchEntityMembers: 1,
            researchScholarlyLinks: 2,
            researchScholarlyAttributions: 1,
            postedOpportunities: 0,
            listings: 0,
            observations: 4,
          },
        },
      },
    );

    expect(planSummary).toMatchObject({
      category: 'shared_website_merge_review',
      planLimit: 1,
      plannedClusterCount: 1,
      plannedEntityCount: 2,
      planTruncated: false,
      preflightSummary: {
        mergePreflightReadyForReview: 1,
        manualDisambiguationRequired: 0,
        withReferenceRewrite: 1,
        totalReferencesImpacted: 16,
        requiredReviewerDecisions: [
          {
            decision: 'Confirm the shared website represents one research home.',
            count: 1,
          },
          {
            decision: 'Select the canonical ResearchEntity before any apply path.',
            count: 1,
          },
          {
            decision:
              'Confirm guarded reference rewrite and archive behavior for active references.',
            count: 1,
          },
        ],
      },
      plans: [
        {
          planId: 'duplicate-name:shared_website_merge_review:example-lab',
          normalizedName: 'example lab',
          reviewCategory: 'shared_website_merge_review',
          entityIds: ['entity-a', 'entity-b'],
          sharedWebsiteUrl: 'https://example.yale.edu/',
          proposedAction: 'review_for_merge_or_aliasing',
          canonicalEntityId: undefined,
          referenceImpact: {
            totalReferences: 16,
            byEntity: [
              expect.objectContaining({
                entityId: 'entity-a',
                totalReferences: 8,
              }),
              expect.objectContaining({
                entityId: 'entity-b',
                totalReferences: 8,
              }),
            ],
          },
          applyBlocked: false,
          applyStatus: DUPLICATE_NAME_APPLY_STATUS,
          reviewPreflight: {
            status: 'merge_preflight_ready_for_review',
            referenceRewriteRequired: true,
            totalReferencesImpacted: 16,
            blockers: [],
            requiredReviewerDecisions: [
              'Confirm the shared website represents one research home.',
              'Select the canonical ResearchEntity before any apply path.',
              'Confirm guarded reference rewrite and archive behavior for active references.',
            ],
          },
        },
      ],
    });
  });

  it('builds and writes reviewer decision templates from generated plans', () => {
    const planSummary = buildDuplicateEntityNameReviewPlans(
      [
        {
          normalizedName: 'example lab',
          count: 2,
          reviewCategory: 'shared_website_merge_review',
          entities: [
            {
              id: 'entity-a',
              name: 'Example Lab',
              slug: 'example-lab-a',
              websiteUrl: 'https://example.yale.edu/',
            },
            {
              id: 'entity-b',
              name: 'Example Lab',
              slug: 'example-lab-b',
              websiteUrl: 'https://example.yale.edu',
            },
          ],
        },
      ],
      { planLimit: 1 },
    );

    const template = buildDuplicateEntityNameReviewDecisionTemplate(
      planSummary.plans,
      '2026-05-31T20:00:00.000Z',
    );

    expect(template).toMatchObject({
      generatedAt: '2026-05-31T20:00:00.000Z',
      applyBlocked: false,
      applyStatus: DUPLICATE_NAME_APPLY_STATUS,
      acceptedDecisionValues: [
        'merge_into_canonical',
        'mark_distinct_homes',
        'defer_review',
      ],
      decisions: [
        {
          planId: 'duplicate-name:shared_website_merge_review:example-lab',
          normalizedName: 'example lab',
          reviewCategory: 'shared_website_merge_review',
          entityIds: ['entity-a', 'entity-b'],
          entitySlugs: ['example-lab-a', 'example-lab-b'],
          sharedWebsiteUrl: 'https://example.yale.edu/',
          reviewPreflightStatus: 'merge_preflight_ready_for_review',
          requiredReviewerDecisions: [
            'Confirm the shared website represents one research home.',
            'Select the canonical ResearchEntity before any apply path.',
            'Confirm guarded reference rewrite and archive behavior for active references.',
          ],
          decision: '',
          canonicalEntityId: '',
          reviewedBy: '',
          reviewNote: '',
        },
      ],
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-duplicate-name-template-'));
    const output = path.join(dir, 'template.json');
    writeDuplicateEntityNameReviewDecisionTemplate(template, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      acceptedDecisionValues: ['merge_into_canonical', 'mark_distinct_homes', 'defer_review'],
      decisions: [
        {
          planId: 'duplicate-name:shared_website_merge_review:example-lab',
          decision: '',
        },
      ],
    });
    expect(() =>
      writeDuplicateEntityNameReviewDecisionTemplate(
        template,
        '/var/tmp/duplicate-review-template.json',
      ),
    ).toThrow(/--decision-template-output must write under/);
  });

  it('validates accepted reviewer decisions without enabling apply mode', () => {
    const planSummary = buildDuplicateEntityNameReviewPlans(
      [
        {
          normalizedName: 'example lab',
          count: 2,
          reviewCategory: 'shared_website_merge_review',
          entities: [
            {
              id: 'entity-a',
              name: 'Example Lab',
              slug: 'example-lab-a',
              websiteUrl: 'https://example.yale.edu/',
            },
            {
              id: 'entity-b',
              name: 'Example Lab',
              slug: 'example-lab-b',
              websiteUrl: 'https://example.yale.edu',
            },
          ],
        },
        {
          normalizedName: 'miller lab',
          count: 2,
          reviewCategory: 'same_label_disambiguation',
          entities: [
            { id: 'entity-c', name: 'Miller Lab', slug: 'miller-lab-a' },
            { id: 'entity-d', name: 'Miller Lab', slug: 'miller-lab-b' },
          ],
        },
      ],
      { planLimit: 2 },
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-duplicate-name-decisions-'));
    const decisionsPath = path.join(dir, 'decisions.json');
    fs.writeFileSync(
      decisionsPath,
      JSON.stringify({
        decisions: [
          {
            planId: 'duplicate-name:shared_website_merge_review:example-lab',
            decision: 'merge_into_canonical',
            canonicalEntityId: 'entity-a',
            reviewedBy: 'Codex autonomous review',
          },
          {
            planId: 'duplicate-name:same_label_disambiguation:miller-lab',
            decision: 'merge_into_canonical',
            canonicalEntityId: 'entity-c',
            reviewedBy: 'Codex autonomous review',
          },
          {
            planId: 'duplicate-name:shared_website_merge_review:missing-lab',
            decision: 'defer_review',
            reviewedBy: 'Codex autonomous review',
          },
        ],
      }),
    );

    const decisions = readDuplicateEntityNameReviewDecisions(decisionsPath);
    const validation = validateDuplicateEntityNameReviewDecisions(
      planSummary.plans,
      decisions,
      decisionsPath,
    );

    expect(validation).toMatchObject({
      artifactPath: decisionsPath,
      applyBlocked: false,
      applyStatus:
        DUPLICATE_NAME_APPLY_STATUS,
      totalDecisions: 3,
      validDecisionCount: 1,
      invalidDecisionCount: 2,
      unmatchedPlanDecisionCount: 1,
      duplicatePlanDecisionCount: 0,
      unreviewedPlanCount: 1,
      decisionsByType: [
        { decision: 'merge_into_canonical', count: 2 },
        { decision: 'defer_review', count: 1 },
      ],
      decisions: [
        {
          planId: 'duplicate-name:shared_website_merge_review:example-lab',
          decision: 'merge_into_canonical',
          canonicalEntityId: 'entity-a',
          status: 'valid',
          errors: [],
        },
        {
          planId: 'duplicate-name:same_label_disambiguation:miller-lab',
          status: 'invalid',
          errors: [
            'merge_into_canonical requires merge_preflight_ready_for_review status.',
          ],
        },
        {
          planId: 'duplicate-name:shared_website_merge_review:missing-lab',
          status: 'invalid',
          errors: ['No generated duplicate-name plan matches this planId.'],
        },
      ],
    });
  });

  it('can treat a missing accepted-decisions artifact as an empty validation probe', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-duplicate-name-empty-decisions-'));
    const missingPath = path.join(dir, 'missing-decisions.json');

    expect(readDuplicateEntityNameReviewDecisions(missingPath, { allowEmpty: true })).toEqual([]);
    expect(() => readDuplicateEntityNameReviewDecisions(missingPath)).toThrow(/ENOENT/);
    expect(() =>
      readDuplicateEntityNameReviewDecisions('/var/tmp/duplicate-review-decisions.json', {
        allowEmpty: true,
      }),
    ).toThrow(/--accepted-decisions must write under/);
  });

  it('marks zero-reference cross-department same-person shells as merge-preflight ready', () => {
    const planSummary = buildDuplicateEntityNameReviewPlans(
      [
        {
          normalizedName: 'avery fixture faculty research',
          count: 2,
          reviewCategory: 'cross_department_same_person_review' as const,
          entities: [
            {
              id: 'entity-a',
              name: 'Avery Fixture Faculty Research',
              slug: 'dept-physics-avery-fixture',
            },
            {
              id: 'entity-b',
              name: 'Avery Fixture Faculty Research',
              slug: 'dept-math-avery-fixture',
            },
          ],
        },
      ],
      {
        planLimit: 1,
        referenceImpactByEntityId: {
          'entity-a': {
            entryPathways: 1,
            accessSignals: 2,
            contactRoutes: 1,
            researchEntityMembers: 1,
            researchScholarlyLinks: 0,
            researchScholarlyAttributions: 0,
            postedOpportunities: 0,
            listings: 0,
            observations: 1,
          },
          'entity-b': {
            entryPathways: 0,
            accessSignals: 0,
            contactRoutes: 0,
            researchEntityMembers: 0,
            researchScholarlyLinks: 0,
            researchScholarlyAttributions: 0,
            postedOpportunities: 0,
            listings: 0,
            observations: 0,
          },
        },
      },
    );

    expect(planSummary.preflightSummary).toMatchObject({
      mergePreflightReadyForReview: 1,
      manualDisambiguationRequired: 0,
    });
    expect(planSummary.plans[0]).toMatchObject({
      planId:
        'duplicate-name:cross_department_same_person_review:avery-fixture-faculty-research',
      reviewPreflight: {
        status: 'merge_preflight_ready_for_review',
        referenceRewriteRequired: true,
        totalReferencesImpacted: 6,
        blockers: [],
        requiredReviewerDecisions: [
          'Confirm the cross-department rows represent one person and one research home.',
          'Select the referenced ResearchEntity as canonical before apply.',
          'Confirm guarded reference rewrite and archive behavior for active references.',
        ],
      },
    });
  });

  it('marks cross-department same-person rows with one specific lab website as merge-preflight ready', () => {
    const planSummary = buildDuplicateEntityNameReviewPlans(
      [
        {
          normalizedName: 'mark gerstein lab',
          count: 2,
          reviewCategory: 'cross_department_same_person_review' as const,
          entities: [
            {
              id: 'entity-a',
              name: 'Mark Gerstein Lab',
              slug: 'dept-cs-mark-gerstein',
              websiteUrl: 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
            },
            {
              id: 'entity-b',
              name: 'Mark Gerstein Lab',
              slug: 'dept-statistics-mark-gerstein',
              websiteUrl: 'https://www.gersteinlab.org/',
            },
          ],
        },
      ],
      {
        planLimit: 1,
        referenceImpactByEntityId: {
          'entity-a': {
            entryPathways: 1,
            accessSignals: 2,
            contactRoutes: 1,
            researchEntityMembers: 1,
            researchScholarlyLinks: 0,
            researchScholarlyAttributions: 0,
            postedOpportunities: 0,
            listings: 0,
            observations: 3,
          },
          'entity-b': {
            entryPathways: 1,
            accessSignals: 2,
            contactRoutes: 0,
            researchEntityMembers: 0,
            researchScholarlyLinks: 0,
            researchScholarlyAttributions: 0,
            postedOpportunities: 0,
            listings: 0,
            observations: 0,
          },
        },
      },
    );

    expect(planSummary.preflightSummary).toMatchObject({
      mergePreflightReadyForReview: 1,
      manualDisambiguationRequired: 0,
    });
    expect(planSummary.plans[0]).toMatchObject({
      planId: 'duplicate-name:cross_department_same_person_review:mark-gerstein-lab',
      reviewPreflight: {
        status: 'merge_preflight_ready_for_review',
        referenceRewriteRequired: true,
        totalReferencesImpacted: 11,
        blockers: [],
        requiredReviewerDecisions: [
          'Confirm the cross-department rows represent one person and one research home.',
          'Select the ResearchEntity with the specific lab website as canonical before apply.',
          'Confirm guarded reference rewrite and archive behavior for active references.',
        ],
      },
    });
  });

  it('selects only valid merge-preflight decisions for guarded apply groups', () => {
    const clusters = [
      {
        normalizedName: 'example lab',
        count: 2,
        reviewCategory: 'shared_website_merge_review' as const,
        entities: [
          {
            id: 'entity-a',
            name: 'Example Lab',
            slug: 'example-lab-a',
            departments: ['Chemistry'],
            researchAreas: ['Catalysis'],
            websiteUrl: 'https://example.yale.edu/',
            sourceUrls: ['https://chem.yale.edu/example'],
          },
          {
            id: 'entity-b',
            name: 'Example Lab',
            slug: 'example-lab-b',
            departments: ['Biology'],
            researchAreas: ['Genomics'],
            website: 'https://example.yale.edu',
            sourceUrls: ['https://bio.yale.edu/example'],
          },
        ],
      },
      {
        normalizedName: 'zero ref faculty research',
        count: 2,
        reviewCategory: 'cross_department_same_person_review' as const,
        entities: [
          {
            id: 'entity-c',
            name: 'Zero Ref Faculty Research',
            slug: 'dept-a-zero-ref',
            departments: ['A'],
            researchAreas: ['Area A'],
          },
          {
            id: 'entity-d',
            name: 'Zero Ref Faculty Research',
            slug: 'dept-b-zero-ref',
            departments: ['B'],
            researchAreas: ['Area B'],
          },
        ],
      },
    ];
    const planSummary = buildDuplicateEntityNameReviewPlans(clusters, {
      planLimit: 2,
      referenceImpactByEntityId: {
        'entity-c': {
          entryPathways: 1,
          accessSignals: 0,
          contactRoutes: 0,
          researchEntityMembers: 0,
          researchScholarlyLinks: 0,
          researchScholarlyAttributions: 0,
          postedOpportunities: 0,
          listings: 0,
          observations: 0,
        },
        'entity-d': {
          entryPathways: 0,
          accessSignals: 0,
          contactRoutes: 0,
          researchEntityMembers: 0,
          researchScholarlyLinks: 0,
          researchScholarlyAttributions: 0,
          postedOpportunities: 0,
          listings: 0,
          observations: 0,
        },
      },
    });
    const validation = validateDuplicateEntityNameReviewDecisions(planSummary.plans, [
      {
        planId: 'duplicate-name:shared_website_merge_review:example-lab',
        decision: 'merge_into_canonical',
        canonicalEntityId: 'entity-a',
        reviewedBy: 'Codex reviewer',
      },
      {
        planId: 'duplicate-name:cross_department_same_person_review:zero-ref-faculty-research',
        decision: 'merge_into_canonical',
        canonicalEntityId: 'entity-c',
        reviewedBy: 'Codex reviewer',
      },
    ]);

    const selections = selectDuplicateEntityNamePlansForAcceptedMergeApply(
      planSummary.plans,
      validation,
    );
    const groups = buildDuplicateEntityNameMergeGroups(selections, clusters);

    expect(selections).toHaveLength(2);
    expect(groups).toEqual([
      {
        canonicalEntityId: 'entity-a',
        duplicateEntityIds: ['entity-b'],
        mergedDepartments: ['Chemistry', 'Biology'],
        mergedResearchAreas: ['Catalysis', 'Genomics'],
        mergedSourceUrls: [
          'https://chem.yale.edu/example',
          'https://example.yale.edu/',
          'https://bio.yale.edu/example',
          'https://example.yale.edu',
        ],
      },
      {
        canonicalEntityId: 'entity-c',
        duplicateEntityIds: ['entity-d'],
        mergedDepartments: ['A', 'B'],
        mergedResearchAreas: ['Area A', 'Area B'],
        mergedSourceUrls: [],
      },
    ]);
  });

  it('writes a duplicate-name review artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-duplicate-name-'));
    const output = path.join(dir, 'review.json');

    const payload = buildDuplicateEntityNameReviewOutput(
      {
        generatedAt: '2026-05-31T18:00:00.000Z',
        mode: 'dry-run',
        applyBlocked: false,
        applyStatus: DUPLICATE_NAME_APPLY_STATUS,
        clusterLimit: 500,
        clusterCount: 1,
        entityCountInClusters: 2,
        reviewSummary: {
          totalClusters: 1,
          byCategory: [{ category: 'shared_website_merge_review', count: 1 }],
        },
        planSummary: {
          planLimit: 100,
          plannedClusterCount: 0,
          plannedEntityCount: 0,
          planTruncated: false,
          preflightSummary: {
            mergePreflightReadyForReview: 0,
            manualDisambiguationRequired: 0,
            withReferenceRewrite: 0,
            totalReferencesImpacted: 0,
            requiredReviewerDecisions: [],
          },
          plans: [],
        },
        clusters: [
          {
            normalizedName: 'example lab',
            count: 2,
            reviewCategory: 'shared_website_merge_review',
            entities: [],
          },
        ],
        nextAction:
          'Review category-specific clusters before any merge or archive apply.',
      },
      {
        environment: 'beta',
        db: 'Beta',
        options: parseDuplicateEntityNameReviewArgs(['--limit=500', '--output', output]),
      },
    );
    writeDuplicateEntityNameReviewOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      environment: 'beta',
      db: 'Beta',
      options: { limit: 500, output },
      applyBlocked: false,
      clusterCount: 1,
      reviewSummary: {
        byCategory: [{ category: 'shared_website_merge_review', count: 1 }],
      },
    });
    expect(() =>
      writeDuplicateEntityNameReviewOutput(payload, '/var/tmp/duplicate-review.json'),
    ).toThrow(/--output must write under/);
  });

  it('exposes the dry-run command in server package scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['research-entity:duplicate-name-review']).toBe(
      'tsx src/scripts/duplicateEntityNameReview.ts',
    );
  });
});
