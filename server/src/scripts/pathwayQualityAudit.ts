import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { Listing } from '../models/listing';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import {
  buildPathwayQualityAudit,
  type PathwayQualityEntityContext,
  type PathwayQualityListingFact,
  type PathwayQualityPathwayFact,
  type PathwayQualityRouteFact,
} from './pathwayQualityAuditCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface PathwayQualityAuditCliOptions {
  sampleLimit: number;
  output?: string;
}

export function parsePathwayQualityAuditArgs(argv: string[]): PathwayQualityAuditCliOptions {
  const options: PathwayQualityAuditCliOptions = { sampleLimit: 20 };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    const output = value?.trim();
    if (!output || output.startsWith('--')) throw new Error('--output requires a path');
    return output;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--sample-limit=')) {
      options.sampleLimit = parseNonNegativeInteger(
        arg.slice('--sample-limit='.length),
        '--sample-limit',
      );
    } else if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown pathway quality audit argument: ${arg}`);
    }
  }
  return options;
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

export function writePathwayQualityAuditOutput(
  report: unknown,
  output?: string,
): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildPathwayQualityAuditOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: PathwayQualityAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: PathwayQualityAuditCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function strings(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => stringId(value)).filter((value) => value.trim().length > 0)
    : [];
}

function activeListingFilter(now = new Date()): Record<string, unknown> {
  return {
    archived: { $ne: true },
    confirmed: { $ne: false },
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gte: now } }],
  };
}

function countMap(rows: Array<{ _id: unknown; count: number }>): Map<string, number> {
  return new Map(rows.map((row) => [stringId(row._id), row.count]));
}

async function aggregateCountMap(
  model: mongoose.Model<any>,
  match: Record<string, unknown>,
): Promise<Map<string, number>> {
  const rows = await model.aggregate<{ _id: unknown; count: number }>([
    { $match: match },
    { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
  ]);
  return countMap(rows);
}

async function buildEntityContexts(entityIds: unknown[]): Promise<PathwayQualityEntityContext[]> {
  const [entities, leads, signals, publicRoutes] = await Promise.all([
    ResearchEntity.find({ _id: { $in: entityIds } }).select('_id sourceUrls websiteUrl').lean(),
    aggregateCountMap(ResearchGroupMember, {
      researchEntityId: { $in: entityIds },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director', 'core-faculty'] },
      isCurrentMember: { $ne: false },
    }),
    aggregateCountMap(AccessSignal, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
    }),
    aggregateCountMap(ContactRoute, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
      visibility: 'PUBLIC',
    }),
  ]);

  return (entities as any[]).map((entity) => {
    const id = stringId(entity._id);
    const sourceUrlCount = new Set([...strings(entity.sourceUrls), stringId(entity.websiteUrl)])
      .size;
    return {
      researchEntityId: id,
      sourceUrlCount,
      leadCount: leads.get(id) || 0,
      accessSignalCount: signals.get(id) || 0,
      publicContactRouteCount: publicRoutes.get(id) || 0,
    };
  });
}

async function main(): Promise<void> {
  const options = parsePathwayQualityAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'pathway:quality-audit',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const [pathwayDocs, routeDocs, listingDocs] = await Promise.all([
    EntryPathway.find({
      archived: { $ne: true },
      status: { $nin: ['NOT_CURRENTLY_AVAILABLE', 'NO_EVIDENCE'] },
    })
      .select('_id researchEntityId pathwayType status evidenceStrength derivationKey sourceUrls sourceEvidenceIds')
      .lean(),
    ContactRoute.find({ archived: { $ne: true }, routeType: 'OFFICIAL_APPLICATION' })
      .select('_id researchEntityId entryPathwayId routeType sourceUrl sourceEvidenceIds')
      .lean(),
    Listing.find(activeListingFilter())
      .select('_id researchEntityId researchGroupId')
      .lean(),
  ]);

  const listingIds = (listingDocs as any[]).map((listing) => listing._id);
  const postedListingIds = new Set(
    (
      await PostedOpportunity.distinct('listingId', {
        listingId: { $in: listingIds },
        archived: { $ne: true },
      })
    ).map(stringId),
  );
  const entityIds = Array.from(
    new Set([
      ...(pathwayDocs as any[]).map((pathway) => stringId(pathway.researchEntityId)),
      ...(routeDocs as any[]).map((route) => stringId(route.researchEntityId)),
    ]),
  ).filter((id) => mongoose.Types.ObjectId.isValid(id));
  const contexts = await buildEntityContexts(
    entityIds.map((id) => new mongoose.Types.ObjectId(id)),
  );

  const pathways: PathwayQualityPathwayFact[] = (pathwayDocs as any[]).map((pathway) => ({
    id: stringId(pathway._id),
    researchEntityId: stringId(pathway.researchEntityId),
    pathwayType: pathway.pathwayType,
    status: pathway.status,
    evidenceStrength: pathway.evidenceStrength,
    derivationKey: pathway.derivationKey,
    sourceUrls: strings(pathway.sourceUrls),
    sourceEvidenceIds: strings(pathway.sourceEvidenceIds),
  }));
  const routes: PathwayQualityRouteFact[] = (routeDocs as any[]).map((route) => ({
    id: stringId(route._id),
    researchEntityId: stringId(route.researchEntityId),
    entryPathwayId: route.entryPathwayId ? stringId(route.entryPathwayId) : undefined,
    routeType: route.routeType,
    sourceUrl: route.sourceUrl,
    sourceEvidenceIds: strings(route.sourceEvidenceIds),
  }));
  const listings: PathwayQualityListingFact[] = (listingDocs as any[]).map((listing) => ({
    id: stringId(listing._id),
    researchEntityId: stringId(listing.researchEntityId || listing.researchGroupId),
    hasPostedOpportunity: postedListingIds.has(stringId(listing._id)),
  }));

  const report = buildPathwayQualityAudit({
    pathways,
    routes,
    listings,
    entityContexts: contexts,
    sampleLimit: options.sampleLimit,
  });

  const output = buildPathwayQualityAuditOutput(report, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writePathwayQualityAuditOutput(output, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
