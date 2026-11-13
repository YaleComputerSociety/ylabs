import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: { request: (...args: unknown[]) => requestMock(...args) },
}));

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: async (url: string) => new URL(url),
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

import { probeSourceLink } from '../sourceLinkHealth';
import { EXCLUDED_HOST_ERROR_CODE } from '../../utils/excludedHosts';
import {
  hostPausedUntil,
  recordHostBackoff,
  resetHostPauseStateForTests,
} from '../../scrapers/utils/hostPauseState';
import { HostPausedError } from '../../scrapers/utils/hostPause';

const NOTICE = '203.0.113.7 has been banned up to Fri, 20 Nov 2099 07:32:40 +0000';
const FUTURE = new Date('2099-11-20T07:32:40Z');

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => resetHostPauseStateForTests());

describe('probeSourceLink and a host that refuses', () => {
  it('reads a stated date on the refused GET, pauses the host, and reports the link unobserved', async () => {
    requestMock.mockImplementation(async ({ method }: { method: string }) => ({
      status: 403,
      headers: {},
      data: method === 'GET' ? Readable.from([Buffer.from(NOTICE)]) : undefined,
    }));

    const probe = await probeSourceLink('https://dept.example.edu/people/a');

    expect(probe).toMatchObject({ excludedHost: true, errorCode: EXCLUDED_HOST_ERROR_CODE });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ method: 'GET' });
    expect(hostPausedUntil('dept.example.edu')).toEqual(FUTURE);
  });

  it('sends a paused host no request and reports the link unobserved', async () => {
    await recordHostBackoff('dept.example.edu', { status: 403, statedUntil: FUTURE });

    const probe = await probeSourceLink('https://www.dept.example.edu/people/b');

    expect(probe).toEqual({
      errorCode: EXCLUDED_HOST_ERROR_CODE,
      requestedUrl: 'https://www.dept.example.edu/people/b',
      excludedHost: true,
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports the link unobserved when a pause lands between its check and its slot', async () => {
    const pausedGate = {
      acquire: async (host: string) => {
        throw new HostPausedError({ host, until: FUTURE });
      },
    };

    const probe = await probeSourceLink('https://dept.example.edu/people/c', pausedGate);

    expect(probe).toEqual({
      errorCode: EXCLUDED_HOST_ERROR_CODE,
      requestedUrl: 'https://dept.example.edu/people/c',
      excludedHost: true,
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a redirect into a paused host', async () => {
    await recordHostBackoff('dept.example.edu', { status: 403, statedUntil: FUTURE });
    requestMock.mockImplementation(
      async (config: { beforeRedirect?: (options: unknown, details: unknown) => void }) => {
        config.beforeRedirect?.({ hostname: 'dept.example.edu' }, { statusCode: 301 });
        return { status: 200, headers: {} };
      },
    );

    const probe = await probeSourceLink('https://vanity.example.org/lab');

    expect(probe).toMatchObject({ excludedHost: true });
  });
});
