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
import { Observation } from '../models/observation';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { sourceCoverageRegistry } from '../scrapers/sourceCoverageRegistry';
import {
  buildCoverageAuditRow,
  extractSuspiciousConstraintQuotes,
  summarizeIssueCounts,
  type CoverageAuditCounts,
  type CoverageAuditFacts,
  type CoverageObservationFlags,
} from './researchEntityCoverageAuditCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ResearchEntityCoverageAuditCliOptions {
  slug?: string;
  limit: number;
  minScore: number;
  includeArchived: boolean;
  includeAll: boolean;
  output?: string;
}

interface AuditEntityRecord {
  _id: unknown;
  slug: string;
  name: string;
  kind?: string;
  entityType?: string;
  school?: string;
  description?: string;
  shortDescription?: string;
  fullDescription?: string;
  websiteUrl?: string;
  researchAreas?: string[];
  sourceUrls?: string[];
  acceptanceConfidence?: number;
  undergradEvidenceQuote?: string;
  lastObservedAt?: Date;
}

interface ObservationHint {
  entityId?: string;
  entityKey?: string;
  sourceName: string;
  field: string;
  value: unknown;
  observedAt?: Date;
  sourceUrl?: string;
  confidence?: number;
}

export function parseResearchEntityCoverageAuditArgs(
  argv: string[],
): ResearchEntityCoverageAuditCliOptions {
  const options: ResearchEntityCoverageAuditCliOptions = {
    limit: 50,
    minScore: 1,
    includeArchived: false,
    includeAll: false,
  };
  const parseRequiredOutputPath = (value: string | undefined): string => {
    return resolveSafeJsonReportOutputPath(value);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-archived') {
      options.includeArchived = true;
      continue;
    }
    if (arg === '--all') {
      options.includeAll = true;
      continue;
    }
    if (arg.startsWith('--slug=')) {
      const value = arg.slice('--slug='.length).trim();
      if (value) options.slug = value;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parseInteger(arg.slice('--limit='.length), '--limit', { min: 1 });
      continue;
    }
    if (arg.startsWith('--min-score=')) {
      options.minScore = parseInteger(arg.slice('--min-score='.length), '--min-score', {
        min: 0,
      });
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown research entity coverage audit argument: ${arg}`);
  }

  return options;
}

function parseInteger(value: string, flag: string, options: { min: number }): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || String(parsed) !== value.trim()) {
    const descriptor = options.min === 0 ? 'a non-negative integer' : 'a positive integer';
    throw new Error(`${flag} requires ${descriptor}`);
  }
  return parsed;
}

export function writeResearchEntityCoverageAuditOutput(result: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(result, null, 2)}\n`);
}

export function buildResearchEntityCoverageAuditOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ResearchEntityCoverageAuditCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: ResearchEntityCoverageAuditCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function makeEmptyCounts(): CoverageAuditCounts {
  return {
    researchAreas: 0,
    sourceUrls: 0,
    members: 0,
    pathways: 0,
    publicContactRoutes: 0,
    totalContactRoutes: 0,
    accessSignals: 0,
    postedOpportunities: 0,
    activeListings: 0,
  };
}

function buildObservationFlags(observations: ObservationHint[]): CoverageObservationFlags {
  const suspiciousConstraintQuotes = extractSuspiciousConstraintQuotes(
    observations
      .filter((obs) =>
        ['undergradEvidenceQuote', 'undergradConstraintQuote', 'contactInstructionsQuote'].includes(
          obs.field,
        ),
      )
      .map((obs) => (typeof obs.value === 'string' ? obs.value : '')),
  );

  return {
    hasMicrositeObservation: observations.some(
      (obs) => obs.sourceName === 'lab-microsite-undergrad-llm',
    ),
    hasInferredPiObservation: observations.some(
      (obs) => obs.sourceName === 'dept-faculty-roster' && obs.field === 'inferredPiUserKey',
    ),
    suspiciousConstraintQuotes,
  };
}

function countMap(rows: Array<{ _id: unknown; count: number }>): Map<string, number> {
  return new Map(rows.map((row) => [stringId(row._id), row.count]));
}

