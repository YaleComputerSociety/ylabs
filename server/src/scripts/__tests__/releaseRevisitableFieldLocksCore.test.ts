import { describe, expect, it } from 'vitest';

import {
  decideFieldLockReleases,
  resolveFieldLockReleases,
  summarizeFieldLockReleaseDecisions,
  type MaterializerProjectionAnswer,
} from '../releaseRevisitableFieldLocksCore';
import { leadPiSchoolInheritanceGate } from '../../scrapers/entityMaterializer';
import { fieldLockGatesNonMaterializerWriteLane } from '../../utils/researchEntityFieldLocks';

const workaround = (lockedBy: string) => ({
  reason: 'engine_gap_workaround' as const,
  lockedBy,
  lockedAt: new Date('2026-01-01T00:00:00Z'),
  note: '',
});

describe('a lock that holds a reconciler shut rather than a projection', () => {
  /**
   * `ysmLabDelistingReconciler` and the roster-departure reconciler write the row
   * themselves after reading the lock list, so a dry-run projection cannot report
   * what releasing one of their locks would do - and releasing it flips the row
   * from student-visible to suppressed on the next reconcile.
   */
  it('is refused before the engine is asked, whatever the row records', () => {
    const decisions = decideFieldLockReleases(
      {
        slug: 'gated-row',
        studentVisibilitySuppressionReason: '',
        activeAtYaleCache: false,
        manuallyLockedFields: ['studentVisibilitySuppressionReason', 'activeAtYaleCache'],
        fieldLockProvenance: { activeAtYaleCache: workaround('repair-fixture') },
      },
      { plannedSet: { name: 'Gated Row' } },
    );

    expect(decisions.map((decision) => decision.verdict)).toEqual([
      'keep_gates_other_writer',
      'keep_gates_other_writer',
    ]);
    expect(summarizeFieldLockReleaseDecisions(decisions).keptGatesOtherWriter).toBe(2);
    expect(summarizeFieldLockReleaseDecisions(decisions).plannedReleases).toBe(0);
  });

  /**
   * `inheritSchoolFromLeadPi` is the same hazard from inside `materializeEntity`:
   * `leadPiSchoolInheritanceGate` returns `locked` on a `school` or `departments`
   * lock and the call sits behind `!options.dryRun`, so the only lane that writes
   * these is the one a dry run does not run. They are browse facet values, so a
   * release judged on the projection alone would move a facet.
   */
  it('refuses the org-unit locks whose only writer is skipped in a dry run', () => {
    const decisions = decideFieldLockReleases(
      {
        slug: 'org-unit-row',
        school: '',
        schools: [],
        departments: [],
        manuallyLockedFields: ['school', 'schools', 'departments'],
      },
      { plannedSet: { name: 'Org Unit Row' } },
    );

    expect(decisions.map((decision) => decision.verdict)).toEqual([
      'keep_gates_other_writer',
      'keep_gates_other_writer',
      'keep_gates_other_writer',
    ]);
  });

  // The table is only worth having if it names the fields the real gate reads, so
  // read them off the gate rather than restating the list.
  it('covers every field the real lead-PI inheritance gate refuses to write past', () => {
    for (const field of ['school', 'departments']) {
      expect(
        leadPiSchoolInheritanceGate({
          manuallyLockedFields: [field],
          school: '',
          schools: [],
          kind: 'lab',
          departments: [],
        }),
      ).toBe('locked');
      expect(fieldLockGatesNonMaterializerWriteLane(field)).toBe(true);
    }
  });
});

describe('a lock that stops the field being collected', () => {
  const absenceLockOn = (field: string, storedValue: unknown) => ({
    slug: 'suppressed-collection',
    [field]: storedValue,
    manuallyLockedFields: [field],
  });

  /**
   * `researchAreas` is a target of two lock-gated planner policies, so the lock is
   * why no observation exists. Reading that absence as agreement would hand the
   * field back to lanes that then restore the areas someone cleared.
   */
  it('is not released on a plan that never names it', () => {
    const decisions = decideFieldLockReleases(absenceLockOn('researchAreas', []), {
      plannedSet: { name: 'Suppressed Collection Lab' },
    });

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_engine_silent']);
  });

  it('is released when the plan names it and derives the same absence', () => {
    const decisions = decideFieldLockReleases(absenceLockOn('researchAreas', []), {
      plannedSet: { name: 'Suppressed Collection Lab', researchAreas: [] },
    });

    expect(decisions.map((decision) => decision.verdict)).toEqual(['release']);
  });

  /**
   * A field no lock-gated lane collects keeps the original reading: the projection
   * decided not to write it, so the stored value stands and that is an answer.
   */
  it('leaves a field no gated lane collects judged on the stored value', () => {
    const decisions = decideFieldLockReleases(absenceLockOn('websiteUrl', ''), {
      plannedSet: { name: 'Suppressed Collection Lab' },
    });

    expect(decisions.map((decision) => decision.verdict)).toEqual(['release']);
  });
});

