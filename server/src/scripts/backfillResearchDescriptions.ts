/**
 * Grounded research-description rewrite for description-blocked research homes.
 *
 * Many held faculty/lab entities carry an official bio that is CV/credential
 * prose ("Dr. X received an MD from ...") — correctly classified as
 * `profile_fallback`/`thin`, not a research description, so they stay held.
 * This rewrites the research content ALREADY PRESENT in that official source
 * text into a concise third-person research description using the LLM.
 *
 * Quality safety (does NOT loosen the gate, improves the data):
 *  - The LLM is instructed to use ONLY facts in the source and to return empty
 *    when the source has no research content (no invention).
 *  - The output is accepted ONLY if (a) it passes the existing
 *    `assessResearchEntityDescriptionQuality` bar AND (b) it is GROUNDED — a
 *    minimum fraction of its content words appear in the source text
 *    (anti-hallucination). Ungrounded or empty rewrites are skipped.
 *  - Accepted text is emitted as durable observations (same path the
 *    description scraper uses) so the materializer resolves them normally.
 *
 * Dry-run-first; apply requires --confirm-research-descriptions + explicit
 * --limit; blocked against production unless CONFIRM_PROD_SCRAPE=true.
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
import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import type { ObservationInput } from '../scrapers/types';

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

export interface ResearchDescriptionBackfillOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

export function parseResearchDescriptionBackfillArgs(argv: string[]): ResearchDescriptionBackfillOptions {
  const options: ResearchDescriptionBackfillOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-research-descriptions') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value || value.startsWith('--')) throw new Error('--output requires a path');
      options.output = value;
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
            `Research home: ${name}`,
            'Return JSON {"fullDescription": "...", "shortDescription": "..."}. fullDescription = 1-3 sentences on the research only; shortDescription = one concise card sentence. If no research content exists in the source, return both as "".',
            'SOURCE:',
            sourceText.slice(0, 12000),
          ].join('\n\n'),
        },
      ],
    },
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 40000 },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  const parsed = content ? JSON.parse(content) : {};
  return {
    fullDescription: typeof parsed.fullDescription === 'string' ? parsed.fullDescription.trim() : '',
    shortDescription: typeof parsed.shortDescription === 'string' ? parsed.shortDescription.trim() : '',
  };
};

function entityHttpUrls(entity: any): string[] {
  return [entity.websiteUrl, entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])].filter(
    (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u),
  );
}

/**
 * For an entity whose stored description is empty, fetch the funded-research
 * abstract from the NIH RePORTER or NSF award API as a grounded source text.
 * The abstract describes the lead's actual funded research — appropriate, and
 * the downstream grounding + quality checks still guard accuracy.
 */
export async function fetchGrantAbstract(entity: any): Promise<string> {
  const urls = entityHttpUrls(entity);
  const nih = urls.map((u) => u.match(/reporter\.nih\.gov\/project-details\/(\d+)/i)?.[1]).find(Boolean);
  if (nih) {
    try {
      const res = await axios.post(
        'https://api.reporter.nih.gov/v2/projects/search',
        { criteria: { appl_ids: [Number(nih)] }, include_fields: ['AbstractText', 'ProjectTitle'], limit: 1 },
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
  const urls = [entity.websiteUrl, entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])]
    .filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
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
    { _id: 1, slug: 1, name: 1, displayName: 1, fullDescription: 1, websiteUrl: 1, website: 1, sourceUrls: 1 },
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
      const grounding = groundingScore(`${out.fullDescription} ${out.shortDescription}`, sourceText);
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
        const observations: ObservationInput[] = [
          {
            entityType: 'researchEntity',
            entityId: String(entity._id),
            entityKey: entity.slug,
            field: 'fullDescription',
            value: out.fullDescription,
            sourceUrl,
            confidenceOverride: REWRITE_CONFIDENCE,
          },
          {
            entityType: 'researchEntity',
            entityId: String(entity._id),
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
        // that keeps the description on future re-materialization.
        await ResearchEntity.updateOne(
          { _id: entity._id },
          { $set: { fullDescription: out.fullDescription, shortDescription: out.shortDescription } },
        );
      }
    } catch (error) {
      result.errors += 1;
      console.error(`Rewrite failed for ${entity.slug}:`, (error as Error).message);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseResearchDescriptionBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) throw new Error('Apply mode requires --confirm-research-descriptions.');
  if (apply && !options.explicitLimit) throw new Error('Apply mode requires an explicit --limit.');

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-description rewrite backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(`Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`);

  await initializeConnections();
  try {
    const result = await runResearchDescriptionBackfill({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
      console.log(`Saved research-description backfill report to ${options.output}`);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
