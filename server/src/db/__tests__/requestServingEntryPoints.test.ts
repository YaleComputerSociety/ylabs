import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const SERVER_SRC = path.join(SERVER_ROOT, 'src');
const REPO_ROOT = path.dirname(SERVER_ROOT);
const API_ENTRY = path.join(SERVER_SRC, 'index.ts');
const DECLARATION = 'declareRequestServingProcess';

const read = (file: string) => fs.readFileSync(file, 'utf8');
const serverScripts = (): Record<string, string> =>
  JSON.parse(read(path.join(SERVER_ROOT, 'package.json'))).scripts;

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

const SWEEP_RUNNER_JOBS: Record<string, 'holds-apply-lease-for-run' | 'reads-only'> = {
  'scrape:sweep:weekly-development': 'holds-apply-lease-for-run',
  'scrape:sweep:rerun-source': 'holds-apply-lease-for-run',
  'scrape:probe-hosts': 'reads-only',
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

function topLevelCallIndex(source: ts.SourceFile, callee: string): number {
  return source.statements.findIndex(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) &&
      statement.expression.expression.text === callee,
  );
}

function startAppInvocationIndex(source: ts.SourceFile): number {
  return source.statements.findIndex(
    (statement) =>
      ts.isExpressionStatement(statement) &&
      ts.isVoidExpression(statement.expression) &&
      ts.isCallExpression(statement.expression.expression) &&
      ts.isIdentifier(statement.expression.expression.expression) &&
      statement.expression.expression.expression.text === 'startApp',
  );
}

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

describe('the API server entry point', () => {
  const source = ts.createSourceFile(API_ENTRY, read(API_ENTRY), ts.ScriptTarget.Latest, true);

  it('declares the process request-serving at top level, before it starts and connects', () => {
    const declaration = topLevelCallIndex(source, DECLARATION);
    const start = startAppInvocationIndex(source);
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(declaration);
    expect(read(API_ENTRY)).toMatch(
      new RegExp(`import \\{ ${DECLARATION} \\} from '\\./db/devWriteGuard';`),
    );
  });

  it('is the only module that declares a process request-serving', () => {
    const declaring = productionSources(SERVER_SRC)
      .filter((file) => file !== path.join(SERVER_SRC, 'db', 'devWriteGuard.ts'))
      .filter((file) => read(file).includes(`${DECLARATION}(`))
      .map((file) => path.relative(SERVER_SRC, file));
    expect(declaring).toEqual(['index.ts']);
  });

  it('is the one module every request-serving command runs', () => {
    expect(read(path.join(SERVER_ROOT, 'tsup.config.ts'))).toMatch(/entry: \['src\/index\.ts'\]/);
    const servingScripts = Object.entries(serverScripts())
      .filter(([, command]) => /\b(src\/index\.ts|build\/index\.js)\b/.test(command))
      .map(([name]) => name)
      .sort();
    expect(servingScripts).toEqual(['dev', 'prod', 'start']);
    expect(serverScripts().start).toMatch(/build\/index\.js$/);
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

  it('runs only sweep-runner jobs whose writes are leased or that only read', () => {
    const entrypoint = read(path.join(REPO_ROOT, 'deploy', 'sweep-runner', 'entrypoint.sh'));
    const jobs = new Set([
      ...[...entrypoint.matchAll(/yarn --cwd server ([a-z][\w:-]+)/g)].map(([, job]) => job),
      ...[...entrypoint.matchAll(/job_script="([\w:-]+)"/g)].map(([, job]) => job),
    ]);
    expect([...jobs].sort()).toEqual(Object.keys(SWEEP_RUNNER_JOBS).sort());

    for (const [job, kind] of Object.entries(SWEEP_RUNNER_JOBS)) {
      const command = serverScripts()[job];
      const file = command?.match(/tsx (src\/\S+\.ts)/)?.[1];
      expect(file, job).toBeTruthy();
      const text = read(path.join(SERVER_ROOT, file!));
      if (kind === 'holds-apply-lease-for-run') {
        expect(text, job).toMatch(/holdDevApplyLeaseForRun\(\s*'/);
      } else {
        expect(
          text.match(
            /\.(insertOne|insertMany|updateOne|updateMany|replaceOne|bulkWrite|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete|create|save)\(/g,
          ),
          job,
        ).toBeNull();
      }
    }
  });
});
