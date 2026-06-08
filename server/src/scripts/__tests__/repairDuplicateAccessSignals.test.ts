import { describe, expect, it } from 'vitest';
import {
  assertDuplicateAccessSignalRepairApplyAllowed,
  buildDuplicateAccessSignalRepairPlans,
  parseRepairDuplicateAccessSignalsArgs,
} from '../repairDuplicateAccessSignals';

describe('duplicate access signal repair', () => {
  it('parses dry-run/apply bounds and confirmation flags', () => {
    expect(
      parseRepairDuplicateAccessSignalsArgs([
        '--apply',
        '--confirm-duplicate-access-signal-repair',
        '--limit=25',
        '--max-apply',
        '5',
        '--output=/tmp/ylabs-duplicate-access-signal-repair.json',
      ]),
    ).toEqual({
      apply: true,
      confirmDuplicateAccessSignalRepair: true,
      limit: 25,
      limitProvided: true,
      maxApply: 5,
      output: '/tmp/ylabs-duplicate-access-signal-repair.json',
    });

    expect(() => parseRepairDuplicateAccessSignalsArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() =>
      parseRepairDuplicateAccessSignalsArgs(['--confirm-duplicate-access-signal-repair=true']),
    ).toThrow(/does not accept a value/);
    expect(() => parseRepairDuplicateAccessSignalsArgs(['unexpected'])).toThrow(
      /Unknown access-signals:repair-duplicates argument/,
    );
  });

  it('requires explicit bounded confirmation before applying duplicate repairs', () => {
    expect(() =>
      assertDuplicateAccessSignalRepairApplyAllowed({
        apply: true,
        confirmDuplicateAccessSignalRepair: true,
        limitProvided: false,
        maxApply: 10,
        plannedWrites: 1,
      }),
    ).toThrow(/--limit is required/);

    expect(() =>
      assertDuplicateAccessSignalRepairApplyAllowed({
        apply: true,
        confirmDuplicateAccessSignalRepair: false,
        limitProvided: true,
        maxApply: 10,
        plannedWrites: 1,
      }),
    ).toThrow(/--confirm-duplicate-access-signal-repair is required/);

    expect(() =>
      assertDuplicateAccessSignalRepairApplyAllowed({
        apply: true,
        confirmDuplicateAccessSignalRepair: true,
        limitProvided: true,
        maxApply: 1,
        plannedWrites: 2,
      }),
    ).toThrow(/above --max-apply/);
  });

  it('collapses overlapping sourceEvidenceId and observationId groups into one repair plan', () => {
    const result = buildDuplicateAccessSignalRepairPlans(
      [
        {
          researchEntityId: 'entity-1',
          signalType: 'APPLICATION_FORM_EXISTS',
          identityField: 'sourceEvidenceId',
          identityValue: 'obs-1',
          signalIds: ['signal-a', 'signal-b'],
        },
        {
          researchEntityId: 'entity-1',
          signalType: 'APPLICATION_FORM_EXISTS',
          identityField: 'observationId',
          identityValue: 'obs-1',
          signalIds: ['signal-b', 'signal-a'],
        },
      ],
      [
        {
          _id: 'signal-a',
          researchEntityId: 'entity-1',
          entryPathwayId: 'pathway-a',
          signalType: 'APPLICATION_FORM_EXISTS',
          sourceEvidenceId: 'obs-1',
          observationId: 'obs-1',
          derivationKey: 'application-route-backfill:route-a:APPLICATION_FORM_EXISTS',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
        },
        {
          _id: 'signal-b',
          researchEntityId: 'entity-1',
          entryPathwayId: 'pathway-b',
          signalType: 'APPLICATION_FORM_EXISTS',
          sourceEvidenceId: 'obs-1',
          observationId: 'obs-1',
          derivationKey: 'application-route-backfill:route-b:APPLICATION_FORM_EXISTS',
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
        },
      ],
      [
        {
          entryPathwayId: 'pathway-a',
          derivationKey: 'application-route-backfill:route-a',
          activeAccessSignals: 1,
          activeContactRoutes: 0,
          activePostedOpportunities: 0,
        },
        {
          entryPathwayId: 'pathway-b',
          derivationKey: 'application-route-backfill:route-b',
          activeAccessSignals: 1,
          activeContactRoutes: 0,
          activePostedOpportunities: 0,
        },
      ],
    );

    expect(result.blocked).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      canonicalSignalId: 'signal-a',
      duplicateSignalIds: ['signal-b'],
      archiveEntryPathwayIds: ['pathway-b'],
      identityFields: [
        { identityField: 'sourceEvidenceId', identityValue: 'obs-1' },
        { identityField: 'observationId', identityValue: 'obs-1' },
      ],
    });
  });

  it('does not archive duplicate pathways that still have active references', () => {
    const result = buildDuplicateAccessSignalRepairPlans(
      [
        {
          researchEntityId: 'entity-1',
          signalType: 'APPLICATION_FORM_EXISTS',
          identityField: 'sourceEvidenceId',
          identityValue: 'obs-1',
          signalIds: ['signal-a', 'signal-b'],
        },
      ],
      [
        {
          _id: 'signal-a',
          researchEntityId: 'entity-1',
          entryPathwayId: 'pathway-a',
          signalType: 'APPLICATION_FORM_EXISTS',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
        },
        {
          _id: 'signal-b',
          researchEntityId: 'entity-1',
          entryPathwayId: 'pathway-b',
          signalType: 'APPLICATION_FORM_EXISTS',
          createdAt: new Date('2026-05-02T00:00:00.000Z'),
        },
      ],
      [
        {
          entryPathwayId: 'pathway-a',
          derivationKey: 'application-route-backfill:route-a',
          activeAccessSignals: 1,
          activeContactRoutes: 0,
          activePostedOpportunities: 0,
        },
        {
          entryPathwayId: 'pathway-b',
          derivationKey: 'application-route-backfill:route-b',
          activeAccessSignals: 2,
          activeContactRoutes: 0,
          activePostedOpportunities: 0,
        },
      ],
    );

    expect(result.plans[0]).toMatchObject({
      duplicateSignalIds: ['signal-b'],
      archiveEntryPathwayIds: [],
      skippedEntryPathwayArchives: [
        { entryPathwayId: 'pathway-b', reason: 'other-active-access-signals' },
      ],
    });
  });
});
