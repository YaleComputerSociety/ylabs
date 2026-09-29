import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../entityMaterializer.ts',
);
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

/**
 * Every observation read on the projection path either goes through `MaterializationReadSource`
 * or is listed here with the reason it cannot.
 *
 * The engine benchmark's leak detector counts a miss only for a read that goes through that
 * interface, so a read outside it is invisible: the benchmark reported
 * `rowsWithIncompleteInput: 0` while the merged-survivor evidence came from the corpus (#3849).
 * A hole the detector cannot see is worse than one it reports, and it was found by accident
 * rather than by looking, which is what this guard exists to change.
 *
 * Adding a direct observation read fails this test. That is the point: route it, or add it here
 * with a reason someone has read.
 */
const REVIEWED_UNROUTED_READS: ReadonlyArray<{ fn: string; reason: string }> = [
  {
    fn: 'resolveNetidForRosterEmailAlias',
    reason:
      'A corpus-wide search by VALUE - every user observation whose email local part matches - so it names no entity and the read source, which is keyed by entity, has nothing to answer with. Freezing it would need a frozen corpus index rather than a frozen row.',
  },
  {
    fn: 'liveResearchEntityNamesUserKeyAsLead',
    reason:
      'The same shape: a corpus-wide search for any row asserting this `inferredPiUserKey`, keyed by value rather than by entity.',
  },
  {
    fn: 'leadPiInheritanceEvidence',
    reason:
      'A read-after-write check: it reads back the observations `assertLeadPiInheritanceObservations` just wrote in this same pass, to tell an accepted assertion from a refused one. Frozen input would answer about the state BEFORE the write, so routing it would make the check lie.',
  },
  {
    fn: 'reconcileOfficialRosterSnapshotsFromRun',
    reason: 'Run-level reconciliation over a whole scrape run, not a per-row projection read.',
  },
  {
    fn: 'materializeFromRun',
    reason: 'The run driver enumerating which entities a run touched, before any row is projected.',
  },
];

const READ_CALL = /\bObservation\.(find|findOne|aggregate|countDocuments|distinct)\s*\(/g;

/** The nearest preceding function declaration, which is the unit this guard reasons about. */
const enclosingFunction = (index: number): string => {
  const before = SOURCE.slice(0, index);
  const matches = [
    ...before.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g),
  ];
  return matches.length > 0 ? matches[matches.length - 1][1] : '(top level)';
};

/**
 * Whether the read is a FALLBACK behind something that already answered, rather than the path
 * itself. Two shapes count: an answer from the read source, and an answer from observations the
 * caller already holds, which is how the provenance lookup avoids a query on the common path.
 */
const ROUTING_MARKERS =
  /prefetch\??\.observationsFor(Key|Id)|routedObservationsForKeysAndIds|prefetched\?\.hit|chunkPrefetch|inHandById|missingIds/;

const isRoutedRead = (index: number): boolean =>
  ROUTING_MARKERS.test(SOURCE.slice(Math.max(0, index - 1200), index));

describe('every projection observation read is routed or reviewed (#3849)', () => {
  const reads = [...SOURCE.matchAll(READ_CALL)].map((match) => ({
    index: match.index ?? 0,
    fn: enclosingFunction(match.index ?? 0),
  }));

  it('finds the reads it is meant to guard', () => {
    expect(reads.length).toBeGreaterThanOrEqual(8);
  });

  it('has no unrouted read outside the reviewed list', () => {
    const reviewed = new Set(REVIEWED_UNROUTED_READS.map((entry) => entry.fn));
    const offenders = [
      ...new Set(
        reads
          .filter((read) => !isRoutedRead(read.index) && !reviewed.has(read.fn))
          .map((read) => read.fn),
      ),
    ];

    expect(offenders).toEqual([]);
  });

  /**
   * An exemption for a function that no longer reads observations is dead weight that makes the
   * list look more considered than it is, so it has to go when the read does.
   */
  it('lists no exemption that has stopped reading observations', () => {
    const reading = new Set(reads.map((read) => read.fn));
    const stale = REVIEWED_UNROUTED_READS.filter((entry) => !reading.has(entry.fn)).map(
      (e) => e.fn,
    );

    expect(stale).toEqual([]);
  });

  /**
   * Deliberately NOT asserted: that each reason is long enough. A character count cannot tell a
   * reason from eighty characters of noise, so it would be decoration that makes the list look
   * reviewed without checking anything. The reasons are prose for a reader; the checks above are
   * what the suite can actually verify.
   */
});
