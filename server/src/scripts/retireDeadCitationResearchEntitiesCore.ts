import {
  isLikelyUnavailableSourceLink,
  isStaleSourceLinkHealth,
  findSourceLinkHealth,
  type DatedSourceLinkHealth,
} from '../services/sourceLinkHealth';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';

export type DeadCitationRefusal =
  | 'already-archived'
  | 'no-citation-at-all'
  | 'live-citation'
  | 'stale-verdict'
  | 'website-url-not-dead'
  | 'public-tier';

export interface DeadCitationCandidate {
  id: string;
  tier?: string;
  archived?: boolean;
  citations: string[];
  websiteUrl?: string | null;
  sourceLinkHealth?: unknown;
}

export interface DeadCitationArchivePlan {
  id: string;
  citationCount: number;
  hadWebsiteUrl: boolean;
}

export interface DeadCitationRefused {
  id: string;
  reason: DeadCitationRefusal;
}

export interface DeadCitationRetirementPlan {
  scanned: number;
  toArchive: DeadCitationArchivePlan[];
  refused: DeadCitationRefused[];
}

const publicTiers = new Set<string>(publicStudentVisibilityTiers);

const verdictFor = (storedHealth: unknown, url: string): DatedSourceLinkHealth | undefined =>
  findSourceLinkHealth(storedHealth, url) as DatedSourceLinkHealth | undefined;

/**
 * A URL is retirement-grade dead only when a verdict positively says it is gone
 * AND that verdict is fresh. The two halves answer different questions and both
 * must hold: `isLikelyUnavailableSourceLink` alone would accept a verdict from
 * months ago, and freshness alone says nothing about the outcome.
 */
function deadnessOf(storedHealth: unknown, url: string, now: Date): 'dead' | 'stale' | 'not-dead' {
  const health = verdictFor(storedHealth, url);
  if (!isLikelyUnavailableSourceLink(health)) return 'not-dead';
  return isStaleSourceLinkHealth(health, now) ? 'stale' : 'dead';
}

/**
 * Archival is the one repair that cannot be undone by re-scraping, so every
 * uncertainty refuses instead of proceeding. In particular a `websiteUrl` is
 * checked even though `hasLiveSourceCitation` ignores it: a row whose citations
 * are all gone but whose own site still answers has a working way in, and
 * archiving it would delete the only route a student had.
 */
export function planDeadCitationRetirement(
  candidates: readonly DeadCitationCandidate[],
  now: Date = new Date(),
): DeadCitationRetirementPlan {
  const toArchive: DeadCitationArchivePlan[] = [];
  const refused: DeadCitationRefused[] = [];

  for (const candidate of candidates) {
    const refuse = (reason: DeadCitationRefusal) => refused.push({ id: candidate.id, reason });

    if (candidate.archived === true) {
      refuse('already-archived');
      continue;
    }
    if (publicTiers.has(String(candidate.tier ?? ''))) {
      refuse('public-tier');
      continue;
    }

    const citations = [
      ...new Set(candidate.citations.filter((url) => typeof url === 'string' && url.trim() !== '')),
    ];
    // Having no citation is the #1802 projection gap, which is silence rather
    // than death. Archiving on silence would delete rows whose evidence simply
    // has not been projected yet.
    if (citations.length === 0) {
      refuse('no-citation-at-all');
      continue;
    }

    const verdicts = citations.map((url) => deadnessOf(candidate.sourceLinkHealth, url, now));
    if (verdicts.some((verdict) => verdict === 'not-dead')) {
      refuse('live-citation');
      continue;
    }
    if (verdicts.some((verdict) => verdict === 'stale')) {
      refuse('stale-verdict');
      continue;
    }

    const websiteUrl = typeof candidate.websiteUrl === 'string' ? candidate.websiteUrl.trim() : '';
    if (websiteUrl && deadnessOf(candidate.sourceLinkHealth, websiteUrl, now) !== 'dead') {
      refuse('website-url-not-dead');
      continue;
    }

    toArchive.push({
      id: candidate.id,
      citationCount: citations.length,
      hadWebsiteUrl: websiteUrl !== '',
    });
  }

  return { scanned: candidates.length, toArchive, refused };
}

export function summarizeDeadCitationRefusals(
  refused: readonly DeadCitationRefused[],
): Record<DeadCitationRefusal, number> {
  const counts: Record<DeadCitationRefusal, number> = {
    'already-archived': 0,
    'no-citation-at-all': 0,
    'live-citation': 0,
    'stale-verdict': 0,
    'website-url-not-dead': 0,
    'public-tier': 0,
  };
  for (const entry of refused) counts[entry.reason] += 1;
  return counts;
}
