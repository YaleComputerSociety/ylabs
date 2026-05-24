import { describe, expect, it, vi } from 'vitest';
import { logError, logInfo } from '../logger';

describe('logger', () => {
  it('emits structured info logs with stable fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logInfo('beta gate checked', {
      requestId: 'req-1',
      route: '/api/config',
      userId: 'fixture-user-1',
      metadata: { gate: 'researchSemanticSearch' },
    });

    expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({
      level: 'info',
      message: 'beta gate checked',
      requestId: 'req-1',
      route: '/api/config',
      userId: 'fixture-user-1',
      gate: 'researchSemanticSearch',
    });

    spy.mockRestore();
  });

  it('emits structured error logs without exposing stack traces in metadata', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logError('request failed', new Error('boom'), {
      requestId: 'req-2',
      route: '/api/research',
      metadata: { stack: 'metadata stack should not win' },
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      level: 'error',
      message: 'request failed',
      errorMessage: 'boom',
      requestId: 'req-2',
      route: '/api/research',
    });
    expect(payload.stack).toContain('Error: boom');

    spy.mockRestore();
  });
});
