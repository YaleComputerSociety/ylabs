import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { probeSourceLink } from '../services/sourceLinkHealth';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  hasRecordedClosureEvidence,
  PERMANENTLY_CLOSED_SUPPRESSION_REASON,
} from '../utils/researchEntityYaleStatus';

export const YSM_LAB_INDEX_HEALTH_FIELD = 'ysmLabIndexHealth';
export const YSM_LAB_INDEX_HEALTH_ENTITY_KEY = 'ysm-atoz-lab-websites';

/**
 * A delisted lab must be absent from an index that still lists most of what we
 * govern. At the measured ratio (261 indexed / 400 governed = 0.65) a healthy
 * index clears this comfortably, while a partial fetch or a renamed layout drops
 * far below it and freezes the lane instead of mass-suppressing.
 */
export const YSM_LAB_INDEX_DROP_GUARD_MIN_FRACTION = 0.5;

export interface YsmLabIndexHealthSnapshot {
  status?: unknown;
  complete?: unknown;
  discoveredCount?: unknown;
  discoveredLabSlugs?: unknown;
}

export interface YsmLabDelistingState {
  labSlug: string;
  absentFromIndexSinceRunId?: string | null;
  micrositeDead?: boolean;
  hasRecordedClosure?: boolean;
}

export type YsmLabIndexSignal = 'present' | 'absent' | 'inconclusive';

export type YsmLabDelistingAction =
  | 'noop'
  | 'clear_absence'
  | 'record_first_absence'
  | 'suppress_permanently_closed';

export interface YsmLabDelistingDecision {
  action: YsmLabDelistingAction;
  set?: Record<string, unknown>;
}

const NOOP: YsmLabDelistingDecision = { action: 'noop' };

/**
 * YSM writes index slugs lowercase and hyphenated, while stored `websiteUrl`
 * values preserve whatever casing and separator the page used when harvested:
 * `lab/Pitt` for indexed `pitt`, `lab/colon_ramos` for indexed `colon-ramos`,
 * `lab/jun_liu` for indexed `jun-liu`. Comparing raw strings reported 52 delisted
 * labs where only 48 are, so normalizing is a correctness requirement and not
 * tidiness - the 4 extra were live labs that would have been suppressed.
 */
export function normalizeLabSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/_/g, '-').replace(/\/+$/, '');
}

export function labSlugFromMicrositeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /\/lab\/([A-Za-z0-9_.-]+)/i.exec(value);
  return match ? normalizeLabSlug(match[1]) : '';
}

export function isYsmLabIndexAuthoritative(snapshot: YsmLabIndexHealthSnapshot): boolean {
  return snapshot.complete === true && Array.isArray(snapshot.discoveredLabSlugs);
}

export function snapshotDiscoveredLabSlugs(snapshot: YsmLabIndexHealthSnapshot): string[] {
  return Array.isArray(snapshot.discoveredLabSlugs)
    ? snapshot.discoveredLabSlugs
        .filter((value): value is string => typeof value === 'string')
        .map(normalizeLabSlug)
        .filter(Boolean)
    : [];
}

export function passesYsmLabIndexDropGuard(
  discoveredCount: number,
  governedCount: number,
  minFraction: number = YSM_LAB_INDEX_DROP_GUARD_MIN_FRACTION,
): boolean {
  if (governedCount <= 0) return true;
  return discoveredCount >= minFraction * governedCount;
}

export function classifyYsmLabIndexSignal(params: {
  indexAuthoritative: boolean;
  dropGuardPassed: boolean;
  discoveredLabSlugs: Set<string>;
  labSlug: string;
}): YsmLabIndexSignal {
  const { indexAuthoritative, dropGuardPassed, discoveredLabSlugs, labSlug } = params;
  if (!indexAuthoritative || !dropGuardPassed) return 'inconclusive';
  if (!labSlug) return 'inconclusive';
  return discoveredLabSlugs.has(labSlug) ? 'present' : 'absent';
}

/**
 * Suppression requires TWO independent facts, both positive:
 *
 *   1. absent from an authoritative index across two distinct runs, and
 *   2. the microsite itself probing gone.
 *
 * Absence alone is an inference from a missing row, which a selector change or a
 * partial fetch produces wholesale - the same empty-roster shape that made the
 * visibility gate refuse the YSPH cohort in #2460. A 404 alone is a fact about
 * one URL that a transient edge error can fake. Requiring both means a single
 * failing signal freezes the lane rather than retiring a live lab.
 *
 * `micrositeDead` must come from a probe that distinguishes gone from
 * unreachable: only 404/410 may set it. A 403, 429, 5xx or timeout is inconclusive
 * and must leave it false, or throttling on a large host becomes mass suppression.
 */
export function decideYsmLabDelisting(params: {
  signal: YsmLabIndexSignal;
  currentRunId: string;
  entity: YsmLabDelistingState;
}): YsmLabDelistingDecision {
  const { signal, currentRunId, entity } = params;
  if (signal === 'inconclusive' || !currentRunId) return NOOP;

  if (signal === 'present') {
    if (!entity.absentFromIndexSinceRunId) return NOOP;
    return { action: 'clear_absence', set: { absentFromIndexSinceRunId: '' } };
  }

  const absentSinceRunId = entity.absentFromIndexSinceRunId || '';
  if (!absentSinceRunId) {
    return { action: 'record_first_absence', set: { absentFromIndexSinceRunId: currentRunId } };
  }
  if (absentSinceRunId === currentRunId) return NOOP;
  if (!entity.micrositeDead) return NOOP;
  if (entity.hasRecordedClosure) return NOOP;

  return {
    action: 'suppress_permanently_closed',
    set: { studentVisibilitySuppressionReason: PERMANENTLY_CLOSED_SUPPRESSION_REASON },
  };
}

