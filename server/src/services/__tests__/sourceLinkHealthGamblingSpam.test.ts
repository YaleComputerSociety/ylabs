import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: { request: (...args: unknown[]) => requestMock(...args) },
}));

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: async (url: string) => new URL(url),
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

import {
  classifySourceLinkHealth,
  isKnownDeadSourceUrl,
  probeSourceLink,
} from '../sourceLinkHealth';

const GAMBLING_PAGE_HTML =
  '<html><head><title>CONTOH88 | Situs Resmi Slot Gacor</title><script>var slot = 1;</script></head>' +
  '<body><h1>Link alternatif resmi</h1><p>Minimal Deposit Rp 20.000, layanan 24 jam ya bosku.</p></body></html>';

const LAB_PAGE_HTML =
  '<html><head><title>Development Lab</title></head><body><p>We study how neurons find their ' +
  'signaling partners. Our work on slot machines and betting behavior is ongoing.</p></body></html>';

const answer = (html: string, contentType = 'text/html; charset=utf-8') => ({
  status: 200,
  headers: { 'content-type': contentType },
  data: Readable.from([Buffer.from(html)]),
});

beforeEach(() => requestMock.mockReset());

describe('a cited domain that now serves a gambling page (#6532)', () => {
  it('reports the 200 answer as not the cited resource', async () => {
    requestMock.mockResolvedValue(answer(GAMBLING_PAGE_HTML));

    const probe = await probeSourceLink('https://lapsed-lab-site.example/');

    expect(probe).toMatchObject({ status: 200, gamblingSpamPage: true });
    expect(classifySourceLinkHealth(probe)).toMatchObject({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 200,
    });
  });

  it('keeps a research page about gambling healthy', async () => {
    requestMock.mockResolvedValue(answer(LAB_PAGE_HTML));

    const probe = await probeSourceLink('https://lab.example.edu/');

    expect(probe.gamblingSpamPage).toBeUndefined();
    expect(classifySourceLinkHealth(probe).healthStatus).toBe('HEALTHY');
  });

  it('reads no content from a non-HTML answer', async () => {
    requestMock.mockResolvedValue(answer(GAMBLING_PAGE_HTML, 'application/pdf'));

    const probe = await probeSourceLink('https://lab.example.edu/paper.pdf');

    expect(classifySourceLinkHealth(probe).healthStatus).toBe('HEALTHY');
  });

  it('makes the stored citation known dead, so re-admission drops it', () => {
    const url = 'https://lapsed-lab-site.example/';
    const health = classifySourceLinkHealth({
      status: 200,
      requestedUrl: url,
      gamblingSpamPage: true,
    });

    expect(isKnownDeadSourceUrl([{ url, ...health }], url)).toBe(true);
  });
});
