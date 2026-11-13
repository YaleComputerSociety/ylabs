import { afterEach, describe, expect, it, vi } from 'vitest';

const pauses = new Map<string, Date>();

vi.mock('../hostPauseState', () => ({
  hostPausedUntil: (host: string) => pauses.get(host),
  recordHostBackoff: async (host: string, signal: { statedUntil?: Date }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const until = signal.statedUntil ?? new Date(Date.now() + 30_000);
    pauses.set(host, until);
    return until;
  },
}));

import { recordHostRefusal, recordTierOneExhausted } from '../hostPause';

afterEach(() => pauses.clear());

describe('recording a pause through a store that takes a file lock', () => {
  it('returns the pause a refusal recorded, not the state before the lock was taken', async () => {
    const pause = await recordHostRefusal({ host: 'dept.example.edu', status: 429 });

    expect(pause?.until).toBeInstanceOf(Date);
    expect(pause).toEqual({ host: 'dept.example.edu', until: pauses.get('dept.example.edu') });
  });

  it('settles a tier-one exhaustion only once the pause is recorded', async () => {
    await recordTierOneExhausted('www.dept.example.edu', 403);

    expect(pauses.get('dept.example.edu')).toBeInstanceOf(Date);
  });
});
