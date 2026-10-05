import type { ResearchEntityType } from '../models/researchAccessTypes';
import axios from 'axios';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { openAiChatSampling } from '../utils/openAiChatSampling';
import {
  CARD_SYNTHESIS_MODEL,
  MAX_CARD_SOURCE_CHARS,
  cardGroundingScore,
} from '../utils/groundedCardSynthesis';
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { isSourcePageNarrationDescription } from '../utils/researchEntityDescriptionText';
import { isDescriptionGroundedInSource } from '../utils/officialResearchDescription';
import { isModelTextSource } from './sourceCoverageRegistry';
import { splitDescriptionSentences } from '../utils/careerBiographyDescription';
import { withoutUnsupportedMethodClauses } from '../utils/methodClauseSupport';
import { isRejectedDescriptionSourceUrl } from './sources/labMicrositeDescriptionLLMExtractor';
import { COVERAGE_SYNTHESIS_PROMPT } from './prompts';
import { WRITTEN_DESCRIPTION_SOURCE_NAME } from './confidenceResolver';

export { WRITTEN_DESCRIPTION_SOURCE_NAME };

export const COVERAGE_SYNTHESIS_MODEL = CARD_SYNTHESIS_MODEL;
export const COVERAGE_MIN_OVERLAP = 0.45;
export const COVERAGE_CONFIDENCE = 0.5;
export const MAX_COVERAGE_SNIPPETS = 12;
export const MAX_COVERAGE_SNIPPET_CHARS = 1200;
/**
 * The prompt asks for at most 70 words; the refusal sits above that so a model that
 * overshoots by a clause is not discarded, while the 120-word bodies the #4788 pilot
 * measured are.
 */
export const MAX_WRITTEN_DESCRIPTION_WORDS = 90;

export const COVERAGE_SNIPPET_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'shortDescription',
  'description',
  'summary',
  'bio',
  'researchInterestSummary',
  'researchSummary',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export interface CoverageSnippet {
  text: string;
  sourceUrl?: string;
  sourceName?: string;
}

export interface CoverageObservationLike {
  field: string;
  value: unknown;
  sourceUrl?: string;
  sourceName?: string;
  confidence?: number;
  scrapeRunId?: unknown;
  /**
   * The lane that wrote this value checked it against the page it fetched before storing
   * it (owner decision on #4867). Derived by `markIngestVerifiedObservations`, never by
   * the source name alone.
   */
  ingestVerifiedAgainstPage?: boolean;
}

const MANUAL_ADMIN_EDIT_SOURCE_NAME = 'manual-admin-edit';

/**
 * The text of a stored copy of the page an observation cites, when one exists.
 */
export type StoredPageTextLookup = (sourceUrl: string | undefined) => string | undefined;

/**
 * Whether one observation is evidence the writer may read.
 *
 * A written body is grounded only in text that is on a fetched page (#4867). A value a
 * language-model lane wrote is not page text, and reading it as evidence re-asserted an
 * earlier lane's invention as grounded, so such a value is evidence only when it is found
 * near-verbatim in a stored copy of the page it cites, or when the lane itself verified it
 * against its fetched page at ingest (`ingestVerifiedAgainstPage`). The writer's
 * own output is model text, so it is never its own input. A `manual-admin-edit`
 * description is ordinary evidence unless it narrates its sources (#4788).
 */
export function isWriterEvidenceObservation(
  obs: CoverageObservationLike,
  storedPageText: StoredPageTextLookup = () => undefined,
): boolean {
  if (obs.sourceName === WRITTEN_DESCRIPTION_SOURCE_NAME) return false;
  if (isModelTextSource(obs.sourceName)) {
    if (obs.ingestVerifiedAgainstPage === true) return true;
    const page = storedPageText(obs.sourceUrl);
    return Boolean(page) && isDescriptionGroundedInSource(obs.value, page);
  }
  if (
    obs.sourceName === MANUAL_ADMIN_EDIT_SOURCE_NAME &&
    isSourcePageNarrationDescription(obs.value)
  ) {
    return false;
  }
  return true;
}

export interface CoverageSynthesisLLMResult {
  fullDescription: string;
  usedSnippetIndexes: number[];
}

