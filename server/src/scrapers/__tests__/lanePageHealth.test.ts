import { describe, expect, it, vi } from 'vitest';
import {
  LANE_PAGE_HEALTH_FIELD,
  confirmGoneLanePage,
  fetchFailureHttpStatus,
  lanePageReadVerdict,
  planGoneLanePageFieldClears,
  withoutGoneLanePageObservations,
} from '../lanePageHealth';
import { HttpStatusError } from '../utils/httpFetch';

const LANE = 'lab-microsite-description-llm';
const RIVAL = 'official-profile-enrichment';
const PAGE = 'https://synthetic-lab.example.edu/research/';
const ROW = new Set(['row-1', 'synthetic-lab']);

const at = (day: number) => new Date(Date.UTC(2026, 8, day));

const read = (field: string, value: unknown, day: number, sourceName = LANE) => ({
  sourceName,
  entityKey: 'synthetic-lab',
  field,
  value,
  sourceUrl: PAGE,
  observedAt: at(day),
});

const verdict = (healthStatus: string, httpStatusCode: number | undefined, day: number) => ({
  sourceName: LANE,
  entityKey: 'synthetic-lab',
  field: LANE_PAGE_HEALTH_FIELD,
  value: { url: PAGE, healthStatus, ...(httpStatusCode ? { httpStatusCode } : {}) },
  sourceUrl: PAGE,
  observedAt: at(day),
});

describe('withoutGoneLanePageObservations', () => {
  it('withdraws the lane own earlier reads of a page whose newest verdict is gone', () => {
    const result = withoutGoneLanePageObservations(
      [read('fullDescription', 'Studies synthetic signaling.', 1), verdict('UNAVAILABLE', 404, 5)],
      ROW,
    );
    expect(result.observations).toEqual([]);
    expect(result.withdrawnValuesByField.get('fullDescription')).toEqual([
      'Studies synthetic signaling.',
    ]);
  });

  it('keeps a rival lane value cited to the same page', () => {
    const rival = read('fullDescription', 'A rival reading.', 1, RIVAL);
    const result = withoutGoneLanePageObservations(
      [
        read('fullDescription', 'Studies synthetic signaling.', 1),
        rival,
        verdict('UNAVAILABLE', 410, 5),
      ],
      ROW,
    );
    expect(result.observations).toEqual([rival]);
  });

  it('withdraws nothing on an UNAVAILABLE verdict that carries no status code', () => {
    const observation = read('fullDescription', 'Studies synthetic signaling.', 1);
    const result = withoutGoneLanePageObservations(
      [observation, verdict('UNAVAILABLE', undefined, 5)],
      ROW,
    );
    expect(result.observations).toEqual([observation]);
    expect(result.withdrawnValuesByField.size).toBe(0);
  });

  it('withdraws nothing on an UNKNOWN verdict', () => {
    const observation = read('fullDescription', 'Studies synthetic signaling.', 1);
    const result = withoutGoneLanePageObservations([observation, verdict('UNKNOWN', 403, 5)], ROW);
    expect(result.observations).toEqual([observation]);
  });

  it('restores the values once a later read finds the page again', () => {
    const observation = read('fullDescription', 'Studies synthetic signaling.', 1);
    const result = withoutGoneLanePageObservations(
      [observation, verdict('UNAVAILABLE', 404, 5), verdict('HEALTHY', 200, 9)],
      ROW,
    );
    expect(result.observations).toEqual([observation]);
  });

  it('keeps a newer read from the page and still withdraws the older one', () => {
    const older = read('fullDescription', 'Studies synthetic signaling.', 1);
    const newer = read('shortDescription', 'Synthetic signaling.', 9);
    const result = withoutGoneLanePageObservations(
      [older, verdict('UNAVAILABLE', 404, 5), newer],
      ROW,
    );
    expect(result.observations).toEqual([newer]);
  });
});

