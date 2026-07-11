import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveScraperEnvironment, summarizeMongoUrl } from '../scrapers/scraperEnvironment';
import type { ScraperEnvironment } from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '../..');
const DEFAULT_ARTIFACT_DIR = '/tmp/ylabs-beta-seed';

export interface BetaSeedEnvironmentCliOptions {
  apply: boolean;
  confirmBetaSeed: boolean;
  seedSources: boolean;
  runReadiness: boolean;
  runPathwayRelevance: boolean;
  rebuildMeili: boolean;
  sources: string[];
  artifactDir: string;
  output?: string;
}

export interface BetaSeedTargetMetadata {
  environment: ScraperEnvironment;
  dbLabel: string;
}

export interface BetaSeedPlanStep {
  name: string;
  description: string;
  command: 'yarn';
  args: string[];
  cwd: string;
  env: Record<string, string>;
  writes: boolean;
  output?: string;
}

export interface BetaSeedPlan {
  mode: 'dry-run' | 'apply';
  target: {
    environment: ScraperEnvironment;
    db: string;
  };
  artifactDir: string;
  generatedAt: string;
  steps: BetaSeedPlanStep[];
}

export interface BetaSeedRunResult extends BetaSeedPlan {
  results: Array<{
    name: string;
    ok: boolean;
    exitCode: number | null;
    durationMs: number;
    output?: string;
  }>;
}

