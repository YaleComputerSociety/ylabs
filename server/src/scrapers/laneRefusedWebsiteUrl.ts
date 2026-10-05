/**
 * A refusal is not an absence (#2647), so field retraction cannot withdraw a lane's
 * earlier `websiteUrl` when a later read refuses the link the page still carries. The
 * lane states the refusal as evidence instead, and on every resolve that newer read
 * wins over every older `websiteUrl` and `website` the lane asserted on the row, whatever the link,
 * without writing the observation log, so another lane's evidence still counts (#3926).
 */
import { websiteIdentity } from './survivorOwnedWebsiteClear';

export const REFUSED_WEBSITE_URL_FIELD = 'refusedWebsiteUrl';

export const LANE_WITHDRAWABLE_WEBSITE_FIELDS = ['website', 'websiteUrl'] as const;

export type LaneWithdrawableWebsiteField = (typeof LANE_WITHDRAWABLE_WEBSITE_FIELDS)[number];

const WITHDRAWABLE_FIELDS: ReadonlySet<string> = new Set(LANE_WITHDRAWABLE_WEBSITE_FIELDS);

const WEBSITE_STATING_FIELDS: ReadonlySet<string> = new Set([
  'website',
  'websiteUrl',
  'sourceUrls',
]);

type LaneWebsiteObservation = {
  sourceName?: unknown;
  field?: unknown;
  value?: unknown;
  observedAt?: unknown;
  entityKey?: unknown;
  entityId?: unknown;
};

export interface LaneRefusedWebsiteUrlWithdrawal<T> {
  observations: T[];
  withdrawnValues: unknown[];
}

function observedTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function identityScope(observation: LaneWebsiteObservation, rowIdentities: ReadonlySet<string>) {
  const forms = [observation.entityKey, observation.entityId]
    .map((form) => (form === undefined || form === null ? '' : String(form)))
    .filter(Boolean);
  if (forms.some((form) => rowIdentities.has(form))) return 'row';
  return forms[0] ?? '';
}

function laneScopeKey(observation: LaneWebsiteObservation, rowIdentities: ReadonlySet<string>) {
  return JSON.stringify([
    String(observation.sourceName ?? ''),
    identityScope(observation, rowIdentities),
  ]);
}

export function withoutLaneRefusedWebsiteUrls<T extends LaneWebsiteObservation>(
  observations: T[],
  rowIdentities: ReadonlySet<string>,
): LaneRefusedWebsiteUrlWithdrawal<T> {
  const newestRefusal = new Map<string, number>();
  for (const observation of observations) {
    if (observation.field !== REFUSED_WEBSITE_URL_FIELD) continue;
    if (!websiteIdentity(observation.value)) continue;
    const key = laneScopeKey(observation, rowIdentities);
    newestRefusal.set(
      key,
      Math.max(newestRefusal.get(key) ?? 0, observedTime(observation.observedAt)),
    );
  }
  if (newestRefusal.size === 0) return { observations, withdrawnValues: [] };

  const isSupersededByLaneRefusal = (observation: LaneWebsiteObservation): boolean => {
    const refusedAt = newestRefusal.get(laneScopeKey(observation, rowIdentities));
    return refusedAt !== undefined && observedTime(observation.observedAt) < refusedAt;
  };
  const isWithdrawnBySameLane = (observation: LaneWebsiteObservation): boolean =>
    WITHDRAWABLE_FIELDS.has(String(observation.field ?? '')) &&
    isSupersededByLaneRefusal(observation);
  const identitiesStillStatedBy = (observation: LaneWebsiteObservation): string[] => {
    if (!WEBSITE_STATING_FIELDS.has(String(observation.field ?? ''))) return [];
    if (isSupersededByLaneRefusal(observation)) return [];
    const values = Array.isArray(observation.value) ? observation.value : [observation.value];
    return values.map((value) => websiteIdentity(value)).filter(Boolean);
  };

  const kept: T[] = [];
  const withdrawn: T[] = [];
  for (const observation of observations) {
    if (observation.field === REFUSED_WEBSITE_URL_FIELD) continue;
    if (isWithdrawnBySameLane(observation)) withdrawn.push(observation);
    else kept.push(observation);
  }

  const stillStated = new Set<string>();
  for (const observation of kept) {
    for (const identity of identitiesStillStatedBy(observation)) stillStated.add(identity);
  }
  const withdrawnValues = withdrawn
    .map((observation) => observation.value)
    .filter((value) => !stillStated.has(websiteIdentity(value)));
  return { observations: kept, withdrawnValues };
}

export function isLaneWithdrawnWebsiteUrl(
  value: unknown,
  withdrawnValues: readonly unknown[],
): boolean {
  const identity = websiteIdentity(value);
  if (!identity) return false;
  return withdrawnValues.some((withdrawn) => websiteIdentity(withdrawn) === identity);
}

export function planLaneWithdrawnWebsiteUrlClear(input: {
  field: LaneWithdrawableWebsiteField;
  stored: Record<string, unknown> | null | undefined;
  staged: Record<string, unknown>;
  withdrawnValues: readonly unknown[];
  lockedFields: readonly string[];
}): boolean {
  if (input.lockedFields.includes(input.field)) return false;
  const current =
    input.field in input.staged ? input.staged[input.field] : input.stored?.[input.field];
  return isLaneWithdrawnWebsiteUrl(current, input.withdrawnValues);
}