describe('confirmGoneLanePage', () => {
  it('records a gone verdict only when a second read agrees the page is gone', async () => {
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 });
    await expect(confirmGoneLanePage(PAGE, { httpStatusCode: 404 }, probe)).resolves.toEqual({
      url: PAGE,
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    });
  });

  it('records nothing when the confirming read is inconclusive', async () => {
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNKNOWN', httpStatusCode: 403 });
    await expect(confirmGoneLanePage(PAGE, { httpStatusCode: 404 }, probe)).resolves.toBeNull();
  });

  it('never probes and records nothing after a 403, a 5xx or a timeout', async () => {
    const probe = vi.fn();
    for (const httpStatusCode of [403, 429, 503, undefined]) {
      await expect(confirmGoneLanePage(PAGE, { httpStatusCode }, probe)).resolves.toBeNull();
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it('confirms a stored gone verdict with a fresh read', async () => {
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNAVAILABLE', httpStatusCode: 410 });
    const storedHealth = [{ url: PAGE, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }];
    await expect(confirmGoneLanePage(PAGE, { storedHealth }, probe)).resolves.toMatchObject({
      httpStatusCode: 410,
    });
  });

  it('does not treat a stored DNS or private-address verdict as gone', async () => {
    const probe = vi.fn();
    const storedHealth = [{ url: PAGE, healthStatus: 'UNAVAILABLE' }];
    await expect(confirmGoneLanePage(PAGE, { storedHealth }, probe)).resolves.toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('reads the status from either failure shape', () => {
    expect(fetchFailureHttpStatus(new HttpStatusError(404))).toBe(404);
    expect(fetchFailureHttpStatus({ response: { status: 410 } })).toBe(410);
    expect(fetchFailureHttpStatus({ code: 'ECONNABORTED' })).toBeUndefined();
  });

  it('marks a successful read healthy', () => {
    expect(lanePageReadVerdict(PAGE)).toEqual({
      url: PAGE,
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
    });
  });
});

describe('planGoneLanePageFieldClears', () => {
  const withdrawn = new Map([['fullDescription', ['Studies synthetic signaling.']]]);
  const base = {
    stored: { fullDescription: 'Studies synthetic signaling.' } as Record<string, unknown>,
    staged: {} as Record<string, unknown>,
    fieldsWithLiveObservation: new Set<string>(),
    withdrawnValuesByField: withdrawn,
    lockedFields: [] as string[],
    storedForm: (_field: string, value: unknown) => value,
  };

  it('clears a stored value only the gone page backed', () => {
    expect(planGoneLanePageFieldClears(base)).toEqual(['fullDescription']);
  });

  it('keeps a value another observation still backs, a locked value, or a different value', () => {
    expect(
      planGoneLanePageFieldClears({
        ...base,
        fieldsWithLiveObservation: new Set(['fullDescription']),
      }),
    ).toEqual([]);
    expect(planGoneLanePageFieldClears({ ...base, lockedFields: ['fullDescription'] })).toEqual([]);
    expect(
      planGoneLanePageFieldClears({ ...base, stored: { fullDescription: 'Another reading.' } }),
    ).toEqual([]);
  });

  it('matches the withdrawn read in the form the row stores it', () => {
    expect(
      planGoneLanePageFieldClears({
        ...base,
        stored: { fullDescription: 'Studies synthetic signaling. [contact removed]' },
        withdrawnValuesByField: new Map([
          ['fullDescription', ['Studies synthetic signaling. lab@synthetic.example.edu']],
        ]),
        storedForm: (_field, value) =>
          String(value).replace('lab@synthetic.example.edu', '[contact removed]'),
      }),
    ).toEqual(['fullDescription']);
  });

  it('clears the card derived from a cleared body, stored or freshly staged', () => {
    expect(
      planGoneLanePageFieldClears({
        ...base,
        stored: { ...base.stored, shortDescription: 'A card the materializer wrote.' },
      }),
    ).toEqual(['fullDescription', 'shortDescription']);
    expect(
      planGoneLanePageFieldClears({
        ...base,
        staged: { shortDescription: 'A card derived from the gone body.' },
      }),
    ).toEqual(['fullDescription', 'shortDescription']);
  });

  it('keeps a card that a live observation or a lock still backs', () => {
    const stored = { ...base.stored, shortDescription: 'A card another lane read.' };
    expect(
      planGoneLanePageFieldClears({
        ...base,
        stored,
        fieldsWithLiveObservation: new Set(['shortDescription']),
      }),
    ).toEqual(['fullDescription']);
    expect(
      planGoneLanePageFieldClears({ ...base, stored, lockedFields: ['shortDescription'] }),
    ).toEqual(['fullDescription']);
  });
});
