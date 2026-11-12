import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, describe, expect, it, vi } from 'vitest';

import tsupConfig from '../../../tsup.config';
import { isRequestServingProcess, resetDevWriteGuardStateForTests } from '../devWriteGuard';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const SERVER_SRC = path.join(SERVER_ROOT, 'src');
const REPO_ROOT = path.dirname(SERVER_ROOT);
const DECLARATION = 'declareRequestServingProcess';
const MODEL_WRITE_METHODS = new Set([
  'save',
  'create',
  'insertMany',
  'insertOne',
  'bulkWrite',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
]);

const SWEEP_RUNNER_JOBS: Record<string, 'holds-apply-lease-for-run' | 'writes-nothing'> = {
  'scrape:sweep:weekly-development': 'holds-apply-lease-for-run',
  'scrape:sweep:rerun-source': 'holds-apply-lease-for-run',
  'scrape:probe-hosts': 'writes-nothing',
};

const productionSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['__tests__', 'node_modules', 'test'].includes(entry.name)
        ? []
        : productionSources(full);
    }
    return entry.name.endsWith('.ts') && !/\.(test|spec|d)\.ts$/.test(entry.name) ? [full] : [];
  });

function calledNames(file: string): string[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) names.push(callee.text);
      if (ts.isPropertyAccessExpression(callee)) names.push(callee.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const serverScripts = (): Record<string, string> =>
  JSON.parse(read(path.join(SERVER_ROOT, 'package.json'))).scripts;

const connectStates = vi.hoisted(() => [] as boolean[]);

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../../app', () => ({ default: { listen: vi.fn(() => ({})) } }));
vi.mock('../connections', () => ({
  initializeConnections: vi.fn(async () => {
    const { isRequestServingProcess: servingAtConnect } = await import('../devWriteGuard');
    connectStates.push(servingAtConnect());
  }),
  mongoOptions: {},
  startMongoKeepAlive: vi.fn(),
}));
vi.mock('../../utils/controlledVocabularyHeadings', () => ({
  warmControlledVocabularyHeadings: vi.fn(async () => undefined),
}));
vi.mock('../../scripts/gateRefreshScheduler', () => ({ startGateRefreshScheduler: vi.fn() }));
vi.mock('../../services/corpusQualitySnapshotScheduler', () => ({
  startCorpusQualitySnapshotScheduler: vi.fn(),
}));
vi.mock('../../services/researchSearchSpellingVocabulary', () => ({
  startResearchSearchSpellingVocabularyRefresh: vi.fn(),
}));
vi.mock('../../utils/errorTracking', () => ({
  captureStartupError: vi.fn(async () => undefined),
  initializeErrorTracking: vi.fn(),
}));
vi.mock('../../middleware/rateLimiters', () => ({ describeFirstContactCeiling: vi.fn(() => '') }));
vi.mock('../../passport', () => ({ localAuthBypassStartupNotice: vi.fn(() => null) }));
vi.mock('../../serverShutdown', () => ({ registerGracefulShutdown: vi.fn() }));
vi.mock('../../utils/worktreePortGuard', () => ({ worktreePortConflict: vi.fn(() => null) }));
vi.mock('../../services/directoryRemovalServing', () => ({
  directoryRemovalServingStateMessage: vi.fn(() => ''),
  freshDirectoryRemovalServing: vi.fn(async () => ({})),
}));
vi.mock('../../services/accountDeletionServing', () => ({
  accountDeletionServingState: vi.fn(() => ({ status: 'available' })),
  accountDeletionServingStateMessage: vi.fn(() => ''),
}));

const commandTokens = (command: string) => command.split(/\s+|&&/).filter(Boolean);

type ServiceClass =
  | { kind: 'request-serving'; runs: string }
  | { kind: 'script'; runs: string; why: string }
  | { kind: 'not-node'; runs: string };

/**
 * Every service the deployment inventory lists. A new service, in the inventory or in a Render
 * blueprint, must be classified here before this suite passes.
 */
const DEPLOYED_SERVICES: Record<string, ServiceClass> = {
  'Beta web service': { kind: 'request-serving', runs: 'yarn --cwd server start' },
  'Production web service': { kind: 'request-serving', runs: 'yarn --cwd server start' },
  'Meilisearch private service': { kind: 'not-node', runs: 'the pinned Meilisearch image' },
  'Beta operator service (`ylabs-beta-operator`)': {
    kind: 'script',
    runs: '`true` on its schedule; one-off jobs run promote:remote-phase',
    why: 'it writes Beta only, where the guard is a no-op',
  },
  'Production operator service (`ylabs-prod-operator`)': {
    kind: 'script',
    runs: '`true` on its schedule; one-off jobs run promote:remote-phase',
    why: 'it writes Production only, where the guard is a no-op',
  },
  '`ylabs-scraper`': {
    kind: 'script',
    runs: 'deploy/sweep-runner/entrypoint.sh',
    why: 'its sweep jobs hold the apply lease for the whole run, and its host probe only reads',
  },
};

function inventoryServiceNames(): string[] {
  const inventory = read(path.join(REPO_ROOT, 'docs', 'deployment-inventory.md'));
  const section = inventory.split(/^## Services$/m)[1]?.split(/^## /m)[0] ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !/^\| (Service|-+) /.test(line))
    .map((line) => line.split('|')[1].trim());
}

function blueprintServiceNames(): string[] | null {
  const blueprint = ['render.yaml', 'render.yml']
    .map((name) => path.join(REPO_ROOT, name))
    .find((file) => fs.existsSync(file));
  if (!blueprint) return null;
  return [...read(blueprint).matchAll(/^\s*-?\s*name:\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map(
    ([, name]) => name,
  );
}

describe('the API server entry point', () => {
  afterAll(() => resetDevWriteGuardStateForTests());

  it('declares the process request-serving before its first connect', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(isRequestServingProcess()).toBe(false);

    await import('../../index');
    await vi.waitFor(() => expect(connectStates).toHaveLength(1));

    expect(connectStates).toEqual([true]);
  });

  it('is the only production module that declares a process request-serving', () => {
    const declaring = productionSources(SERVER_SRC)
      .filter((file) => file !== path.join(SERVER_SRC, 'db', 'devWriteGuard.ts'))
      .filter((file) => calledNames(file).includes(DECLARATION))
      .map((file) => path.relative(SERVER_SRC, file));
    expect(declaring).toEqual(['index.ts']);
  });

  it('is the one module every request-serving command runs', () => {
    expect(tsupConfig).toMatchObject({ entry: ['src/index.ts'], outDir: 'build' });
    const servingScripts = Object.entries(serverScripts())
      .filter(([, command]) =>
        commandTokens(command).some((token) => ['src/index.ts', 'build/index.js'].includes(token)),
      )
      .map(([name]) => name)
      .sort();
    expect(servingScripts).toEqual(['dev', 'prod', 'start']);
    expect(commandTokens(serverScripts().start).at(-1)).toBe('build/index.js');
  });
});

describe('every deployed service is classified as request-serving or a script', () => {
  it('classifies every service the deployment inventory lists, and only those', () => {
    const listed = inventoryServiceNames();
    expect(listed.length).toBeGreaterThanOrEqual(5);
    expect(listed.filter((name) => !DEPLOYED_SERVICES[name])).toEqual([]);
    expect(Object.keys(DEPLOYED_SERVICES).filter((name) => !listed.includes(name))).toEqual([]);
  });

  it('classifies every service a Render blueprint declares, if one is added', () => {
    const declared = blueprintServiceNames();
    if (declared === null) return;
    const classified = Object.keys(DEPLOYED_SERVICES).map((name) =>
      name.replace(/^.*\(`([^`]+)`\)$/, '$1').replace(/`/g, ''),
    );
    expect(declared.filter((name) => !classified.includes(name))).toEqual([]);
  });

  it('runs the request-serving entry point on every request-serving service', () => {
    for (const service of Object.values(DEPLOYED_SERVICES)) {
      if (service.kind !== 'request-serving') continue;
      expect(service.runs).toBe('yarn --cwd server start');
    }
  });

  it('runs only sweep-runner jobs that hold the apply lease for the run or write nothing', () => {
    const entrypoint = read(path.join(REPO_ROOT, 'deploy', 'sweep-runner', 'entrypoint.sh'));
    const jobs = new Set([
      ...[...entrypoint.matchAll(/yarn --cwd server ([a-z][\w:-]+)/g)].map(([, job]) => job),
      ...[...entrypoint.matchAll(/job_script="([\w:-]+)"/g)].map(([, job]) => job),
    ]);
    expect([...jobs].sort()).toEqual(Object.keys(SWEEP_RUNNER_JOBS).sort());

    for (const [job, kind] of Object.entries(SWEEP_RUNNER_JOBS)) {
      const file = serverScripts()[job]?.match(/tsx (src\/\S+\.ts)/)?.[1];
      expect(file, job).toBeTruthy();
      const called = calledNames(path.join(SERVER_ROOT, file!));
      if (kind === 'holds-apply-lease-for-run') {
        expect(called, job).toContain('holdDevApplyLeaseForRun');
      } else {
        expect(
          called.filter((name) => MODEL_WRITE_METHODS.has(name)),
          job,
        ).toEqual([]);
      }
    }
  });
});
