/**
 * Rows whose own website already gave them a laboratory's branded name, while
 * their `entityType` still says faculty research.
 *
 * `lab-microsite-description-llm` has adopted a self-declared name at confidence
 * 0.95 for 551 rows without ever asserting what that name makes the row, because
 * until #2685 no source emitted `entityType` from a research home's own site. The
 * type therefore stayed whatever the department roster decided at mint time from
 * the wording of a directory entry, and the product went on labelling the row
 * "Faculty Research" and calling its lab site a "research website".
 *
 * This backfill reads only names the corpus has already accepted, so it needs no
 * fetch and no LLM call. It emits the `entityType`/`kind` observations the lane
 * would have emitted at the time, attributed to that lane, that page, and that
 * moment, and writes the resolved fields in the same pass. Emitting the evidence
 * is what makes the correction durable: a bare field write is reverted by the next
 * materialization, because the roster keeps asserting `FACULTY_RESEARCH_AREA` at
 * 0.7-0.8 and nothing outranks it. That is the same trap
 * `repairLabNamedFacultyResearchTypes` had to answer with a `manuallyLockedFields`
 * entry, and an observation answers it without freezing the field (#2612).
 *
 * Which page the brand was read from decides whether there is anything to back the
 * correction. The lane runs against whatever URL a row offered, and for some rows
 * that was the school's own faculty directory rather than a lab's site, so the name
 * it produced is a synthesis artefact rather than a self-declaration. Those rows
 * serve a lab-branded name with no laboratory behind it, so the name is the defect
 * and re-typing them would assert an organization on no evidence (#2446).
 *
 * The two judgements are separate, and a page that answers neither is held rather
 * than acted on. Typing up needs the page to look like the row's own site; retracting
 * a name the product is already serving needs the stronger evidence that the page was
 * a directory entry. Everything in between - a sub-page of a lab microsite, a program
 * page, a brand with no citable URL at all - is reported and left alone.
 */
import { looksLikeOrgPage } from './promoteFacultyResearchToLabCore';
import {
  isPersonScopedResearchEntity,
  namesASelfDeclaredLaboratory,
} from '../utils/researchHomeNameIdentityAuthority';
import { isPersonProfileOrDirectoryUrl } from '../utils/researchHomeWebsiteUrl';

export const BACKFILL_ENTITY_TYPE = 'LAB';
export const BACKFILL_KIND = 'lab';
export const BACKFILL_SOURCE_NAME = 'lab-microsite-description-llm';

export type LabBrandedNameTypeOutcome =
  | 'plan'
  | 'already-lab'
  | 'archived'
  | 'brand-not-a-laboratory'
  | 'brand-not-self-declared'
  | 'brand-page-not-a-microsite'
  | 'not-person-scoped'
  | 'locked'
  | 'brand-no-longer-served';

export interface LabBrandedNameTypeCandidate {
  slug: string;
  storedName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  archived?: unknown;
  manuallyLockedFields?: unknown;
  brandedName?: unknown;
  brandedNameSourceUrl?: unknown;
  brandedNameObservedAt?: unknown;
}

export interface LabBrandedNameTypePlanRow {
  slug: string;
  outcome: LabBrandedNameTypeOutcome;
  brandedName: string;
  beforeEntityType: string;
  beforeKind: string;
  afterEntityType?: string;
  afterKind?: string;
  sourceUrl?: string;
  observedAt?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * The row must still be serving the brand this decision rests on. A name the
 * corpus has since replaced is not evidence about the row as it stands now, and
 * re-typing on it would act on a premise the document no longer carries.
 */
function stillServesBrand(candidate: LabBrandedNameTypeCandidate): boolean {
  const stored = text(candidate.storedName).toLowerCase();
  const branded = text(candidate.brandedName).toLowerCase();
  return Boolean(stored) && stored === branded;
}

export function classifyLabBrandedNameType(
  candidate: LabBrandedNameTypeCandidate,
): LabBrandedNameTypePlanRow {
  const brandedName = text(candidate.brandedName);
  const beforeEntityType = text(candidate.entityType);
  const beforeKind = text(candidate.kind);
  const row: LabBrandedNameTypePlanRow = {
    slug: candidate.slug,
    outcome: 'plan',
    brandedName,
    beforeEntityType,
    beforeKind,
  };
  const sourceUrl = text(candidate.brandedNameSourceUrl);
  if (sourceUrl) row.sourceUrl = sourceUrl;
  const observedAt = text(candidate.brandedNameObservedAt);
  if (observedAt) row.observedAt = observedAt;

  if (candidate.archived === true) return { ...row, outcome: 'archived' };
  if (beforeEntityType === BACKFILL_ENTITY_TYPE) return { ...row, outcome: 'already-lab' };
  if (!namesASelfDeclaredLaboratory(brandedName)) {
    return { ...row, outcome: 'brand-not-a-laboratory' };
  }
  if (!isPersonScopedResearchEntity(candidate)) return { ...row, outcome: 'not-person-scoped' };
  if (!stillServesBrand(candidate)) return { ...row, outcome: 'brand-no-longer-served' };
  const locked = asStringArray(candidate.manuallyLockedFields);
  if (locked.includes('entityType') || locked.includes('kind')) {
    return { ...row, outcome: 'locked' };
  }
  // Retracting a name the product already serves takes positive evidence that the
  // page was a directory entry, not merely the absence of evidence that it was a
  // microsite. `looksLikeOrgPage` cannot carry that weight here: it answers true for
  // any URL two segments deep on any host, so a lab microsite's own sub-page
  // (`campuspress.example.edu/aresearcherlab/research/`) reads identically to a
  // directory profile, and in its original use a false positive only withheld a
  // promotion (#2460) where here it would erase a correct brand.
  if (isPersonProfileOrDirectoryUrl(sourceUrl)) {
    return { ...row, outcome: 'brand-not-self-declared' };
  }
  if (looksLikeOrgPage(sourceUrl)) return { ...row, outcome: 'brand-page-not-a-microsite' };

  return {
    ...row,
    outcome: 'plan',
    afterEntityType: BACKFILL_ENTITY_TYPE,
    afterKind: BACKFILL_KIND,
  };
}

export function planLabBrandedNameTypeBackfill(
  candidates: LabBrandedNameTypeCandidate[],
): LabBrandedNameTypePlanRow[] {
  return candidates.map((candidate) => classifyLabBrandedNameType(candidate));
}

export function summarizeLabBrandedNameTypeBackfill(
  rows: LabBrandedNameTypePlanRow[],
): Record<LabBrandedNameTypeOutcome, number> {
  const summary: Record<LabBrandedNameTypeOutcome, number> = {
    plan: 0,
    'already-lab': 0,
    archived: 0,
    'brand-not-a-laboratory': 0,
    'brand-not-self-declared': 0,
    'brand-page-not-a-microsite': 0,
    'not-person-scoped': 0,
    locked: 0,
    'brand-no-longer-served': 0,
  };
  for (const row of rows) summary[row.outcome] += 1;
  return summary;
}
