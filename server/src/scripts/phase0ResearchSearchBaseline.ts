import { constants as fsConstants } from 'fs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { searchResearchGroupsViaMeili } from '../services/researchGroupService';
import { getMeiliIndex } from '../utils/meiliClient';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  assertPhase0SummaryOnlyConfiguredTarget,
  assertPhase0SummaryOnlyConnectedTarget,
} from './phase0SummaryOnlyAudit';
import {
  PHASE0_RESEARCH_SEARCH_CASES,
  assertPhase0ResearchSearchMeiliTarget,
  buildPhase0ResearchSearchBaselineReport,
  parsePhase0ResearchSearchBaselineArgs,
  phase0ResearchSearchResultFingerprint,
  requirePhase0ResearchSearchSalt,
  summarizePhase0ResearchSearchCase,
  type Phase0ResearchSearchBaselineReport,
  type Phase0ResearchSearchSample,
} from './phase0ResearchSearchBaselineCore';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.env.YLABS_SKIP_LOCAL_DOTENV !== 'true') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const protectedSearchProfileSpecs = {
  beta: {
    name: 'beta-inventory',
    inventoryFile: 'beta-inventory.env',
    searchFile: 'beta-search.env',
    databaseName: 'Beta',
    indexPrefix: 'beta',
  },
  'production-copy': {
    name: 'production-copy-inventory',
    inventoryFile: 'production-copy-inventory.env',
    searchFile: 'production-copy-search.env',
    databaseName: 'ProductionCopy',
    indexPrefix: /^(?:production[-_]?copy|prod[-_]?copy)(?:[-_][a-z0-9-]+)?$/i,
  },
} as const;
const protectedProfilePlaceholderPattern =
  /[<>]|\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me|todo)\b|your[-_ ]|example\.(?:com|net|org)|example\.mongodb\.net/i;

