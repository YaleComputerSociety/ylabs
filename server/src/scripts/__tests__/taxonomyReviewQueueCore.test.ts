/**
 * The queue exists so a reviewer is never handed a term whose approval would do
 * something other than what approving a topic looks like (#3377). Two directions are
 * pinned: a well-formed specific term reaches a reviewer, and a generic single word
 * does not reach one without an ambiguity decision, because
 * `buildResearchAreaResolverIndex` puts an unlisted single word into the prose scan.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyTaxonomyReviewCandidate,
  summarizeTaxonomyReviewQueue,
  taxonomyLabelIsMalformed,
} from '../taxonomyReviewQueueCore';

const candidate = (label: string, servedRowsUnlocked = 1, alreadyListedAmbiguous = false) =>
  classifyTaxonomyReviewCandidate({ label, servedRowsUnlocked, alreadyListedAmbiguous });

describe('classifyTaxonomyReviewCandidate', () => {
  it('sends a well-formed multi-word term to a reviewer', () => {
    for (const label of ['Renaissance Studies', 'Environmental Health', 'History of Science']) {
      expect(candidate(label).verdict, label).toBe('ready_for_review');
    }
  });

  it('holds a generic single word for an ambiguity decision', () => {
    for (const label of ['Development', 'Science', 'Health', 'Theory', 'Data']) {
      expect(candidate(label).verdict, label).toBe('needs_ambiguity_decision');
    }
  });

  // A single word already on `AMBIGUOUS_SINGLE_WORD_AREAS` is a decision that has been
  // taken, so it needs no second one.
  it('does not re-ask about a single word already listed as ambiguous', () => {
    expect(candidate('Economics', 1, true).verdict).toBe('ready_for_review');
  });

  it('refuses a label a seeding pass mangled', () => {
    for (const label of [
      'AnemiaYSM Researcher',
      'aqueous systems',
      'Undergraduate Research',
      'Cancer | Faculty profile',
      '',
    ]) {
      expect(taxonomyLabelIsMalformed(label), label).toBe(true);
      expect(candidate(label).verdict, label).toBe('malformed_label');
    }
  });

  it('spares an ordinary acronym-bearing term', () => {
    for (const label of ['MRI Physics', 'CRISPR Screening', 'DNA Repair']) {
      expect(taxonomyLabelIsMalformed(label), label).toBe(false);
    }
  });
});

describe('summarizeTaxonomyReviewQueue', () => {
  it('counts terms and the rows each verdict reaches, and ranks only reviewable terms', () => {
    const summary = summarizeTaxonomyReviewQueue([
      candidate('Development', 17),
      candidate('Renaissance Studies', 3),
      candidate('Clinical Research', 5),
      candidate('aqueous systems', 2),
    ]);

    expect(summary.candidates).toBe(4);
    expect(summary.byVerdict).toEqual({
      needs_ambiguity_decision: 1,
      ready_for_review: 2,
      malformed_label: 1,
    });
    expect(summary.servedRowsReachedByVerdict.needs_ambiguity_decision).toBe(17);
    expect(summary.readyForReviewTop.map((entry) => entry.label)).toEqual([
      'Clinical Research',
      'Renaissance Studies',
    ]);
  });
});
