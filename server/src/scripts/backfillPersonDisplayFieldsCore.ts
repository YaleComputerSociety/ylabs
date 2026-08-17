export const PERSON_DISPLAY_PROFILE_FIELDS = [
  'title',
  'primaryDepartment',
  'imageUrl',
  'websiteUrl',
] as const;

export type PersonDisplayProfileField = (typeof PERSON_DISPLAY_PROFILE_FIELDS)[number];

export const PERSON_DISPLAY_PROFILE_MAXLENGTHS: Record<PersonDisplayProfileField, number> = {
  title: 240,
  primaryDepartment: 240,
  imageUrl: 2048,
  websiteUrl: 2048,
};

export const PROTECTED_PERSON_IDENTITY_FIELDS = [
  'displayName',
  'accountId',
  'identifiers',
  'status',
  'schemaVersion',
] as const;

export interface LegacyUserDisplaySource {
  title?: unknown;
  primaryDepartment?: unknown;
  imageUrl?: unknown;
  website?: unknown;
}

export interface LegacyFacultyDisplaySource {
  title?: unknown;
  primarySchool?: unknown;
  photoUrl?: unknown;
  websiteUrl?: unknown;
}

export interface LegacyDisplaySources {
  user?: LegacyUserDisplaySource | null;
  facultyMember?: LegacyFacultyDisplaySource | null;
}

export type PersonDisplayProfileValues = Partial<Record<PersonDisplayProfileField, string>>;

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const boundDisplayValue = (
  field: PersonDisplayProfileField,
  value: string | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, PERSON_DISPLAY_PROFILE_MAXLENGTHS[field]);
};

export function composeDisplayProfileFromLegacy(
  sources: LegacyDisplaySources,
): PersonDisplayProfileValues {
  const user = sources.user || undefined;
  const faculty = sources.facultyMember || undefined;
  const composed: PersonDisplayProfileValues = {};

  const title = boundDisplayValue('title', cleanString(user?.title) || cleanString(faculty?.title));
  const primaryDepartment = boundDisplayValue(
    'primaryDepartment',
    cleanString(user?.primaryDepartment) || cleanString(faculty?.primarySchool),
  );
  const imageUrl = boundDisplayValue(
    'imageUrl',
    cleanString(user?.imageUrl) || cleanString(faculty?.photoUrl),
  );
  const websiteUrl = boundDisplayValue(
    'websiteUrl',
    cleanString(user?.website) || cleanString(faculty?.websiteUrl),
  );

  if (title) composed.title = title;
  if (primaryDepartment) composed.primaryDepartment = primaryDepartment;
  if (imageUrl) composed.imageUrl = imageUrl;
  if (websiteUrl) composed.websiteUrl = websiteUrl;

  return composed;
}

export function displayProfileFillUpdate(
  existing: PersonDisplayProfileValues | undefined,
  composed: PersonDisplayProfileValues,
): PersonDisplayProfileValues {
  const update: PersonDisplayProfileValues = {};
  for (const field of PERSON_DISPLAY_PROFILE_FIELDS) {
    if (cleanString(existing?.[field])) continue;
    const next = composed[field];
    if (next) update[field] = next;
  }
  return update;
}

export function assertBackfillUpdateIsDisplayOnly(update: Record<string, unknown>): void {
  for (const key of Object.keys(update)) {
    const [head] = key.split('.');
    if (head !== 'profile') {
      throw new Error(
        `backfill:person-display-fields invariant violated: update touches non-profile field "${key}".`,
      );
    }
  }
}
