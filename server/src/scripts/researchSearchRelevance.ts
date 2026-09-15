import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { searchResearchGroupsViaMeili } from '../services/researchGroupService';
import { getMeiliIndex, resolveIndexName } from '../utils/meiliClient';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { RESEARCH_SEARCH_RELEVANCE_CASES } from './researchSearchRelevanceCases';
import {
  RESEARCH_SEARCH_PERTURBATION_KINDS,
  RESEARCH_SEARCH_RELEVANCE_TEXT_FIELDS,
  buildResearchSearchRelevanceReport,
  isSkippedResearchSearchPerturbation,
  matchesRelevanceMarkers,
  perturbResearchSearchQuery,
  relevanceTextMatchesMarkers,
  researchSearchIndexConfiguration,
  researchSearchRelevanceText,
  summarizeResearchSearchRelevanceCase,
  type ResearchSearchProbeOutcome,
  type ResearchSearchRelevanceCase,
  type ResearchSearchRelevanceCaseResult,
  type ResearchSearchRelevanceReport,
} from './researchSearchRelevanceCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const SCRIPT_NAME = 'research-search:relevance';
const MAX_TOP_K = 24;
const MAX_NAME_SAMPLES = 12;
const LOCAL_MEILI_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const CORPUS_TEXT_PAGE_SIZE = 500;
const UNKNOWN_SOURCE_COMMIT = 'unknown';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.env.YLABS_SKIP_LOCAL_DOTENV !== 'true') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

export interface ResearchSearchRelevanceCliOptions {
  topK: number;
  nameSamples: number;
  minPrecisionAtK: number;
  minAverageOverlap: number;
  strict: boolean;
  output?: string;
}

const flagValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const boundedInteger = (value: string, flag: string, maximum: number, minimum: number): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires an integer of at least ${minimum}`);
  }
  if (parsed > maximum) {
    throw new Error(`${flag} must be at most ${maximum}`);
  }
  return parsed;
};

const boundedRatio = (value: string, flag: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} requires a ratio between 0 and 1`);
  }
  return parsed;
};

export function parseResearchSearchRelevanceArgs(
  argv: string[],
): ResearchSearchRelevanceCliOptions {
  const options: ResearchSearchRelevanceCliOptions = {
    topK: 10,
    nameSamples: 4,
    minPrecisionAtK: 0.5,
    minAverageOverlap: 0.5,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const name = separator > 0 ? arg.slice(0, separator) : arg;
    const inlineValue = separator > 0 ? arg.slice(separator + 1) : undefined;

    if (name === '--strict') {
      if (inlineValue !== undefined) throw new Error('--strict does not accept a value');
      options.strict = true;
      continue;
    }

    let consumesNextArgument = false;
    const value = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      consumesNextArgument = true;
      return flagValue(argv, index, name);
    };

    switch (name) {
      case '--top-k':
        options.topK = boundedInteger(value(), '--top-k', MAX_TOP_K, 1);
        break;
      case '--name-samples':
        options.nameSamples = boundedInteger(value(), '--name-samples', MAX_NAME_SAMPLES, 0);
        break;
      case '--min-precision':
        options.minPrecisionAtK = boundedRatio(value(), '--min-precision');
        break;
      case '--min-overlap':
        options.minAverageOverlap = boundedRatio(value(), '--min-overlap');
        break;
      case '--output':
        options.output = resolveSafeJsonReportOutputPath(value());
        break;
      default:
        throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
    }

    if (consumesNextArgument) index += 1;
  }

  return options;
}

