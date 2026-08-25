import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { syncEntities } from '../services/meiliSyncService';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { htmlToText } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  fetchablePageUrls,
  groundMethods,
  parseMethodsExtraction,
  selectMethodsBackfillTargets,
  hasFetchablePageSource,
  type MethodsBackfillCandidateDoc,
} from './backfillResearchEntityMethodsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PAGE_SOURCE_NAME = 'lab-microsite-description-llm';
const DESCRIPTION_SOURCE_NAME = 'research-entity-description-methods-llm';
const DESCRIPTION_SOURCE_WEIGHT = 0.5;
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_PROMPT_CHARS = 40_000;

const METHODS_SYSTEM_PROMPT =
  'You are an extractor, not a writer. From the provided text, list the concrete research methods, ' +
  'techniques, instruments, assays, or computational and experimental approaches that the text ' +
  'explicitly names. Copy each term as it appears. Never invent, infer, generalize, or add methods ' +
  'that are not named in the text. Return JSON of the form {"methods": string[]} with an empty ' +
  'array when the text names no concrete methods.';

interface CallMethodsLLMInput {
  model: string;
  apiKey: string;
  sourceText: string;
  contextLabel: string;
}

type CallMethodsLLMFn = (input: CallMethodsLLMInput) => Promise<string[]>;
type FetchPageFn = (url: string) => Promise<{ url: string; html: string } | null>;

async function defaultFetchPage(url: string): Promise<{ url: string; html: string } | null> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 10_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  return { url: res.request?.res?.responseUrl || safeUrlText, html: String(res.data || '') };
}

async function defaultCallMethodsLLM(input: CallMethodsLLMInput): Promise<string[]> {
  const safeText = redactDirectContactInfo(input.sourceText).slice(0, MAX_PROMPT_CHARS);
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: METHODS_SYSTEM_PROMPT },
        { role: 'user', content: [input.contextLabel, safeText].join('\n\n') },
      ],
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') return [];
  return parseMethodsExtraction(content);
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export interface MethodsBackfillOptions {
  dryRun: boolean;
  confirm: boolean;
  limit: number;
  offset: number;
  syncMeili: boolean;
  output?: string;
}

export interface MethodsBackfillDeps {
  fetchPage?: FetchPageFn;
  callLLM?: CallMethodsLLMFn;
  apiKey?: string;
  model?: string;
}

interface MethodsBackfillSample {
  slug?: string;
  entityType?: string;
  phase: 'page' | 'description';
  sourceUrl?: string;
  methods: string[];
}

export interface MethodsBackfillResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  attempted: number;
  filledFromPage: number;
  filledFromDescription: number;
  entitiesChanged: number;
  meiliSynced: number;
  pageFetchFailures: number;
  samples: MethodsBackfillSample[];
}

