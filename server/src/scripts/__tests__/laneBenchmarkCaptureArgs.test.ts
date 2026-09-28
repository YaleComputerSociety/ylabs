import { describe, expect, it } from 'vitest';
import { parseCaptureArgs } from '../laneBenchmarkCapture';

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
