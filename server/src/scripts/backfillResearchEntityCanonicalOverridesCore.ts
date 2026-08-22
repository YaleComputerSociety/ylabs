export interface CanonicalOverrideEntry {
  slug?: string;
  recordId?: string;
  name?: string;
  website?: string;
  shortDescription?: string;
  fullDescription?: string;
  confidence?: string;
  note?: string;
}

export interface CanonicalOverrideEntity {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  website?: string;
  websiteUrl?: string;
  shortDescription?: string;
  fullDescription?: string;
  sourceUrls?: unknown;
  manuallyLockedFields?: unknown;
}

export interface CanonicalOverridePlan {
  set: Record<string, unknown>;
  changedFields: string[];
  lockedFields: string[];
  addedSourceUrls: string[];
}

export const CANONICAL_OVERRIDE_LOCKABLE_FIELDS = [
  'name',
  'displayName',
  'website',
  'websiteUrl',
  'shortDescription',
  'fullDescription',
] as const;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function isHttpUrl(value: unknown): boolean {
  const raw = text(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function validateCanonicalOverrideEntry(entry: CanonicalOverrideEntry): string | null {
  if (!text(entry.slug) && !text(entry.recordId)) {
    return 'entry requires a slug or recordId';
  }
  if (
    !text(entry.name) &&
    !text(entry.website) &&
    !text(entry.shortDescription) &&
    !text(entry.fullDescription)
  ) {
    return 'entry has no overridable fields';
  }
  if (entry.website !== undefined && !isHttpUrl(entry.website)) {
    return 'website must be an http(s) URL';
  }
  return null;
}

export function planCanonicalOverride(
  entity: CanonicalOverrideEntity,
  entry: CanonicalOverrideEntry,
): CanonicalOverridePlan {
  const set: Record<string, unknown> = {};
  const changedFields: string[] = [];
  const lockedFields = new Set(stringList(entity.manuallyLockedFields));
  const addedSourceUrls: string[] = [];

  const assign = (field: string, value: string, current: unknown): void => {
    lockedFields.add(field);
    if (text(current) === value) return;
    set[field] = value;
    changedFields.push(field);
  };

  const name = text(entry.name);
  if (name) {
    assign('name', name, entity.name);
    assign('displayName', name, entity.displayName);
  }

  const website = text(entry.website);
  if (website) {
    assign('website', website, entity.website);
    assign('websiteUrl', website, entity.websiteUrl);
  }

  const shortDescription = text(entry.shortDescription);
  if (shortDescription) assign('shortDescription', shortDescription, entity.shortDescription);

  const fullDescription = text(entry.fullDescription);
  if (fullDescription) assign('fullDescription', fullDescription, entity.fullDescription);

  if (website) {
    const existingSourceUrls = uniqueStrings(stringList(entity.sourceUrls));
    if (!existingSourceUrls.includes(website)) {
      const mergedSourceUrls = uniqueStrings([...existingSourceUrls, website]);
      set.sourceUrls = mergedSourceUrls;
      addedSourceUrls.push(website);
    }
  }

  const mergedLocked = uniqueStrings(Array.from(lockedFields));
  const currentLocked = uniqueStrings(stringList(entity.manuallyLockedFields));
  const lockedChanged =
    mergedLocked.length !== currentLocked.length ||
    mergedLocked.some((field) => !currentLocked.includes(field));
  if (lockedChanged) set.manuallyLockedFields = mergedLocked;

  return {
    set,
    changedFields,
    lockedFields: mergedLocked,
    addedSourceUrls,
  };
}

export function planHasChanges(plan: CanonicalOverridePlan): boolean {
  return Object.keys(plan.set).length > 0;
}
