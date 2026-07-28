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

function roundedMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

function sourceCommit(): string {
  const declared =
    process.env.SOURCE_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT;
  if (declared && /^[a-f0-9]{7,64}$/i.test(declared.trim())) {
    return declared.trim().toLowerCase();
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
  } catch {
    throw new Error(
      'Unable to resolve the source commit. Set SOURCE_COMMIT to the exact commit under audit.',
    );
  }
}

function assertPrivateArtifactParent(output: string): void {
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('--output parent must be a real directory.');
  }

  const resolvedParent = fs.realpathSync(parent);
  const resolvedTemp = fs.realpathSync(path.resolve(os.tmpdir()));
  const projectTemp = path.resolve(process.cwd(), 'tmp');
  const insideSystemTemp =
    resolvedParent === resolvedTemp || resolvedParent.startsWith(`${resolvedTemp}${path.sep}`);
  let insideProjectTemp = false;
  if (fs.existsSync(projectTemp)) {
    const resolvedProjectTemp = fs.realpathSync(projectTemp);
    insideProjectTemp =
      resolvedParent === resolvedProjectTemp ||
      resolvedParent.startsWith(`${resolvedProjectTemp}${path.sep}`);
  }
  if (!insideSystemTemp && !insideProjectTemp) {
    throw new Error('--output parent resolves outside the approved temporary directory.');
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
  console.log(
    JSON.stringify(
      {
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
