import {
  buildInconclusiveInvariant,
  buildInvariant,
  corpusFingerprintMoved,
  type CorpusFingerprint,
  type InvariantResult,
} from './journeyEvalMetrics';
import {
  PROGRAM_ATTRIBUTED_FIELDS,
  type ProgramAttributedField,
  type ProgramFieldOutcome,
} from './programServedFieldAttribution';

export const withSurfaceId = (surface: string, result: InvariantResult): InvariantResult => ({
  ...result,
  id: `${surface}-${result.id}`,
});

const inconclusiveWhenMoved = (
  id: string,
  title: string,
  holds: boolean,
  detail: Record<string, unknown>,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
  reason: string,
): InvariantResult =>
  !holds && corpusFingerprintMoved(corpusBefore, corpusAfter)
    ? buildInconclusiveInvariant(id, title, reason, { ...detail, corpusBefore, corpusAfter })
    : buildInvariant(id, title, holds, detail);

export function checkWalkCoversReportedTotal(
  surface: string,
  distinctRowsServed: number,
  reportedTotal: number | null,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  return inconclusiveWhenMoved(
    `${surface}-full-walk-serves-the-reported-total`,
    'Walking every page the way the browse client does serves exactly the reported total',
    reportedTotal !== null && distinctRowsServed === reportedTotal,
    { distinctRowsServed, reportedTotal },
    corpusBefore,
    corpusAfter,
    'The corpus changed while the pages were walked, so the total and the pages may describe different corpora',
  );
}

export interface FilterOptionObservation {
  field: string;
  value: string;
  filteredTotal: number;
  servedOnFirstPage: number;
  servedCarryingValue: number;
}

export function checkOfferedOptionsServeARow(
  surface: string,
  observations: readonly FilterOptionObservation[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = `${surface}-offered-filter-option-serves-a-row`;
  const title = 'Every filter option the browse offers returns at least one row when chosen';
  if (observations.length === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No filter option was offered, so a zero dead-option count would be a green signal over an empty population',
      { checked: 0 },
    );
  }
  const deadOptionsByField: Record<string, number> = {};
  for (const observation of observations) {
    if (observation.filteredTotal > 0) continue;
    deadOptionsByField[observation.field] = (deadOptionsByField[observation.field] ?? 0) + 1;
  }
  const deadOptions = Object.values(deadOptionsByField).reduce((sum, count) => sum + count, 0);
  return inconclusiveWhenMoved(
    id,
    title,
    deadOptions === 0,
    { checked: observations.length, deadOptions, deadOptionsByField },
    corpusBefore,
    corpusAfter,
    'The corpus changed between reading the options and the filtered browses, so an option may have lost its last row for a reason the serving code does not control',
  );
}

export function checkFilteredRowsCarryValue(
  surface: string,
  observations: readonly FilterOptionObservation[],
): InvariantResult {
  const id = `${surface}-filtered-browse-honors-the-filter`;
  const title = 'Every row a filtered browse serves carries the chosen filter value';
  const served = observations.reduce((sum, observation) => sum + observation.servedOnFirstPage, 0);
  if (served === 0) {
    return buildInconclusiveInvariant(
      id,
      title,
      'No filtered browse served a row, so a zero mismatch count would be a green signal over an empty population',
      { checked: observations.length },
    );
  }
  const mismatchesByField: Record<string, number> = {};
  for (const observation of observations) {
    const mismatched = observation.servedOnFirstPage - observation.servedCarryingValue;
    if (mismatched > 0)
      mismatchesByField[observation.field] =
        (mismatchesByField[observation.field] ?? 0) + mismatched;
  }
  const mismatches = Object.values(mismatchesByField).reduce((sum, count) => sum + count, 0);
  return buildInvariant(id, title, mismatches === 0, {
    optionsChecked: observations.length,
    rowsChecked: served,
    mismatches,
    mismatchesByField,
  });
}

export interface DeadlineOrderRow {
  storedRowFound: boolean;
  storedDeadlineMs: number | null;
}

export function checkDeadlineSortOrder(
  surface: string,
  rows: readonly DeadlineOrderRow[],
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  let undatedAfterDated = 0;
  let inversions = 0;
  let seenDated = false;
  let previous: number | null = null;
  let storedRowMissing = 0;
  for (const row of rows) {
    if (!row.storedRowFound) {
      storedRowMissing += 1;
      continue;
    }
    if (row.storedDeadlineMs === null) {
      if (seenDated) undatedAfterDated += 1;
      continue;
    }
    seenDated = true;
    if (previous !== null && row.storedDeadlineMs < previous) inversions += 1;
    previous = row.storedDeadlineMs;
  }
  return inconclusiveWhenMoved(
    `${surface}-default-sort-orders-by-stored-deadline`,
    'The default browse is ordered by the stored deadline the service sorts on, undated rows first, then earliest first',
    inversions === 0 && undatedAfterDated === 0,
    { returned: rows.length, storedRowMissing, inversions, undatedAfterDated },
    corpusBefore,
    corpusAfter,
    'The corpus changed while the pages were read, so a row may have moved between two requests',
  );
}

export interface ServedRowGateObservation {
  servedVersionMatchesStored: boolean;
  storedRowFound: boolean;
  storedTierIsServed: boolean;
  archived: boolean;
  gateTierIsServed: boolean;
  gateReasons: readonly string[];
}

export interface ServedRowGateTally {
  servedRows: number;
  comparable: number;
  skippedStaleIndex: number;
  missingStoredRow: number;
  outsideServedTier: number;
  archived: number;
  gateRefuses: number;
  refusedRowReasons: Record<string, number>;
}

