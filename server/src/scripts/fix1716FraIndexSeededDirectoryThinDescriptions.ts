/**
 * #1716: 14 student_ready FACULTY_RESEARCH_AREA rows seeded from a bare
 * department faculty-index page (physics/economics/mcdb/astronomy/... `/people`
 * or `/people/faculty`) serve a directory-thin description (an area-echo
 * "Studies <topics>." opener, a dangling roster template, or fewer than 160
 * characters) even though a richer personal/lab sourceUrl was already captured
 * on the same record and never harvested.
 *
 * For each explicitly listed entity this re-derives a description from that
 * richer sourceUrl the same way clearDirectoryIndexDescriptions.ts does, then
 * supersedes every fullDescription/shortDescription observation sourced from
 * a directory-index or department-wide hub page (the same rejection check
 * the write-time guard now applies), so a stale high-confidence roster-echo
 * or wrong-scope department-wide observation (e.g. Mooseker's MCDB-wide
 * undergrad-opportunities page, Lamoreaux's stale pre-guard roster template)
 * can no longer win confidence resolution — without discarding any other,
 * already-good candidate observation on the same entity that simply lost
 * that confidence race. When no groundable description exists, the entity is
 * left with no winning description observation so the student visibility
 * gate holds it at operator_review instead of continuing to serve the
 * echo/graft.
 *
 * Non-production defaults to dry-run. Apply requires
 * --confirm-fix-1716-directory-thin-descriptions and is restricted to the
 * Development database by scriptWriteGuards.
 *
 * Follow-up (required after --apply):
 *   yarn workspace server research-entity:rematerialize \
 *     --slugs=<touched slugs> --only-fields=fullDescription,shortDescription \
 *     --apply --confirm-rematerialize
 */
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
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
  isRejectedDescriptionSourceUrl,
} from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'lab-microsite-description-llm';
const ROLLBACK_REASON =
  'directory-thin FRA description: entity seeded from a bare department faculty-index page, superseded in favor of a re-derived description from its own richer sourceUrl or held for operator_review (#1716)';

// Explicit, pre-audited allowlist (Development, 2026-08-24): student_ready FRA
// rows seeded from a /people(/faculty)? index sourceUrl whose fullDescription
// is an area-echo, a dangling roster template, or under 160 characters, and
// that already carry an unharvested richer personal/lab sourceUrl.
export const TARGET_ENTITY_IDS = [
  '6a056c6414107ca43f8a6c95', // Mark Mooseker
  '6a056c6714107ca43f8a6d0d', // Armita Nourmohammad
  '6a056c6814107ca43f8a6d41', // John Geanakoplos
  '6a056c7814107ca43f8a702b', // Steve Lamoreaux
  '6a056c8514107ca43f8a7265', // Frank van den Bosch
  '6a056c9214107ca43f8a74e3', // Priyamvada Natarajan
  '6a056c9914107ca43f8a762b', // Alan Gerber
  '6a056cb314107ca43f8a7afd', // Earl Bellinger
  '6a056cb314107ca43f8a7b03', // Jeffrey Kenney
  '6a056cb614107ca43f8a7b89', // Malena Rice
  '6a058d0fba66f3c14bd852fd', // Helene Landemore-Jelaca
  '6a0fa55c36027326ae9c0a25', // Sean Barrett
  '6a18fd5af29799329c663fc0', // Leonid Glazman
  // Elizabeth Parker-Magyar (6a22d4d7cc8d8ec7dea21274) was excluded after
  // investigation: her existing fullDescription/shortDescription is not
  // backed by any durable Observation (a legacy write, not a roster-echo),
  // so it is out of scope for this fix and must not be touched by it.
];

interface TargetEntityDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  fullDescription?: string;
  shortDescription?: string;
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

async function reDeriveDescriptionFromRicherSource(
  doc: TargetEntityDoc,
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
    if (!publicResearchEntityDescriptionText(officialProse.fullDescription)) continue;

    return {
      fullDescription: officialProse.fullDescription,
      shortDescription: officialProse.shortDescription || '',
      sourceUrl: page.url,
    };
  }
  return null;
}

export interface Fix1716Result {
  mode: 'dry-run' | 'apply';
  scanned: number;
  descriptionsReDerived: number;
  descriptionsHeldForReview: number;
  observationsSuperseded: number;
  touchedSlugs: string[];
  samples: Array<{
    slug?: string;
    action: 're-derived' | 'held-for-review';
    sourceUrl?: string;
    fullPreview?: string;
  }>;
}

const clip = (value: string): string => (value.length <= 200 ? value : `${value.slice(0, 199)}…`);

