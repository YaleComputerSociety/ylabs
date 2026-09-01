import { describe, expect, it, vi } from 'vitest';

import { initializeErrorTracking } from '../errorTracking';
import * as Sentry from '@sentry/react';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

describe('client errorTracking', () => {
  it('does not initialize without a DSN', () => {
    expect(initializeErrorTracking({ environment: 'test' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('passes configurable environment and release tags to Sentry', () => {
    expect(
      initializeErrorTracking({
        dsn: 'https://public@example.com/1',
        environment: 'staging',
        release: 'abc123',
      }),
    ).toBe(true);

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: 'staging',
      release: 'abc123',
    });
  });
});
