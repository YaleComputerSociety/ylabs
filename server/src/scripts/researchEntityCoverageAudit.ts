import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Signal } from '../models/signal';
import { accessSignalTypes } from '../models/researchAccessTypes';
import { Listing } from '../models/listing';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  getResearchEntityRoster,
  getResearchEntityRosterByEntityId,
} from '../services/researchEntityMembershipAccessor';
import { sourceCoverageRegistry } from '../scrapers/sourceCoverageRegistry';
import {
  buildCoverageAuditRow,
  extractSuspiciousConstraintQuotes,
  selectCoverageAuditRows,
  type CoverageAuditFacts,
  type CoverageObservationFlags,
} from './researchEntityCoverageAuditCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  assertPhase0SummaryOnlyConfiguredTarget,
  assertPhase0SummaryOnlyConnectedTarget,
  buildPhase0SummaryOnlyOutput,
  parsePhase0SummaryOnlyEnvironment,
  type Phase0SummaryOnlyEnvironment,
  type Phase0SummaryOnlyMetadata,
} from './phase0SummaryOnlyAudit';
import { sanitizeLogValue } from '../utils/logSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ResearchEntityCoverageAuditCliOptions {
  slug?: string;
  summaryOnly?: boolean;
  environment?: Phase0SummaryOnlyEnvironment;
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

const SUMMARY_ONLY_COVERAGE_ISSUES = [
  'BLANK_DETAIL_RISK',
  'MICROSITE_OBSERVED_NO_ACTIONABLE_ARTIFACTS',
  'INFERRED_PI_WITHOUT_MEMBERSHIP',
  'NO_ACTIONABLE_ACCESS',
  'MISSING_DESCRIPTION',
  'NO_MEMBERS',
  'NO_PATHWAYS',
  'NO_PUBLIC_CONTACT_ROUTE',
  'SUSPICIOUS_CONSTRAINT_QUOTE_UNCLASSIFIED',
  'NO_RESEARCH_AREAS',
  'MISSING_WEBSITE_URL',
] as const;

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
    if (arg === '--summary-only') {
      options.summaryOnly = true;
      continue;
    }
    if (arg.startsWith('--summary-only=')) {
      throw new Error('--summary-only does not accept a value');
    }
    if (arg === '--environment') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--environment requires a value');
      }
      options.environment = parsePhase0SummaryOnlyEnvironment(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--environment=')) {
      options.environment = parsePhase0SummaryOnlyEnvironment(arg.slice('--environment='.length));
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

export function assertResearchEntityCoverageSummaryOnlyAllowed(
  options: ResearchEntityCoverageAuditCliOptions,
): void {
  if (options.summaryOnly && options.slug) {
    throw new Error(
      'research-entity:coverage-audit --summary-only cannot be combined with --slug.',
    );
  }
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
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

  const rosterByEntityId = await getResearchEntityRosterByEntityId(entityIds);
  const memberCounts = new Map<string, number>(
    [...rosterByEntityId].map(([key, roster]) => [key, roster.length]),
  );
  const [signalCounts, listingCounts, observationHints] = await Promise.all([
    aggregateCountMap(Signal, {
      researchEntityId: { $in: entityIds },
      type: { $in: [...accessSignalTypes] },
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

  const rows = entities.map((entity) => {
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
        accessSignals: signalCounts.get(entityId) || 0,
        activeListings: listingCounts.get(entityId) || 0,
      },
      observationFlags: buildObservationFlags(observationsBySlug.get(entity.slug) || []),
    };
    return buildCoverageAuditRow(facts);
  });
  const rowLimit = options.slug ? rows.length : options.limit;
  const selection = selectCoverageAuditRows(rows, {
    includeAll: options.includeAll,
    minScore: options.minScore,
    limit: rowLimit,
  });

  return {
    generatedAt: new Date().toISOString(),
    scope: options.slug ? 'detail-candidate' : 'bulk',
    totalEntitiesScanned: entities.length,
    flaggedEntities: selection.flaggedEntities,
    filters: {
      slug: options.slug || null,
      includeArchived: options.includeArchived,
      includeAll: options.includeAll,
      limit: rowLimit,
      minScore: options.minScore,
    },
    issueCounts: selection.issueCounts,
    rows: selection.rows,
  };
}

export function buildResearchEntityCoverageSummaryOnlyOutput(
  result: {
    generatedAt: string;
    scope: string;
    totalEntitiesScanned: number;
    flaggedEntities: number;
    filters: {
      includeArchived: boolean;
      includeAll: boolean;
      minScore: number;
    };
    issueCounts: Record<string, number>;
  },
  metadata: Phase0SummaryOnlyMetadata,
) {
  return buildPhase0SummaryOnlyOutput(
    {
      generatedAt: result.generatedAt,
      scope: result.scope,
      applyBlocked: true,
      totalEntitiesScanned: result.totalEntitiesScanned,
      flaggedEntities: result.flaggedEntities,
      filters: {
        includeArchived: result.filters.includeArchived,
        includeAll: result.filters.includeAll,
        minScore: result.filters.minScore,
      },
      issueCounts: Object.fromEntries(
        SUMMARY_ONLY_COVERAGE_ISSUES.flatMap((issue) => {
          const count = result.issueCounts[issue];
          return Number.isSafeInteger(count) && count >= 0 ? [[issue, count]] : [];
        }),
      ),
    },
    metadata,
  );
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
  const [members, signals, listings, observations] = await Promise.all([
    getResearchEntityRoster(entity._id),
    Signal.find({
      researchEntityId: entity._id,
      type: { $in: [...accessSignalTypes] },
      archived: { $ne: true },
    })
      .select('type confidence confidenceScore source observedAt derivationKey')
      .sort({ observedAt: -1 })
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
      accessSignals: signals.length,
      activeListings: listings.length,
    },
    observationFlags: buildObservationFlags(observationHints),
    signalTypes: signals.map((signal) => signal.type),
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
      accessSignals: signals,
      activeListings: listings,
    },
    recentObservations: observationHints.slice(0, 40),
  };
}

async function main(): Promise<void> {
  const options = parseResearchEntityCoverageAuditArgs(process.argv.slice(2));
  assertResearchEntityCoverageSummaryOnlyAllowed(options);
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research-entity:coverage-audit',
    mongoUrl: process.env.MONGODBURL,
  });
  assertPhase0SummaryOnlyConfiguredTarget({
    summaryOnly: Boolean(options.summaryOnly),
    environment: options.environment,
    mongoUrl: process.env.MONGODBURL,
    scriptName: 'research-entity:coverage-audit',
  });
  await initializeConnections();
  assertPhase0SummaryOnlyConnectedTarget({
    summaryOnly: Boolean(options.summaryOnly),
    environment: options.environment,
    databaseName: mongoose.connection.db?.databaseName,
    scriptName: 'research-entity:coverage-audit',
  });

  const result = options.slug ? await buildSlugAudit(options.slug) : await buildBulkAudit(options);

  const metadata = {
    environment: options.summaryOnly ? options.environment : guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  };
  const output =
    options.summaryOnly && 'totalEntitiesScanned' in result
      ? buildResearchEntityCoverageSummaryOnlyOutput(result, metadata)
      : buildResearchEntityCoverageAuditOutput(result, metadata);
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
