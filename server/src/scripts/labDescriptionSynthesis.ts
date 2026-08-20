import axios from 'axios';
import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { classifyFullDescription, sanitizeDescriptionText } from './backfillDescriptionQualityCore';

export const SYNTHESIS_MODEL = 'gpt-4o-mini';
export const SYNTHESIS_INPUT_USD_PER_1K = 0.00015;
export const SYNTHESIS_OUTPUT_USD_PER_1K = 0.0006;
export const MIN_SYNTHESIS_SOURCE_CHARS = 120;
export const MIN_SYNTHESIS_GROUNDING = 0.5;

const MAX_SOURCE_CHARS = 12_000;
const MAX_NAME_CHARS = 240;

const PERSON_ENTITY_TYPES = new Set([
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'INDIVIDUAL_RESEARCH',
]);

export function isPersonResearchEntityType(entityType?: string): boolean {
  return PERSON_ENTITY_TYPES.has(String(entityType || '').toUpperCase());
}

const SHARED_SYNTHESIS_RULES = [
  'Do NOT include degrees, titles, appointments, awards, training or employment history, honors, contact information, or recruiting and welcome boilerplate.',
  'Use ONLY facts present in the SOURCE text. Never invent topics, methods, findings, or claims.',
];

const LAB_SYNTHESIS_SYSTEM_PROMPT = [
  'You write concise, third-person descriptions of a Yale research HOME (a lab, center, institute, program, or project) for an undergraduate research directory.',
  'Describe what the research home STUDIES: its research focus, the questions it pursues, its topics, and its methods.',
  "CRITICAL: describe the research home's research, NOT the principal investigator's personal biography.",
  ...SHARED_SYNTHESIS_RULES,
  'If the source mixes a principal investigator biography with research content, use ONLY the research content.',
  'If the source contains no description of the research itself (only a biography, a title, a keyword list, or navigation text), return empty strings for both fields.',
].join(' ');

const PERSON_SYNTHESIS_SYSTEM_PROMPT = [
  "You write concise, third-person descriptions of an individual Yale researcher's research for an undergraduate research directory.",
  'Describe what THIS researcher STUDIES: their research focus, the questions they pursue, their topics, and their methods.',
  'CRITICAL: describe the research itself, NOT the administrative CV. When the source is written as a biography, extract the research substance from it and drop the CV framing.',
  ...SHARED_SYNTHESIS_RULES,
  'If the source contains no description of the research itself (only a title, an appointment, a keyword list, or navigation text), return empty strings for both fields.',
].join(' ');

export function synthesisSystemPromptFor(entityType?: string): string {
  return isPersonResearchEntityType(entityType)
    ? PERSON_SYNTHESIS_SYSTEM_PROMPT
    : LAB_SYNTHESIS_SYSTEM_PROMPT;
}

const STOPWORDS = new Set([
  'research',
  'study',
  'studies',
  'studying',
  'focus',
  'focuses',
  'focused',
  'various',
  'development',
  'using',
  'their',
  'within',
  'these',
  'university',
  'professor',
  'including',
  'particularly',
  'understanding',
  'investigates',
  'investigate',
  'approaches',
  'mechanisms',
  'between',
]);

export function synthesisGroundingScore(output: string, source: string): number {
  const src = source.toLowerCase();
  const words = Array.from(
    new Set(
      (output.toLowerCase().match(/[a-z]{5,}/g) || []).filter((word) => !STOPWORDS.has(word)),
    ),
  );
  if (words.length === 0) return 0;
  const hits = words.filter((word) => src.includes(word)).length;
  return hits / words.length;
}

export interface LabSynthesisSourceFields {
  fullDescription?: unknown;
  description?: unknown;
  profileSynthesisDescription?: unknown;
}

export function assembleSynthesisSourceText(entity: LabSynthesisSourceFields): string {
  const candidates = [
    entity.fullDescription,
    entity.description,
    entity.profileSynthesisDescription,
  ]
    .map((value) => sanitizeDescriptionText(value).text)
    .filter((text) => text.length > 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const text of candidates) {
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(text);
    }
  }
  return unique.join('\n\n');
}

export interface LabSynthesisInput {
  name: string;
  entityType?: string;
  sourceText: string;
}

export interface LabSynthesisUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LabSynthesisOutput {
  shortDescription: string;
  fullDescription: string;
  usage?: LabSynthesisUsage;
}

export type LabDescriptionSynthesizer = (input: LabSynthesisInput) => Promise<LabSynthesisOutput>;

