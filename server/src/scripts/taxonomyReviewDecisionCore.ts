/**
 * The rules for recording a review decision on one `TaxonomyTerm` (#3377).
 *
 * `buildCanonicalizerFromDatabase` reads `reviewStatus: 'APPROVED'` and nothing else,
 * so this is the only thing that can widen the canonical topic vocabulary. The gate
 * was enforced and unactionable: the vocabulary was seeded once by a
 * `data-migration/seedTaxonomyTerms.ts` that has since been deleted, whose candidate
 * arm parked residual scraped labels as `UNREVIEWED` "for human ratification" and
 * said they "never participate in canonicalization until an approver promotes them".
 * The approver was never built. This is it.
 *
 * Three fences, and each one exists because its absence has already cost something.
 *
 * A reviewer and a note are REQUIRED. A verdict nobody can attribute and nobody can
 * explain is what left 98 `manuallyLockedFields` instances reading `unknown`, which no
 * later reader could act on (#3368). The same field in a new collection would be the
 * same defect.
 *
 * One term per decision. Approval is a judgement about a term, so there is no bulk
 * arm, the same reason `research-entity:refuse-field-value` has none.
 *
 * Approving a single word is refused unless the reviewer says which kind it is, and
 * that is the mechanism rather than caution. `buildResearchAreaResolverIndex` puts a
 * single-word canonical name into the PROSE phrase list unless it appears in
 * `AMBIGUOUS_SINGLE_WORD_AREAS`, and that list was curated against the 672 approved
 * terms rather than the 4,619 unreviewed ones. Measured on Development 2026-09-25, the
 * unreviewed vocabulary would put "Development" on 17 served rows, "Science" on 16 and
 * "Health" on 15 through that scan. So an unlisted single word cannot be approved
 * silently: either the reviewer affirms it is a specific technical term that belongs in
 * prose ("Immunology", "Genomics"), or it needs adding to the ambiguity list first,
 * which is a code change. The refusal names both routes rather than skipping quietly.
 */
import type { TaxonomyTermReviewStatus } from '../models/taxonomyTerm';

export type TaxonomyReviewVerdictInput = Exclude<TaxonomyTermReviewStatus, 'UNREVIEWED'>;

export interface TaxonomyReviewDecision {
  label: string;
  verdict: TaxonomyReviewVerdictInput;
  reviewedBy: string;
  note: string;
  /**
   * The reviewer's affirmation that a single-word label is a specific technical term
   * safe to recover from prose. Ignored for a multi-word label and for `DISPUTED`.
   */
  proseSafeSingleWord?: boolean;
  /** Whether the label already appears in `AMBIGUOUS_SINGLE_WORD_AREAS`. */
  alreadyListedAmbiguous: boolean;
  reviewedAt?: Date;
}

export interface TaxonomyReviewUpdate {
  reviewStatus: TaxonomyReviewVerdictInput;
  reviewedBy: string;
  reviewNote: string;
  reviewedAt: Date;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export const taxonomyLabelIsSingleWord = (label: string): boolean =>
  text(label).split(' ').filter(Boolean).length === 1;

/**
 * The `$set` for one reviewed term, or a thrown refusal naming what is missing.
 *
 * Throwing rather than returning a verdict object, because every caller of this is an
 * operator at a command line: a refusal they have to read is the point, and a skip
 * they can miss is what this exists to prevent.
 */
export function planTaxonomyReviewDecision(decision: TaxonomyReviewDecision): TaxonomyReviewUpdate {
  const label = text(decision.label);
  if (!label) throw new Error('A review decision must name the term it decides.');
  const reviewedBy = text(decision.reviewedBy);
  const note = text(decision.note);
  if (!reviewedBy) {
    throw new Error(
      `A review decision must name who made it (term: ${JSON.stringify(label)}). An approval nobody can attribute is not a review.`,
    );
  }
  if (!note) {
    throw new Error(
      `A review decision must record why (term: ${JSON.stringify(label)}). Nothing else will ever explain it.`,
    );
  }
  if (
    decision.verdict === 'APPROVED' &&
    taxonomyLabelIsSingleWord(label) &&
    !decision.alreadyListedAmbiguous &&
    !decision.proseSafeSingleWord
  ) {
    throw new Error(
      `Approving the single-word term ${JSON.stringify(label)} would admit it to the description prose scan, because ` +
        'buildResearchAreaResolverIndex adds any single-word canonical name that is not in AMBIGUOUS_SINGLE_WORD_AREAS. ' +
        'Either affirm it is a specific technical term safe to recover from prose, or add it to AMBIGUOUS_SINGLE_WORD_AREAS first and re-run.',
    );
  }
  return {
    reviewStatus: decision.verdict,
    reviewedBy,
    reviewNote: note,
    reviewedAt: decision.reviewedAt ?? new Date(),
  };
}
