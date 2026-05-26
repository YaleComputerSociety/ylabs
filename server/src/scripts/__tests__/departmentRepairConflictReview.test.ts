import { describe, expect, it } from 'vitest';

import {
  buildDepartmentRepairConflictReviewReport,
  type DepartmentRepairReviewEntity,
  type DepartmentRepairReviewObservation,
} from '../departmentRepairConflictReview';

const observedAt = new Date('2026-05-26T12:00:00.000Z');

function observation(
  overrides: Partial<DepartmentRepairReviewObservation>,
): DepartmentRepairReviewObservation {
  return {
    entityType: 'researchEntity',
    entityId: 'entity-1',
    entityKey: 'example-lab',
    field: 'description',
    value: 'Example description',
    sourceName: 'department-undergrad-research',
    confidence: 0.8,
    observedAt,
    ...overrides,
  };
}

function entity(overrides: Partial<DepartmentRepairReviewEntity>): DepartmentRepairReviewEntity {
  return {
    recordId: 'entity-1',
    slug: 'example-lab',
    label: 'Example Lab',
    entityType: 'LAB',
    kind: 'lab',
    currentTier: 'operator_review',
    manuallyLockedFields: [],
    confidenceByField: {},
    currentValues: {},
    ...overrides,
  };
}

describe('buildDepartmentRepairConflictReviewReport', () => {
  it('groups field conflicts by entity and routes unresolved conflicts to operator review', () => {
    const report = buildDepartmentRepairConflictReviewReport({
      run: { id: 'run-1', sourceName: 'department-undergrad-research' },
      observations: [
        observation({ field: 'displayName', value: 'Efficient Computing Lab', confidence: 0.8 }),
        observation({ field: 'displayName', value: 'Lin Zhong Lab', confidence: 0.79 }),
      ],
      entities: [entity({ currentValues: { displayName: 'Lin Zhong Lab' } })],
      generatedAt: '2026-05-26T12:00:00.000Z',
    });

    expect(report.totals.observations).toBe(2);
    expect(report.totals.entities).toBe(1);
    expect(report.totals.conflictingFields).toBe(1);
    expect(report.buckets.needs_operator_review).toHaveLength(1);
    expect(report.buckets.needs_operator_review[0]).toMatchObject({
      entityKey: 'example-lab',
      field: 'displayName',
      reasons: ['materialization_field_conflict'],
    });
    expect(report.buckets.needs_operator_review[0].conflictingValues).toEqual([
      'Efficient Computing Lab',
      'Lin Zhong Lab',
    ]);
  });

  it('classifies encoded HTML links from department pages as parser bugs', () => {
    const report = buildDepartmentRepairConflictReviewReport({
      run: { id: 'run-1', sourceName: 'department-undergrad-research' },
      observations: [
        observation({
          field: 'websiteUrl',
          value: 'https://physics.yale.edu/research/%3Ca%20href=',
          sourceUrl: 'https://physics.yale.edu/undergraduate/research',
        }),
      ],
      entities: [entity({ currentValues: { websiteUrl: '' } })],
    });

    expect(report.buckets.parser_bug).toHaveLength(1);
    expect(report.buckets.parser_bug[0]).toMatchObject({
      field: 'websiteUrl',
      reasons: ['malformed_url_or_embedded_html'],
      recommendedAction: 'Fix department link extraction and rerun before applying broader batches.',
    });
  });

  it('classifies touched labs with missing lead blockers as lead repairs', () => {
    const report = buildDepartmentRepairConflictReviewReport({
      run: { id: 'run-1', sourceName: 'department-undergrad-research' },
      observations: [observation({ field: 'sourceUrls', value: ['https://physics.yale.edu/research'] })],
      entities: [entity({ recordId: 'entity-1', slug: 'leadless-lab', label: 'Leadless Lab' })],
      visibilityPlans: [
        {
          collection: 'research',
          recordId: 'entity-1',
          label: 'Leadless Lab',
          slug: 'leadless-lab',
          entityType: 'LAB',
          kind: 'lab',
          computedTier: 'operator_review',
          tier: 'operator_review',
          reasons: ['missing_lab_lead', 'source_backed_description'],
          sourceNames: ['department-undergrad-research'],
          nextRepairAction: 'repair lead evidence',
        },
      ],
    });

    expect(report.buckets.lead_repair).toHaveLength(1);
    expect(report.buckets.lead_repair[0]).toMatchObject({
      entityKey: 'leadless-lab',
      field: 'lead',
      reasons: ['missing_lab_lead'],
    });
  });

  it('keeps stronger locked existing values out of operator review', () => {
    const report = buildDepartmentRepairConflictReviewReport({
      run: { id: 'run-1', sourceName: 'department-undergrad-research' },
      observations: [
        observation({ field: 'displayName', value: 'Department Label', confidence: 0.75 }),
        observation({ field: 'displayName', value: 'Existing Manual Label', confidence: 0.76 }),
      ],
      entities: [
        entity({
          manuallyLockedFields: ['displayName'],
          currentValues: { displayName: 'Existing Manual Label' },
        }),
      ],
    });

    expect(report.buckets.needs_operator_review).toHaveLength(0);
    expect(report.buckets.safe_existing_value).toHaveLength(0);
  });
});
