import {
  canonicalPersonPageUrlCandidate,
  isLegacyPersonPageUrl,
} from '../utils/yalePersonPagePrefix';

export interface LegacyPersonPageCandidate {
  entitySlug: string;
  entityName?: string;
  studentVisibilityTier?: string;
  deadUrl: string;
  candidateUrl: string;
  /** Whether the health lane had already condemned the original, or never visited it. */
  originalHealth: 'dead' | 'unverified';
}

export interface LegacyPersonPageRepairEntity {
  slug?: unknown;
  name?: unknown;
  studentVisibilityTier?: unknown;
  sourceUrls?: unknown;
  websiteUrl?: unknown;
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export type LegacyPersonPageHealth = 'dead' | 'healthy' | 'unverified';

/**
 * Every citation on a mapped host whose prefix the host has migrated away from,
 * paired with the candidate under the current prefix.
 *
 * A `healthy` legacy URL is left alone: these hosts did not retire the old prefix,
 * they run both, so 50 of the 71 stored legacy citations on Development still
 * resolve. Rewriting those would churn working links for nothing.
 *
 * An `unverified` legacy URL is planned anyway, because the caller probes every
 * candidate before adopting it and a missing verdict is absence of evidence rather
 * than evidence of health. Skipping them left 11 dead citations on `student_ready`
 * rows after the first pass, every one of them on a URL the health lane had simply
 * never visited (#2621).
 */
export function planLegacyPersonPageCandidates(
  entity: LegacyPersonPageRepairEntity,
  health: (url: string) => LegacyPersonPageHealth,
): LegacyPersonPageCandidate[] {
  const slug = typeof entity.slug === 'string' ? entity.slug : '';
  if (!slug) return [];
  const out: LegacyPersonPageCandidate[] = [];
  for (const url of stringEntries(entity.sourceUrls)) {
    if (health(url) === 'healthy') continue;
    if (!isLegacyPersonPageUrl(url)) continue;
    const candidateUrl = canonicalPersonPageUrlCandidate(url);
    if (!candidateUrl || candidateUrl === url) continue;
    out.push({
      entitySlug: slug,
      entityName: typeof entity.name === 'string' ? entity.name : undefined,
      studentVisibilityTier:
        typeof entity.studentVisibilityTier === 'string' ? entity.studentVisibilityTier : undefined,
      deadUrl: url,
      candidateUrl,
      originalHealth: health(url) === 'dead' ? 'dead' : 'unverified',
    });
  }
  return out;
}

const STOP_WORDS =
  /\b(faculty|research|lab|laboratory|group|center|centre|institute|initiative|program|programme|core|facility|the|of|and|for|studies|project)\b/gi;

export function personNameTokens(name: unknown): string[] {
  if (typeof name !== 'string') return [];
  return name
    .replace(STOP_WORDS, ' ')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

/**
 * The person tokens carried by a person-page URL's own leaf, which is the part the
 * rewrite preserves. Unlike an entity name, a leaf is always the full person slug:
 * an entity called "Baker Lab" yields one token, while its leaf `keith-baker`
 * yields two, and a short name like "Yu He" survives here because a leaf token is
 * not length-filtered.
 */
export function personTokensFromUrlLeaf(url: unknown): string[] {
  if (typeof url !== 'string') return [];
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const leaf = parts[parts.length - 1] || '';
    return leaf
      .toLowerCase()
      .replace(/[^a-z]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * A candidate is adopted only when the fetched page names the person. A status
 * code is not enough: `quantuminstitute.yale.edu` answers 200 for person pages
 * that do not exist, which is why that host is unmapped and why this check exists
 * even for mapped hosts (#2621).
 *
 * Matching is against the URL leaf rather than the entity name, because the leaf
 * is what the rewrite carried over and is reliably the person's full slug. The
 * entity name is accepted as a fallback so a leaf that is an opaque netid can
 * still be confirmed.
 */
export function pageTitleNamesPerson(
  title: unknown,
  entityName: unknown,
  candidateUrl?: unknown,
): boolean {
  if (typeof title !== 'string' || !title.trim()) return false;
  const haystack = title.toLowerCase().replace(/[^a-z]+/g, '');
  const leafTokens = personTokensFromUrlLeaf(candidateUrl);
  if (leafTokens.length >= 2 && leafTokens.every((token) => haystack.includes(token))) return true;
  const nameTokens = personNameTokens(entityName);
  if (nameTokens.length < 2) return false;
  return nameTokens.every((token) => haystack.includes(token));
}

export function isAdoptableProbe(
  probe: { status?: number; title?: string } | undefined,
  entityName: unknown,
  candidateUrl?: unknown,
): boolean {
  if (!probe) return false;
  if (typeof probe.status !== 'number' || probe.status < 200 || probe.status >= 400) return false;
  return pageTitleNamesPerson(probe.title, entityName, candidateUrl);
}
