import { describe, expect, it } from 'vitest';
import {
  planDeadCitationRetirement,
  summarizeDeadCitationRefusals,
  type DeadCitationCandidate,
} from '../retireDeadCitationResearchEntitiesCore';

const NOW = new Date('2026-09-20T00:00:00.000Z');
const FRESH = new Date('2026-09-15T00:00:00.000Z').toISOString();
const ANCIENT = new Date('2026-01-01T00:00:00.000Z').toISOString();

const DEAD_URL = 'https://example.yale.edu/lab/sample/';
const OTHER_DEAD_URL = 'https://example.yale.edu/lab/sample-two/';

const health = (
  entries: Array<{ url: string; status?: string; code?: number; checkedAt?: string }>,
) =>
  entries.map((entry) => ({
    url: entry.url,
    healthStatus: entry.status ?? 'UNAVAILABLE',
    httpStatusCode: entry.code ?? 404,
    checkedAt: entry.checkedAt ?? FRESH,
  }));

const candidate = (over: Partial<DeadCitationCandidate> = {}): DeadCitationCandidate => ({
  id: '000000000000000000000001',
  tier: 'operator_review',
  archived: false,
  citations: [DEAD_URL],
  websiteUrl: null,
  sourceLinkHealth: health([{ url: DEAD_URL }]),
  ...over,
});

describe('planDeadCitationRetirement', () => {
  it('archives a row whose only citation carries a fresh gone verdict', () => {
    const plan = planDeadCitationRetirement([candidate()], NOW);
    expect(plan.toArchive).toEqual([
      { id: '000000000000000000000001', citationCount: 1, hadWebsiteUrl: false },
    ]);
    expect(plan.refused).toEqual([]);
  });

  it('refuses when one of two citations is still reachable', () => {
    const plan = planDeadCitationRetirement(
      [
        candidate({
          citations: [DEAD_URL, OTHER_DEAD_URL],
          sourceLinkHealth: health([
            { url: DEAD_URL },
            { url: OTHER_DEAD_URL, status: 'HEALTHY', code: 200 },
          ]),
        }),
      ],
      NOW,
    );
    expect(plan.toArchive).toEqual([]);
    expect(plan.refused[0].reason).toBe('live-citation');
  });

  it('refuses an unprobed citation, because silence is not death', () => {
    const plan = planDeadCitationRetirement(
      [candidate({ citations: [DEAD_URL, OTHER_DEAD_URL] })],
      NOW,
    );
    expect(plan.refused[0].reason).toBe('live-citation');
  });

  it('refuses a stale gone verdict rather than acting on a months-old probe', () => {
    const plan = planDeadCitationRetirement(
      [candidate({ sourceLinkHealth: health([{ url: DEAD_URL, checkedAt: ANCIENT }]) })],
      NOW,
    );
    expect(plan.toArchive).toEqual([]);
    expect(plan.refused[0].reason).toBe('stale-verdict');
  });

  it('refuses a verdict with no checkedAt, which cannot be dated', () => {
    const plan = planDeadCitationRetirement(
      [
        candidate({
          sourceLinkHealth: [{ url: DEAD_URL, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }],
        }),
      ],
      NOW,
    );
    expect(plan.refused[0].reason).toBe('stale-verdict');
  });

  it('refuses when the row has no citation at all, the projection gap', () => {
    const plan = planDeadCitationRetirement([candidate({ citations: [] })], NOW);
    expect(plan.refused[0].reason).toBe('no-citation-at-all');
  });

  it('refuses when the websiteUrl has no gone verdict, because that is a live way in', () => {
    const plan = planDeadCitationRetirement(
      [candidate({ websiteUrl: 'https://example.yale.edu/lab/sample-site/' })],
      NOW,
    );
    expect(plan.toArchive).toEqual([]);
    expect(plan.refused[0].reason).toBe('website-url-not-dead');
  });

  it('archives when the websiteUrl is itself proven gone', () => {
    const websiteUrl = 'https://example.yale.edu/lab/sample-site/';
    const plan = planDeadCitationRetirement(
      [
        candidate({
          websiteUrl,
          sourceLinkHealth: health([{ url: DEAD_URL }, { url: websiteUrl }]),
        }),
      ],
      NOW,
    );
    expect(plan.toArchive[0].hadWebsiteUrl).toBe(true);
  });

  it('never archives a row in a public tier', () => {
    const plan = planDeadCitationRetirement([candidate({ tier: 'student_ready' })], NOW);
    expect(plan.toArchive).toEqual([]);
    expect(plan.refused[0].reason).toBe('public-tier');
  });

  it('archives a limited_but_safe row, which is not a public tier', () => {
    const plan = planDeadCitationRetirement([candidate({ tier: 'limited_but_safe' })], NOW);
    expect(plan.toArchive).toHaveLength(1);
  });

  it('skips a row already archived', () => {
    const plan = planDeadCitationRetirement([candidate({ archived: true })], NOW);
    expect(plan.refused[0].reason).toBe('already-archived');
  });

  it('matches a verdict stored under a cosmetically different spelling of the url', () => {
    const plan = planDeadCitationRetirement(
      [
        candidate({
          citations: ['http://www.example.yale.edu/lab/sample'],
          sourceLinkHealth: health([{ url: DEAD_URL }]),
        }),
      ],
      NOW,
    );
    expect(plan.toArchive).toHaveLength(1);
  });

  it('counts every candidate it scanned', () => {
    const plan = planDeadCitationRetirement(
      [candidate(), candidate({ id: '000000000000000000000002', archived: true })],
      NOW,
    );
    expect(plan.scanned).toBe(2);
  });
});

describe('summarizeDeadCitationRefusals', () => {
  it('reports every reason including zeros', () => {
    const counts = summarizeDeadCitationRefusals([
      { id: 'a', reason: 'stale-verdict' },
      { id: 'b', reason: 'stale-verdict' },
    ]);
    expect(counts['stale-verdict']).toBe(2);
    expect(counts['public-tier']).toBe(0);
  });
});