export function ysmLabDelistingDetectionEnabled(): boolean {
  return process.env.SCRAPER_YSM_LAB_DELISTING_DETECTION === 'true';
}

/**
 * Strictly gone, as distinct from unreachable. Only 404/410 count: a 403, 429,
 * 5xx, timeout or SSRF refusal is an absence of information, and the shared
 * `classifySourceLinkHealth` collapses all of those into `UNAVAILABLE`, which
 * would turn throttling on medicine.yale.edu into mass suppression.
 */
export async function probeMicrositeGone(url: string): Promise<boolean> {
  const probe = await probeSourceLink(url);
  const status = (probe as { status?: unknown }).status;
  return typeof status === 'number' && (status === 404 || status === 410);
}

/**
 * Why a pass did nothing. Named causes rather than a bare zero, because #2410
 * showed three independent dormancy reasons hiding behind "reconciled 0": an
 * unset feature flag, missing health observations, and a join that matched
 * nothing.
 */
export type YsmLabDelistingOutcome =
  | 'disabled'
  | 'dry-run'
  | 'invalid-run-id'
  | 'no-index-health-observation'
  | 'index-not-authoritative'
  | 'drop-guard-frozen'
  | 'reconciled';

export interface YsmLabDelistingResult {
  outcome: YsmLabDelistingOutcome;
  suppressed: number;
  absenceRecorded: number;
  absenceCleared: number;
  held: number;
  discoveredCount: number;
  governedCount: number;
}

export async function reconcileYsmLabDelistingFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<YsmLabDelistingResult> {
  const base = {
    suppressed: 0,
    absenceRecorded: 0,
    absenceCleared: 0,
    held: 0,
    discoveredCount: 0,
    governedCount: 0,
  };
  if (options.dryRun) return { ...base, outcome: 'dry-run' };
  if (!ysmLabDelistingDetectionEnabled()) return { ...base, outcome: 'disabled' };

  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return { ...base, outcome: 'invalid-run-id' };
  }

  const healthObservation = await Observation.findOne({
    scrapeRunId: runObjectId,
    entityType: 'ysmLabIndexHealth',
    field: YSM_LAB_INDEX_HEALTH_FIELD,
  })
    .sort({ observedAt: -1 })
    .lean();
  if (!healthObservation) return { ...base, outcome: 'no-index-health-observation' };

  const snapshot = (healthObservation as { value?: YsmLabIndexHealthSnapshot }).value ?? {};
  if (!isYsmLabIndexAuthoritative(snapshot)) {
    return { ...base, outcome: 'index-not-authoritative' };
  }
  const discovered = new Set(snapshotDiscoveredLabSlugs(snapshot));

  const governed = await ResearchEntity.find(
    { archived: { $ne: true }, websiteUrl: /medicine\.yale\.edu\/lab\//i },
    {
      _id: 1,
      slug: 1,
      websiteUrl: 1,
      absentFromIndexSinceRunId: 1,
      studentVisibilitySuppressionReason: 1,
    },
  ).lean();

  if (!passesYsmLabIndexDropGuard(discovered.size, governed.length)) {
    return {
      ...base,
      outcome: 'drop-guard-frozen',
      discoveredCount: discovered.size,
      governedCount: governed.length,
    };
  }

  const result: YsmLabDelistingResult = {
    ...base,
    outcome: 'reconciled',
    discoveredCount: discovered.size,
    governedCount: governed.length,
  };

  for (const entity of governed as Array<Record<string, any>>) {
    const labSlug = labSlugFromMicrositeUrl(entity.websiteUrl);
    const signal = classifyYsmLabIndexSignal({
      indexAuthoritative: true,
      dropGuardPassed: true,
      discoveredLabSlugs: discovered,
      labSlug,
    });

    // Probe only what a second-run absence would otherwise retire, so a healthy
    // corpus costs no requests and the probe cannot itself provoke throttling.
    const needsProbe =
      signal === 'absent' &&
      Boolean(entity.absentFromIndexSinceRunId) &&
      entity.absentFromIndexSinceRunId !== scrapeRunId;
    let micrositeDead = false;
    if (needsProbe) {
      try {
        micrositeDead = await probeMicrositeGone(String(entity.websiteUrl));
      } catch (error) {
        console.error(
          `ysm-lab-delisting probe failed for ${String(entity.slug)}:`,
          sanitizeLogValue(error),
        );
        micrositeDead = false;
      }
    }

    const decision = decideYsmLabDelisting({
      signal,
      currentRunId: scrapeRunId,
      entity: {
        labSlug,
        absentFromIndexSinceRunId: entity.absentFromIndexSinceRunId,
        micrositeDead,
        hasRecordedClosure: hasRecordedClosureEvidence(entity),
      },
    });

    if (decision.action === 'noop' || !decision.set) {
      result.held += 1;
      continue;
    }
    await ResearchEntity.updateOne({ _id: entity._id }, { $set: decision.set });
    if (decision.action === 'suppress_permanently_closed') result.suppressed += 1;
    else if (decision.action === 'record_first_absence') result.absenceRecorded += 1;
    else if (decision.action === 'clear_absence') result.absenceCleared += 1;
  }

  return result;
}