function resolveObservationEntitySlug(
  observation: ObservationHint,
  slugByEntityId: Map<string, string>,
  validSlugs: Set<string>,
): string | null {
  const entityId = observation.entityId ? stringId(observation.entityId) : '';
  if (entityId && slugByEntityId.has(entityId)) return slugByEntityId.get(entityId) || null;
  const entityKey = (observation.entityKey || '').trim();
  return entityKey && validSlugs.has(entityKey) ? entityKey : null;
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

async function fetchEntities(filter: Record<string, unknown>) {
  return (await ResearchEntity.find(filter)
    .select(
      '_id slug name kind entityType school description shortDescription fullDescription websiteUrl researchAreas sourceUrls archived',
    )
    .sort({ name: 1 })
    .lean()) as unknown as AuditEntityRecord[];
}

async function buildBulkAudit(options: ResearchEntityCoverageAuditCliOptions) {
  const entityFilter = options.slug
    ? { slug: options.slug }
    : options.includeArchived
      ? {}
      : { archived: { $ne: true } };
  const entities = await fetchEntities(entityFilter);
  const entityIds = entities.map((entity) => entity._id);
  const slugs = entities.map((entity) => entity.slug).filter(Boolean);
  const slugByEntityId = new Map(entities.map((entity) => [stringId(entity._id), entity.slug]));
  const validSlugSet = new Set(slugs);

  const [
    memberCounts,
    pathwayCounts,
    publicRouteCounts,
    totalRouteCounts,
    signalCounts,
    opportunityCounts,
    listingCounts,
    observationHints,
  ] = await Promise.all([
    aggregateCountMap(ResearchGroupMember, { researchEntityId: { $in: entityIds } }),
    aggregateCountMap(EntryPathway, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
    }),
    aggregateCountMap(ContactRoute, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
      visibility: 'PUBLIC',
    }),
    aggregateCountMap(ContactRoute, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
    }),
    aggregateCountMap(AccessSignal, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
    }),
    aggregateCountMap(PostedOpportunity, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
    }),
    aggregateCountMap(Listing, {
      researchEntityId: { $in: entityIds },
      archived: { $ne: true },
    }),
    Observation.find({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      superseded: false,
      $and: [
        {
          $or: [{ entityId: { $in: entityIds } }, { entityKey: { $in: slugs } }],
        },
        {
          $or: [
            { sourceName: 'lab-microsite-undergrad-llm' },
            {
              sourceName: 'dept-faculty-roster',
              field: 'inferredPiUserKey',
            },
          ],
        },
      ],
    })
      .select('entityId entityKey sourceName field value observedAt sourceUrl confidence')
      .lean(),
  ]);

  const observationsBySlug = new Map<string, ObservationHint[]>();
  for (const observation of observationHints as ObservationHint[]) {
    const slug = resolveObservationEntitySlug(observation, slugByEntityId, validSlugSet);
    if (!slug) continue;
    const list = observationsBySlug.get(slug) || [];
    list.push(observation);
    observationsBySlug.set(slug, list);
  }

  const rows = entities
    .map((entity) => {
      const entityId = stringId(entity._id);
      const facts: CoverageAuditFacts = {
        slug: entity.slug,
        name: entity.name,
        kind: entity.kind,
        school: entity.school,
        websiteUrl: entity.websiteUrl,
        description: entity.description,
        shortDescription: entity.shortDescription,
        fullDescription: entity.fullDescription,
        counts: {
          researchAreas: Array.isArray(entity.researchAreas) ? entity.researchAreas.length : 0,
          sourceUrls: Array.isArray(entity.sourceUrls) ? entity.sourceUrls.length : 0,
          members: memberCounts.get(entityId) || 0,
          pathways: pathwayCounts.get(entityId) || 0,
          publicContactRoutes: publicRouteCounts.get(entityId) || 0,
          totalContactRoutes: totalRouteCounts.get(entityId) || 0,
          accessSignals: signalCounts.get(entityId) || 0,
          postedOpportunities: opportunityCounts.get(entityId) || 0,
          activeListings: listingCounts.get(entityId) || 0,
        },
        observationFlags: buildObservationFlags(observationsBySlug.get(entity.slug) || []),
      };
      return buildCoverageAuditRow(facts);
    })
    .filter((row) => (options.includeAll ? true : row.issueScore >= options.minScore))
    .sort((a, b) => b.issueScore - a.issueScore || a.name.localeCompare(b.name));

  const limitedRows = options.slug ? rows : rows.slice(0, options.limit);
  return {
    generatedAt: new Date().toISOString(),
    scope: options.slug ? 'detail-candidate' : 'bulk',
    totalEntitiesScanned: entities.length,
    flaggedEntities: rows.length,
    filters: {
      slug: options.slug || null,
      includeArchived: options.includeArchived,
      includeAll: options.includeAll,
      limit: options.slug ? rows.length : options.limit,
      minScore: options.minScore,
    },
    issueCounts: summarizeIssueCounts(rows),
    rows: limitedRows,
  };
}

