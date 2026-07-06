import axios from 'axios';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { serializedDocumentId } from '../../utils/idSerialization';
import crypto from 'crypto';
import { AccessSignal } from '../../models/accessSignal';
import { ContactRoute } from '../../models/contactRoute';
import { EntryPathway } from '../../models/entryPathway';
import { PostedOpportunity } from '../../models/postedOpportunity';
import { ResearchEntity } from '../../models/researchEntity';
import { publicStudentDecisionExplanation } from '../../services/studentDecisionExplanationService';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';

export interface DecisionCandidate {
  _id: string;
  slug: string;
  name: string;
  entityType?: string;
  description?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
  studentDecisionExplanation?: unknown;
  accessSummary?: {
    bestNextStep?: string;
    status?: string;
  };
  accessSignals?: Array<{
    signalType?: string;
    confidence?: string;
    excerpt?: string;
    sourceUrl?: string;
  }>;
  entryPathways?: Array<{
    pathwayType?: string;
    status?: string;
    studentFacingLabel?: string;
    sourceUrls?: string[];
  }>;
  contactRoutes?: Array<{
    routeType?: string;
    visibility?: string;
    url?: string;
    sourceUrl?: string;
  }>;
  postedOpportunities?: Array<{
    status?: string;
    applicationUrl?: string;
    sourceUrls?: string[];
  }>;
}

export interface DecisionCandidateSelectionOptions {
  only?: string[];
  limit?: number;
}

export type StudentDecisionLLMCall = (
  prompt: string,
  candidate: DecisionCandidate,
) => Promise<unknown>;
export type DecisionCandidateLoader = () => Promise<DecisionCandidate[]>;

export interface StudentDecisionLLMExtractorDeps {
  apiKey?: string;
  model?: string;
  candidateLoader?: DecisionCandidateLoader;
  callLLM?: StudentDecisionLLMCall;
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_LIMIT = 100;
const SOURCE_KEY = 'student-decision-llm';
const studentDecisionDocumentId = (value: unknown): string => serializedDocumentId(value) || '';
const SCHEMA_VERSION = 'v1';
const MAX_PROMPT_TEXT_FIELD_LENGTH = 2000;
const MAX_PROMPT_URL_FIELD_LENGTH = 2048;

const safePromptText = (value: unknown, maxLength = MAX_PROMPT_TEXT_FIELD_LENGTH): string =>
  redactDirectContactInfo(String(value || '')).slice(0, maxLength);

const safePromptUrl = (value: unknown): string =>
  redactDirectContactInfo(String(value || '')).slice(0, MAX_PROMPT_URL_FIELD_LENGTH);

export const STUDENT_DECISION_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'student_decision_explanation',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        recommendedAction: {
          type: 'string',
          enum: [
            'APPLY',
            'OPEN_OFFICIAL_ROUTE',
            'PLAN_EXPLORATORY_OUTREACH',
            'ASK_ABOUT_CREDIT_AFTER_FIT',
            'FIND_FUNDING_AFTER_FIT',
            'SAVE_FOR_THESIS_PLANNING',
            'CHECK_BACK_LATER',
          ],
        },
        headline: { type: 'string' },
        explanation: { type: 'string' },
        why: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 4,
        },
        notThis: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        sourceUrls: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 5,
        },
        reviewFlags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 5,
        },
      },
      required: [
        'recommendedAction',
        'headline',
        'explanation',
        'why',
        'notThis',
        'confidence',
        'sourceUrls',
        'reviewFlags',
      ],
    },
    strict: true,
  },
};

const SYSTEM_PROMPT = `You write concise, source-backed student decision guidance for Yale Research.

Return JSON only. Use only the evidence bundle supplied by the user.

Rules:
- Do not invent active openings, deadlines, direct emails, or application links.
- Recommend APPLY only when there is an active posted opportunity or public official application route in the evidence.
- Recommend OPEN_OFFICIAL_ROUTE only when a public route URL is present.
- For plausible but non-posted access, prefer PLAN_EXPLORATORY_OUTREACH.
- If evidence is weak, explain the uncertainty and use CHECK_BACK_LATER.
- The notThis field must be a plain caution like "Not a posted opening"; do not start it with APPLY, OPEN_OFFICIAL_ROUTE, or another action name.
- Keep headline short, explanation under 55 words, and each why bullet under 22 words.
- sourceUrls must be URLs present in the evidence bundle.`;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function candidateMatchesOnly(candidate: DecisionCandidate, only: Set<string>): boolean {
  if (only.size === 0) return true;
  return [candidate._id, candidate.slug, candidate.name].some((value) =>
    only.has(clean(value).toLowerCase()),
  );
}

