/**
 * Research-entity description quality backfill (issue #415).
 *
 * Default lane (deterministic short-description backfill): scans active
 * research entities, and for every entity whose short description is empty,
 * equal to the full description, or otherwise not a genuine short summary,
 * derives a distinct short deterministically from the full description via the
 * shared `deriveShortDescriptionFromFullDescription` core (the same derivation
 * the materializer uses, reused here without changing it). It reports the
 * before/after quality scorecard, duplicate/templated full-description groups,
 * and thin/empty full descriptions that need re-scraped source content as a
 * follow-up rather than fabricating them. Apply requires
 * --confirm-short-descriptions and is blocked against production unless
 * CONFIRM_PROD_SCRAPE=true.
 *
 * LLM synthesis lane (--llm-synthesis): reuses the repository's existing
 * OpenAI chat-completions integration (gpt-4o-mini, JSON output, temperature 0,
 * contact redaction) to synthesize a clean, lab-focused short + full from the
 * best available stored source text. The prompt describes what the research
 * home STUDIES, not the PI biography, and drops credentials, titles, contact,
 * and boilerplate; output must be grounded in the source, pass the quality bar,
 * and classify as genuine lab prose or it is rejected. Candidates are entities
 * the deterministic pass flags as inadequate (stub, off-topic, thin, empty, or
 * short==full). Requires an explicit --limit to bound generation; apply also
 * requires --confirm-llm-synthesis and is production blocked. It reports a
 * cost/quality projection from real token usage and before/after samples.
 *
 * LLM rewrite lane (--llm-rewrite): grounded rewrite of description-blocked
 * homes whose stored bio is CV/credential prose. The LLM is instructed to use
 * ONLY facts in the source and to return empty when the source has no research
 * content (no invention). Output is accepted only if it passes the existing
 * `assessResearchEntityDescriptionQuality` bar AND is grounded (a minimum
 * fraction of its content words appear in the source text). Accepted text is
 * emitted as durable observations so the materializer resolves them normally.
 * Apply requires --confirm-research-descriptions + explicit --limit; blocked
 * against production unless CONFIRM_PROD_SCRAPE=true.
 *
 * Card-synthesis lane (--card-synthesis, issue #557): for entities held only on
 * missing_card_description that already carry a genuine source-backed full
 * description, resolves a shippable one-line card by trying the deterministic
 * deriveShortDescriptionFromFullDescription first and, when it returns nothing,
 * a grounded-LLM synthesis (grounded in the entity's OWN full description and
 * gated by the existing shortDescriptionQuality bar). The card quality bar is
 * never relaxed and synthesis fails closed. It reports cards gained and how
 * many would promote to student_ready (fresh visibility-gate reasons reduced to
 * missing_card_description alone). Apply writes durable shortDescription
 * observations plus the entity field, requires --confirm-card-synthesis, and is
 * production blocked.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import {
  sanitizeResearchEntityDescription,
  sanitizeResearchEntityShortDescription,
} from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import type { ObservationInput } from '../scrapers/types';
import {
  assessEntityDescription,
  detectDuplicateFullGroups,
  summarizeDescriptionBackfill,
  type DescriptionBackfillSummary,
  type DescriptionEntityInput,
  type DuplicateFullReport,
  type EntityDescriptionAssessment,
} from './backfillDescriptionQualityCore';
import {
  buildSynthesisSources,
  defaultLabDescriptionSynthesizer,
  evaluateSynthesisOutput,
  isSynthesisCandidate,
  projectSynthesisCost,
  MIN_SYNTHESIS_SOURCE_CHARS,
  SYNTHESIS_MODEL,
  type LabDescriptionSynthesizer,
} from './labDescriptionSynthesis';
import {
  planCardBackfillRow,
  summarizeCardBackfill,
  CARD_BLOCKER_REASON,
  type CardBackfillEntity,
  type CardBackfillRow,
  type CardBackfillSummary,
  type CardSynthesizeFn,
} from './backfillCardSynthesisCore';
import {
  CARD_SYNTHESIS_MODEL,
  defaultCardSynthesisLLM,
  synthesizeGroundedCardDescription,
  type CardSynthesisLLMFn,
} from '../utils/groundedCardSynthesis';
import { planStudentVisibilityGate } from '../services/studentVisibilityGateService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DESC_BLOCK_REASONS = [
  'missing_description',
  'thin_description',
  'missing_card_description',
  'profile_fallback_only',
];
const MIN_SOURCE_CHARS = 150;
const MIN_GROUNDING = 0.6;
const SOURCE_NAME = 'lab-microsite-description-llm';
const REWRITE_CONFIDENCE = 0.85;
const MAX_REWRITE_PROMPT_SOURCE_CHARS = 12000;
const MAX_REWRITE_PROMPT_NAME_CHARS = 240;

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

const SHORT_BACKFILL_BATCH_SIZE = 200;

export interface ResearchDescriptionBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  llmRewrite: boolean;
  llmSynthesis: boolean;
  cardSynthesis: boolean;
  confirmShortDescriptions: boolean;
  confirmLlmSynthesis: boolean;
  confirmCardSynthesis: boolean;
  projectedEntities: number;
  recordIds?: string[];
  output?: string;
}

const DEFAULT_PROJECTED_ENTITIES = 2500;

export function parseResearchDescriptionBackfillArgs(
  argv: string[],
): ResearchDescriptionBackfillOptions {
  const options: ResearchDescriptionBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
    llmRewrite: false,
    llmSynthesis: false,
    cardSynthesis: false,
    confirmShortDescriptions: false,
    confirmLlmSynthesis: false,
    confirmCardSynthesis: false,
    projectedEntities: DEFAULT_PROJECTED_ENTITIES,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--llm-rewrite') options.llmRewrite = true;
    else if (arg === '--llm-synthesis') options.llmSynthesis = true;
    else if (arg === '--card-synthesis') options.cardSynthesis = true;
    else if (arg === '--confirm-research-descriptions') options.confirm = true;
    else if (arg === '--confirm-short-descriptions') options.confirmShortDescriptions = true;
    else if (arg === '--confirm-llm-synthesis') options.confirmLlmSynthesis = true;
    else if (arg === '--confirm-card-synthesis') options.confirmCardSynthesis = true;
    else if (arg.startsWith('--record-id=')) {
      const id = arg.slice('--record-id='.length).trim();
      if (!/^[0-9a-fA-F]{24}$/.test(id)) {
        throw new Error('--record-id must be a 24-character hex ObjectId');
      }
      options.recordIds = [...(options.recordIds || []), id];
    } else if (arg.startsWith('--projected-entities=')) {
      options.projectedEntities = parsePositiveInt(arg.slice('--projected-entities='.length));
    } else if (arg === '--projected-entities') {
      options.projectedEntities = parsePositiveInt(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

/** Fraction of meaningful content words in `output` that also appear in `source`. */
export function groundingScore(output: string, source: string): number {
  const src = source.toLowerCase();
  const words = Array.from(
    new Set((output.toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => !STOPWORDS.has(w))),
  );
  if (words.length === 0) return 0;
  const hits = words.filter((w) => src.includes(w)).length;
  return hits / words.length;
}