export type CoverageSynthesisLLMFn = (input: {
  snippets: CoverageSnippet[];
  entityName: string;
}) => Promise<CoverageSynthesisLLMResult>;

export function gatherCoverageSnippets(
  observations: CoverageObservationLike[],
  storedPageText?: StoredPageTextLookup,
): CoverageSnippet[] {
  const seen = new Set<string>();
  const snippets: CoverageSnippet[] = [];
  for (const obs of observations) {
    if (!COVERAGE_SNIPPET_FIELDS.has(obs.field)) continue;
    if (!isWriterEvidenceObservation(obs, storedPageText)) continue;
    if (isRejectedDescriptionSourceUrl(obs.sourceUrl)) continue;
    const raw = textValue(obs.value);
    if (!raw) continue;
    const clean = redactDirectContactInfo(raw).slice(0, MAX_COVERAGE_SNIPPET_CHARS).trim();
    if (clean.length < 20) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push({ text: clean, sourceUrl: obs.sourceUrl, sourceName: obs.sourceName });
    if (snippets.length >= MAX_COVERAGE_SNIPPETS) break;
  }
  return snippets;
}

export interface SynthesizeCoverageInput {
  snippets: CoverageSnippet[];
  entityName: string;
  entityType?: ResearchEntityType;
  researchAreas?: unknown;
  callLLM: CoverageSynthesisLLMFn;
}

export interface CoverageSynthesisResult {
  description: string;
  usedSnippetIndexes: number[];
  sourceUrls: string[];
}

/**
 * Why a synthesis was discarded, or `null` when it was kept.
 *
 * Reported rather than collapsed to a null, because a refusal count is only usable
 * as an audit while every refusal names its own cause (#3068). A single
 * "failed closed (grounding or quality gate)" label covered all eight arms below,
 * and #1878 recorded 40 rows under it as "refused by the synthesizer's own gates"
 * when two of the arms are not gates at all: `llm-call-failed` and
 * `llm-malformed-response` mean the row was never judged.
 */
export type CoverageSynthesisRefusal =
  | 'no-snippets'
  | 'llm-call-failed'
  | 'llm-malformed-response'
  | 'empty-description'
  | 'no-cited-snippets'
  | 'grounding-overlap-below-floor'
  | 'quality-bar'
  | 'internal-vocabulary'
  | 'past-career-clause'
  | 'teaser-attribution'
  | 'unsupported-method-clause'
  | 'source-narration'
  | 'over-length';

/**
 * The verbs a synthesized body uses of its subject. Shared with the two internal
 * vocabulary patterns below rather than copied, for the #2200 reason: a verb present
 * in one list and missing from the other leaves the defect in place on half its forms.
 */
const SYNTHESIS_SUBJECT_VERB =
  'investigates?|studies|study|examines?|explores?|researches?|analy[sz]es?|develops?|designs?|builds?|models?|measures?|applies|employs|uses|combines?|focuses|centers?|centres?|works|leads?|directs?|maintains?|oversees|conducts?|supports?|characteri[sz]es?';

/**
 * A body whose grammatical SUBJECT is one of the repo's own nouns for a stored
 * record: "The entity studies melanocytic neoplasms ..." (#3217).
 *
 * Anchored on subject position and a following research verb, NOT a bare word ban,
 * because every noun in the set is also ordinary research prose somewhere in this
 * corpus. `entity` is a term of art in NLP ("named entity recognition"), `record`
 * appears in "electronic health records" and "the fossil record", and `document`
 * appears in document classification. Refusing those as internal vocabulary would
 * discard correct bodies to prevent a wording defect, which is the wrong trade.
 *
 * `row` is in the set even though no observed body used it, because it is what this
 * corpus calls a research_entities document in its own issues and commit messages and
 * is the likeliest next leak. Generic-but-valid English subjects are deliberately NOT
 * here: "The research examines ..." and "The research program studies ..." both read
 * flat next to the corpus convention of a bare verb lead, but they are true and
 * student-readable, so they are a copy preference rather than a defect to fail closed on.
 */
const INTERNAL_RECORD_NOUN_SUBJECT = new RegExp(
  `(?:^|[.!?]\\s+)(?:the|this)\\s+(?:research\\s+)?(?:entit(?:y|ies)|rows?|records?|documents?)\\s+(?:${SYNTHESIS_SUBJECT_VERB})\\b`,
  'i',
);