function hasActionEvidence(candidate: DecisionCandidate): boolean {
  return Boolean(
    candidate.accessSummary?.bestNextStep ||
      candidate.accessSignals?.length ||
      candidate.entryPathways?.length ||
      candidate.contactRoutes?.length ||
      candidate.postedOpportunities?.length,
  );
}

function hasSourceBackedEvidence(candidate: DecisionCandidate): boolean {
  return compactSourceUrls(candidate).length > 0;
}

const personNameStopwords = new Set([
  'lab',
  'laboratory',
  'center',
  'centre',
  'research',
  'program',
  'project',
  'group',
  'phd',
  'ph',
  'md',
  'dr',
]);

function personNameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\bph\.?d\.?\b/g, ' ')
    .replace(/\bm\.?d\.?\b/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !personNameStopwords.has(token));
}

function profileSlugTokens(url: string): string[] {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/profile\/([^/?#]+)/i);
    return match ? personNameTokens(match[1]) : [];
  } catch {
    return [];
  }
}

function hasConflictingPersonProfileEvidence(candidate: DecisionCandidate): boolean {
  const nameTokens = personNameTokens(candidate.name);
  if (nameTokens.length < 2) return false;
  const expectedFirst = nameTokens[0];
  const expectedLast = nameTokens[nameTokens.length - 1];
  if (!expectedFirst || !expectedLast) return false;

  return compactSourceUrls(candidate).some((url) => {
    const profileTokens = profileSlugTokens(url);
    if (profileTokens.length < 2) return false;
    const profileFirst = profileTokens[0];
    const profileLast = profileTokens[profileTokens.length - 1];
    return profileLast === expectedLast && profileFirst !== expectedFirst;
  });
}

function isGenericDirectoryUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('/a-to-z-index/') ||
    lower.includes('/atoz/') ||
    lower.includes('/lab-websites') ||
    lower.includes('/directory')
  );
}

function needsStudentDecisionExplanation(candidate: DecisionCandidate): boolean {
  return !candidate.studentDecisionExplanation;
}