export async function runFix1716(options: {
  dryRun: boolean;
  entityIds?: string[];
  fetchPage?: FetchPageFn;
  log?: (message: string) => void;
}): Promise<Fix1716Result> {
  const fetchPage = options.fetchPage || defaultFetchPage;
  const log = options.log || ((message: string) => console.log(message));
  const entityIds = options.entityIds || TARGET_ENTITY_IDS;

  const docs = (await ResearchEntity.find(
    { _id: { $in: entityIds.map((id) => new mongoose.Types.ObjectId(id)) } },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      fullDescription: 1,
      shortDescription: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      manuallyLockedFields: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as unknown as TargetEntityDoc[];

  const result: Fix1716Result = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: docs.length,
    descriptionsReDerived: 0,
    descriptionsHeldForReview: 0,
    observationsSuperseded: 0,
    touchedSlugs: [],
    samples: [],
  };

  const source = options.dryRun ? null : await getSourceByName(SOURCE_NAME);
  const backfillRunId = new mongoose.Types.ObjectId().toString();

  for (const doc of docs) {
    if ((doc.manuallyLockedFields || []).some((f) => f === 'fullDescription' || f === 'shortDescription')) {
      log(`[${doc.slug ?? 'entity'}] skipping: fullDescription/shortDescription manually locked.`);
      continue;
    }

    const reDerived = await reDeriveDescriptionFromRicherSource(doc, fetchPage, log);

    if (reDerived) {
      result.descriptionsReDerived += 1;
    } else {
      result.descriptionsHeldForReview += 1;
    }
    if (doc.slug) result.touchedSlugs.push(doc.slug);

    if (result.samples.length < TARGET_ENTITY_IDS.length) {
      result.samples.push({
        slug: doc.slug,
        action: reDerived ? 're-derived' : 'held-for-review',
        sourceUrl: reDerived?.sourceUrl,
        fullPreview: reDerived ? clip(reDerived.fullDescription) : undefined,
      });
    }

    if (options.dryRun) continue;

    // Observations for this entity may be keyed by entityId or by entityKey
    // (the slug) depending on which scraper wrote them (#1131), so both must
    // be matched or a stale observation written under the other key survives
    // and keeps winning confidence resolution. Every description observation
    // sourced from a directory-index/department-wide hub page (the roster
    // page itself, or a shared "how to get involved" page) is exactly the
    // class of wrong-scope source #1716 is about, regardless of which scrape
    // run produced it or what its exact wording drifted to across runs.
    const candidates = await Observation.find({
      $or: [{ entityId: doc._id }, ...(doc.slug ? [{ entityKey: doc.slug }] : [])],
      field: { $in: ['fullDescription', 'shortDescription'] },
      superseded: { $ne: true },
    })
      .select('_id sourceUrl')
      .lean();
    const staleIds = candidates
      .filter((observation) => isRejectedDescriptionSourceUrl(observation.sourceUrl))
      .map((observation) => observation._id);
    if (staleIds.length > 0) {
      const superseded = await Observation.updateMany(
        { _id: { $in: staleIds } },
        {
          $set: {
            superseded: true,
            rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON },
          },
        },
      );
      result.observationsSuperseded += superseded.modifiedCount || 0;
    }

    if (reDerived && source) {
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
    } else if (staleIds.length > 0) {
      // No groundable re-derivation, and the description we just superseded
      // was itself the wrong-scope observation backing the live text (the
      // supersede step found and killed it above) — so blank the stored
      // fields now rather than leaving that stale text cached on the
      // document. A live entity whose description was never traced to a
      // rejected source in the first place is left untouched: our own
      // re-harvest attempt failing says nothing about whether its existing,
      // differently-sourced description is any good.
      await ResearchEntity.updateOne(
        { _id: doc._id },
        { $set: { fullDescription: '', shortDescription: '' } },
      );
    }
  }

  return result;
}

interface Fix1716Options {
  dryRun: boolean;
  confirm: boolean;
  output?: string;
}

function parseArgs(argv: string[]): Fix1716Options {
  const options: Fix1716Options = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-fix-1716-directory-thin-descriptions') options.confirm = true;
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

function writeReport(options: Fix1716Options, payload: unknown): void {
  if (!options.output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(options.output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
  console.log(`Saved #1716 directory-thin description fix report to ${safeOutput}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply requires --confirm-fix-1716-directory-thin-descriptions.');
  }
  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'fix #1716 FRA directory-thin descriptions',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runFix1716({ dryRun: options.dryRun });
    writeReport(options, {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      result,
    });
    console.log(JSON.stringify(result, null, 2));
    if (apply) {
      console.log(
        `Next: yarn research-entity:rematerialize --slugs=${result.touchedSlugs.join(',')} --only-fields=fullDescription,shortDescription --apply --confirm-rematerialize`,
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
