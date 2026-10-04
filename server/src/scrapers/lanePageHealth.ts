import {
  checkSourceLinkHealth,
  findSourceLinkHealth,
  sourceLinkHealthKey,
  type SourceLinkHealth,
} from '../services/sourceLinkHealth';
import { isBenchmarkReplayActive } from './snapshotBenchmarkMode';
import type { ObservationInput } from './types';

export const LANE_PAGE_HEALTH_FIELD = 'lanePageHealth';

export const LANE_PAGE_HEALTH_CLEARABLE_FIELDS = [
  'description',
  'shortDescription',
  'fullDescription',
] as const;

const GONE_HTTP_STATUS_CODES: ReadonlySet<number> = new Set([404, 410]);

export interface LanePageHealthVerdict {
  url: string;
  healthStatus: SourceLinkHealth['healthStatus'];
  httpStatusCode?: number;
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

export function lanePageReadVerdict(url: string, httpStatusCode = 200): LanePageHealthVerdict {
  return { url, healthStatus: 'HEALTHY', httpStatusCode };
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
  const touch = (key: string) => {
    const entry = byPage.get(key) ?? { goneAt: 0, liveAt: 0 };
    byPage.set(key, entry);
    return entry;
  };
  for (const observation of observations) {
    if (observation.field !== LANE_PAGE_HEALTH_FIELD) continue;
    const verdictUrl = (observation.value as { url?: unknown } | null | undefined)?.url;
    const key = pageScopeKey(observation, verdictUrl, rowIdentities);
    if (!key) continue;
    const at = observedTime(observation.observedAt);
    const entry = touch(key);
    if (isConfirmedGonePageVerdict(observation.value)) entry.goneAt = Math.max(entry.goneAt, at);
    else if (isLivePageVerdict(observation.value)) entry.liveAt = Math.max(entry.liveAt, at);
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

export function planGoneLanePageFieldClears(input: {
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  fieldsWithLiveObservation: ReadonlySet<string>;
  withdrawnValuesByField: ReadonlyMap<string, readonly unknown[]>;
  lockedFields: readonly string[];
}): string[] {
  return LANE_PAGE_HEALTH_CLEARABLE_FIELDS.filter((field) => {
    const withdrawn = input.withdrawnValuesByField.get(field);
    if (!withdrawn || withdrawn.length === 0) return false;
    if (input.lockedFields.includes(field)) return false;
    if (field in input.staged) return false;
    if (input.fieldsWithLiveObservation.has(field)) return false;
    const stored = input.stored?.[field];
    if (stored === undefined || stored === null || comparableValue(stored) === '') return false;
    return withdrawn.some((value) => comparableValue(value) === comparableValue(stored));
  });
}
