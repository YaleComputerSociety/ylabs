import type mongoose from 'mongoose';
import { citationUrlsOf } from './sourceCitations';

/**
 * The write-side half of `hasLiveSourceCitation` (#6320).
 *
 * The gate reads a row with no citation at all as silence, which serves, and a row whose
 * every citation is dead as `all_citations_dead`, which holds. A writer that unsets the
 * last `fieldProvenance.<field>` stamp, or empties `sourceUrls`, turns the second state into
 * the first. The stored tier is only the last verdict and the next gate run recomputes it, so
 * a row held today is promoted by that run, and the rule does not read the tier. A writer
 * keeps the citation-carrying part of its write when that write would leave a row with none,
 * and still clears the field value: a kept dead stamp keeps the row held, and a kept live
 * stamp keeps what the row cited before.
 */
export interface CitationGuardedEntity {
  sourceUrls?: unknown;
  fieldProvenance?: unknown;
}

export interface CitationChange {
  set?: Record<string, unknown>;
  unset?: Record<string, unknown>;
  pull?: Record<string, unknown>;
}

export interface GuardedCitationChange {
  set: Record<string, unknown>;
  unset: Record<string, unknown>;
  pull: Record<string, unknown>;
  withheld: string[];
}

export const LAST_CITATION_GUARD_PROJECTION = 'sourceUrls fieldProvenance';

const PROVENANCE = 'fieldProvenance';
const SOURCE_URLS = 'sourceUrls';

const isProvenancePath = (path: string): boolean =>
  path === PROVENANCE || path.startsWith(`${PROVENANCE}.`);
const isSourceUrlsPath = (path: string): boolean =>
  path === SOURCE_URLS || path.startsWith(`${SOURCE_URLS}.`);

const plainRecord = (value: unknown): Record<string, unknown> => {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
  return {};
};

const has = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

function pulledUrls(urls: unknown, condition: unknown): unknown {
  if (!Array.isArray(urls)) return urls;
  if (condition && typeof condition === 'object' && Array.isArray((condition as any).$in)) {
    const removed = new Set((condition as { $in: unknown[] }).$in);
    return urls.filter((url) => !removed.has(url));
  }
  if (condition && typeof condition === 'object') return [];
  return urls.filter((url) => url !== condition);
}

function applyProvenancePath(
  provenance: Record<string, unknown>,
  path: string,
  value: unknown,
  removing: boolean,
): void {
  const [field, ...rest] = path.slice(PROVENANCE.length + 1).split('.');
  if (!field) return;
  if (rest.length === 0) {
    if (removing) delete provenance[field];
    else provenance[field] = value;
    return;
  }
  const entry = plainRecord(provenance[field]);
  const subPath = rest.join('.');
  if (removing) delete entry[subPath];
  else entry[subPath] = value;
  provenance[field] = entry;
}

function normalized(entity: CitationGuardedEntity): CitationGuardedEntity {
  return {
    sourceUrls: entity.sourceUrls,
    fieldProvenance:
      entity.fieldProvenance === undefined ? undefined : plainRecord(entity.fieldProvenance),
  };
}

/** The citation-bearing state the entity would hold once `change` is applied. */
export function citationStateAfter(
  entity: CitationGuardedEntity,
  change: CitationChange,
): CitationGuardedEntity {
  const set = change.set ?? {};
  const unset = change.unset ?? {};
  const pull = change.pull ?? {};
  const after = normalized(entity);
  if (has(unset, SOURCE_URLS)) after.sourceUrls = undefined;
  if (has(set, SOURCE_URLS)) after.sourceUrls = set[SOURCE_URLS];
  if (has(pull, SOURCE_URLS)) after.sourceUrls = pulledUrls(after.sourceUrls, pull[SOURCE_URLS]);
  if (has(unset, PROVENANCE)) after.fieldProvenance = undefined;
  if (has(set, PROVENANCE)) after.fieldProvenance = plainRecord(set[PROVENANCE]);
  const provenance = plainRecord(after.fieldProvenance);
  let provenanceTouched = false;
  for (const [path, value] of Object.entries(set)) {
    if (path === PROVENANCE || !isProvenancePath(path)) continue;
    applyProvenancePath(provenance, path, value, false);
    provenanceTouched = true;
  }
  for (const path of Object.keys(unset)) {
    if (path === PROVENANCE || !isProvenancePath(path)) continue;
    applyProvenancePath(provenance, path, undefined, true);
    provenanceTouched = true;
  }
  if (provenanceTouched || after.fieldProvenance !== undefined) after.fieldProvenance = provenance;
  return after;
}

/** True only when the entity cites something now and would cite nothing once `change` lands. */
export function wouldRemoveLastCitation(
  entity: CitationGuardedEntity,
  change: CitationChange,
): boolean {
  if (citationUrlsOf(normalized(entity)).length === 0) return false;
  return citationUrlsOf(citationStateAfter(entity, change)).length === 0;
}

const withoutPaths = (
  record: Record<string, unknown>,
  drop: (path: string, value: unknown) => boolean,
  withheld: string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([path, value]) => {
      if (!drop(path, value)) return true;
      withheld.push(path);
      return false;
    }),
  );