describe('a lock whose presence gates a sibling field', () => {
  const describedRow = (plannedShortDescription?: string) => ({
    entity: {
      slug: 'described-lab',
      fullDescription: 'A pinned body for the lab.',
      shortDescription: 'Stored card.',
      manuallyLockedFields: ['fullDescription'],
      fieldLockProvenance: { fullDescription: workaround('repair-fixture') },
    },
    answer: {
      plannedSet: {
        fullDescription: 'A pinned body for the lab.',
        ...(plannedShortDescription === undefined
          ? {}
          : { shortDescription: plannedShortDescription }),
      },
    },
  });

  /**
   * Only the unlocked path can decide the body restates the stored card, which
   * reopens `shortDescription` for re-derivation. So a `fullDescription` lock can
   * agree exactly and the release still move served card text.
   */
  it('is kept when the plan agrees about it but moves the sibling', () => {
    const { entity, answer } = describedRow('A re-derived card.');

    const decisions = decideFieldLockReleases(entity, answer);

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_sibling_field_moves']);
    expect(decisions[0].movedSiblingFields).toEqual(['shortDescription']);
    expect(summarizeFieldLockReleaseDecisions(decisions).keptSiblingFieldMoves).toBe(1);
    expect(summarizeFieldLockReleaseDecisions(decisions).plannedReleases).toBe(0);
  });

  it('is released when the plan derives the stored sibling value too', () => {
    const { entity, answer } = describedRow('Stored card.');

    expect(decideFieldLockReleases(entity, answer).map((d) => d.verdict)).toEqual(['release']);
  });

  it('is released when the plan leaves the sibling alone', () => {
    const { entity, answer } = describedRow(undefined);

    expect(decideFieldLockReleases(entity, answer).map((d) => d.verdict)).toEqual(['release']);
  });
});

describe('resolveFieldLockReleases asks about the set it is about to release', () => {
  const twoLockRow = {
    slug: 'two-locks',
    websiteUrl: '',
    displayName: 'Stored Name',
    manuallyLockedFields: ['websiteUrl', 'displayName'],
    fieldLockProvenance: {
      websiteUrl: workaround('repair-fixture'),
      displayName: workaround('repair-fixture'),
    },
  };

  /**
   * The reported regression: a plan produced with BOTH locks ignored judged
   * `displayName`, but only `displayName` is released, so `websiteUrl` stays pinned
   * and feeds the identity-name authority loop a different value. The verdict has
   * to come from a plan describing the release set itself.
   */
  it('re-asks with only the agreeing subset and keeps a lock that then disagrees', async () => {
    const asked: string[][] = [];
    const answers = new Map<string, MaterializerProjectionAnswer>([
      // Both locks ignored: the engine derives the stored displayName.
      [
        'displayName,websiteUrl',
        { plannedSet: { websiteUrl: 'https://example.edu/lab/', displayName: 'Stored Name' } },
      ],
      // Only displayName ignored, so the pinned empty websiteUrl is still in play
      // and the name authority loop projects a different name.
      ['displayName', { plannedSet: { displayName: 'Other Name' } }],
    ]);

    const decisions = await resolveFieldLockReleases(twoLockRow, async (fields) => {
      asked.push([...fields]);
      return answers.get([...fields].sort().join(','));
    });

    expect(asked).toEqual([['websiteUrl', 'displayName'], ['displayName']]);
    expect(decisions.map((decision) => [decision.field, decision.verdict])).toEqual([
      ['websiteUrl', 'keep_engine_disagrees'],
      ['displayName', 'keep_engine_disagrees'],
    ]);
  });

  it('stops after one question when the first plan already describes every release', async () => {
    const asked: string[][] = [];
    const decisions = await resolveFieldLockReleases(twoLockRow, async (fields) => {
      asked.push([...fields]);
      return { plannedSet: { websiteUrl: '', displayName: 'Stored Name' } };
    });

    expect(asked).toEqual([['websiteUrl', 'displayName']]);
    expect(decisions.every((decision) => decision.verdict === 'release')).toBe(true);
  });

  it('reports every lock as silent when the engine makes no plan at all', async () => {
    const decisions = await resolveFieldLockReleases(twoLockRow, async () => undefined);

    expect(decisions.map((decision) => decision.verdict)).toEqual([
      'keep_engine_silent',
      'keep_engine_silent',
    ]);
  });
});