function compactSourceUrls(candidate: DecisionCandidate): string[] {
  return Array.from(
    new Set(
      [
        ...(candidate.accessSignals || []).map((signal) => signal.sourceUrl),
        ...(candidate.entryPathways || []).flatMap((pathway) => pathway.sourceUrls || []),
        ...(candidate.contactRoutes || []).map((route) => route.url || route.sourceUrl),
        ...(candidate.postedOpportunities || []).flatMap((opp) => [
          opp.applicationUrl,
          ...(opp.sourceUrls || []),
        ]),
        candidate.websiteUrl,
        ...(candidate.sourceUrls || []),
      ]
        .map(clean)
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  ).slice(0, 12);
}

function preferredObservationSourceUrl(
  safeSourceUrls: string[],
  candidate: DecisionCandidate,
): string | undefined {
  const safe = safeSourceUrls.map(clean).filter(Boolean);
  const specificSafe = safe.find((url) => !isGenericDirectoryUrl(url));
  if (specificSafe) return specificSafe;

  const candidateUrls = compactSourceUrls(candidate);
  const specificCandidate = candidateUrls.find((url) => !isGenericDirectoryUrl(url));
  return specificCandidate || safe[0] || candidateUrls[0];
}

export function selectDecisionCandidates(
  candidates: DecisionCandidate[],
  options: DecisionCandidateSelectionOptions = {},
): DecisionCandidate[] {
  const only = new Set((options.only || []).map((value) => value.trim().toLowerCase()).filter(Boolean));
  const limit = options.limit && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  return candidates
    .filter((candidate) => candidateMatchesOnly(candidate, only))
    .filter(hasActionEvidence)
    .filter(hasSourceBackedEvidence)
    .filter((candidate) => !hasConflictingPersonProfileEvidence(candidate))
    .filter(needsStudentDecisionExplanation)
    .slice(0, limit);
}

export function buildStudentDecisionPrompt(candidate: DecisionCandidate): string {
  const sourceUrls = compactSourceUrls(candidate).map((url) => safePromptUrl(url));
  const accessSignals = (candidate.accessSignals || [])
    .map(
      (signal) =>
        `- ${safePromptText(signal.signalType || 'SIGNAL', 80)} (${safePromptText(signal.confidence || 'UNKNOWN', 80)}): ${safePromptText(signal.excerpt)} ${safePromptUrl(signal.sourceUrl)}`.trim(),
    )
    .join('\n');
  const entryPathways = (candidate.entryPathways || [])
    .map(
      (pathway) =>
        `- ${safePromptText(pathway.pathwayType || 'PATHWAY', 80)} (${safePromptText(pathway.status || 'UNKNOWN', 80)}): ${safePromptText(pathway.studentFacingLabel)} ${(pathway.sourceUrls || []).map((url) => safePromptUrl(url)).join(', ')}`.trim(),
    )
    .join('\n');
  const contacts = (candidate.contactRoutes || [])
    .map(
      (route) =>
        `- ${safePromptText(route.routeType || 'CONTACT', 80)} (${safePromptText(route.visibility || 'UNKNOWN', 80)}): ${safePromptUrl(route.url || route.sourceUrl)}`.trim(),
    )
    .join('\n');
  const opportunities = (candidate.postedOpportunities || [])
    .map(
      (opportunity) =>
        `- ${safePromptText(opportunity.status || 'UNKNOWN', 80)}: ${safePromptUrl(opportunity.applicationUrl)} ${(opportunity.sourceUrls || []).map((url) => safePromptUrl(url)).join(', ')}`.trim(),
    )
    .join('\n');

  return [
    'Write a concise, source-backed Yale Research Best Next Step explanation.',
    'Return JSON only with recommendedAction, headline, explanation, why, notThis, confidence, sourceUrls, and reviewFlags.',
    'Do not invent active openings, direct emails, or claims not supported by the evidence bundle.',
    'Use the exact research entity name in the headline; do not replace it with a shortened PI-style lab label.',
    `Research entity: ${safePromptText(candidate.name, 240)}`,
    `Slug: ${safePromptText(candidate.slug, 240)}`,
    `Type: ${safePromptText(candidate.entityType || 'UNKNOWN', 80)}`,
    `Description: ${safePromptText(candidate.description)}`,
    `Current best next step: ${safePromptText(candidate.accessSummary?.bestNextStep || 'Unknown')}`,
    `Current access status: ${safePromptText(candidate.accessSummary?.status || 'Unknown', 80)}`,
    `Source URLs: ${sourceUrls.join(', ')}`,
    'Access signals:',
    accessSignals || '- none',
    'Entry pathways:',
    entryPathways || '- none',
    'Contact routes:',
    contacts || '- none',
    'Posted opportunities:',
    opportunities || '- none',
  ].join('\n');
}

export function decisionExtractionToObservation(
  candidate: DecisionCandidate,
  output: unknown,
  observedAt = new Date(),
): ObservationInput | null {
  const safe = publicStudentDecisionExplanation(output, {
    sourceUrls: compactSourceUrls(candidate),
    accessSignals: candidate.accessSignals,
    entryPathways: candidate.entryPathways,
    contactRoutes: candidate.contactRoutes,
    postedOpportunities: candidate.postedOpportunities,
  });
  if (!safe) return null;

  return {
    entityType: 'researchEntity',
    entityKey: candidate.slug,
    field: 'studentDecisionExplanation',
    value: safe,
    sourceUrl: preferredObservationSourceUrl(safe.sourceUrls, candidate),
    observedAt,
    confidenceOverride: 0.55,
  };
}

async function defaultCandidateLoader(): Promise<DecisionCandidate[]> {
  const active = { archived: { $ne: true } };
  const [signalIds, pathwayIds, opportunityIds, routeIds] = await Promise.all([
    AccessSignal.distinct('researchEntityId', active),
    EntryPathway.distinct('researchEntityId', active),
    PostedOpportunity.distinct('researchEntityId', active),
    ContactRoute.distinct('researchEntityId', { ...active, visibility: 'PUBLIC' }),
  ]);
  const evidenceEntityIds = Array.from(
    new Set(
      [...signalIds, ...pathwayIds, ...opportunityIds, ...routeIds]
        .filter(Boolean)
        .map((id) => String(id)),
    ),
  ).slice(0, 2000);

  if (evidenceEntityIds.length === 0) return [];

  const rows = await ResearchEntity.find({
    _id: { $in: evidenceEntityIds },
    archived: { $ne: true },
    studentVisibilityTier: { $ne: 'suppressed' },
  })
    .select('slug name entityType description shortDescription websiteUrl sourceUrls accessSummary studentDecisionExplanation')
    .lean();

  const entityIds = (rows as any[]).map((row) => row._id);
  const [signals, pathways, routes, opportunities] = await Promise.all([
    AccessSignal.find({ ...active, researchEntityId: { $in: entityIds } })
      .select('researchEntityId signalType confidence excerpt sourceUrl')
      .lean(),
    EntryPathway.find({ ...active, researchEntityId: { $in: entityIds } })
      .select('researchEntityId pathwayType status studentFacingLabel sourceUrls')
      .lean(),
    ContactRoute.find({ ...active, researchEntityId: { $in: entityIds }, visibility: 'PUBLIC' })
      .select('researchEntityId routeType visibility url sourceUrl')
      .sort({ priority: 1 })
      .lean(),
    PostedOpportunity.find({ ...active, researchEntityId: { $in: entityIds } })
      .select('researchEntityId status applicationUrl sourceUrls')
      .lean(),
  ]);

  const byEntity = <T extends { researchEntityId?: unknown }>(items: T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const key = studentDecisionDocumentId((item as any).researchEntityId);
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    return grouped;
  };

  const signalsByEntity = byEntity(signals as any[]);
  const pathwaysByEntity = byEntity(pathways as any[]);
  const routesByEntity = byEntity(routes as any[]);
  const opportunitiesByEntity = byEntity(opportunities as any[]);

  return (rows as any[]).map((row) => ({
    _id: studentDecisionDocumentId(row._id),
    slug: row.slug,
    name: row.name,
    entityType: row.entityType,
    description: row.description || row.shortDescription,
    websiteUrl: row.websiteUrl,
    sourceUrls: row.sourceUrls || (row.websiteUrl ? [row.websiteUrl] : []),
    studentDecisionExplanation: row.studentDecisionExplanation,
    accessSummary: row.accessSummary,
    accessSignals: (signalsByEntity.get(studentDecisionDocumentId(row._id)) || []).slice(0, 8),
    entryPathways: (pathwaysByEntity.get(studentDecisionDocumentId(row._id)) || []).slice(0, 8),
    contactRoutes: (routesByEntity.get(studentDecisionDocumentId(row._id)) || []).slice(0, 5),
    postedOpportunities: (opportunitiesByEntity.get(studentDecisionDocumentId(row._id)) || []).slice(0, 5),
  }));
}

export async function defaultCallLLM(
  prompt: string,
  _candidate: DecisionCandidate,
  model = DEFAULT_MODEL,
  apiKey = process.env.OPENAI_API_KEY || '',
): Promise<unknown> {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: STUDENT_DECISION_RESPONSE_FORMAT,
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    },
  );
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM returned empty content');
  }
  try {
    return JSON.parse(content);
  } catch (err: any) {
    throw new Error(`LLM returned invalid JSON: ${sanitizeLogValue(err)}`);
  }
}

