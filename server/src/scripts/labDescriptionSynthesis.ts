import axios from 'axios';
import {
  assessResearchEntityDescriptionQuality,
  fullDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { openAiChatSampling } from '../utils/openAiChatSampling';
import { classifyFullDescription, sanitizeDescriptionText } from './backfillDescriptionQualityCore';
import { stripFacultyResearchAreaNameTemplateSuffix } from '../utils/researchEntityDescriptionText';

export const SYNTHESIS_MODEL = 'gpt-5-mini';
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
  'The SOURCE describes only the single named subject. If it also contains material about a different person or organization, ignore that material entirely and describe ONLY the named subject.',
  'If the SOURCE appears to describe a different subject than the named one, return empty strings for both fields rather than describing the wrong subject.',
  'Never refer to this description or directory listing itself (e.g. "this research profile", "this profile", "this listing").',
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

function distinctiveTokens(text: string): string[] {
  return Array.from(
    new Set((text.toLowerCase().match(/[a-z]{5,}/g) || []).filter((word) => !STOPWORDS.has(word))),
  );
}

function tokenOverlapCoefficient(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const larger = a.length >= b.length ? new Set(a) : new Set(b);
  const smaller = a.length >= b.length ? b : a;
  const shared = smaller.filter((token) => larger.has(token)).length;
  return shared / smaller.length;
}

export function synthesisGroundingScore(output: string, source: string): number {
  const words = distinctiveTokens(output);
  if (words.length === 0) return 0;
  const src = source.toLowerCase();
  const hits = words.filter((word) => src.includes(word)).length;
  return hits / words.length;
}

export const MIN_ANCHOR_TOKENS = 4;
export const MIN_SECONDARY_CORROBORATION = 0.1;

function normalizeResearchAreas(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((area) => sanitizeDescriptionText(area).text)
    .filter((text) => text.length > 0)
    .join(', ');
}

export interface LabSynthesisSourceFields {
  fullDescription?: unknown;
  profileSynthesisDescription?: unknown;
  researchAreas?: unknown;
}

export interface SynthesisSources {
  sourceText: string;
  groundingAnchor: string;
}

function dedupeJoin(parts: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const text of parts) {
    if (text.length === 0) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(text);
    }
  }
  return unique.join('\n\n');
}

// A fullDescription that is itself a chip-restatement fallback (#1625) is not
// real source material - re-synthesizing from it just launders the same
// researchAreas chips into differently-worded fluent prose, feeding the same
// hollow content back through the pipeline instead of replacing it. Treat it
// as absent so the pipeline falls through to a grant abstract or skips the
// entity ('no-source') rather than paraphrasing its own echo.
const isTrustworthySynthesisSource = (text: string, researchAreas: unknown): boolean =>
  text.length > 0 && !fullDescriptionQuality(text, researchAreas).flags.includes('area-echo-fallback');

export function buildSynthesisSources(entity: LabSynthesisSourceFields): SynthesisSources {
  const rawPrimary = sanitizeDescriptionText(entity.fullDescription).text;
  const primary = isTrustworthySynthesisSource(rawPrimary, entity.researchAreas) ? rawPrimary : '';
  const secondary = sanitizeDescriptionText(entity.profileSynthesisDescription).text;
  const researchAreas = normalizeResearchAreas(entity.researchAreas);

  const ownEvidenceTokens = distinctiveTokens(`${primary}\n${researchAreas}`);
  const canArbitrate = ownEvidenceTokens.length >= MIN_ANCHOR_TOKENS;
  const secondaryCorroborates =
    secondary.length > 0 &&
    (!canArbitrate ||
      tokenOverlapCoefficient(distinctiveTokens(secondary), ownEvidenceTokens) >=
        MIN_SECONDARY_CORROBORATION);

  const trustedFields: string[] = [];
  if (primary.length > 0) trustedFields.push(primary);
  if (secondaryCorroborates) trustedFields.push(secondary);

  const sourceText = dedupeJoin(trustedFields);
  const groundingAnchor = dedupeJoin([...trustedFields, researchAreas]);
  return { sourceText, groundingAnchor };
}

export function assembleSynthesisSourceText(entity: LabSynthesisSourceFields): string {
  return buildSynthesisSources(entity).sourceText;
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

export function synthesisSubjectName(input: { name: string; entityType?: string }): string {
  if (!isPersonResearchEntityType(input.entityType)) return input.name;
  return stripFacultyResearchAreaNameTemplateSuffix(input.name) || input.name;
}

export const defaultLabDescriptionSynthesizer: LabDescriptionSynthesizer = async (input) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const isPerson = isPersonResearchEntityType(input.entityType);
  const safeName = redactDirectContactInfo(synthesisSubjectName(input)).slice(0, MAX_NAME_CHARS);
  const safeSource = redactDirectContactInfo(input.sourceText).slice(0, MAX_SOURCE_CHARS);
  const subjectLabel = isPerson ? 'Researcher' : 'Research home';
  const fullDescriptionScope = isPerson ? "this researcher's research" : 'the research';
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: SYNTHESIS_MODEL,
      response_format: { type: 'json_object' },
      ...openAiChatSampling(SYNTHESIS_MODEL),
      messages: [
        { role: 'system', content: synthesisSystemPromptFor(input.entityType) },
        {
          role: 'user',
          content: [
            `${subjectLabel}: ${safeName}${input.entityType ? ` (type: ${input.entityType})` : ''}`,
            `Describe ONLY ${safeName}. Ignore any SOURCE material that is about a different person or organization.`,
            `Return JSON {"fullDescription": "...", "shortDescription": "..."}. fullDescription = 1-3 sentences on ${fullDescriptionScope} only; shortDescription = one concise card sentence, distinct from the fullDescription phrasing. If the source has no research content for ${safeName}, return both as "".`,
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
  groundingAnchor: string,
  researchAreas?: unknown,
): SynthesisAcceptance {
  if (!output.fullDescription || !output.shortDescription) {
    return { accepted: false, reason: 'empty-output', grounding: 0 };
  }
  const grounding = synthesisGroundingScore(
    `${output.fullDescription} ${output.shortDescription}`,
    groundingAnchor,
  );
  if (grounding < MIN_SYNTHESIS_GROUNDING) {
    return { accepted: false, reason: 'ungrounded', grounding };
  }
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: output.fullDescription,
    shortDescription: output.shortDescription,
    researchAreas,
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