/**
 * Retired product vocabulary, matched anywhere rather than in subject position.
 *
 * AGENTS.md retires "research home" and "research area" in copy outright, and
 * `client/src/__tests__/deprecatedVocabularyGuard.test.ts` already enforces that on
 * the copy the repo hand-writes. A synthesized body is copy this product authors, so
 * the same rule applies to it; the client guard cannot see it because the text is
 * generated at scrape time rather than committed.
 *
 * The pattern is the client guard's, deliberately character for character: whitespace
 * between the two words is required, so the stored field name `researchAreas` and the
 * identifier `researchHome` never match. Only prose does.
 */
const DEPRECATED_PRODUCT_VOCABULARY = /research\s+(?:home|area)s?\b/i;

const TRAINING_STAGE =
  '(?:postdoctoral|post-doctoral|doctoral|dissertation|graduate|ph\\.?\\s?d\\.?)';

const PAST_CAREER_VERB =
  '(?:led|developed|served|worked|directed|held|founded|co-founded|headed|chaired|ran|managed|was|were|built|taught|trained|launched)';

/**
 * Anchored on the clause's subject position rather than on the adverb, because
 * "previously" is ordinary research prose: "combines new and previously developed
 * methods" and "previously uncharacterized genes" must survive. The clause counts at a
 * sentence start, after a subject pronoun, or after a clause break.
 */
const PAST_CAREER_CLAUSE = new RegExp(
  [
    `^(?:previously|formerly)(?:,|\\s+${PAST_CAREER_VERB}\\b)`,
    `\\b(?:he|she|they|who)\\s+(?:also\\s+)?(?:previously|formerly)\\s+${PAST_CAREER_VERB}\\b`,
    `[;,]\\s*(?:and\\s+)?(?:previously|formerly)\\s+${PAST_CAREER_VERB}\\b`,
    '\\b(?:before|prior\\s+to)\\s+(?:joining|coming\\s+to|arriving\\s+at|moving\\s+to)\\b',
    '\\bearlier\\s+in\\s+(?:his|her|their)\\s+career\\b',
    `\\b(?:as|while)\\s+an?\\s+${TRAINING_STAGE}\\s+(?:fellow|researcher|student|scholar|trainee|resident)\\b`,
    `\\bduring\\s+(?:his|her|their)\\s+(?:${TRAINING_STAGE}|residency|fellowship)\\b`,
    `\\b(?:his|her)\\s+${TRAINING_STAGE}\\s+(?:work|research|training|studies|project)\\b`,
  ].join('|'),
  'i',
);

export function isPastCareerClauseSentence(sentence: string): boolean {
  return PAST_CAREER_CLAUSE.test(sentence);
}

/**
 * The body with every sentence that narrates a past post removed, or `null` when
 * nothing else is left. A sentence is dropped whole rather than trimmed to its clause,
 * because the clause carries the sentence's subject and a trimmed remainder reads as
 * a fragment.
 */
export function withoutPastCareerSentences(description: string): string | null {
  return withoutUnsupportedSentences(description).description;
}

/**
 * Content a page shows about something else: a featured item, a journal issue on a home
 * page, a related unit's teaser card or a carousel slide (#4867). Attributing it to the
 * row is the cross-unit defect, so a sentence that names that framing is dropped whole.
 */
const TEASER_ATTRIBUTION = new RegExp(
  [
    '\\bfeatured\\s+(?:in|on|issue|article|story|stories|project|projects|item|items)\\b',
    '\\b(?:current|latest|recent|featured)\\s+issue\\s+of\\b',
    '\\brelated\\s+(?:centers?|centres?|institutes?|programs?|programmes?|labs?|laboratories|units?|groups?)\\b',
    '\\b(?:carousel|slideshow)\\b',
  ].join('|'),
  'i',
);

export function isTeaserAttributionSentence(sentence: string): boolean {
  return TEASER_ATTRIBUTION.test(sentence);
}

export interface UnsupportedSentenceStrip {
  description: string | null;
  refusal?: Extract<CoverageSynthesisRefusal, 'past-career-clause' | 'teaser-attribution'>;
}

/**
 * The body with every past-post and teaser-attribution sentence removed. When nothing
 * is left the refusal names the shape that the last dropped sentence carried, past
 * career first, so each arm keeps the attribution it had.
 */
