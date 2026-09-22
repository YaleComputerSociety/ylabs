/**
 * Planner for `observations:retire-deploy-host-citations`.
 *
 * Selects observations cited to a host a platform assigns to a deploy target, using
 * the same `isEphemeralDeployHostUrl` predicate that refuses them at ingest, so the
 * repair and the guard cannot drift apart.
 *
 * The lane the defect came from is NOT part of the predicate. #2805's triage proposed
 * "dept-faculty-roster observations whose sourceUrl host is not a yale.edu host",
 * which reads 239 active rows on Development, of which 139 are the lane legitimately
 * quoting a professor's own site (bio, website, imageUrl on hosts like a personal
 * `.org`). Retracting those would destroy real evidence to reach 100 bad rows, so the
 * predicate asks about the HOST's durability rather than about the lane.
 */
import { isEphemeralDeployHostUrl } from '../utils/urlSafety';

export const DEPLOY_HOST_CITATION_ROLLBACK_REASON =
  'retired: cited to a platform-assigned deploy host, which names a build rather than a durable page (#2805)';

export const CONFIRM_RETIRE_DEPLOY_HOST_CITATIONS = '--confirm-retire-deploy-host-citations';

export interface DeployHostCitationRow {
  id: string;
  sourceName: string;
  sourceUrl?: string;
  field: string;
  entityType: string;
  entityKey?: string;
  superseded?: boolean;
  alreadyRolledBack?: boolean;
}

/**
 * `active` rows go through `retireObservations`, which both supersedes and stamps the
 * rollback. `supersededOnly` rows need the rollback stamp on its own: supersession
 * hides a row from the default read scope but NOT from the lossless-ingest read scope,
 * which selects on `rollback.rolledBackAt` instead, so stamping only the active rows
 * would leave the other 96 eligible again the moment that flag is turned on.
 */
export interface DeployHostCitationPlan {
  scanned: number;
  active: DeployHostCitationRow[];
  supersededOnly: DeployHostCitationRow[];
  alreadyRetired: number;
  byHost: Array<[string, number]>;
  byLaneField: Array<[string, number]>;
}

export function deployHostOf(sourceUrl: unknown): string | null {
  if (!isEphemeralDeployHostUrl(sourceUrl)) return null;
  return new URL(String(sourceUrl).trim()).hostname.toLowerCase();
}

export function planDeployHostCitationRetirement(
  rows: DeployHostCitationRow[],
): DeployHostCitationPlan {
  const active: DeployHostCitationRow[] = [];
  const supersededOnly: DeployHostCitationRow[] = [];
  let alreadyRetired = 0;
  const byHost = new Map<string, number>();
  const byLaneField = new Map<string, number>();

  for (const row of rows) {
    const host = deployHostOf(row.sourceUrl);
    if (!host) continue;
    byHost.set(host, (byHost.get(host) || 0) + 1);
    const laneField = `${row.sourceName}/${row.field}`;
    byLaneField.set(laneField, (byLaneField.get(laneField) || 0) + 1);
    if (row.alreadyRolledBack) alreadyRetired += 1;
    else if (row.superseded) supersededOnly.push(row);
    else active.push(row);
  }

  const descending = (left: [string, number], right: [string, number]) => right[1] - left[1];
  return {
    scanned: rows.length,
    active,
    supersededOnly,
    alreadyRetired,
    byHost: [...byHost.entries()].sort(descending),
    byLaneField: [...byLaneField.entries()].sort(descending),
  };
}

/**
 * `--limit` is a cap on rows written by one apply, so the two write sets share a single
 * budget. Slicing each set to the limit independently would let `--limit=25` mutate 50
 * rows, which is not what a blast-radius cap means.
 */
export function budgetDeployHostCitationWrites(
  plan: DeployHostCitationPlan,
  limit?: number,
): { active: DeployHostCitationRow[]; supersededOnly: DeployHostCitationRow[] } {
  if (!limit) return { active: plan.active, supersededOnly: plan.supersededOnly };
  const active = plan.active.slice(0, limit);
  return {
    active,
    supersededOnly: plan.supersededOnly.slice(0, Math.max(0, limit - active.length)),
  };
}

/**
 * Counted by re-judging each row with the predicate, never by the Mongo prefilter that
 * selected it. The prefilter is an unanchored substring match, so it also matches a
 * durable host that merely contains a deploy domain (`notondigitalocean.app`) or carries
 * one in a path; counting the superset would report a complete repair as incomplete.
 */
export function countDeployHostCitations(rows: DeployHostCitationRow[]): {
  active: number;
  inReadScope: number;
} {
  const citations = rows.filter((row) => deployHostOf(row.sourceUrl) !== null);
  return {
    active: citations.filter((row) => row.superseded !== true).length,
    inReadScope: citations.filter((row) => !row.alreadyRolledBack).length,
  };
}

export interface DeployHostEntityUrlRow {
  id: string;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

/**
 * Retiring the citations does not rewrite the materialized entity fields, which
 * `sanitizeResearchEntitySourceUrlsForMaterialization` only revisits on the entity's next
 * pass. An operator reading the apply report needs to see that separately from the
 * Observation counts, because a still-stored deploy host is what keeps the visibility
 * repair queue refusing to invent evidence for that entity (#2805).
 */
export function countDeployHostEntityUrls(rows: DeployHostEntityUrlRow[]): {
  entities: number;
  websiteUrl: number;
  sourceUrls: number;
} {
  let entities = 0;
  let websiteUrl = 0;
  let sourceUrls = 0;
  for (const row of rows) {
    const storedWebsiteUrl = deployHostOf(row.websiteUrl) !== null;
    const storedSourceUrls = (Array.isArray(row.sourceUrls) ? row.sourceUrls : []).some(
      (url) => deployHostOf(url) !== null,
    );
    if (storedWebsiteUrl) websiteUrl += 1;
    if (storedSourceUrls) sourceUrls += 1;
    if (storedWebsiteUrl || storedSourceUrls) entities += 1;
  }
  return { entities, websiteUrl, sourceUrls };
}