export function assertHardenedSearchBaselineProfile(environment: string): void {
  if (environment === 'development') return;
  const expected =
    protectedSearchProfileSpecs[environment as keyof typeof protectedSearchProfileSpecs];
  const profileName = process.env.YLABS_INVENTORY_PROFILE_NAME;
  const inventoryPathValue = process.env.YLABS_INVENTORY_PROFILE_PATH;
  const searchPathValue = process.env.YLABS_SEARCH_BASELINE_PROFILE_PATH;
  if (
    !expected ||
    process.env.YLABS_SEARCH_BASELINE_PROFILE_ACTIVE !== 'true' ||
    profileName !== expected.name ||
    !inventoryPathValue ||
    !searchPathValue ||
    !path.isAbsolute(inventoryPathValue) ||
    !path.isAbsolute(searchPathValue)
  ) {
    throw new Error(
      'Beta and ProductionCopy search baselines must run through hardened external profiles.',
    );
  }

  const inventoryPath = path.resolve(inventoryPathValue);
  const searchPath = path.resolve(searchPathValue);
  const profileDirectory = path.dirname(inventoryPath);
  const repoRoot = path.resolve(__dirname, '../../..');
  const relativeToRepo = path.relative(repoRoot, profileDirectory);
  if (
    relativeToRepo === '' ||
    (!relativeToRepo.startsWith(`..${path.sep}`) &&
      relativeToRepo !== '..' &&
      !path.isAbsolute(relativeToRepo))
  ) {
    throw new Error('Protected search baseline profiles must be outside the repository.');
  }
  if (
    path.basename(inventoryPath) !== expected.inventoryFile ||
    path.basename(searchPath) !== expected.searchFile ||
    path.dirname(searchPath) !== profileDirectory ||
    fs.realpathSync.native(profileDirectory) !== profileDirectory ||
    fs.realpathSync.native(inventoryPath) !== inventoryPath ||
    fs.realpathSync.native(searchPath) !== searchPath
  ) {
    throw new Error('Protected search baseline profile paths are invalid or contain symlinks.');
  }

  const directoryStat = fs.lstatSync(profileDirectory);
  const inventoryStat = fs.lstatSync(inventoryPath);
  const searchStat = fs.lstatSync(searchPath);
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) {
    throw new Error('The protected search baseline profile directory must be private.');
  }
  if (
    !inventoryStat.isFile() ||
    !searchStat.isFile() ||
    (inventoryStat.mode & 0o777) !== 0o600 ||
    (searchStat.mode & 0o777) !== 0o600
  ) {
    throw new Error('Protected search baseline profiles must be mode-0600 regular files.');
  }
  if (
    typeof process.getuid === 'function' &&
    (directoryStat.uid !== process.getuid() ||
      inventoryStat.uid !== process.getuid() ||
      searchStat.uid !== process.getuid())
  ) {
    throw new Error('Protected search baseline profiles must be owned by the current user.');
  }

  const inventoryValues = dotenv.parse(fs.readFileSync(inventoryPath));
  if (Object.keys(inventoryValues).length !== 1 || !inventoryValues.MONGODBURL) {
    throw new Error('The inventory profile may contain only MONGODBURL.');
  }
  if (inventoryValues.MONGODBURL !== process.env.MONGODBURL) {
    throw new Error('MONGODBURL must exactly match the protected inventory profile.');
  }
  let mongoUrl: URL;
  let databaseName: string;
  let username: string;
  let password: string;
  try {
    mongoUrl = new URL(inventoryValues.MONGODBURL);
    databaseName = decodeURIComponent(mongoUrl.pathname.slice(1));
    username = decodeURIComponent(mongoUrl.username);
    password = decodeURIComponent(mongoUrl.password);
  } catch {
    throw new Error('The inventory profile must contain a valid encoded Atlas URL.');
  }
  const tlsDisabled =
    mongoUrl.searchParams.getAll('tls').some((value) => value.toLowerCase() === 'false') ||
    mongoUrl.searchParams.getAll('ssl').some((value) => value.toLowerCase() === 'false');
  const directConnection = mongoUrl.searchParams
    .getAll('directConnection')
    .some((value) => value.toLowerCase() === 'true');
  if (
    mongoUrl.protocol !== 'mongodb+srv:' ||
    !mongoUrl.hostname.toLowerCase().endsWith('.mongodb.net') ||
    !username ||
    !password ||
    databaseName !== expected.databaseName ||
    protectedProfilePlaceholderPattern.test(username) ||
    protectedProfilePlaceholderPattern.test(password) ||
    tlsDisabled ||
    directConnection
  ) {
    throw new Error('The inventory profile no longer satisfies the protected Atlas contract.');
  }

  const searchValues = dotenv.parse(fs.readFileSync(searchPath));
  const expectedSearchKeys = [
    'MEILISEARCH_API_KEY',
    'MEILISEARCH_HOST',
    'MEILISEARCH_INDEX_PREFIX',
    'PHASE0_SEARCH_BASELINE_SALT',
  ];
  if (
    Object.keys(searchValues).sort().join(',') !== expectedSearchKeys.sort().join(',') ||
    expectedSearchKeys.some((key) => !searchValues[key])
  ) {
    throw new Error('The protected search profile has unexpected or missing keys.');
  }
  for (const key of expectedSearchKeys) {
    if (searchValues[key] !== process.env[key]) {
      throw new Error(`${key} must exactly match the protected search profile.`);
    }
  }
  let meiliHost: URL;
  try {
    meiliHost = new URL(searchValues.MEILISEARCH_HOST);
  } catch {
    throw new Error('The protected search profile must contain a valid Meilisearch URL.');
  }
  const indexPrefix = searchValues.MEILISEARCH_INDEX_PREFIX;
  const prefixMatches =
    typeof expected.indexPrefix === 'string'
      ? indexPrefix.toLowerCase() === expected.indexPrefix
      : expected.indexPrefix.test(indexPrefix);
  if (
    meiliHost.protocol !== 'https:' ||
    meiliHost.username ||
    meiliHost.password ||
    ['localhost', '127.0.0.1', '::1'].includes(meiliHost.hostname.toLowerCase()) ||
    protectedProfilePlaceholderPattern.test(meiliHost.hostname) ||
    protectedProfilePlaceholderPattern.test(searchValues.MEILISEARCH_API_KEY) ||
    searchValues.PHASE0_SEARCH_BASELINE_SALT.length < 32 ||
    protectedProfilePlaceholderPattern.test(searchValues.PHASE0_SEARCH_BASELINE_SALT) ||
    !prefixMatches
  ) {
    throw new Error('The search profile no longer satisfies the protected target contract.');
  }
}

function roundedMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sourceCommit(
  runCommand: typeof execFileSync = execFileSync,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const worktreeRoot = path.resolve(__dirname, '../../..');
  const declared =
    environment.SOURCE_COMMIT || environment.RENDER_GIT_COMMIT || environment.GIT_COMMIT;
  try {
    const status = runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: worktreeRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (status.trim()) {
      throw new Error('Search baseline evidence requires a clean source worktree.');
    }
    const head = runCommand('git', ['rev-parse', 'HEAD'], {
      cwd: worktreeRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(head)) {
      throw new Error('Unable to resolve a full source commit.');
    }
    if (declared) {
      const normalizedDeclared = declared.trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(normalizedDeclared) || normalizedDeclared !== head) {
        throw new Error('Declared source commit does not match the clean worktree HEAD.');
      }
    }
    return head;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('clean source worktree') ||
        error.message.includes('Declared source commit') ||
        error.message.includes('full source commit'))
    ) {
      throw error;
    }
    throw new Error('Unable to verify a clean source commit for the search baseline.');
  }
}

