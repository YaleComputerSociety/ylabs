/**
 * What a student is told a source contributed. An allowlist rather than a
 * transform of the stored field name: `fieldProvenance` is keyed by internal
 * field names, some of which name withheld contact fields, so anything not
 * listed here is omitted instead of being labelled.
 */
const SERVED_FIELD_CONTRIBUTION_LABELS: Record<string, string> = {
  fullDescription: 'Research summary',
  shortDescription: 'Research summary',
  description: 'Research summary',
  researchAreas: 'Topics',
  methods: 'Methods',
  websiteUrl: 'Research website',
  inferredPiUserId: 'Lead identity',
  inferredPiUserKey: 'Lead identity',
  leadProfessorPublicKey: 'Lead identity',
  departments: 'Department',
  school: 'School',
  name: 'Name',
  displayName: 'Name',
};

export const SERVED_FIELD_CONTRIBUTION_LABEL_SET = new Set(
  Object.values(SERVED_FIELD_CONTRIBUTION_LABELS),
);

export const MAX_PUBLIC_SOURCE_FIELD_CONTRIBUTIONS = 8;

export function servedFieldContributionLabel(field: unknown): string | undefined {
  return typeof field === 'string' ? SERVED_FIELD_CONTRIBUTION_LABELS[field] : undefined;
}

/**
 * The served payload fields that must hold a value before a source may be credited
 * with a label (#3922). A provenance entry is history and outlives the value it
 * recorded, so several clear arms empty `websiteUrl` or resolve `departments` to
 * nothing while the entry stays; crediting the page then tells a student it
 * supplied something the row does not show. `Lead identity` and `Name` are absent
 * because the lead is served on the roster outside this payload and a row always
 * serves a name.
 */
const SERVED_CONTRIBUTION_LABEL_VALUE_FIELDS: Record<string, readonly string[]> = {
  'Research summary': ['fullDescription', 'shortDescription', 'cardDescription'],
  Topics: ['researchAreas'],
  Methods: ['methods'],
  'Research website': ['websiteUrl', 'website'],
  Department: ['departments'],
  School: ['school', 'schools'],
};

function servedValueIsPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(servedValueIsPresent);
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object') {
    return servedValueIsPresent((value as { text?: unknown }).text);
  }
  return false;
}

export function contributionLabelIsServed(
  label: string,
  servedPayload: Record<string, unknown>,
): boolean {
  const fields = SERVED_CONTRIBUTION_LABEL_VALUE_FIELDS[label];
  if (!fields) return true;
  return fields.some((field) => servedValueIsPresent(servedPayload[field]));
}

export interface SourceFieldContribution {
  sourceUrl: string;
  contributions: string[];
}

/**
 * Groups the served field labels by the source URL that asserted them, so a
 * detail page can say which of several profiles of one person supplied which
 * part of what a student reads.
 */
export function buildSourceFieldContributions(
  fieldProvenance: unknown,
  allowSourceUrl: (url: string) => boolean,
): SourceFieldContribution[] {
  const entries = provenanceEntries(fieldProvenance);
  const byUrl = new Map<string, Set<string>>();

  for (const [field, provenance] of entries) {
    const label = servedFieldContributionLabel(field);
    if (!label) continue;
    const sourceUrl = typeof provenance?.sourceUrl === 'string' ? provenance.sourceUrl.trim() : '';
    if (!sourceUrl || !allowSourceUrl(sourceUrl)) continue;
    const bucket = byUrl.get(sourceUrl);
    if (bucket) bucket.add(label);
    else byUrl.set(sourceUrl, new Set([label]));
  }

  return [...byUrl.entries()].map(([sourceUrl, contributions]) => ({
    sourceUrl,
    contributions: [...contributions].sort(),
  }));
}

function provenanceEntries(
  fieldProvenance: unknown,
): Array<[string, { sourceUrl?: unknown } | undefined]> {
  if (!fieldProvenance) return [];
  if (fieldProvenance instanceof Map) {
    return [...fieldProvenance.entries()] as Array<[string, { sourceUrl?: unknown }]>;
  }
  if (typeof fieldProvenance === 'object') {
    return Object.entries(fieldProvenance as Record<string, { sourceUrl?: unknown }>);
  }
  return [];
}
