/**
 * Pure planning helpers for the #1730 unbacked-researchArea-chip drain.
 *
 * #1730 is a distinct mechanism from #1407: the `researchAreas` chips here
 * have no `fieldProvenance` AND the entity's own `sourceUrls` are the PI's own
 * profile/grants (not a different person's page), so #1407's identity-merge
 * and domain-coherence guards (`researchAreaDomainCoherence.ts`) never trip -
 * that guard corroborates a chip against the entity's own stored description,
 * and in the worst #1730 cases the description was itself synthesized from
 * the same wrong chips, so the overlap check is self-confirming. Unlike the
 * #1407 namesake-graft drain (`purgeNamesakeGraftResiduals.ts`), which only
 * ever clears a contaminated description to blank, this drain replaces it
 * with a corrected, source-grounded description (fetched fresh from the
 * entity's own `sourceUrls` immediately before each entry below was written)
 * so the card stops describing the wrong science entirely rather than going
 * blank.
 */

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

export function normalizeGraftToken(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface AreaGraftRemovalResult {
  cleaned: string[];
  removed: string[];
  changed: boolean;
}

export function planAreaGraftRemoval(current: string[], removeAreas: string[]): AreaGraftRemovalResult {
  const removeSet = new Set(removeAreas.map(normalizeGraftToken));
  const removed: string[] = [];
  const cleaned = current.filter((value) => {
    const isGraft = removeSet.has(normalizeGraftToken(value));
    if (isGraft) removed.push(value);
    return !isGraft;
  });
  return { cleaned, removed, changed: removed.length > 0 };
}

export interface DescriptionReplacement {
  from: string;
  to: string;
}

export interface AreaChipDescriptionGraftDirective {
  entityId: string;
  slug: string;
  removeAreas: string[];
  replaceFullDescriptionIfEquals?: DescriptionReplacement;
  replaceShortDescriptionIfEquals?: DescriptionReplacement;
}

export interface AreaChipDescriptionGraftFacts {
  researchAreas?: unknown;
  fullDescription?: unknown;
  shortDescription?: unknown;
}

export interface AreaChipDescriptionGraftPlan {
  entityId: string;
  slug: string;
  areasBefore: string[];
  areasAfter: string[];
  removedAreas: string[];
  missingRemoveAreas: string[];
  fullDescriptionBefore: string;
  fullDescriptionAfter: string;
  fullDescriptionReplaced: boolean;
  shortDescriptionBefore: string;
  shortDescriptionAfter: string;
  shortDescriptionReplaced: boolean;
  changed: boolean;
}

function planDescriptionReplacement(
  current: string,
  replacement: DescriptionReplacement | undefined,
): { after: string; replaced: boolean } {
  if (!replacement) return { after: current, replaced: false };
  if (normalizeGraftToken(current) !== normalizeGraftToken(replacement.from)) {
    return { after: current, replaced: false };
  }
  return { after: replacement.to, replaced: true };
}

export function planAreaChipDescriptionGraftCleanup(
  facts: AreaChipDescriptionGraftFacts,
  directive: AreaChipDescriptionGraftDirective,
): AreaChipDescriptionGraftPlan {
  const areasBefore = stringList(facts.researchAreas);
  const areaResult = planAreaGraftRemoval(areasBefore, directive.removeAreas);
  const presentKeys = new Set(areasBefore.map(normalizeGraftToken));
  const missingRemoveAreas = directive.removeAreas.filter(
    (area) => !presentKeys.has(normalizeGraftToken(area)),
  );

  const fullDescriptionBefore = stringValue(facts.fullDescription);
  const shortDescriptionBefore = stringValue(facts.shortDescription);
  const fullDescriptionPlan = planDescriptionReplacement(
    fullDescriptionBefore,
    directive.replaceFullDescriptionIfEquals,
  );
  const shortDescriptionPlan = planDescriptionReplacement(
    shortDescriptionBefore,
    directive.replaceShortDescriptionIfEquals,
  );

  return {
    entityId: directive.entityId,
    slug: directive.slug,
    areasBefore,
    areasAfter: areaResult.cleaned,
    removedAreas: areaResult.removed,
    missingRemoveAreas,
    fullDescriptionBefore,
    fullDescriptionAfter: fullDescriptionPlan.after,
    fullDescriptionReplaced: fullDescriptionPlan.replaced,
    shortDescriptionBefore,
    shortDescriptionAfter: shortDescriptionPlan.after,
    shortDescriptionReplaced: shortDescriptionPlan.replaced,
    changed: areaResult.changed || fullDescriptionPlan.replaced || shortDescriptionPlan.replaced,
  };
}

export function summarizeAreaChipDescriptionGraftPlans(plans: AreaChipDescriptionGraftPlan[]): {
  considered: number;
  changed: number;
  areasRemoved: number;
  fullDescriptionsReplaced: number;
  shortDescriptionsReplaced: number;
  driftSlugs: string[];
} {
  let changed = 0;
  let areasRemoved = 0;
  let fullDescriptionsReplaced = 0;
  let shortDescriptionsReplaced = 0;
  const driftSlugs: string[] = [];
  for (const plan of plans) {
    if (plan.changed) changed += 1;
    areasRemoved += plan.removedAreas.length;
    if (plan.fullDescriptionReplaced) fullDescriptionsReplaced += 1;
    if (plan.shortDescriptionReplaced) shortDescriptionsReplaced += 1;
    if (plan.missingRemoveAreas.length > 0) driftSlugs.push(plan.slug);
  }
  return {
    considered: plans.length,
    changed,
    areasRemoved,
    fullDescriptionsReplaced,
    shortDescriptionsReplaced,
    driftSlugs,
  };
}
