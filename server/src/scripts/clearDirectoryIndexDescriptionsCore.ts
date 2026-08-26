import { isDirectoryIndexChromeText } from '../utils/researchEntityDescriptionText';
import {
  isResearchAreaLabelLeakage,
  stripResearchAreaSourceChrome,
} from '../scrapers/researchAreaCanonicalization';

const DESCRIPTION_FIELDS = ['fullDescription', 'shortDescription'] as const;

export interface DirectoryIndexEntityInput {
  id: string;
  slug?: string;
  fullDescription?: unknown;
  shortDescription?: unknown;
  researchAreas?: unknown;
}

export interface DirectoryIndexDescriptionAssessment {
  fullIsChrome: boolean;
  shortIsChrome: boolean;
  hasChromeDescription: boolean;
}

export function assessDirectoryIndexDescription(
  entity: DirectoryIndexEntityInput,
): DirectoryIndexDescriptionAssessment {
  const fullIsChrome = isDirectoryIndexChromeText(entity.fullDescription);
  const shortIsChrome = isDirectoryIndexChromeText(entity.shortDescription);
  return {
    fullIsChrome,
    shortIsChrome,
    hasChromeDescription: fullIsChrome || shortIsChrome,
  };
}

export interface ResearchAreaCleanupResult {
  cleaned: string[];
  changed: boolean;
  removedChrome: boolean;
}

const normalizeAreaList = (areas: unknown): string[] =>
  (Array.isArray(areas) ? areas : [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export function cleanResearchAreaChrome(areas: unknown): ResearchAreaCleanupResult {
  const original = normalizeAreaList(areas);
  const cleaned: string[] = [];
  const seen = new Set<string>();
  let removedChrome = false;
  for (const entry of original) {
    const parts = stripResearchAreaSourceChrome(entry);
    if (parts.length !== 1 || parts[0] !== entry) removedChrome = true;
    for (const part of parts) {
      if (isResearchAreaLabelLeakage(part)) {
        removedChrome = true;
        continue;
      }
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(part);
    }
  }
  const changed = cleaned.join('\n') !== original.join('\n');
  return { cleaned, changed, removedChrome };
}

export type DirectoryIndexCleanupAction = 're-derived' | 'cleared' | 'unchanged';

export interface DirectoryIndexCleanupPlan {
  set: Record<string, string | string[]>;
  clearedDescription: boolean;
  reDerivedDescription: boolean;
  strippedResearchAreas: boolean;
  descriptionAction: DirectoryIndexCleanupAction;
}

export interface ReDerivedDescription {
  fullDescription: string;
  shortDescription: string;
}

export function planDirectoryIndexCleanup(
  entity: DirectoryIndexEntityInput,
  reDerived: ReDerivedDescription | null,
): DirectoryIndexCleanupPlan {
  const assessment = assessDirectoryIndexDescription(entity);
  const areaResult = cleanResearchAreaChrome(entity.researchAreas);
  const set: Record<string, string | string[]> = {};

  let descriptionAction: DirectoryIndexCleanupAction = 'unchanged';
  let clearedDescription = false;
  let reDerivedDescription = false;

  if (assessment.hasChromeDescription) {
    if (assessment.fullIsChrome && reDerived && reDerived.fullDescription) {
      set.fullDescription = reDerived.fullDescription;
      set.shortDescription = reDerived.shortDescription || '';
      descriptionAction = 're-derived';
      reDerivedDescription = true;
    } else {
      if (assessment.fullIsChrome) set.fullDescription = '';
      if (assessment.shortIsChrome) set.shortDescription = '';
      descriptionAction = 'cleared';
      clearedDescription = true;
    }
  }

  if (areaResult.changed) {
    set.researchAreas = areaResult.cleaned;
  }

  return {
    set,
    clearedDescription,
    reDerivedDescription,
    strippedResearchAreas: areaResult.removedChrome,
    descriptionAction,
  };
}

export interface LockFilteredCleanupPlan {
  set: Record<string, string | string[]>;
  clearedDescription: boolean;
  reDerivedDescription: boolean;
  strippedResearchAreas: boolean;
  descriptionAction: DirectoryIndexCleanupAction;
  hasWrites: boolean;
}

export function filterCleanupPlanByManualLocks(
  plan: DirectoryIndexCleanupPlan,
  manuallyLockedFields: readonly string[] | undefined,
): LockFilteredCleanupPlan {
  const locked = new Set(manuallyLockedFields ?? []);
  const set: Record<string, string | string[]> = {};
  for (const [field, value] of Object.entries(plan.set)) {
    if (locked.has(field)) continue;
    set[field] = value;
  }

  const descriptionWritten = 'fullDescription' in set || 'shortDescription' in set;
  const reDerivedDescription = plan.reDerivedDescription && !locked.has('fullDescription');
  const clearedDescription = plan.clearedDescription && descriptionWritten;
  const strippedResearchAreas = plan.strippedResearchAreas && !locked.has('researchAreas');
  const descriptionAction: DirectoryIndexCleanupAction = reDerivedDescription
    ? 're-derived'
    : clearedDescription
      ? 'cleared'
      : 'unchanged';

  return {
    set,
    clearedDescription,
    reDerivedDescription,
    strippedResearchAreas,
    descriptionAction,
    hasWrites: Object.keys(set).length > 0,
  };
}

