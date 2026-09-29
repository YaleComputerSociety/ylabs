import { describe, expect, it } from 'vitest';

import {
  LOCAL_MAX_WORKERS,
  MAX_WORKERS_OVERRIDE_KEY,
  vitestMaxWorkers,
} from '../localWorkerBudget';
import vitestConfig from '../../../vitest.config';

describe('vitest worker budget', () => {
  it('caps a local run so several concurrent runs do not oversubscribe the machine', () => {
    expect(vitestMaxWorkers({}, 14)).toBe(LOCAL_MAX_WORKERS);
  });

  it('never asks for more workers than the machine has spare cores', () => {
    expect(vitestMaxWorkers({}, 3)).toBe(2);
    expect(vitestMaxWorkers({}, 1)).toBe(1);
  });

  it('leaves CI on the vitest default so CI timing is unchanged', () => {
    expect(vitestMaxWorkers({ CI: 'true' }, 4)).toBeUndefined();
  });

  it('honours an explicit override locally and in CI', () => {
    expect(vitestMaxWorkers({ [MAX_WORKERS_OVERRIDE_KEY]: '10' }, 14)).toBe(10);
    expect(vitestMaxWorkers({ CI: 'true', [MAX_WORKERS_OVERRIDE_KEY]: '2' }, 4)).toBe(2);
  });

  it('refuses an override that is not a positive integer', () => {
    for (const raw of ['0', '-1', '2.5', 'many']) {
      expect(() => vitestMaxWorkers({ [MAX_WORKERS_OVERRIDE_KEY]: raw }, 14)).toThrow(
        MAX_WORKERS_OVERRIDE_KEY,
      );
    }
  });

  it('is the worker count the server config actually uses', () => {
    expect(vitestConfig.test?.maxWorkers).toBe(vitestMaxWorkers());
  });
});
