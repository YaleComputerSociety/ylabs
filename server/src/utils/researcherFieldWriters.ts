/**
 * Which `user` key may write a person's display field when several keys join one researcher
 * (#5706). Each key resolves its own evidence, so without a precedence the stored value is
 * whichever key resolved last and a repeated resolve never settles. The researcher records the
 * key that wrote each field and the strength it wrote with; a key writes only when it is that
 * writer, nothing is recorded, or it outranks the writer. The outcome of a full pass is then the
 * same in any order, and a second pass writes nothing.
 *
 * Rank: the identity join first (a netid reaches the person more surely than a name), then the
 * resolved candidate's confidence, then the key itself, so a tie still has one answer.
 *
 * `title` is not listed: it is resolved per researcher over every joining key with source
 * authority (#5578), so a writer rank must not hold back the pooled value. Only a title a key
 * falls back to from its own evidence, because the pool states none, is gated, under
 * `OWN_KEY_FALLBACK_TITLE_FIELD`.
 *
 * Above that rank sits a field-specific source rule: a value backed only by a fill-only source
 * for that field may fill an empty field but never outranks or ties a value any other source
 * backs, whatever the join. The Yale directory's department is its HR unit, which a person's own
 * official page contradicted in 6 of 10 hand-checked disagreements (#5741). Its name is first and
 * last name only, which a blind grader judged worse than the stored profile or roster name in 15
 * of 20 planned changes, so a directory name is fill-only too (#6035). A name, image or website
 * from a key joined on the name alone is fill-only as well: the name is its only identity witness,
 * and blind re-measures found every wrong-person and unsure rename, and a wrong website and an
 * unsure image, on such a join (#6035). `primaryDepartment` is left out, because the roster
 * departments that outrank a directory department mostly arrive on name-joined keys.
 */
export const RESEARCHER_WRITER_FIELDS = [
  'displayName',
  'primaryDepartment',
  'imageUrl',
  'websiteUrl',
] as const;

export type ResearcherWriterField = (typeof RESEARCHER_WRITER_FIELDS)[number];

export const OWN_KEY_FALLBACK_TITLE_FIELD = 'title';

export type ResearcherGatedField = ResearcherWriterField | typeof OWN_KEY_FALLBACK_TITLE_FIELD;

const DIRECTORY_SOURCES: ReadonlySet<string> = new Set(['yale-directory', 'yale-directory-csv']);

const FILL_ONLY_SOURCES_BY_FIELD: Readonly<
  Partial<Record<ResearcherGatedField, ReadonlySet<string>>>
> = {
  displayName: DIRECTORY_SOURCES,
  primaryDepartment: DIRECTORY_SOURCES,
};

export function isFillOnlyFieldValue(
  field: ResearcherGatedField,
  contributingSources: readonly string[] | undefined,
): boolean {
  const fillOnly = FILL_ONLY_SOURCES_BY_FIELD[field];
  if (!fillOnly || !contributingSources?.length) return false;
  return contributingSources.every((source) => fillOnly.has(source));
}

const JOIN_RANK: Readonly<Record<string, number>> = {
  'account-netid': 4,
  'official-profile-page': 3,
  'account-email': 2,
  'person-name': 1,
  'minted-from-pi-attribution': 1,
};

const FILL_ONLY_JOIN_RANK_CEILING_BY_FIELD: Readonly<
  Partial<Record<ResearcherGatedField, number>>
> = {
  displayName: JOIN_RANK['person-name'],
  imageUrl: JOIN_RANK['person-name'],
  websiteUrl: JOIN_RANK['person-name'],
};

export function isFillOnlyIdentityJoin(
  field: ResearcherGatedField,
  identityJoin: string | undefined,
): boolean {
  const ceiling = FILL_ONLY_JOIN_RANK_CEILING_BY_FIELD[field];
  if (ceiling === undefined) return false;
  return (JOIN_RANK[identityJoin ?? ''] ?? 0) <= ceiling;
}

export interface ResearcherFieldWriter {
  userKey: string;
  joinRank: number;
  confidence: number;
  fillOnly?: boolean;
}

export function writerHeldOnFillOnlyEvidence(
  field: ResearcherGatedField,
  writer: Partial<ResearcherFieldWriter> | undefined,
): boolean {
  if (!writer?.userKey) return false;
  if (writer.fillOnly === true) return true;
  const ceiling = FILL_ONLY_JOIN_RANK_CEILING_BY_FIELD[field];
  return ceiling !== undefined && (writer.joinRank ?? 0) <= ceiling;
}