export type DescriptionRewriter = (input: {
  name: string;
  sourceText: string;
}) => Promise<{ fullDescription: string; shortDescription: string }>;

const defaultRewriter: DescriptionRewriter = async ({ name, sourceText }) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const safeName = redactDirectContactInfo(name).slice(0, MAX_REWRITE_PROMPT_NAME_CHARS);
  const safeSourceText = redactDirectContactInfo(sourceText).slice(
    0,
    MAX_REWRITE_PROMPT_SOURCE_CHARS,
  );
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You rewrite the RESEARCH content found in an official Yale source bio into a concise third-person research description. Use ONLY facts present in the source text. Describe what the person/lab STUDIES (topics, methods, questions). Do NOT include biography, training, degrees, titles, awards, or contact info. Do NOT invent topics. If the source contains no research focus, return empty strings.',
        },
        {
          role: 'user',
          content: [
            `Research home: ${safeName}`,
            'Return JSON {"fullDescription": "...", "shortDescription": "..."}. fullDescription = 1-3 sentences on the research only; shortDescription = one concise card sentence. If no research content exists in the source, return both as "".',
            'SOURCE:',
            safeSourceText,
          ].join('\n\n'),
        },
      ],
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 40000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  return {
    fullDescription:
      typeof parsed.fullDescription === 'string' ? parsed.fullDescription.trim() : '',
    shortDescription:
      typeof parsed.shortDescription === 'string' ? parsed.shortDescription.trim() : '',
  };
};

