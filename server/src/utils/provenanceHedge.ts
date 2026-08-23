const TRAILING_PROVENANCE_HEDGE = /[\s,;.]*\bwhen\s+source[\s-]?confirmed\b[\s.,;]*$/i;

export const stripProvenanceHedge = (value: string): string =>
  value.replace(TRAILING_PROVENANCE_HEDGE, '').trim();
