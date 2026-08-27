import axios from 'axios';
import { openAiChatSampling } from '../../utils/openAiChatSampling';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { CARD_SYNTHESIS_MODEL } from '../../utils/groundedCardSynthesis';
import { DISAMBIGUATION_JUDGE_PROMPT } from '../../scrapers/prompts';
import { firstNameCompatibility, tokenize } from './fuzzyMatchFeatures';
import { hostOf, type MatcherEntity } from './fuzzyResidualMatcher';

// A gpt-5-mini judge over the fuzzy matcher's uncertain review band. It only ever
// PROPOSES a SAME merge; it never auto-merges and never overrides a deterministic
// negative (a conflicting first name discards SAME regardless of confidence), and
// any malformed/empty output fails closed to DIFFERENT.

export interface JudgeEntity extends MatcherEntity {
  description?: unknown;
  profileUrl?: unknown;
}

export interface JudgeVerdict {
  verdict: 'SAME' | 'DIFFERENT';
  confidence: number;
  evidence: string;
}

export interface JudgeLLMInput {
  model: string;
  apiKey: string;
  recordA: string;
  recordB: string;
}

export type JudgeLLMFn = (input: JudgeLLMInput) => Promise<JudgeVerdict | null>;

export interface JudgeResult {
  pair: [string, string];
  verdict: 'SAME' | 'DIFFERENT';
  accepted: boolean;
  confidence: number;
  evidence: string;
  discardedReason?: string;
}

export const SAME_CONFIDENCE_THRESHOLD = 0.85;

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const clampConfidence = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, limit);
}

function firstSentence(value: unknown): string {
  const text = asString(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim().slice(0, 300);
}

function profilePath(value: unknown): string {
  const raw = asString(value);
  if (!raw) return '';
  try {
    const url = raw.includes('://') ? raw : `https://${raw}`;
    return new URL(url).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function renderJudgeRecord(entity: JudgeEntity): string {
  const parts: string[] = [];
  const name = redactDirectContactInfo(asString(entity.name));
  if (name) parts.push(`name: ${name}`);
  if (typeof entity.entityType === 'string' && entity.entityType) {
    parts.push(`entityType: ${entity.entityType}`);
  }
  const departments = stringList(entity.departments, 8);
  if (departments.length > 0) parts.push(`departments: ${departments.join(', ')}`);
  const researchAreas = stringList(entity.researchAreas, 8);
  if (researchAreas.length > 0) parts.push(`researchAreas: ${researchAreas.join(', ')}`);
  const host = hostOf(entity.websiteUrl);
  if (host) parts.push(`websiteHost: ${host}`);
  const path = profilePath(entity.profileUrl ?? entity.websiteUrl);
  if (path) parts.push(`profilePath: ${path}`);
  const sentence = redactDirectContactInfo(firstSentence(entity.description));
  if (sentence) parts.push(`description: ${sentence}`);
  return parts.join('\n');
}

function presentFieldTokens(entity: JudgeEntity): Set<string> {
  const tokens = new Set<string>();
  const add = (text: string): void => {
    for (const token of tokenize(text)) if (token.length >= 3) tokens.add(token);
  };
  add(asString(entity.name));
  if (typeof entity.entityType === 'string') add(entity.entityType);
  for (const dept of stringList(entity.departments, 8)) add(dept);
  for (const area of stringList(entity.researchAreas, 8)) add(area);
  const host = hostOf(entity.websiteUrl);
  if (host) add(host.replace(/\./g, ' '));
  add(profilePath(entity.profileUrl ?? entity.websiteUrl).replace(/[/-]/g, ' '));
  add(firstSentence(entity.description));
  return tokens;
}

// Guards against the LLM citing a field we never supplied (or inventing one): the
// evidence must share a real token with a field actually present on either record.
export function evidenceReferencesPresentField(
  evidence: string,
  a: JudgeEntity,
  b: JudgeEntity,
): boolean {
  const present = new Set<string>([...presentFieldTokens(a), ...presentFieldTokens(b)]);
  if (present.size === 0) return false;
  for (const token of tokenize(evidence)) {
    if (token.length >= 3 && present.has(token)) return true;
  }
  return false;
}

export function decideVerdict(a: JudgeEntity, b: JudgeEntity, raw: JudgeVerdict | null): JudgeResult {
  const pair: [string, string] = [a.id, b.id];
  if (!raw || (raw.verdict !== 'SAME' && raw.verdict !== 'DIFFERENT')) {
    return { pair, verdict: 'DIFFERENT', accepted: false, confidence: 0, evidence: '', discardedReason: 'malformed' };
  }
  const confidence = clampConfidence(raw.confidence);
  const evidence = asString(raw.evidence);
  if (raw.verdict === 'DIFFERENT') {
    return { pair, verdict: 'DIFFERENT', accepted: false, confidence, evidence };
  }
  // SAME verdict: a deterministic first-name conflict overrides it, always.
  if (firstNameCompatibility(a.firstName, b.firstName) === 'conflicting') {
    return { pair, verdict: 'DIFFERENT', accepted: false, confidence, evidence, discardedReason: 'first_name_conflict' };
  }
  if (confidence < SAME_CONFIDENCE_THRESHOLD) {
    return { pair, verdict: 'SAME', accepted: false, confidence, evidence, discardedReason: 'low_confidence' };
  }
  if (!evidenceReferencesPresentField(evidence, a, b)) {
    return { pair, verdict: 'SAME', accepted: false, confidence, evidence, discardedReason: 'evidence_not_grounded' };
  }
  return { pair, verdict: 'SAME', accepted: true, confidence, evidence };
}

export interface JudgeReviewBandOptions {
  callLLM: JudgeLLMFn;
  model?: string;
  apiKey?: string;
}

export async function judgeReviewBand(
  pairs: Array<{ a: JudgeEntity; b: JudgeEntity }>,
  options: JudgeReviewBandOptions,
): Promise<JudgeResult[]> {
  const results: JudgeResult[] = [];
  for (const { a, b } of pairs) {
    let raw: JudgeVerdict | null = null;
    try {
      raw = await options.callLLM({
        model: options.model ?? CARD_SYNTHESIS_MODEL,
        apiKey: options.apiKey ?? '',
        recordA: renderJudgeRecord(a),
        recordB: renderJudgeRecord(b),
      });
    } catch {
      raw = null;
    }
    results.push(decideVerdict(a, b, raw));
  }
  return results;
}

export function parseJudgeVerdict(content: string): JudgeVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.verdict !== 'SAME' && record.verdict !== 'DIFFERENT') return null;
  return {
    verdict: record.verdict,
    confidence: clampConfidence(record.confidence),
    evidence: asString(record.evidence),
  };
}

export const defaultDisambiguationJudgeLLM: JudgeLLMFn = async (input) => {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      ...openAiChatSampling(input.model),
      messages: [
        { role: 'system', content: DISAMBIGUATION_JUDGE_PROMPT },
        {
          role: 'user',
          content: [
            `RECORD A:\n${input.recordA}`,
            `RECORD B:\n${input.recordB}`,
            'Return JSON {"verdict":"SAME|DIFFERENT","confidence":0..1,"evidence":"..."}.',
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
  if (!content || typeof content !== 'string') return null;
  return parseJudgeVerdict(content);
};
