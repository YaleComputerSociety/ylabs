/**
 * Orders the UNREVIEWED taxonomy vocabulary for a reviewer, and says which terms a
 * reviewer must not be handed without a second decision (#3377).
 *
 * The review state is a genuine gate rather than a default nobody moved.
 * `buildCanonicalizerFromDatabase` reads `reviewStatus: 'APPROVED'` only, and
 * `deriveCanonicalResearchAreasFromPage` documents itself as fail-closed on it, so an
 * unreviewed term is invisible to every topic lane by design.
 *
 * What is missing is the other half: nothing in the repository moves a term out of
 * UNREVIEWED. There is no minting lane and no reviewer, and all 5,291 Development
 * terms carry the same creation date, so the gate is enforced and unactionable at the
 * same time - the shape `operator_decision` had before #3368 gave refusals a writer.
 *
 * Bulk approval is not the answer, and that is measured rather than assumed. Widening
 * the canonicalizer to the whole active vocabulary proposes 234 distinct terms across
 * 125 topicless served rows, 128 of them single words, and the reach is led by
 * "Development" (17 rows), "Science" (16), "Health" (15) and "society" (12). For 49
 * rows the ONLY gain is a single word. Those 49 are not rows the gate blocks; they are
 * rows it protects.
 *
 * The reason single words matter here is structural. `buildResearchAreaResolverIndex`
 * puts a single-word canonical name into the prose phrase list unless it appears in
 * `AMBIGUOUS_SINGLE_WORD_AREAS`, and that list was curated against the 672 approved
 * terms. So approving a generic single word silently adds it to the prose scan, which
 * is exactly what the list exists to prevent. Approval and the list have to move
 * together, and this queue says for which terms.
 */
export type TaxonomyReviewVerdict =
  /** A single word not already listed as ambiguous: approving it joins the prose scan. */
  | 'needs_ambiguity_decision'
  /** The label itself is broken, so there is nothing to approve until it is fixed. */
  | 'malformed_label'
  /** Well formed and specific enough that a reviewer can judge it on its merits. */
  | 'ready_for_review';

export interface TaxonomyReviewCandidateInput {
  label: string;
  /** Served rows with no topic today whose prose this term would match. */
  servedRowsUnlocked: number;
  /** Whether the label already appears in `AMBIGUOUS_SINGLE_WORD_AREAS`. */
  alreadyListedAmbiguous: boolean;
}

export interface TaxonomyReviewCandidate extends TaxonomyReviewCandidateInput {
  verdict: TaxonomyReviewVerdict;
  wordCount: number;
}

const words = (label: string): string[] => label.trim().split(/\s+/).filter(Boolean);

/**
 * A label a seeding pass mangled rather than a term a reviewer can judge: a run-on
 * where a topic collides with page furniture ("AnemiaYSM Researcher"), a lower-case
 * opening that marks a harvested prose fragment rather than a name, or punctuation no
 * canonical name carries.
 */
export function taxonomyLabelIsMalformed(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  if (/[A-Z]{2,}[a-z]/.test(trimmed.replace(/\s/g, ' '))) return true;
  if (/^[a-z]/.test(trimmed)) return true;
  if (/[|;<>{}[\]]|\.\.\./.test(trimmed)) return true;
  return /\b(?:researcher|faculty|profile|page|website|undergraduate research)\b/i.test(trimmed);
}

export function classifyTaxonomyReviewCandidate(
  input: TaxonomyReviewCandidateInput,
): TaxonomyReviewCandidate {
  const wordCount = words(input.label).length;
  if (taxonomyLabelIsMalformed(input.label)) {
    return { ...input, wordCount, verdict: 'malformed_label' };
  }
  if (wordCount === 1 && !input.alreadyListedAmbiguous) {
    return { ...input, wordCount, verdict: 'needs_ambiguity_decision' };
  }
  return { ...input, wordCount, verdict: 'ready_for_review' };
}

export interface TaxonomyReviewQueueSummary {
  candidates: number;
  byVerdict: Record<string, number>;
  servedRowsReachedByVerdict: Record<string, number>;
  readyForReviewTop: Array<{ label: string; servedRowsUnlocked: number }>;
}

/**
 * Ranked by served rows reached, because a reviewer's time should go to the term that
 * unlocks the most pages a student currently reads with no topic at all.
 */
export function summarizeTaxonomyReviewQueue(
  candidates: readonly TaxonomyReviewCandidate[],
): TaxonomyReviewQueueSummary {
  const summary: TaxonomyReviewQueueSummary = {
    candidates: candidates.length,
    byVerdict: {},
    servedRowsReachedByVerdict: {},
    readyForReviewTop: [],
  };
  for (const candidate of candidates) {
    summary.byVerdict[candidate.verdict] = (summary.byVerdict[candidate.verdict] ?? 0) + 1;
    summary.servedRowsReachedByVerdict[candidate.verdict] =
      (summary.servedRowsReachedByVerdict[candidate.verdict] ?? 0) + candidate.servedRowsUnlocked;
  }
  summary.readyForReviewTop = candidates
    .filter((candidate) => candidate.verdict === 'ready_for_review')
    .sort(
      (left, right) =>
        right.servedRowsUnlocked - left.servedRowsUnlocked || left.label.localeCompare(right.label),
    )
    .slice(0, 25)
    .map(({ label, servedRowsUnlocked }) => ({ label, servedRowsUnlocked }));
  return summary;
}
