// A name here must stay registered and seeded (#3547, #3553, #3636).
const MANUAL_ONLY_SWEEP_SOURCE_REASONS: Record<string, string> = {
  'undergrad-fellowships-recipients':
    'backward-looking recipients source with no clean public feed; run from curated input',
  'federal-award-usaspending':
    'USAspending publishes no principal-investigator field, so the lane acquires nothing by construction and would trip the barren-streak guard on every sweep (#3542, #3547)',
  'undergrad-research-posting':
    'no official public page publishes postings in the shape the lane reads, so its page list is empty and it would trip the barren-streak guard on every sweep (#3550, #3553); return it to the sweep when a replacement page is configured (#3551)',
  'lab-microsite-undergrad-llm':
    'its served undergradEvidenceQuote badge precision measured 18/50 = 0.36 (95% Wilson 0.24 to 0.50) and its grounding precision 18/38 = 0.47, with 19 of 50 quotes being an absence note the model wrote rather than page text, a shape matching 299 of its 925 served rows, so the badge was withdrawn (#3569, #3607); at about 4 to 19 labs per minute over 4,808 labs it also projects to 15 to 20 hours of a sweep (#3636); return it to the sweep when #3592 lands and a re-measure with journey:eval --case=undergrad-evidence-quote-precision clears the #3569 thresholds',
};

export const MANUAL_ONLY_SWEEP_SOURCES: string[] = Object.keys(MANUAL_ONLY_SWEEP_SOURCE_REASONS);

const MANUAL_ONLY_SWEEP_SOURCE_SET: ReadonlySet<string> = new Set(MANUAL_ONLY_SWEEP_SOURCES);

export function isManualOnlySweepSource(sourceName: string | undefined): boolean {
  return typeof sourceName === 'string' && MANUAL_ONLY_SWEEP_SOURCE_SET.has(sourceName);
}