function entityHttpUrls(entity: any): string[] {
  return [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ].filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
}

/**
 * For an entity whose stored description is empty, fetch the funded-research
 * abstract from the NIH RePORTER or NSF award API as a grounded source text.
 * The abstract describes the lead's actual funded research — appropriate, and
 * the downstream grounding + quality checks still guard accuracy.
 */
export async function fetchGrantAbstract(entity: any): Promise<string> {
  const urls = entityHttpUrls(entity);
  const nih = urls
    .map((u) => u.match(/reporter\.nih\.gov\/project-details\/(\d+)/i)?.[1])
    .find(Boolean);
  if (nih) {
    try {
      const res = await axios.post(
        'https://api.reporter.nih.gov/v2/projects/search',
        {
          criteria: { appl_ids: [Number(nih)] },
          include_fields: ['AbstractText', 'ProjectTitle'],
          limit: 1,
        },
        { timeout: 25000 },
      );
      const r = res.data?.results?.[0];
      const text = [r?.project_title, r?.abstract_text].filter(Boolean).join('. ');
      if (text && text.length >= MIN_SOURCE_CHARS) return text;
    } catch {
      /* fall through */
    }
  }
  const nsf = urls.map((u) => u.match(/AWD_ID=(\d+)/i)?.[1]).find(Boolean);
  if (nsf) {
    try {
      const res = await axios.get(
        `https://api.nsf.gov/services/v1/awards/${nsf}.json?printFields=title,abstractText`,
        { timeout: 25000 },
      );
      const a = res.data?.response?.award?.[0];
      const text = [a?.title, a?.abstractText].filter(Boolean).join('. ');
      if (text && text.length >= MIN_SOURCE_CHARS) return text;
    } catch {
      /* fall through */
    }
  }
  return '';
}

function officialSourceUrl(entity: any): string {
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ].filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
  return (
    urls.find((u) => !/reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov|orcid\.org/i.test(u)) ||
    urls[0] ||
    ''
  );
}

export interface ResearchDescriptionBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  rewritten: number;
  skippedNoResearch: number;
  skippedUngrounded: number;
  skippedQuality: number;
  errors: number;
  samples: Array<{ slug: string; grounding: number; shortDescription: string }>;
}

