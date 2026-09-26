import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS,
  FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS,
} from '../runScraperSweep';
import pendingConversion from './humanRunWriteScripts.pending.json';

const SCRIPTS_DIR = path.join(__dirname, '..');
const PACKAGE_JSON = path.join(__dirname, '..', '..', '..', 'package.json');
const WRITE_GUARD_CALL = 'assertScriptApplyAllowed(';
const WRITE_GUARD_MODULE = 'scriptWriteGuards.ts';

/**
 * Write scripts that are meant to be run by a person, and why. Each one records a judgement
 * about one row or operates infrastructure, which is the work AGENTS.md reserves for an
 * operator. Anything else that writes belongs in a lane or a sweep stage (#3524).
 */
const OPERATOR_TOOLS: Record<string, string> = {
  'research-entity:refuse-field-value': 'records a per-row refusal, the layer-3 writer',
  'research-entity:apply-page-read-verdict':
    'applies a verdict an operator reached by reading a page',
  'research-entity:record-departure': 'records a departure an operator was told about',
  'research-entity:withdraw-non-research-home-row':
    'withdraws one row an operator judged not research',
  'research-entity:release-field-locks': 'releases locks one reviewed row at a time',
  'research-entity:restore-merge-tombstones': 'reverses a merge an operator judged wrong',
  'taxonomy:review-term': 'records a curated review of one taxonomy term',
  'programs:accept-formalization-exceptions': 'records reviewed exceptions',
  'launch:review-exceptions': 'records reviewed launch exceptions',
  'db:build-indexes': 'builds declared indexes, a reviewed schema operation',
  'research-entity:rematerialize': 're-derives rows on demand through the engine itself',
  'observations:catch-up-materialize': 'drains the materialize backlog through the engine itself',
  'beta:readiness': 'promotion tooling, run as part of the release process',
  'beta:repair-queue': 'promotion tooling, run as part of the release process',
  'beta:clear-student-analytics': 'promotion tooling, run as part of the release process',
};

/**
 * The ceiling on write scripts only a person can run that are neither operator tools nor sweep
 * stages. Lower it when one is converted or deleted. Raising it is the thing this guard exists
 * to make a visible, reviewed decision.
 */
const PENDING_CONVERSION_CEILING = 122;

function commandsByScriptFile(): Map<string, string[]> {
  const scripts =
    (JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as { scripts?: Record<string, string> })
      .scripts ?? {};
  const byFile = new Map<string, string[]>();
  for (const [command, line] of Object.entries(scripts)) {
    const match = line.match(/src\/scripts\/([\w./-]+\.ts)/);
    if (!match) continue;
    byFile.set(match[1], [...(byFile.get(match[1]) ?? []), command]);
  }
  return byFile;
}

function humanRunWriteScripts(): string[] {
  const sweptCommands = new Set(
    [...DEVELOPMENT_POST_RUN_STAGE_DEFINITIONS, ...FELLOWSHIP_POST_RUN_STAGE_DEFINITIONS].map(
      (definition) => definition.command,
    ),
  );
  const byFile = commandsByScriptFile();
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter(
      (file) => file.endsWith('.ts') && !file.endsWith('Core.ts') && file !== WRITE_GUARD_MODULE,
    )
    .filter((file) =>
      fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8').includes(WRITE_GUARD_CALL),
    )
    .flatMap((file) => {
      const commands = byFile.get(file) ?? [];
      if (commands.some((command) => sweptCommands.has(command))) return [];
      return commands.length > 0 ? [commands[0]] : [`unregistered:${file}`];
    })
    .sort();
}

describe('a write script is born as engine behaviour, not a one-off', () => {
  const found = humanRunWriteScripts();
  const operatorTools = new Set(Object.keys(OPERATOR_TOOLS));
  const pending = new Set(pendingConversion);

  it('finds the write scripts it is guarding', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it('has no new write script that only a person can run', () => {
    const undeclared = found.filter((entry) => !operatorTools.has(entry) && !pending.has(entry));
    expect(
      undeclared,
      'Register it as a sweep stage in runScraperSweep.ts, fold its correction into a lane, or, if it records a per-row judgement, add it to OPERATOR_TOOLS with the reason.',
    ).toEqual([]);
  });

  it('keeps the pending list exact, so a converted script is removed from it', () => {
    const stale = [...pending].filter((entry) => !found.includes(entry));
    expect(stale, 'These are converted or deleted: remove them and lower the ceiling.').toEqual([]);
  });

  it('keeps every operator tool a real human-run write script', () => {
    expect([...operatorTools].filter((entry) => !found.includes(entry))).toEqual([]);
  });

  it('never lets the pending list grow past its ceiling', () => {
    expect(pending.size).toBeLessThanOrEqual(PENDING_CONVERSION_CEILING);
    expect(pendingConversion).toHaveLength(pending.size);
  });

  it('never classifies one script both ways', () => {
    expect([...operatorTools].filter((entry) => pending.has(entry))).toEqual([]);
  });
});
