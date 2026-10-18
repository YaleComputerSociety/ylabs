// A name here must stay registered and seeded (#3547, #3553, #3636).
const MANUAL_ONLY_SWEEP_SOURCE_REASONS: Record<string, string> = {
  'roster-bio-research-evidence':
    'mints new faculty-research rows from roster biographies, and an agent check of a sample is not a precision review: the owner reviewed a 20-row dry-run sample on 2026-10-05 and reviews a sample of the rows the first Development run produces; return it to the sweep only after that review is recorded by a person',
  'undergrad-fellowships-recipients':
    'backward-looking recipients source with no clean public feed; run from curated input',
  'undergrad-research-posting':
    'no official public page publishes postings in the shape the lane reads, so its page list is empty and it would trip the barren-streak guard on every sweep (#3550, #3553); return it to the sweep when a replacement page is configured (#3551)',
  'lab-microsite-undergrad-llm':
    "stays manual-only for runtime, not precision, by owner decision on 2026-10-11 (#3569): the 2026-09-29 re-measure with journey:eval --case=undergrad-evidence-quote-precision judged all 50 drawn served quotes and read badge precision 42/50 = 0.84 (95% Wilson 0.71 to 0.92), up from 0.36 at #3569, so the browse card shows the quote beside its badge; but a full pass at about 4 to 19 labs per minute over 4,808 labs takes 4 to 20 hours against a weekly sweep of about 8 hours and Render's 12-hour job limit (#3636), so run it scoped by hand when the quotes need refreshing",
};

export const MANUAL_ONLY_SWEEP_SOURCES: string[] = Object.keys(MANUAL_ONLY_SWEEP_SOURCE_REASONS);

const MANUAL_ONLY_SWEEP_SOURCE_SET: ReadonlySet<string> = new Set(MANUAL_ONLY_SWEEP_SOURCES);

export function isManualOnlySweepSource(sourceName: string | undefined): boolean {
  return typeof sourceName === 'string' && MANUAL_ONLY_SWEEP_SOURCE_SET.has(sourceName);
}
