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
 * stated it and no writer is recorded. Empty: a fill-only directory value fills only an empty
 * field (#6049). A blind three-grader check of 11 such replacements found the directory
 * value right in 5, the stored value right in 2 and both wrong in 1, and a never-backed
 * name, image or website measured worse when replaced (#6038). Adding a field here makes the
 * materializer consult the never-backed read for it again.
 */
const UNBACKED_STORED_VALUE_IS_ABSENT_FIELDS: ReadonlySet<ResearcherGatedField> = new Set();

/** Whether the never-backed read decides presence for `field`, so a caller can skip it. */
export function storedValueBackingDecidesPresence(field: ResearcherGatedField): boolean {
  return UNBACKED_STORED_VALUE_IS_ABSENT_FIELDS.has(field);
}

/**
 * Whether a stored value counts as present for writer precedence. A stored value on a field
 * in `UNBACKED_STORED_VALUE_IS_ABSENT_FIELDS` with no recorded writer that no observation,
 * live or superseded, ever stated would not be present, so a fill-only candidate would land
 * on it. No field is listed, so every stored value stays present (#6049).
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

export interface NetidKeyIdentityEvidence {
  identityJoin: string | undefined;
  payload: string;
  aliasNetid: string | undefined;
  researcherNetid: string | undefined;
}

/**
 * Whether a netid-shaped user key reached this researcher by a name join alone with nothing to
 * show it is that person (#6447). The `netid:` namespace often carries an email local part, a
 * misnomer #2831 measured and kept, so the key is proven only by this researcher: it holds the
 * payload as its own netid, or the directory alias map resolves the payload to its netid (#5744).
 * Another researcher holding the payload is not proof, because it points at a different person.
 */
export function isUnprovenNetidKeyOnNameJoin(evidence: NetidKeyIdentityEvidence): boolean {
  if (evidence.identityJoin !== 'person-name') return false;
  const payload = evidence.payload.trim().toLowerCase();
  if (!payload) return false;
  const researcherNetid = evidence.researcherNetid?.trim().toLowerCase();
  if (!researcherNetid) return true;
  const aliasNetid = evidence.aliasNetid?.trim().toLowerCase();
  return payload !== researcherNetid && aliasNetid !== researcherNetid;
}

export type UnprovenKeyFieldWriteDecision =
  { write: true } | { write: false; releaseWriter: boolean };

/**
 * An unproven key never holds a field (#6447): it gives back any field it holds, keeping the
 * value, and it only fills a field that is empty with no writer, recording no writer for it, so
 * a key that does reach the researcher can take the field over on its own standing.
 */
export function decideUnprovenKeyFieldWrite(
  writers: unknown,
  field: ResearcherGatedField,
  userKey: string,
  hasValue: boolean,
  storedValuePresent: boolean,
): UnprovenKeyFieldWriteDecision {
  const recorded = storedWriter(writers, field);
  if (recorded?.userKey === userKey) return { write: false, releaseWriter: true };
  if (!hasValue || storedValuePresent || recorded) return { write: false, releaseWriter: false };
  return { write: true };
}

/**
 * Whether this key writes `field`. A key that holds the field but resolves no candidate now
 * releases it, so a sibling can take the field over; the stored value itself is left alone.
 * A value that outranks the stored one, such as a person's own website over the profile page
 * a better-joined key wrote (#5845), writes whatever the writer rank.
 * A fill-only candidate never replaces a stored value with no writer, which some other source
 * set before writers were recorded, nor one a key that is not fill-only holds. Against a holder
 * that is fill-only too it ranks as usual, so fill-only keys settle among themselves in any order.
 * A holder recorded before the fill-only flag existed counts as fill-only when its join would
 * make it one now.
 * Callers pass `storedValuePresent` from `storedValueCountsAsPresent` (#6049).
 */
export function decideResearcherFieldWrite(
  writers: unknown,
  field: ResearcherGatedField,
  candidate: ResearcherFieldWriter,
  hasValue: boolean,
  storedValuePresent = false,
  valueOutranksStored = false,
): ResearcherFieldWriteDecision {
  const recorded = storedWriter(writers, field);
  const current =
    recorded && writerHeldOnFillOnlyEvidence(field, recorded)
      ? { ...recorded, fillOnly: true }
      : recorded;
  const holdsField = current?.userKey === candidate.userKey;
  if (!hasValue) return { write: false, releaseWriter: holdsField };
  if (candidate.fillOnly && !holdsField && storedValuePresent && !current?.fillOnly) {
    return { write: false, releaseWriter: false };
  }
  if (current && !holdsField && !valueOutranksStored && !writerOutranks(candidate, current)) {
    return { write: false, releaseWriter: false };
  }
  const writerChanged =
    !recorded ||
    recorded.userKey !== candidate.userKey ||
    recorded.joinRank !== candidate.joinRank ||
    recorded.confidence !== candidate.confidence ||
    Boolean(recorded.fillOnly) !== Boolean(candidate.fillOnly);
  return { write: true, writer: candidate, writerChanged };
}
