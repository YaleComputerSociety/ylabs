import { describe, expect, it } from 'vitest';
import {
  isUnsourcedProvenanceRecord,
  planUnsourcedProvenanceWebsiteUrlClear,
} from '../unsourcedProvenanceWebsiteClear';

const SITE = 'https://example-lab.example.org/';
const UNSOURCED = { sourceName: 'hand-written-lane', sourceUrl: SITE, confidence: 0.9 };

const plan = (overrides: Partial<Parameters<typeof planUnsourcedProvenanceWebsiteUrlClear>[0]>) =>
  planUnsourcedProvenanceWebsiteUrlClear({
    stored: { websiteUrl: SITE, fieldProvenance: { websiteUrl: UNSOURCED } },
    staged: {},
    observations: [],
    lockedFields: [],
    ...overrides,
  });

describe('isUnsourcedProvenanceRecord', () => {
  it('recognises a record that names a lane with neither a source nor an observation id', () => {
    expect(isUnsourcedProvenanceRecord(UNSOURCED)).toBe(true);
  });

  it('does not treat a record carrying either id as unsourced', () => {
    expect(isUnsourcedProvenanceRecord({ ...UNSOURCED, sourceId: 'a1' })).toBe(false);
    expect(isUnsourcedProvenanceRecord({ ...UNSOURCED, observationId: 'b2' })).toBe(false);
  });

  it('does not treat a missing record or a nameless record as unsourced', () => {
    expect(isUnsourcedProvenanceRecord(undefined)).toBe(false);
    expect(isUnsourcedProvenanceRecord({ sourceUrl: SITE })).toBe(false);
  });
});

describe('planUnsourcedProvenanceWebsiteUrlClear', () => {
  it('clears a value whose only record is unsourced and that no observation states', () => {
    expect(plan({})).toBe(true);
  });

  it('reads a Map-shaped provenance the same as a plain object', () => {
    expect(
      plan({
        stored: { websiteUrl: SITE, fieldProvenance: new Map([['websiteUrl', UNSOURCED]]) },
      }),
    ).toBe(true);
  });

  it('keeps the value when any observation states it, under any website-stating field', () => {
    for (const field of ['websiteUrl', 'website', 'sourceUrls']) {
      const value = field === 'sourceUrls' ? ['https://www.example-lab.example.org'] : SITE;
      expect(plan({ observations: [{ field, value }] })).toBe(false);
    }
  });

  it('keeps a value whose provenance cites an observation, even when none is live', () => {
    expect(
      plan({
        stored: {
          websiteUrl: SITE,
          fieldProvenance: { websiteUrl: { ...UNSOURCED, sourceId: 'a1', observationId: 'b2' } },
        },
      }),
    ).toBe(false);
  });

  it('keeps a value with no provenance record at all', () => {
    expect(plan({ stored: { websiteUrl: SITE } })).toBe(false);
  });

  it('honours a websiteUrl lock', () => {
    expect(plan({ lockedFields: ['websiteUrl'] })).toBe(false);
  });

  it('defers to a value the pass already staged', () => {
    expect(plan({ staged: { websiteUrl: '' } })).toBe(false);
    expect(plan({ staged: { websiteUrl: 'https://other.example.org/' } })).toBe(false);
  });

  it('has nothing to clear on an empty stored value', () => {
    expect(plan({ stored: { websiteUrl: '', fieldProvenance: { websiteUrl: UNSOURCED } } })).toBe(
      false,
    );
  });
});
