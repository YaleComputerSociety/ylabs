import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { materializeEntity } from '../scrapers/entityMaterializer';
import { appendObservations, getSourceByName } from '../scrapers/observationStore';
import { syncEntity } from '../services/meiliSyncService';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { buildResearchEntityPublicDescriptionRepresentation } from '../services/researchEntityPublicDescription';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SOURCE_NAME = 'lab-microsite-description-llm';
const RESTORE_CONFIDENCE = 0.9;

// Lab-microsite research homes whose genuine research prose was captured by an
// earlier lab-microsite-description-llm scrape but later superseded (latest-wins)
// by a junk extraction (PI CV-bio, page chrome, clinical-trial criteria), leaving
// the served description blank and the entity gated. Each entity's own clean
// observation is re-asserted so it wins materialization again. See issue #1807
// for the extractor root cause (length-only description gate).
const TARGET_ENTITY_IDS = [
  '6a058d62ba66f3c14bd858cb', // gao-lab-xg23
  '6a058d8aba66f3c14bd85ba1', // graham-lab-tg296
  '6a058dbfba66f3c14bd85f57', // kaliambou-lab-mk655
  '6a058e04ba66f3c14bd86d7d', // stanley-lab-js2726
  '6a64721118a92957f5bec146', // Yarrow Dunham Lab (nsf-pi)
  '6a058d70ba66f3c14bd859c1', // deamer-md33
];

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const CHROME =
  /\b(?:Title:|Office:|Office Hours|Email:|On Leave|@yale\.edu|data-id=|data-type=|<span|<\/|Adjunct faculty typically)\b/i;
const CLINICAL =
  /\b(?:Be ages?|Smoking cigarettes|be interested in quitting|inclusion criteria)\b/i;
const BIO_COPULA_LEAD =
  /^(?:Dr\.?|Professor|Prof\.?)\s|^[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3}(?:,\s*(?:MD|PhD|Ph\.D\.|M\.D\.))?\s+(?:is|was)\s+(?:a|an|the|Senior|Associate|Assistant|Professor|Emeritus|Research|Adjunct|Lector|Lecturer|Chair|Director|Sterling)\b/u;
const BIO_CREDENTIAL =
  /\b(?:holds a|received (?:his|her|their|a|an)|earned (?:his|her|their|a|an)|completed (?:his|her|their)|graduated|was born|Ph\.D\.\s+(?:from|in)|Sterling Professor|Professor Emeritus)\b/i;
const RESEARCH_VERB =
  /\b(?:studies|study|research(?:es)?|focus(?:es)?|investigat\w+|explore\w*|examine\w*|develop\w+|interested in|works? on|aims? to)\b/i;

function leadSentence(text: string): string {
  return (text.match(/^[^.!?]+[.!?]/)?.[0] || text).slice(0, 220);
}

function isCleanResearchProse(text: string): boolean {
  const value = textValue(text);
  if (value.length < 60) return false;
  if (CHROME.test(value) || CLINICAL.test(value)) return false;
  const lead = leadSentence(value);
  if (BIO_COPULA_LEAD.test(lead) || BIO_CREDENTIAL.test(lead)) return false;
  return RESEARCH_VERB.test(value);
}

function assertDevelopmentTarget(mongoUrl: string | undefined): void {
  if (!mongoUrl) throw new Error('MONGODBURL is not set');
  const parsed = new URL(mongoUrl);
  if (parsed.pathname !== '/Development') {
    throw new Error(
      `Refusing to run: MONGODBURL pathname is "${parsed.pathname}", expected "/Development"`,
    );
  }
}

interface RestorePlan {
  entityId: string;
  slug: string;
  fullDescription: string;
  cardDescription: string;
  sourceUrl: string;
}