export const defaultLabDescriptionSynthesizer: LabDescriptionSynthesizer = async (input) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const safeName = redactDirectContactInfo(input.name).slice(0, MAX_NAME_CHARS);
  const safeSource = redactDirectContactInfo(input.sourceText).slice(0, MAX_SOURCE_CHARS);
  const isPerson = isPersonResearchEntityType(input.entityType);
  const subjectLabel = isPerson ? 'Researcher' : 'Research home';
  const fullDescriptionScope = isPerson ? "this researcher's research" : 'the research';
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: SYNTHESIS_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: synthesisSystemPromptFor(input.entityType) },
        {
          role: 'user',
          content: [
            `${subjectLabel}: ${safeName}${input.entityType ? ` (type: ${input.entityType})` : ''}`,
            `Return JSON {"fullDescription": "...", "shortDescription": "..."}. fullDescription = 1-3 sentences on ${fullDescriptionScope} only; shortDescription = one concise card sentence, distinct from the fullDescription phrasing. If the source has no research content, return both as "".`,
            'SOURCE:',
            safeSource,
          ].join('\n\n'),
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 40_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  const rawUsage = response.data?.usage;
  return {
    fullDescription:
      typeof parsed.fullDescription === 'string' ? parsed.fullDescription.trim() : '',
    shortDescription:
      typeof parsed.shortDescription === 'string' ? parsed.shortDescription.trim() : '',
    usage: rawUsage
      ? {
          promptTokens: Number(rawUsage.prompt_tokens) || 0,
          completionTokens: Number(rawUsage.completion_tokens) || 0,
        }
      : undefined,
  };
};

export interface SynthesisCandidateFields extends LabSynthesisSourceFields {
  shortDescription?: unknown;
}

export function isSynthesisCandidate(entity: SynthesisCandidateFields): boolean {
  const full = sanitizeDescriptionText(entity.fullDescription).text;
  const short = sanitizeDescriptionText(entity.shortDescription).text;
  const fullClass = classifyFullDescription(full);
  const shortEqualsFull =
    short.length > 0 && full.length > 0 && short.toLowerCase() === full.toLowerCase();
  return fullClass !== 'genuine' || shortEqualsFull;
}

export type SynthesisRejectReason =
  | 'empty-output'
  | 'ungrounded'
  | 'low-quality'
  | 'not-lab-focused';

export interface SynthesisAcceptance {
  accepted: boolean;
  reason?: SynthesisRejectReason;
  grounding: number;
}

export function evaluateSynthesisOutput(
  output: { fullDescription: string; shortDescription: string },
  sourceText: string,
): SynthesisAcceptance {
  if (!output.fullDescription || !output.shortDescription) {
    return { accepted: false, reason: 'empty-output', grounding: 0 };
  }
  const grounding = synthesisGroundingScore(
    `${output.fullDescription} ${output.shortDescription}`,
    sourceText,
  );
  if (grounding < MIN_SYNTHESIS_GROUNDING) {
    return { accepted: false, reason: 'ungrounded', grounding };
  }
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: output.fullDescription,
    shortDescription: output.shortDescription,
  });
  if (!quality.full.isUseful || !quality.short.isUseful) {
    return { accepted: false, reason: 'low-quality', grounding };
  }
  if (classifyFullDescription(output.fullDescription) !== 'genuine') {
    return { accepted: false, reason: 'not-lab-focused', grounding };
  }
  return { accepted: true, grounding };
}

export function projectSynthesisCost(
  totalPromptTokens: number,
  totalCompletionTokens: number,
  callCount: number,
  projectedEntities: number,
): {
  avgPromptTokens: number;
  avgCompletionTokens: number;
  sampleUsd: number;
  projectedUsd: number;
} {
  const avgPromptTokens = callCount > 0 ? totalPromptTokens / callCount : 0;
  const avgCompletionTokens = callCount > 0 ? totalCompletionTokens / callCount : 0;
  const sampleUsd =
    (totalPromptTokens / 1000) * SYNTHESIS_INPUT_USD_PER_1K +
    (totalCompletionTokens / 1000) * SYNTHESIS_OUTPUT_USD_PER_1K;
  const perEntityUsd =
    (avgPromptTokens / 1000) * SYNTHESIS_INPUT_USD_PER_1K +
    (avgCompletionTokens / 1000) * SYNTHESIS_OUTPUT_USD_PER_1K;
  return {
    avgPromptTokens: Math.round(avgPromptTokens),
    avgCompletionTokens: Math.round(avgCompletionTokens),
    sampleUsd: Number(sampleUsd.toFixed(4)),
    projectedUsd: Number((perEntityUsd * projectedEntities).toFixed(2)),
  };
}
