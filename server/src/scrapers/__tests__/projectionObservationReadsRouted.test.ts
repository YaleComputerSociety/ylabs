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
      'On the inferred-PI mint path, reached from `resolveInferredPiKeyIdentity`, so THE BENCHMARK NEVER MAKES THIS READ: it replays `researchEntity` rows only. Measured by instrumenting it and replaying 147 rows, which hit it zero times (#3863). It is also a corpus-wide search by value and so unroutable through an entity-keyed source, but that is the weaker reason; routing or freezing it changes no outcome until the benchmark replays `user` rows.',
  },
  {
    fn: 'liveResearchEntityNamesUserKeyAsLead',
    reason:
      'Called from `materializeUserIdentityToResearcher`, the `user` materializer, so the benchmark never makes this read either: zero hits over the same 147 rows. Value-keyed as well, but the reachability is what decides it.',
  },
  {
    fn: 'listingsSharingProfileUrl',
    reason:
      'Called from `materializeRosterMember`, the `researchGroupMember` materializer, so the benchmark never makes this read: it replays `researchEntity` rows only. It is also a search by value across every listing that carries one profile URL, whose purpose is to find listings other than the one being projected, so an entity-keyed source cannot answer it.',
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

/**
 * The same question for entity reads (#3857). `MaterializationReadSource` covers them through
 * `entityDocForId` / `entityDocForKey` and `hasNoMergedInRows` and nothing else, so every other
 * `ResearchEntity` read on the projection path is invisible to the leak detector in exactly the
 * way the observation reads were.
 *
 * Almost none of them is routable as things stand, and the reason is one contract mismatch rather
 * than ten separate ones: `entityDocFor*` answers "the row with this key, ARCHIVED OR NOT", which
 * is what its only existing consumer wants, because `findEntityDocByIdentifier` resolves a slug
 * without an archived filter on purpose and then handles the tombstone case itself. Six of these
 * ten reads ask for `archived: { $ne: true }`. Routing them through the current answers would
 * hand them an archived row where they expect nothing, and in the candidate lookup that means
 * adopting an archived shell.
 *
 * So the blocker is a missing answer, not a missing call: a live-only entity read on the
 * interface. Until that exists these stay exempt, and the exemption says why rather than
 * implying nobody looked.
 */
const ENTITY_READ_CALL =
  /\bResearchEntity\.(find|findOne|findById|exists|countDocuments|distinct|aggregate)\s*\(/g;

const REVIEWED_UNROUTED_ENTITY_READS: ReadonlyArray<{ fn: string; reason: string }> = [
  {
    fn: 'inheritSchoolFromLeadPi',
    reason:
      'Its live-row read is routed through `entityDocForId`. The read still listed here is a read-after-write: it re-reads the row to verify what this pass wrote and whether the index is in step, so frozen input would answer about the state before the write.',
  },
  {
    fn: 'assertLeadPiInheritanceObservations',
    reason:
      'Reads the row back after appending observations in the same pass, to turn an id into the slug it just asserted under. Same read-after-write reason.',
  },
  {
    fn: 'foldDeptRosterShellIntoCanonicalResearchEntity',
    reason:
      'Reads a DIFFERENT row from the subject, the shell being folded in. Routable in principle, but only once the capture freezes shells, which it does not: today it would report a miss on every fold and make every fold unattributable.',
  },
  {
    fn: 'liveResearchEntityNamesUserKeyAsLead',
    reason:
      'Called from `materializeUserIdentityToResearcher`, the `user` materializer, so THE BENCHMARK NEVER MAKES THIS READ: it replays `researchEntity` rows only, measured at zero hits over 147 rows (#3863). A capture-time index was considered and dropped for that reason, not because it was hard.',
  },
  {
    fn: 'findEntityCandidatesByKey',
    reason:
      'Its slug read is routed through `liveEntityDocForKey`. The read still listed here searches by `websiteUrl` across the corpus, whose PURPOSE is to find rows the benchmark does not contain, so its answer set is not derivable from the frozen input. Permanent exemption.',
  },
  {
    fn: 'reconcileOfficialRosterSnapshotsFromRun',
    reason: 'Run-level reconciliation over a whole scrape run, not a per-row projection read.',
  },
];

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
  /\.(observationsFor|entityDocFor|liveEntityDocFor)(Key|Id)|routedObservationsForKeysAndIds|prefetched\?\.hit|chunkPrefetch|inHandById|missingIds|routed[A-Z]/;

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

describe('every projection entity read is routed or reviewed (#3857)', () => {
  const reads = [...SOURCE.matchAll(ENTITY_READ_CALL)].map((match) => ({
    index: match.index ?? 0,
    fn: enclosingFunction(match.index ?? 0),
  }));

  it('finds the reads it is meant to guard', () => {
    expect(reads.length).toBeGreaterThanOrEqual(10);
  });

  it('has no unrouted entity read outside the reviewed list', () => {
    const reviewed = new Set(REVIEWED_UNROUTED_ENTITY_READS.map((entry) => entry.fn));
    const offenders = [
      ...new Set(
        reads
          .filter((read) => !isRoutedRead(read.index) && !reviewed.has(read.fn))
          .map((read) => read.fn),
      ),
    ];

    expect(offenders).toEqual([]);
  });

  it('lists no exemption that has stopped reading entities', () => {
    const reading = new Set(reads.map((read) => read.fn));
    const stale = REVIEWED_UNROUTED_ENTITY_READS.filter((entry) => !reading.has(entry.fn)).map(
      (entry) => entry.fn,
    );

    expect(stale).toEqual([]);
  });
});
