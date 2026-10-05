import { describe, expect, it } from 'vitest';
import {
  assertFieldRetractionContractsAreDeclarable,
  disregardPreFixAbsenceClaims,
  fieldRetractionContracts,
  planFieldRetractions,
  runCarriesAbsenceClaimFix,
  type AbsenceClaimCutoff,
  type CommitIsAncestor,
  type FieldRetractionCandidateObservation,
  type FieldRetractionCompleteRead,
  type FieldRetractionEntityState,
  type FieldRetractionRunProvenance,
  type SourceFieldRetractionContract,
} from '../fieldRetraction';

const FIX_COMMIT = 'a'.repeat(40);
const FIXED_RUN_COMMIT = 'b'.repeat(40);
const STALE_RUN_COMMIT = 'c'.repeat(40);
const UNKNOWN_RUN_COMMIT = 'd'.repeat(40);
const FIX_MERGED_AT = new Date('2026-06-01T12:00:00Z');

const CUTOFF: AbsenceClaimCutoff = {
  field: 'websiteUrl',
  fixedBy: '#9001',
  fixCommit: FIX_COMMIT,
  fixMergedAt: FIX_MERGED_AT,
};

const CONTRACT: SourceFieldRetractionContract = {
  witnessFields: ['slug', 'sourceUrls'],
  retractableFields: ['websiteUrl'],
  absenceClaimCutoffs: [CUTOFF],
  notes: 'test',
};

const ancestry: CommitIsAncestor = (ancestor, descendant) => {
  if (ancestor !== FIX_COMMIT) return undefined;
  if (descendant === FIXED_RUN_COMMIT) return true;
  if (descendant === STALE_RUN_COMMIT) return false;
  return undefined;
};

const before = new Date('2026-05-01T00:00:00Z');
const after = new Date('2026-07-01T00:00:00Z');

describe('whether a run carried the absence-claim fix', () => {
  it('trusts a run whose recorded commit contains the fix commit', () => {
    expect(runCarriesAbsenceClaimFix({ codeSha: FIXED_RUN_COMMIT }, CUTOFF, ancestry)).toBe(true);
  });

  it('refuses a run started after the merge whose recorded commit lacks the fix', () => {
    expect(
      runCarriesAbsenceClaimFix({ startedAt: after, codeSha: STALE_RUN_COMMIT }, CUTOFF, ancestry),
    ).toBe(false);
  });

  it('falls back to the merge time when the recorded commit cannot be resolved', () => {
    expect(
      runCarriesAbsenceClaimFix(
        { startedAt: after, codeSha: UNKNOWN_RUN_COMMIT },
        CUTOFF,
        ancestry,
      ),
    ).toBe(true);
    expect(
      runCarriesAbsenceClaimFix(
        { startedAt: before, codeSha: UNKNOWN_RUN_COMMIT },
        CUTOFF,
        ancestry,
      ),
    ).toBe(false);
  });

  it('decides a run that recorded no commit by its start against the merge time', () => {
    expect(runCarriesAbsenceClaimFix({ startedAt: after }, CUTOFF, ancestry)).toBe(true);
    expect(runCarriesAbsenceClaimFix({ startedAt: FIX_MERGED_AT }, CUTOFF, ancestry)).toBe(true);
    expect(runCarriesAbsenceClaimFix({ startedAt: before }, CUTOFF, ancestry)).toBe(false);
  });

  it('refuses a claim whose run cannot be found', () => {
    expect(runCarriesAbsenceClaimFix(undefined, CUTOFF, ancestry)).toBe(false);
    expect(runCarriesAbsenceClaimFix({}, CUTOFF, ancestry)).toBe(false);
  });
});

const read = (scrapeRunId: string, iso: string): FieldRetractionCompleteRead => ({
  entityKey: 'fixture-entity',
  scrapeRunId,
  observedAt: new Date(iso),
  assertsNoValueFor: ['websiteUrl'],
});

const observation: FieldRetractionCandidateObservation = {
  observationId: 'obs-1',
  entityKey: 'fixture-entity',
  field: 'websiteUrl',
  value: 'https://fixture-lab.example.org/',
  scrapeRunId: 'run-origin',
  observedAt: new Date('2026-01-01T00:00:00Z'),
};

const entity: FieldRetractionEntityState = {
  entityId: '000000000000000000000001',
  entityKey: 'fixture-entity',
  manuallyLockedFields: [],
  storedValues: { websiteUrl: 'https://fixture-lab.example.org' },
  liveObservationCountByField: { websiteUrl: 1 },
};

const runs = new Map<string, FieldRetractionRunProvenance>([
  ['run-pre-1', { startedAt: new Date('2026-04-01T00:00:00Z') }],
  ['run-pre-2', { startedAt: new Date('2026-05-01T00:00:00Z') }],
  ['run-post-1', { startedAt: new Date('2026-07-01T00:00:00Z') }],
  ['run-post-2', { startedAt: new Date('2026-08-01T00:00:00Z') }],
]);

