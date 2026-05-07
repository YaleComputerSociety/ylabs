import { describe, expect, it } from 'vitest';
import {
  buildFetchAttemptMetrics,
  fetchAttemptsToMetrics,
  measureRenderedFetch,
} from '../renderedFetch';

describe('measureRenderedFetch', () => {
  it('records successful rendered fetch attempts', async () => {
    const measured = await measureRenderedFetch(
      'browser',
      async () => ({ html: '<main>ok</main>' }),
    );

    expect(measured.result).toEqual({ html: '<main>ok</main>' });
    expect(measured.metrics).toMatchObject({
      success: true,
      fetchMode: 'browser',
      blocked: false,
      selectorBreakage: false,
    });
    expect(measured.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof measured.metrics.memoryDeltaBytes).toBe('number');
  });

  it('lets callers classify blocking and selector breakage without renderer coupling', async () => {
    const blocked = await measureRenderedFetch(
      'pilot-renderer',
      async () => ({ status: 403, html: '' }),
      (result) => ({
        blocked: result.status === 403,
        blockedReason: result.status === 403 ? 'http-403' : undefined,
      }),
    );

    expect(blocked.metrics).toMatchObject({
      success: false,
      fetchMode: 'pilot-renderer',
      blocked: true,
      blockedReason: 'http-403',
      selectorBreakage: false,
    });

    const brokenSelector = await measureRenderedFetch(
      'pilot-renderer',
      async () => ({ html: '<main></main>', matched: 0 }),
      (result) => ({ selectorBreakage: result.matched === 0 }),
    );

    expect(brokenSelector.metrics).toMatchObject({
      success: false,
      blocked: false,
      selectorBreakage: true,
    });
  });
});

describe('buildFetchAttemptMetrics', () => {
  it('builds the common metrics shape and compatibility wrappers', () => {
    const attempt = buildFetchAttemptMetrics({
      fetchMode: 'rendered',
      success: true,
      startedAt: performance.now() - 10,
      memoryStartBytes: process.memoryUsage().rss,
    });

    expect(attempt).toMatchObject({
      success: true,
      fetchMode: 'rendered',
      blocked: false,
      selectorBreakage: false,
    });
    expect(attempt.latencyMs).toBeGreaterThanOrEqual(0);

    expect(fetchAttemptsToMetrics([attempt])).toMatchObject({
      fetchAttempts: [attempt],
      attempts: [attempt],
      summary: {
        total: 1,
        succeeded: 1,
        failed: 0,
        blocked: 0,
        selectorBreakages: 0,
      },
    });
  });
});
