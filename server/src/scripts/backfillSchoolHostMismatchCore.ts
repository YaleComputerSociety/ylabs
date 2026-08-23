import { applyResearchEntityOrgUnitCanonicalization } from '../scrapers/orgUnitCanonicalization';

/**
 * Schools with no plausible biomedical overlap, so a recorded value here next
 * to a medicine/public-health host and biomedical content on record is a
 * stale-data mistake rather than a real cross-appointment (issue #1093).
 * Deliberately excludes Faculty of Arts and Sciences and similar schools that
 * legitimately have dual YSM-adjacent appointments.
 */
export const DISJOINT_SCHOOLS = [
  'Law School',
  'Divinity School',
  'David Geffen School of Drama',
  'Yale School of Music',
  'Yale School of Architecture',
  'Yale School of Art',
] as const;

export const SCHOOL_HOST_MAP: Record<string, string> = {
  'medicine.yale.edu': 'School of Medicine',
  'ysph.yale.edu': 'School of Public Health',
};

const BIOMEDICAL_CONTENT_RE =
  /\b(?:metabolic|obesity|diabetes|molecular biology|biochemistry|cell biology|cancer|oncology|immunolog|neurolog|pharmac|disease|tumor|genomic|physiology|pathology|therapeutic|clinical trial|vaccine)\b/i;

export interface SchoolHostMismatchEntity {
  id: string;
  slug?: string;
  name?: string;
  school?: unknown;
  schools?: unknown;
  departments?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function hostnameOf(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hasBiomedicalContent(entity: SchoolHostMismatchEntity): boolean {
  if (
    typeof entity.fullDescription === 'string' &&
    BIOMEDICAL_CONTENT_RE.test(entity.fullDescription)
  ) {
    return true;
  }
  return asStringArray(entity.researchAreas).some((area) => BIOMEDICAL_CONTENT_RE.test(area));
}

function candidateUrls(entity: SchoolHostMismatchEntity): string[] {
  return [
    ...(typeof entity.websiteUrl === 'string' ? [entity.websiteUrl] : []),
    ...asStringArray(entity.sourceUrls),
  ];
}

/**
 * The corrected school this entity's own recorded evidence supports, or null
 * when the recorded school is plausible or the evidence is insufficient.
 */
export function findMismatchedHostSchool(entity: SchoolHostMismatchEntity): string | null {
  const recordedSchool = typeof entity.school === 'string' ? entity.school : '';
  if (!(DISJOINT_SCHOOLS as readonly string[]).includes(recordedSchool)) return null;
  if (!hasBiomedicalContent(entity)) return null;
  for (const url of candidateUrls(entity)) {
    const school = SCHOOL_HOST_MAP[hostnameOf(url)];
    if (school && school !== recordedSchool) return school;
  }
  return null;
}

export interface SchoolHostMismatchPlanRow {
  id: string;
  slug?: string;
  name?: string;
  evidenceUrl: string;
  beforeSchool: unknown;
  afterSchool: string;
  beforeSchools: string[];
  afterSchools: string[];
  update: Record<string, unknown>;
}

export async function planSchoolHostMismatchRow(
  entity: SchoolHostMismatchEntity,
): Promise<SchoolHostMismatchPlanRow | null> {
  const correctedSchool = findMismatchedHostSchool(entity);
  if (!correctedSchool) return null;

  const set: Record<string, unknown> = { school: correctedSchool };
  await applyResearchEntityOrgUnitCanonicalization(set, {
    school: entity.school,
    departments: entity.departments,
  });

  const evidenceUrl =
    candidateUrls(entity).find((url) => SCHOOL_HOST_MAP[hostnameOf(url)] === correctedSchool) || '';

  const afterSchool = String(set.school);
  const afterSchools = asStringArray(set.schools);

  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    evidenceUrl,
    beforeSchool: entity.school,
    afterSchool,
    beforeSchools: asStringArray(entity.schools),
    afterSchools,
    update: {
      school: afterSchool,
      schools: afterSchools,
      'fieldProvenance.school': {
        sourceName: 'school-host-mismatch-backfill',
        sourceUrl: evidenceUrl,
        observedAt: new Date(),
        confidence: 0.9,
      },
      'confidenceByField.school': 0.9,
    },
  };
}

export interface SchoolHostMismatchSummary {
  scanned: number;
  changed: number;
}

export function summarizeSchoolHostMismatch(
  rows: Array<SchoolHostMismatchPlanRow | null>,
): SchoolHostMismatchSummary {
  return {
    scanned: rows.length,
    changed: rows.filter((row): row is SchoolHostMismatchPlanRow => row !== null).length,
  };
}
