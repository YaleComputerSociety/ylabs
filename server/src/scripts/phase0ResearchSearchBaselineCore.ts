import { createHash, createHmac } from 'crypto';
import {
  parsePhase0SummaryOnlyEnvironment,
  type Phase0SummaryOnlyEnvironment,
} from './phase0SummaryOnlyAudit';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

export interface Phase0ResearchSearchBaselineCliOptions {
  environment: Phase0SummaryOnlyEnvironment;
  iterations: number;
  topK: number;
  strict: boolean;
  output: string;
}

export interface Phase0ResearchSearchCase {
  label: string;
  queryClass:
    | 'blank-browse'
    | 'keyword'
    | 'short-alias'
    | 'semantic-phrase'
    | 'department-filter'
    | 'research-area-filter'
    | 'deep-page';
  query: string;
  filters: {
    departments?: string[];
    researchAreas?: string[];
  };
  page: number;
  pageSize: number;
}

export interface Phase0ResearchSearchSample {
  latencyMs: number;
  estimatedTotalHits: number;
  degraded: boolean;
  topResultFingerprints: string[];
}

export interface Phase0ResearchSearchCaseResult {
  label: string;
  queryClass: Phase0ResearchSearchCase['queryClass'];
  request: {
    query: string;
    filters: Phase0ResearchSearchCase['filters'];
    page: number;
    pageSize: number;
  };
  samples: Phase0ResearchSearchSample[];
  latencyMs: {
    min: number;
    p50: number;
    p95: number;
    max: number;
  };
  degradedSamples: number;
  distinctOrderedResultSets: number;
}

export interface Phase0ResearchSearchBaselineReport {
  schemaVersion: 1;
  artifactType: 'phase0-research-search-baseline';
  generatedAt: string;
  sourceCommit: string;
  environment: Phase0SummaryOnlyEnvironment;
  databaseName: string;
  saltFingerprint: string;
  meilisearch: {
    targetKind: 'local' | 'remote';
    indexName: string;
    settingsFingerprint: string;
    searchableAttributes: string[];
    filterableAttributes: string[];
    sortableAttributes: string[];
    embedderNames: string[];
    numberOfDocuments: number;
    indexing: boolean;
  };
  suite: {
    iterations: number;
    topK: number;
    caseCount: number;
  };
  summary: {
    degradedSamples: number;
    unstableCases: number;
    reviewRequired: boolean;
  };
  cases: Phase0ResearchSearchCaseResult[];
}

export const PHASE0_RESEARCH_SEARCH_CASES: readonly Phase0ResearchSearchCase[] = [
  {
    label: 'blank-browse-first-page',
    queryClass: 'blank-browse',
    query: '',
    filters: {},
    page: 1,
    pageSize: 24,
  },
  {
    label: 'keyword-data-science',
    queryClass: 'keyword',
    query: 'data science',
    filters: {},
    page: 1,
    pageSize: 24,
  },
  {
    label: 'short-alias-ai',
    queryClass: 'short-alias',
    query: 'ai',
    filters: {},
    page: 1,
    pageSize: 24,
  },
  {
    label: 'semantic-beginner-brain-imaging',
    queryClass: 'semantic-phrase',
    query: 'beginner research using brain imaging',
    filters: {},
    page: 1,
    pageSize: 24,
  },
  {
    label: 'department-computer-science',
    queryClass: 'department-filter',
    query: '',
    filters: { departments: ['Computer Science'] },
    page: 1,
    pageSize: 24,
  },
  {
    label: 'research-area-neuroscience',
    queryClass: 'research-area-filter',
    query: '',
    filters: { researchAreas: ['Neuroscience'] },
    page: 1,
    pageSize: 24,
  },
  {
    label: 'blank-browse-deep-page',
    queryClass: 'deep-page',
    query: '',
    filters: {},
    page: 25,
    pageSize: 24,
  },
] as const;

const MAX_ITERATIONS = 10;
const MAX_TOP_K = 24;
const MIN_SALT_LENGTH = 32;
const PLACEHOLDER_RE = /change|example|placeholder|replace|todo|your[-_ ]/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PRODUCTION_PREFIXES = new Set(['prod', 'production']);
const PRODUCTION_COPY_PREFIX_RE = /^(?:production[-_]?copy|prod[-_]?copy)(?:[-_][a-z0-9-]+)?$/i;

function requiredFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function inlineFlagValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length).trim();
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function boundedPositiveInteger(value: string, flag: string, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  if (parsed > maximum) {
    throw new Error(`${flag} must be at most ${maximum}`);
  }
  return parsed;
}

export function parsePhase0ResearchSearchBaselineArgs(
  argv: string[],
): Phase0ResearchSearchBaselineCliOptions {
  let environment: Phase0SummaryOnlyEnvironment | undefined;
  let output: string | undefined;
  let iterations = 3;
  let topK = 10;
  let strict = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') {
      strict = true;
      continue;
    }
    if (arg.startsWith('--strict=')) {
      throw new Error('--strict does not accept a value');
    }
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
    if (arg === '--iterations') {
      iterations = boundedPositiveInteger(
        requiredFlagValue(argv, index, '--iterations'),
        '--iterations',
        MAX_ITERATIONS,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--iterations=')) {
      iterations = boundedPositiveInteger(
        inlineFlagValue(arg, '--iterations'),
        '--iterations',
        MAX_ITERATIONS,
      );
      continue;
    }
    if (arg === '--top-k') {
      topK = boundedPositiveInteger(
        requiredFlagValue(argv, index, '--top-k'),
        '--top-k',
        MAX_TOP_K,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith('--top-k=')) {
      topK = boundedPositiveInteger(inlineFlagValue(arg, '--top-k'), '--top-k', MAX_TOP_K);
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
    throw new Error(`Unknown Phase 0 search baseline argument: ${arg}`);
  }

  if (!environment) {
    throw new Error('model-refactor:search-baseline requires --environment');
  }
  if (!output) {
    throw new Error('model-refactor:search-baseline requires --output');
  }

  return { environment, iterations, topK, strict, output };
}

export function assertPhase0ResearchSearchMeiliTarget(input: {
  environment: Phase0SummaryOnlyEnvironment;
  host?: string;
  indexPrefix?: string;
}): { targetKind: 'local' | 'remote'; indexName: string } {
  let host: URL;
  try {
    host = new URL(input.host || '');
  } catch {
    throw new Error('MEILISEARCH_HOST must be an explicit http or https URL.');
  }
  if (host.protocol !== 'http:' && host.protocol !== 'https:') {
    throw new Error('MEILISEARCH_HOST must use http or https.');
  }
  if (host.username || host.password) {
    throw new Error('MEILISEARCH_HOST must not contain credentials.');
  }

  const targetKind = LOCAL_HOSTS.has(host.hostname.toLowerCase()) ? 'local' : 'remote';
  const prefix = (input.indexPrefix || '').trim();
  const lowerPrefix = prefix.toLowerCase();
  if (PRODUCTION_PREFIXES.has(lowerPrefix)) {
    throw new Error('Primary Production Meilisearch prefixes are forbidden.');
  }

  if (input.environment === 'development') {
    if (prefix === '' && targetKind !== 'local') {
      throw new Error(
        'An unprefixed Development index is allowed only on a local Meilisearch host.',
      );
    }
    if (prefix !== '' && !/^(?:dev|development)(?:[-_][a-z0-9-]+)?$/i.test(prefix)) {
      throw new Error('Development requires an unprefixed local index or a development prefix.');
    }
  } else if (input.environment === 'beta') {
    if (lowerPrefix !== 'beta') {
      throw new Error('Beta search evidence requires MEILISEARCH_INDEX_PREFIX=beta.');
    }
  } else if (!PRODUCTION_COPY_PREFIX_RE.test(prefix)) {
    throw new Error(
      'ProductionCopy search evidence requires a dedicated production-copy Meilisearch prefix.',
    );
  }

  return {
    targetKind,
    indexName: prefix ? `${prefix}_researchentities` : 'researchentities',
  };
}

export function requirePhase0ResearchSearchSalt(value: string | undefined): string {
  const salt = value?.trim() || '';
  if (salt.length < MIN_SALT_LENGTH || PLACEHOLDER_RE.test(salt)) {
    throw new Error(
      `PHASE0_SEARCH_BASELINE_SALT must be a non-placeholder secret of at least ${MIN_SALT_LENGTH} characters.`,
    );
  }
  return salt;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function phase0ResearchSearchSettingsFingerprint(settings: unknown): string {
  return createHash('sha256').update(canonicalJson(settings)).digest('hex');
}

export function phase0ResearchSearchSaltFingerprint(salt: string): string {
  return createHash('sha256').update(`phase0-search-salt:v1:${salt}`).digest('hex');
}

export function phase0ResearchSearchResultFingerprint(id: string, salt: string): string {
  return createHmac('sha256', salt).update(`research-entity:v1:${id}`).digest('hex');
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index];
}

export function summarizePhase0ResearchSearchCase(
  searchCase: Phase0ResearchSearchCase,
  samples: Phase0ResearchSearchSample[],
): Phase0ResearchSearchCaseResult {
  const latencies = samples.map((sample) => sample.latencyMs).sort((left, right) => left - right);
  const orderedResultSets = new Set(
    samples.map((sample) =>
      createHash('sha256').update(canonicalJson(sample.topResultFingerprints)).digest('hex'),
    ),
  );

  return {
    label: searchCase.label,
    queryClass: searchCase.queryClass,
    request: {
      query: searchCase.query,
      filters: searchCase.filters,
      page: searchCase.page,
      pageSize: searchCase.pageSize,
    },
    samples,
    latencyMs: {
      min: latencies[0] || 0,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies[latencies.length - 1] || 0,
    },
    degradedSamples: samples.filter((sample) => sample.degraded).length,
    distinctOrderedResultSets: orderedResultSets.size,
  };
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function safeNonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export function buildPhase0ResearchSearchBaselineReport(input: {
  generatedAt: string;
  sourceCommit: string;
  environment: Phase0SummaryOnlyEnvironment;
  databaseName: string;
  salt: string;
  meiliTarget: { targetKind: 'local' | 'remote'; indexName: string };
  meiliSettings: Record<string, unknown>;
  meiliStats: Record<string, unknown>;
  iterations: number;
  topK: number;
  cases: Phase0ResearchSearchCaseResult[];
}): Phase0ResearchSearchBaselineReport {
  const degradedSamples = input.cases.reduce(
    (total, searchCase) => total + searchCase.degradedSamples,
    0,
  );
  const unstableCases = input.cases.filter(
    (searchCase) => searchCase.distinctOrderedResultSets > 1,
  ).length;
  const embedders =
    input.meiliSettings.embedders &&
    typeof input.meiliSettings.embedders === 'object' &&
    !Array.isArray(input.meiliSettings.embedders)
      ? Object.keys(input.meiliSettings.embedders as Record<string, unknown>).sort()
      : [];

  return {
    schemaVersion: 1,
    artifactType: 'phase0-research-search-baseline',
    generatedAt: input.generatedAt,
    sourceCommit: input.sourceCommit,
    environment: input.environment,
    databaseName: input.databaseName,
    saltFingerprint: phase0ResearchSearchSaltFingerprint(input.salt),
    meilisearch: {
      ...input.meiliTarget,
      settingsFingerprint: phase0ResearchSearchSettingsFingerprint(input.meiliSettings),
      searchableAttributes: safeStringArray(input.meiliSettings.searchableAttributes),
      filterableAttributes: safeStringArray(input.meiliSettings.filterableAttributes),
      sortableAttributes: safeStringArray(input.meiliSettings.sortableAttributes),
      embedderNames: embedders,
      numberOfDocuments: safeNonNegativeInteger(input.meiliStats.numberOfDocuments),
      indexing: input.meiliStats.isIndexing === true,
    },
    suite: {
      iterations: input.iterations,
      topK: input.topK,
      caseCount: input.cases.length,
    },
    summary: {
      degradedSamples,
      unstableCases,
      reviewRequired: degradedSamples > 0 || unstableCases > 0,
    },
    cases: input.cases,
  };
}
