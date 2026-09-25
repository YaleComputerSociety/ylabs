/**
 * The writer's whole job is to refuse a decision nobody could act on later, so the
 * refusals are the tests. A verdict with no reviewer and no note is what left 98
 * `manuallyLockedFields` instances reading `unknown`, and an unlisted single-word
 * approval silently admits the word to the description prose scan (#3377).
 */
import { describe, expect, it } from 'vitest';

import {
  planTaxonomyReviewDecision,
  taxonomyLabelIsSingleWord,
} from '../taxonomyReviewDecisionCore';

const decision = (overrides: Record<string, unknown> = {}) => ({
  label: 'Renaissance Studies',
  verdict: 'APPROVED' as const,
  reviewedBy: 'operator',
  note: 'Named in the catalog and specific enough to read as a topic.',
  alreadyListedAmbiguous: false,
  ...overrides,
});

describe('planTaxonomyReviewDecision', () => {
  it('records a verdict with its reviewer and its reason', () => {
    const update = planTaxonomyReviewDecision(
      decision({ reviewedAt: new Date('2026-09-25T00:00:00Z') }),
    );

    expect(update).toEqual({
      reviewStatus: 'APPROVED',
      reviewedBy: 'operator',
      reviewNote: 'Named in the catalog and specific enough to read as a topic.',
      reviewedAt: new Date('2026-09-25T00:00:00Z'),
    });
  });

  it('refuses a verdict nobody can attribute', () => {
    expect(() => planTaxonomyReviewDecision(decision({ reviewedBy: '   ' }))).toThrow(
      /must name who made it/i,
    );
  });

  it('refuses a verdict with no reason', () => {
    expect(() => planTaxonomyReviewDecision(decision({ note: '' }))).toThrow(/must record why/i);
  });

  it('requires both halves for a dispute too, not only an approval', () => {
    expect(() => planTaxonomyReviewDecision(decision({ verdict: 'DISPUTED', note: '' }))).toThrow(
      /must record why/i,
    );
  });

  // The mechanism: `buildResearchAreaResolverIndex` adds an unlisted single-word
  // canonical name to the prose phrase list, which is how a generic word starts
  // matching any sentence containing it.
  it('refuses a single-word approval that would enter the prose scan unannounced', () => {
    expect(() => planTaxonomyReviewDecision(decision({ label: 'Development' }))).toThrow(
      /prose scan/i,
    );
    expect(() => planTaxonomyReviewDecision(decision({ label: 'Development' }))).toThrow(
      /AMBIGUOUS_SINGLE_WORD_AREAS/,
    );
  });

  it('accepts a single word the reviewer affirms as a specific technical term', () => {
    expect(
      planTaxonomyReviewDecision(decision({ label: 'Immunology', proseSafeSingleWord: true }))
        .reviewStatus,
    ).toBe('APPROVED');
  });

  it('accepts a single word already kept out of the prose scan by the list', () => {
    expect(
      planTaxonomyReviewDecision(decision({ label: 'Economics', alreadyListedAmbiguous: true }))
        .reviewStatus,
    ).toBe('APPROVED');
  });

  // A dispute removes nothing from the prose scan, so the question does not arise.
  it('does not ask the prose question when the verdict is DISPUTED', () => {
    expect(
      planTaxonomyReviewDecision(decision({ label: 'Development', verdict: 'DISPUTED' }))
        .reviewStatus,
    ).toBe('DISPUTED');
  });

  it('reads a multi-word label as multi-word however it is spaced', () => {
    expect(taxonomyLabelIsSingleWord('Immunology')).toBe(true);
    expect(taxonomyLabelIsSingleWord('  Renaissance   Studies ')).toBe(false);
  });
});
