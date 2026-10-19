import * as cheerio from 'cheerio';
import type { ObservationInput } from '../types';
import { wordpressAuthorProfileSections } from './wordpressAuthorProfile';

export const CENTER_MEMBER_PROFILE_RESEARCH_SOURCE = 'center-member-profile-research';

export const RESEARCH_STATEMENT_FIELD = 'researchSummary';
export const BIOGRAPHY_FIELD = 'bio';
export const CENTER_MEMBER_PROFILE_RESEARCH_FIELDS = [
  RESEARCH_STATEMENT_FIELD,
  BIOGRAPHY_FIELD,
] as const;

export const PERSONAL_RESEARCH_ROW_TYPES: readonly string[] = ['LAB', 'FACULTY_RESEARCH_AREA'];

const MIN_PROFILE_TEXT_CHARS = 40;

export interface CenterMemberProfileText {
  researchStatement?: string;
  biography?: string;
}

export type CenterMemberProfileExtractor = (html: string) => CenterMemberProfileText | undefined;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const fdsMemberProfileExtractor: CenterMemberProfileExtractor = (html) =>
  wordpressAuthorProfileSections(cheerio.load(html));

export function drupalPersonBodyExtractor(paragraphSelector: string): CenterMemberProfileExtractor {
  return (html) => {
    const $ = cheerio.load(html);
    const paragraphs = $(paragraphSelector);
    if (!paragraphs.length) return undefined;
    const kept: string[] = [];
    paragraphs.each((_i, el) => {
      const paragraph = $(el);
      const text = collapseWhitespace(paragraph.text());
      const linkText = collapseWhitespace(paragraph.find('a').text());
      if (text && text !== linkText) kept.push(text);
    });
    const biography = collapseWhitespace(kept.join(' '));
    return { biography: biography.length >= MIN_PROFILE_TEXT_CHARS ? biography : undefined };
  };
}

export const cowlesPersonProfileExtractor = drupalPersonBodyExtractor(
  'article.node--person .node__body > p',
);

export const macmillanPersonProfileExtractor = drupalPersonBodyExtractor(
  '.node__bio .node__body p',
);

export interface CenterMemberProfileRead {
  profileUrl: string;
  text?: CenterMemberProfileText;
}

export interface CenterMemberIdentityJoin {
  profileUrl: string;
  personId: string;
}

export interface PersonalResearchRow {
  personId: string;
  entityId: string;
  slug: string;
}

export interface LiveProfileTextRow {
  entityId: string;
  slug: string;
  profileUrl: string;
}

export type CenterMemberProfileSkip =
  | 'profile-unread'
  | 'no-identity-joined-member'
  | 'ambiguous-member'
  | 'leads-no-research-row'
  | 'leads-several-research-rows'
  | 'row-led-by-several-members'
  | 'row-has-a-fuller-profile';

export interface CenterMemberProfilePlan {
  observations: ObservationInput[];
  emittedRows: number;
  skipped: Record<CenterMemberProfileSkip, number>;
}

const FIELD_VALUE: Record<
  (typeof CENTER_MEMBER_PROFILE_RESEARCH_FIELDS)[number],
  keyof CenterMemberProfileText
> = {
  [RESEARCH_STATEMENT_FIELD]: 'researchStatement',
  [BIOGRAPHY_FIELD]: 'biography',
};

export function profileTextObservations(
  row: Pick<PersonalResearchRow, 'entityId' | 'slug'>,
  profileUrl: string,
  text: CenterMemberProfileText,
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityId: row.entityId,
    entityKey: row.slug,
    sourceUrl: profileUrl,
  };
  return CENTER_MEMBER_PROFILE_RESEARCH_FIELDS.map((field) => {
    const value = text[FIELD_VALUE[field]];
    return value
      ? { ...base, field, value }
      : { ...base, field, value: '', assertsNoValueFor: [field] };
  });
}

const profileTextLength = (read: CenterMemberProfileRead): number =>
  (read.text?.researchStatement?.length ?? 0) + (read.text?.biography?.length ?? 0);

// The two fields are latest-wins for this source, so a row read from two center profiles
// keeps exactly one page, chosen the same way on every run.
function profileReadOutranks(
  candidate: CenterMemberProfileRead,
  incumbent: CenterMemberProfileRead,
): boolean {
  const lengthDelta = profileTextLength(candidate) - profileTextLength(incumbent);
  return lengthDelta !== 0 ? lengthDelta > 0 : candidate.profileUrl < incumbent.profileUrl;
}

