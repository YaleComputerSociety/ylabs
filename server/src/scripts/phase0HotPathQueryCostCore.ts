import { createHash } from 'crypto';
import type { Document } from 'mongodb';
import {
  parsePhase0SummaryOnlyEnvironment,
  type Phase0SummaryOnlyEnvironment,
} from './phase0SummaryOnlyAudit';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export type Phase0HotPathSurface =
  | 'research-browse'
  | 'research-detail'
  | 'opportunity-detail'
  | 'account-planning'
  | 'admin-access-review';

export interface Phase0HotPathQueryCostCliOptions {
  environment: Phase0SummaryOnlyEnvironment;
  maxTimeMS: number;
  strict: boolean;
  output: string;
}

export interface Phase0HotPathQuerySpec {
  label: string;
  surface: Phase0HotPathSurface;
  collection: string;
  operation: 'find' | 'distinct' | 'aggregate';
  command: Document;
}

export interface Phase0HotPathFixtureState {
  browseEntityIds: unknown[];
  typicalEntityId?: unknown;
  typicalEntitySlug?: string;
  highFanoutEntityId?: unknown;
  detailMemberUserIds: unknown[];
  ordinaryOpportunity?: {
    id: unknown;
    entryPathwayId?: unknown;
    researchEntityId?: unknown;
    evidenceIds: unknown[];
  };
  highEvidenceOpportunity?: {
    id: unknown;
    entryPathwayId?: unknown;
    researchEntityId?: unknown;
    evidenceIds: unknown[];
  };
  accounts: Array<{
    fixtureClass: 'zero-saves' | 'typical-saves' | 'near-limit-saves';
    netid: string;
    savedResearchEntityIds: unknown[];
    pathwayIds: unknown[];
  }>;
  adminSearchTerm?: string;
}

export interface Phase0HotPathPlanSummary {
  nReturned: number;
  executionTimeMillis: number;
  totalKeysExamined: number;
  totalDocsExamined: number;
  keysPerResult: number | null;
  docsPerResult: number | null;
  stages: string[];
  indexNames: string[];
  rejectedPlans: Array<{
    stages: string[];
    indexNames: string[];
  }>;
  lookupSubplans: Array<{
    indexesUsed: string[];
    totalKeysExamined: number;
    totalDocsExamined: number;
    collectionScans: number;
    usedDisk: boolean;
    spills: number;
  }>;
  collectionScan: boolean;
  blockingSort: boolean;
  usedDisk: boolean;
  spills: number;
}

export interface Phase0HotPathQueryResult {
  label: string;
  surface: Phase0HotPathSurface;
  collection: string;
  operation: Phase0HotPathQuerySpec['operation'];
  status: 'measured' | 'fixture-unavailable' | 'error';
  plan?: Phase0HotPathPlanSummary;
  errorCode?: string;
  findings: Array<
    | 'collection-scan'
    | 'blocking-sort'
    | 'disk-spill'
    | 'keys-amplification'
    | 'documents-amplification'
    | 'measurement-error'
  >;
}

export interface Phase0HotPathIndexDefinition {
  name: string;
  key: Record<string, unknown>;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  partialFilterFields: string[];
  fingerprint: string;
}

export interface Phase0HotPathCollectionIndexes {
  collection: string;
  status: 'measured' | 'missing' | 'error';
  indexes: Phase0HotPathIndexDefinition[];
  errorCode?: string;
}

export interface Phase0HotPathQueryCostReport {
  schemaVersion: 1;
  artifactType: 'phase0-hot-path-query-cost';
  generatedAt: string;
  sourceCommit: string;
  environment: Phase0SummaryOnlyEnvironment;
  databaseName: string;
  mongo: {
    serverVersion: string;
    readPreference: 'secondaryPreferred';
    maxTimeMS: number;
    commentPrefix: 'ylabs-phase0-hotpath';
    amplificationThreshold: 100;
  };
  fixtures: {
    browseEntityCount: number;
    typicalEntityAvailable: boolean;
    highFanoutEntityAvailable: boolean;
    ordinaryOpportunityAvailable: boolean;
    highEvidenceOpportunityAvailable: boolean;
    accountFixtureClasses: Array<'zero-saves' | 'typical-saves' | 'near-limit-saves'>;
    adminSearchFixtureAvailable: boolean;
  };
  indexes: Phase0HotPathCollectionIndexes[];
  queries: Phase0HotPathQueryResult[];
  summary: {
    expectedQueryShapes: number;
    measuredQueryShapes: number;
    fixtureUnavailableQueryShapes: number;
    errorQueryShapes: number;
    collectionScans: number;
    blockingSorts: number;
    diskSpills: number;
    amplifiedQueryShapes: number;
    uncoveredLabels: string[];
    reviewRequired: boolean;
  };
}

