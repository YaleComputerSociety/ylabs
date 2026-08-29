/**
 * Pure logic for the FRA profile-synthesis lane.
 *
 * A FACULTY_RESEARCH_AREA usually has no lab site, so its only source is the
 * professor's Yale profile page, whose main prose block is a biography. The
 * description extractor requires an exact contiguous substring, so on a page
 * where research is interleaved with credentials the only copyable span is
 * bio-shaped. That is why 464 served FRA descriptions read as person bios: not a
 * ranking bug, a structural limit of copying.
 *
 * A probe of 27 such profile pages found research prose on 27 of 27 while the
 * deterministic extractor produced prose on 0 of 27. The content is present and
 * unreachable by extraction, so this lane synthesizes it instead, reusing
 * `synthesizeCoverageDescription` so the existing overlap and quality gates apply
 * unchanged.
 *
 * Grants cannot serve this cohort: only 12 of the 464 have any grant at all, so
 * the #2191 grant-corpus lane reaches 3% of it.
 */
import { isHighConfidencePersonBio } from '../utils/researchHomeDescriptionSelection';
import { MAX_COVERAGE_SNIPPETS, MAX_COVERAGE_SNIPPET_CHARS } from '../scrapers/coverageSynthesis';
import type { CoverageSnippet } from '../scrapers/coverageSynthesis';
import {
  assertScraperEnvironmentMatchesMongoTarget,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';

export const FRA_PROFILE_SYNTHESIS_SOURCE_NAME = 'fra-profile-research-synthesis';

/**
 * Above the grant-corpus lane (0.45) because a professor's own profile page is a
 * better authority on their research than an aggregate of grant abstracts, and
 * below official-profile extraction (0.55) so a genuine verbatim research
 * statement still wins when one exists.
 *
 * Ranking below 0.55 is only survivable because `confidenceResolver` sorts
 * bio-shaped `fullDescription` values last once this lane has recorded a useful
 * research description (`BIO_REPLACING_DESCRIPTION_SOURCES` names it there).
 * Weight alone would leave this lane unable to displace the very biography it
 * exists to replace, since that bio is re-emitted weekly at 0.55.
 */
export const FRA_PROFILE_SYNTHESIS_CONFIDENCE = 0.48;

const RESEARCH_SENTENCE =
  /\b(we\s|our\s|research|stud(?:y|ies|ying)|investigat|explor|examin|focus(?:es|ed)?\s+on|interested\s+in|develop|mechanism|analy[sz])/i;

/**
 * Credential and career sentences are dropped from the snippets rather than left
 * for the model to ignore. Feeding them in is how a synthesis run reproduces the
 * bio it exists to replace.
 */
const CAREER_SENTENCE =
  /\b(?:received|earned|obtained|completed)\s+(?:his|her|their|a|an)\b|\bjoined\s+(?:the\s+)?Yale\b|\bbefore\s+(?:coming|joining)\b|\bB\.?A\.?\b|\bM\.?D\.?\b|\bPh\.?D\.?\b|\bresidency\b|\bfellowship\s+at\b|\bwas\s+(?:appointed|named)\b|\bis\s+the\s+recipient\b|\bwas\s+awarded\b/i;

/**
 * Site navigation flattens into the page text as long runs of link labels, and a
 * run of them can otherwise clear the sentence-length floor and reach the model
 * as if it were prose.
 */
const NAV_CHROME_RUN =
  /\b(?:YSM Home|INFORMATION FOR|Find People|Organization Charts|Chair Searches|Leadership Searches|Departments & Centers|Volunteer to Help|Donate Blood|Skip to (?:main|content))\b/i;

const MIN_SENTENCE_CHARS = 60;
const MAX_SENTENCE_CHARS = 600;

/**
 * One snippet is enough to attempt synthesis.
 *
 * Requiring two looked prudent, since both residual bio-shaped outputs in the
 * A/B came from one-snippet pages. But a dry run showed the threshold skipping
 * 6 of 12 entities, most of which had synthesized cleanly, so it discarded more
 * good coverage than bad output. The precise control is the post-synthesis check
 * that rejects text still reading as a biography, which catches the same two
 * cases without penalising a thin page that summarises well. Keep the specific
 * gate, not the proxy.
 */
export const MIN_SNIPPETS_TO_SYNTHESIZE = 1;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const PRONOUN_SUBJECT = 'he|she|they|his|her|their|him|hers|theirs';
const CAPITALIZED_PRONOUN_SUBJECT = 'He|She|They|His|Her|Their|Him|Hers|Theirs';

/**
 * A bare `/(?<=[.!?])\s+/` split cuts "the epidemiology of HIV in the U.S. and
 * develop statistical methods" into two sub-floor fragments and drops both, so a
 * page whose only research sentence contains an abbreviation ("U.S.",
 * "M. tuberculosis", "Dr. Smith") reports zero snippets. A boundary therefore
 * needs both a non-abbreviation left side and a sentence-opening right side.
 *
 * The second alternative exists because the single-capital abbreviation guard
 * also suppresses the boundary after ordinary biomedical prose ending in a
 * letter-suffixed term: "the immunology of hepatitis C. She directs ..." stayed
 * one sentence, which hid the orphan pronoun from both the repair pass and the
 * residual check. No abbreviation is ever followed by a capitalised pronoun, so
 * that right-hand side is always a real sentence start.
 */
const SENTENCE_BOUNDARY = new RegExp(
  '(?<!\\b(?:[A-Z]|Dr|Mr|Ms|Mrs|Prof|St|Jr|Sr|vs|no|al|e\\.g|i\\.e|approx|Fig|eds?)\\.)' +
    '(?<=[.!?])\\s+(?=["\'“‘(]?[A-Z])' +
    `|(?<=[.!?])\\s+(?=(?:${CAPITALIZED_PRONOUN_SUBJECT})\\b)`,
);

export function splitSentences(value: string): string[] {
  return value
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function profileResearchSentences(pageText: string): string[] {
  return splitSentences(textValue(pageText))
    .map((sentence) => textValue(sentence))
    .filter(
      (sentence) =>
        sentence.length >= MIN_SENTENCE_CHARS &&
        sentence.length <= MAX_SENTENCE_CHARS &&
        RESEARCH_SENTENCE.test(sentence) &&
        !CAREER_SENTENCE.test(sentence) &&
        !NAV_CHROME_RUN.test(sentence),
    );
}

/**
 * Grouped into paragraph-sized snippets so the synthesizer sees connected
 * reasoning rather than a bag of disconnected clauses.
 */
export function profileResearchSnippets(
  pageText: string,
  sourceUrl: string,
  sourceName: string = FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
): CoverageSnippet[] {
  const sentences = profileResearchSentences(pageText);
  const snippets: CoverageSnippet[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    if (!buffer.length) return;
    snippets.push({ text: buffer.join(' '), sourceUrl, sourceName });
    buffer = [];
  };
  for (const sentence of sentences) {
    if (snippets.length >= MAX_COVERAGE_SNIPPETS) break;
    if ([...buffer, sentence].join(' ').length > MAX_COVERAGE_SNIPPET_CHARS && buffer.length) {
      flush();
    }
    buffer.push(sentence);
  }
  if (snippets.length < MAX_COVERAGE_SNIPPETS) flush();
  return snippets;
}

/**
 * `isHighConfidencePersonBio` is the right check on this lane's OUTPUT (we want no
 * person-voiced prose at all in a synthesized description) but the wrong check for
 * deciding which entities to REWRITE. It fires on name-framed research prose,
 * which is perfectly good content: "Dr. Sauler's research investigates mechanisms
 * of lung injury and cytoprotection in chronic lung disease" is exactly what a
 * student needs and must never be replaced.
 *
 * Measured on the served corpus, that detector over-reports roughly four to one:
 * of 155 org-type entities it flags, only 35 are genuine biographies. Scoping a
 * rewrite lane to it caused a real regression on Development — alfred-lee's
 * correct "research focuses on classical hematology, particularly thrombosis" was
 * replaced by one paper's narrow topic ("hematology consultation patterns in
 * intensive care units") — and 99 such rewrites had to be reverted.
 *
 * A career biography is identified by career facts, not by mentioning a person:
 * where they trained, what they were appointed to, what they have been awarded.
 */
// Specialist role nouns are open-ended (immunologist, nephrologist, geneticist,
// ...), so an explicit list always misses one: "Dr. Avery Lin is an immunologist
// at Yale University" slipped through a hand-enumerated version. Matched by
// morphology instead, plus the titles that carry no such suffix.
const CAREER_ROLE_NOUN =
  '\\w*(?:ologist|ologists|iatrist|iatrician|ician|icist|ist|ian)|professor|lecturer|instructor|surgeon|chair|chief|dean|director|attending|fellow';

// Deliberately NOT a marker: teaching, mentoring, and advising verbs. They read
// like career duties but fire on good organization prose that merely lists
// activities after leading with research ("YCEC conducts research on the
// psychological, cultural, and political factors ...; teaches students and trains
// working professionals"). Every genuine bio opener they would have caught is
// already caught by the role-noun marker ("Dr. Avery Lin is an immunologist ...
// where she teaches").
const CAREER_BIOGRAPHY_MARKERS: readonly RegExp[] = [
  // Training and degrees: no research description says who granted a degree.
  // Spelled-out degrees matter as much as abbreviations: "received his
  // undergraduate degree at Fairfield University" carries no "B.A." token.
  /\b(?:received|earned|obtained|completed|holds?)\s+(?:his|her|their|an?|the)\s+[^.]{0,40}\b(?:B\.?A\.?|B\.?S\.?|M\.?A\.?|M\.?S\.?|M\.?D\.?|Ph\.?D\.?|J\.?D\.?|M\.?P\.?H\.?|degrees?|doctorate|diploma|residency|fellowship|postdoc(?:toral)?|training)\b/i,
  /\bsubspecialty\s+training\s+in\b/i,
  // Appointment and tenure history.
  /\bjoined\s+(?:the\s+)?(?:Yale|faculty|department|university)\b/i,
  /\bbefore\s+(?:coming|joining|arriving)\b/i,
  /\bwas\s+(?:appointed|named|promoted|recruited)\b/i,
  // "holds a joint appointment", but also "with a secondary appointment as ...".
  /\b(?:holds?|with|has)\s+(?:a\s+)?(?:joint|secondary|primary|additional|courtesy)\s+appointment\b/i,
  new RegExp(
    `\\bis\\s+(?:currently\\s+)?(?:an?|the)?\\s*[^.]{0,60}\\b(?:${CAREER_ROLE_NOUN})\\b`,
    'i',
  ),
  // An endowed chair ("is William K. Townsend Professor of Law"). The initials
  // carry periods, so the span above stops at "K." and never reaches the title;
  // this matches the capitalized chair name directly instead.
  /\bis\s+(?:the\s+)?[A-Z][\w'’-]*\.?(?:\s+[A-Z][\w'’-]*\.?){0,4}\s+(?:Professor|Chair|Fellow)\b/,
  new RegExp(`\\bserved?\\s+as\\s+(?:an?|the)?\\s*[^.]{0,40}\\b(?:${CAREER_ROLE_NOUN})\\b`, 'i'),
  // Honours and recognition.
  /\bis\s+the\s+recipient\s+of\b/i,
  /\bwas\s+awarded\s+the\b/i,
  /\belected\s+to\s+the\b/i,
  /\bis\s+(?:one\s+of\s+)?the\s+nation['’]s\s+(?:foremost|leading)\b/i,
];

/**
 * Career markers are matched against the OPENING only, not the whole passage.
 *
 * The defect is a biography *displacing* the research, and a career bio always
 * leads with career facts. Scanning the full text instead flags descriptions that
 * merely mention an affiliation in passing: "PittLab studies the contributions of
 * the basal ganglia to normal behavior and to neuropsychiatric disease" and "The
 * Thinking Lab is directed by Woo-kyoung Ahn, Professor of Psychology" are both
 * good copy that a whole-text scan rejected.
 *
 * Two sentences, because the common shape is a one-line credential followed by a
 * second career sentence before any research ("Dr Mirza is a physician-scientist.
 * He is a practicing pathologist with subspecialty training in GI & Liver
 * Pathology. In his laboratory he studies ...").
 */
const CAREER_MARKER_SENTENCE_WINDOW = 2;

/**
 * The role-noun and endowed-chair markers key on "is ... Professor", but that
 * clause belongs to an organization rather than a person in "The Thinking Lab is
 * directed by Woo-kyoung Ahn, Professor of Psychology". A description whose
 * subject is the research home is describing the home, so naming its director's
 * title does not make it a biography.
 */
const ORG_SUBJECT_LEAD =
  /^(?:welcome\s+to\s+)?(?:the\s+)?[^.]{0,80}\b(?:lab|laborator(?:y|ies)|cent(?:er|re)|institute|program(?:me)?|initiative|group|project|clinic|core|facility|consortium|network)\b[^.]{0,20}\b(?:is|are|was|were)\b/i;

const LED_BY_CONSTRUCTION = /\bis\s+(?:directed|led|headed|chaired|co-directed)\s+by\b/i;

export function isCareerBiographyDescription(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  const opening = splitSentences(text).slice(0, CAREER_MARKER_SENTENCE_WINDOW).join(' ');
  if (!opening) return false;
  if (LED_BY_CONSTRUCTION.test(opening) || ORG_SUBJECT_LEAD.test(opening)) return false;
  return CAREER_BIOGRAPHY_MARKERS.some((marker) => marker.test(opening));
}

/**
 * Retained for the OUTPUT check only: a synthesized description must not read as
 * person prose at all. Do not use this to select entities to rewrite.
 */
export function isBioShapedFacultyDescription(value: unknown): boolean {
  const text = textValue(value);
  return text ? isHighConfidencePersonBio(text) : false;
}

/**
 * Deliberately an allowlist of research-activity verbs rather than any verb. A
 * general pattern would also rewrite a biographical clause ("She is a professor
 * of history") into a sentence that reads like a research claim, which is worse
 * than leaving the pronoun in place: the bio check downstream can still reject
 * the whole description, but it cannot un-launder a bio disguised as research.
 */
const RESEARCH_ACTIVITY_VERB =
  'investigates?|studies|study|examines?|explores?|researches?|analy[sz]es?|develops?|focuses|centers?|centres?|works|directs?|co-directs?|leads?|collaborates?|combines?|applies|employs|uses|builds?|designs?|models?|maintains?|oversees';

const PRONOUN_LEAD = new RegExp(
  `^(?:he|she|they|his|her|their)\\s+(${RESEARCH_ACTIVITY_VERB})\\b`,
  'i',
);

// The possessive form shares the verb allowlist rather than carrying a narrower
// copy of it: "Her group leads a national consortium" is the same orphan pronoun
// as "She leads ...", and a verb missing from only one of the two lists left the
// dangling subject in place (#2200).
const PRONOUN_POSSESSIVE_LEAD = new RegExp(
  `^(?:his|her|their)\\s+(?:research|work|lab|laboratory|group|team|program|programme|project)\\s+(${RESEARCH_ACTIVITY_VERB})\\b`,
  'i',
);

const RESIDUAL_PRONOUN_LEAD = new RegExp(`^(?:${PRONOUN_SUBJECT})\\b`, 'i');
const RESIDUAL_PRONOUN_AFTER_STOP = new RegExp(`(?<=[.!?])\\s+(?:${PRONOUN_SUBJECT})\\b`, 'i');

function repairSentencePronounLead(sentence: string): string {
  const possessive = sentence.match(PRONOUN_POSSESSIVE_LEAD);
  if (possessive) {
    return capitalize(`${possessive[1]} ${sentence.slice(possessive[0].length).trim()}`);
  }
  const lead = sentence.match(PRONOUN_LEAD);
  if (!lead) return sentence;
  return capitalize(`${lead[1]} ${sentence.slice(lead[0].length).trim()}`);
}

/**
 * A synthesized description that says "She investigates ..." has no antecedent on
 * a research card, which is the #1871 orphan-pronoun defect. The subject is
 * dropped rather than replaced with a name, matching how the rest of the corpus
 * reads ("Investigates ...", "Studies ..."), and this runs before the bio check
 * so a clean description is not rejected for its opening word alone.
 *
 * Every sentence is repaired, not just the first. Repairing only the lead left
 * "Investigates how ... . She directs a community-academic partnership ..." on a
 * real entity: the opening read correctly while the dangling pronoun simply moved
 * out of view of the check.
 */
export function repairPronounLead(value: unknown): string {
  const text = textValue(value);
  if (!text) return '';
  return splitSentences(text)
    .map((sentence) => repairSentencePronounLead(sentence))
    .filter(Boolean)
    .join(' ');
}

/**
 * The verb allowlist is deliberately incomplete, so repair cannot be the only
 * defence: any sentence still opening with a pronoun after repair is a dangling
 * reference on a research card, and `isHighConfidencePersonBio` only anchors that
 * check at the start of the whole description. The lane fails closed on this
 * rather than widening the allowlist into laundering a biography as research.
 *
 * Scanned over the raw text as well as the split sentences so this defence does
 * not silently depend on the splitter being perfect: a sentence boundary the
 * splitter misses must still fail closed rather than pass the dangling pronoun
 * through.
 */
export function hasResidualPronounLead(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  if (RESIDUAL_PRONOUN_AFTER_STOP.test(text)) return true;
  return splitSentences(text).some((sentence) => RESIDUAL_PRONOUN_LEAD.test(sentence));
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

export interface FraProfileSynthesisArgs {
  apply: boolean;
  confirm: boolean;
  limit: number;
  slugs: string[];
  output?: string;
}

export function parseFraProfileSynthesisArgs(argv: string[]): FraProfileSynthesisArgs {
  const args: FraProfileSynthesisArgs = { apply: false, confirm: false, limit: 0, slugs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--confirm-fra-profile-synthesis') args.confirm = true;
    else if (arg === '--limit') {
      const raw = argv[index + 1];
      index += 1;
      if (!raw || !/^\d+$/.test(raw)) throw new Error('--limit must be a non-negative integer');
      args.limit = Number(raw);
    } else if (arg === '--slug') {
      const raw = argv[index + 1];
      index += 1;
      if (!raw || raw.startsWith('--')) throw new Error('--slug requires a value');
      args.slugs.push(raw);
    } else if (arg === '--output') {
      const raw = argv[index + 1];
      index += 1;
      if (!raw || raw.startsWith('--')) throw new Error('--output requires a path');
      args.output = raw;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    }
  }
  return args;
}

export interface FraProfileSynthesisApplyTarget {
  environment: ScraperEnvironment;
  dbLabel: string;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Gated on the resolved environment plus the environment's configured database
 * name, never on the `dbLabel` text. That label is `${hostname}/${db}`, so a
 * substring match on it passes for a cluster host merely containing
 * "development" while pointing at Production, and fails for a Development
 * database renamed through SCRAPER_DEVELOPMENT_DB_NAME.
 */
export function assertFraProfileSynthesisApplyAllowed(
  args: FraProfileSynthesisArgs,
  target: FraProfileSynthesisApplyTarget,
): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(
      'research-entity:fra-profile-synthesis --apply requires --confirm-fra-profile-synthesis',
    );
  }
  if (target.environment !== 'development') {
    throw new Error(
      `research-entity:fra-profile-synthesis --apply is restricted to the Development environment (saw ${target.environment} targeting ${target.dbLabel})`,
    );
  }
  assertScraperEnvironmentMatchesMongoTarget({
    environment: target.environment,
    mongoUrl: target.mongoUrl,
    env: target.env,
  });
}
