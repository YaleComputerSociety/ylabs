/**
 * Detects the corpus-wide "the whole catalog just went stale" cliff for the /programs
 * (aliased /fellowships) surface - the durable guard #555 never got, requested in #1299.
 *
 * It reuses the read-time live/accepting derivation (`publicFellowshipForStudent`, #568)
 * rather than re-implementing deadline logic, so the audit reports exactly the actionable
 * set a genuine undergraduate sees: a program only counts as accepting when the read-time
 * correction leaves `isAcceptingApplications === true`.
 *
 * Pure functions, no DB access - unit-testable.
 */
import { deadlineIsPast, publicFellowshipForStudent, toValidDate } from './fellowshipService';

export interface CatalogFreshnessThresholds {
  minAcceptingShare: number;
  maxPastDeadlineShare: number;
  minCorpusSize: number;
}

export const DEFAULT_CATALOG_FRESHNESS_THRESHOLDS: CatalogFreshnessThresholds = {
  minAcceptingShare: 0.05,
  maxPastDeadlineShare: 0.85,
  minCorpusSize: 20,
};

export type CatalogFreshnessStatus = 'clean' | 'stale' | 'insufficient-data';

type DeadlineBucket = 'past' | 'future' | 'none';

const UNATTRIBUTED_SOURCE_KEY = '(none)';

export interface CatalogFreshnessSourceContribution {
  sourceKey: string;
  visible: number;
  accepting: number;
  pastDeadline: number;
}

export interface CatalogFreshnessReport {
  status: CatalogFreshnessStatus;
  thresholds: CatalogFreshnessThresholds;
  totals: {
    visible: number;
    accepting: number;
    deadlinePast: number;
    deadlineFuture: number;
    deadlineFutureProjected: number;
    deadlineNone: number;
  };
  shares: {
    accepting: number;
    pastDeadline: number;
  };
  breaches: string[];
  staleSourceKeys: CatalogFreshnessSourceContribution[];
}

const sourceKeyOf = (record: any): string => {
  const raw = record?.sourceKey;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : UNATTRIBUTED_SOURCE_KEY;
};

const deadlineBucket = (deadline: unknown, now: Date): DeadlineBucket => {
  if (toValidDate(deadline) === undefined) return 'none';
  return deadlineIsPast(deadline, now) ? 'past' : 'future';
};

const asPercent = (share: number): string => `${(share * 100).toFixed(1)}%`;

export function computeCatalogFreshness(
  records: any[],
  now: Date = new Date(),
  thresholds: CatalogFreshnessThresholds = DEFAULT_CATALOG_FRESHNESS_THRESHOLDS,
): CatalogFreshnessReport {
  const perSource = new Map<string, CatalogFreshnessSourceContribution>();
  let accepting = 0;
  let deadlinePast = 0;
  let deadlineFuture = 0;
  let deadlineFutureProjected = 0;
  let deadlineNone = 0;

  for (const record of records) {
    const publicView = publicFellowshipForStudent(record, now);
    const isAccepting = publicView?.isAcceptingApplications === true;
    const bucket = deadlineBucket(publicView?.deadline, now);
    const isProjected = publicView?.deadlineProjectedNextCycle === true;
    const key = sourceKeyOf(record);

    const contribution = perSource.get(key) ?? {
      sourceKey: key,
      visible: 0,
      accepting: 0,
      pastDeadline: 0,
    };
    contribution.visible += 1;
    if (isAccepting) {
      accepting += 1;
      contribution.accepting += 1;
    }
    if (bucket === 'past') {
      deadlinePast += 1;
      contribution.pastDeadline += 1;
    } else if (bucket === 'future') {
      deadlineFuture += 1;
      if (isProjected) deadlineFutureProjected += 1;
    } else {
      deadlineNone += 1;
    }
    perSource.set(key, contribution);
  }

  const visible = records.length;
  const acceptingShare = visible > 0 ? accepting / visible : 0;
  const pastDeadlineShare = visible > 0 ? deadlinePast / visible : 0;

  const breaches: string[] = [];
  let status: CatalogFreshnessStatus;
  if (visible < thresholds.minCorpusSize) {
    status = 'insufficient-data';
  } else {
    if (acceptingShare < thresholds.minAcceptingShare) {
      breaches.push(
        `student-facing accepting share ${asPercent(acceptingShare)} is below the floor ${asPercent(thresholds.minAcceptingShare)}`,
      );
    }
    if (pastDeadlineShare > thresholds.maxPastDeadlineShare) {
      breaches.push(
        `past-deadline share ${asPercent(pastDeadlineShare)} is above the ceiling ${asPercent(thresholds.maxPastDeadlineShare)}`,
      );
    }
    status = breaches.length > 0 ? 'stale' : 'clean';
  }

  const staleSourceKeys =
    status === 'stale'
      ? [...perSource.values()]
          .filter((c) => c.pastDeadline > 0 || c.accepting === 0)
          .sort(
            (a, b) =>
              b.pastDeadline - a.pastDeadline ||
              a.accepting - b.accepting ||
              b.visible - a.visible ||
              a.sourceKey.localeCompare(b.sourceKey),
          )
      : [];

  return {
    status,
    thresholds,
    totals: {
      visible,
      accepting,
      deadlinePast,
      deadlineFuture,
      deadlineFutureProjected,
      deadlineNone,
    },
    shares: { accepting: acceptingShare, pastDeadline: pastDeadlineShare },
    breaches,
    staleSourceKeys,
  };
}
