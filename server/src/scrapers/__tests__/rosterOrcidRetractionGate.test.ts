import { describe, expect, it } from 'vitest';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';
import {
  assertUserFieldRetractionContractsAreDeclarable,
  planUserFieldRetractions,
  userFieldRetractionContractFor,
  type UserFieldRetractionCandidateObservation,
  type UserPageRead,
} from '../fieldRetraction';

const KEY = 'dept:fixture:rowan-quillfeather';
const PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const PLAUSIBLE = syntheticPersonOrcid(6329);
const IMPLAUSIBLE = '2025-2024-2023-2022';
const at = (day: number) => new Date(Date.UTC(2026, 10, day));

const orcidRow = (value: string): UserFieldRetractionCandidateObservation => ({
  observationId: 'obs-orcid',
  entityKey: KEY,
  field: 'orcid',
  value,
  scrapeRunId: 'run-11',
  observedAt: at(11),
  sourceUrl: PAGE,
});

const twoCompleteAbsences: UserPageRead[] = [11, 13, 14].map((day) => ({
  entityKey: KEY,
  sourceUrl: PAGE,
  scrapeRunId: `run-${day}`,
  observedAt: at(day),
  assertsNoValueFor: day === 11 ? [] : ['orcid'],
}));

const plan = (sourceName: string, value: string, ownedElsewhere?: ReadonlySet<string>) =>
  planUserFieldRetractions({
    sourceName,
    contract: userFieldRetractionContractFor(sourceName)!,
    reads: twoCompleteAbsences,
    activeObservations: [orcidRow(value)],
    ...(ownedElsewhere ? { ownedElsewhere } : {}),
  });

describe('a roster absence retracts an ORCID only when it is implausible or owned elsewhere (#6329)', () => {
  it('keeps a plausible ORCID that two complete reads no longer state', () => {
    const result = plan('dept-faculty-roster', PLAUSIBLE);
    expect(result.retractions).toEqual([]);
    expect(result.counts.keptPlausibleOnAbsence).toBe(1);
  });

  it('retracts an implausible ORCID on the absence alone', () => {
    const result = plan('dept-faculty-roster', IMPLAUSIBLE);
    expect(result.retractions.map((planned) => planned.observationIds)).toEqual([['obs-orcid']]);
    expect(result.counts.keptPlausibleOnAbsence).toBe(0);
  });

  it('retracts a plausible ORCID another source puts on a different person', () => {
    const result = plan('dept-faculty-roster', PLAUSIBLE, new Set(['obs-orcid']));
    expect(result.retractions.map((planned) => planned.observationIds)).toEqual([['obs-orcid']]);
  });

  it('leaves another lane retracting a plausible ORCID its own page drops', () => {
    const result = plan('official-profile-pi-backfill', PLAUSIBLE);
    expect(result.retractions.map((planned) => planned.observationIds)).toEqual([['obs-orcid']]);
    expect(result.counts.keptPlausibleOnAbsence).toBe(0);
  });

  it('refuses a gate on a field the lane cannot retract', () => {
    expect(() =>
      assertUserFieldRetractionContractsAreDeclarable({
        'fixture-lane': {
          retractableFields: ['email'],
          absenceRetractionGates: { orcid: 'implausible-or-owned-elsewhere' },
          notes: 'fixture',
        },
      }),
    ).toThrow(/cannot retract/);
  });
});
