import { deriveBioResearchStatement } from '../../utils/bioResearchStatement';
import { facultyResearchAreaSlugForPersonName } from '../../utils/researchEntityShellSlug';
import type { ObservationInput } from '../types';
import {
  ROSTER_BIO_EVIDENCE_FIELD,
  rosterBioPersonNameKey,
  rosterBioTitleVerdict,
} from './rosterBioResearchEvidence';
import { normalizedYaleNetid } from '../../utils/yaleNetid';
import { mintsNoResearchEntityAsTeachingAppointment } from '../sources/yaleDirectoryScraper';

export const CENTER_PROFILE_RESEARCH_ROWS_SOURCE = 'center-profile-research-rows';

export interface CenterProfileRowCandidate {
  personId: string;
  displayName: string;
  netid?: string;
  title?: string;
  profileUrl: string;
  profileText?: string;
}

export interface CenterProfileRowCoverage {
  slugs: ReadonlySet<string>;
  citedUrls: ReadonlySet<string>;
  personalRowNames: ReadonlySet<string>;
  inferredLeadKeys: ReadonlySet<string>;
}

export type CenterProfileRowSkip =
  | 'no_profile_text'
  | 'no_title'
  | 'non_hosting_title'
  | 'no_research_rank'
  | 'empty_bio'
  | 'no_research_statement'
  | 'only_past_research'
  | 'not_useful_after_filtering'
  | 'teaching_appointment'
  | 'no_netid'
  | 'unusable_name'
  | 'slug_taken'
  | 'profile_already_cited'
  | 'row_already_infers_lead'
  | 'personal_row_for_person';

export interface CenterProfilePlannedRow {
  personId: string;
  slug: string;
  name: string;
  netid: string;
  profileUrl: string;
  evidenceSentences: string[];
}

export function normalizeCitedUrl(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/**
 * A row is minted only for a member the corpus holds nothing for: no row under the slug the
 * mint would take, no row already citing the profile, no row already inferring the member as
 * its lead, and no personal row, live or archived, in the member's name, because an archive
 * is a decision about that person a new mint must not undo.
 */
export function planCenterProfileResearchRows(
  candidates: readonly CenterProfileRowCandidate[],
  coverage: CenterProfileRowCoverage,
): { planned: CenterProfilePlannedRow[]; skipped: Partial<Record<CenterProfileRowSkip, number>> } {
  const skipped: Partial<Record<CenterProfileRowSkip, number>> = {};
  const skip = (reason: CenterProfileRowSkip) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const planned: CenterProfilePlannedRow[] = [];
  const plannedSlugs = new Set<string>();
  for (const candidate of [...candidates].sort((a, b) =>
    a.profileUrl.localeCompare(b.profileUrl),
  )) {
    if (!candidate.profileText) {
      skip('no_profile_text');
      continue;
    }
    const verdict = rosterBioTitleVerdict(candidate.title);
    if (verdict !== 'eligible') {
      skip(verdict === 'non_hosting' ? 'non_hosting_title' : verdict);
      continue;
    }
    const derived = deriveBioResearchStatement(candidate.profileText, {
      name: candidate.displayName,
    });
    if (derived.rejection) {
      skip(derived.rejection);
      continue;
    }
    if (
      mintsNoResearchEntityAsTeachingAppointment(candidate.title, {
        fullDescription: derived.fullDescription,
      })
    ) {
      skip('teaching_appointment');
      continue;
    }
    const netid = normalizedYaleNetid(candidate.netid);
    if (!netid) {
      skip('no_netid');
      continue;
    }
    const nameKey = rosterBioPersonNameKey(candidate.displayName);
    const slug = facultyResearchAreaSlugForPersonName(candidate.displayName);
    if (!nameKey || !slug) {
      skip('unusable_name');
      continue;
    }
    if (coverage.slugs.has(slug) || plannedSlugs.has(slug)) {
      skip('slug_taken');
      continue;
    }
    if (coverage.citedUrls.has(normalizeCitedUrl(candidate.profileUrl))) {
      skip('profile_already_cited');
      continue;
    }
    if (coverage.inferredLeadKeys.has(`netid:${netid}`)) {
      skip('row_already_infers_lead');
      continue;
    }
    if (coverage.personalRowNames.has(nameKey)) {
      skip('personal_row_for_person');
      continue;
    }
    plannedSlugs.add(slug);
    planned.push({
      personId: candidate.personId,
      slug,
      name: candidate.displayName,
      netid,
      profileUrl: candidate.profileUrl,
      evidenceSentences: derived.evidenceSentences,
    });
  }
  return { planned, skipped };
}

export function centerProfileResearchRowObservations(
  row: CenterProfilePlannedRow,
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: row.slug,
    sourceUrl: row.profileUrl,
  };
  return [
    { ...base, field: 'slug', value: row.slug },
    { ...base, field: 'name', value: `${row.name} Faculty Research` },
    { ...base, field: 'kind', value: 'individual' },
    { ...base, field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
    { ...base, field: 'sourceUrls', value: [row.profileUrl] },
    { ...base, field: 'inferredPiUserKey', value: `netid:${row.netid}`, confidenceOverride: 0.7 },
    { ...base, field: ROSTER_BIO_EVIDENCE_FIELD, value: row.evidenceSentences.join(' ') },
  ];
}
