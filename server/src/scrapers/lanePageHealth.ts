import {
  checkSourceLinkHealth,
  findSourceLinkHealth,
  sourceLinkHealthKey,
  type SourceLinkHealth,
} from '../services/sourceLinkHealth';
import { isBenchmarkReplayActive } from './snapshotBenchmarkMode';
import type { ObservationInput } from './types';

export const LANE_PAGE_HEALTH_FIELD = 'lanePageHealth';

const GONE_HTTP_STATUS_CODES: ReadonlySet<number> = new Set([404, 410]);

export interface LanePageHealthVerdict {
  url: string;
  healthStatus: SourceLinkHealth['healthStatus'];
  httpStatusCode?: number;
  resolvedUrl?: string;
}

type LanePageObservation = {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
  observedAt?: unknown;
  entityKey?: unknown;
  entityId?: unknown;
};

export interface LanePageHealthWithdrawal<T> {
  observations: T[];
  withdrawnValuesByField: Map<string, unknown[]>;
}

export function isConfirmedGonePageVerdict(value: unknown): boolean {
  const verdict = value as Partial<LanePageHealthVerdict> | null | undefined;
  return (
    verdict?.healthStatus === 'UNAVAILABLE' &&
    typeof verdict.httpStatusCode === 'number' &&
    typeof verdict.url === 'string' &&
    sourceLinkHealthKey(verdict.url) !== null
  );
}

function isLivePageVerdict(value: unknown): boolean {
  const status = (value as Partial<LanePageHealthVerdict> | null | undefined)?.healthStatus;
  return status === 'HEALTHY' || status === 'REDIRECTED';
}

function verdictFrom(url: string, health: SourceLinkHealth): LanePageHealthVerdict {
  return {
    url,
    healthStatus: health.healthStatus,
    ...(typeof health.httpStatusCode === 'number' ? { httpStatusCode: health.httpStatusCode } : {}),
  };
}

export function lanePageReadVerdict(
  url: string,
  resolvedUrl = url,
  httpStatusCode = 200,
): LanePageHealthVerdict {
  const resolvedIsAnotherPage = sourceLinkHealthKey(resolvedUrl) !== sourceLinkHealthKey(url);
  return {
    url,
    healthStatus: 'HEALTHY',
    httpStatusCode,
    ...(resolvedIsAnotherPage ? { resolvedUrl } : {}),
  };
}

export type LanePageProbe = (url: string) => Promise<SourceLinkHealth>;

export function isGoneHttpStatus(status: unknown): boolean {
  return typeof status === 'number' && GONE_HTTP_STATUS_CODES.has(status);
}

export function fetchFailureHttpStatus(error: unknown): number | undefined {
  const failure = error as { status?: unknown; response?: { status?: unknown } } | null;
  const status = failure?.response?.status ?? failure?.status;
  return typeof status === 'number' ? status : undefined;
}

export async function confirmGoneLanePage(
  url: string,
  firstAnswer: { httpStatusCode?: unknown; storedHealth?: unknown },
  probe: LanePageProbe = checkSourceLinkHealth,
): Promise<LanePageHealthVerdict | null> {
  const stored = findSourceLinkHealth(firstAnswer.storedHealth, url);
  const firstSaysGone =
    isGoneHttpStatus(firstAnswer.httpStatusCode) ||
    (stored !== undefined && isConfirmedGonePageVerdict(verdictFrom(url, stored)));
  if (!firstSaysGone || isBenchmarkReplayActive()) return null;
  const confirmation = verdictFrom(url, await probe(url));
  return isConfirmedGonePageVerdict(confirmation) ? confirmation : null;
}

export function lanePageHealthObservation(
  entity: Pick<ObservationInput, 'entityType' | 'entityId' | 'entityKey'>,
  verdict: LanePageHealthVerdict,
): ObservationInput {
  return {
    entityType: entity.entityType,
    entityId: entity.entityId,
    entityKey: entity.entityKey,
    sourceUrl: verdict.url,
    field: LANE_PAGE_HEALTH_FIELD,
    value: verdict,
  };
}

function observedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function identityScope(observation: LanePageObservation, rowIdentities: ReadonlySet<string>) {
  const forms = [observation.entityKey, observation.entityId]
    .map((form) => (form === undefined || form === null ? '' : String(form)))
    .filter(Boolean);
  if (forms.some((form) => rowIdentities.has(form))) return 'row';
  return forms[0] ?? '';
}

function pageScopeKey(
  observation: LanePageObservation,
  pageUrl: unknown,
  rowIdentities: ReadonlySet<string>,
): string | null {
  const page = sourceLinkHealthKey(pageUrl);
  if (!page) return null;
  return JSON.stringify([
    String(observation.sourceName ?? ''),
    identityScope(observation, rowIdentities),
    page,
  ]);
}