export const PHASE0_HOT_PATH_INDEX_COLLECTIONS = [
  'research_entities',
  'research_entity_members',
  'users',
  'faculty_members',
  'research_scholarly_attributions',
  'papers',
  'research_scholarly_links',
  'listings',
  'entry_pathways',
  'access_signals',
  'contact_routes',
  'posted_opportunities',
  'research_entity_relationships',
  'observations',
  'fellowships',
] as const;

export const PHASE0_HOT_PATH_EXPECTED_LABELS = [
  'research-browse-visible-entities',
  'research-browse-mongo-fallback',
  'research-browse-active-listings',
  'research-browse-access-signals',
  'research-browse-entry-pathways',
  'research-browse-posted-opportunities',
  'research-browse-contact-routes',
  'research-detail-entity-by-slug',
  'research-detail-current-members',
  'research-detail-member-attributions',
  'research-detail-papers',
  'research-detail-scholarly-links',
  'research-detail-listings',
  'research-detail-entry-pathways',
  'research-detail-access-signals',
  'research-detail-contact-routes',
  'research-detail-posted-opportunities',
  'research-detail-relationships-outbound',
  'research-detail-relationships-inbound',
  'opportunity-detail-opportunity',
  'opportunity-detail-pathway',
  'opportunity-detail-entity',
  'opportunity-detail-observations',
  'opportunity-detail-high-evidence-observations',
  'account-planning-user-zero-saves',
  'account-planning-user-typical-saves',
  'account-planning-user-near-limit-saves',
  'account-planning-visible-entities-zero-saves',
  'account-planning-visible-entities-typical-saves',
  'account-planning-visible-entities-near-limit-saves',
  'account-planning-pathway-hydration-zero-saves',
  'account-planning-pathway-hydration-typical-saves',
  'account-planning-pathway-hydration-near-limit-saves',
  'account-planning-fellowships',
  'admin-access-review-default',
  'admin-access-review-official-application',
  'admin-access-review-updated',
  'admin-access-review-search',
  'admin-access-review-reviewed-only',
  'admin-access-review-progress-entry-pathways-remaining',
  'admin-access-review-progress-entry-pathways-reviewed-today',
  'admin-access-review-progress-access-signals-remaining',
  'admin-access-review-progress-access-signals-reviewed-today',
  'admin-access-review-progress-contact-routes-remaining',
  'admin-access-review-progress-contact-routes-reviewed-today',
  'admin-access-review-progress-posted-opportunities-remaining',
  'admin-access-review-progress-posted-opportunities-reviewed-today',
  'admin-access-review-detail-entity',
  'admin-access-review-detail-entry-pathways',
  'admin-access-review-detail-access-signals',
  'admin-access-review-detail-contact-routes',
  'admin-access-review-detail-posted-opportunities',
] as const;

const MAX_DIAGNOSTIC_TIME_MS = 30_000;
const DEFAULT_DIAGNOSTIC_TIME_MS = 5_000;
const DEFAULT_AMPLIFICATION_THRESHOLD = 100;

function requiredFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function inlineFlagValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length).trim();
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function boundedPositiveInteger(value: string, flag: string, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  if (parsed > maximum) throw new Error(`${flag} must be at most ${maximum}`);
  return parsed;
}

