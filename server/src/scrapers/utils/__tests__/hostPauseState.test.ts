import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HOST_BACKOFF_BASE_MS,
  HOST_BACKOFF_CAP_MS,
  HOST_BACKOFF_QUIET_RESET_MS,
  hostBackoffState,
  hostPausedUntil,
  recordHostBackoff,
  recordHostSuccess,
  resetHostPauseStateForTests,
  setHostPauseStateForTests,
} from '../hostPauseState';

const START = Date.UTC(2026, 10, 13, 12);
let at: number;
const advance = (ms: number) => {
  at += ms;
};
const pausedForMs = (host: string) => (hostPausedUntil(host)?.getTime() ?? at) - at;

beforeEach(() => {
  at = START;
  setHostPauseStateForTests({ now: () => new Date(at), random: () => 0.5 });
});

afterEach(() => resetHostPauseStateForTests());

describe('the per-host pause record', () => {
  it('doubles the pause from the base on each refusal and caps it at an hour', () => {
    const pauses: number[] = [];
    for (let refusal = 0; refusal < 9; refusal += 1) {
      recordHostBackoff('dept.example.edu', { status: 429 });
      pauses.push(pausedForMs('dept.example.edu'));
      advance(pauses.at(-1) as number);
    }

    expect(pauses.slice(0, 4)).toEqual([
      HOST_BACKOFF_BASE_MS,
      2 * HOST_BACKOFF_BASE_MS,
      4 * HOST_BACKOFF_BASE_MS,
      8 * HOST_BACKOFF_BASE_MS,
    ]);
    expect(Math.max(...pauses)).toBe(HOST_BACKOFF_CAP_MS);
  });

  it('jitters the pause within ten percent', () => {
    setHostPauseStateForTests({ random: () => 1 });
    recordHostBackoff('a.example.edu', { status: 429 });
    setHostPauseStateForTests({ random: () => 0 });
    recordHostBackoff('b.example.edu', { status: 429 });

    expect(pausedForMs('a.example.edu')).toBe(HOST_BACKOFF_BASE_MS * 1.1);
    expect(pausedForMs('b.example.edu')).toBe(HOST_BACKOFF_BASE_MS * 0.9);
  });

  it('runs at least as long as a Retry-After, and to a stated date even past the cap', () => {
    recordHostBackoff('dept.example.edu', { status: 503, retryAfterMs: 10 * 60_000 });
    expect(pausedForMs('dept.example.edu')).toBe(10 * 60_000);

    const stated = new Date(START + 7 * 24 * 60 * 60_000);
    recordHostBackoff('other.example.edu', { status: 403, statedUntil: stated });
    expect(hostPausedUntil('other.example.edu')).toEqual(stated);
  });

  it('never shortens a pause', () => {
    const stated = new Date(START + 7 * 24 * 60 * 60_000);
    recordHostBackoff('dept.example.edu', { status: 403, statedUntil: stated });
    recordHostBackoff('dept.example.edu', { status: 429 });

    expect(hostPausedUntil('dept.example.edu')).toEqual(stated);
  });

  it('keeps a pause through a success, and starts the doubling again ten clean minutes after it ends', () => {
    recordHostBackoff('dept.example.edu', { status: 429 });
    recordHostSuccess('dept.example.edu');
    expect(hostPausedUntil('dept.example.edu')).toBeDefined();

    advance(pausedForMs('dept.example.edu') + HOST_BACKOFF_QUIET_RESET_MS - 1);
    recordHostSuccess('dept.example.edu');
    expect(hostBackoffState('dept.example.edu')).toBeDefined();

    advance(1);
    recordHostSuccess('dept.example.edu');
    expect(hostBackoffState('dept.example.edu')).toBeUndefined();

    recordHostBackoff('dept.example.edu', { status: 429 });
    expect(hostBackoffState('dept.example.edu')?.level).toBe(0);
  });

  it('keys hosts the way the excluded-host rule does', () => {
    recordHostBackoff('WWW.Dept.Example.edu.', { status: 429 });

    expect(hostPausedUntil('dept.example.edu')).toBeDefined();
  });
});
