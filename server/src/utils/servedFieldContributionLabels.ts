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
  researchAreas: 'Research areas',
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
