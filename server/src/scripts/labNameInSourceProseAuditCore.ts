/**
 * Faculty-research rows whose own cited source page names a laboratory in its
 * PROSE, where the identity harvest threw that name away.
 *
 * `lab-microsite-description-llm` adopts a brand only from the extraction's `name`
 * field. When the model puts the lab's name in the description instead and returns
 * an empty or person-shaped `name`, the prose is kept and the identity is lost, so
 * the row stays typed faculty research while its own source says otherwise (#2685
 * fixed the type following the name; it cannot help a row whose name was never
 * harvested).
 *
 * Read-only by design. Half the raw signal is the model coining "The <Full Name>
 * Lab" while paraphrasing a person's site, which is not evidence that a lab
 * exists, so a candidate is only ever a review entry. Acceptance is a human
 * judgement recorded as a checked-in list, the same shape as
 * `repairLabNamedFacultyResearchTypesCore`.
 */
import {
  namesASelfDeclaredLaboratory,
  namesAServiceFacility,
} from '../utils/researchHomeNameIdentityAuthority';

/**
 * Lanes that read a real page. A synthesis lane paraphrases a biography, so a lab
 * name inside its prose was coined rather than read and must never reach review.
 */
export const SOURCE_READING_DESCRIPTION_LANES: readonly string[] = [
  'lab-microsite-description-llm',
  'dept-faculty-roster',
  'ysm-faculty-directory',
  'yse-faculty-directory',
  'official-profile-pi-backfill',
  'ysm-atoz-index',
];

const LAB_NAME_IN_PROSE = /\b((?:[A-Z][A-Za-z'’-]+ ){1,4})(Lab|Laboratory|Research Group)\b/;

// A lab at another institution named in a Yale researcher's prose is that
// institution's lab, so adopting it is the wrong-subject graft of #2234.
const OTHER_INSTITUTION_RE =
  /\b(noaa|nasa|national\s+laborator\w*|brookhaven|argonne|oak\s+ridge|los\s+alamos|fermilab|jet\s+propulsion|cold\s+spring\s+harbor|max\s+planck|harvard|stanford|princeton|columbia|cornell|berkeley|oxford|cambridge|rochester|mount\s+desert|nus)\b/i;

// A name made only of the head noun and filler identifies nothing.
const GENERIC_LAB_NAME_RE =
  /^(?:the\s+)?(?:research\s+|our\s+|my\s+)?(?:lab|laboratory|research\s+group)$/i;

export type LabNameProseVerdict =
  | 'review'
  | 'coined_not_on_page'
  | 'other_institution'
  | 'generic_name'
  | 'service_facility'
  | 'not_a_laboratory'
  | 'shared_brand'
  | 'page_unreadable';

export interface LabNameProseCandidate {
  slug: string;
  lane: string;
  prose: string;
  sourceUrl: string;
  pageText?: string;
  hasWebsiteUrl?: boolean;
  studentVisibilityTier?: string;
}

export interface LabNameProseRow {
  slug: string;
  verdict: LabNameProseVerdict;
  lane: string;
  proposedName?: string;
  sourceUrl: string;
  hasWebsiteUrl: boolean;
  studentVisibilityTier?: string;
}

export function labNameFromProse(prose: unknown): string {
  if (typeof prose !== 'string') return '';
  const match = prose.match(LAB_NAME_IN_PROSE);
  if (!match) return '';
  return `${match[1]}${match[2]}`.replace(/\s+/g, ' ').trim();
}

/**
 * Whether the cited page itself carries the name, rather than the model having
 * written it. This is the whole safeguard, so it accepts either the full name or
 * the distinctive part of it standing within a short span of a head noun, which is
 * how a page that writes "the Prober laboratory" still corroborates "The Prober
 * Lab".
 */
export function proseNameAppearsOnPage(proposedName: string, pageText: string): boolean {
  if (!proposedName || !pageText) return false;
  const withoutArticle = proposedName.replace(/^the\s+/i, '');
  if (pageText.toLowerCase().includes(withoutArticle.toLowerCase())) return true;
  const distinctive = withoutArticle.replace(/\s+(Lab|Laboratory|Research Group)$/i, '').trim();
  if (distinctive.length < 3) return false;
  const escaped = distinctive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b[^.]{0,30}\\b(?:lab|laboratory|group)\\b`, 'i').test(pageText);
}

export function classifyLabNameInProse(candidate: LabNameProseCandidate): LabNameProseRow {
  const row: LabNameProseRow = {
    slug: candidate.slug,
    verdict: 'review',
    lane: candidate.lane,
    sourceUrl: candidate.sourceUrl,
    hasWebsiteUrl: candidate.hasWebsiteUrl === true,
    studentVisibilityTier: candidate.studentVisibilityTier,
  };
  const proposedName = labNameFromProse(candidate.prose);
  if (proposedName) row.proposedName = proposedName;

  if (!SOURCE_READING_DESCRIPTION_LANES.includes(candidate.lane)) {
    return { ...row, verdict: 'coined_not_on_page' };
  }
  if (!proposedName) return { ...row, verdict: 'not_a_laboratory' };
  if (candidate.pageText === undefined || candidate.pageText === '') {
    return { ...row, verdict: 'page_unreadable' };
  }
  if (!proseNameAppearsOnPage(proposedName, candidate.pageText)) {
    return { ...row, verdict: 'coined_not_on_page' };
  }
  if (OTHER_INSTITUTION_RE.test(proposedName)) return { ...row, verdict: 'other_institution' };
  if (GENERIC_LAB_NAME_RE.test(proposedName)) return { ...row, verdict: 'generic_name' };
  if (namesAServiceFacility(proposedName)) return { ...row, verdict: 'service_facility' };
  if (!namesASelfDeclaredLaboratory(proposedName)) return { ...row, verdict: 'not_a_laboratory' };
  return row;
}

/**
 * Two rows proposing the same lab cannot both be it, and picking one on this
 * evidence would be a coin toss, so both go back to `shared_brand`.
 */
export function withSharedBrandsWithheld(rows: LabNameProseRow[]): LabNameProseRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.verdict !== 'review' || !row.proposedName) continue;
    const key = row.proposedName.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => {
    if (row.verdict !== 'review' || !row.proposedName) return row;
    return (counts.get(row.proposedName.toLowerCase()) ?? 0) > 1
      ? { ...row, verdict: 'shared_brand' }
      : row;
  });
}

export function planLabNameInProseAudit(candidates: LabNameProseCandidate[]): LabNameProseRow[] {
  return withSharedBrandsWithheld(candidates.map((candidate) => classifyLabNameInProse(candidate)));
}

export function summarizeLabNameInProseAudit(
  rows: LabNameProseRow[],
): Record<LabNameProseVerdict, number> {
  const summary: Record<LabNameProseVerdict, number> = {
    review: 0,
    coined_not_on_page: 0,
    other_institution: 0,
    generic_name: 0,
    service_facility: 0,
    not_a_laboratory: 0,
    shared_brand: 0,
    page_unreadable: 0,
  };
  for (const row of rows) summary[row.verdict] += 1;
  return summary;
}
