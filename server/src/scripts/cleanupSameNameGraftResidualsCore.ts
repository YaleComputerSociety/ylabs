import {
  partitionSentencesLossless,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';

export interface SameNameGraftDirective {
  slug: string;
  removeAreas: string[];
  fallbackAreasWhenEmpty?: string[];
  clearWebsiteHostIncludes?: string;
  reshortFromFullDescription?: boolean;
  maxAreas?: number;
}

export interface SameNameGraftEntityFacts {
  slug: string;
  researchAreas?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export interface SameNameGraftPlan {
  slug: string;
  areasBefore: string[];
  areasAfter: string[];
  removedAreas: string[];
  missingRemoveAreas: string[];
  addedAreas: string[];
  websiteBefore: string;
  websiteAfter: string;
  websiteCleared: boolean;
  sourceUrlsRemoved: string[];
  shortBefore: string;
  shortAfter: string;
  shortChanged: boolean;
  changed: boolean;
}

const DEFAULT_MAX_AREAS = 6;

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

function normalizeKey(value: string): string {
  return value.toLocaleLowerCase();
}

function hostIncludes(url: string, token: string): boolean {
  if (!url || !token) return false;
  try {
    return new URL(url).hostname.toLowerCase().includes(token.toLowerCase());
  } catch {
    return false;
  }
}

function firstSentenceSummary(fullDescription: string): string {
  const sentences = partitionSentencesLossless(fullDescription.trim());
  const candidate = (sentences[0] || '').trim();
  const sanitized = sanitizeResearchEntityShortDescription(candidate);
  return sanitized.trim();
}

function normalizeMax(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_MAX_AREAS;
  return Math.floor(value);
}

export function planSameNameGraftCleanup(
  facts: SameNameGraftEntityFacts,
  directive: SameNameGraftDirective,
): SameNameGraftPlan {
  const maxAreas = normalizeMax(directive.maxAreas);
  const areasBefore = stringList(facts.researchAreas);

  const removeKeys = new Set(directive.removeAreas.map(normalizeKey));
  const presentRemoveKeys = new Set(
    areasBefore.map(normalizeKey).filter((key) => removeKeys.has(key)),
  );
  const removedAreas = areasBefore.filter((area) => removeKeys.has(normalizeKey(area)));
  const missingRemoveAreas = directive.removeAreas.filter(
    (area) => !presentRemoveKeys.has(normalizeKey(area)),
  );

  const survivors = areasBefore.filter((area) => !removeKeys.has(normalizeKey(area)));
  const areasAfter: string[] = [];
  const seen = new Set<string>();
  const pushArea = (value: string): void => {
    const key = normalizeKey(value);
    if (seen.has(key) || areasAfter.length >= maxAreas) return;
    seen.add(key);
    areasAfter.push(value);
  };
  for (const area of survivors) pushArea(area);
  const addedAreas: string[] = [];
  if (survivors.length === 0) {
    for (const area of directive.fallbackAreasWhenEmpty || []) {
      const key = normalizeKey(area);
      if (seen.has(key) || areasAfter.length >= maxAreas) continue;
      pushArea(area);
      addedAreas.push(area);
    }
  }

  const websiteBefore = stringValue(facts.websiteUrl);
  const sourceUrlsBefore = stringList(facts.sourceUrls);
  let websiteAfter = websiteBefore;
  let websiteCleared = false;
  let sourceUrlsRemoved: string[] = [];
  if (directive.clearWebsiteHostIncludes) {
    const token = directive.clearWebsiteHostIncludes;
    if (websiteBefore && hostIncludes(websiteBefore, token)) {
      websiteAfter = '';
      websiteCleared = true;
    }
    sourceUrlsRemoved = sourceUrlsBefore.filter((url) => hostIncludes(url, token));
  }

  const shortBefore = stringValue(facts.shortDescription);
  const fullDescription = stringValue(facts.fullDescription);
  const mentionsRemovedArea = (text: string): boolean =>
    directive.removeAreas.some(
      (area) => area.trim().length > 0 && normalizeKey(text).includes(normalizeKey(area)),
    );
  let shortAfter = shortBefore;
  let shortChanged = false;
  if (
    directive.reshortFromFullDescription &&
    shortBefore &&
    mentionsRemovedArea(shortBefore) &&
    fullDescription &&
    !mentionsRemovedArea(fullDescription)
  ) {
    const derived = firstSentenceSummary(fullDescription);
    if (derived && normalizeKey(derived) !== normalizeKey(shortBefore)) {
      shortAfter = derived;
      shortChanged = true;
    }
  }

  const areasChanged =
    areasAfter.length !== areasBefore.length ||
    areasAfter.some((area, index) => area !== areasBefore[index]);
  const changed = areasChanged || websiteCleared || sourceUrlsRemoved.length > 0 || shortChanged;

  return {
    slug: facts.slug,
    areasBefore,
    areasAfter,
    removedAreas,
    missingRemoveAreas,
    addedAreas,
    websiteBefore,
    websiteAfter,
    websiteCleared,
    sourceUrlsRemoved,
    shortBefore,
    shortAfter,
    shortChanged,
    changed,
  };
}

export function summarizeSameNameGraftPlans(plans: SameNameGraftPlan[]): {
  considered: number;
  changed: number;
  areasRemoved: number;
  websitesCleared: number;
  sourceUrlsRemoved: number;
  shortsRewritten: number;
  driftSlugs: string[];
} {
  let changed = 0;
  let areasRemoved = 0;
  let websitesCleared = 0;
  let sourceUrlsRemoved = 0;
  let shortsRewritten = 0;
  const driftSlugs: string[] = [];
  for (const plan of plans) {
    if (plan.changed) changed += 1;
    areasRemoved += plan.removedAreas.length;
    if (plan.websiteCleared) websitesCleared += 1;
    sourceUrlsRemoved += plan.sourceUrlsRemoved.length;
    if (plan.shortChanged) shortsRewritten += 1;
    if (plan.missingRemoveAreas.length > 0) driftSlugs.push(plan.slug);
  }
  return {
    considered: plans.length,
    changed,
    areasRemoved,
    websitesCleared,
    sourceUrlsRemoved,
    shortsRewritten,
    driftSlugs,
  };
}
