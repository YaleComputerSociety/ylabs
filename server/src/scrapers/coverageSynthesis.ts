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
import { isRejectedDescriptionSourceUrl } from './sources/labMicrositeDescriptionLLMExtractor';
import { COVERAGE_SYNTHESIS_PROMPT } from './prompts';

export const COVERAGE_SYNTHESIS_MODEL = CARD_SYNTHESIS_MODEL;
export const COVERAGE_MIN_OVERLAP = 0.45;
export const COVERAGE_CONFIDENCE = 0.5;
export const MAX_COVERAGE_SNIPPETS = 12;
export const MAX_COVERAGE_SNIPPET_CHARS = 1200;

const SNIPPET_FIELDS = new Set([
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
}

export interface CoverageSynthesisLLMResult {
  fullDescription: string;
  usedSnippetIndexes: number[];
}

export type CoverageSynthesisLLMFn = (input: {
  snippets: CoverageSnippet[];
  entityName: string;
}) => Promise<CoverageSynthesisLLMResult>;

export function gatherCoverageSnippets(observations: CoverageObservationLike[]): CoverageSnippet[] {
  const seen = new Set<string>();
  const snippets: CoverageSnippet[] = [];
  for (const obs of observations) {
    if (!SNIPPET_FIELDS.has(obs.field)) continue;
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
  | 'quality-bar';

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

  const description = redactDirectContactInfo(textValue(raw.fullDescription));
  if (!description) return refuse('empty-description');

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
  if (!fullDescriptionQuality(description, input.researchAreas, input.entityType).isUseful) {
    return refuse('quality-bar');
  }

  const sourceUrls = Array.from(
    new Set(
      usedSnippetIndexes
        .map((index) => snippets[index].sourceUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  );
  return { result: { description, usedSnippetIndexes, sourceUrls }, refusal: null };
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