async function buildRestorePlan(entityId: string): Promise<RestorePlan | null> {
  const entity = await ResearchEntity.findById(entityId).lean<Record<string, any>>();
  if (!entity) {
    console.warn(`[restore1807] entity ${entityId} not found; skipping`);
    return null;
  }
  const candidates = await Observation.find({ entityId, field: 'fullDescription' }).lean<
    Array<{ value?: unknown; sourceUrl?: unknown }>
  >();
  let best: { full: string; card: string; url: string } | null = null;
  for (const candidate of candidates) {
    const value = textValue(candidate.value);
    if (!isCleanResearchProse(value)) continue;
    let host = '';
    try {
      host = new URL(textValue(candidate.sourceUrl)).hostname;
    } catch {
      host = '';
    }
    if (!/(^|\.)yale\.edu$/i.test(host)) continue;
    const representation = buildResearchEntityPublicDescriptionRepresentation({
      entity: { ...entity, fullDescription: value, shortDescription: '' },
    });
    if (!(representation.quality.full.isUseful && representation.invariant.pass)) continue;
    if (!best || value.length < best.full.length) {
      best = { full: value, card: representation.cardDescription, url: textValue(candidate.sourceUrl) };
    }
  }
  if (!best) {
    console.warn(`[restore1807] ${entity.slug}: no clean own observation; skipping`);
    return null;
  }
  return {
    entityId,
    slug: String(entity.slug),
    fullDescription: best.full,
    cardDescription: best.card,
    sourceUrl: best.url,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  assertDevelopmentTarget(process.env.MONGODBURL);
  await initializeConnections();
  if (mongoose.connection.db?.databaseName !== 'Development') {
    throw new Error(
      `Refusing to run: connected database is "${mongoose.connection.db?.databaseName}", expected "Development"`,
    );
  }

  const plans = (await Promise.all(TARGET_ENTITY_IDS.map(buildRestorePlan))).filter(
    (plan): plan is RestorePlan => plan !== null,
  );

  console.log(`[restore1807] mode=${apply ? 'apply' : 'dry-run'} plans=${plans.length}`);
  for (const plan of plans) {
    console.log(`\n${plan.slug} (${plan.entityId})`);
    console.log(`  sourceUrl: ${plan.sourceUrl}`);
    console.log(`  fullDescription(${plan.fullDescription.length}): ${plan.fullDescription.slice(0, 160)}`);
    console.log(`  cardDescription: ${plan.cardDescription}`);
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to restore.');
    await mongoose.disconnect();
    return;
  }

  const source = await getSourceByName(SOURCE_NAME);
  if (!source) throw new Error(`source "${SOURCE_NAME}" not found`);
  const runId = new mongoose.Types.ObjectId().toString();

  const outcomes: Array<{ slug: string; tier: unknown }> = [];
  for (const plan of plans) {
    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityId: plan.entityId,
          entityKey: plan.slug,
          field: 'fullDescription',
          value: plan.fullDescription,
          sourceUrl: plan.sourceUrl,
          confidenceOverride: RESTORE_CONFIDENCE,
        },
        {
          entityType: 'researchEntity',
          entityId: plan.entityId,
          entityKey: plan.slug,
          field: 'shortDescription',
          value: plan.cardDescription,
          sourceUrl: plan.sourceUrl,
          confidenceOverride: RESTORE_CONFIDENCE,
        },
      ],
      {
        sourceId: String(source._id),
        sourceName: SOURCE_NAME,
        scrapeRunId: runId,
        sourceWeight: RESTORE_CONFIDENCE,
        dryRun: false,
      },
    );

    await materializeEntity(
      'researchEntity',
      { entityKey: plan.slug },
      { dryRun: false, writeOnlyFields: ['fullDescription', 'shortDescription'] },
    );

    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'dry-run',
      recordIds: [plan.entityId],
    });
    await applyStudentVisibilityGatePlans(gatePlans);

    const after = await ResearchEntity.findById(plan.entityId).lean<Record<string, any>>();
    if (after) await syncEntity('researchEntity', after);
    outcomes.push({ slug: plan.slug, tier: after?.studentVisibilityTier });
    console.log(`applied ${plan.slug}: tier=${String(after?.studentVisibilityTier)}`);
  }

  console.log(`\n[restore1807] done. ${outcomes.filter((o) => o.tier === 'student_ready').length} promoted.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('[restore1807] failed:', sanitizeLogValue(error));
  await mongoose.disconnect();
  process.exitCode = 1;
});