function assertPrivateArtifactParent(output: string): void {
  const parent = path.dirname(output);
  const systemTemp = path.resolve(os.tmpdir());
  const projectTemp = path.resolve(process.cwd(), 'tmp');
  const approvedRoot =
    parent === systemTemp || parent.startsWith(`${systemTemp}${path.sep}`)
      ? systemTemp
      : parent === projectTemp || parent.startsWith(`${projectTemp}${path.sep}`)
        ? projectTemp
        : undefined;
  if (!approvedRoot) {
    throw new Error('--output parent is outside the approved temporary directory.');
  }

  const rootParent = path.dirname(approvedRoot);
  const rootParentStat = fs.lstatSync(rootParent);
  if (!rootParentStat.isDirectory() || rootParentStat.isSymbolicLink()) {
    throw new Error('--output temporary root parent must be a real directory.');
  }
  if (!fs.existsSync(approvedRoot)) {
    fs.mkdirSync(approvedRoot, { mode: 0o700 });
  }

  const rootStat = fs.lstatSync(approvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('--output temporary root must be a real directory.');
  }
  const resolvedRoot = fs.realpathSync(approvedRoot);
  let current = approvedRoot;
  for (const component of path.relative(approvedRoot, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { mode: 0o700 });
    }
    const currentStat = fs.lstatSync(current);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new Error('--output parent must contain only real directories.');
    }
    const resolvedCurrent = fs.realpathSync(current);
    if (
      resolvedCurrent !== resolvedRoot &&
      !resolvedCurrent.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error('--output parent resolves outside the approved temporary directory.');
    }
  }
}

export function writePhase0ResearchSearchBaseline(
  report: Phase0ResearchSearchBaselineReport,
  outputValue: string,
): { output: string; sha256: string; bytes: number } {
  const output = resolveSafeJsonReportOutputPath(outputValue);
  assertPrivateArtifactParent(output);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const fd = fs.openSync(
    output,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    0o600,
  );
  try {
    fs.writeFileSync(fd, body, { encoding: 'utf8' });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(output, 0o600);
  return {
    output,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body),
  };
}

async function main(): Promise<void> {
  const options = parsePhase0ResearchSearchBaselineArgs(process.argv.slice(2));
  assertHardenedSearchBaselineProfile(options.environment);
  const salt = requirePhase0ResearchSearchSalt(process.env.PHASE0_SEARCH_BASELINE_SALT);
  assertPhase0SummaryOnlyConfiguredTarget({
    summaryOnly: true,
    environment: options.environment,
    mongoUrl: process.env.MONGODBURL,
    scriptName: 'model-refactor:search-baseline',
  });
  const meiliTarget = assertPhase0ResearchSearchMeiliTarget({
    environment: options.environment,
    host: process.env.MEILISEARCH_HOST,
    indexPrefix: process.env.MEILISEARCH_INDEX_PREFIX,
  });

  await initializeConnections();
  const databaseName = mongoose.connection.db?.databaseName || mongoose.connection.name || '';
  assertPhase0SummaryOnlyConnectedTarget({
    summaryOnly: true,
    environment: options.environment,
    databaseName,
    scriptName: 'model-refactor:search-baseline',
  });

  const index = await getMeiliIndex('researchentities');
  const [meiliSettings, meiliStats] = await Promise.all([index.getSettings(), index.getStats()]);
  const cases = [];
  for (const searchCase of PHASE0_RESEARCH_SEARCH_CASES) {
    const samples: Phase0ResearchSearchSample[] = [];
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      const startedAt = performance.now();
      const result = await searchResearchGroupsViaMeili(
        searchCase.query,
        searchCase.filters,
        searchCase.page,
        searchCase.pageSize,
      );
      const resultIds = result.researchEntities
        .map((entity) => serializedDocumentId(entity._id))
        .filter((id): id is string => Boolean(id))
        .slice(0, options.topK);
      samples.push({
        latencyMs: roundedMilliseconds(performance.now() - startedAt),
        estimatedTotalHits: Math.max(0, Math.floor(result.estimatedTotalHits || 0)),
        degraded: result.degraded === true,
        topResultFingerprints: resultIds.map((id) =>
          phase0ResearchSearchResultFingerprint(id, salt),
        ),
      });
    }
    cases.push(summarizePhase0ResearchSearchCase(searchCase, samples));
  }

  const report = buildPhase0ResearchSearchBaselineReport({
    generatedAt: new Date().toISOString(),
    sourceCommit: sourceCommit(),
    environment: options.environment,
    databaseName,
    salt,
    meiliTarget,
    meiliSettings,
    meiliStats,
    iterations: options.iterations,
    topK: options.topK,
    cases,
  });
  const receipt = writePhase0ResearchSearchBaseline(report, options.output);
  const protectedProfileActive = options.environment !== 'development';
  console.log(
    JSON.stringify(
      protectedProfileActive
        ? {
            artifactType: report.artifactType,
            environment: report.environment,
            databaseName: report.databaseName,
            sourceCommit: report.sourceCommit,
            reviewRequired: report.summary.reviewRequired,
          }
        : {
            artifactType: report.artifactType,
            environment: report.environment,
            databaseName: report.databaseName,
            sourceCommit: report.sourceCommit,
            output: receipt.output,
            sha256: receipt.sha256,
            bytes: receipt.bytes,
            reviewRequired: report.summary.reviewRequired,
          },
      null,
      2,
    ),
  );

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
      console.error('Phase 0 ResearchEntity search baseline failed:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