/**
 * `change` with its citation-removing parts withheld when it would remove the row's last
 * citation: the `fieldProvenance.*` unsets first, so the stamps stay; then, only if the row
 * would still cite nothing, the `sourceUrls` change; then any `fieldProvenance` set. Field
 * values are never withheld. `entity` is the stored row, read with at least
 * `LAST_CITATION_GUARD_PROJECTION`, so a key it lacks is absent from the row rather than unread.
 */
export function withholdLastCitationRemovals(
  entity: CitationGuardedEntity,
  change: CitationChange,
): GuardedCitationChange {
  let set = { ...(change.set ?? {}) };
  let unset = { ...(change.unset ?? {}) };
  let pull = { ...(change.pull ?? {}) };
  const withheld: string[] = [];
  const fires = () => wouldRemoveLastCitation(entity, { set, unset, pull });
  if (!fires()) return { set, unset, pull, withheld };
  unset = withoutPaths(unset, isProvenancePath, withheld);
  if (!fires()) return { set, unset, pull, withheld };
  set = withoutPaths(set, isSourceUrlsPath, withheld);
  unset = withoutPaths(unset, isSourceUrlsPath, withheld);
  pull = withoutPaths(pull, isSourceUrlsPath, withheld);
  if (!fires()) return { set, unset, pull, withheld };
  set = withoutPaths(set, isProvenancePath, withheld);
  return { set, unset, pull, withheld };
}

export type MongoUpdate = Record<string, unknown> & {
  $set?: Record<string, unknown>;
  $unset?: Record<string, unknown>;
  $pull?: Record<string, unknown>;
};

/** `withholdLastCitationRemovals` over a whole Mongo update document; other operators pass through. */
export function withholdLastCitationRemovalsFromUpdate(
  entity: CitationGuardedEntity,
  update: MongoUpdate,
): { update: MongoUpdate; withheld: string[] } {
  const { $set, $unset, $pull, ...rest } = update;
  const guarded = withholdLastCitationRemovals(entity, { set: $set, unset: $unset, pull: $pull });
  const next: MongoUpdate = { ...rest };
  if (Object.keys(guarded.set).length > 0) next.$set = guarded.set;
  if (Object.keys(guarded.unset).length > 0) next.$unset = guarded.unset;
  if (Object.keys(guarded.pull).length > 0) next.$pull = guarded.pull;
  return { update: next, withheld: guarded.withheld };
}

const isCitationStatePath = (path: string): boolean =>
  isProvenancePath(path) || isSourceUrlsPath(path);

const touchesCitationState = (update: MongoUpdate): boolean =>
  [update.$set, update.$unset, update.$pull].some((operator) =>
    Object.keys(operator ?? {}).some(isCitationStatePath),
  );

const matchAsRead = (value: unknown): unknown => (value === undefined ? { $exists: false } : value);

/**
 * A filter that matches the row only while every citation-bearing value the guard decided on
 * is still as read: `sourceUrls` exactly and each `fieldProvenance.<field>.sourceUrl`. A stamp added since the read only adds a citation, so it is not pinned.
 */
export function citationStateUnchangedFilter(
  row: CitationGuardedEntity & { _id?: unknown },
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    _id: row._id,
    [SOURCE_URLS]: matchAsRead(row.sourceUrls),
  };
  for (const [field, record] of Object.entries(plainRecord(row.fieldProvenance))) {
    const sourceUrl =
      record && typeof record === 'object'
        ? (record as { sourceUrl?: unknown }).sourceUrl
        : undefined;
    filter[`${PROVENANCE}.${field}.sourceUrl`] = matchAsRead(sourceUrl);
  }
  return filter;
}

/**
 * `Model.updateOne(filter, update)` with the last-citation rule applied against the row as
 * it stands now. Reading it fresh is what keeps a writer that clears several stamps on one
 * row in turn from removing the last one on the final write. A write that touches citation
 * state lands only if that state is still as read, so a concurrent change makes it a no-op
 * reporting `modifiedCount: 0` rather than a write decided on stale citations. A write left
 * with nothing to do is skipped.
 */
export async function updateOneKeepingLastCitation(
  model: mongoose.Model<any>,
  filter: Record<string, unknown>,
  update: MongoUpdate,
  options: mongoose.MongooseUpdateQueryOptions & { session?: mongoose.ClientSession } = {},
): Promise<{ modifiedCount: number; withheld: string[] }> {
  const current = await model
    .findOne(filter)
    .select(LAST_CITATION_GUARD_PROJECTION)
    .session(options.session ?? null)
    .lean<(CitationGuardedEntity & { _id?: unknown }) | null>();
  if (!current) return { modifiedCount: 0, withheld: [] };
  const guarded = withholdLastCitationRemovalsFromUpdate(current, update);
  if (Object.keys(guarded.update).length === 0) {
    return { modifiedCount: 0, withheld: guarded.withheld };
  }
  const writeFilter = touchesCitationState(guarded.update)
    ? { $and: [filter, citationStateUnchangedFilter(current)] }
    : { $and: [filter, { _id: current._id }] };
  const result = await model.updateOne(writeFilter, guarded.update, { ...options, upsert: false });
  return { modifiedCount: result.modifiedCount ?? 0, withheld: guarded.withheld };
}
