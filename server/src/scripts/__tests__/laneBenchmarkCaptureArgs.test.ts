import { describe, expect, it } from 'vitest';
import {
  beginBenchmarkCapture,
  benchmarkCacheWrite,
  finishBenchmarkCapture,
  freezeHostRefusal,
} from '../../scrapers/snapshotBenchmarkMode';
import {
  carryUnchangedGoldLabels,
  emptyCaptureRefusal,
  emptySuccessorRefusal,
  goldCarryRefusal,
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
    expect(supersedeRefusal(stored, 'example-other')).toMatch(
      /already superseded by example-other/,
    );
    expect(supersedeRefusal(stored, undefined)).toBeUndefined();
  });

  it('marks an existing successor only when it has the same lane and scope', () => {
    const successor = { ...stored, benchmarkId: 'example-new', only: ['row-a', 'row-b'] };
    expect(supersedeRefusal(stored, undefined, { successor })).toBeUndefined();
    expect(
      supersedeRefusal(stored, undefined, { successor: { ...successor, only: ['row-a'] } }),
    ).toMatch(/different lane or scope/);
    expect(
      supersedeRefusal(stored, undefined, {
        successor: { ...successor, sourceName: 'dept-faculty-roster' },
      }),
    ).toMatch(/different lane or scope/);
    expect(supersedeRefusal(stored, undefined, { successor: stored })).toMatch(
      /cannot supersede itself/,
    );
  });

  it('refuses a successor that the superseded benchmark already descends from', () => {
    const successor = { ...stored, benchmarkId: 'example-root' };
    expect(
      supersedeRefusal(stored, undefined, {
        successor,
        supersededAncestorIds: ['example-middle', 'example-root'],
      }),
    ).toMatch(/would close a cycle/);
    expect(
      supersedeRefusal(stored, undefined, { successor, supersededAncestorIds: ['example-middle'] }),
    ).toBeUndefined();
  });
});

describe('carrying gold labels into a recapture', () => {
  const judged = 'https://example.org/lab-a';
  const other = 'https://example.org/lab-b';
  const page = (url: string, html: string, status = 200) => ({
    sourceName: 'policy-fetch',
    requestKey: `page:v1:${url}`,
    payload: { url, html, status },
  });
  const label = (url: string | undefined) => ({
    entityKey: 'row-a',
    field: 'undergradEvidenceQuote',
    expected: 'absent' as const,
    ...(url ? { judgedPageUrl: url } : {}),
  });

  it('keeps a label whose judged page the recapture froze with the same text and status', () => {
    const result = carryUnchangedGoldLabels(
      [label(judged)],
      [page(judged, '<p>same</p>')],
      [page(judged, '<p>same</p>')],
    );
    expect(result.carried).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it('drops a label whose judged page changed, changed status, or was not frozen again', () => {
    const before = [page(judged, '<p>same</p>'), page(other, '<p>b</p>')];
    expect(
      carryUnchangedGoldLabels([label(judged)], before, [page(judged, '<p>new</p>')]).carried,
    ).toHaveLength(0);
    expect(
      carryUnchangedGoldLabels([label(judged)], before, [page(judged, '<p>same</p>', 404)]).carried,
    ).toHaveLength(0);
    expect(
      carryUnchangedGoldLabels([label(judged)], before, [page(other, '<p>b</p>')]).carried,
    ).toHaveLength(0);
  });

  it('drops a label that names no judged page, and never reads a page from another namespace', () => {
    const modelAnswer = { ...page(judged, '<p>same</p>'), sourceName: 'model-chat-completion' };
    expect(
      carryUnchangedGoldLabels([label(undefined)], [page(judged, 'x')], [page(judged, 'x')]),
    ).toEqual({ carried: [], dropped: 1 });
    expect(carryUnchangedGoldLabels([label(judged)], [modelAnswer], [modelAnswer]).dropped).toBe(1);
  });

  it('refuses a gold recapture that keeps no label unless the operator drops gold explicitly', () => {
    const gold = { benchmarkId: 'example-old', goldLabels: [label(judged)] };
    expect(goldCarryRefusal(gold, 0, false)).toMatch(/--without-gold/);
    expect(goldCarryRefusal(gold, 0, true)).toBeUndefined();
    expect(goldCarryRefusal(gold, 1, false)).toBeUndefined();
    expect(
      goldCarryRefusal({ benchmarkId: 'example-old', goldLabels: [] }, 0, false),
    ).toBeUndefined();
  });
});

describe('emptyCaptureRefusal', () => {
  it('refuses a capture whose only frozen rows are host refusals', () => {
    beginBenchmarkCapture();
    freezeHostRefusal('lab.example.org', 'private');
    const pages = finishBenchmarkCapture();
    expect(pages).toHaveLength(1);
    expect(emptyCaptureRefusal(pages)).toMatch(/refusing to store an empty benchmark/);
  });

  it('stores a capture that froze a page alongside a host refusal', () => {
    beginBenchmarkCapture();
    freezeHostRefusal('lab.example.org', 'private');
    benchmarkCacheWrite('lane', 'page:1', { html: '<p>ok</p>' });
    expect(emptyCaptureRefusal(finishBenchmarkCapture())).toBeUndefined();
  });
});

describe('emptySuccessorRefusal', () => {
  it('refuses a recapture that plans nothing where the old capture planned values', () => {
    expect(emptySuccessorRefusal('example-old', 2, 0)).toMatch(/would measure nothing/);
  });

  it('allows a recapture that plans values, or one replacing a benchmark that planned none', () => {
    expect(emptySuccessorRefusal('example-old', 2, 1)).toBeUndefined();
    expect(emptySuccessorRefusal('example-old', 0, 0)).toBeUndefined();
  });
});