export async function runResearchDescriptionBackfill(options: {
  dryRun: boolean;
  limit?: number;
  rewriter?: DescriptionRewriter;
}): Promise<ResearchDescriptionBackfillResult> {
  const rewrite = options.rewriter || defaultRewriter;
  const entities = await ResearchEntity.find(
    {
      archived: { $ne: true },
      studentVisibilityTier: { $in: ['operator_review', 'limited_but_safe'] },
      studentVisibilityReasons: { $in: DESC_BLOCK_REASONS },
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      fullDescription: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
    },
  ).lean();

  const result: ResearchDescriptionBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: 0,
    rewritten: 0,
    skippedNoResearch: 0,
    skippedUngrounded: 0,
    skippedQuality: 0,
    errors: 0,
    samples: [],
  };

  const source = options.dryRun ? null : await getSourceByName(SOURCE_NAME);
  const backfillRunId = new mongoose.Types.ObjectId().toString();

  for (const entity of entities as any[]) {
    if (options.limit && result.scanned >= options.limit) break;
    let sourceText = String(entity.fullDescription || '');
    if (sourceText.length < MIN_SOURCE_CHARS) {
      sourceText = await fetchGrantAbstract(entity);
    }
    if (sourceText.length < MIN_SOURCE_CHARS) continue;
    result.scanned += 1;
    try {
      const out = await rewrite({ name: entity.displayName || entity.name, sourceText });
      if (!out.fullDescription) {
        result.skippedNoResearch += 1;
        continue;
      }
      const grounding = groundingScore(
        `${out.fullDescription} ${out.shortDescription}`,
        sourceText,
      );
      if (grounding < MIN_GROUNDING) {
        result.skippedUngrounded += 1;
        continue;
      }
      const quality = assessResearchEntityDescriptionQuality({
        fullDescription: out.fullDescription,
        shortDescription: out.shortDescription,
      });
      if (!quality.full.isUseful || !quality.short.isUseful) {
        result.skippedQuality += 1;
        continue;
      }
      result.rewritten += 1;
      if (result.samples.length < 25) {
        result.samples.push({
          slug: entity.slug,
          grounding: Number(grounding.toFixed(2)),
          shortDescription: out.shortDescription,
        });
      }
      if (!options.dryRun && source) {
        const sourceUrl = officialSourceUrl(entity);
        const entityId = serializedDocumentId(entity._id);
        const observations: ObservationInput[] = [
          {
            entityType: 'researchEntity',
            entityId,
            entityKey: entity.slug,
            field: 'fullDescription',
            value: out.fullDescription,
            sourceUrl,
            confidenceOverride: REWRITE_CONFIDENCE,
          },
          {
            entityType: 'researchEntity',
            entityId,
            entityKey: entity.slug,
            field: 'shortDescription',
            value: out.shortDescription,
            sourceUrl,
            confidenceOverride: REWRITE_CONFIDENCE,
          },
        ];
        await appendObservations(observations, {
          sourceId: source._id,
          sourceName: SOURCE_NAME,
          scrapeRunId: backfillRunId,
          sourceWeight: REWRITE_CONFIDENCE,
          dryRun: false,
        });
        // Also apply to the entity now so the visibility gate sees it
        // immediately; the observations above are the durable provenance record
        // that keeps the description on future re-materialization. Route through
        // the same hygiene the materializer applies so this convenience write can
        // never land raw LLM/source output (contact info, CV prose, publications
        // dumps) straight on the student-facing entity ahead of materialization.
        await ResearchEntity.updateOne(
          { _id: entity._id },
          {
            $set: {
              fullDescription: sanitizeResearchEntityDescription(out.fullDescription),
              shortDescription: sanitizeResearchEntityShortDescription(out.shortDescription),
            },
          },
        );
      }
    } catch (error) {
      result.errors += 1;
      console.error(`Rewrite failed for ${entity.slug}:`, sanitizeLogValue(error));
    }
  }
  return result;
}

const SAMPLE_LIMIT = 20;
const SAMPLE_TEXT_CHARS = 200;

const clip = (value: string): string =>
  value.length <= SAMPLE_TEXT_CHARS ? value : `${value.slice(0, SAMPLE_TEXT_CHARS - 1)}…`;

export interface ShortDescriptionBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  updated: number;
  summary: DescriptionBackfillSummary;
  duplicateFulls: DuplicateFullReport;
  caveatSamples: Array<{ slug?: string; after: string }>;
  artifactSamples: Array<{ slug?: string; after: string }>;
  derivedShortSamples: Array<{ slug?: string; shortDescription: string }>;
  templatedStubSamples: Array<{ slug?: string }>;
  offTopicSamples: Array<{ slug?: string }>;
}