export function researcherFieldWriter(
  userKey: string,
  identityJoin: string | undefined,
  confidence: unknown,
  fillOnly = false,
): ResearcherFieldWriter {
  const numeric = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return {
    userKey,
    joinRank: JOIN_RANK[identityJoin ?? ''] ?? 0,
    confidence: Math.round(numeric * 1e6) / 1e6,
    ...(fillOnly ? { fillOnly: true } : {}),
  };
}

export function writerOutranks(a: ResearcherFieldWriter, b: ResearcherFieldWriter): boolean {
  if (Boolean(a.fillOnly) !== Boolean(b.fillOnly)) return !a.fillOnly;
  if (a.joinRank !== b.joinRank) return a.joinRank > b.joinRank;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence;
  return a.userKey < b.userKey;
}

const storedWriter = (writers: unknown, field: string): ResearcherFieldWriter | undefined => {
  const entry =
    writers instanceof Map
      ? writers.get(field)
      : writers && typeof writers === 'object'
        ? (writers as Record<string, unknown>)[field]
        : undefined;
  if (!entry || typeof entry !== 'object') return undefined;
  const { userKey, joinRank, confidence, fillOnly } = entry as Record<string, unknown>;
  if (typeof userKey !== 'string' || !userKey) return undefined;
  return {
    userKey,
    joinRank: typeof joinRank === 'number' ? joinRank : 0,
    confidence: typeof confidence === 'number' ? confidence : 0,
    ...(fillOnly === true ? { fillOnly: true } : {}),
  };
};

/**
 * Fields whose stored value is not present for writer precedence when no observation ever
 * stated it and no writer is recorded (#6049). Only `primaryDepartment`: a never-backed
 * stored name, image or website stays present, since a fill-only directory name replacing a
 * legacy fuller name measured worse (#6038).
 */
const UNBACKED_STORED_VALUE_IS_ABSENT_FIELDS: ReadonlySet<ResearcherGatedField> = new Set([
  'primaryDepartment',
]);

/**
 * Whether a stored value counts as present for writer precedence. A stored `primaryDepartment`
 * with no recorded writer that no observation, live or superseded, ever stated was set by no
 * source, so it is not present and a fill-only candidate lands on it (#6049). It only stops
 * blocking a fill: with no candidate the value stays, because a blind sample graded half of
 * such values right against the person's own page.
 */
export function storedValueCountsAsPresent(
  writers: unknown,
  field: ResearcherGatedField,
  storedValuePresent: boolean,
  storedValueBacked: boolean,
): boolean {
  if (!storedValuePresent) return false;
  if (storedValueBacked || !UNBACKED_STORED_VALUE_IS_ABSENT_FIELDS.has(field)) return true;
  return Boolean(storedWriter(writers, field));
}

export type ResearcherFieldWriteDecision =
  | { write: true; writer: ResearcherFieldWriter; writerChanged: boolean }
  | { write: false; releaseWriter: boolean };

/**
 * Whether this key writes `field`. A key that holds the field but resolves no candidate now
 * releases it, so a sibling can take the field over; the stored value itself is left alone.
 * A value that outranks the stored one, such as a person's own website over the profile page
 * a better-joined key wrote (#5845), writes whatever the writer rank.
 * A fill-only candidate that does not hold the field writes only into an empty field: a stored
 * value with no writer was set by some other source before writers were recorded, and a stored
 * value another key holds is one it may not replace, even when that holder is fill-only too.
 * Callers pass `storedValuePresent` from `storedValueCountsAsPresent`, which reads a
 * never-backed stored department as absent (#6049).
 */
export function decideResearcherFieldWrite(
  writers: unknown,
  field: ResearcherGatedField,
  candidate: ResearcherFieldWriter,
  hasValue: boolean,
  storedValuePresent = false,
  valueOutranksStored = false,
): ResearcherFieldWriteDecision {
  const current = storedWriter(writers, field);
  const holdsField = current?.userKey === candidate.userKey;
  if (!hasValue) return { write: false, releaseWriter: holdsField };
  if (candidate.fillOnly && !holdsField && storedValuePresent) {
    return { write: false, releaseWriter: false };
  }
  if (current && !holdsField && !valueOutranksStored && !writerOutranks(candidate, current)) {
    return { write: false, releaseWriter: false };
  }
  const writerChanged =
    !current ||
    current.userKey !== candidate.userKey ||
    current.joinRank !== candidate.joinRank ||
    current.confidence !== candidate.confidence ||
    Boolean(current.fillOnly) !== Boolean(candidate.fillOnly);
  return { write: true, writer: candidate, writerChanged };
}
