import type { ObservationInput } from '../scrapers/types';
import { websiteIdentity } from '../scrapers/survivorOwnedWebsiteClear';
import { isPromotableWebsiteUrl } from './backfillResearchEntityWebsiteUrlsCore';

export const OPERATOR_LED_GROUP_VERDICT_SOURCE = 'operator-led-group-verdict';

/**
 * Above the 0.96 the profile-linked research-home lane asserts, because the verdict is a
 * person's judgement about this row after reading the group's own pages, and the lane is
 * the rule that could not reach it.
 */
export const OPERATOR_LED_GROUP_VERDICT_CONFIDENCE = 0.97;

const VERDICT_FIELDS = ['name', 'displayName', 'websiteUrl', 'website', 'entityType', 'kind'];

const GROUP_NOUN_RE = /\b(?:lab|labs|laboratory|group|team|unit)\b/i;

export interface LedGroupSiteRow {
  _id?: unknown;
  slug: string;
  name?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  manuallyLockedFields?: unknown;
  /** Other live rows whose stored `websiteUrl` is the verdict's site. */
  rowsServingTheSite: number;
}

export interface LedGroupSiteVerdict {
  siteUrl: string;
  name: string;
  evidenceUrls: string[];
}

export type LedGroupSiteRefusal =
  | 'manually-locked'
  | 'name-is-not-a-group'
  | 'site-is-not-promotable'
  | 'another-row-serves-the-site'
  | 'already-the-verdict';

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * The observations recording an operator's verdict that this row's lead runs the named
 * group whose own site this is.
 *
 * Observations rather than a field write, and no lock, so every later resolve re-derives
 * the same answer from the verdict: a written field sticks only behind a lock, and a lock
 * is the one form of correction the evidence contract rules out.
 */
export function planLedGroupSiteVerdict(
  row: LedGroupSiteRow,
  verdict: LedGroupSiteVerdict,
): { observations: ObservationInput[] } | { refused: LedGroupSiteRefusal } {
  const locked = Array.isArray(row.manuallyLockedFields)
    ? row.manuallyLockedFields.filter((field) => VERDICT_FIELDS.includes(String(field)))
    : [];
  if (locked.length > 0) return { refused: 'manually-locked' };

  const name = textValue(verdict.name);
  if (!GROUP_NOUN_RE.test(name)) return { refused: 'name-is-not-a-group' };

  const siteUrl = textValue(verdict.siteUrl);
  if (!isPromotableWebsiteUrl(siteUrl, { entityType: 'LAB', kind: 'lab', name })) {
    return { refused: 'site-is-not-promotable' };
  }
  if (row.rowsServingTheSite > 0) return { refused: 'another-row-serves-the-site' };
  if (
    websiteIdentity(row.websiteUrl) === websiteIdentity(siteUrl) &&
    textValue(row.name) === name
  ) {
    return { refused: 'already-the-verdict' };
  }

  const evidenceUrl = textValue(verdict.evidenceUrls[0]);
  const entityId = textValue(row._id === undefined ? '' : String(row._id));
  const cited = Array.isArray(row.sourceUrls)
    ? row.sourceUrls.filter((url): url is string => typeof url === 'string')
    : [];
  const sourceUrls = Array.from(
    new Set([...cited, ...verdict.evidenceUrls.map(textValue).filter(Boolean), siteUrl]),
  );
  const base = {
    entityType: 'researchEntity' as const,
    ...(entityId ? { entityId } : {}),
    entityKey: row.slug,
    sourceUrl: evidenceUrl,
    confidenceOverride: OPERATOR_LED_GROUP_VERDICT_CONFIDENCE,
  };
  return {
    observations: [
      { ...base, field: 'name', value: name },
      { ...base, field: 'displayName', value: name },
      { ...base, field: 'kind', value: 'lab' },
      { ...base, field: 'entityType', value: 'LAB' },
      { ...base, field: 'website', value: siteUrl },
      { ...base, field: 'websiteUrl', value: siteUrl },
      { ...base, field: 'sourceUrls', value: sourceUrls },
    ],
  };
}
