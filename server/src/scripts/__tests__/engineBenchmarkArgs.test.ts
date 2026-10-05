import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { CONFIRM_FLAG, parseEngineBenchmarkArgs } from '../engineBenchmark';
import { NEVER_COPY_COLLECTIONS } from '../mirrorCollectionPolicy';
import {
  ENGINE_BENCHMARK_COLLECTION,
  ENGINE_BENCHMARK_ROW_COLLECTION,
} from '../../models/engineBenchmark';
import { ENGINE_BENCHMARK_SNAPSHOT_COLLECTION } from '../../models/engineBenchmarkSnapshot';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('parseEngineBenchmarkArgs', () => {
  it('defaults to a dry run that stores nothing', () => {
    const args = parseEngineBenchmarkArgs([]);

    expect(args.dryRun).toBe(true);
    expect(args.capture).toBe(false);
    expect(args.replays).toBe(1);
  });

  /**
   * Capture overwrites the frozen input, which is the one irreversible thing this script
   * does: every stored snapshot before it was measured against different rows. So it is
   * gated behind the same apply confirmation as a write, never available in a dry run.
   */
  it('refuses a capture in dry-run mode', () => {
    expect(() => parseEngineBenchmarkArgs(['--capture'])).toThrow(/requires --apply/);
  });

  it('accepts a capture with apply', () => {
    const args = parseEngineBenchmarkArgs(['--capture', '--apply', CONFIRM_FLAG]);

    expect(args.capture).toBe(true);
    expect(args.dryRun).toBe(false);
    expect(args.confirmed).toBe(true);
  });

  it('rejects a replay count below one', () => {
    expect(() => parseEngineBenchmarkArgs(['--replays=0'])).toThrow(/positive integer/);
  });

  it('rejects an unknown argument rather than ignoring it', () => {
    expect(() => parseEngineBenchmarkArgs(['--reindex'])).toThrow(/Unknown/);
  });
});

describe('a run whose replays disagree stores nothing', () => {
  /**
   * A replay that does not agree with itself cannot be compared to a later one, so storing it
   * would put a row in the trend no future run can be measured against. Pinned by reading the
   * source, because the guard is a refusal to write and a behavioural test would need a
   * deliberately nondeterministic engine to exercise it.
   */
  it('gates the snapshot write on the replays agreeing', () => {
    const source = fs.readFileSync(
      path.join(SERVER_ROOT, 'src/scripts/engineBenchmark.ts'),
      'utf8',
    );

    expect(source).toContain('const reproducible = fingerprints.length === 1;');
    expect(source).toContain(
      'if (!options.dryRun && reproducible) await EngineBenchmarkSnapshot.create(',
    );
  });
});

describe('the engine benchmark is registered where it has to be', () => {
  /**
   * A sweep stage names an npm script by string, so a stage whose command does not exist
   * fails at run time rather than at build time (#3526's registry lesson). Pinned here
   * because the sweep is the only thing that stores a trend.
   */
  it('is an npm script the sweep stage can invoke', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const sweep = fs.readFileSync(path.join(SERVER_ROOT, 'src/scripts/runScraperSweep.ts'), 'utf8');

    expect(packageJson.scripts['engine:benchmark']).toBeTruthy();
    expect(sweep).toContain("command: 'engine:benchmark'");
  });

  /**
   * A benchmark is environment-local history: a promotion replaces whole collections, so a
   * copied benchmark would erase the one the target captured and present one environment's
   * engine verdict as the other's.
   */
  it('never travels between environments', () => {
    for (const collection of [
      ENGINE_BENCHMARK_COLLECTION,
      ENGINE_BENCHMARK_ROW_COLLECTION,
      ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
    ]) {
      expect(NEVER_COPY_COLLECTIONS).toContain(collection);
    }
  });

  /**
   * The sweep replays; it must never re-freeze. A sweep that captured every run would
   * compare each run against a benchmark taken from that same run, so no regression could
   * ever show up as a fingerprint change.
   */
  it('does not capture from inside the sweep', () => {
    const sweep = fs.readFileSync(path.join(SERVER_ROOT, 'src/scripts/runScraperSweep.ts'), 'utf8');
    const stage = sweep.slice(sweep.indexOf("name: 'engine-benchmark'"));

    expect(stage.slice(0, stage.indexOf('},'))).not.toContain('--capture');
  });
});