export function tallyServedRowGate(
  observations: readonly ServedRowGateObservation[],
): ServedRowGateTally {
  const tally: ServedRowGateTally = {
    servedRows: observations.length,
    comparable: 0,
    skippedStaleIndex: 0,
    missingStoredRow: 0,
    outsideServedTier: 0,
    archived: 0,
    gateRefuses: 0,
    refusedRowReasons: {},
  };
  for (const observation of observations) {
    if (!observation.storedRowFound) {
      tally.missingStoredRow += 1;
      continue;
    }
    if (!observation.servedVersionMatchesStored) {
      tally.skippedStaleIndex += 1;
      continue;
    }
    tally.comparable += 1;
    if (!observation.storedTierIsServed) tally.outsideServedTier += 1;
    if (observation.archived) tally.archived += 1;
    if (!observation.gateTierIsServed) {
      tally.gateRefuses += 1;
      for (const reason of observation.gateReasons)
        tally.refusedRowReasons[reason] = (tally.refusedRowReasons[reason] ?? 0) + 1;
    }
  }
  return tally;
}

const emptyPopulationReason =
  'No served row could be compared with its stored row, so a zero count would be a green signal over an empty population';

export function checkServedRowsAreInServedTier(
  surface: string,
  tally: ServedRowGateTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = `${surface}-served-row-is-in-the-served-tier`;
  const title = 'Every row the browse serves is stored in the student-ready tier and not archived';
  const detail = {
    servedRows: tally.servedRows,
    comparable: tally.comparable,
    skippedStaleIndex: tally.skippedStaleIndex,
    missingStoredRow: tally.missingStoredRow,
    outsideServedTier: tally.outsideServedTier,
    archived: tally.archived,
  };
  if (tally.comparable === 0)
    return buildInconclusiveInvariant(id, title, emptyPopulationReason, detail);
  const violations = tally.outsideServedTier + tally.archived + tally.missingStoredRow;
  return inconclusiveWhenMoved(
    id,
    title,
    violations === 0,
    detail,
    corpusBefore,
    corpusAfter,
    'The corpus changed while the rows were read, so a served row may have been re-tiered or removed after it was served',
  );
}

export function checkServedRowsPassTheGate(
  surface: string,
  tally: ServedRowGateTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = `${surface}-served-row-passes-the-visibility-gate`;
  const title =
    'The student visibility gate, recomputed on the stored row, admits every served row';
  const detail = {
    comparable: tally.comparable,
    skippedStaleIndex: tally.skippedStaleIndex,
    gateRefuses: tally.gateRefuses,
    refusedRowReasons: tally.refusedRowReasons,
  };
  if (tally.comparable === 0)
    return buildInconclusiveInvariant(id, title, emptyPopulationReason, detail);
  return inconclusiveWhenMoved(
    id,
    title,
    tally.gateRefuses === 0,
    detail,
    corpusBefore,
    corpusAfter,
    'The corpus changed while the rows were read, so a stored row may describe a different version than the one served',
  );
}

export interface ProgramFieldRowObservation {
  servedVersionMatchesStored: boolean;
  outcomes: readonly ProgramFieldOutcome[];
}

export interface ProgramFieldTally {
  differing: number;
  attributed: number;
  unexplained: number;
  byGuard: Record<string, number>;
  unexplainedReasons: Record<string, number>;
}

export interface ProgramFieldAttributionTally {
  rows: number;
  comparable: number;
  skippedStaleIndex: number;
  unexplained: number;
  byField: Record<ProgramAttributedField, ProgramFieldTally>;
}

const emptyFieldTally = (): ProgramFieldTally => ({
  differing: 0,
  attributed: 0,
  unexplained: 0,
  byGuard: {},
  unexplainedReasons: {},
});

export function tallyProgramFieldAttribution(
  observations: readonly ProgramFieldRowObservation[],
): ProgramFieldAttributionTally {
  const byField = Object.fromEntries(
    PROGRAM_ATTRIBUTED_FIELDS.map((field) => [field, emptyFieldTally()]),
  ) as Record<ProgramAttributedField, ProgramFieldTally>;
  const tally: ProgramFieldAttributionTally = {
    rows: observations.length,
    comparable: 0,
    skippedStaleIndex: 0,
    unexplained: 0,
    byField,
  };
  for (const observation of observations) {
    if (!observation.servedVersionMatchesStored) {
      tally.skippedStaleIndex += 1;
      continue;
    }
    tally.comparable += 1;
    for (const outcome of observation.outcomes) {
      if (outcome.status === 'unchanged') continue;
      const fieldTally = byField[outcome.field];
      fieldTally.differing += 1;
      if (outcome.status === 'attributed') {
        fieldTally.attributed += 1;
        fieldTally.byGuard[outcome.guard] = (fieldTally.byGuard[outcome.guard] ?? 0) + 1;
      } else {
        fieldTally.unexplained += 1;
        tally.unexplained += 1;
        fieldTally.unexplainedReasons[outcome.reason] =
          (fieldTally.unexplainedReasons[outcome.reason] ?? 0) + 1;
      }
    }
  }
  return tally;
}

export function checkProgramFieldAttribution(
  surface: string,
  tally: ProgramFieldAttributionTally,
  corpusBefore: CorpusFingerprint,
  corpusAfter: CorpusFingerprint,
): InvariantResult {
  const id = `${surface}-every-served-field-difference-is-attributable`;
  const title =
    'Every deadline, application status, apply link, and eligibility difference between a stored and a served row is attributable to a named serve-time guard';
  if (tally.comparable === 0)
    return buildInconclusiveInvariant(id, title, emptyPopulationReason, { ...tally });
  return inconclusiveWhenMoved(
    id,
    title,
    tally.unexplained === 0,
    { ...tally },
    corpusBefore,
    corpusAfter,
    'The corpus changed while the rows were compared, so a difference may be unexplained only because the served and the stored row describe different versions',
  );
}
