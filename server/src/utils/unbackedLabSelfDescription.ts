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
 * lock, and stops applying the moment a non-LLM source names the lab by surname. The
 * full-name form ("The <given> <surname> Lab") is recast whatever its provenance, because
 * it is our writers' wording rather than a page's.
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

const ANOTHER_NAMED_LAB = /\b(?!The\b)[A-Z][\p{L}'’-]*\s+Lab(?:oratory)?\b/u;

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

// Lowercase surname particles, so "the van Brecht Lab" is read as one name rather than
// leaving "the van" behind when only "Brecht Lab" is recast.
const SURNAME_PARTICLE = '(?:van|von|de|der|den|del|della|da|di|du|la|le|al|el|ben|bin)';

function namedLabPattern(person: string, flags: string): RegExp {
  const tokens = personTokens(person);
  const surname = escapeRegExp(tokens[tokens.length - 1]);
  // The lookbehind keeps a hyphenated pair ("Marsh-Okonkwo Lab") whole: its second half
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

function letters(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}]/gu, '');
}

const LAB_TOKEN = 'lab(?:oratory|s)?';

// A lab-named URL counts only when the lab token sits beside this person's surname in
// one host label or path segment ("<surname>lab.example.edu", "/lab/<surname>/"): a
// shared lab host, or a member profile under another PI's lab, proves a lab exists
// somewhere, not that this person runs one.
function urlNamesThisPersonsLab(value: unknown, person: string): boolean {
  try {
    const url = new URL(textValue(value));
    const tokens = personTokens(person);
    const surname = letters(tokens[tokens.length - 1]);
    if (surname.length < 3) return false;
    const parts = [...url.hostname.split('.'), ...url.pathname.split('/')]
      .map(letters)
      .filter(Boolean);
    const labBesideSurname = new RegExp(`${surname}${LAB_TOKEN}$|^${LAB_TOKEN}${surname}`);
    const bareLab = new RegExp(`^${LAB_TOKEN}$`);
    return parts.some(
      (part, index) =>
        labBesideSurname.test(part) ||
        (bareLab.test(part) && (parts[index + 1] ?? '').includes(surname)),
    );
  } catch {
    return false;
  }
}

function nonLlmEvidenceNamesTheLab(entity: Record<string, any>, person: string): boolean {
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  if (urls.some((url) => urlNamesThisPersonsLab(url, person))) return true;
  return DESCRIPTION_FIELDS.some(
    (field) =>
      !isLlmAuthoredSourceName(entity.fieldProvenance?.[field]?.sourceName) &&
      [...textValue(entity[field]).matchAll(namedLabPattern(person, 'g'))].some(
        (match) => !isFullNameLabForm(match[2], person),
      ),
  );
}

/**
 * Whether a "<given names> <surname> Lab" mention spells out the person's own given name.
 *
 * Official pages name a lab by surname ("The Okonkwo Lab"); the full-name form is the
 * wording our own description writers produce, and it reaches non-LLM provenance through
 * repairs and enrichment rewrites. So it is never evidence that a lab exists, whatever
 * source recorded it (#4681).
 */
function isFullNameLabForm(givenRun: string | undefined, person: string): boolean {
  const tokens = personTokens(person);
  const givenNames = new Set(tokens.slice(0, -1).map((token) => token.toLowerCase()));
  return (givenRun ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/[.,]+$/, '').toLowerCase())
    .some((token) => givenNames.has(token) && !new RegExp(`^${SURNAME_PARTICLE}$`).test(token));
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
 * A subject becomes the person ("The Okonkwo-Vale Lab studies" -> "Wren Okonkwo-Vale
 * studies"), a possessive becomes theirs, and a mid-sentence mention becomes their
 * research. A sentence-initial "The lab" or a "the lab's" that only carries the claim
 * forward is recast the same way once a named mention was found, unless another named lab
 * remains for it to refer to. Another person's lab is never touched, because only the
 * row's own person matches.
 */
export function recastUnbackedLabSelfDescription(
  value: unknown,
  entity: Record<string, any> | null | undefined,
  field: string,
): string {
  const text = typeof value === 'string' ? value : '';
  if (!text || !entity || !/\blab(?:oratory)?\b/i.test(text)) return text;
  if (textValue(entity.entityType).toUpperCase() !== 'FACULTY_RESEARCH_AREA') return text;
  const llmAuthored = isLlmAuthoredSourceName(entity.fieldProvenance?.[field]?.sourceName);
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
      if (!llmAuthored && !isFullNameLabForm(givenRun, person)) return match;
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
  next = next.replace(
    new RegExp(
      `(^|[.!?]\\s+)(${escapeRegExp(person)}) is (an?) ((?:[\\p{L}-]+\\s+){0,4}?)(?:research\\s+)?(?:lab|laboratory|program)\\b`,
      'gu',
    ),
    '$1$2 leads $3 $4research program',
  );
  if (ANOTHER_NAMED_LAB.test(next)) return next;
  next = next.replace(/(^|[.!?]\s+)Its research\b/g, '$1This research');
  next = next.replace(/\b[Tt]he lab['’]s\b/g, possessive(person));
  next = next.replace(
    /(^|[.!?]\s+)The lab\b(?=\s+[a-z])/g,
    (match: string, lead: string, offset: number, full: string) =>
      LAB_NAME_CONTINUATION.test(full.slice(offset + match.length))
        ? match
        : `${lead}This research`,
  );
  return next;
}

// Mirrors the `too-short` floor in `fullDescriptionQuality`: a body under it withholds
// the whole row, so changing that floor also requires updating this one. Restated
// because `researchEntityDescriptionQuality` imports the module that calls this one.
const SERVABLE_FULL_DESCRIPTION_MIN_WORDS = 12;

const BODY_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'profileSynthesisDescription',
]);

/**
 * The recast description, or the stored text when recasting would shrink a body under
 * the servable floor: dropping the claim must never cost the row its whole body.
 */
export function withoutUnbackedLabSelfDescription(
  value: unknown,
  entity: Record<string, any> | null | undefined,
  field: string,
): string {
  const text = typeof value === 'string' ? value : '';
  const recast = recastUnbackedLabSelfDescription(text, entity, field);
  if (recast === text || !BODY_FIELDS.has(field)) return recast;
  const recastWordCount = recast.split(/\s+/).filter(Boolean).length;
  return recastWordCount < SERVABLE_FULL_DESCRIPTION_MIN_WORDS ? text : recast;
}
