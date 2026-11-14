import { afterEach, describe, expect, it } from 'vitest';

import {
  HostPausedError,
  activeHostPause,
  describeHostPauses,
  hostPauseInErrorChain,
  recordHostRefusal,
  recordTierOneExhausted,
  refuseRedirectIntoPausedHost,
  statedPauseUntil,
} from '../hostPause';
import { hostPausedUntil, recordHostBackoff, resetHostPauseStateForTests } from '../hostPauseState';

const NOW = new Date('2026-11-13T12:00:00Z');
const notice = (until: string) => `203.0.113.7 has been banned up to ${until}`;
const FUTURE = new Date('2099-01-01T00:00:00Z');

afterEach(() => resetHostPauseStateForTests());

describe('statedPauseUntil', () => {
  it.each([
    ['a written date with a zone', notice('Fri, 20 Nov 2026 07:32:40 +0000')],
    ['a trailing period', notice('2026-11-20T07:32:40Z.')],
    ['a trailing parenthetical', notice('2026-11-20T07:32:40Z (UTC)')],
    ['a following sentence', `${notice('20 Nov 2026 07:32:40')}. Contact the site administrator.`],
    ['an HTML page', `<p>${notice('Fri, 20 Nov 2026 07:32:40 +0000')}</p>`],
    ['blocked-until wording', '203.0.113.7 is blocked until 2026-11-20T07:32:40Z'],
  ])('reads the date through %s', (_label, body) => {
    expect(statedPauseUntil(body, NOW)).toEqual(new Date('2026-11-20T07:32:40Z'));
  });

  it.each([
    ['an ISO date and time', '2026-11-20 07:32:40'],
    ['a written date and time', 'Fri, 20 Nov 2026 07:32:40'],
  ])('reads %s with no zone as UTC, never local time', (_label, until) => {
    expect(statedPauseUntil(notice(until), NOW)).toEqual(new Date('2026-11-20T07:32:40Z'));
  });

  it('pauses for a day when a notice gives no readable date, rather than retrying at once', () => {
    expect(statedPauseUntil('203.0.113.7 has been banned until further notice', NOW)).toEqual(
      new Date('2026-11-14T12:00:00Z'),
    );
  });

  it.each([
    ['a plain refusal', 'Forbidden'],
    ['a date already past', notice('Fri, 06 Nov 2026 07:32:40 +0000')],
  ])('states nothing for %s', (_label, body) => {
    expect(statedPauseUntil(body, NOW)).toBeUndefined();
  });
});

describe('recordHostRefusal', () => {
  it('pauses a host at once for a stated date, or a 429 or 503 when no quick retries apply', async () => {
    expect(
      await recordHostRefusal({
        host: 'a.example.edu',
        status: 403,
        body: notice('Fri, 20 Nov 2099 07:32:40 +0000'),
      }),
    ).toEqual({ host: 'a.example.edu', until: new Date('2099-11-20T07:32:40Z') });
    expect(await recordHostRefusal({ host: 'b.example.edu', status: 429 })).toMatchObject({
      host: 'b.example.edu',
    });
    expect(
      await recordHostRefusal({
        host: 'c.example.edu',
        status: 503,
        headers: { 'retry-after': '1200' },
      }),
    ).toMatchObject({ host: 'c.example.edu' });
    expect((hostPausedUntil('c.example.edu')?.getTime() ?? 0) - Date.now()).toBeGreaterThan(
      19 * 60_000,
    );
  });

  it('leaves a short 429 to the request quick retries, and pauses for one that outlasts them', async () => {
    expect(
      await recordHostRefusal({
        host: 'a.example.edu',
        status: 429,
        retryAfterMs: 2_000,
        quickRetryWaitMs: 8_000,
      }),
    ).toBeUndefined();
    expect(
      await recordHostRefusal({
        host: 'b.example.edu',
        status: 429,
        retryAfterMs: 60_000,
        quickRetryWaitMs: 8_000,
      }),
    ).toMatchObject({ host: 'b.example.edu' });
  });

  it('leaves a plain 403 to the request quick retries', async () => {
    expect(
      await recordHostRefusal({ host: 'dept.example.edu', status: 403, body: 'Forbidden' }),
    ).toBeUndefined();
    expect(hostPausedUntil('dept.example.edu')).toBeUndefined();

    await recordTierOneExhausted('dept.example.edu', 403);
    expect(hostPausedUntil('dept.example.edu')).toBeDefined();
  });
});

describe('activeHostPause', () => {
  it('covers its own www and trailing-dot spellings, never a parent, subdomain or sibling', async () => {
    await recordHostBackoff('dept.example.edu', { status: 403, statedUntil: FUTURE });

    expect(activeHostPause('www.dept.example.edu')).toEqual({
      host: 'dept.example.edu',
      until: FUTURE,
    });
    expect(activeHostPause('dept.example.edu.')).toBeDefined();
    expect(activeHostPause('lab.dept.example.edu')).toBeUndefined();
    expect(activeHostPause('example.edu')).toBeUndefined();
    expect(activeHostPause('other.example.edu')).toBeUndefined();
  });

  it('never lets one throttled www host pause the schools under the same domain', async () => {
    await recordTierOneExhausted('www.yale.edu', 429);

    expect(activeHostPause('www.yale.edu')).toBeDefined();
    for (const school of [
      'medicine.yale.edu',
      'ysph.yale.edu',
      'cs.yale.edu',
      'lab.medicine.yale.edu',
    ]) {
      expect(activeHostPause(school)).toBeUndefined();
    }
  });

  it('covers a single-label host such as localhost', async () => {
    await recordHostBackoff('localhost', { status: 429 });

    expect(activeHostPause('localhost')).toMatchObject({ host: 'localhost' });
  });
});

describe('a redirect into a paused host', () => {
  it('is refused by the redirect hook before the hop is sent, after any earlier hook', async () => {
    await recordHostBackoff('dept.example.edu', { status: 403, statedUntil: FUTURE });
    const earlier: string[] = [];
    const hook = refuseRedirectIntoPausedHost((options) => {
      earlier.push(String(options.hostname));
    });

    expect(() => hook({ hostname: 'www.dept.example.edu' }, {})).toThrow(HostPausedError);
    expect(earlier).toEqual([]);
    hook({ hostname: 'open.example.edu' }, {});
    expect(earlier).toEqual(['open.example.edu']);
  });

  it('is found inside the double wrap axios gives a redirect hook error', () => {
    const paused = new HostPausedError({ host: 'dept.example.edu', until: FUTURE });
    const wrapped = Object.assign(new Error('Redirected request failed'), {
      cause: Object.assign(new Error('Redirected request failed'), { cause: paused }),
    });

    expect(hostPauseInErrorChain(wrapped)).toBe(paused);
    expect(hostPauseInErrorChain(new Error('unrelated'))).toBeUndefined();
  });
});

describe('describeHostPauses', () => {
  it('names each host once with its latest resume time', () => {
    expect(
      describeHostPauses([
        { host: 'b.example.edu', until: new Date('2026-11-13T13:00:00Z') },
        { host: 'a.example.edu', until: new Date('2026-11-13T12:30:00Z') },
        { host: 'b.example.edu', until: new Date('2026-11-13T14:00:00Z') },
      ]),
    ).toBe(
      'a.example.edu resumes at 2026-11-13T12:30:00.000Z, b.example.edu resumes at 2026-11-13T14:00:00.000Z',
    );
  });
});
