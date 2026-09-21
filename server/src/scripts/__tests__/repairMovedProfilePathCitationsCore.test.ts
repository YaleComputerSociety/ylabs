import { describe, expect, it } from 'vitest';
import {
  movedProfilePathCandidate,
  planMovedProfilePathRepair,
  summarizeSkips,
  type ExistingAtCandidate,
  type ProbeVerdict,
  type StaleCitationObservation,
} from '../repairMovedProfilePathCitationsCore';

const OLD = 'https://example.yale.edu/people/fixture-scholar';
const NEW = 'https://example.yale.edu/profile/fixture-scholar';

const observation = (over: Partial<StaleCitationObservation> = {}): StaleCitationObservation => ({
  id: '000000000000000000000001',
  entityKey: 'dept-example-fixture-scholar',
  entityType: 'user',
  field: 'bio',
  sourceName: 'dept-faculty-roster',
  sourceUrl: OLD,
  superseded: false,
  observationFingerprint: 'fp-stale',
  ...over,
});

const probes = (
  entries: Record<string, number | 'error'> = { [OLD]: 404, [NEW]: 200 },
): Map<string, ProbeVerdict> =>
  new Map(Object.entries(entries).map(([url, status]) => [url, { status }]));

const candidateKeyOf = (obs: StaleCitationObservation, candidate: string) =>
  [obs.entityKey, obs.entityType, obs.field, obs.sourceName, candidate].join('|');

const existing = (
  entries: readonly ExistingAtCandidate[],
  obs = observation(),
): Map<string, readonly ExistingAtCandidate[]> => new Map([[candidateKeyOf(obs, NEW), entries]]);

const plan = (
  over: {
    observations?: StaleCitationObservation[];
    probes?: Map<string, ProbeVerdict>;
    existingByCandidateKey?: Map<string, readonly ExistingAtCandidate[]>;
  } = {},
) =>
  planMovedProfilePathRepair({
    observations: over.observations ?? [observation()],
    probes: over.probes ?? probes(),
    existingByCandidateKey: over.existingByCandidateKey ?? new Map(),
    candidateKeyOf,
  });

describe('movedProfilePathCandidate', () => {
  it('maps a people path to the profile path, preserving host and scheme', () => {
    expect(movedProfilePathCandidate(OLD)).toBe(NEW);
  });

  it('tolerates a trailing slash', () => {
    expect(movedProfilePathCandidate(`${OLD}/`)).toBe(NEW);
  });

  it('offers no candidate for a path that is already a profile', () => {
    expect(movedProfilePathCandidate(NEW)).toBeUndefined();
  });

  it('offers no candidate for a people index rather than a person', () => {
    expect(movedProfilePathCandidate('https://example.yale.edu/people')).toBeUndefined();
  });

  it('offers no candidate for a deeper people path', () => {
    expect(
      movedProfilePathCandidate('https://example.yale.edu/people/faculty/fixture-scholar'),
    ).toBeUndefined();
  });

  it('offers no candidate for an unparseable url', () => {
    expect(movedProfilePathCandidate('not a url')).toBeUndefined();
  });
});

describe('planMovedProfilePathRepair', () => {
  it('rewrites when the old url is gone and the candidate is live', () => {
    const result = plan();
    expect(result.rewrite).toEqual([
      { id: '000000000000000000000001', action: 'rewrite', from: OLD, to: NEW },
    ]);
    expect(result.supersede).toEqual([]);
  });

  it('refuses to rewrite while the old url still answers', () => {
    const result = plan({ probes: probes({ [OLD]: 200, [NEW]: 200 }) });
    expect(result.rewrite).toEqual([]);
    expect(result.skipped[0].reason).toBe('old-url-still-live');
  });

  it('refuses when the candidate is not live', () => {
    const result = plan({ probes: probes({ [OLD]: 404, [NEW]: 404 }) });
    expect(result.skipped[0].reason).toBe('candidate-not-live');
  });

  it('refuses when the candidate was never probed, because silence is not proof', () => {
    const result = plan({ probes: probes({ [OLD]: 404 }) });
    expect(result.skipped[0].reason).toBe('candidate-not-live');
  });

  it('refuses when a probe errored rather than returning a status', () => {
    const result = plan({ probes: probes({ [OLD]: 404, [NEW]: 'error' }) });
    expect(result.skipped[0].reason).toBe('candidate-not-live');
  });

  it('skips an observation already superseded', () => {
    const result = plan({ observations: [observation({ superseded: true })] });
    expect(result.skipped[0].reason).toBe('already-superseded');
  });

  it('skips a url this repair has no candidate for', () => {
    const result = plan({ observations: [observation({ sourceUrl: NEW })] });
    expect(result.skipped[0].reason).toBe('no-candidate');
  });

  it('rewrites when the candidate already holds the SAME value, which is a no-op merge', () => {
    const result = plan({
      existingByCandidateKey: existing([{ observationFingerprint: 'fp-stale' }]),
    });
    expect(result.rewrite).toHaveLength(1);
    expect(result.supersede).toEqual([]);
  });

  it('supersedes rather than rewrites when the live page states a different value', () => {
    const result = plan({
      existingByCandidateKey: existing([{ observationFingerprint: 'fp-current' }]),
    });
    expect(result.supersede).toEqual([
      { id: '000000000000000000000001', action: 'supersede', from: OLD, to: NEW },
    ]);
    expect(result.rewrite).toEqual([]);
  });

  it('treats a fingerprintless neighbour as a different value, the cautious read', () => {
    const result = plan({ existingByCandidateKey: existing([{}]) });
    expect(result.supersede).toHaveLength(1);
  });

  it('counts everything it scanned', () => {
    const result = plan({
      observations: [observation(), observation({ id: 'b', superseded: true })],
    });
    expect(result.scanned).toBe(2);
  });
});

describe('summarizeSkips', () => {
  it('reports every reason including zeros', () => {
    const counts = summarizeSkips([
      { id: 'a', action: 'skip', from: OLD, reason: 'old-url-still-live' },
      { id: 'b', action: 'skip', from: OLD, reason: 'old-url-still-live' },
    ]);
    expect(counts['old-url-still-live']).toBe(2);
    expect(counts['already-superseded']).toBe(0);
  });
});
