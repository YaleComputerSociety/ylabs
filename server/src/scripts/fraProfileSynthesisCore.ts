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
 * Ranking below 0.55 is only survivable because `confidenceResolver` demotes
 * bio-shaped `fullDescription` values whenever a useful non-bio alternative
 * exists. Weight alone would leave this lane unable to displace the very
 * biography it exists to replace, since that bio is re-emitted weekly at 0.55.
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

/**
 * A bare `/(?<=[.!?])\s+/` split cuts "the epidemiology of HIV in the U.S. and
 * develop statistical methods" into two sub-floor fragments and drops both, so a
 * page whose only research sentence contains an abbreviation ("U.S.",
 * "M. tuberculosis", "Dr. Smith") reports zero snippets. A boundary therefore
 * needs both a non-abbreviation left side and a sentence-opening right side.
 */
const SENTENCE_BOUNDARY =
  /(?<!\b(?:[A-Z]|Dr|Mr|Ms|Mrs|Prof|St|Jr|Sr|vs|no|al|e\.g|i\.e|approx|Fig|eds?)\.)(?<=[.!?])\s+(?=["'“‘(]?[A-Z])/;

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

const RESIDUAL_PRONOUN_LEAD = /^(?:he|she|they|his|her|their|him|hers|theirs)\b/i;

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
 */
export function hasResidualPronounLead(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
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
