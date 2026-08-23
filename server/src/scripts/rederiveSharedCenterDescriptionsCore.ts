export const SHARED_GENERIC_ORG_KINDS = ['center', 'institute', 'program', 'initiative'] as const;

export type SharedGenericRewriteAction = 're-derived' | 'cleared';

export interface SharedGenericEntityInput {
  id: string;
  slug?: string;
  kind?: unknown;
  fullDescription?: unknown;
  fieldProvenance?: Record<string, unknown> | null;
}

export interface ReDerivedDescription {
  fullDescription: string;
  shortDescription: string;
}

export interface SharedGenericRewritePlan {
  set: Record<string, string>;
  action: SharedGenericRewriteAction;
  hasWrites: boolean;
}

const MIN_SHARED_DESCRIPTION_LENGTH = 40;

export function normalizeDescriptionKey(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : '';
}

export function hasFullDescriptionProvenance(
  fieldProvenance: Record<string, unknown> | null | undefined,
): boolean {
  return Boolean(fieldProvenance && fieldProvenance.fullDescription !== undefined);
}

/**
 * Normalized fullDescription keys that appear on two or more DISTINCT active
 * entities. A description shared verbatim across different research entities is
 * a mis-scrape, not genuine shared-umbrella copy.
 */
export function sharedFullDescriptionKeys(entities: SharedGenericEntityInput[]): Set<string> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    const key = normalizeDescriptionKey(entity.fullDescription);
    if (key.length < MIN_SHARED_DESCRIPTION_LENGTH) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function isOrgKind(kind: unknown): boolean {
  return (
    typeof kind === 'string' &&
    (SHARED_GENERIC_ORG_KINDS as readonly string[]).includes(kind)
  );
}

/**
 * Organization-kind entities whose fullDescription is (a) shared verbatim with
 * another active entity and (b) carries no per-field provenance - the signature
 * of a stale pre-provenance mis-scrape (#1056). Requires BOTH signals so a
 * legitimately provenance-tracked description is never touched.
 */
export function selectSharedGenericTargets(
  entities: SharedGenericEntityInput[],
): SharedGenericEntityInput[] {
  const shared = sharedFullDescriptionKeys(entities);
  return entities.filter(
    (entity) =>
      isOrgKind(entity.kind) &&
      !hasFullDescriptionProvenance(entity.fieldProvenance) &&
      shared.has(normalizeDescriptionKey(entity.fullDescription)),
  );
}

/**
 * Replace a re-derived, source-backed description when one is available;
 * otherwise clear the shared generic text so it stops misrepresenting the
 * entity. A cleared entity drops out of student-ready via the visibility gate
 * rather than presenting wrong shared copy.
 */
export function planSharedGenericRewrite(
  reDerived: ReDerivedDescription | null,
): SharedGenericRewritePlan {
  if (reDerived && reDerived.fullDescription) {
    return {
      set: {
        fullDescription: reDerived.fullDescription,
        shortDescription: reDerived.shortDescription || '',
      },
      action: 're-derived',
      hasWrites: true,
    };
  }
  return {
    set: { fullDescription: '', shortDescription: '' },
    action: 'cleared',
    hasWrites: true,
  };
}