export function withoutUnsupportedSentences(description: string): UnsupportedSentenceStrip {
  const sentences = splitDescriptionSentences(description);
  const pastCareer = sentences.some(isPastCareerClauseSentence);
  const kept = sentences.filter(
    (sentence) => !isPastCareerClauseSentence(sentence) && !isTeaserAttributionSentence(sentence),
  );
  if (kept.length === sentences.length) return { description };
  const joined = kept.join(' ').trim();
  if (joined) return { description: joined };
  return {
    description: null,
    refusal: pastCareer ? 'past-career-clause' : 'teaser-attribution',
  };
}

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export function hasInternalVocabulary(value: unknown): boolean {
  const text = textValue(value);
  if (!text) return false;
  return INTERNAL_RECORD_NOUN_SUBJECT.test(text) || DEPRECATED_PRODUCT_VOCABULARY.test(text);
}

export interface CoverageSynthesisDecision {
  result: CoverageSynthesisResult | null;
  refusal: CoverageSynthesisRefusal | null;
}

/**
 * Fuse thin/alternate evidence snippets into one description via the LLM, then
 * FAIL CLOSED: the result is discarded unless its distinctive tokens are grounded
 * in the snippet corpus at `COVERAGE_MIN_OVERLAP`, it cites real snippets, and it
 * clears the description-quality bar. Contact data is redacted on the way in and
 * out, so a coverage description can never leak or invent PII.
 *
 * Grounding is asked ONCE, by `cardGroundingScore` against `COVERAGE_MIN_OVERLAP`.
 * There used to be a second arm, `isUngroundedSynthesizedCard(description, corpus)`,
 * which re-asked the same question through a predicate contracted for a one-sentence
 * card: its synthesis-verb gate matches nearly every output of this prompt, which asks
 * for third-person research prose, and behind that gate it requires
 * `MIN_CARD_GROUNDING` (0.9) instead of the 0.45 declared here. The effect was a 0.9
 * floor nobody chose for a 2-to-4-sentence body, on the one arm of eight that reported
 * as a quality verdict; it accounted for 28 of #1878's 40 refusals (#3201).
 *
 * The refusing arm is produced HERE rather than by a caller re-deriving it, because
 * a re-derivation drifts from this function the moment an arm moves and then
 * attributes refusals to gates that did not fire (#3068).
 */
