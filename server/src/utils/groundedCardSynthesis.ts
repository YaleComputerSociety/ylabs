import axios from 'axios';
import { redactDirectContactInfo } from './contactRedaction';
import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  shortDescriptionQuality,
} from './researchEntityDescriptionQuality';

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
  synthesize?: (fullDescription: string) => Promise<string>;
}

export async function resolveGroundedCardDescription(
  input: ResolveGroundedCardInput,
): Promise<string> {
  const derived = deriveShortDescriptionFromFullDescription(input.fullDescription);
  if (derived && shortDescriptionQuality(derived, input.fullDescription).isUseful) {
    return derived;
  }
  const full = textValue(input.fullDescription);
  if (input.synthesize && full) {
    const synthesized = await input.synthesize(full);
    if (synthesized) return synthesized;
  }
  return derived;
}