/**
 * A profile page joins to a person only through a membership edge whose identity the
 * centers lane proved, and its text lands only on the one personal research row that
 * person leads, because a statement cannot say which of several rows it describes. A row
 * several joined members lead is skipped too, because their pages would overwrite each other.
 */
export function planCenterMemberProfileResearch(input: {
  reads: readonly CenterMemberProfileRead[];
  joins: readonly CenterMemberIdentityJoin[];
  rows: readonly PersonalResearchRow[];
}): CenterMemberProfilePlan {
  const skipped: Record<CenterMemberProfileSkip, number> = {
    'profile-unread': 0,
    'no-identity-joined-member': 0,
    'ambiguous-member': 0,
    'leads-no-research-row': 0,
    'leads-several-research-rows': 0,
    'row-led-by-several-members': 0,
    'row-has-a-fuller-profile': 0,
  };
  const peopleByProfileUrl = new Map<string, Set<string>>();
  for (const join of input.joins) {
    const people = peopleByProfileUrl.get(join.profileUrl) ?? new Set<string>();
    people.add(join.personId);
    peopleByProfileUrl.set(join.profileUrl, people);
  }
  const rowsByPerson = new Map<string, Map<string, PersonalResearchRow>>();
  const leadersByRow = new Map<string, Set<string>>();
  for (const row of input.rows) {
    const rows = rowsByPerson.get(row.personId) ?? new Map<string, PersonalResearchRow>();
    rows.set(row.entityId, row);
    rowsByPerson.set(row.personId, rows);
    const leaders = leadersByRow.get(row.entityId) ?? new Set<string>();
    leaders.add(row.personId);
    leadersByRow.set(row.entityId, leaders);
  }

  const chosenByRow = new Map<
    string,
    { row: PersonalResearchRow; read: CenterMemberProfileRead }
  >();
  for (const read of input.reads) {
    if (!read.text) {
      skipped['profile-unread'] += 1;
      continue;
    }
    const people = [...(peopleByProfileUrl.get(read.profileUrl) ?? [])];
    if (people.length === 0) {
      skipped['no-identity-joined-member'] += 1;
      continue;
    }
    if (people.length > 1) {
      skipped['ambiguous-member'] += 1;
      continue;
    }
    const rows = [...(rowsByPerson.get(people[0])?.values() ?? [])];
    if (rows.length === 0) {
      skipped['leads-no-research-row'] += 1;
      continue;
    }
    if (rows.length > 1) {
      skipped['leads-several-research-rows'] += 1;
      continue;
    }
    if ((leadersByRow.get(rows[0].entityId)?.size ?? 0) > 1) {
      skipped['row-led-by-several-members'] += 1;
      continue;
    }
    const chosen = chosenByRow.get(rows[0].entityId);
    if (chosen) {
      skipped['row-has-a-fuller-profile'] += 1;
      if (!profileReadOutranks(read, chosen.read)) continue;
    }
    chosenByRow.set(rows[0].entityId, { row: rows[0], read });
  }
  const observations = [...chosenByRow.values()].flatMap(({ row, read }) =>
    profileTextObservations(row, read.profileUrl, read.text ?? {}),
  );
  return { observations, emittedRows: chosenByRow.size, skipped };
}

/**
 * A row this lane gave text to in an earlier run loses it once a run decides the page no
 * longer belongs there: the page was read and attached elsewhere or nowhere, or it left
 * every roster. A page this run did not read decides nothing, so its text stays live.
 */
export function staleProfileTextRetractions(input: {
  live: readonly LiveProfileTextRow[];
  reads: readonly CenterMemberProfileRead[];
  rosterProfileUrls: ReadonlySet<string>;
  attachedEntityIds: ReadonlySet<string>;
}): ObservationInput[] {
  const readProfileUrls = new Set(
    input.reads.filter((read) => read.text).map((read) => read.profileUrl),
  );
  const retracted = new Set<string>();
  return input.live.flatMap((row) => {
    if (input.attachedEntityIds.has(row.entityId) || retracted.has(row.entityId)) return [];
    if (input.rosterProfileUrls.has(row.profileUrl) && !readProfileUrls.has(row.profileUrl)) {
      return [];
    }
    retracted.add(row.entityId);
    return profileTextObservations(row, row.profileUrl, {});
  });
}
