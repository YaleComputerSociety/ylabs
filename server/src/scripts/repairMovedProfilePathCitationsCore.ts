export type MovedCitationAction = 'rewrite' | 'supersede' | 'skip';

export type MovedCitationSkipReason =
  | 'already-superseded'
  | 'no-candidate'
  | 'old-url-still-live'
  | 'candidate-not-live';

export interface ProbeVerdict {
  status: number | 'error';
}

export interface StaleCitationObservation {
  id: string;
  entityKey?: string;
  entityType?: string;
  field?: string;
  sourceName?: string;
  sourceUrl: string;
  superseded?: boolean;
  observationFingerprint?: string;
}

export interface ExistingAtCandidate {
  observationFingerprint?: string;
}

export interface MovedCitationPlanEntry {
  id: string;
  action: MovedCitationAction;
  from: string;
  to?: string;
  reason?: MovedCitationSkipReason;
}

export interface MovedCitationPlan {
  scanned: number;
  rewrite: MovedCitationPlanEntry[];
  supersede: MovedCitationPlanEntry[];
  skipped: MovedCitationPlanEntry[];
}

const MOVED_PATH_PATTERN = /^\/people\/([^/]+)$/i;

/**
 * The only candidate this repair will ever consider. A path rewrite is a guess
 * until probed, so the shape is deliberately narrow rather than a general
 * redirect follower: 997 of the 1,089 stored `/people/<slug>` URLs are live, so
 * anything broader would rewrite working citations (#2856).
 */
export function movedProfilePathCandidate(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const match = path.match(MOVED_PATH_PATTERN);
  if (!match) return undefined;
  parsed.pathname = `/profile/${match[1]}`;
  return parsed.toString();
}

const isLive = (verdict: ProbeVerdict | undefined): boolean => verdict?.status === 200;
const isGone = (verdict: ProbeVerdict | undefined): boolean => verdict?.status === 404;

/**
 * Rewrites a citation only when the corpus's URL is confirmed gone AND the
 * candidate is confirmed live, both probed in this run. A stored health verdict
 * is not accepted as evidence here: this write changes what a served field cites,
 * so a stale probe would move a citation onto an unverified page.
 *
 * When the candidate already carries an observation with a DIFFERENT fingerprint,
 * the current page states something other than what the old page stated, so the
 * stale row holds outdated content. Superseding it is correct and rewriting is
 * actively worse than leaving it: a rewritten stale value would cite a live page
 * that does not support it, so the defect would stop being detectable.
 */
export function planMovedProfilePathRepair(input: {
  observations: readonly StaleCitationObservation[];
  probes: ReadonlyMap<string, ProbeVerdict>;
  existingByCandidateKey: ReadonlyMap<string, readonly ExistingAtCandidate[]>;
  candidateKeyOf: (observation: StaleCitationObservation, candidate: string) => string;
}): MovedCitationPlan {
  const rewrite: MovedCitationPlanEntry[] = [];
  const supersede: MovedCitationPlanEntry[] = [];
  const skipped: MovedCitationPlanEntry[] = [];

  for (const observation of input.observations) {
    const from = observation.sourceUrl;
    const skip = (reason: MovedCitationSkipReason) =>
      skipped.push({ id: observation.id, action: 'skip', from, reason });

    if (observation.superseded === true) {
      skip('already-superseded');
      continue;
    }

    const candidate = movedProfilePathCandidate(from);
    if (!candidate) {
      skip('no-candidate');
      continue;
    }
    if (!isGone(input.probes.get(from))) {
      skip('old-url-still-live');
      continue;
    }
    if (!isLive(input.probes.get(candidate))) {
      skip('candidate-not-live');
      continue;
    }

    const existing = input.existingByCandidateKey.get(input.candidateKeyOf(observation, candidate));
    const differsInValue = (existing ?? []).some(
      (other) =>
        !other.observationFingerprint ||
        other.observationFingerprint !== observation.observationFingerprint,
    );

    if (differsInValue) {
      supersede.push({ id: observation.id, action: 'supersede', from, to: candidate });
    } else {
      rewrite.push({ id: observation.id, action: 'rewrite', from, to: candidate });
    }
  }

  return {
    scanned: input.observations.length,
    rewrite,
    supersede,
    skipped,
  };
}

export function summarizeSkips(
  skipped: readonly MovedCitationPlanEntry[],
): Record<MovedCitationSkipReason, number> {
  const counts: Record<MovedCitationSkipReason, number> = {
    'already-superseded': 0,
    'no-candidate': 0,
    'old-url-still-live': 0,
    'candidate-not-live': 0,
  };
  for (const entry of skipped) {
    if (entry.reason) counts[entry.reason] += 1;
  }
  return counts;
}
