import { isWithdrawnFellowshipCitation } from './fellowshipSourcePrecedence';

interface FellowshipSourceReadObservation {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  observedAt?: unknown;
}

const readTime = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const time = new Date(value as string | number | Date).getTime();
  return Number.isFinite(time) ? time : undefined;
};

/**
 * The time of the newest live read, by the row's own source lane, that still confirms the
 * row (#6403). Fellowship observations fingerprint without their value, so every successful
 * re-read writes a fresh `observedAt`; a failed or throttled fetch writes nothing, and a
 * read that withdraws the row's citation confirms nothing, so neither can advance it.
 */
export function latestFellowshipSourceReadAt(
  observations: readonly FellowshipSourceReadObservation[],
  sourceName: unknown,
): Date | undefined {
  if (typeof sourceName !== 'string' || !sourceName) return undefined;
  let latest: number | undefined;
  for (const observation of observations) {
    if (observation.sourceName !== sourceName) continue;
    if (isWithdrawnFellowshipCitation(observation)) continue;
    const time = readTime(observation.observedAt);
    if (time !== undefined && (latest === undefined || time > latest)) latest = time;
  }
  return latest === undefined ? undefined : new Date(latest);
}

export function advancedSourceLastVerifiedAt(
  stored: unknown,
  latestRead: Date | undefined,
): Date | undefined {
  if (!latestRead) return undefined;
  const storedTime = readTime(stored);
  return storedTime !== undefined && storedTime >= latestRead.getTime() ? undefined : latestRead;
}
