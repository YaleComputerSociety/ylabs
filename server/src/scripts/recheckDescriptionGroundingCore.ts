import {
  type DescriptionGroundingRecheck,
  type DescriptionGroundingVerdict,
  isStaleDescriptionGrounding,
} from '../services/descriptionGrounding';
import { sourceLinkHealthKey } from '../services/sourceLinkHealth';

/**
 * The only lane that asserts a description is the cited page's own wording, because it
 * is the only one gated at write time by `isDescriptionGroundedInSource`. Re-checking a
 * field no lane ever claimed to have copied verbatim would manufacture a defect: a
 * synthesized or LLM-summarised description is not supposed to appear on the page, so
 * `ABSENT` would be its normal state rather than a finding (#2879).
 */
export const GROUNDED_DESCRIPTION_SOURCE_NAMES: ReadonlySet<string> = new Set([
  'lab-microsite-description-llm',
]);

/**
 * `fullDescription` only, and the exclusion of `shortDescription` is measured rather
 * than cautious.
 *
 * Even within the write-time-grounded lane, only the body is claimed to be the page's
 * own wording: `groundDescriptionExtraction` blanks a body that is not a verbatim
 * substring, and `descriptionExtractionToObservations` emits nothing without one. The
 * card takes three further paths that are deliberately NOT verbatim -
 * `withSynthesizedCard` asks an LLM for one, `firstPersonShortToCardShort` rewrites
 * "Our research focuses on X" into "Focuses on X", and
 * `deriveShortDescriptionFromFullDescription` builds one out of the body - so `ABSENT`
 * is a card's normal state, not a finding.
 *
 * Including it made that obvious on Development: a 200-target pass reported 107 `ABSENT`,
 * and the cards inspected by hand were ordinary LLM summaries over live, substantial
 * pages ("The <Lab> investigates the mechanisms of kidney disease and transplant
 * rejection ..." over a page reading "Our projects span basic, translational and clinical
 * studies"). That is our own synthesis, not publisher churn. A lane that reports its own
 * design as a defect is worse than no lane (#2879).
 */
export const GROUNDING_RECHECK_DESCRIPTION_FIELDS = ['fullDescription'] as const;

export interface DescriptionGroundingTarget {
  field: string;
  url: string;
  storedDescription: string;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const provenanceRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value) return {};
  if (value instanceof Map) {
    const entry = value.get(field);
    return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const entry = (value as Record<string, unknown>)[field];
  return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
};

/**
 * The (field, page) pairs on one row that a re-check can say anything about: a stored
 * description, a provenance row naming a write-time-grounded lane, and an http(s) URL
 * for that lane to be re-read at.
 */
export function descriptionGroundingTargets(
  entity: Record<string, unknown>,
): DescriptionGroundingTarget[] {
  const targets: DescriptionGroundingTarget[] = [];
  for (const field of GROUNDING_RECHECK_DESCRIPTION_FIELDS) {
    const storedDescription = textValue(entity[field]);
    if (!storedDescription) continue;
    const provenance = provenanceRecord(entity.fieldProvenance, field);
    if (!GROUNDED_DESCRIPTION_SOURCE_NAMES.has(textValue(provenance.sourceName))) continue;
    const url = textValue(provenance.sourceUrl);
    if (!/^https?:\/\//i.test(url)) continue;
    targets.push({ field, url, storedDescription });
  }
  return targets;
}

const storedRows = (value: unknown): DescriptionGroundingRecheck[] =>
  Array.isArray(value) ? (value.filter(Boolean) as DescriptionGroundingRecheck[]) : [];

export function storedDescriptionGroundingEntry(
  entity: Record<string, unknown>,
  target: DescriptionGroundingTarget,
): DescriptionGroundingRecheck | undefined {
  const key = sourceLinkHealthKey(target.url);
  if (!key) return undefined;
  return storedRows(entity.descriptionGrounding).find(
    (entry) => entry.field === target.field && sourceLinkHealthKey(String(entry.url || '')) === key,
  );
}

export function needsDescriptionGroundingRecheck(
  entry: DescriptionGroundingRecheck | undefined,
  now: Date,
): boolean {
  return isStaleDescriptionGrounding(entry, now);
}

const DECISIVE_VERDICTS: ReadonlySet<DescriptionGroundingVerdict> = new Set([
  'GROUNDED',
  'REWORDED',
  'UNSUPPORTED',
  'UNREACHABLE',
]);

export const isDecisiveGroundingVerdict = (verdict: DescriptionGroundingVerdict): boolean =>
  DECISIVE_VERDICTS.has(verdict);

/**
 * The row to store after a re-check.
 *
 * An inconclusive re-check records only that it ran: it advances
 * `lastAttemptedAt` and leaves a decisive stored verdict and its `checkedAt`
 * untouched, so a throttled afternoon can neither overwrite what we knew nor reset the
 * freshness horizon that would otherwise age it out. This mirrors the same rule in
 * `resolveSourceLinkHealthEntry` (#2762); the two lanes must not disagree about what an
 * inconclusive probe is allowed to do.
 */
export function resolveDescriptionGroundingEntry(input: {
  target: DescriptionGroundingTarget;
  verdict: DescriptionGroundingVerdict;
  httpStatusCode?: number;
  stored?: DescriptionGroundingRecheck;
  now: Date;
}): DescriptionGroundingRecheck {
  const { target, verdict, httpStatusCode, stored, now } = input;
  const inconclusive = !isDecisiveGroundingVerdict(verdict);
  if (inconclusive && stored && isDecisiveGroundingVerdict(stored.verdict)) {
    return { ...stored, lastAttemptedAt: now };
  }
  return {
    field: target.field,
    url: target.url,
    verdict,
    ...(typeof httpStatusCode === 'number' ? { httpStatusCode } : {}),
    checkedAt: now,
    lastAttemptedAt: now,
  };
}

/**
 * The stored array with this row's verdict replaced in place, keyed by (field, url) so
 * a row whose cited page changed does not accumulate a verdict per historical URL.
 */
export function mergedDescriptionGrounding(
  existing: unknown,
  entry: DescriptionGroundingRecheck,
): DescriptionGroundingRecheck[] {
  const key = sourceLinkHealthKey(entry.url);
  const kept = storedRows(existing).filter(
    (row) =>
      !(row.field === entry.field && sourceLinkHealthKey(String(row.url || '')) === (key ?? '')),
  );
  return [...kept, entry];
}