export function parseBetaSeedEnvironmentArgs(argv: string[]): BetaSeedEnvironmentCliOptions {
  const options: BetaSeedEnvironmentCliOptions = {
    apply: false,
    confirmBetaSeed: false,
    seedSources: true,
    runReadiness: true,
    runPathwayRelevance: true,
    rebuildMeili: true,
    sources: [],
    artifactDir: DEFAULT_ARTIFACT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--confirm-beta-seed') {
      options.confirmBetaSeed = true;
      continue;
    }
    if (arg === '--skip-source-metadata') {
      options.seedSources = false;
      continue;
    }
    if (arg === '--skip-readiness') {
      options.runReadiness = false;
      continue;
    }
    if (arg === '--skip-pathway-relevance') {
      options.runPathwayRelevance = false;
      continue;
    }
    if (arg === '--skip-meili') {
      options.rebuildMeili = false;
      continue;
    }
    if (arg === '--source') {
      options.sources.push(parseRequiredValue(argv[index + 1], '--source'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--source=')) {
      options.sources.push(parseRequiredValue(arg.slice('--source='.length), '--source'));
      continue;
    }
    if (arg === '--sources') {
      options.sources.push(...parseSourceList(parseRequiredValue(argv[index + 1], '--sources')));
      index += 1;
      continue;
    }
    if (arg.startsWith('--sources=')) {
      options.sources.push(
        ...parseSourceList(parseRequiredValue(arg.slice('--sources='.length), '--sources')),
      );
      continue;
    }
    if (arg === '--artifact-dir') {
      options.artifactDir = resolveSafeArtifactDir(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--artifact-dir=')) {
      options.artifactDir = resolveSafeArtifactDir(arg.slice('--artifact-dir='.length));
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown beta seed argument: ${arg}`);
  }

  options.sources = Array.from(new Set(options.sources));
  return options;
}

function parseRequiredValue(value: string | undefined, flag: string): string {
  const parsed = value?.trim();
  if (!parsed || parsed.startsWith('--')) {
    throw new Error(
      `${flag} requires a ${flag === '--artifact-dir' || flag === '--output' ? 'path' : 'value'}`,
    );
  }
  return parsed;
}

function resolveSafeArtifactDir(value: string | undefined): string {
  const parsed = parseRequiredValue(value, '--artifact-dir');
  return path.dirname(
    resolveSafeJsonReportOutputPath(path.join(parsed, 'artifact-root.json'), '--artifact-dir'),
  );
}

function parseSourceList(value: string): string[] {
  return value
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean);
}

export function assertBetaSeedAllowed(args: {
  options: BetaSeedEnvironmentCliOptions;
  env?: NodeJS.ProcessEnv;
  mongoUrl?: string;
}): BetaSeedTargetMetadata {
  const env = args.env || process.env;
  const environment = resolveScraperEnvironment(env);
  const dbLabel = summarizeMongoUrl(args.mongoUrl ?? process.env.MONGODBURL);

  if (environment !== 'beta') {
    throw new Error(
      `beta:seed-environment must run with SCRAPER_ENV=beta. Current target: SCRAPER_ENV=${environment}; Mongo target: ${dbLabel}.`,
    );
  }

  if (args.options.apply && !args.options.confirmBetaSeed) {
    throw new Error(
      '--confirm-beta-seed is required when --apply is set for beta:seed-environment',
    );
  }

  return { environment, dbLabel };
}

export function buildBetaSeedPlan(
  options: BetaSeedEnvironmentCliOptions,
  target: BetaSeedTargetMetadata,
): BetaSeedPlan {
  const steps: BetaSeedPlanStep[] = [];
  const artifactDir = resolveSafeArtifactDir(options.artifactDir);
  const betaWriteEnv = {
    SCRAPER_ENV: 'beta',
    ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
  };
  const betaEnv = { SCRAPER_ENV: 'beta' };

  if (options.runReadiness) {
    steps.push({
      name: 'beta-readiness-preflight',
      description: 'Check Beta readiness before writes.',
      command: 'yarn',
      args: [
        'beta:readiness',
        '--confirm-beta-backup',
        '--output',
        path.join(artifactDir, 'beta-readiness-preflight.json'),
      ],
      cwd: SERVER_ROOT,
      env: betaEnv,
      writes: false,
      output: path.join(artifactDir, 'beta-readiness-preflight.json'),
    });
  }

  if (options.seedSources) {
    steps.push({
      name: 'seed-source-metadata-dry-run',
      description: 'Preview Source registry changes.',
      command: 'yarn',
      args: [
        'scrape:seed-sources',
        '--dry-run',
        '--output',
        path.join(artifactDir, 'seed-sources-dry-run.json'),
      ],
      cwd: SERVER_ROOT,
      env: betaWriteEnv,
      writes: false,
      output: path.join(artifactDir, 'seed-sources-dry-run.json'),
    });
    steps.push({
      name: 'seed-source-metadata-apply',
      description: 'Apply Source registry changes after the dry-run artifact is saved.',
      command: 'yarn',
      args: [
        'scrape:seed-sources',
        '--apply',
        '--confirm-seed-apply',
        '--output',
        path.join(artifactDir, 'seed-sources-apply.json'),
      ],
      cwd: SERVER_ROOT,
      env: betaWriteEnv,
      writes: true,
      output: path.join(artifactDir, 'seed-sources-apply.json'),
    });
  }

  for (const source of options.sources) {
    const output = path.join(artifactDir, `source-${safeArtifactName(source)}-report.json`);
    steps.push({
      name: `run-source-${source}`,
      description: `Run and materialize accepted Beta source ${source}.`,
      command: 'yarn',
      args: ['scrape', 'run', '--source', source, '--auto-materialize', '--output', output],
      cwd: SERVER_ROOT,
      env: betaWriteEnv,
      writes: true,
      output,
    });
  }

  if (options.rebuildMeili) {
    steps.push({
      name: 'rebuild-pathway-meili-index',
      description: 'Clear and rebuild the Beta Pathways Meilisearch index.',
      command: 'yarn',
      args: [
        'meili:rebuild-pathways',
        '--clear',
        '--confirm-meili-rebuild',
        '--output',
        path.join(artifactDir, 'meili-pathways-rebuild.json'),
      ],
      cwd: SERVER_ROOT,
      env: betaEnv,
      writes: true,
      output: path.join(artifactDir, 'meili-pathways-rebuild.json'),
    });
    steps.push({
      name: 'rebuild-research-entity-meili-index',
      description: 'Clear and rebuild the Beta research entity Meilisearch index.',
      command: 'yarn',
      args: [
        'meili:rebuild-research-entities',
        '--clear',
        '--confirm-meili-rebuild',
        '--output',
        path.join(artifactDir, 'meili-research-entities-rebuild.json'),
      ],
      cwd: SERVER_ROOT,
      env: betaEnv,
      writes: true,
      output: path.join(artifactDir, 'meili-research-entities-rebuild.json'),
    });
  }

  if (options.runPathwayRelevance) {
    steps.push({
      name: 'pathway-relevance-review',
      description: 'Compare Mongo-backed and Meili-backed pathway search posture.',
      command: 'yarn',
      args: [
        'pathway:relevance-review',
        '--output',
        path.join(artifactDir, 'pathway-relevance-review.json'),
      ],
      cwd: SERVER_ROOT,
      env: {
        SCRAPER_ENV: 'beta',
        PATHWAY_SEARCH_BACKEND: 'mongo',
      },
      writes: false,
      output: path.join(artifactDir, 'pathway-relevance-review.json'),
    });
  }

  if (options.runReadiness && options.rebuildMeili) {
    steps.push({
      name: 'beta-readiness-meili-acceptance',
      description: 'Run strict Beta readiness with Meili acceptance after rebuild.',
      command: 'yarn',
      args: [
        'beta:readiness',
        '--confirm-beta-backup',
        '--accept-pathway-meili',
        '--strict',
        '--output',
        path.join(artifactDir, 'beta-readiness-meili-acceptance.json'),
      ],
      cwd: SERVER_ROOT,
      env: {
        SCRAPER_ENV: 'beta',
        PATHWAY_SEARCH_BACKEND: 'meili',
      },
      writes: false,
      output: path.join(artifactDir, 'beta-readiness-meili-acceptance.json'),
    });
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    target: {
      environment: target.environment,
      db: target.dbLabel,
    },
    artifactDir,
    generatedAt: new Date().toISOString(),
    steps,
  };
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'source';
}

export function writeBetaSeedOutput(report: unknown, output?: string): void {
  if (!output) return;
  const safeOutput = resolveSafeJsonReportOutputPath(output);
  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
}

async function runStep(step: BetaSeedPlanStep): Promise<BetaSeedRunResult['results'][number]> {
  fs.mkdirSync(path.dirname(step.output || path.join(step.cwd, 'unused')), { recursive: true });
  const startedAt = Date.now();
  process.stdout.write(`\n=== beta:seed-environment -> ${step.name} ===\n`);
  process.stdout.write(`${step.command} ${step.args.join(' ')}\n`);

  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...step.env },
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      resolve({
        name: step.name,
        ok: code === 0,
        exitCode: code,
        durationMs: Date.now() - startedAt,
        output: step.output,
      });
    });
    child.on('error', () => {
      resolve({
        name: step.name,
        ok: false,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        output: step.output,
      });
    });
  });
}

async function runPlan(plan: BetaSeedPlan): Promise<BetaSeedRunResult> {
  const results: BetaSeedRunResult['results'] = [];
  for (const step of plan.steps) {
    // Sequential execution avoids DB and Meili contention during launch operations.

    const result = await runStep(step);
    results.push(result);
    if (!result.ok) break;
  }
  return { ...plan, results };
}

async function main() {
  const options = parseBetaSeedEnvironmentArgs(process.argv.slice(2));
  const target = assertBetaSeedAllowed({ options });
  const plan = buildBetaSeedPlan(options, target);
  const planOutput = options.output || path.join(options.artifactDir, 'beta-seed-plan.json');

  fs.mkdirSync(options.artifactDir, { recursive: true });

  if (!options.apply) {
    console.log(JSON.stringify(plan, null, 2));
    writeBetaSeedOutput(plan, planOutput);
    return;
  }

  writeBetaSeedOutput(plan, planOutput);
  const result = await runPlan(plan);
  const resultOutput = options.output || path.join(options.artifactDir, 'beta-seed-result.json');
  writeBetaSeedOutput(result, resultOutput);
  console.log(JSON.stringify(result, null, 2));
  if (!result.results.every((step) => step.ok)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error('Failed to seed Beta environment:', sanitizeLogValue(error));
    process.exitCode = 1;
  });
}
