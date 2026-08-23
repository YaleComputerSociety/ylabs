/**
 * Shared generic center-description repair (issue #1056).
 *
 * A pre-provenance write path stored an identical, non-specific fullDescription
 * on two distinct Jackson School centers (Blue Center / Johnson Center). Neither
 * matches the center's own page, and the shared copy misrepresents both. This
 * backfill targets the narrow, self-identifying defect class: active
 * organization-kind entities (center/institute/program/initiative) whose
 * fullDescription is (a) shared verbatim with another active entity and (b)
 * carries no per-field provenance. For each it re-derives a real description
 * from the entity's OWN official source via the deterministic official-prose
 * path (the same path #487/#535 use), writing durable observations so the
 * materializer resolves them normally; when no groundable description exists it
 * clears the shared copy so the entity drops out of student-ready instead of
 * presenting wrong shared text. Touched entities have their student visibility
 * recomputed and their Meilisearch documents re-synced.
 *
 * Non-production defaults to dry-run. Apply requires
 * --confirm-shared-center-descriptions and is blocked against production unless
 * CONFIRM_PROD_SCRAPE=true.
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
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  isFacultyResearchTextEntity,
  publicResearchEntityDescriptionText,
} from '../utils/researchEntityDescriptionText';
import type { DescriptionEntityKind } from '../utils/researchHomeDescriptionSelection';
import {
  extractOfficialResearchDescription,
  isDescriptionGroundedInSource,
} from '../utils/officialResearchDescription';
import { extractLabHomepageDescription } from '../scrapers/sources/ysmAtoZScraper';
import {
  candidateDescriptionLabsFromDocs,
  descriptionExtractionToObservations,
} from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  normalizeDescriptionKey,
  planSharedGenericRewrite,
  selectSharedGenericTargets,
  type ReDerivedDescription,
} from './rederiveSharedCenterDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'lab-microsite-description-llm';
const SOURCE_WEIGHT = 0.82;

interface CenterEntityDoc {
  _id: unknown;
  id: string;
  slug?: string;
  kind?: string;
  fullDescription?: unknown;
  fieldProvenance?: Record<string, unknown> | null;
  name?: string;
  displayName?: string;
  entityType?: string;
  shortDescription?: unknown;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  manuallyLockedFields?: string[];
}

export interface FetchedPage {
  url: string;
  html: string;
}
export type FetchPageFn = (url: string) => Promise<FetchedPage | null>;

async function defaultFetchPage(url: string): Promise<FetchedPage | null> {
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

async function reDeriveDescriptionFromOfficialSource(
  doc: CenterEntityDoc,
  fetchPage: FetchPageFn,
  log: (message: string) => void,
): Promise<{ fullDescription: string; shortDescription: string; sourceUrl: string } | null> {
  const [candidate] = candidateDescriptionLabsFromDocs([doc]);
  if (!candidate?.sourceUrls?.length) return null;
  const kind: DescriptionEntityKind = isFacultyResearchTextEntity({
    entityType: doc.entityType,
    kind: typeof doc.kind === 'string' ? doc.kind : undefined,
  })
    ? 'person'
    : 'organization';

  for (const sourceUrl of candidate.sourceUrls) {
    let page: FetchedPage | null = null;
    try {
      page = await fetchPage(sourceUrl);
    } catch (error) {
      log(`[${doc.slug ?? 'entity'}] source fetch failed: ${sanitizeLogValue(error)}`);
      continue;
    }
    if (!page?.html) continue;

    const embedded = extractLabHomepageDescription(page.html, { kind });
    const officialProse = embedded?.description
      ? { fullDescription: embedded.description, shortDescription: embedded.shortDescription || '' }
      : extractOfficialResearchDescription(page.html, { kind });
    if (!officialProse?.fullDescription) continue;
    if (!isDescriptionGroundedInSource(officialProse.fullDescription, page.html)) continue;
    if (!publicResearchEntityDescriptionText(officialProse.fullDescription)) continue;

    return {
      fullDescription: officialProse.fullDescription,
      shortDescription: officialProse.shortDescription || '',
      sourceUrl: page.url,
    };
  }
  return null;
}

export interface SharedCenterDescriptionResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  descriptionsReDerived: number;
  descriptionsCleared: number;
  entitiesChanged: number;
  visibilityTierChanges: number;
  meiliSynced: number;
  samples: Array<{
    slug?: string;
    action: 're-derived' | 'cleared';
    sourceUrl?: string;
    fullPreview?: string;
  }>;
}

const clip = (value: string): string => (value.length <= 200 ? value : `${value.slice(0, 199)}…`);

export async function runRederiveSharedCenterDescriptions(options: {
  dryRun: boolean;
  fetchPage?: FetchPageFn;
  syncMeili?: boolean;
  log?: (message: string) => void;
}): Promise<SharedCenterDescriptionResult> {
  const fetchPage = options.fetchPage || defaultFetchPage;
  const syncMeili = options.syncMeili !== false;
  const log = options.log || ((message: string) => console.log(message));

  const activeDocs = (await ResearchEntity.find(
    { archived: { $ne: true } },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      fullDescription: 1,
      shortDescription: 1,
      fieldProvenance: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      manuallyLockedFields: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as unknown as CenterEntityDoc[];

  const withId = activeDocs.map((doc) => ({ ...doc, id: String(doc._id) }));
  const targets = selectSharedGenericTargets(withId) as CenterEntityDoc[];

  const result: SharedCenterDescriptionResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: targets.length,
    descriptionsReDerived: 0,
    descriptionsCleared: 0,
    entitiesChanged: 0,
    visibilityTierChanges: 0,
    meiliSynced: 0,
    samples: [],
  };

  const source = options.dryRun ? null : await getSourceByName(SOURCE_NAME);
  const backfillRunId = new mongoose.Types.ObjectId().toString();
  const touchedIds: string[] = [];

  for (const doc of targets) {
    const locked = new Set(
      Array.isArray(doc.manuallyLockedFields) ? doc.manuallyLockedFields : [],
    );
    if (locked.has('fullDescription')) continue;

    const reDerived = await reDeriveDescriptionFromOfficialSource(doc, fetchPage, log);
    // A re-derived description that is itself still shared verbatim with another
    // entity would just recreate the defect - fall back to clearing.
    const usableReDerived: ReDerivedDescription | null =
      reDerived &&
      normalizeDescriptionKey(reDerived.fullDescription) !==
        normalizeDescriptionKey(doc.fullDescription)
        ? { fullDescription: reDerived.fullDescription, shortDescription: reDerived.shortDescription }
        : null;

    const plan = planSharedGenericRewrite(usableReDerived);
    if (locked.has('shortDescription')) delete plan.set.shortDescription;
    if (Object.keys(plan.set).length === 0) continue;

    if (plan.action === 're-derived') result.descriptionsReDerived += 1;
    else result.descriptionsCleared += 1;
    result.entitiesChanged += 1;
    touchedIds.push(String(doc._id));

    if (result.samples.length < 25) {
      result.samples.push({
        slug: doc.slug,
        action: plan.action,
        sourceUrl: reDerived?.sourceUrl,
        fullPreview:
          typeof plan.set.fullDescription === 'string' && plan.set.fullDescription
            ? clip(plan.set.fullDescription)
            : undefined,
      });
    }

    if (!options.dryRun) {
      if (plan.action === 're-derived' && reDerived && source) {
        const observations = descriptionExtractionToObservations(
          {
            fullDescription: plan.set.fullDescription,
            shortDescription:
              typeof plan.set.shortDescription === 'string'
                ? plan.set.shortDescription
                : reDerived.shortDescription,
            topics: [],
            methods: [],
          },
          {
            entityId: serializedDocumentId(doc._id),
            entityKey: doc.slug,
            sourceUrl: reDerived.sourceUrl,
          },
        );
        if (observations.length) {
          await appendObservations(observations, {
            sourceId: source._id,
            sourceName: SOURCE_NAME,
            scrapeRunId: backfillRunId,
            sourceWeight: SOURCE_WEIGHT,
            dryRun: false,
          });
        }
      }
      await ResearchEntity.updateOne({ _id: doc._id }, { $set: plan.set });
    }
  }

  if (!options.dryRun && touchedIds.length > 0) {
    const gate = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    result.visibilityTierChanges = gate.counts.changed;

    if (syncMeili) {
      const freshDocs = await ResearchEntity.find({ _id: { $in: touchedIds } }).lean();
      await syncEntities('researchEntity', freshDocs);
      result.meiliSynced = freshDocs.length;
    }
  }

  return result;
}

export interface SharedCenterDescriptionOptions {
  dryRun: boolean;
  confirm: boolean;
  syncMeili: boolean;
  output?: string;
}

export function parseSharedCenterDescriptionArgs(argv: string[]): SharedCenterDescriptionOptions {
  const options: SharedCenterDescriptionOptions = {
    dryRun: true,
    confirm: false,
    syncMeili: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-shared-center-descriptions') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg === '--output') {
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

function writeReport(options: SharedCenterDescriptionOptions, payload: unknown): void {
  if (!options.output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(options.output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
  console.log(`Saved shared-center description repair report to ${safeOutput}`);
}

async function main(): Promise<void> {
  const options = parseSharedCenterDescriptionArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply requires --confirm-shared-center-descriptions.');
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'shared-center description repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runRederiveSharedCenterDescriptions({
      dryRun: options.dryRun,
      syncMeili: options.syncMeili,
    });
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