describe('the summary separates the two reasons a lock is kept unasked', () => {
  /**
   * An `operator_decision` kept is the mechanism working; an `unknown` kept is the
   * pre-#2616 backlog that no engine improvement can re-open. One count cannot
   * carry both findings.
   */
  const keptUnaskedRow = {
    slug: 'kept-unasked-row',
    entityType: 'LAB',
    name: 'Curated Name',
    displayName: 'Recordless Name',
    manuallyLockedFields: ['entityType', 'name', 'displayName'],
    fieldLockProvenance: {
      entityType: { ...workaround('operator'), reason: 'operator_decision' as const },
      name: { ...workaround('operator'), reason: 'operator_decision' as const },
    },
  };

  it('reports the recordless locks apart from the declared operator decisions', () => {
    const summary = summarizeFieldLockReleaseDecisions(
      decideFieldLockReleases(keptUnaskedRow, { plannedSet: { shortDescription: 'x' } }),
    );

    expect(summary.keptNotRevisitable).toBe(3);
    expect(summary.keptNotRevisitableByReason).toEqual({ operator_decision: 2, unknown: 1 });
    expect(summary.lockedInstancesByReason).toEqual({ operator_decision: 2, unknown: 1 });
  });

  it('counts a released lock in the corpus breakdown but not in the kept one', () => {
    const summary = summarizeFieldLockReleaseDecisions(
      decideFieldLockReleases(
        {
          slug: 'released-row',
          websiteUrl: '',
          manuallyLockedFields: ['websiteUrl'],
          fieldLockProvenance: { websiteUrl: workaround('repair') },
        },
        { plannedSet: { websiteUrl: '' } },
      ),
    );

    expect(summary.plannedReleases).toBe(1);
    expect(summary.lockedInstancesByReason).toEqual({ engine_gap_workaround: 1 });
    expect(summary.keptNotRevisitableByReason).toEqual({});
  });
});

describe('a lock that records no reason, under the proven-inert rule', () => {
  const unrecordedLock = {
    slug: 'unrecorded-row',
    name: 'Robin Roster Faculty Research',
    manuallyLockedFields: ['name'],
  };

  it('stays shut under the standing rule, whatever the engine plans', () => {
    const decisions = decideFieldLockReleases(unrecordedLock, {
      plannedSet: { name: 'Robin Roster Faculty Research' },
    });

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_not_revisitable']);
  });

  it('releases when the plan NAMES the field and reproduces the stored value', () => {
    const decisions = decideFieldLockReleases(
      unrecordedLock,
      { plannedSet: { name: 'Robin Roster Faculty Research' } },
      { releaseProvenInert: true },
    );

    expect(decisions[0].verdict).toBe('release');
    expect(decisions[0].provenInert).toBe(true);
    expect(summarizeFieldLockReleaseDecisions(decisions).plannedReleasesProvenInert).toBe(1);
  });

  // The stored-value fallback in `plannedFieldValue` is why relaxing "revisitable"
  // alone was refused: a projection silent about a field says nothing about it, and
  // reading that silence as agreement hands the field back to a lane that then
  // restores whatever a repair removed.
  it('keeps a lock the plan is silent about, rather than reading silence as agreement', () => {
    const decisions = decideFieldLockReleases(
      unrecordedLock,
      { plannedSet: { departments: ['Fictional Studies'] } },
      { releaseProvenInert: true },
    );

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_not_revisitable']);
  });

  it('keeps a lock whose field the plan would move', () => {
    const decisions = decideFieldLockReleases(
      unrecordedLock,
      { plannedSet: { name: 'Grange Writer-in-Residence Faculty Research' } },
      { releaseProvenInert: true },
    );

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_engine_disagrees']);
  });

  it('keeps a lock whose release would move a sibling field', () => {
    const decisions = decideFieldLockReleases(
      {
        slug: 'unrecorded-row',
        fullDescription: 'A body a student reads.',
        shortDescription: 'A card a student reads.',
        manuallyLockedFields: ['fullDescription'],
      },
      {
        plannedSet: {
          fullDescription: 'A body a student reads.',
          shortDescription: 'A different card.',
        },
      },
      { releaseProvenInert: true },
    );

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_sibling_field_moves']);
  });

  it('still refuses a lock that holds a reconciler shut', () => {
    const decisions = decideFieldLockReleases(
      {
        slug: 'unrecorded-row',
        activeAtYaleCache: false,
        manuallyLockedFields: ['activeAtYaleCache'],
      },
      { plannedSet: { activeAtYaleCache: false } },
      { releaseProvenInert: true },
    );

    expect(decisions.map((decision) => decision.verdict)).toEqual(['keep_gates_other_writer']);
  });

  it('asks the engine about an unrecorded lock, which the standing rule never does', async () => {
    const asked: string[][] = [];
    const answerFor = async (
      revisedFields: readonly string[],
    ): Promise<MaterializerProjectionAnswer> => {
      asked.push([...revisedFields]);
      return { plannedSet: { name: 'Robin Roster Faculty Research' } };
    };

    expect((await resolveFieldLockReleases(unrecordedLock, answerFor)).map((d) => d.verdict)).toEqual(
      ['keep_not_revisitable'],
    );
    expect(asked).toEqual([]);

    const decisions = await resolveFieldLockReleases(unrecordedLock, answerFor, {
      releaseProvenInert: true,
    });

    expect(asked).toEqual([['name']]);
    expect(decisions.map((decision) => decision.verdict)).toEqual(['release']);
  });
});
