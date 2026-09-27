import {
  isPlausibleUndergradEvidenceQuote,
  laneQuoteStatesUndergraduates,
  UNDERGRAD_MICROSITE_LANE,
} from './undergradEvidenceQuoteValidation';
import {
  isHistoricalUndergradEvidence,
  namesNonYaleInstitution,
} from './sources/labMicrositeUndergradLLMExtractor';

export const UNDERGRAD_EVIDENCE_QUOTE_FIELD = 'undergradEvidenceQuote';

export function undergradEvidenceQuoteIsInadmissible(value: string, sourceName?: unknown): boolean {
  return (
    !isPlausibleUndergradEvidenceQuote(value) ||
    isHistoricalUndergradEvidence(value) ||
    namesNonYaleInstitution(value) ||
    (sourceName === UNDERGRAD_MICROSITE_LANE && !laneQuoteStatesUndergraduates(value))
  );
}

interface QuoteObservationLike {
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  observedAt?: unknown;
}

function observedTime(value: unknown): number {
  const time = value instanceof Date ? value.getTime() : new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sourcesWithdrawingUndergradEvidenceQuote(
  observations: readonly QuoteObservationLike[],
): Set<string> {
  const latestBySource = new Map<string, QuoteObservationLike>();
  for (const observation of observations) {
    if (observation.field !== UNDERGRAD_EVIDENCE_QUOTE_FIELD) continue;
    const sourceName = String(observation.sourceName ?? '');
    if (!sourceName) continue;
    const incumbent = latestBySource.get(sourceName);
    if (!incumbent || observedTime(observation.observedAt) >= observedTime(incumbent.observedAt)) {
      latestBySource.set(sourceName, observation);
    }
  }
  const withdrawing = new Set<string>();
  for (const [sourceName, latest] of latestBySource) {
    if (typeof latest.value !== 'string') continue;
    const text = latest.value.trim();
    if (!text || undergradEvidenceQuoteIsInadmissible(text, sourceName))
      withdrawing.add(sourceName);
  }
  return withdrawing;
}

export function withoutWithdrawnUndergradEvidenceQuotes<T extends QuoteObservationLike>(
  observations: readonly T[],
  withdrawingSources: ReadonlySet<string>,
): T[] {
  return observations.filter(
    (observation) =>
      observation.field !== UNDERGRAD_EVIDENCE_QUOTE_FIELD ||
      !withdrawingSources.has(String(observation.sourceName ?? '')),
  );
}

export type StoredUndergradEvidenceQuoteClearReason = 'inadmissible' | 'withdrawn-by-its-source';

export interface StoredUndergradEvidenceQuoteClear {
  reason: StoredUndergradEvidenceQuoteClearReason;
  skipped: 'field-is-locked' | null;
}

function provenanceSourceName(stored: Record<string, unknown> | null | undefined): string {
  const provenance = stored?.fieldProvenance;
  const record =
    provenance instanceof Map
      ? provenance.get(UNDERGRAD_EVIDENCE_QUOTE_FIELD)
      : provenance && typeof provenance === 'object'
        ? (provenance as Record<string, unknown>)[UNDERGRAD_EVIDENCE_QUOTE_FIELD]
        : undefined;
  if (!record || typeof record !== 'object') return '';
  return String((record as { sourceName?: unknown }).sourceName ?? '');
}

export function planStoredUndergradEvidenceQuoteClear(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  withdrawingSources: ReadonlySet<string>;
  lockedFields: readonly string[];
}): StoredUndergradEvidenceQuoteClear | null {
  const staged = UNDERGRAD_EVIDENCE_QUOTE_FIELD in input.staged;
  const current = staged
    ? input.staged[UNDERGRAD_EVIDENCE_QUOTE_FIELD]
    : input.stored?.[UNDERGRAD_EVIDENCE_QUOTE_FIELD];
  if (typeof current !== 'string' || current.trim().length === 0) return null;
  let reason: StoredUndergradEvidenceQuoteClearReason | null = null;
  const currentSource = staged ? undefined : provenanceSourceName(input.stored);
  if (undergradEvidenceQuoteIsInadmissible(current.trim(), currentSource)) reason = 'inadmissible';
  else if (!staged && input.withdrawingSources.has(provenanceSourceName(input.stored))) {
    reason = 'withdrawn-by-its-source';
  }
  if (!reason) return null;
  return {
    reason,
    skipped: input.lockedFields.includes(UNDERGRAD_EVIDENCE_QUOTE_FIELD) ? 'field-is-locked' : null,
  };
}