export function parsePhase0HotPathQueryCostArgs(
  argv: string[],
): Phase0HotPathQueryCostCliOptions {
  let environment: Phase0SummaryOnlyEnvironment | undefined;
  let output: string | undefined;
  let maxTimeMS = DEFAULT_DIAGNOSTIC_TIME_MS;
  let strict = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg.startsWith('--strict=')) throw new Error('--strict does not accept a value');
    if (arg === '--environment') {
      environment = parsePhase0SummaryOnlyEnvironment(
        requiredFlagValue(argv, index, '--environment'),
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--environment=')) {
      environment = parsePhase0SummaryOnlyEnvironment(inlineFlagValue(arg, '--environment'));
      continue;
    }
    if (arg === '--max-time-ms') {
      maxTimeMS = boundedPositiveInteger(
        requiredFlagValue(argv, index, '--max-time-ms'),
        '--max-time-ms',
        MAX_DIAGNOSTIC_TIME_MS,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-time-ms=')) {
      maxTimeMS = boundedPositiveInteger(
        inlineFlagValue(arg, '--max-time-ms'),
        '--max-time-ms',
        MAX_DIAGNOSTIC_TIME_MS,
      );
      continue;
    }
    if (arg === '--output') {
      output = resolveSafeJsonReportOutputPath(requiredFlagValue(argv, index, '--output'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      output = resolveSafeJsonReportOutputPath(inlineFlagValue(arg, '--output'));
      continue;
    }
    throw new Error(`Unknown Phase 0 hot-path query-cost argument: ${arg}`);
  }

  if (!environment) throw new Error('model-refactor:query-cost requires --environment');
  if (!output) throw new Error('model-refactor:query-cost requires --output');
  return { environment, maxTimeMS, strict, output };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((nested) => walk(nested, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((nested) => walk(nested, visit));
}

function planParts(value: unknown): { stages: string[]; indexNames: string[] } {
  const stages = new Set<string>();
  const indexNames = new Set<string>();
  walk(value, (record) => {
    if (typeof record.stage === 'string') stages.add(record.stage);
    if (typeof record.indexName === 'string') indexNames.add(record.indexName);
    if (Array.isArray(record.indexesUsed)) {
      record.indexesUsed
        .filter((name): name is string => typeof name === 'string')
        .forEach((name) => indexNames.add(name));
    }
  });
  return { stages: [...stages].sort(), indexNames: [...indexNames].sort() };
}

export function summarizePhase0HotPathExplain(explain: Document): Phase0HotPathPlanSummary {
  const executionStats =
    explain.executionStats && typeof explain.executionStats === 'object'
      ? (explain.executionStats as Record<string, unknown>)
      : {};
  const queryPlanner =
    explain.queryPlanner && typeof explain.queryPlanner === 'object'
      ? (explain.queryPlanner as Record<string, unknown>)
      : {};
  const winningEvidence = [
    executionStats,
    queryPlanner.winningPlan,
    Array.isArray(explain.stages) ? explain.stages : [],
  ];
  const parts = planParts(winningEvidence);
  let usedDisk = false;
  let spills = 0;
  let collectionScanCount = 0;
  const lookupSubplans: Phase0HotPathPlanSummary['lookupSubplans'] = [];

  winningEvidence.forEach((evidence) =>
    walk(evidence, (record) => {
      if (record.usedDisk === true) usedDisk = true;
      spills += finiteCount(record.spills);
      collectionScanCount += finiteCount(record.collectionScans);
      if ('$lookup' in record || typeof record.indexesUsed !== 'undefined') {
        const indexesUsed = Array.isArray(record.indexesUsed)
          ? record.indexesUsed.filter((name): name is string => typeof name === 'string').sort()
          : [];
        lookupSubplans.push({
          indexesUsed,
          totalKeysExamined: finiteCount(record.totalKeysExamined),
          totalDocsExamined: finiteCount(record.totalDocsExamined),
          collectionScans: finiteCount(record.collectionScans),
          usedDisk: record.usedDisk === true,
          spills: finiteCount(record.spills),
        });
      }
    }),
  );

  const nReturned = finiteCount(executionStats.nReturned);
  const totalKeysExamined = finiteCount(executionStats.totalKeysExamined);
  const totalDocsExamined = finiteCount(executionStats.totalDocsExamined);
  const rejectedPlansRaw =
    Array.isArray(queryPlanner.rejectedPlans)
      ? (queryPlanner.rejectedPlans as unknown[])
      : [];
  const rejectedPlans = rejectedPlansRaw.map(planParts);
  const blockingSort = parts.stages.some((stage) => stage === 'SORT' || stage === 'SORT_KEY_GENERATOR');
  const collectionScan =
    parts.stages.includes('COLLSCAN') || collectionScanCount > 0;

  return {
    nReturned,
    executionTimeMillis: finiteCount(executionStats.executionTimeMillis),
    totalKeysExamined,
    totalDocsExamined,
    keysPerResult: nReturned > 0 ? totalKeysExamined / nReturned : null,
    docsPerResult: nReturned > 0 ? totalDocsExamined / nReturned : null,
    stages: parts.stages,
    indexNames: parts.indexNames,
    rejectedPlans,
    lookupSubplans,
    collectionScan,
    blockingSort,
    usedDisk,
    spills,
  };
}

export function classifyPhase0HotPathFindings(
  plan: Phase0HotPathPlanSummary,
  amplificationThreshold = DEFAULT_AMPLIFICATION_THRESHOLD,
): Phase0HotPathQueryResult['findings'] {
  const findings: Phase0HotPathQueryResult['findings'] = [];
  if (plan.collectionScan) findings.push('collection-scan');
  if (plan.blockingSort) findings.push('blocking-sort');
  if (plan.usedDisk || plan.spills > 0) findings.push('disk-spill');
  if (
    (plan.keysPerResult !== null && plan.keysPerResult > amplificationThreshold) ||
    (plan.nReturned === 0 && plan.totalKeysExamined > amplificationThreshold)
  ) {
    findings.push('keys-amplification');
  }
  if (
    (plan.docsPerResult !== null && plan.docsPerResult > amplificationThreshold) ||
    (plan.nReturned === 0 && plan.totalDocsExamined > amplificationThreshold)
  ) {
    findings.push('documents-amplification');
  }
  return findings;
}

export function summarizePhase0HotPathIndexDefinition(
  definition: Document,
): Phase0HotPathIndexDefinition {
  const partial =
    definition.partialFilterExpression &&
    typeof definition.partialFilterExpression === 'object'
      ? (definition.partialFilterExpression as Record<string, unknown>)
      : {};
  return {
    name: typeof definition.name === 'string' ? definition.name : 'unnamed-index',
    key:
      definition.key && typeof definition.key === 'object'
        ? (canonicalize(definition.key) as Record<string, unknown>)
        : {},
    unique: definition.unique === true,
    sparse: definition.sparse === true,
    hidden: definition.hidden === true,
    partialFilterFields: Object.keys(partial).sort(),
    fingerprint: fingerprint(definition),
  };
}

export function buildPhase0HotPathQueryCostReport(input: {
  generatedAt: string;
  sourceCommit: string;
  environment: Phase0SummaryOnlyEnvironment;
  databaseName: string;
  serverVersion: string;
  maxTimeMS: number;
  fixtures: Phase0HotPathFixtureState;
  indexes: Phase0HotPathCollectionIndexes[];
  queries: Phase0HotPathQueryResult[];
}): Phase0HotPathQueryCostReport {
  const resultByLabel = new Map(input.queries.map((result) => [result.label, result]));
  const uncoveredLabels = PHASE0_HOT_PATH_EXPECTED_LABELS.filter(
    (label) => !resultByLabel.has(label),
  );
  const measuredQueryShapes = input.queries.filter((row) => row.status === 'measured').length;
  const fixtureUnavailableQueryShapes = input.queries.filter(
    (row) => row.status === 'fixture-unavailable',
  ).length;
  const errorQueryShapes = input.queries.filter((row) => row.status === 'error').length;
  const findingCount = (finding: Phase0HotPathQueryResult['findings'][number]) =>
    input.queries.filter((row) => row.findings.includes(finding)).length;
  const amplifiedQueryShapes = input.queries.filter(
    (row) =>
      row.findings.includes('keys-amplification') ||
      row.findings.includes('documents-amplification'),
  ).length;
  const indexErrors = input.indexes.some((row) => row.status !== 'measured');
  const reviewRequired =
    uncoveredLabels.length > 0 ||
    fixtureUnavailableQueryShapes > 0 ||
    errorQueryShapes > 0 ||
    indexErrors ||
    input.queries.some((row) => row.findings.length > 0);

  return {
    schemaVersion: 1,
    artifactType: 'phase0-hot-path-query-cost',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    environment: input.environment,
    databaseName: input.databaseName,
    mongo: {
      serverVersion: input.serverVersion,
      readPreference: 'secondaryPreferred',
      maxTimeMS: input.maxTimeMS,
      commentPrefix: 'ylabs-phase0-hotpath',
      amplificationThreshold: DEFAULT_AMPLIFICATION_THRESHOLD,
    },
    fixtures: {
      browseEntityCount: input.fixtures.browseEntityIds.length,
      typicalEntityAvailable: Boolean(input.fixtures.typicalEntityId),
      highFanoutEntityAvailable: Boolean(input.fixtures.highFanoutEntityId),
      ordinaryOpportunityAvailable: Boolean(input.fixtures.ordinaryOpportunity),
      highEvidenceOpportunityAvailable: Boolean(input.fixtures.highEvidenceOpportunity),
      accountFixtureClasses: input.fixtures.accounts.map((account) => account.fixtureClass),
      adminSearchFixtureAvailable: Boolean(input.fixtures.adminSearchTerm),
    },
    indexes: input.indexes,
    queries: input.queries,
    summary: {
      expectedQueryShapes: PHASE0_HOT_PATH_EXPECTED_LABELS.length,
      measuredQueryShapes,
      fixtureUnavailableQueryShapes,
      errorQueryShapes,
      collectionScans: findingCount('collection-scan'),
      blockingSorts: findingCount('blocking-sort'),
      diskSpills: findingCount('disk-spill'),
      amplifiedQueryShapes,
      uncoveredLabels,
      reviewRequired,
    },
  };
}

export function safePhase0HotPathErrorCode(error: unknown): string {
  const name =
    error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : 'Error';
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'number' || typeof code === 'string'
    ? `${name}:${String(code).slice(0, 40)}`
    : name.slice(0, 80);
}

export function escapePhase0HotPathRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
