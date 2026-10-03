import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootScripts = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).scripts;
const ciWorkflow = yaml.load(
  fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
);

const scriptTestFiles = fs
  .readdirSync(path.join(repoRoot, 'scripts'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => `scripts/${name}`)
  .sort();

const rootYarnScriptNames = (command) =>
  [...command.matchAll(/(?:^|&&|;)\s*yarn\s+(?!--cwd)([\w:.-]+)/g)].map((match) => match[1]);

const expandRootScript = (name, seen = new Set()) => {
  if (seen.has(name) || !rootScripts[name]) return [];
  seen.add(name);
  const command = rootScripts[name];
  return [
    command,
    ...rootYarnScriptNames(command).flatMap((child) => expandRootScript(child, seen)),
  ];
};

const commandsReachedFrom = (commands) =>
  commands.flatMap((command) => [
    command,
    ...rootYarnScriptNames(command).flatMap((name) => expandRootScript(name)),
  ]);

const testFilesNamedBy = (commands) => {
  const reached = new Set();
  for (const command of commands) {
    for (const token of command.split(/\s+/)) {
      if (token === 'scripts/*.test.mjs') scriptTestFiles.forEach((file) => reached.add(file));
      else if (scriptTestFiles.includes(token)) reached.add(token);
    }
  }
  return reached;
};

const ciRunCommands = Object.values(ciWorkflow.jobs ?? {})
  .flatMap((job) => job.steps ?? [])
  .map((step) => step.run)
  .filter((run) => typeof run === 'string');

test('every scripts/*.test.mjs suite is executed by a CI step', () => {
  const reached = testFilesNamedBy(commandsReachedFrom(ciRunCommands));
  assert.deepEqual(
    scriptTestFiles.filter((file) => !reached.has(file)),
    [],
  );
});

test('every scripts/*.test.mjs suite is executed by yarn verify', () => {
  const reached = testFilesNamedBy(expandRootScript('verify'));
  assert.deepEqual(
    scriptTestFiles.filter((file) => !reached.has(file)),
    [],
  );
});