export async function coverageSynthesisDecision(
  input: SynthesizeCoverageInput,
): Promise<CoverageSynthesisDecision> {
  const refuse = (refusal: CoverageSynthesisRefusal): CoverageSynthesisDecision => ({
    result: null,
    refusal,
  });
  const { snippets } = input;
  if (snippets.length === 0) return refuse('no-snippets');

  let raw: CoverageSynthesisLLMResult;
  try {
    raw = await input.callLLM({ snippets, entityName: input.entityName });
  } catch {
    return refuse('llm-call-failed');
  }
  if (!raw || typeof raw !== 'object') return refuse('llm-malformed-response');

  const drafted = redactDirectContactInfo(textValue(raw.fullDescription));
  if (!drafted) return refuse('empty-description');
  const stripped = withoutUnsupportedSentences(drafted);
  if (!stripped.description) return refuse(stripped.refusal ?? 'past-career-clause');
  const methodChecked = withoutUnsupportedMethodClauses(
    stripped.description,
    snippets.map((snippet) => snippet.text),
  ).text;
  const description = methodChecked ?? stripped.description;

  const usedSnippetIndexes = Array.isArray(raw.usedSnippetIndexes)
    ? raw.usedSnippetIndexes.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < snippets.length,
      )
    : [];
  if (usedSnippetIndexes.length === 0) return refuse('no-cited-snippets');

  const corpus = snippets.map((snippet) => snippet.text).join(' \n ');
  if (cardGroundingScore(description, corpus) < COVERAGE_MIN_OVERLAP) {
    return refuse('grounding-overlap-below-floor');
  }
  // Before the quality bar, which blanks the same shape through the serve sanitizer and
  // would otherwise report a narrating body as a generic quality verdict.
  if (isSourcePageNarrationDescription(description)) return refuse('source-narration');
  if (!fullDescriptionQuality(description, input.researchAreas, input.entityType).isUseful) {
    return refuse('quality-bar');
  }
  // After the older arms, so every arm above keeps the attribution it had and each
  // count below is exactly the bodies that would otherwise have been ACCEPTED. A refusal
  // placed earlier would absorb rows another gate was already refusing and overstate
  // itself, which is the #2440 shape of a counter that misreports its own outcome.
  if (hasInternalVocabulary(description)) return refuse('internal-vocabulary');
  if (wordCount(description) > MAX_WRITTEN_DESCRIPTION_WORDS) return refuse('over-length');
  if (!methodChecked) return refuse('unsupported-method-clause');

  const sourceUrls = Array.from(
    new Set(
      usedSnippetIndexes
        .map((index) => snippets[index].sourceUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  );
  return { result: { description, usedSnippetIndexes, sourceUrls }, refusal: null };
}

const LLM_FAILURE_REFUSALS: ReadonlySet<CoverageSynthesisRefusal> = new Set([
  'llm-call-failed',
  'llm-malformed-response',
]);

export const isCoverageSynthesisLlmFailure = (
  refusal: CoverageSynthesisRefusal | null | undefined,
): boolean => !!refusal && LLM_FAILURE_REFUSALS.has(refusal);

export const COVERAGE_SYNTHESIS_LLM_FAILED_SKIP = 'synthesis-llm-failed';
export const COVERAGE_SYNTHESIS_REFUSED_SKIP = 'synthesis-failed-quality-gate';

export const coverageSynthesisSkipReason = (refusal: CoverageSynthesisRefusal): string =>
  isCoverageSynthesisLlmFailure(refusal)
    ? COVERAGE_SYNTHESIS_LLM_FAILED_SKIP
    : COVERAGE_SYNTHESIS_REFUSED_SKIP;

export interface CoverageSynthesisRefusalCounts {
  llmFailures: number;
  refusedByContent: number;
  byRefusal: Partial<Record<CoverageSynthesisRefusal, number>>;
}

export function countCoverageSynthesisRefusals(
  refusals: ReadonlyArray<CoverageSynthesisRefusal | null | undefined>,
): CoverageSynthesisRefusalCounts {
  const counts: CoverageSynthesisRefusalCounts = {
    llmFailures: 0,
    refusedByContent: 0,
    byRefusal: {},
  };
  for (const refusal of refusals) {
    if (!refusal) continue;
    counts.byRefusal[refusal] = (counts.byRefusal[refusal] ?? 0) + 1;
    if (isCoverageSynthesisLlmFailure(refusal)) counts.llmFailures += 1;
    else counts.refusedByContent += 1;
  }
  return counts;
}

export async function synthesizeCoverageDescription(
  input: SynthesizeCoverageInput,
): Promise<CoverageSynthesisResult | null> {
  return (await coverageSynthesisDecision(input)).result;
}

export function defaultCoverageSynthesisLLM(
  apiKey: string,
  model: string = COVERAGE_SYNTHESIS_MODEL,
): CoverageSynthesisLLMFn {
  return async ({ snippets, entityName }) => {
    const safeName = redactDirectContactInfo(entityName).slice(0, 240);
    const snippetBlock = snippets
      .map((snippet, index) => `[${index}] (${snippet.sourceName ?? 'source'}) ${snippet.text}`)
      .join('\n')
      .slice(0, MAX_CARD_SOURCE_CHARS * 2);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        response_format: { type: 'json_object' },
        ...openAiChatSampling(model),
        messages: [
          { role: 'system', content: COVERAGE_SYNTHESIS_PROMPT },
          {
            role: 'user',
            content: [`Research entity: ${safeName}`, 'EVIDENCE SNIPPETS:', snippetBlock].join(
              '\n\n',
            ),
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string')
      return { fullDescription: '', usedSnippetIndexes: [] };
    const parsed = JSON.parse(content) as {
      fullDescription?: unknown;
      usedSnippetIndexes?: unknown;
    };
    return {
      fullDescription: textValue(parsed.fullDescription),
      usedSnippetIndexes: Array.isArray(parsed.usedSnippetIndexes)
        ? (parsed.usedSnippetIndexes.filter((index) => Number.isInteger(index)) as number[])
        : [],
    };
  };
}
