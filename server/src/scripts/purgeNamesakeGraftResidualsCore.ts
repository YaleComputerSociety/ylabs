/**
 * Pure planning helpers for the #1413 / #1407 namesake-graft residual drain.
 *
 * #1413 (wrong-person description narrative + sourceUrls) and #1407 (wrong-person
 * `researchAreas`) are the same root cause hitting different fields: a same-name
 * or same-surname profile from an unrelated person was attached during identity
 * resolution before the school/field-coherence guards in
 * `personProfileEntityMatch.ts` covered that shape, and the corpus was never
 * drained afterward. As with the #1256 / #604 purges this operates on an
 * individually verified graft set and removes or clears only the exact strings
 * still present, so a genuine interdisciplinary scholar's own areas or prose are
 * never touched.
 */

export function normalizeGraftToken(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function stringValue(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export interface AreaGraftRemovalInput {
  current: string[];
  removeAreas: string[];
}

export interface AreaGraftRemovalResult {
  cleaned: string[];
  removed: string[];
  changed: boolean;
}

export function planAreaGraftRemoval(input: AreaGraftRemovalInput): AreaGraftRemovalResult {
  const removeSet = new Set(input.removeAreas.map(normalizeGraftToken));
  const removed: string[] = [];
  const cleaned = input.current.filter((value) => {
    const isGraft = removeSet.has(normalizeGraftToken(value));
    if (isGraft) removed.push(value);
    return !isGraft;
  });
  return { cleaned, removed, changed: removed.length > 0 };
}

export interface NamesakeGraftDirective {
  entityId: string;
  slug: string;
  removeAreas?: string[];
  clearFullDescriptionIfEquals?: string;
  clearShortDescriptionIfEquals?: string;
  /**
   * `studentDecisionExplanation` is a separately LLM-synthesized, student-facing
   * CTA field (source `student-decision-llm`) that can echo the same
   * wrong-person narrative independently of `fullDescription`/`shortDescription`.
   * Matched against its own `.explanation` text; a match clears the whole
   * object, since a stale explanation with no matching description needs full
   * re-synthesis rather than a partial edit.
   */
  clearStudentDecisionExplanationIfExplanationEquals?: string;
  /**
   * Observation `_id`s to mark `superseded: true` alongside the document
   * clear. `materializeEntity` only ever reads `superseded: false`
   * observations, so clearing the document field alone is not durable when an
   * active observation for that field still exists: the next materialize
   * pass re-derives the same wrong value from it (confirmed live regression
   * on `peters-jdp52`, whose description round-tripped back to the wrong-
   * person text after the document-only clear). Entities with no backing
   * observation for the cleared field (the common case in this list) do not
   * need this - there is nothing left to re-derive from.
   */
  supersedeObservationIds?: string[];
}

export interface NamesakeGraftEntityFacts {
  researchAreas?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
  studentDecisionExplanation?: unknown;
}

export interface NamesakeGraftPlan {
  entityId: string;
  slug: string;
  areasBefore: string[];
  areasAfter: string[];
  removedAreas: string[];
  missingRemoveAreas: string[];
  fullDescriptionCleared: boolean;
  fullDescriptionBefore: string;
  shortDescriptionCleared: boolean;
  shortDescriptionBefore: string;
  studentDecisionExplanationCleared: boolean;
  studentDecisionExplanationBefore: string;
  supersedeObservationIds: string[];
  changed: boolean;
}

/**
 * Whether a description-clear directive still matches the entity's current
 * value. A directive only fires on an exact match so a record a later,
 * independent write already self-corrected is a no-op rather than a
 * double-clear.
 */
function planDescriptionClear(current: string, clearIfEquals: string | undefined): boolean {
  if (!clearIfEquals) return false;
  return normalizeGraftToken(current) === normalizeGraftToken(clearIfEquals);
}

export function planNamesakeGraftCleanup(
  facts: NamesakeGraftEntityFacts,
  directive: NamesakeGraftDirective,
): NamesakeGraftPlan {
  const areasBefore = stringList(facts.researchAreas);
  const removeAreas = directive.removeAreas || [];
  const areaResult = planAreaGraftRemoval({ current: areasBefore, removeAreas });
  const removeKeys = new Set(removeAreas.map(normalizeGraftToken));
  const presentKeys = new Set(areasBefore.map(normalizeGraftToken));
  const missingRemoveAreas = removeAreas.filter(
    (area) => !presentKeys.has(normalizeGraftToken(area)) || !removeKeys.has(normalizeGraftToken(area)),
  );

  const fullDescriptionBefore = stringValue(facts.fullDescription);
  const shortDescriptionBefore = stringValue(facts.shortDescription);
  const fullDescriptionCleared = planDescriptionClear(
    fullDescriptionBefore,
    directive.clearFullDescriptionIfEquals,
  );
  const shortDescriptionCleared = planDescriptionClear(
    shortDescriptionBefore,
    directive.clearShortDescriptionIfEquals,
  );

  const studentDecisionExplanationBefore = stringValue(
    (facts.studentDecisionExplanation as { explanation?: unknown } | undefined)?.explanation,
  );
  const studentDecisionExplanationCleared = planDescriptionClear(
    studentDecisionExplanationBefore,
    directive.clearStudentDecisionExplanationIfExplanationEquals,
  );

  return {
    entityId: directive.entityId,
    slug: directive.slug,
    areasBefore,
    areasAfter: areaResult.cleaned,
    removedAreas: areaResult.removed,
    missingRemoveAreas,
    fullDescriptionCleared,
    fullDescriptionBefore,
    shortDescriptionCleared,
    shortDescriptionBefore,
    studentDecisionExplanationCleared,
    studentDecisionExplanationBefore,
    supersedeObservationIds: directive.supersedeObservationIds || [],
    changed:
      areaResult.changed ||
      fullDescriptionCleared ||
      shortDescriptionCleared ||
      studentDecisionExplanationCleared,
  };
}

export function summarizeNamesakeGraftPlans(plans: NamesakeGraftPlan[]): {
  considered: number;
  changed: number;
  areasRemoved: number;
  fullDescriptionsCleared: number;
  shortDescriptionsCleared: number;
  studentDecisionExplanationsCleared: number;
  driftSlugs: string[];
} {
  let changed = 0;
  let areasRemoved = 0;
  let fullDescriptionsCleared = 0;
  let shortDescriptionsCleared = 0;
  let studentDecisionExplanationsCleared = 0;
  const driftSlugs: string[] = [];
  for (const plan of plans) {
    if (plan.changed) changed += 1;
    areasRemoved += plan.removedAreas.length;
    if (plan.fullDescriptionCleared) fullDescriptionsCleared += 1;
    if (plan.shortDescriptionCleared) shortDescriptionsCleared += 1;
    if (plan.studentDecisionExplanationCleared) studentDecisionExplanationsCleared += 1;
    if (plan.missingRemoveAreas.length > 0) driftSlugs.push(plan.slug);
  }
  return {
    considered: plans.length,
    changed,
    areasRemoved,
    fullDescriptionsCleared,
    studentDecisionExplanationsCleared,
    shortDescriptionsCleared,
    driftSlugs,
  };
}
