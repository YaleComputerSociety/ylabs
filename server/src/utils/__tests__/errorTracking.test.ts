import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeErrorTracking } from '../errorTracking';
import * as Sentry from '@sentry/node';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

describe('server errorTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not initialize without a DSN', () => {
    expect(initializeErrorTracking({ environment: 'test' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('passes configurable environment and release tags to Sentry', () => {
    expect(
      initializeErrorTracking({
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'abc123',
      }),
    ).toBe(true);

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'abc123',
    });
  });
});
