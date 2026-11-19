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
  fetched?: boolean;
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
  | 'row-has-an-unread-profile'
  | 'row-has-several-profiles';

export interface CenterMemberProfilePlan {
  observations: ObservationInput[];
  emittedRows: number;
  undecidedEntityIds: ReadonlySet<string>;
  skipped: Record<CenterMemberProfileSkip, number>;
}

type ProfileTextField = (typeof CENTER_MEMBER_PROFILE_RESEARCH_FIELDS)[number];

const FIELD_VALUE: Record<ProfileTextField, keyof CenterMemberProfileText> = {
  [RESEARCH_STATEMENT_FIELD]: 'researchStatement',
  [BIOGRAPHY_FIELD]: 'biography',
};

function profileFieldObservation(
  row: Pick<PersonalResearchRow, 'entityId' | 'slug'>,
  field: ProfileTextField,
  profileUrl: string,
  text: CenterMemberProfileText,
): ObservationInput {
  const base = {
    entityType: 'researchEntity' as const,
    entityId: row.entityId,
    entityKey: row.slug,
    sourceUrl: profileUrl,
  };
  const value = text[FIELD_VALUE[field]];
  return value
    ? { ...base, field, value }
    : { ...base, field, value: '', assertsNoValueFor: [field] };
}

export function profileTextObservations(
  row: Pick<PersonalResearchRow, 'entityId' | 'slug'>,
  profileUrl: string,
  text: CenterMemberProfileText,
): ObservationInput[] {
  return CENTER_MEMBER_PROFILE_RESEARCH_FIELDS.map((field) =>
    profileFieldObservation(row, field, profileUrl, text),
  );
}

const fieldLength = (read: CenterMemberProfileRead, field: ProfileTextField): number =>
  read.text?.[FIELD_VALUE[field]]?.length ?? 0;

// The two fields are latest-wins for this source, so each field of a row read from several
// center profiles comes from exactly one page, chosen the same way on every run.
function fullestReadFor(
  field: ProfileTextField,
  reads: readonly CenterMemberProfileRead[],
): CenterMemberProfileRead {
  return reads.reduce((best, read) => {
    const lengthDelta = fieldLength(read, field) - fieldLength(best, field);
    return lengthDelta > 0 || (lengthDelta === 0 && read.profileUrl < best.profileUrl)
      ? read
      : best;
  });
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
    'row-has-an-unread-profile': 0,
    'row-has-several-profiles': 0,
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
  const rowReachedBy = (profileUrl: string): PersonalResearchRow | CenterMemberProfileSkip => {
    const people = [...(peopleByProfileUrl.get(profileUrl) ?? [])];
    if (people.length === 0) return 'no-identity-joined-member';
    if (people.length > 1) return 'ambiguous-member';
    const rows = [...(rowsByPerson.get(people[0])?.values() ?? [])];
    if (rows.length === 0) return 'leads-no-research-row';
    if (rows.length > 1) return 'leads-several-research-rows';
    if ((leadersByRow.get(rows[0].entityId)?.size ?? 0) > 1) return 'row-led-by-several-members';
    return rows[0];
  };

  // A page fetched without the host's profile block offers nothing to compete with, while a
  // page that failed to fetch might hold the fuller text, so only a failed fetch holds a row.
  const decidedProfileUrls = new Set(
    input.reads.filter((read) => read.text || read.fetched).map((read) => read.profileUrl),
  );
  const undecidedEntityIds = new Set<string>();
  for (const profileUrl of peopleByProfileUrl.keys()) {
    if (decidedProfileUrls.has(profileUrl)) continue;
    const reached = rowReachedBy(profileUrl);
    if (typeof reached !== 'string') undecidedEntityIds.add(reached.entityId);
  }

  const readsByRow = new Map<
    string,
    { row: PersonalResearchRow; reads: CenterMemberProfileRead[] }
  >();
  for (const read of input.reads) {
    if (!read.text) {
      skipped['profile-unread'] += 1;
      continue;
    }
    const reached = rowReachedBy(read.profileUrl);
    if (typeof reached === 'string') {
      skipped[reached] += 1;
      continue;
    }
    if (undecidedEntityIds.has(reached.entityId)) {
      skipped['row-has-an-unread-profile'] += 1;
      continue;
    }
    const candidates = readsByRow.get(reached.entityId);
    if (candidates) {
      skipped['row-has-several-profiles'] += 1;
      candidates.reads.push(read);
    } else {
      readsByRow.set(reached.entityId, { row: reached, reads: [read] });
    }
  }
  const observations = [...readsByRow.values()].flatMap(({ row, reads }) =>
    CENTER_MEMBER_PROFILE_RESEARCH_FIELDS.map((field) => {
      const read = fullestReadFor(field, reads);
      return profileFieldObservation(row, field, read.profileUrl, read.text ?? {});
    }),
  );
  return { observations, emittedRows: readsByRow.size, undecidedEntityIds, skipped };
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
  keptEntityIds: ReadonlySet<string>;
}): ObservationInput[] {
  const readProfileUrls = new Set(
    input.reads.filter((read) => read.text).map((read) => read.profileUrl),
  );
  const retracted = new Set<string>();
  return input.live.flatMap((row) => {
    if (input.keptEntityIds.has(row.entityId) || retracted.has(row.entityId)) return [];
    if (input.rosterProfileUrls.has(row.profileUrl) && !readProfileUrls.has(row.profileUrl)) {
      return [];
    }
    retracted.add(row.entityId);
    return profileTextObservations(row, row.profileUrl, {});
  });
}
