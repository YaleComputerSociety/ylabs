/**
 * Directory-index description cleanup (issues #535 and #487).
 *
 * #517 stopped new scrapes from selecting the Yale School of Medicine "A-Z
 * index" lab-website boilerplate as a research description, but existing stored
 * records kept it and still rendered it. This backfill cleans those stored
 * records: for an entity whose fullDescription/shortDescription is the
 * directory-index boilerplate it re-derives a real description from the entity's
 * own official research home via the deterministic official-prose path (#528),
 * and clears the boilerplate when no groundable description exists. It also
 * strips scraped YSM profile-widget page-chrome ("<Topic> N YSM Researchers View
 * N Related Publications") out of researchAreas (#487). Touched entities have
 * their student visibility recomputed so a cleared record drops out of
 * student-ready instead of presenting an empty card.
 *
 * Non-production defaults to dry-run. Apply requires
 * --confirm-directory-index-descriptions and is blocked against production
 * unless CONFIRM_PROD_SCRAPE=true.
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
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planDirectoryIndexCleanup,
  filterCleanupPlanByManualLocks,
  type DirectoryIndexCleanupAction,
} from './clearDirectoryIndexDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'lab-microsite-description-llm';
const AZ_DESCRIPTION_PATTERN = /A[–—-]?Z index|lists Yale School of Medicine lab websites/i;
const AREA_CHROME_PATTERN = /YSM\s+Researchers?\s*View/i;

export interface ClearDirectoryIndexDescriptionsOptions {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

export function parseClearDirectoryIndexDescriptionsArgs(
  argv: string[],
): ClearDirectoryIndexDescriptionsOptions {
  const options: ClearDirectoryIndexDescriptionsOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-directory-index-descriptions') options.confirm = true;
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

interface CleanupEntityDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  fullDescription?: unknown;
  shortDescription?: unknown;
  researchAreas?: unknown;
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
  doc: CleanupEntityDoc,
  fetchPage: FetchPageFn,
  log: (message: string) => void,
): Promise<{ fullDescription: string; shortDescription: string; sourceUrl: string } | null> {
  const [candidate] = candidateDescriptionLabsFromDocs([doc]);
  if (!candidate?.sourceUrls?.length) return null;
  const kind: DescriptionEntityKind = isFacultyResearchTextEntity({
    entityType: doc.entityType,
    kind: doc.kind,
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
    // Only accept a re-derived description that survives the same public
    // sanitizer the read path applies, so we never replace the boilerplate with
    // appointment/chrome text that would just be stripped or fail the gate.
    if (!publicResearchEntityDescriptionText(officialProse.fullDescription)) continue;

    return {
      fullDescription: officialProse.fullDescription,
      shortDescription: officialProse.shortDescription || '',
      sourceUrl: page.url,
    };
  }
  return null;
}

export interface ClearDirectoryIndexDescriptionsResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  descriptionsReDerived: number;
  descriptionsCleared: number;
  researchAreasStripped: number;
  entitiesChanged: number;
  visibilityTierChanges: number;
  samples: Array<{
    slug?: string;
    descriptionAction: DirectoryIndexCleanupAction;
    strippedResearchAreas: boolean;
    fullPreview?: string;
  }>;
}

const clip = (value: string): string => (value.length <= 160 ? value : `${value.slice(0, 159)}…`);

export async function runClearDirectoryIndexDescriptions(options: {
  dryRun: boolean;
  fetchPage?: FetchPageFn;
  log?: (message: string) => void;
}): Promise<ClearDirectoryIndexDescriptionsResult> {
  const fetchPage = options.fetchPage || defaultFetchPage;
  const log = options.log || ((message: string) => console.log(message));

  const docs = (await ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [
        { fullDescription: AZ_DESCRIPTION_PATTERN },
        { shortDescription: AZ_DESCRIPTION_PATTERN },
        { researchAreas: AREA_CHROME_PATTERN },
      ],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      fullDescription: 1,
      shortDescription: 1,
      researchAreas: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      manuallyLockedFields: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as CleanupEntityDoc[];

  const result: ClearDirectoryIndexDescriptionsResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: docs.length,
    descriptionsReDerived: 0,
    descriptionsCleared: 0,
    researchAreasStripped: 0,
    entitiesChanged: 0,
    visibilityTierChanges: 0,
    samples: [],
  };

  const source = options.dryRun ? null : await getSourceByName(SOURCE_NAME);
  const backfillRunId = new mongoose.Types.ObjectId().toString();
  const touchedIds: string[] = [];

  for (const doc of docs) {
    const entityInput = {
      id: String(doc._id),
      slug: doc.slug,
      fullDescription: doc.fullDescription,
      shortDescription: doc.shortDescription,
      researchAreas: doc.researchAreas,
    };
    const hasChromeDescription =
      planDirectoryIndexCleanup(entityInput, null).descriptionAction !== 'unchanged';

    const reDerived = hasChromeDescription
      ? await reDeriveDescriptionFromOfficialSource(doc, fetchPage, log)
      : null;

    const plan = planDirectoryIndexCleanup(
      entityInput,
      reDerived
        ? { fullDescription: reDerived.fullDescription, shortDescription: reDerived.shortDescription }
        : null,
    );

    const filtered = filterCleanupPlanByManualLocks(plan, doc.manuallyLockedFields);
    if (!filtered.hasWrites) continue;

    if (filtered.reDerivedDescription) result.descriptionsReDerived += 1;
    if (filtered.clearedDescription) result.descriptionsCleared += 1;
    if (filtered.strippedResearchAreas) result.researchAreasStripped += 1;
    result.entitiesChanged += 1;
    touchedIds.push(String(doc._id));

    if (result.samples.length < 25) {
      result.samples.push({
        slug: doc.slug,
        descriptionAction: filtered.descriptionAction,
        strippedResearchAreas: filtered.strippedResearchAreas,
        fullPreview:
          typeof filtered.set.fullDescription === 'string'
            ? clip(filtered.set.fullDescription)
            : undefined,
      });
    }

    if (!options.dryRun) {
      if (filtered.reDerivedDescription && reDerived && source) {
        const observations = descriptionExtractionToObservations(
          {
            fullDescription: reDerived.fullDescription,
            shortDescription: reDerived.shortDescription,
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
            sourceWeight: 0.82,
            dryRun: false,
          });
        }
      }
      await ResearchEntity.updateOne({ _id: doc._id }, { $set: filtered.set });
    }
  }

  if (!options.dryRun && touchedIds.length > 0) {
    const gate = await runStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: touchedIds,
    });
    result.visibilityTierChanges = gate.counts.changed;
  }

  return result;
}

function writeReport(options: ClearDirectoryIndexDescriptionsOptions, payload: unknown): void {
  if (!options.output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(options.output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
  console.log(`Saved directory-index description cleanup report to ${safeOutput}`);
}

async function main(): Promise<void> {
  const options = parseClearDirectoryIndexDescriptionsArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply requires --confirm-directory-index-descriptions.');
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'directory-index description cleanup',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runClearDirectoryIndexDescriptions({ dryRun: options.dryRun });
    writeReport(options, {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      result,
    });
    console.log(JSON.stringify(result, null, 2));
    if (apply && result.entitiesChanged > 0) {
      console.log(
        'Rebuild the Meilisearch research index so search drops the cleaned descriptions and areas.',
      );
    }
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
