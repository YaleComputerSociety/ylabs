import { describe, expect, it } from 'vitest';
import { planDepartmentCoverageBackfill } from '../departmentCoverageBackfillCore';

const departments = [
  {
    _id: 'ceng',
    abbreviation: 'CENG',
    name: 'Chemical Engineering',
    displayName: 'CENG - Chemical Engineering',
    aliases: ['CEE', 'Chemical & Environmental Engineering'],
  },
  {
    _id: 'glbl',
    abbreviation: 'GLBL',
    name: 'Global Affairs',
    displayName: 'GLBL - Global Affairs',
    aliases: ['Jackson School of Global Affairs'],
  },
];

describe('departmentCoverageBackfillCore', () => {
  it('plans canonical department updates while preserving official cross-listing', () => {
    const result = planDepartmentCoverageBackfill(
      [
        {
          _id: 'entity-1',
          slug: 'engineering-lab',
          name: 'Engineering Lab',
          departments: ['EASCEE CEE Faculty', 'JAC Jackson School of Global Affairs'],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 1,
      plannedUpdates: 1,
      skippedLocked: 0,
    });
    expect(result.planned[0]).toMatchObject({
      id: 'entity-1',
      slug: 'engineering-lab',
      before: ['EASCEE CEE Faculty', 'JAC Jackson School of Global Affairs'],
      after: ['Chemical Engineering', 'Global Affairs'],
    });
  });

  it('skips entities with manually locked departments', () => {
    const result = planDepartmentCoverageBackfill(
      [
        {
          _id: 'entity-locked',
          slug: 'locked-lab',
          name: 'Locked Lab',
          departments: ['EASCEE CEE Faculty'],
          manuallyLockedFields: ['departments'],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 1,
      plannedUpdates: 0,
      skippedLocked: 1,
    });
    expect(result.planned).toEqual([]);
  });

  it('reports unresolved and ignored labels without planning empty destructive updates by default', () => {
    const result = planDepartmentCoverageBackfill(
      [
        {
          _id: 'entity-unknown',
          slug: 'unknown-lab',
          name: 'Unknown Lab',
          departments: ['Yale School of Medicine', 'Unknown Unit'],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 1,
      plannedUpdates: 0,
      unresolvedLabels: 1,
      ignoredLabels: 1,
    });
    expect(result.planned).toEqual([]);
  });

  it('does not partially rewrite rows that still contain unresolved labels', () => {
    const result = planDepartmentCoverageBackfill(
      [
        {
          _id: 'entity-mixed',
          slug: 'mixed-lab',
          name: 'Mixed Lab',
          departments: ['EASCEE CEE Faculty', 'Unknown Unit'],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 1,
      plannedUpdates: 0,
      unresolvedLabels: 1,
      ignoredLabels: 0,
    });
    expect(result.planned).toEqual([]);
  });
});
