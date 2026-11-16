import { describe, expect, it } from 'vitest';
import {
  citationStateAfter,
  withholdLastCitationRemovals,
  withholdLastCitationRemovalsFromUpdate,
  wouldRemoveLastCitation,
} from '../lastCitationGuard';
import { hasLiveSourceCitation } from '../sourceLinkHealth';

const DEAD = 'https://example.edu/synthetic-gone/';
const LIVE = 'https://example.edu/synthetic-live/';

const servedRow = (overrides: Record<string, unknown> = {}) => ({
  sourceUrls: [],
  fieldProvenance: { websiteUrl: { sourceName: 'synthetic-lane', sourceUrl: DEAD } },
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

const unsetStamp = { unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } };

describe('wouldRemoveLastCitation (#6320)', () => {
  it('fires when the stamp being unset is a served row only citation', () => {
    expect(wouldRemoveLastCitation(servedRow(), unsetStamp)).toBe(true);
  });

  it('fires on a held row too, because the next gate run recomputes its stored tier', () => {
    expect(
      wouldRemoveLastCitation(servedRow({ studentVisibilityTier: 'operator_review' }), unsetStamp),
    ).toBe(true);
    expect(
      wouldRemoveLastCitation(
        servedRow({ studentVisibilityOverrideTier: 'suppressed' }),
        unsetStamp,
      ),
    ).toBe(true);
  });

  it('does not fire when another live citation remains', () => {
    expect(wouldRemoveLastCitation(servedRow({ sourceUrls: [LIVE] }), unsetStamp)).toBe(false);
    expect(
      wouldRemoveLastCitation(
        servedRow({
          fieldProvenance: {
            websiteUrl: { sourceUrl: DEAD },
            name: { sourceUrl: LIVE },
          },
        }),
        unsetStamp,
      ),
    ).toBe(false);
  });

  it('does not fire on a row with no citation at all, since nothing is removed', () => {
    expect(
      wouldRemoveLastCitation(servedRow({ fieldProvenance: {} }), {
        unset: { 'fieldProvenance.websiteUrl': '' },
      }),
    ).toBe(false);
  });

  it('fires when sourceUrls is emptied and the stamp unset together', () => {
    expect(
      wouldRemoveLastCitation(servedRow({ sourceUrls: [LIVE] }), {
        set: { sourceUrls: [] },
        unset: { 'fieldProvenance.websiteUrl': '' },
      }),
    ).toBe(true);
    expect(
      wouldRemoveLastCitation(servedRow({ sourceUrls: [LIVE] }), {
        unset: { sourceUrls: '', 'fieldProvenance.websiteUrl': '' },
      }),
    ).toBe(true);
    expect(
      wouldRemoveLastCitation(servedRow({ sourceUrls: [LIVE] }), {
        pull: { sourceUrls: LIVE },
        unset: { 'fieldProvenance.websiteUrl': '' },
      }),
    ).toBe(true);
  });

  it('reads stamp sets, sourceUrl sets and whole provenance replacements', () => {
    const row = servedRow();
    expect(
      wouldRemoveLastCitation(row, { set: { 'fieldProvenance.websiteUrl.sourceUrl': '' } }),
    ).toBe(true);
    expect(
      wouldRemoveLastCitation(row, {
        set: { 'fieldProvenance.websiteUrl': { sourceName: 'synthetic-lane' } },
      }),
    ).toBe(true);
    expect(wouldRemoveLastCitation(row, { set: { fieldProvenance: {} } })).toBe(true);
    expect(
      wouldRemoveLastCitation(row, {
        set: { fieldProvenance: { name: { sourceUrl: LIVE } } },
      }),
    ).toBe(false);
    expect(
      wouldRemoveLastCitation(row, {
        unset: { 'fieldProvenance.websiteUrl': '' },
        set: { 'fieldProvenance.name': { sourceUrl: LIVE } },
      }),
    ).toBe(false);
  });

  it('reads the same citation union as hasLiveSourceCitation', () => {
    const row = servedRow();
    const after = citationStateAfter(row, unsetStamp);
    const sourceLinkHealth = [{ url: DEAD, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }];
    expect(hasLiveSourceCitation({ ...row, sourceLinkHealth })).toBe(false);
    expect(hasLiveSourceCitation({ ...after, sourceLinkHealth })).toBe(true);
  });
});

describe('withholdLastCitationRemovals (#6320)', () => {
  it('keeps the stamp first and still clears the field value', () => {
    const guarded = withholdLastCitationRemovals(servedRow(), unsetStamp);
    expect(guarded.unset).toEqual({ websiteUrl: '' });
    expect(guarded.withheld).toEqual(['fieldProvenance.websiteUrl']);
  });

  it('keeps the sourceUrls change only when withholding the stamps is not enough', () => {
    const stampKeptEnough = withholdLastCitationRemovals(servedRow({ sourceUrls: [LIVE] }), {
      set: { sourceUrls: [] },
      unset: { 'fieldProvenance.websiteUrl': '' },
    });
    expect(stampKeptEnough.set).toEqual({ sourceUrls: [] });
    expect(stampKeptEnough.withheld).toEqual(['fieldProvenance.websiteUrl']);

    const onlySourceUrls = withholdLastCitationRemovals(
      servedRow({ sourceUrls: [LIVE], fieldProvenance: {} }),
      { set: { sourceUrls: [], name: 'Synthetic Lab' } },
    );
    expect(onlySourceUrls.set).toEqual({ name: 'Synthetic Lab' });
    expect(onlySourceUrls.withheld).toEqual(['sourceUrls']);
  });

  it('passes a change through untouched when the rule does not fire', () => {
    const change = { unset: { websiteUrl: '', 'fieldProvenance.websiteUrl': '' } };
    expect(withholdLastCitationRemovals(servedRow({ sourceUrls: [LIVE] }), change)).toEqual({
      set: {},
      unset: change.unset,
      pull: {},
      withheld: [],
    });
  });

  it('rebuilds a Mongo update and passes other operators through', () => {
    const { update, withheld } = withholdLastCitationRemovalsFromUpdate(servedRow(), {
      $unset: { 'fieldProvenance.websiteUrl': '' },
      $addToSet: { tags: 'synthetic' },
    });
    expect(update).toEqual({ $addToSet: { tags: 'synthetic' } });
    expect(withheld).toEqual(['fieldProvenance.websiteUrl']);
  });
});