export async function runShortDescriptionBackfill(options: {
  dryRun: boolean;
  limit?: number;
  batchSize?: number;
}): Promise<ShortDescriptionBackfillResult> {
  const query = ResearchEntity.find(
    { archived: { $ne: true } },
    { _id: 1, slug: 1, shortDescription: 1, fullDescription: 1 },
  ).sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const docs = (await query.lean()) as Array<{
    _id: unknown;
    slug?: string;
    shortDescription?: unknown;
    fullDescription?: unknown;
  }>;

  const entities: DescriptionEntityInput[] = docs.map((doc) => ({
    id: String(doc._id),
    slug: doc.slug,
    shortDescription: doc.shortDescription,
    fullDescription: doc.fullDescription,
  }));

  const assessments: EntityDescriptionAssessment[] = entities.map(assessEntityDescription);
  const summary = summarizeDescriptionBackfill(entities, assessments);
  const duplicateFulls = detectDuplicateFullGroups(entities);
  const changed = assessments.filter(
    (assessment) => assessment.proposedFull !== null || assessment.proposedShort !== null,
  );

  if (!options.dryRun && changed.length > 0) {
    const batchSize = options.batchSize ?? SHORT_BACKFILL_BATCH_SIZE;
    for (let i = 0; i < changed.length; i += batchSize) {
      const batch = changed.slice(i, i + batchSize);
      await ResearchEntity.bulkWrite(
        batch.map((assessment) => {
          const set: Record<string, string> = {};
          if (assessment.proposedFull !== null) set.fullDescription = assessment.proposedFull;
          if (assessment.proposedShort !== null) set.shortDescription = assessment.proposedShort;
          return { updateOne: { filter: { _id: assessment.id }, update: { $set: set } } };
        }),
      );
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: entities.length,
    updated: options.dryRun ? 0 : changed.length,
    summary,
    duplicateFulls,
    caveatSamples: assessments
      .filter((assessment) => assessment.removedCaveat && assessment.proposedFull !== null)
      .slice(0, SAMPLE_LIMIT)
      .map((assessment) => ({ slug: assessment.slug, after: clip(assessment.proposedFull ?? '') })),
    artifactSamples: assessments
      .filter((assessment) => assessment.removedArtifacts)
      .slice(0, SAMPLE_LIMIT)
      .map((assessment) => ({
        slug: assessment.slug,
        after: clip(assessment.proposedFull ?? assessment.proposedShort ?? ''),
      })),
    derivedShortSamples: assessments
      .filter((assessment) => assessment.shortAction === 'set-short-derived')
      .slice(0, SAMPLE_LIMIT)
      .map((assessment) => ({
        slug: assessment.slug,
        shortDescription: clip(assessment.proposedShort ?? ''),
      })),
    templatedStubSamples: assessments
      .filter((assessment) => assessment.fullClass === 'templated-stub')
      .slice(0, SAMPLE_LIMIT)
      .map((assessment) => ({ slug: assessment.slug })),
    offTopicSamples: assessments
      .filter((assessment) => assessment.fullClass === 'off-topic')
      .slice(0, SAMPLE_LIMIT)
      .map((assessment) => ({ slug: assessment.slug })),
  };
}

function writeBackfillReport(
  options: ResearchDescriptionBackfillOptions,
  payload: unknown,
  label: string,
): void {
  if (!options.output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(options.output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
  console.log(`Saved ${label} report to ${safeOutput}`);
}

async function runLlmRewriteLane(options: ResearchDescriptionBackfillOptions): Promise<void> {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('LLM rewrite apply requires --confirm-research-descriptions.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('LLM rewrite apply requires an explicit --limit.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-description rewrite backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; lane: llm-rewrite; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchDescriptionBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    writeBackfillReport(
      options,
      {
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        lane: 'llm-rewrite',
        options: {
          dryRun: options.dryRun,
          limit: options.explicitLimit ? options.limit : undefined,
        },
        result,
      },
      'research-description rewrite backfill',
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

async function runShortBackfillLane(options: ResearchDescriptionBackfillOptions): Promise<void> {
  const apply = !options.dryRun;
  if (apply && !options.confirmShortDescriptions) {
    throw new Error('Short-description apply requires --confirm-short-descriptions.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'short-description backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; lane: short-backfill; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runShortDescriptionBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    writeBackfillReport(
      options,
      {
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        lane: 'short-backfill',
        options: {
          dryRun: options.dryRun,
          limit: options.explicitLimit ? options.limit : undefined,
        },
        result,
      },
      'short-description backfill',
    );
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          scanned: result.scanned,
          updated: result.updated,
          summary: result.summary,
          duplicateFulls: {
            groupCount: result.duplicateFulls.groupCount,
            documentCount: result.duplicateFulls.documentCount,
          },
        },
        null,
        2,
      ),
    );
    if (apply && result.updated > 0) {
      console.log(
        'Rebuild the Meilisearch research index so search picks up the cleaned descriptions.',
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

interface SynthesisEntityDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
  description?: unknown;
  profileSynthesisDescription?: unknown;
  researchAreas?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}

function stratifyByEntityType(
  candidates: SynthesisEntityDoc[],
  limit: number,
): SynthesisEntityDoc[] {
  const groups = new Map<string, SynthesisEntityDoc[]>();
  for (const candidate of candidates) {
    const key = String(candidate.entityType || candidate.kind || 'UNKNOWN');
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }
  const buckets = Array.from(groups.values());
  const selected: SynthesisEntityDoc[] = [];
  let index = 0;
  while (selected.length < limit && buckets.some((bucket) => bucket.length > 0)) {
    const bucket = buckets[index % buckets.length];
    const next = bucket.shift();
    if (next) selected.push(next);
    index += 1;
  }
  return selected;
}

export interface LabDescriptionSynthesisResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  candidates: number;
  attempted: number;
  synthesized: number;
  updated: number;
  skipped: Record<string, number>;
  cost: {
    model: string;
    callCount: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    avgPromptTokens: number;
    avgCompletionTokens: number;
    sampleUsd: number;
    projectedEntities: number;
    projectedUsd: number;
  };
  samples: Array<{
    slug?: string;
    entityType?: string;
    grounding: number;
    beforeFull: string;
    beforeShort: string;
    afterFull: string;
    afterShort: string;
  }>;
}

export async function runLabDescriptionSynthesis(options: {
  dryRun: boolean;
  limit: number;
  projectedEntities: number;
  synthesizer?: LabDescriptionSynthesizer;
}): Promise<LabDescriptionSynthesisResult> {
  const synthesize = options.synthesizer || defaultLabDescriptionSynthesizer;
  const docs = (await ResearchEntity.find(
    { archived: { $ne: true } },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      shortDescription: 1,
      fullDescription: 1,
      description: 1,
      profileSynthesisDescription: 1,
      researchAreas: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as SynthesisEntityDoc[];

  const candidates = docs.filter((doc) => isSynthesisCandidate(doc));
  const selected = stratifyByEntityType([...candidates], options.limit);

  const skipped: Record<string, number> = {
    'no-source': 0,
    'empty-output': 0,
    ungrounded: 0,
    'low-quality': 0,
    'not-lab-focused': 0,
    error: 0,
  };
  let attempted = 0;
  let synthesized = 0;
  let updated = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let callCount = 0;
  const samples: LabDescriptionSynthesisResult['samples'] = [];

  for (const entity of selected) {
    let { sourceText, groundingAnchor } = buildSynthesisSources(entity);
    if (sourceText.length < MIN_SYNTHESIS_SOURCE_CHARS) {
      const abstract = await fetchGrantAbstract(entity);
      if (abstract) {
        sourceText = sourceText ? `${sourceText}\n\n${abstract}` : abstract;
        groundingAnchor = groundingAnchor ? `${groundingAnchor}\n\n${abstract}` : abstract;
      }
    }
    if (sourceText.length < MIN_SYNTHESIS_SOURCE_CHARS) {
      skipped['no-source'] += 1;
      continue;
    }

    attempted += 1;
    try {
      const output = await synthesize({
        name: String(entity.displayName || entity.name || entity.slug || ''),
        entityType: entity.entityType,
        sourceText,
      });
      if (output.usage) {
        totalPromptTokens += output.usage.promptTokens;
        totalCompletionTokens += output.usage.completionTokens;
        callCount += 1;
      }
      const verdict = evaluateSynthesisOutput(output, groundingAnchor);
      if (!verdict.accepted) {
        skipped[verdict.reason ?? 'low-quality'] += 1;
        continue;
      }
      synthesized += 1;
      if (samples.length < SAMPLE_LIMIT * 2) {
        samples.push({
          slug: entity.slug,
          entityType: entity.entityType,
          grounding: Number(verdict.grounding.toFixed(2)),
          beforeFull: clip(String(entity.fullDescription || '')),
          beforeShort: clip(String(entity.shortDescription || '')),
          afterFull: output.fullDescription,
          afterShort: output.shortDescription,
        });
      }
      if (!options.dryRun) {
        await ResearchEntity.updateOne(
          { _id: entity._id },
          {
            $set: {
              fullDescription: output.fullDescription,
              shortDescription: output.shortDescription,
            },
          },
        );
        updated += 1;
      }
    } catch (error) {
      skipped.error += 1;
      console.error(
        `Synthesis failed for ${sanitizeLogValue(entity.slug)}:`,
        sanitizeLogValue(error),
      );
    }
  }

  const cost = projectSynthesisCost(
    totalPromptTokens,
    totalCompletionTokens,
    callCount,
    options.projectedEntities,
  );

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: docs.length,
    candidates: candidates.length,
    attempted,
    synthesized,
    updated,
    skipped,
    cost: {
      model: SYNTHESIS_MODEL,
      callCount,
      totalPromptTokens,
      totalCompletionTokens,
      avgPromptTokens: cost.avgPromptTokens,
      avgCompletionTokens: cost.avgCompletionTokens,
      sampleUsd: cost.sampleUsd,
      projectedEntities: options.projectedEntities,
      projectedUsd: cost.projectedUsd,
    },
    samples,
  };
}

async function runLlmSynthesisLane(options: ResearchDescriptionBackfillOptions): Promise<void> {
  const apply = !options.dryRun;
  if (!options.explicitLimit) {
    throw new Error('LLM synthesis requires an explicit --limit to bound generation.');
  }
  if (apply && !options.confirmLlmSynthesis) {
    throw new Error('LLM synthesis apply requires --confirm-llm-synthesis.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'lab-description LLM synthesis',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; lane: llm-synthesis; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runLabDescriptionSynthesis({
      dryRun: options.dryRun,
      limit: options.limit,
      projectedEntities: options.projectedEntities,
    });
    writeBackfillReport(
      options,
      {
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        lane: 'llm-synthesis',
        options: {
          dryRun: options.dryRun,
          limit: options.limit,
          projectedEntities: options.projectedEntities,
        },
        result,
      },
      'lab-description LLM synthesis',
    );
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          scanned: result.scanned,
          candidates: result.candidates,
          attempted: result.attempted,
          synthesized: result.synthesized,
          updated: result.updated,
          skipped: result.skipped,
          cost: result.cost,
        },
        null,
        2,
      ),
    );
    if (apply && result.updated > 0) {
      console.log(
        'Rebuild the Meilisearch research index so search picks up the synthesized descriptions.',
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

interface CardSynthesisEntityDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
  studentVisibilityReasons?: string[];
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}

const CARD_SYNTHESIS_CONFIDENCE = 0.82;

export interface CardSynthesisBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  updated: number;
  summary: CardBackfillSummary;
  samples: Array<{
    slug?: string;
    entityType?: string;
    action: string;
    wouldPromote: boolean;
    shortDescription: string;
  }>;
}

export async function runCardSynthesisBackfill(options: {
  dryRun: boolean;
  limit?: number;
  recordIds?: string[];
  cardSynthesizer?: CardSynthesisLLMFn;
  cardModel?: string;
}): Promise<CardSynthesisBackfillResult> {
  const callCardLLM = options.cardSynthesizer || defaultCardSynthesisLLM;
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const cardModel = options.cardModel || CARD_SYNTHESIS_MODEL;
  const synthesize: CardSynthesizeFn = (fullDescription) =>
    apiKey
      ? synthesizeGroundedCardDescription({
          fullDescription,
          callLLM: (llmInput) => callCardLLM({ ...llmInput, apiKey, model: cardModel }),
        })
      : Promise.resolve('');

  const scopedIds = (options.recordIds || []).map((id) => new mongoose.Types.ObjectId(id));
  const query: Record<string, unknown> = {
    archived: { $ne: true },
    studentVisibilityReasons: CARD_BLOCKER_REASON,
  };
  if (scopedIds.length > 0) query._id = { $in: scopedIds };
  const docs = (await ResearchEntity.find(
    query,
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      shortDescription: 1,
      fullDescription: 1,
      studentVisibilityReasons: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as CardSynthesisEntityDoc[];

  const limited = options.limit ? docs.slice(0, options.limit) : docs;
  const docsById = new Map(limited.map((doc) => [serializedDocumentId(doc._id) || String(doc._id), doc]));
  const recordIds = Array.from(docsById.keys());

  const plans = recordIds.length
    ? await planStudentVisibilityGate({ collection: 'research', mode: 'dry-run', recordIds })
    : [];
  const reasonsById = new Map(plans.map((plan) => [plan.recordId, plan.reasons]));

  const rows: CardBackfillRow[] = [];
  for (const [id, doc] of docsById) {
    const entity: CardBackfillEntity = {
      id,
      slug: doc.slug,
      entityType: doc.entityType,
      kind: doc.kind,
      shortDescription: doc.shortDescription,
      fullDescription: doc.fullDescription,
      visibilityReasons: reasonsById.get(id) ?? doc.studentVisibilityReasons,
    };
    rows.push(await planCardBackfillRow(entity, synthesize));
  }

  const summary = summarizeCardBackfill(rows);
  const changed = rows.filter((row) => row.gainedCard && row.proposedShort);

  let updated = 0;
  if (!options.dryRun && changed.length > 0) {
    const source = await getSourceByName(SOURCE_NAME);
    if (source) {
      const backfillRunId = new mongoose.Types.ObjectId().toString();
      for (const row of changed) {
        const doc = docsById.get(row.id);
        if (!doc || !row.proposedShort) continue;
        const sourceUrl = officialSourceUrl(doc);
        await appendObservations(
          [
            {
              entityType: 'researchEntity',
              entityId: row.id,
              entityKey: doc.slug,
              field: 'shortDescription',
              value: row.proposedShort,
              sourceUrl,
              confidenceOverride: CARD_SYNTHESIS_CONFIDENCE,
            },
          ],
          {
            sourceId: source._id,
            sourceName: SOURCE_NAME,
            scrapeRunId: backfillRunId,
            sourceWeight: CARD_SYNTHESIS_CONFIDENCE,
            dryRun: false,
          },
        );
        await ResearchEntity.updateOne(
          { _id: doc._id },
          { $set: { shortDescription: row.proposedShort } },
        );
        updated += 1;
      }
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: rows.length,
    updated,
    summary,
    samples: changed.slice(0, SAMPLE_LIMIT * 2).map((row) => ({
      slug: row.slug,
      entityType: row.entityType,
      action: row.action,
      wouldPromote: row.wouldPromote,
      shortDescription: clip(row.proposedShort ?? ''),
    })),
  };
}

async function runCardSynthesisLane(options: ResearchDescriptionBackfillOptions): Promise<void> {
  const apply = !options.dryRun;
  const scoped = (options.recordIds || []).length > 0;
  if (apply && !options.explicitLimit && !scoped) {
    throw new Error(
      'Card-synthesis apply requires an explicit --limit or --record-id to bound generation.',
    );
  }
  if (apply && !options.confirmCardSynthesis) {
    throw new Error('Card-synthesis apply requires --confirm-card-synthesis.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'card-description synthesis backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; lane: card-synthesis; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runCardSynthesisBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
      recordIds: options.recordIds,
    });
    writeBackfillReport(
      options,
      {
        generatedAt: new Date().toISOString(),
        environment: guard.environment,
        db: guard.dbLabel,
        lane: 'card-synthesis',
        options: {
          dryRun: options.dryRun,
          limit: options.explicitLimit ? options.limit : undefined,
          recordIds: options.recordIds,
        },
        result,
      },
      'card-description synthesis backfill',
    );
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          scanned: result.scanned,
          updated: result.updated,
          summary: result.summary,
        },
        null,
        2,
      ),
    );
    if (apply && result.updated > 0) {
      console.log(
        'Rebuild the Meilisearch research index so search picks up the synthesized card descriptions.',
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

async function main(): Promise<void> {
  const options = parseResearchDescriptionBackfillArgs(process.argv.slice(2));
  if (options.cardSynthesis) {
    await runCardSynthesisLane(options);
    return;
  }
  if (options.llmSynthesis) {
    await runLlmSynthesisLane(options);
    return;
  }
  if (options.llmRewrite) {
    await runLlmRewriteLane(options);
    return;
  }
  await runShortBackfillLane(options);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
