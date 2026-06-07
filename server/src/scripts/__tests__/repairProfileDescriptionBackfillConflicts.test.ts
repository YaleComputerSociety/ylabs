import { describe, expect, it } from 'vitest';
import {
  assertRepairProfileDescriptionBackfillConflictsApplyAllowed,
  buildProfileDescriptionConflictRepairPlan,
  parseRepairProfileDescriptionBackfillConflictsArgs,
  PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
  PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME,
} from '../repairProfileDescriptionBackfillConflicts';

describe('repairProfileDescriptionBackfillConflicts', () => {
  it('plans supersession of profile description observations when lab evidence wins', () => {
    const plan = buildProfileDescriptionConflictRepairPlan({
      entityType: 'researchEntity',
      entityKey: 'example-lab',
      field: 'shortDescription',
      observations: [
        {
          id: 'lab-description',
          sourceName: PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME,
          value: 'The Example Lab studies source-backed research questions.',
          confidence: 0.86,
          observedAt: new Date('2026-06-01T00:00:00Z'),
        },
        {
          id: 'profile-bio',
          sourceName: PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
          value: 'Dr. Example is an associate professor at Yale.',
          confidence: 0.78,
          observedAt: new Date('2026-06-02T00:00:00Z'),
        },
      ],
    });

    expect(plan).toMatchObject({
      planId: 'researchEntity:example-lab:shortDescription',
      preferredSourceName: PROFILE_DESCRIPTION_PREFERRED_SOURCE_NAME,
      supersededSourceName: PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
      keepObservationId: 'lab-description',
      supersedeObservationIds: ['profile-bio'],
    });
  });

  it('does not plan repairs when the preferred source is absent', () => {
    expect(
      buildProfileDescriptionConflictRepairPlan({
        entityType: 'researchEntity',
        entityKey: 'example-lab',
        field: 'shortDescription',
        observations: [
          {
            id: 'profile-bio',
            sourceName: PROFILE_DESCRIPTION_BACKFILL_SOURCE_NAME,
            value: 'Dr. Example is an associate professor at Yale.',
            confidence: 0.78,
          },
        ],
      }),
    ).toBeNull();
  });

  it('parses apply bounds and requires explicit confirmation', () => {
    const args = parseRepairProfileDescriptionBackfillConflictsArgs([
      '--apply',
      '--confirm-profile-description-conflict-repair',
      '--limit=100',
      '--max-apply=7',
      '--output',
      '/tmp/ylabs-profile-description-conflict-repair.json',
    ]);

    expect(args).toEqual({
      apply: true,
      confirmProfileDescriptionConflictRepair: true,
      limit: 100,
      limitProvided: true,
      maxApply: 7,
      output: '/tmp/ylabs-profile-description-conflict-repair.json',
    });
    expect(() => assertRepairProfileDescriptionBackfillConflictsApplyAllowed(args, 8)).toThrow(
      /above --max-apply/,
    );
    expect(() =>
      assertRepairProfileDescriptionBackfillConflictsApplyAllowed(
        { ...args, confirmProfileDescriptionConflictRepair: false },
        1,
      ),
    ).toThrow(/--confirm-profile-description-conflict-repair is required/);
  });

  it('requires an explicit limit before apply mode can run', () => {
    const args = parseRepairProfileDescriptionBackfillConflictsArgs([
      '--apply',
      '--confirm-profile-description-conflict-repair',
    ]);

    expect(args).toMatchObject({
      apply: true,
      confirmProfileDescriptionConflictRepair: true,
      limit: 500,
      limitProvided: false,
    });
    expect(() => assertRepairProfileDescriptionBackfillConflictsApplyAllowed(args, 1)).toThrow(
      /--limit is required/,
    );
  });

  it('rejects non-literal numeric bounds before planning profile-description repairs', () => {
    expect(() => parseRepairProfileDescriptionBackfillConflictsArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() =>
      parseRepairProfileDescriptionBackfillConflictsArgs(['--max-apply=1e3']),
    ).toThrow(/--max-apply must be a positive integer/);
  });
});
