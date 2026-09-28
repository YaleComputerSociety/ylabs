import { describe, expect, it } from 'vitest';
import { parseCaptureArgs } from '../laneBenchmarkCapture';

const base = ['--source=ysm-atoz-index', '--id=example-benchmark', '--limit=5'];

describe('parseCaptureArgs', () => {
  it('passes a source concurrency through to the capture run', () => {
    expect(parseCaptureArgs([...base, '--source-concurrency=1']).sourceConcurrency).toBe(1);
  });

  it('leaves the lane default when no concurrency is given', () => {
    expect(parseCaptureArgs(base).sourceConcurrency).toBeUndefined();
  });

  it('refuses a concurrency that is not a positive integer', () => {
    expect(() => parseCaptureArgs([...base, '--source-concurrency=0'])).toThrow(/positive integer/);
    expect(() => parseCaptureArgs([...base, '--source-concurrency=two'])).toThrow(
      /positive integer/,
    );
  });
});
