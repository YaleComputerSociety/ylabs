import { describe, expect, it } from 'vitest';
import {
  parseCaptureArgs,
  scopeOfStoredBenchmark,
  supersedeRefusal,
} from '../laneBenchmarkCapture';

const base = ['--source=lab-microsite-undergrad-llm', '--id=example-benchmark', '--limit=5'];

describe('parseCaptureArgs', () => {
  it('passes a source concurrency through to the capture run', () => {
    expect(parseCaptureArgs([...base, '--source-concurrency=1']).sourceConcurrency).toBe(1);
  });

  it('leaves the lane default when no concurrency is given', () => {
    expect(parseCaptureArgs(base).sourceConcurrency).toBeUndefined();
  });

  it('refuses a concurrency for a lane that does not honor it', () => {
    expect(() =>
      parseCaptureArgs([
        '--source=dept-faculty-roster',
        '--id=example-benchmark',
        '--limit=5',
        '--source-concurrency=1',
      ]),
    ).toThrow(/does not honor --source-concurrency/);
  });

  it('refuses a concurrency that is not a positive integer', () => {
    expect(() => parseCaptureArgs([...base, '--source-concurrency=0'])).toThrow(/positive integer/);
    expect(() => parseCaptureArgs([...base, '--source-concurrency=two'])).toThrow(
      /positive integer/,
    );
  });
});

describe('recapturing a stored benchmark', () => {
  const stored = {
    benchmarkId: 'example-old',
    sourceName: 'lab-microsite-undergrad-llm',
    only: ['row-b', 'row-a'],
    goldLabels: [],
  };

  it('reads the lane and scope from the stored benchmark rather than the command line', () => {
    const args = parseCaptureArgs(['--recapture=example-old', '--id=example-new']);
    expect(args.recapture).toBe('example-old');
    const scoped = scopeOfStoredBenchmark(args, { ...stored, limit: null });
    expect(scoped.sourceName).toBe('lab-microsite-undergrad-llm');
    expect(scoped.only).toEqual(['row-b', 'row-a']);
    expect(scoped.limit).toBeUndefined();
  });

  it('refuses a scope given alongside a recapture', () => {
    for (const extra of ['--source=dept-faculty-roster', '--only=row-a', '--limit=3']) {
      expect(() =>
        parseCaptureArgs(['--recapture=example-old', '--id=example-new', extra]),
      ).toThrow(/read the lane and scope from the stored benchmark/);
    }
  });

  it('refuses combining a recapture with marking an existing successor', () => {
    expect(() =>
      parseCaptureArgs([
        '--recapture=example-old',
        '--mark-successor-of=example-old',
        '--id=example-new',
      ]),
    ).toThrow(/cannot be combined/);
  });

  it('refuses --without-gold outside a recapture', () => {
    expect(() => parseCaptureArgs([...base, '--without-gold'])).toThrow(/only to --recapture/);
    expect(() =>
      parseCaptureArgs(['--mark-successor-of=example-old', '--id=example-new', '--without-gold']),
    ).toThrow(/captures nothing/);
  });

  it('refuses to replace a benchmark that already has a successor', () => {
    expect(supersedeRefusal(stored, 'example-other', { withoutGold: false })).toMatch(
      /already superseded by example-other/,
    );
  });

  it('refuses to replace a hand-labelled benchmark unless the operator drops gold explicitly', () => {
    const gold = { ...stored, goldLabels: [{ entityKey: 'row-a' }] };
    expect(supersedeRefusal(gold, undefined, { withoutGold: false })).toMatch(/gold labels/);
    expect(supersedeRefusal(gold, undefined, { withoutGold: true })).toBeUndefined();
    expect(supersedeRefusal(stored, undefined, { withoutGold: false })).toBeUndefined();
  });

  it('marks an existing successor only when it has the same lane and scope', () => {
    const successor = { ...stored, benchmarkId: 'example-new', only: ['row-a', 'row-b'] };
    expect(supersedeRefusal(stored, undefined, { withoutGold: false, successor })).toBeUndefined();
    expect(
      supersedeRefusal(stored, undefined, {
        withoutGold: false,
        successor: { ...successor, only: ['row-a'] },
      }),
    ).toMatch(/different lane or scope/);
    expect(
      supersedeRefusal(stored, undefined, {
        withoutGold: false,
        successor: { ...successor, sourceName: 'dept-faculty-roster' },
      }),
    ).toMatch(/different lane or scope/);
    expect(supersedeRefusal(stored, undefined, { withoutGold: false, successor: stored })).toMatch(
      /cannot supersede itself/,
    );
  });
});
