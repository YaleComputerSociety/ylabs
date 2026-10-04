// A name here must stay registered and seeded (#3547, #3553, #3636).
const MANUAL_ONLY_SWEEP_SOURCE_REASONS: Record<string, string> = {
  'undergrad-fellowships-recipients':
    'backward-looking recipients source with no clean public feed; run from curated input',
  'undergrad-research-posting':
    'no official public page publishes postings in the shape the lane reads, so its page list is empty and it would trip the barren-streak guard on every sweep (#3550, #3553); return it to the sweep when a replacement page is configured (#3551)',
  'official-research-home-roster':
    'sampled roster precision review not yet recorded by a person: the lane claims named non-lead people are current members, and research-homes:audit-rosters --strict has never been recorded reporting broadEnablementReady (#2412, #4025); after the lane fix, the 2026-10-04 strict re-run on Development measured brokenLanes 0, every snapshot key holding one fresh CURRENT edge and no twin, and 7 of 7 sampled roles honest on an agent check, which is not a recorded review (#4758); return it to the sweep when a person reviews the sample and records it with --sampled-precision-reviewed-by',
  'lab-microsite-undergrad-llm':
    'its served undergradEvidenceQuote badge precision measured 18/50 = 0.36 (95% Wilson 0.24 to 0.50) and its grounding precision 18/38 = 0.47, with 19 of 50 quotes being an absence note the model wrote rather than page text, a shape matching 299 of its 925 served rows, so the badge was withdrawn (#3569, #3607); at about 4 to 19 labs per minute over 4,808 labs it also projects to 15 to 20 hours of a sweep (#3636); return it to the sweep when #3592 lands and a re-measure with journey:eval --case=undergrad-evidence-quote-precision clears the #3569 thresholds',
};

export const MANUAL_ONLY_SWEEP_SOURCES: string[] = Object.keys(MANUAL_ONLY_SWEEP_SOURCE_REASONS);

const MANUAL_ONLY_SWEEP_SOURCE_SET: ReadonlySet<string> = new Set(MANUAL_ONLY_SWEEP_SOURCES);

export function isManualOnlySweepSource(sourceName: string | undefined): boolean {
  return typeof sourceName === 'string' && MANUAL_ONLY_SWEEP_SOURCE_SET.has(sourceName);
}