async function buildSlugAudit(slug: string) {
  const entity = (await ResearchEntity.findOne({ slug })
    .select(
      '_id slug name kind entityType school description shortDescription fullDescription websiteUrl sourceUrls researchAreas acceptanceConfidence undergradEvidenceQuote lastObservedAt',
    )
    .lean()) as AuditEntityRecord | null;
  if (!entity) {
    return {
      generatedAt: new Date().toISOString(),
      slug,
      found: false,
    };
  }

  const entityId = stringId(entity._id);
  const [
    members,
    pathways,
    signals,
    routes,
    opportunities,
    listings,
    observations,
  ] = await Promise.all([
    ResearchGroupMember.find({ researchEntityId: entity._id })
      .select('userId role isCurrentMember sourceUrl confidence lastObservedAt')
      .lean(),
    EntryPathway.find({ researchEntityId: entity._id, archived: { $ne: true } })
      .select('pathwayType status evidenceStrength studentFacingLabel bestNextStep sourceUrls confidence derivationKey')
      .lean(),
    AccessSignal.find({ researchEntityId: entity._id, archived: { $ne: true } })
      .select('signalType confidence confidenceScore excerpt sourceName sourceUrl observedAt derivationKey')
      .sort({ observedAt: -1 })
      .lean(),
    ContactRoute.find({ researchEntityId: entity._id, archived: { $ne: true } })
      .select('routeType label name role url visibility contactPolicy rationale sourceName sourceUrl observedAt derivationKey')
      .sort({ priority: 1, observedAt: -1 })
      .lean(),
    PostedOpportunity.find({ researchEntityId: entity._id, archived: { $ne: true } })
      .select('title term status applicationUrl sourceUrls derivationKey')
      .lean(),
    Listing.find({ researchEntityId: entity._id, archived: { $ne: true } })
      .select('title deadline website')
      .lean(),
    Observation.find({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      superseded: false,
      $or: [{ entityId: entity._id }, { entityKey: slug }],
    })
      .select('field value sourceName sourceUrl confidence observedAt entityKey')
      .sort({ observedAt: -1 })
      .lean(),
  ]);

  const observationHints = observations as ObservationHint[];
  const coverageFacts: CoverageAuditFacts = {
    slug: entity.slug,
    name: entity.name,
    kind: entity.kind,
    school: entity.school,
    websiteUrl: entity.websiteUrl,
    description: entity.description,
    shortDescription: entity.shortDescription,
    fullDescription: entity.fullDescription,
    counts: {
      researchAreas: Array.isArray(entity.researchAreas) ? entity.researchAreas.length : 0,
      sourceUrls: Array.isArray(entity.sourceUrls) ? entity.sourceUrls.length : 0,
      members: members.length,
      pathways: pathways.length,
      publicContactRoutes: routes.filter((route) => route.visibility === 'PUBLIC').length,
      totalContactRoutes: routes.length,
      accessSignals: signals.length,
      postedOpportunities: opportunities.length,
      activeListings: listings.length,
    },
    observationFlags: buildObservationFlags(observationHints),
    signalTypes: signals.map((signal) => signal.signalType),
  };

  const row = buildCoverageAuditRow(coverageFacts);
  const observedSourceNames = Array.from(
    new Set(observationHints.map((observation) => observation.sourceName).filter(Boolean)),
  ).sort();

  return {
    generatedAt: new Date().toISOString(),
    slug,
    found: true,
    row,
    entity: {
      _id: entityId,
      slug: entity.slug,
      name: entity.name,
      kind: entity.kind,
      entityType: entity.entityType,
      school: entity.school,
      websiteUrl: entity.websiteUrl,
      description: entity.description,
      shortDescription: entity.shortDescription,
      fullDescription: entity.fullDescription,
      researchAreas: entity.researchAreas || [],
      sourceUrls: entity.sourceUrls || [],
      acceptanceConfidence: entity.acceptanceConfidence ?? 0,
      undergradEvidenceQuote: entity.undergradEvidenceQuote || '',
      lastObservedAt: entity.lastObservedAt || null,
    },
    counts: coverageFacts.counts,
    coverage: {
      observedSourceNames,
      observedSourceCoverage: observedSourceNames.map((sourceName) => ({
        sourceName,
        coverage: sourceCoverageRegistry[sourceName as keyof typeof sourceCoverageRegistry] || null,
      })),
    },
    observationFlags: coverageFacts.observationFlags,
    accessArtifacts: {
      members,
      entryPathways: pathways,
      accessSignals: signals,
      publicContactRoutes: routes.filter((route) => route.visibility === 'PUBLIC'),
      nonPublicContactRoutes: routes.filter((route) => route.visibility !== 'PUBLIC'),
      postedOpportunities: opportunities,
      activeListings: listings,
    },
    recentObservations: observationHints.slice(0, 40),
  };
}

async function main(): Promise<void> {
  const options = parseResearchEntityCoverageAuditArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research-entity:coverage-audit',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const result = options.slug
    ? await buildSlugAudit(options.slug)
    : await buildBulkAudit(options);

  const output = buildResearchEntityCoverageAuditOutput(result, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(output, null, 2));
  writeResearchEntityCoverageAuditOutput(output, options.output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