// The harness is read-only, but a full sweep issues roughly one hybrid query per
// case per perturbation, and every hybrid query costs an embedder call against the
// index it targets. Pointing that at Beta or Production would load student-facing
// search to measure it, so the measurement is confined to a local Development
// target where the index can also be rebuilt freely between runs.
export function assertResearchSearchRelevanceTarget(input: {
  mongoUrl?: string;
  meiliHost?: string;
}): void {
  let database = '';
  try {
    database = new URL(input.mongoUrl || '').pathname.replace(/^\//, '');
  } catch {
    database = '';
  }
  if (database.toLowerCase() !== 'development') {
    throw new Error(
      `${SCRIPT_NAME} runs against the Development database only; refusing target "${database || '(unknown)'}".`,
    );
  }

  let meiliHost: URL;
  try {
    meiliHost = new URL(input.meiliHost || 'http://localhost:7700');
  } catch {
    throw new Error('MEILISEARCH_HOST must be an explicit http or https URL.');
  }
  if (!LOCAL_MEILI_HOSTS.has(meiliHost.hostname.toLowerCase())) {
    throw new Error(
      `${SCRIPT_NAME} requires a local Meilisearch host; refusing "${meiliHost.hostname}".`,
    );
  }
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

export function researchSearchRelevanceSourceProvenance(
  runCommand: typeof execFileSync = execFileSync,
): { sourceCommit: string; sourceWorktreeDirty: boolean } {
  const worktreeRoot = path.resolve(__dirname, '../../..');
  const git = (args: string[]): string =>
    String(
      runCommand('git', args, {
        cwd: worktreeRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    ).trim();
  try {
    const head = git(['rev-parse', 'HEAD']).toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(head)) {
      return { sourceCommit: UNKNOWN_SOURCE_COMMIT, sourceWorktreeDirty: true };
    }
    // A ranking or alias experiment is normally measured from an edited tree, so a
    // dirty worktree is recorded rather than refused. Without the flag the commit
    // alone would attribute the run to code that was not the code under test.
    return { sourceCommit: head, sourceWorktreeDirty: git(['status', '--porcelain=v1']) !== '' };
  } catch {
    return { sourceCommit: UNKNOWN_SOURCE_COMMIT, sourceWorktreeDirty: true };
  }
}

type ResearchSearchIndexRelevanceText = Map<string, string>;

// Meilisearch matched every hit against its index document, but the served list
// DTO trims `fullDescription` and never carries `orgAffiliationLabels`,
// `studentSearchTerms`, or the roster name fields, so judging a hit on the DTO
// scores a correct match irrelevant whenever its evidence lives in one of those.
// `slug` is the only key the served row and the index document share and it is
// not filterable, so the relevance text is paged once per run instead of fetched
// per hit.
async function loadIndexRelevanceText(
  index: Awaited<ReturnType<typeof getMeiliIndex>>,
  numberOfDocuments: number,
): Promise<ResearchSearchIndexRelevanceText> {
  const textBySlug: ResearchSearchIndexRelevanceText = new Map();
  for (let offset = 0; offset < numberOfDocuments; offset += CORPUS_TEXT_PAGE_SIZE) {
    const page = await index.getDocuments({
      offset,
      limit: CORPUS_TEXT_PAGE_SIZE,
      fields: [...RESEARCH_SEARCH_RELEVANCE_TEXT_FIELDS, 'slug'],
    });
    const documents = (page.results || []) as Record<string, unknown>[];
    if (documents.length === 0) break;
    for (const document of documents) {
      const slug = isNonEmptyString(document.slug) ? document.slug.trim() : '';
      if (slug) textBySlug.set(slug, researchSearchRelevanceText(document));
    }
  }
  return textBySlug;
}

export function surnameFromDisplayName(displayName: string): string {
  const tokens = displayName
    .replace(/[,.]/g, ' ')
    .split(/\s+/)
    .filter((token) => /^[\p{L}'’-]{2,}$/u.test(token));
  const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'msc', 'mph']);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const candidate = tokens[index];
    if (suffixes.has(candidate.toLowerCase().replace(/[^a-z]/g, ''))) continue;
    return candidate;
  }
  return '';
}

async function sampleCorpusNameCases(
  index: Awaited<ReturnType<typeof getMeiliIndex>>,
  numberOfDocuments: number,
  sampleCount: number,
): Promise<ResearchSearchRelevanceCase[]> {
  if (sampleCount === 0 || numberOfDocuments === 0) return [];

  const cases: ResearchSearchRelevanceCase[] = [];
  const seen = new Set<string>();
  const stride = Math.max(1, Math.floor(numberOfDocuments / (sampleCount + 1)));
  for (let sample = 1; cases.length < sampleCount && sample <= sampleCount * 4; sample += 1) {
    const offset = (stride * sample) % numberOfDocuments;
    const page = await index.getDocuments({
      offset,
      limit: 1,
      fields: ['leadProfessorNames', 'professorNames'],
    });
    const document = (page.results?.[0] || {}) as Record<string, unknown>;
    const names = [document.leadProfessorNames, document.professorNames]
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter(isNonEmptyString);
    const surname = names.map(surnameFromDisplayName).find((value) => value.length >= 3) || '';
    const key = surname.toLowerCase();
    if (!surname || seen.has(key)) continue;
    seen.add(key);
    cases.push({
      label: `person-name-sample-${cases.length + 1}`,
      queryClass: 'person-name',
      query: surname,
      relevanceMarkers: [key],
    });
  }
  return cases;
}

let probeSequence = 0;

// A row carrying neither id nor slug must never compare equal to another such row.
// Falling back to the array position made two unrelated id-less hits at the same
// rank register as shared, inflating overlap and reporting the top rank as
// preserved, so the fallback is unique per probe and can only ever match itself.
export function researchSearchResultIdentity(
  entity: Record<string, unknown>,
  position: number,
  probeToken: string,
): string {
  const identity = String(entity.id || entity.slug || '').trim();
  return identity || `unidentifiable:${probeToken}:${position}`;
}

async function probe(
  query: string,
  searchCase: ResearchSearchRelevanceCase,
  topK: number,
  indexRelevanceText: ResearchSearchIndexRelevanceText,
): Promise<ResearchSearchProbeOutcome> {
  const probeToken = String((probeSequence += 1));
  const startedAt = performance.now();
  const result = await searchResearchGroupsViaMeili(query, {}, 1, topK);
  const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const hits = result.researchEntities.slice(0, topK) as unknown as Record<string, unknown>[];

  let unresolvedIndexDocuments = 0;
  const relevanceFlags = hits.map((entity) => {
    const slug = isNonEmptyString(entity.slug) ? entity.slug.trim() : '';
    const indexedText = slug ? indexRelevanceText.get(slug) : undefined;
    if (indexedText === undefined) {
      unresolvedIndexDocuments += 1;
      return matchesRelevanceMarkers(entity, searchCase.relevanceMarkers);
    }
    return relevanceTextMatchesMarkers(indexedText, searchCase.relevanceMarkers);
  });

  return {
    resultIds: hits.map((entity, position) =>
      researchSearchResultIdentity(entity, position, probeToken),
    ),
    relevanceFlags,
    unresolvedIndexDocuments,
    estimatedTotalHits: Math.max(0, Math.floor(result.estimatedTotalHits || 0)),
    degraded: result.degraded === true,
    latencyMs,
  };
}

async function runCase(
  searchCase: ResearchSearchRelevanceCase,
  topK: number,
  indexRelevanceText: ResearchSearchIndexRelevanceText,
): Promise<{ result: ResearchSearchRelevanceCaseResult; unresolvedIndexDocuments: number }> {
  const baseline = await probe(searchCase.query, searchCase, topK, indexRelevanceText);
  const perturbations: Parameters<typeof summarizeResearchSearchRelevanceCase>[0]['perturbations'] =
    [];
  let unresolvedIndexDocuments = baseline.unresolvedIndexDocuments || 0;

  for (const kind of RESEARCH_SEARCH_PERTURBATION_KINDS) {
    const perturbation = perturbResearchSearchQuery(searchCase.query, kind);
    if (isSkippedResearchSearchPerturbation(perturbation)) {
      perturbations.push({ kind, skipped: perturbation });
      continue;
    }
    const outcome = await probe(perturbation.query, searchCase, topK, indexRelevanceText);
    unresolvedIndexDocuments += outcome.unresolvedIndexDocuments || 0;
    perturbations.push({ kind, perturbedQuery: perturbation.query, outcome });
  }

  for (const misspelling of searchCase.realMisspellings ?? []) {
    const outcome = await probe(misspelling, searchCase, topK, indexRelevanceText);
    unresolvedIndexDocuments += outcome.unresolvedIndexDocuments || 0;
    perturbations.push({ kind: 'real-misspelling', perturbedQuery: misspelling, outcome });
  }

  return {
    result: summarizeResearchSearchRelevanceCase({
      searchCase,
      topK,
      baseline,
      perturbations,
      redactQuery: searchCase.queryClass === 'person-name',
    }),
    unresolvedIndexDocuments,
  };
}

function printSummary(report: ResearchSearchRelevanceReport): void {
  const { summary } = report;
  console.log(`\n${SCRIPT_NAME} on ${report.databaseName} / ${report.indexName}`);
  console.log(
    `  documents ${report.numberOfDocuments}, hybrid embedder ${report.hybridEmbedderConfigured ? 'configured' : 'ABSENT (keyword-only)'}`,
  );
  console.log(
    `  source ${report.sourceCommit}${report.sourceWorktreeDirty ? ' (worktree dirty)' : ''}, index settings ${report.indexConfiguration.settingsFingerprint.slice(0, 12)}`,
  );
  console.log(
    `  ranking rules ${report.indexConfiguration.rankingRules.join(' > ') || '(default)'}, synonym terms ${report.indexConfiguration.synonymTermCount}`,
  );
  if (report.unresolvedIndexDocuments > 0) {
    console.log(
      `  WARNING: ${report.unresolvedIndexDocuments} hit(s) had no index document; those were judged on the served card only`,
    );
  }
  console.log(
    `  cases ${report.suite.caseCount}, top-k ${report.suite.topK}, perturbations compared ${summary.comparedPerturbations} (skipped ${summary.skippedPerturbations})`,
  );
  console.log(`  mean precision@${report.suite.topK}   ${summary.meanPrecisionAtK}`);
  console.log(`  mean reciprocal rank   ${summary.meanReciprocalRank}`);
  console.log(`  mean average overlap   ${summary.meanAverageOverlap}`);
  for (const [kind, value] of Object.entries(summary.meanAverageOverlapByKind)) {
    console.log(`    ${kind.padEnd(14)} ${value}`);
  }
  console.log(
    `  zero-result cases ${summary.zeroResultCases}, degraded cases ${summary.degradedCases}`,
  );

  if (report.findings.length === 0) {
    console.log('  findings: none\n');
    return;
  }
  console.log(`  findings (${report.findings.length}):`);
  for (const finding of report.findings) {
    const suffix = finding.threshold === undefined ? '' : ` (threshold ${finding.threshold})`;
    const kindLabel = finding.perturbationKind
      ? `${finding.kind}/${finding.perturbationKind}`
      : finding.kind;
    console.log(
      `    ${finding.label.padEnd(38)} ${kindLabel.padEnd(28)} ${finding.observed}${suffix}`,
    );
  }
  console.log('');
}

async function main(): Promise<void> {
  const options = parseResearchSearchRelevanceArgs(process.argv.slice(2));
  assertResearchSearchRelevanceTarget({
    mongoUrl: process.env.MONGODBURL,
    meiliHost: process.env.MEILISEARCH_HOST,
  });

  await initializeConnections();
  const databaseName = mongoose.connection.db?.databaseName || mongoose.connection.name || '';
  const index = await getMeiliIndex('researchentities');
  const [stats, settings] = await Promise.all([index.getStats(), index.getSettings()]);
  const embedders = (settings as Record<string, unknown>).embedders;
  const hybridEmbedderConfigured = Boolean(
    embedders && typeof embedders === 'object' && Object.keys(embedders).length > 0,
  );

  const numberOfDocuments = stats.numberOfDocuments || 0;
  const indexRelevanceText = await loadIndexRelevanceText(index, numberOfDocuments);
  const nameCases = await sampleCorpusNameCases(index, numberOfDocuments, options.nameSamples);
  const cases: ResearchSearchRelevanceCaseResult[] = [];
  let unresolvedIndexDocuments = 0;
  for (const searchCase of [...RESEARCH_SEARCH_RELEVANCE_CASES, ...nameCases]) {
    const caseRun = await runCase(searchCase, options.topK, indexRelevanceText);
    cases.push(caseRun.result);
    unresolvedIndexDocuments += caseRun.unresolvedIndexDocuments;
  }

  const report = buildResearchSearchRelevanceReport({
    generatedAt: new Date().toISOString(),
    ...researchSearchRelevanceSourceProvenance(),
    databaseName,
    indexName: resolveIndexName('researchentities'),
    numberOfDocuments,
    hybridEmbedderConfigured,
    indexConfiguration: researchSearchIndexConfiguration(settings),
    unresolvedIndexDocuments,
    topK: options.topK,
    perturbationKinds: RESEARCH_SEARCH_PERTURBATION_KINDS,
    thresholds: {
      minPrecisionAtK: options.minPrecisionAtK,
      minAverageOverlap: options.minAverageOverlap,
    },
    cases,
  });

  printSummary(report);

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`  report ${options.output}\n`);
  }

  if (options.strict && report.summary.reviewRequired) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(`${SCRIPT_NAME} failed:`, sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