export class StudentDecisionLLMExtractor implements IScraper {
  readonly name = 'student-decision-llm';
  readonly displayName = 'Student decision LLM';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly candidateLoader: DecisionCandidateLoader;
  private readonly callLLM: StudentDecisionLLMCall;

  constructor(deps: StudentDecisionLLMExtractorDeps = {}) {
    this.apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = deps.model ?? DEFAULT_MODEL;
    this.candidateLoader = deps.candidateLoader ?? defaultCandidateLoader;
    this.callLLM =
      deps.callLLM ?? ((prompt, candidate) => defaultCallLLM(prompt, candidate, this.model, this.apiKey));
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey && !ctx.options.useCache) {
      ctx.log('OPENAI_API_KEY missing - cannot run student decision LLM extraction.');
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'OPENAI_API_KEY missing',
      };
    }

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    const candidates = selectDecisionCandidates(await this.candidateLoader(), {
      only: ctx.options.only,
      limit: limitOption,
    });
    ctx.log(
      `Processing ${candidates.length} student-decision candidates (limit=${limitOption ?? DEFAULT_LIMIT}, only=${(ctx.options.only || []).join(',') || 'none'})`,
    );
    let observationCount = 0;
    let entitiesObserved = 0;
    let rejected = 0;
    let llmFailed = 0;

    for (const candidate of candidates) {
      const prompt = buildStudentDecisionPrompt(candidate);
      try {
        const hash = crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 20);
        const cacheKey = `${SCHEMA_VERSION}:${this.model}:${candidate.slug || candidate._id}:${hash}`;
        let output: unknown | null = null;
        if (ctx.options.useCache) {
          try {
            output = await getCached(SOURCE_KEY, cacheKey);
          } catch {
            /* ignore cache errors */
          }
        }
        if (!output) {
          if (!this.apiKey) {
            ctx.log(`[${candidate.slug}] cached student decision LLM output missing and OPENAI_API_KEY is not configured`);
            llmFailed += 1;
            continue;
          }
          output = await this.callLLM(prompt, candidate);
          if (ctx.options.useCache) {
            try {
              await setCached(SOURCE_KEY, cacheKey, output);
            } catch {
              /* ignore cache errors */
            }
          }
        }
        const observation = decisionExtractionToObservation(candidate, output);
        if (!observation) {
          ctx.log(`[${candidate.slug}] rejected unsafe explanation`);
          rejected += 1;
          continue;
        }
        await ctx.emit(observation);
        observationCount += 1;
        entitiesObserved += 1;
      } catch (error) {
        llmFailed += 1;
        ctx.log(`[${candidate.slug}] student decision LLM failed`, {
          error: sanitizeLogValue(error),
          model: this.model,
        });
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `LLM-generated ${observationCount}/${candidates.length} student-decision explanations (${rejected} rejected, ${llmFailed} failed)`,
    };
  }
}