function newestPageEvidence(
  observations: readonly LanePageObservation[],
  rowIdentities: ReadonlySet<string>,
): Map<string, { goneAt: number; liveAt: number }> {
  const byPage = new Map<string, { goneAt: number; liveAt: number }>();
  const newestResolvedRead = new Map<string, { at: number; resolvedKey: string | null }>();
  const touch = (key: string) => {
    const entry = byPage.get(key) ?? { goneAt: 0, liveAt: 0 };
    byPage.set(key, entry);
    return entry;
  };
  for (const observation of observations) {
    if (observation.field !== LANE_PAGE_HEALTH_FIELD) continue;
    const verdict = observation.value as Partial<LanePageHealthVerdict> | null | undefined;
    const key = pageScopeKey(observation, verdict?.url, rowIdentities);
    if (!key) continue;
    const at = observedTime(observation.observedAt);
    const entry = touch(key);
    if (isConfirmedGonePageVerdict(verdict)) {
      entry.goneAt = Math.max(entry.goneAt, at);
      continue;
    }
    if (!isLivePageVerdict(verdict)) continue;
    entry.liveAt = Math.max(entry.liveAt, at);
    const resolvedKey = pageScopeKey(observation, verdict?.resolvedUrl, rowIdentities);
    if (resolvedKey) {
      const resolved = touch(resolvedKey);
      resolved.liveAt = Math.max(resolved.liveAt, at);
    }
    if (at >= (newestResolvedRead.get(key)?.at ?? -1)) {
      newestResolvedRead.set(key, { at, resolvedKey });
    }
  }
  for (const [key, read] of newestResolvedRead) {
    const requested = byPage.get(key);
    if (!read.resolvedKey || !requested || requested.goneAt <= requested.liveAt) continue;
    const resolved = touch(read.resolvedKey);
    resolved.goneAt = Math.max(resolved.goneAt, requested.goneAt);
  }
  return byPage;
}

export function withoutGoneLanePageObservations<T extends LanePageObservation>(
  observations: T[],
  rowIdentities: ReadonlySet<string>,
): LanePageHealthWithdrawal<T> {
  if (!observations.some((observation) => observation.field === LANE_PAGE_HEALTH_FIELD)) {
    return { observations, withdrawnValuesByField: new Map() };
  }
  const evidence = newestPageEvidence(observations, rowIdentities);
  const kept: T[] = [];
  const withdrawnValuesByField = new Map<string, unknown[]>();
  for (const observation of observations) {
    if (observation.field === LANE_PAGE_HEALTH_FIELD) continue;
    const key = pageScopeKey(observation, observation.sourceUrl, rowIdentities);
    const page = key ? evidence.get(key) : undefined;
    const withdrawn =
      page !== undefined &&
      page.goneAt > page.liveAt &&
      observedTime(observation.observedAt) < page.goneAt;
    if (!withdrawn) {
      kept.push(observation);
      continue;
    }
    const field = String(observation.field ?? '');
    withdrawnValuesByField.set(field, [
      ...(withdrawnValuesByField.get(field) ?? []),
      observation.value,
    ]);
  }
  return { observations: kept, withdrawnValuesByField };
}

function comparableValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : JSON.stringify(value ?? null);
}

const GONE_PAGE_BODY_FIELDS = ['description', 'fullDescription'] as const;

export function planGoneLanePageFieldClears(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  fieldsWithLiveObservation: ReadonlySet<string>;
  withdrawnValuesByField: ReadonlyMap<string, readonly unknown[]>;
  lockedFields: readonly string[];
  storedForm: (field: string, value: unknown) => unknown;
}): string[] {
  const clearable = (field: string) =>
    !input.lockedFields.includes(field) && !input.fieldsWithLiveObservation.has(field);
  const storedValue = (field: string) => {
    const stored = input.stored?.[field];
    return stored === undefined || stored === null || comparableValue(stored) === ''
      ? null
      : comparableValue(stored);
  };
  const storedFromGonePage = (field: string) => {
    const stored = storedValue(field);
    const withdrawn = input.withdrawnValuesByField.get(field) ?? [];
    return (
      stored !== null &&
      !(field in input.staged) &&
      clearable(field) &&
      withdrawn.some((value) => comparableValue(input.storedForm(field, value)) === stored)
    );
  };
  const clearedBodies = GONE_PAGE_BODY_FIELDS.filter(storedFromGonePage);
  const cardFollowsClearedBody =
    clearedBodies.includes('fullDescription') &&
    clearable('shortDescription') &&
    (storedValue('shortDescription') !== null || 'shortDescription' in input.staged);
  return cardFollowsClearedBody || storedFromGonePage('shortDescription')
    ? [...clearedBodies, 'shortDescription']
    : clearedBodies;
}