export async function runMethodsBackfill(
  options: MethodsBackfillOptions,
  deps: MethodsBackfillDeps = {},
): Promise<MethodsBackfillResult> {
  const fetchPage = deps.fetchPage || defaultFetchPage;
  const callLLM = deps.callLLM || defaultCallMethodsLLM;
  const apiKey = deps.apiKey || process.env.OPENAI_API_KEY;
  const model = deps.model || DEFAULT_MODEL;
  const log = (message: string): void => console.log(message);

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for the methods backfill.');
  }

  const docs = (await ResearchEntity.find(
    { archived: { $ne: true } },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      studentVisibilityTier: 1,
      methods: 1,
      fullDescription: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      sourceLinkHealth: 1,
      manuallyLockedFields: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as unknown as MethodsBackfillCandidateDoc[];

  const targets = selectMethodsBackfillTargets(docs).slice(
    options.offset,
    options.offset + options.limit,
  );

  const result: MethodsBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: targets.length,
    attempted: 0,
    filledFromPage: 0,
    filledFromDescription: 0,
    entitiesChanged: 0,
    meiliSynced: 0,
    pageFetchFailures: 0,
    samples: [],
  };

  const pageSource = options.dryRun ? null : await getSourceByName(PAGE_SOURCE_NAME);
  const descriptionSource = options.dryRun ? null : await getSourceByName(DESCRIPTION_SOURCE_NAME);
  if (!options.dryRun && !pageSource) {
    throw new Error(`Source "${PAGE_SOURCE_NAME}" is not seeded; cannot append page observations.`);
  }
  if (!options.dryRun && !descriptionSource) {
    throw new Error(
      `Source "${DESCRIPTION_SOURCE_NAME}" is not seeded; run the source-coverage seed first.`,
    );
  }

  const backfillRunId = new mongoose.Types.ObjectId().toString();
  const touchedIds: string[] = [];

  for (const doc of targets) {
    result.attempted += 1;
    const slug = doc.slug;
    const entityId = serializedDocumentId(doc._id);

    let grounded: string[] = [];
    let phase: 'page' | 'description' | null = null;
    let sourceUrl: string | undefined;

    if (hasFetchablePageSource(doc)) {
      for (const url of fetchablePageUrls(doc)) {
        let page: { url: string; html: string } | null = null;
        try {
          page = await fetchPage(url);
        } catch (error) {
          result.pageFetchFailures += 1;
          log(`[${slug || 'candidate'}] page fetch failed: ${sanitizeLogValue(error)}`);
          continue;
        }
        if (!page?.html) continue;
        const pageText = htmlToText(page.html);
        if (pageText.length < 120) continue;
        const raw = await callLLM({
          model,
          apiKey,
          sourceText: pageText,
          contextLabel: `Research home: ${textValue(doc.name || doc.displayName)}`,
        });
        const groundedFromPage = groundMethods(raw, pageText);
        if (groundedFromPage.length > 0) {
          grounded = groundedFromPage;
          phase = 'page';
          sourceUrl = page.url;
          break;
        }
      }
    }

    if (grounded.length === 0) {
      const description = textValue(doc.fullDescription);
      if (description.length >= 120) {
        const raw = await callLLM({
          model,
          apiKey,
          sourceText: description,
          contextLabel: `Research home: ${textValue(doc.name || doc.displayName)}`,
        });
        const groundedFromDescription = groundMethods(raw, description);
        if (groundedFromDescription.length > 0) {
          grounded = groundedFromDescription;
          phase = 'description';
        }
      }
    }

    if (!phase || grounded.length === 0) continue;

    if (phase === 'page') result.filledFromPage += 1;
    else result.filledFromDescription += 1;
    result.entitiesChanged += 1;

    if (result.samples.length < 200) {
      result.samples.push({ slug, entityType: doc.entityType, phase, sourceUrl, methods: grounded });
    }

    if (options.dryRun) continue;

    const isPagePhase = phase === 'page';
    const source = isPagePhase ? pageSource : descriptionSource;
    if (!source) continue;
    const sourceName = isPagePhase ? PAGE_SOURCE_NAME : DESCRIPTION_SOURCE_NAME;
    const confidenceOverride = isPagePhase
      ? sourceUrl && /\/profile\//i.test(sourceUrl)
        ? 0.55
        : 0.82
      : DESCRIPTION_SOURCE_WEIGHT;

    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityId,
          entityKey: slug,
          field: 'methods',
          value: grounded,
          sourceUrl: sourceUrl || undefined,
          confidenceOverride,
        },
      ],
      {
        sourceId: source._id,
        sourceName,
        scrapeRunId: backfillRunId,
        sourceWeight: source.defaultWeight ?? DESCRIPTION_SOURCE_WEIGHT,
        dryRun: false,
      },
    );

    await materializeEntity(
      'researchEntity',
      entityId ? { entityId } : { entityKey: slug },
      { dryRun: false, writeOnlyFields: ['methods'] },
    );
    if (entityId) touchedIds.push(entityId);
  }

  if (!options.dryRun && options.syncMeili && touchedIds.length > 0) {
    const freshDocs = await ResearchEntity.find({
      _id: { $in: touchedIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    await syncEntities('researchEntity', freshDocs);
    result.meiliSynced = freshDocs.length;
  }

  return result;
}

export function parseMethodsBackfillArgs(argv: string[]): MethodsBackfillOptions {
  const options: MethodsBackfillOptions = {
    dryRun: true,
    confirm: false,
    limit: Number.POSITIVE_INFINITY,
    offset: 0,
    syncMeili: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-methods-backfill') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg === '--limit') {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--offset') {
      options.offset = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--offset=')) {
      options.offset = Number(arg.slice('--offset='.length));
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown backfillResearchEntityMethods argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.limit) && !options.dryRun) {
    throw new Error('--limit is required when --apply is set.');
  }
  if (Number.isNaN(options.limit) || Number.isNaN(options.offset)) {
    throw new Error('--limit and --offset must be numbers.');
  }
  return options;
}

function writeReport(options: MethodsBackfillOptions, payload: unknown): void {
  if (!options.output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(options.output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
  console.log(`Saved methods backfill report to ${safeOutput}`);
}

async function main(): Promise<void> {
  const options = parseMethodsBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply requires --confirm-methods-backfill.');
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity methods backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runMethodsBackfill(options);
    writeReport(options, {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      result,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
