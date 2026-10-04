import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import {
  checkSourceLinkHealth,
  findSourceLinkHealth,
  landsAwayFromRequestedResource,
  sourceLinkHealthKey,
  type SourceLinkHealth,
} from '../services/sourceLinkHealth';
import { isBenchmarkModeActive, isBenchmarkReplayActive } from './snapshotBenchmarkMode';
import type { ObservationInput, ScraperContext } from './types';

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

export function goneLanePageKeys(
  observations: readonly LanePageObservation[],
  rowIdentities: ReadonlySet<string>,
): Set<string> {
  const gone = new Set<string>();
  for (const [key, page] of newestPageEvidence(observations, rowIdentities)) {
    if (page.goneAt > page.liveAt) gone.add((JSON.parse(key) as string[])[2]);
  }
  return gone;
}

export async function loadLanePageHealthObservations(
  sourceName: string,
  entity: Pick<ObservationInput, 'entityType' | 'entityId' | 'entityKey'>,
): Promise<LanePageObservation[]> {
  if (!entity.entityId && !entity.entityKey) return [];
  if (isBenchmarkModeActive() || mongoose.connection.readyState !== 1) return [];
  return Observation.find({
    entityType: entity.entityType,
    sourceName,
    field: LANE_PAGE_HEALTH_FIELD,
    superseded: false,
    ...(entity.entityId ? { entityId: entity.entityId } : { entityKey: entity.entityKey }),
  })
    .select('sourceName field value sourceUrl observedAt entityKey entityId')
    .lean<LanePageObservation[]>();
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

export class LanePageReads {
  readonly reads = new Map<string, { url: string; resolvedUrl: string }>();
  readonly failures = new Map<string, { url: string; httpStatusCode?: number }>();

  recordRead(url: string, resolvedUrl: string = url): void {
    const key = sourceLinkHealthKey(url);
    if (!key || landsAwayFromRequestedResource(url, resolvedUrl)) return;
    this.failures.delete(key);
    this.reads.set(key, { url, resolvedUrl });
  }

  recordFailure(url: string, error: unknown): void {
    const key = sourceLinkHealthKey(url);
    if (!key || this.reads.has(key)) return;
    this.failures.set(key, { url, httpStatusCode: fetchFailureHttpStatus(error) });
  }
}

type CitedLaneObservation = LanePageObservation & { scrapeRunId?: unknown };

interface CitingRow {
  identity: Pick<ObservationInput, 'entityType' | 'entityId' | 'entityKey'>;
  observations: CitedLaneObservation[];
}

export interface CitedLanePageHealthResult {
  gone: number;
  restored: number;
}

function identityForm(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function citingRowsOf(observations: readonly CitedLaneObservation[]): Map<string, CitingRow> {
  const rows = new Map<string, CitingRow>();
  for (const observation of observations) {
    const entityKey = identityForm(observation.entityKey);
    const entityId = identityForm(observation.entityId);
    if (!entityKey && !entityId) continue;
    const key = JSON.stringify([entityKey, entityId]);
    const row = rows.get(key) ?? {
      identity: {
        entityType: 'researchEntity',
        ...(entityId ? { entityId } : {}),
        ...(entityKey ? { entityKey } : {}),
      },
      observations: [],
    };
    row.observations.push(observation);
    rows.set(key, row);
  }
  return rows;
}

export type CitedLanePageScope =
  { entityKeys: readonly string[] } | { sourceUrls: readonly string[] };

function scopeFilter(scope: CitedLanePageScope | undefined): Record<string, unknown> {
  if (!scope) return {};
  return 'entityKeys' in scope
    ? { entityKey: { $in: [...scope.entityKeys] } }
    : { sourceUrl: { $in: [...scope.sourceUrls] } };
}

async function storedHealthByIdentity(rows: Iterable<CitingRow>) {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const { identity } of rows) {
    if (identity.entityId && mongoose.isValidObjectId(identity.entityId))
      ids.add(identity.entityId);
    if (identity.entityKey) slugs.add(identity.entityKey);
  }
  const stored = await ResearchEntity.find({
    $or: [{ _id: { $in: [...ids] } }, { slug: { $in: [...slugs] } }],
  })
    .select('_id slug sourceLinkHealth')
    .lean<Array<{ _id: unknown; slug?: string; sourceLinkHealth?: unknown }>>();
  const byIdentity = new Map<string, { identities: Set<string>; sourceLinkHealth?: unknown }>();
  for (const row of stored) {
    const entry = {
      identities: new Set([String(row._id), row.slug ?? ''].filter(Boolean)),
      sourceLinkHealth: row.sourceLinkHealth,
    };
    byIdentity.set(String(row._id), entry);
    if (row.slug) byIdentity.set(row.slug, entry);
  }
  return byIdentity;
}

function memoizedProbe(probe: LanePageProbe): LanePageProbe {
  const answers = new Map<string, Promise<SourceLinkHealth>>();
  return (url) => {
    const key = sourceLinkHealthKey(url) ?? url;
    const answer = answers.get(key) ?? probe(url);
    answers.set(key, answer);
    return answer;
  };
}

export async function emitLanePageHealthForCitedPages(
  ctx: Pick<ScraperContext, 'sourceName' | 'scrapeRunId' | 'emit' | 'log'>,
  pageReads: LanePageReads = new LanePageReads(),
  probe: LanePageProbe = checkSourceLinkHealth,
  scope?: CitedLanePageScope,
): Promise<CitedLanePageHealthResult> {
  const result: CitedLanePageHealthResult = { gone: 0, restored: 0 };
  if (isBenchmarkModeActive() || mongoose.connection.readyState !== 1) return result;
  const cited = await Observation.find({
    sourceName: ctx.sourceName,
    entityType: 'researchEntity',
    superseded: false,
    sourceUrl: { $type: 'string', $ne: '' },
    ...scopeFilter(scope),
  })
    .select('sourceName field value sourceUrl observedAt entityKey entityId scrapeRunId')
    .lean<CitedLaneObservation[]>();
  const rows = citingRowsOf(cited);
  if (rows.size === 0) return result;
  const storedHealth = await storedHealthByIdentity(rows.values());
  const confirmingProbe = memoizedProbe(probe);
  const verdicts: ObservationInput[] = [];
  for (const row of rows.values()) {
    const stored =
      storedHealth.get(identityForm(row.identity.entityId)) ??
      storedHealth.get(identityForm(row.identity.entityKey));
    const rowIdentities =
      stored?.identities ??
      new Set([row.identity.entityId, row.identity.entityKey].filter(Boolean) as string[]);
    const gonePages = goneLanePageKeys(row.observations, rowIdentities);
    const pagesCitedThisRun = new Set(
      row.observations
        .filter((observation) => String(observation.scrapeRunId ?? '') === ctx.scrapeRunId)
        .map((observation) => sourceLinkHealthKey(observation.sourceUrl)),
    );
    const stillCounted = withoutGoneLanePageObservations(row.observations, rowIdentities);
    const pages = new Map<string, string>();
    for (const observation of row.observations) {
      if (observation.field === LANE_PAGE_HEALTH_FIELD) continue;
      const key = sourceLinkHealthKey(observation.sourceUrl);
      if (key && !pages.has(key)) pages.set(key, String(observation.sourceUrl));
    }
    const countedPages = new Set(
      stillCounted.observations
        .filter((observation) => observation.field !== LANE_PAGE_HEALTH_FIELD)
        .map((observation) => sourceLinkHealthKey(observation.sourceUrl)),
    );
    for (const [page, url] of pages) {
      const read = pageReads.reads.get(page);
      if (read) {
        if (!gonePages.has(page)) continue;
        verdicts.push(
          lanePageHealthObservation(row.identity, lanePageReadVerdict(url, read.resolvedUrl)),
        );
        result.restored += 1;
        continue;
      }
      if (!countedPages.has(page) || pagesCitedThisRun.has(page)) continue;
      const verdict = await confirmGoneLanePage(
        url,
        {
          httpStatusCode: pageReads.failures.get(page)?.httpStatusCode,
          storedHealth: stored?.sourceLinkHealth,
        },
        confirmingProbe,
      );
      if (!verdict) continue;
      verdicts.push(lanePageHealthObservation(row.identity, verdict));
      result.gone += 1;
    }
  }
  if (verdicts.length > 0) await ctx.emit(verdicts);
  ctx.log(
    `[lane-page-health] ${result.gone} gone and ${result.restored} restored page verdict(s) across ${rows.size} citing row(s)`,
  );
  return result;
}
