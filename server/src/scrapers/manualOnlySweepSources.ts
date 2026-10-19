// A name here must stay registered and seeded (#3547, #3553, #3636).
const MANUAL_ONLY_SWEEP_SOURCE_REASONS: Record<string, string> = {
  'roster-bio-research-evidence':
    'mints new faculty-research rows from roster biographies, and an agent check of a sample is not a precision review: the owner reviewed a 20-row dry-run sample on 2026-10-05 and reviews a sample of the rows the first Development run produces; return it to the sweep only after that review is recorded by a person',
  'undergrad-fellowships-recipients':
    'backward-looking recipients source with no clean public feed; run from curated input',
  'undergrad-research-posting':
    'no official public page publishes postings in the shape the lane reads, so its page list is empty and it would trip the barren-streak guard on every sweep (#3550, #3553); return it to the sweep when a replacement page is configured (#3551)',
  'center-affiliation-llm':
    'replaced by the deterministic center-affiliation-roster lane by owner decision on 2026-10-19 (#5296): on 40 centers frozen that day (602 live claims, 39 of 42 cited pages fetched), a 100-claim sample of this lane named a current member 75% of the time but emitted a target key naming that person 26% of the time, and 54 of its 557 judgeable claims resolved to a row, while a 100-assertion sample of the code lane was correct 100/100 and 181 of its 341 people resolved; the code lane hands off and ends the relationships this lane wrote when its read does not list them, so this lane must not run again beside it',
  'center-director-llm':
    "replaced by the deterministic center-director lane by owner decision on 2026-10-19 (#5296): on 106 homes frozen that day the code lane named 58 directors and the page supported all 58, while 40 of this lane's 80 values named the director under the owner's rule and 24 named someone the page does not support; the code lane hands off and ends the lead edges this lane wrote, so this lane must not run again beside it",
  'lab-microsite-undergrad-llm':
    'frozen by owner decision on 2026-10-18 (#5296): every scraper lane is to be deterministic, and a model may help only at materialization over stored observations, so this lane is not run again; its stored badge evidence stays served until a deterministic roster or recipient list covers the row, measured on an agent-graded 30-row sample at 25/29 correct on the badge and 18/29 on the count',
};

export const MANUAL_ONLY_SWEEP_SOURCES: string[] = Object.keys(MANUAL_ONLY_SWEEP_SOURCE_REASONS);

const MANUAL_ONLY_SWEEP_SOURCE_SET: ReadonlySet<string> = new Set(MANUAL_ONLY_SWEEP_SOURCES);

export function isManualOnlySweepSource(sourceName: string | undefined): boolean {
  return typeof sourceName === 'string' && MANUAL_ONLY_SWEEP_SOURCE_SET.has(sourceName);
}
