import { citationDestination, personPageMirrorKey } from './auditPersonPageCitationMirrorsCore';

export interface MirroredCitationRow {
  _id?: unknown;
  slug: string;
  entityType?: string;
  sourceUrls?: unknown;
  fieldProvenance?: Record<string, unknown>;
  sourceLinkHealth?: unknown;
}

export interface MirroredCitationGroupPlan {
  host: string;
  /** Paths only. A full URL would pair a person's name with a defect judgement. */
  keepPath: string;
  dropPaths: string[];
}

export interface MirroredCitationRowPlan {
  slug: string;
  entityType?: string;
  groups: MirroredCitationGroupPlan[];
  sourceUrls: string[];
  droppedUrls: string[];
  provenanceRepoint: Record<string, string>;
  droppedLinkHealthUrls: string[];
  keptUrlsAwaitingReprobe: string[];
  refusal?: 'would-empty-citations';
}

export interface MirroredCitationCollapsePlan {
  rowsRead: number;
  rowsPlanned: number;
  rowsRefused: number;
  citationsDropped: number;
  provenanceFieldsRepointed: number;
  linkHealthEntriesDropped: number;
  keptUrlsAwaitingReprobe: number;
  rows: MirroredCitationRowPlan[];
}

const pathOf = (url: string): string => {
  const destination = citationDestination(url);
  return destination ? destination.slice(destination.indexOf('/')) : url;
};

const pathSegmentCount = (url: string): number => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

/**
 * The same preference `isMoreCanonicalSourceUrl` applies at render time in
 * client/src/utils/researchDetailSources.ts: https over http, then the shallower path.
 * Keeping the spelling the page already displays is what makes this collapse invisible to
 * a student, rather than a silent change of which URL they are offered.
 *
 * The last comparison is lexicographic rather than a tie-break on stored order, because a
 * repair whose survivor depends on array order is not idempotent: an unrelated write that
 * reorders `sourceUrls` would make a re-run pick a different one and churn the row again.
 */
export const mostCanonicalMirroredCitation = (urls: readonly string[]): string =>
  [...urls].sort((left, right) => {
    const httpsDelta = Number(right.startsWith('https://')) - Number(left.startsWith('https://'));
    if (httpsDelta !== 0) return httpsDelta;
    const depthDelta = pathSegmentCount(left) - pathSegmentCount(right);
    if (depthDelta !== 0) return depthDelta;
    const lengthDelta = left.length - right.length;
    if (lengthDelta !== 0) return lengthDelta;
    return left < right ? -1 : left > right ? 1 : 0;
  })[0];

const citationUrls = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (url): url is string => typeof url === 'string' && url.trim().length > 0,
  );

const recordedHealthUrls = (value: unknown): Set<string> =>
  new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => (entry as { url?: unknown })?.url)
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
      .map((url) => url.trim()),
  );

export interface MirroredCitationGroup {
  keep: string;
  drops: string[];
}

export const mirroredCitationGroups = (value: unknown): MirroredCitationGroup[] => {
  const byMirrorKey = new Map<string, string[]>();
  for (const url of citationUrls(value)) {
    const key = personPageMirrorKey(url);
    if (!key) continue;
    const bucket = byMirrorKey.get(key);
    if (bucket) {
      if (!bucket.includes(url)) bucket.push(url);
    } else {
      byMirrorKey.set(key, [url]);
    }
  }
  const groups: MirroredCitationGroup[] = [];
  for (const bucket of byMirrorKey.values()) {
    if (bucket.length < 2) continue;
    const keep = mostCanonicalMirroredCitation(bucket);
    groups.push({ keep, drops: bucket.filter((url) => url !== keep) });
  }
  return groups;
};

export const planMirroredCitationCollapseRow = (
  row: MirroredCitationRow,
): MirroredCitationRowPlan | undefined => {
  const urls = citationUrls(row.sourceUrls);
  const groups = mirroredCitationGroups(row.sourceUrls);
  if (groups.length === 0) return undefined;

  const keptForDropped = new Map<string, string>();
  for (const group of groups) for (const url of group.drops) keptForDropped.set(url, group.keep);
  const dropped = [...keptForDropped.keys()];
  const remaining = urls.filter((url) => !keptForDropped.has(url));

  const provenanceRepoint: Record<string, string> = {};
  for (const [field, entry] of Object.entries(row.fieldProvenance || {})) {
    const sourceUrl = (entry as { sourceUrl?: unknown })?.sourceUrl;
    if (typeof sourceUrl !== 'string') continue;
    const keep = keptForDropped.get(sourceUrl.trim());
    if (keep) provenanceRepoint[`fieldProvenance.${field}.sourceUrl`] = keep;
  }

  const health = recordedHealthUrls(row.sourceLinkHealth);
  const droppedLinkHealthUrls = dropped.filter((url) => health.has(url));
  const keptUrlsAwaitingReprobe = groups
    .filter((group) => !health.has(group.keep) && group.drops.some((url) => health.has(url)))
    .map((group) => group.keep);

  return {
    slug: row.slug,
    entityType: row.entityType,
    groups: groups.map((group) => ({
      host: (citationDestination(group.keep) || '').split('/')[0],
      keepPath: pathOf(group.keep),
      dropPaths: group.drops.map(pathOf),
    })),
    sourceUrls: remaining,
    droppedUrls: dropped,
    provenanceRepoint,
    droppedLinkHealthUrls,
    keptUrlsAwaitingReprobe,
    ...(remaining.length === 0 ? { refusal: 'would-empty-citations' as const } : {}),
  };
};

export const planMirroredCitationCollapse = (
  rows: Iterable<MirroredCitationRow>,
): MirroredCitationCollapsePlan => {
  const plan: MirroredCitationCollapsePlan = {
    rowsRead: 0,
    rowsPlanned: 0,
    rowsRefused: 0,
    citationsDropped: 0,
    provenanceFieldsRepointed: 0,
    linkHealthEntriesDropped: 0,
    keptUrlsAwaitingReprobe: 0,
    rows: [],
  };

  for (const row of rows) {
    plan.rowsRead += 1;
    const rowPlan = planMirroredCitationCollapseRow(row);
    if (!rowPlan) continue;
    plan.rows.push(rowPlan);
    if (rowPlan.refusal) {
      plan.rowsRefused += 1;
      continue;
    }
    plan.rowsPlanned += 1;
    plan.citationsDropped += rowPlan.droppedUrls.length;
    plan.provenanceFieldsRepointed += Object.keys(rowPlan.provenanceRepoint).length;
    plan.linkHealthEntriesDropped += rowPlan.droppedLinkHealthUrls.length;
    plan.keptUrlsAwaitingReprobe += rowPlan.keptUrlsAwaitingReprobe.length;
  }

  return plan;
};

export const formatMirroredCitationCollapsePlan = (
  plan: MirroredCitationCollapsePlan,
  mode: 'dry-run' | 'apply',
): string =>
  [
    `mode:                               ${mode}`,
    `rows read:                          ${plan.rowsRead}`,
    `rows to collapse:                   ${plan.rowsPlanned}`,
    `rows refused:                       ${plan.rowsRefused}`,
    `citations dropped:                  ${plan.citationsDropped}`,
    `provenance fields repointed:        ${plan.provenanceFieldsRepointed}`,
    `link-health entries dropped:        ${plan.linkHealthEntriesDropped}`,
    `kept URLs left awaiting a re-probe: ${plan.keptUrlsAwaitingReprobe}`,
  ].join('\n');
