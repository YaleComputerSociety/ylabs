import axios from 'axios';
import { redactDirectContactInfo } from './contactRedaction';
import {
  buildResearchAreasCardSummary,
  deriveProgramCardShortDescription,
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  isReplaceableResearchAreaChipEchoShort,
  isVacuousGenericFocusSummary,
  shortDescriptionQuality,
} from './researchEntityDescriptionQuality';
import { sanitizeResearchEntityShortDescription } from './descriptionHygiene';

export const CARD_SYNTHESIS_MODEL = 'gpt-4o-mini';
export const MIN_CARD_GROUNDING = 0.9;
export const MAX_CARD_SOURCE_CHARS = 6000;
export const MAX_CARD_NAME_CHARS = 240;

const CARD_SCAFFOLDING_WORDS = new Set([
  'studies',
  'study',
  'investigates',
  'investigate',
  'examines',
  'examine',
  'explores',
  'explore',
  'develops',
  'develop',
  'focuses',
  'focus',
  'focused',
  'advances',
  'advance',
  'uses',
  'employs',
  'employ',
  'analyzes',
  'analyze',
  'analyses',
  'analyse',
  'models',
  'measures',
  'measure',
  'researches',
  'research',
  'seeks',
  'seek',
  'works',
  'work',
  'combines',
  'combine',
  'conducts',
  'conduct',
  'builds',
  'build',
  'designs',
  'design',
  'creates',
  'create',
  'supports',
  'support',
  'fosters',
  'foster',
  'improves',
  'improve',
  'enhances',
  'enhance',
  'using',
  'through',
  'across',
  'between',
  'within',
  'their',
  'these',
  'those',
  'which',
  'that',
  'this',
  'with',
  'from',
  'into',
  'about',
  'understanding',
  'understand',
  'including',
  'include',
  'related',
  'various',
  'toward',
  'towards',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const normalizeForGrounding = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const distinctiveCardTokens = (value: string): string[] =>
  Array.from(
    new Set(
      (value.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
        .map((token) => token.replace(/-/g, ''))
        .filter((token) => token.length >= 4 && !CARD_SCAFFOLDING_WORDS.has(token)),
    ),
  );

export function cardGroundingScore(card: unknown, fullDescription: unknown): number {
  const tokens = distinctiveCardTokens(textValue(card));
  if (tokens.length === 0) return 0;
  const source = normalizeForGrounding(textValue(fullDescription)).replace(/\s+/g, '');
  const hits = tokens.filter((token) => source.includes(token)).length;
  return hits / tokens.length;
}

export function isCardGroundedInFullDescription(
  card: unknown,
  fullDescription: unknown,
): boolean {
  const normalizedCard = normalizeForGrounding(textValue(card));
  const normalizedFull = normalizeForGrounding(textValue(fullDescription));
  if (!normalizedCard || !normalizedFull) return false;
  if (normalizedFull.includes(normalizedCard)) return true;
  return cardGroundingScore(card, fullDescription) >= MIN_CARD_GROUNDING;
}

const SYNTHESIS_CARD_LEAD_PATTERN =
  /^(?:Studies|Investigates|Examines|Explores|Develops|Advances|Uses|Employs|Analyzes|Analyses|Models|Measures|Researches|Creates|Builds|Designs|Combines|Conducts|Supports|Fosters|Improves|Enhances|Innovates|Seeks to|Works on|Focuses on|Focused on)\b/i;

/**
 * A stored, synthesized "Studies X." card blurb whose distinctive topic tokens
 * are not grounded in the entity's own fullDescription. Synthesis-time grounding
 * (isCardGroundedInFullDescription) already rejects these, but a card materialized
 * before that guard, or against a fullDescription that later changed, can still be
 * served with a topic that contradicts the description (#1212, e.g. "Studies Texas
 * from the first." on a researcher whose description is about Morocco). Gated on a
 * synthesis-verb lead so a source-derived blurb is never touched, and only fires
 * when the card carries at least one distinctive topic token to judge, so a topic
 * too short to verify is kept rather than dropped.
 */
export function isUngroundedSynthesizedCard(
  shortDescription: unknown,
  fullDescription: unknown,
): boolean {
  const card = textValue(shortDescription);
  const full = textValue(fullDescription);
  if (!card || !full) return false;
  if (!SYNTHESIS_CARD_LEAD_PATTERN.test(card)) return false;
  if (distinctiveCardTokens(card).length === 0) return false;
  return !isCardGroundedInFullDescription(card, full);
}

export interface ResolveServedShortDescriptionInput {
  shortDescription: unknown;
  fullDescription: unknown;
  researchAreas?: unknown;
  entityType?: unknown;
}

/**
 * The single served-copy resolution for shortDescription (#1506): sanitize
 * (dropping a dangling-pronoun opener or artwork-chrome prefix per the
 * hygiene checks above, alongside the existing echo/first-person/synthesis-
 * glue checks), and when nothing survives, derive a fresh short from the
 * entity's own (already-quality-gated, then re-sanitized so a derived
 * pronoun-subject opener is caught too) fullDescription rather than serving
 * an empty card, falling back to a researchAreas summary when no
 * fullDescription-derived short clears quality either. Deliberately does NOT
 * use `isUngroundedSynthesizedCard` or a general topic-grounding check here:
 * a >=0.9 full-text grounding bar is tuned for freshly LLM-synthesized cards
 * and produced dozens of false positives when applied to arbitrary
 * already-served shorts in a live-corpus dry run (e.g. blanking a perfectly
 * good "Studies econometrics, financial economics, ..." because a rambling
 * bio never repeats those exact words); a strict zero-overlap variant avoided
 * that false-positive class but, checked against the full live corpus,
 * caught nothing beyond what the other checks here already catch and still
 * missed the one confirmed wrong-entity graft (`cohen-lab-cohenls`, which
 * shares one incidental token - "physiology" - with its correct
 * cardiovascular full description). A wrong-entity topic graft needs either
 * a semantic check or a much larger tuning corpus than a single PR affords,
 * so `cohen-lab-cohenls` is fixed as a one-off data correction instead.
 * `entityType` is threaded into the derived-candidate quality check only, so
 * the `LAB`/`FACULTY_RESEARCH_AREA` bare topic-label-list guard (#1616) also
 * applies to a candidate synthesized here, not just to an already-stored one.
 * A non-blank `cleaned` short is also swapped for a fresh full-derived one
 * when it is nothing but the entity's own researchArea chips restated as a
 * sentence and a genuinely richer full exists to compress instead (#1680):
 * that short survives #1616's ungrounded-topic gate (it is faithful to the
 * full), but it still wastes the card headline on a redundant re-listing of
 * the chip row already shown beside it.
 */
export function resolveServedShortDescription(input: ResolveServedShortDescriptionInput): string {
  const full = textValue(input.fullDescription);
  const researchAreas = Array.isArray(input.researchAreas) ? input.researchAreas : [];
  const cleaned = sanitizeResearchEntityShortDescription(textValue(input.shortDescription));
  if (cleaned) {
    if (isReplaceableResearchAreaChipEchoShort(cleaned, full, researchAreas, input.entityType)) {
      const derivedFromChipEcho = sanitizeResearchEntityShortDescription(
        deriveShortDescriptionFromFullDescription(full),
      );
      if (
        derivedFromChipEcho &&
        shortDescriptionQuality(derivedFromChipEcho, full, researchAreas, {
          entityType: input.entityType,
        }).isUseful
      ) {
        return derivedFromChipEcho;
      }
    }
    return cleaned;
  }

  const derived = sanitizeResearchEntityShortDescription(deriveShortDescriptionFromFullDescription(full));
  if (
    derived &&
    shortDescriptionQuality(derived, full, researchAreas, { entityType: input.entityType }).isUseful
  ) {
    return derived;
  }

  return buildResearchAreasCardSummary(researchAreas);
}

function firstSentence(value: string): string {
  const match = value.match(/^[^.!?]+[.!?]/);
  return match ? match[0].trim() : value;
}

export function normalizeCardText(value: unknown): string {
  let text = textValue(value)
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();
  if (!text) return '';
  if (text.length > 280 || (text.match(/[.!?](?:\s|$)/g) || []).length > 1) {
    text = firstSentence(text);
  }
  text = text.replace(/[.;:,\s]+$/g, '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export interface CardSynthesisLLMInput {
  model: string;
  apiKey: string;
  fullDescription: string;
  entityName: string;
}

export type CardSynthesisLLMFn = (input: CardSynthesisLLMInput) => Promise<string>;

export const CARD_SYNTHESIS_SYSTEM_PROMPT =
  'You condense an existing, verified research description into ONE short card sentence for a research-discovery card. ' +
  'Use ONLY topics, methods, questions, and terms that already appear in the provided description. ' +
  'Never add any topic, method, place, person, organization, or claim that is not present in the description. ' +
  'Do not include the principal investigator biography, titles, degrees, awards, funding, appointments, or contact information. ' +
  'Write in the third person, present tense, and start with a verb such as "Studies", "Investigates", "Develops", "Examines", "Focuses on", "Advances", or "Uses". ' +
  'Keep it to a single sentence under 30 words. ' +
  'If the description states no clear research focus, return an empty string.';

export const defaultCardSynthesisLLM: CardSynthesisLLMFn = async (input) => {
  const safeName = redactDirectContactInfo(input.entityName).slice(0, MAX_CARD_NAME_CHARS);
  const safeSource = redactDirectContactInfo(input.fullDescription).slice(0, MAX_CARD_SOURCE_CHARS);
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: CARD_SYNTHESIS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Research home: ${safeName}`,
            'Return JSON {"shortDescription": "..."} with a single card sentence, or {"shortDescription": ""} when the description has no clear research focus.',
            'DESCRIPTION:',
            safeSource,
          ].join('\n\n'),
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') return '';
  const parsed = JSON.parse(content) as { shortDescription?: unknown };
  return textValue(parsed.shortDescription);
};

export interface SynthesizeGroundedCardInput {
  fullDescription: unknown;
  entityName?: string;
  callLLM: (input: { fullDescription: string; entityName: string }) => Promise<string>;
}

export async function synthesizeGroundedCardDescription(
  input: SynthesizeGroundedCardInput,
): Promise<string> {
  const full = textValue(input.fullDescription);
  if (!full) return '';
  const fullQuality = fullDescriptionQuality(full);
  const onlyFirstPersonFull =
    fullQuality.flags.length === 1 && fullQuality.flags.includes('first-person');
  if (!fullQuality.isUseful && !onlyFirstPersonFull) return '';

  let raw: string;
  try {
    raw = await input.callLLM({ fullDescription: full, entityName: input.entityName || '' });
  } catch {
    return '';
  }
  const card = normalizeCardText(raw);
  if (!card) return '';
  if (!isCardGroundedInFullDescription(card, full)) return '';
  return shortDescriptionQuality(card, full).isUseful ? card : '';
}

export interface ResolveGroundedCardInput {
  fullDescription: unknown;
  researchAreas?: unknown;
  isProgramLike?: boolean;
  synthesize?: (fullDescription: string) => Promise<string>;
}

/**
 * A program (fellowship/RA program) is a funding vehicle, not a researcher, so
 * it cannot itself "Study" a topic - that framing only makes sense for a
 * person or lab. The lab-oriented fallbacks below (`deriveShortDescriptionFromFullDescription`,
 * LLM synthesis, `buildResearchAreasCardSummary`) all default to a "Studies X"
 * lead when they run out of more specific patterns, so on a program-like entity
 * that lead must be rejected rather than served (issue #1555).
 */
const RESEARCHER_VOICE_STUDIES_LEAD_PATTERN = /^Studies\b/i;

function rejectStudiesLeadOnProgramLike(candidate: string, isProgramLike: boolean | undefined): string {
  return isProgramLike && RESEARCHER_VOICE_STUDIES_LEAD_PATTERN.test(candidate) ? '' : candidate;
}

export async function resolveGroundedCardDescription(
  input: ResolveGroundedCardInput,
): Promise<string> {
  if (input.isProgramLike) {
    // A program/fellowship/RA-program offers or funds rather than researches, so
    // the lab-voice "Studies <topic>" fallbacks below - and the LLM synthesizer,
    // whose prompt hardcodes that same researcher-voice - do not apply: they
    // mis-frame the funding vehicle as the one doing the studying (issue #1555).
    // A program with no self-contained offer sentence in its own prose is left
    // with a blank short rather than a mis-framed one.
    return deriveProgramCardShortDescription(input.fullDescription);
  }
  const derived = rejectStudiesLeadOnProgramLike(
    deriveShortDescriptionFromFullDescription(input.fullDescription),
    input.isProgramLike,
  );
  if (derived && shortDescriptionQuality(derived, input.fullDescription).isUseful) {
    return derived;
  }
  const full = textValue(input.fullDescription);
  if (input.synthesize && full) {
    const synthesized = rejectStudiesLeadOnProgramLike(await input.synthesize(full), input.isProgramLike);
    if (synthesized) return synthesized;
  }
  const researchAreasSummary = rejectStudiesLeadOnProgramLike(
    buildResearchAreasCardSummary(input.researchAreas),
    input.isProgramLike,
  );
  if (researchAreasSummary) return researchAreasSummary;
  if (derived && isVacuousGenericFocusSummary(derived)) return '';
  return derived;
}
