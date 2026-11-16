import type mongoose from 'mongoose';
import { servesStudentVisibilityTier } from '../models/studentVisibility';
import { citationUrlsOf } from './sourceCitations';

/**
 * The write-side half of `hasLiveSourceCitation` (#6320).
 *
 * The gate reads a row with no citation at all as silence, which serves, and a row whose
 * every citation is dead as `all_citations_dead`, which holds. A writer that unsets the
 * last `fieldProvenance.<field>` stamp, or empties `sourceUrls`, on a served row turns the
 * second state into the first. So a writer keeps the citation-carrying part of its write
 * when that write would leave a served row with none, and still clears the field value: a
 * kept dead stamp keeps the row held, and a kept live stamp keeps what the row cited before.
 */
export interface CitationGuardedEntity {
  sourceUrls?: unknown;
  fieldProvenance?: unknown;
  studentVisibilityTier?: unknown;
  studentVisibilityOverrideTier?: unknown;
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

export const LAST_CITATION_GUARD_PROJECTION =
  'sourceUrls fieldProvenance studentVisibilityTier studentVisibilityOverrideTier';

const PROVENANCE = 'fieldProvenance';
const SOURCE_URLS = 'sourceUrls';
const TIER_FIELDS = ['studentVisibilityTier', 'studentVisibilityOverrideTier'] as const;

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
    studentVisibilityTier: entity.studentVisibilityTier,
    studentVisibilityOverrideTier: entity.studentVisibilityOverrideTier,
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
  for (const field of TIER_FIELDS) {
    if (has(unset, field)) after[field] = undefined;
    if (has(set, field)) after[field] = set[field];
  }
  return after;
}

/**
 * True only when the entity is served (before or after the write, so a write that also
 * releases a hold counts), cites something now, and would cite nothing once `change` lands.
 */
export function wouldRemoveLastCitation(
  entity: CitationGuardedEntity,
  change: CitationChange,
): boolean {
  const after = citationStateAfter(entity, change);
  const served =
    servesStudentVisibilityTier(entity as Record<string, unknown>) ||
    servesStudentVisibilityTier(after as Record<string, unknown>);
  if (!served) return false;
  if (citationUrlsOf(normalized(entity)).length === 0) return false;
  return citationUrlsOf(after).length === 0;
}

/**
 * Whether `entity` carries every field the rule reads. A projected or partial read cannot
 * say what the row cites, so the guard treats it as unverifiable rather than as citing nothing.
 */
export function citationStateIsReadable(entity: unknown): entity is CitationGuardedEntity {
  if (!entity || typeof entity !== 'object') return false;
  const record = entity as Record<string, unknown>;
  return has(record, SOURCE_URLS) && has(record, PROVENANCE) && has(record, TIER_FIELDS[0]);
}

const withoutPaths = (
  record: Record<string, unknown>,
  drop: (path: string) => boolean,
  withheld: string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([path]) => {
      if (!drop(path)) return true;
      withheld.push(path);
      return false;
    }),
  );

/**
 * `change` with its citation-removing parts withheld when it would remove a served row's last
 * citation: the `fieldProvenance.*` unsets first, so the stamps stay; then, only if the row
 * would still cite nothing, the `sourceUrls` change; then any `fieldProvenance` set. Field
 * values are never withheld. An unreadable entity has its provenance unsets withheld outright.
 */
export function withholdLastCitationRemovals(
  entity: unknown,
  change: CitationChange,
): GuardedCitationChange {
  let set = { ...(change.set ?? {}) };
  let unset = { ...(change.unset ?? {}) };
  let pull = { ...(change.pull ?? {}) };
  const withheld: string[] = [];
  if (!citationStateIsReadable(entity)) {
    unset = withoutPaths(unset, isProvenancePath, withheld);
    return { set, unset, pull, withheld };
  }
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
  entity: unknown,
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

/**
 * A fresh read that selected every guarded field is authoritative, so a key it lacks is
 * absent from the stored row rather than unread. No row at all stays unverifiable.
 */
export const storedCitationState = (
  row: CitationGuardedEntity | null | undefined,
): CitationGuardedEntity | null =>
  row
    ? {
        sourceUrls: row.sourceUrls,
        fieldProvenance: row.fieldProvenance,
        studentVisibilityTier: row.studentVisibilityTier,
        studentVisibilityOverrideTier: row.studentVisibilityOverrideTier,
      }
    : null;

/**
 * `Model.updateOne(filter, update)` with the last-citation rule applied against the row as
 * it stands now. Reading it fresh is what keeps a writer that clears several stamps on one
 * row in turn from removing the last one on the final write. A write left with nothing to
 * do is skipped.
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
    .lean<CitationGuardedEntity | null>();
  if (!current) return { modifiedCount: 0, withheld: [] };
  const guarded = withholdLastCitationRemovalsFromUpdate(storedCitationState(current), update);
  if (Object.keys(guarded.update).length === 0) {
    return { modifiedCount: 0, withheld: guarded.withheld };
  }
  const result = await model.updateOne(filter, guarded.update, options);
  return { modifiedCount: result.modifiedCount ?? 0, withheld: guarded.withheld };
}
