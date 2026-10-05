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

// "<Lab> is a hematology lab ..." defines the lab itself, so recasting its subject onto
// the person would make the sentence say the person is a lab. Left for the serve chain.
const IDENTITY_SENTENCE_CONTINUATION =
  /^\s+(?:is|was)\s+(?:an?|the)\s+(?:(?!(?:an?|the|of|in|for|at|on|with|from|by|to|and)\s)[\p{L}'’-]+\s+){0,3}lab(?:oratory)?(?![\p{L}'’-])/iu;

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
 * source recorded it (#4707).
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
      if (
        !possessiveSuffix &&
        IDENTITY_SENTENCE_CONTINUATION.test(full.slice(offset + match.length))
      ) {
        return match;
      }
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
  if (ANOTHER_NAMED_LAB.test(next)) return next;
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
  const recast = personLeadsTheirCollective(
    recastUnbackedLabSelfDescription(text, entity, field),
    entity,
  );
  if (recast === text || !BODY_FIELDS.has(field)) return recast;
  const recastWordCount = recast.split(/\s+/).filter(Boolean).length;
  return recastWordCount < SERVABLE_FULL_DESCRIPTION_MIN_WORDS ? text : recast;
}

const COLLECTIVE_NOUN = '(?:lab|laboratory|research group|group|team|research program|program)';
const PREDICATE_WORD =
  "(?!(?:an?|the|of|in|for|at|on|with|from|by|to|and|who|whom|whose|that|which|where)\\s)[\\p{L}'’-]+";
const ROLE_NOUN =
  '(?:director|manager|leader|lead|member|coordinator|head|chief|chair|founder|administrator|officer|scientist|fellow)s?';

/**
 * "<person> is a <kind> lab/group/team/program" says a person is a collective. It comes
 * from a first-person "We are a cancer immunology lab ..." revoiced onto the row's own
 * person, and from a recast "<Lab> is a ... research program". On a faculty research
 * row the person leads it, so that is what the sentence says instead.
 */
function personLeadsTheirCollective(
  text: string,
  entity: Record<string, any> | null | undefined,
): string {
  if (!text || !entity) return text;
  if (textValue(entity.entityType).toUpperCase() !== 'FACULTY_RESEARCH_AREA') return text;
  const person = facultyResearchPersonName(entity);
  if (!person) return text;
  return text.replace(
    new RegExp(
      `(^|[.!?]\\s+)(${escapeRegExp(person)}) is (an?) ((?:${PREDICATE_WORD}\\s+){0,4})(${COLLECTIVE_NOUN})(?![\\p{L}'’-])(?!\\s+${ROLE_NOUN}(?![\\p{L}'’-]))`,
      'gu',
    ),
    '$1$2 leads $3 $4$5',
  );
}

export interface OwnLabEvidence {
  /** "<surname> Lab", carrying any lowercase particle ("van Okonkwo Lab"). */
  surnameLabName: string;
  /** The lab-named host labels and path segments that carry the evidence, letters only. */
  labUrlTokens: string[];
}

function surnamePhrase(person: string): string {
  const tokens = personTokens(person);
  const particle = new RegExp(`^${SURNAME_PARTICLE}$`);
  let start = tokens.length - 1;
  while (start > 0 && particle.test(tokens[start - 1])) start -= 1;
  return tokens.slice(start).join(' ');
}

/**
 * The lab-named host labels and path segments of a URL, letters only. A bare lab segment
 * is joined to the one after it ("/lab/<surname>/" yields "lab<surname>"), so a cited
 * site and a lab row's own site yield the same token for the same lab.
 */
export function labNamedUrlTokens(value: unknown): string[] {
  try {
    const url = new URL(textValue(value));
    const parts = [...url.hostname.split('.'), ...url.pathname.split('/')]
      .map(letters)
      .filter(Boolean);
    const bareLab = new RegExp(`^${LAB_TOKEN}$`);
    return parts.flatMap((part, index) => {
      if (bareLab.test(part)) return parts[index + 1] ? [`${part}${parts[index + 1]}`] : [];
      return new RegExp(LAB_TOKEN).test(part) && part.length > 4 ? [part] : [];
    });
  } catch {
    return [];
  }
}

function labUrlTokens(value: unknown, person: string): string[] {
  return urlNamesThisPersonsLab(value, person) ? labNamedUrlTokens(value) : [];
}

/**
 * The evidence that this person runs a lab of their own, or null.
 *
 * Two kinds count: a cited site whose host or path puts "lab" beside this person's
 * surname, or a description whose recorded, non-LLM source names "<surname> Lab" for this
 * person. A field with no recorded source is not evidence, because nothing says who wrote
 * it, and the full-name form never is (#4707).
 */