function plan(runIds: string[]) {
  const reads = disregardPreFixAbsenceClaims(
    runIds.map((runId, index) => read(runId, `2026-0${index + 2}-15T00:00:00Z`)),
    CONTRACT,
    runs,
    ancestry,
  );
  return planFieldRetractions({
    sourceName: 'fixture-source',
    contract: CONTRACT,
    completeReads: reads,
    activeObservations: [observation],
    entities: [entity],
  });
}

describe('field retraction counts only absence claims made by fixed lane code', () => {
  it('retracts nothing on two absence claims that both predate the fix', () => {
    const result = plan(['run-pre-1', 'run-pre-2']);
    expect(result.retractions).toEqual([]);
    expect(result.counts.absenceNotWitnessed).toBe(1);
    expect(result.counts.preFixAbsenceClaims).toEqual({
      websiteUrl: { excludedClaims: 2, heldObservations: 1, heldEntities: 1 },
    });
  });

  it('needs the full quorum from post-fix claims alone', () => {
    const result = plan(['run-pre-1', 'run-pre-2', 'run-post-1']);
    expect(result.retractions).toEqual([]);
    expect(result.counts.awaitingSecondCompleteRead).toBe(1);
    expect(result.counts.preFixAbsenceClaims.websiteUrl).toEqual({
      excludedClaims: 2,
      heldObservations: 1,
      heldEntities: 1,
    });
  });

  it('retracts once two post-fix claims exist, whatever came before them', () => {
    const result = plan(['run-pre-1', 'run-post-1', 'run-post-2']);
    expect(result.retractions).toHaveLength(1);
    expect(result.counts.preFixAbsenceClaims.websiteUrl).toEqual({
      excludedClaims: 1,
      heldObservations: 0,
      heldEntities: 0,
    });
  });

  it('reports a covered field even when no claim predates the fix', () => {
    const result = plan(['run-post-1', 'run-post-2']);
    expect(result.retractions).toHaveLength(1);
    expect(result.counts.preFixAbsenceClaims).toEqual({
      websiteUrl: { excludedClaims: 0, heldObservations: 0, heldEntities: 0 },
    });
  });

  it('keeps a read whose claim is disregarded as a complete read that said nothing', () => {
    const [disregarded] = disregardPreFixAbsenceClaims(
      [read('run-pre-1', '2026-02-15T00:00:00Z')],
      CONTRACT,
      runs,
      ancestry,
    );
    expect(disregarded.assertsNoValueFor).toEqual(['websiteUrl']);
    expect(disregarded.preFixAbsenceClaims).toEqual(['websiteUrl']);
  });

  it('leaves claims alone on a source that declares no cutoff', () => {
    const uncut: SourceFieldRetractionContract = { ...CONTRACT, absenceClaimCutoffs: undefined };
    const reads = disregardPreFixAbsenceClaims(
      [read('run-pre-1', '2026-02-15T00:00:00Z'), read('run-pre-2', '2026-03-15T00:00:00Z')],
      uncut,
      runs,
      ancestry,
    );
    expect(reads.every((entry) => (entry.preFixAbsenceClaims ?? []).length === 0)).toBe(true);
    const result = planFieldRetractions({
      sourceName: 'fixture-source',
      contract: uncut,
      completeReads: reads,
      activeObservations: [observation],
      entities: [entity],
    });
    expect(result.retractions).toHaveLength(1);
    expect(result.counts.preFixAbsenceClaims).toEqual({});
  });
});

describe('declared absence-claim cutoffs', () => {
  it('cuts off the pre-#3666 websiteUrl claims on both lanes #3666 fixed', () => {
    for (const source of ['dept-faculty-roster', 'ysm-faculty-directory']) {
      expect(fieldRetractionContracts[source].absenceClaimCutoffs).toEqual([
        {
          field: 'websiteUrl',
          fixedBy: '#3666',
          fixCommit: '63ece2c57056f38e588b0c733e59827ba9691f83',
          fixMergedAt: new Date('2026-09-27T16:51:32Z'),
        },
      ]);
    }
  });

  it('refuses a cutoff on a field the source cannot retract', () => {
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        fixture: { ...CONTRACT, absenceClaimCutoffs: [{ ...CUTOFF, field: 'slug' }] },
      }),
    ).toThrow(/not a retractable field/);
  });

  it('refuses a cutoff that does not name a full fix commit, its PR, and a merge time', () => {
    for (const cutoff of [
      { ...CUTOFF, fixCommit: 'abc1234' },
      { ...CUTOFF, fixedBy: 'the roster fix' },
      { ...CUTOFF, fixMergedAt: new Date('not a date') },
    ]) {
      expect(() =>
        assertFieldRetractionContractsAreDeclarable({
          fixture: { ...CONTRACT, absenceClaimCutoffs: [cutoff] },
        }),
      ).toThrow();
    }
  });

  it('refuses two cutoffs for one field, so the rule a claim meets is never ambiguous', () => {
    expect(() =>
      assertFieldRetractionContractsAreDeclarable({
        fixture: { ...CONTRACT, absenceClaimCutoffs: [CUTOFF, { ...CUTOFF, fixedBy: '#9002' }] },
      }),
    ).toThrow(/more than one cutoff/);
  });
});
