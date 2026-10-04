/**
 * A faculty research description that calls its own subject a lab nothing backs.
 *
 * The LLM description lanes write "The <surname> Lab focuses on ..." for any page they
 * summarize, so a `FACULTY_RESEARCH_AREA` row, whose type already records that no lab
 * was found, serves prose asserting one (#4650 measured 105 served rows). The claim is
 * the model's framing rather than the page's: where an official, non-LLM text names the
 * lab, that is evidence the row may be a mistyped lab, and this leaves it alone.
 *
 * Applied at read time beside the first-person revoice, so it writes nothing, needs no
 * lock, and stops applying the moment a non-LLM source names the lab.
 */

const LLM_AUTHORED_SOURCE_SUFFIX = /-llm$/;

// The one LLM lane whose name lacks the suffix. A test pins this rule against every
// seed source whose display name says LLM, so a new lane cannot be missed silently.
const LLM_AUTHORED_SOURCES_WITHOUT_SUFFIX: ReadonlySet<string> = new Set([
  'fra-profile-research-synthesis',
]);

const DESCRIPTION_FIELDS = ['shortDescription', 'fullDescription'] as const;

const LAB_WORD = 'Lab(?:oratory)?';

const LAB_NAME_CONTINUATION =
  /^\s+(?:(?:for|of)\s+[A-Z]|[A-Z]|(?:members?|group|groups|team|teams|website|site|page|staff|alumni)\b)/;

const LEADER_APPOSITIVE = /,\s*(?:led|directed|headed|run)\s+by\s+[^,]+,/;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isLlmAuthoredSourceName(sourceName: unknown): boolean {
  const name = textValue(sourceName);
  return LLM_AUTHORED_SOURCE_SUFFIX.test(name) || LLM_AUTHORED_SOURCES_WITHOUT_SUFFIX.has(name);
}

function facultyResearchPersonName(entity: Record<string, any>): string {
  const name = textValue(entity.displayName) || textValue(entity.name);
  const person = name.replace(/\s+Faculty Research$/i, '').trim();
  if (person === name) return '';
  return person.split(/\s+/).length >= 2 ? person : '';
}

function personTokens(person: string): string[] {
  return person
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/[.,]+$/, ''))
    .filter(Boolean);
}

// Lowercase surname particles, so "the van Altena Lab" is read as one name rather than
// leaving "the van" behind when only "Altena Lab" is recast.
const SURNAME_PARTICLE = '(?:van|von|de|der|den|del|della|da|di|du|la|le|al|el|ben|bin)';

function namedLabPattern(person: string, flags: string): RegExp {
  const tokens = personTokens(person);
  const surname = escapeRegExp(tokens[tokens.length - 1]);
  // The lookbehind keeps a hyphenated pair ("Lusk-King Lab") whole: its second half
  // is never this person's lab on its own.
  return new RegExp(
    `(\\b[Tt]he\\s+)?((?:(?:[A-Z][\\p{L}.'’-]*|${SURNAME_PARTICLE})\\s+){0,4})(?<![\\p{L}'’-])${surname}\\s+${LAB_WORD}\\b(['’]s)?`,
    `${flags}u`,
  );
}

function runNamesOnlyThisPerson(run: string, person: string): boolean {
  const own = new Set(personTokens(person).map((token) => token.toLowerCase()));
  return run
    .split(/\s+/)
    .map((token) => token.replace(/[.,]+$/, '').toLowerCase())
    .filter(Boolean)
    .every((token) => own.has(token));
}

function nonLlmEvidenceNamesTheLab(entity: Record<string, any>, person: string): boolean {
  const labMention = namedLabPattern(person, '');
  return DESCRIPTION_FIELDS.some(
    (field) =>
      !isLlmAuthoredSourceName(entity.fieldProvenance?.[field]?.sourceName) &&
      labMention.test(textValue(entity[field])),
  );
}

function possessive(person: string): string {
  return /s$/i.test(person) ? `${person}'` : `${person}'s`;
}

function isAtSentenceStart(offset: number, full: string): boolean {
  const before = full.slice(0, offset).trimEnd();
  return before === '' || /[.!?]["”’)]?$/.test(before);
}

/**
 * The description with every unbacked "<person> Lab" self-reference recast onto the
 * person, or the text unchanged when the rule does not apply.
 *
 * A subject becomes the person ("The Pettigrew Lab studies" -> "Melinda Pettigrew
 * studies"), a possessive becomes theirs, and a mid-sentence mention becomes their
 * research. A sentence-initial "The lab" or a "the lab's" that only carries the claim
 * forward is recast the same way once a named mention was found. Another person's lab
 * is never touched, because only the row's own person matches.
 */
export function withoutUnbackedLabSelfDescription(
  value: unknown,
  entity: Record<string, any> | null | undefined,
  field: string,
): string {
  const text = typeof value === 'string' ? value : '';
  if (!text || !entity || !/\blab(?:oratory)?\b/i.test(text)) return text;
  if (textValue(entity.entityType).toUpperCase() !== 'FACULTY_RESEARCH_AREA') return text;
  if (!isLlmAuthoredSourceName(entity.fieldProvenance?.[field]?.sourceName)) return text;
  const person = facultyResearchPersonName(entity);
  if (!person || nonLlmEvidenceNamesTheLab(entity, person)) return text;

  let recast = false;
  let next = text.replace(
    namedLabPattern(person, 'g'),
    (
      match: string,
      article: string | undefined,
      givenRun: string,
      possessiveSuffix: string | undefined,
      offset: number,
      full: string,
    ) => {
      if (!runNamesOnlyThisPerson(givenRun, person)) return match;
      if (/["“‘]$/.test(full.slice(0, offset))) return match;
      if (!possessiveSuffix && LAB_NAME_CONTINUATION.test(full.slice(offset + match.length))) {
        return match;
      }
      recast = true;
      if (possessiveSuffix) return possessive(person);
      return isAtSentenceStart(offset, full) ? person : `${possessive(person)} research`;
    },
  );
  if (!recast) return text;

  next = next.replace(
    new RegExp(`(^|[.!?]\\s+)(${escapeRegExp(person)})${LEADER_APPOSITIVE.source}`, 'g'),
    '$1$2',
  );
  next = next.replace(/\bThe lab['’]s\b/g, possessive(person));
  next = next.replace(/\bthe lab['’]s\b/g, possessive(person));
  next = next.replace(/(^|[.!?]\s+)The lab\b(?=\s+[a-z])/g, '$1This research');
  return next;
}