export function ownLabEvidence(
  entity: Record<string, any> | null | undefined,
  person: string,
): OwnLabEvidence | null {
  if (!entity || !person) return null;
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  const tokens = [...new Set(urls.flatMap((url) => labUrlTokens(url, person)))];
  const officialTextNamesTheLab = DESCRIPTION_FIELDS.some((field) => {
    const sourceName = textValue(entity.fieldProvenance?.[field]?.sourceName);
    if (!sourceName || isLlmAuthoredSourceName(sourceName)) return false;
    return [...textValue(entity[field]).matchAll(namedLabPattern(person, 'g'))].some(
      (match) => runNamesOnlyThisPerson(match[2], person) && !isFullNameLabForm(match[2], person),
    );
  });
  if (!tokens.length && !officialTextNamesTheLab) return null;
  return { surnameLabName: `${surnamePhrase(person)} Lab`, labUrlTokens: tokens };
}

/**
 * Whether a lab row's name is the lead's full name plus "Lab" with no lab-named site to
 * back it, which is a name a lane composed rather than read.
 *
 * Lanes mint "<given names> <surname> Lab" whenever a profile's website slot is filled,
 * whatever the slot links, and the description lanes repeat the row's own heading, so a
 * live observation carrying this form is not evidence that the lab exists. The same
 * reasoning that keeps the full-name form out of descriptions (#4707) applies to the
 * heading. A cited site whose host or path is lab-named still backs the row, whoever's
 * name the site carries, because the lab then exists under some name.
 */
export function isComposedFullNameLabName(
  entity: Record<string, any> | null | undefined,
  leadPersonName: unknown,
): boolean {
  if (!entity) return false;
  const person = textValue(leadPersonName);
  const run = textValue(entity.name || entity.displayName).replace(/\s+Lab(?:oratory)?$/i, '');
  if (!person || !run || run === textValue(entity.name || entity.displayName)) return false;
  const runTokens = personTokens(run);
  if (runTokens.length < 2 || !runNamesOnlyThisPerson(run, person)) return false;
  if (runTokens[0].toLowerCase() !== personTokens(person)[0]?.toLowerCase()) return false;
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  return !urls.some((url) => urlNamesALab(url, person));
}

/**
 * A path segment naming a plural of labs under another word and none of the person's names
 * ("/faculty-labs") is a listing of many labs, which proves no lab of this person's.
 */
function urlNamesALab(value: unknown, person: string): boolean {
  try {
    const url = new URL(textValue(value));
    const nameTokens = personTokens(person)
      .map(letters)
      .filter((token) => token.length >= 2);
    const strippableNameTokens = nameTokens.filter((token) => token.length >= 3);
    const endsInLab = new RegExp(`${LAB_TOKEN}$`);
    const withoutName = (part: string) =>
      strippableNameTokens.reduce((rest, token) => rest.replace(token, ''), part);
    const hostParts = url.hostname.split('.').map(letters).filter(Boolean);
    const pathParts = url.pathname.split('/').map(letters).filter(Boolean);
    const labRightAfterName = nameTokens.map((token) => new RegExp(`${token}${LAB_TOKEN}`));
    const isListingOfLabs = (part: string) => {
      const before = /^(.+)labs$/.exec(part)?.[1];
      return before !== undefined && !nameTokens.some((token) => before.includes(token));
    };
    if (
      hostParts.some(
        (part) =>
          endsInLab.test(withoutName(part)) ||
          labRightAfterName.some((pattern) => pattern.test(part)),
      )
    ) {
      return true;
    }
    return pathParts.some((part) => endsInLab.test(withoutName(part)) && !isListingOfLabs(part));
  } catch {
    return false;
  }
}

/**
 * Whether a `LAB` row's own lab name is backed by a recorded, non-LLM description that
 * names it, read off the row's name. The gate's `unbacked_lab_name` predicate reads this
 * so a row retyped on that evidence is not held, and re-derived back, on the next pass.
 */
export function labNameBackedByOwnOfficialText(entity: Record<string, any>): boolean {
  const person = textValue(entity.name || entity.displayName).replace(/\s+Lab(?:oratory)?$/i, '');
  if (!person || person === textValue(entity.name || entity.displayName)) return false;
  const evidence = ownLabEvidence(
    { ...entity, websiteUrl: undefined, website: undefined, sourceUrls: undefined },
    person,
  );
  return evidence !== null;
}
