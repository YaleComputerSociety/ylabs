/**
 * #1858: corpus-wide, read-only sweep for research homes whose stored
 * `name`/`displayName` is a PI faculty title/credential line rather than a
 * research-home name.
 *
 * #1819/#1820 added a deterministic person-title guard to `usefulLabName` so
 * the lab-microsite extractor can no longer mint such a name, but that guard
 * is ingest-time only: records materialized by pre-guard runs keep serving the
 * title. This reports every stored name the guard would now reject, together
 * with the observation provenance backing it and the best remaining
 * replacement candidate, so each hit can be verified individually before any
 * write.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { Observation } from '../models/observation';
import { isPersonTitleOrCredentialName } from '../scrapers/sources/labMicrositeDescriptionLLMExtractor';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface TitleAsNameHit {
  entityId: string;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  archived?: boolean;
  studentVisibilityTier?: string;
  nameFieldsRejected: string[];
  nameObservations: Array<{
    observationId: string;
    field: string;
    value: string;
    sourceName?: string;
    sourceUrl?: string;
    confidence?: number;
    superseded?: boolean;
    rejectedByGuard: boolean;
  }>;
  acceptableNameCandidates: string[];
}

export interface TitleAsNameSweepResult {
  scannedEntities: number;
  hits: TitleAsNameHit[];
  hitsByTier: Record<string, number>;
  hitsByEntityType: Record<string, number>;
  archivedHits: number;
}

interface EntityDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  archived?: boolean;
  studentVisibilityTier?: string;
}

const isTitleAsName = (value?: string): boolean =>
  Boolean(value && value.trim() && isPersonTitleOrCredentialName(value));

export async function runTitleAsNameSweep(): Promise<TitleAsNameSweepResult> {
  const docs = (await ResearchEntity.find(
    {},
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      archived: 1,
      studentVisibilityTier: 1,
    },
  )
    .sort({ _id: 1 })
    .lean()) as unknown as EntityDoc[];

  const result: TitleAsNameSweepResult = {
    scannedEntities: docs.length,
    hits: [],
    hitsByTier: {},
    hitsByEntityType: {},
    archivedHits: 0,
  };

  for (const doc of docs) {
    const nameFieldsRejected: string[] = [];
    if (isTitleAsName(doc.name)) nameFieldsRejected.push('name');
    if (isTitleAsName(doc.displayName)) nameFieldsRejected.push('displayName');
    if (!nameFieldsRejected.length) continue;

    const observations = await Observation.find({
      $or: [{ entityId: doc._id }, ...(doc.slug ? [{ entityKey: doc.slug }] : [])],
      field: { $in: ['name', 'displayName'] },
    })
      .select('_id field value sourceName sourceUrl confidence superseded')
      .lean();

    const nameObservations = observations.map((observation) => {
      const value = typeof observation.value === 'string' ? observation.value : '';
      return {
        observationId: serializedDocumentId(observation._id),
        field: String(observation.field),
        value,
        sourceName: observation.sourceName,
        sourceUrl: observation.sourceUrl,
        confidence: observation.confidence,
        superseded: observation.superseded === true,
        rejectedByGuard: isTitleAsName(value),
      };
    });

    const acceptableNameCandidates = Array.from(
      new Set(
        nameObservations
          .filter((observation) => !observation.rejectedByGuard && observation.value)
          .map((observation) => observation.value),
      ),
    );

    const tier = doc.studentVisibilityTier || 'unknown';
    result.hitsByTier[tier] = (result.hitsByTier[tier] || 0) + 1;
    const entityType = doc.entityType || 'unknown';
    result.hitsByEntityType[entityType] = (result.hitsByEntityType[entityType] || 0) + 1;
    if (doc.archived) result.archivedHits += 1;

    result.hits.push({
      entityId: serializedDocumentId(doc._id),
      slug: doc.slug,
      name: doc.name,
      displayName: doc.displayName,
      entityType: doc.entityType,
      kind: doc.kind,
      archived: doc.archived,
      studentVisibilityTier: doc.studentVisibilityTier,
      nameFieldsRejected,
      nameObservations,
      acceptableNameCandidates,
    });
  }

  return result;
}

function parseOutput(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') return resolveSafeJsonReportOutputPath(argv[i + 1]);
    if (arg.startsWith('--output=')) {
      return resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return undefined;
}

async function main(): Promise<void> {
  const output = parseOutput(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'audit #1858 title-as-name sweep',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; read-only sweep`,
  );

  await initializeConnections();
  try {
    const result = await runTitleAsNameSweep();
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      result,
    };
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(payload, null, 2));
      console.log(`Saved #1858 title-as-name sweep report to ${output}`);
    }
    console.log(
      JSON.stringify(
        {
          scannedEntities: result.scannedEntities,
          hitCount: result.hits.length,
          hitsByTier: result.hitsByTier,
          hitsByEntityType: result.hitsByEntityType,
          archivedHits: result.archivedHits,
        },
        null,
        2,
      ),
    );
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
