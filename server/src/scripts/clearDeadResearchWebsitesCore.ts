/**
 * Which served rows publish a research website the corpus positively knows is gone,
 * and which of them this pass may touch (#3309).
 *
 * A row's website is not a citation, so #3267's serve-time withhold is the wrong
 * instrument: `websiteUrl` is a gate input, and stripping a served field without a
 * re-gate leaves the row serving on a tier computed while it still had one. The value
 * is therefore cleared as stored data and the ordinary gate decides the tier.
 *
 * Fails closed four ways, and the first two are the ones that have cost rows before.
 * An operator lock on the field is never reversed, and the cleared field is never
 * frozen, because #3191 measured a repair that froze a cleared field whose value was
 * correct and withheld working research links. A url another row also owns is left
 * alone, because clearing a borrowed url promotes the borrower. And a row whose own
 * identity fields disagree about what it is is handed to **#3252** rather than repaired,
 * because a mis-aimed website is a symptom there rather than the defect.
 *
 * That hand-off named #3290 until now, which is closed and is about one url being the
 * stored `websiteUrl` of two or more rows. That is the `url-owned-by-another-row`
 * refusal above, not this one. `entityIdentityIsInQuestion` fires on a collective name
 * carried by a person-scoped type, which is #3252's cohort, so every row this refusal
 * excluded was deferred to an issue that was closed and had never covered it. A
 * deliberate exclusion pointing at a closed issue is how a row stops being anybody's:
 * the count reads as "working rather than stuck" in the report while nothing owns it.
 */
import { findSourceLinkHealth, type DatedSourceLinkHealth } from '../services/sourceLinkHealth';
import {
  liveFieldValueRefusals,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
} from '../utils/researchEntityFieldValueRefusals';

export const DEAD_LINK_HEALTH_REFUSAL_RULE = 'dead_link_health_verdict';

export type DeadWebsiteRefusal =
  | 'no-dead-website'
  | 'operator-locked'
  | 'url-owned-by-another-row'
  | 'entity-identity-is-in-question';

export interface DeadWebsiteRow {
  slug: string;
  entityType?: unknown;
  name?: unknown;
  displayName?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  manuallyLockedFields?: unknown;
  fieldValueRefusals?: unknown;
  sourceLinkHealth?: unknown;
}

export type DeadWebsiteField = 'websiteUrl' | 'website';

export const DEAD_WEBSITE_FIELDS: readonly DeadWebsiteField[] = ['websiteUrl', 'website'];

export interface DeadWebsitePlan {
  slug: string;
  field: DeadWebsiteField;
  url: string;
  liveCitationsRemaining: number;
}

export interface DeadWebsiteOutcome {
  plans: DeadWebsitePlan[];
  refused: Array<{ slug: string; reason: DeadWebsiteRefusal }>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function normalizeWebsiteUrl(url: unknown): string {
  return text(url)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// Person-scoped AND not a lab, for the same reason the unbacked-name repair narrows it: a
// collective name on a LAB row is the normal shape, so admitting LAB would read every lab as
// wrongly named. `models/storedVocabularies.ts` owns person scope itself (#3602).
const NON_LAB_PERSON_SCOPED_TYPES =
  /^(?:FACULTY_RESEARCH_AREA|FACULTY_PROJECT|INDIVIDUAL_RESEARCH)$/;
const COLLECTIVE_NAME = /\b(?:lab|laboratory|center|centre|institute|program|programme)\b/i;

/**
 * Whether the row's own identity fields disagree about what it is, which is #3290's
 * shape rather than a website problem. Two independent signals: a name sharing no
 * token with the slug that addresses it, and a name claiming a collective on a
 * person-scoped type.
 */
export function entityIdentityIsInQuestion(row: DeadWebsiteRow): boolean {
  const name = text(row.name) || text(row.displayName);
  if (!name) return false;
  const nameTokens = name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
  const slugTokens = new Set(text(row.slug).split('-').filter(Boolean));
  const sharesNothing = nameTokens.length > 0 && !nameTokens.some((token) => slugTokens.has(token));
  const collectiveNameOnPersonType =
    COLLECTIVE_NAME.test(name) && NON_LAB_PERSON_SCOPED_TYPES.test(text(row.entityType));
  return sharesNothing || collectiveNameOnPersonType;
}

export function planDeadResearchWebsiteClears(
  rows: readonly DeadWebsiteRow[],
  isDeadUrl: (row: DeadWebsiteRow, url: string) => boolean,
  liveCitationsFor: (row: DeadWebsiteRow) => number,
  ownerCountFor: (normalizedUrl: string) => number,
): DeadWebsiteOutcome {
  const plans: DeadWebsitePlan[] = [];
  const refused: Array<{ slug: string; reason: DeadWebsiteRefusal }> = [];

  for (const row of rows) {
    const slug = text(row.slug);
    const deadFields = DEAD_WEBSITE_FIELDS.filter((field) => {
      const url = text(row[field]);
      return Boolean(url) && isDeadUrl(row, url);
    });
    if (deadFields.length === 0) {
      refused.push({ slug, reason: 'no-dead-website' });
      continue;
    }
    const locked = Array.isArray(row.manuallyLockedFields)
      ? row.manuallyLockedFields.map(text)
      : [];
    if (locked.includes('websiteUrl') || locked.includes('website')) {
      refused.push({ slug, reason: 'operator-locked' });
      continue;
    }
    if (deadFields.some((field) => ownerCountFor(normalizeWebsiteUrl(row[field])) > 1)) {
      refused.push({ slug, reason: 'url-owned-by-another-row' });
      continue;
    }
    if (entityIdentityIsInQuestion(row)) {
      refused.push({ slug, reason: 'entity-identity-is-in-question' });
      continue;
    }
    const liveCitationsRemaining = liveCitationsFor(row);
    for (const field of deadFields) {
      plans.push({ slug, field, url: text(row[field]), liveCitationsRemaining });
    }
  }

  return { plans, refused };
}

export function countWebsiteUrlOwnerRows(
  rows: ReadonlyArray<{ websiteUrl?: unknown; website?: unknown }>,
): Map<string, number> {
  const owners = new Map<string, number>();
  for (const row of rows) {
    const keys = new Set(
      DEAD_WEBSITE_FIELDS.map((field) => text(row[field]))
        .filter(Boolean)
        .map(normalizeWebsiteUrl),
    );
    for (const key of keys) owners.set(key, (owners.get(key) ?? 0) + 1);
  }
  return owners;
}

export const DEAD_WEBSITE_CLEAR_REFUSED_BY = 'research-entity:clear-dead-research-websites';

function deadVerdictNote(storedHealth: unknown, url: string): string {
  const health = findSourceLinkHealth(storedHealth, url) as DatedSourceLinkHealth | undefined;
  const answer =
    typeof health?.httpStatusCode === 'number'
      ? `HTTP ${health.httpStatusCode}`
      : 'no HTTP answer from the host';
  const checkedAt = health?.checkedAt ? new Date(health.checkedAt) : null;
  const when =
    checkedAt && !Number.isNaN(checkedAt.getTime())
      ? ` when last checked on ${checkedAt.toISOString().slice(0, 10)}`
      : '';
  return `the link-health lane read this page as unavailable (${answer})${when}, so it is not a research website this row can offer; withdrawn when the lane next reads it healthy`;
}

/**
 * The clear and the refusal land in one write. The refusal is what keeps the next
 * resolve from re-deriving the value from the observation that still asserts it, and
 * no field is locked, so a different website any lane asserts can still fill the slot.
 */
export function planDeadWebsiteClearWrite(
  row: DeadWebsiteRow,
  plans: readonly DeadWebsitePlan[],
  now: Date,
): Record<string, unknown> {
  const write: Record<string, unknown> = {};
  for (const plan of plans) {
    write[plan.field] = '';
    Object.assign(
      write,
      planFieldValueRefusal(row.fieldValueRefusals, {
        field: plan.field,
        value: plan.url,
        rule: DEAD_LINK_HEALTH_REFUSAL_RULE,
        refusedBy: DEAD_WEBSITE_CLEAR_REFUSED_BY,
        refusedAt: now,
        note: deadVerdictNote(row.sourceLinkHealth, plan.url),
        evidenceUrl: plan.url,
      }),
    );
  }
  return write;
}

const deadLinkHealthRefusals = (row: { fieldValueRefusals?: unknown }, field: DeadWebsiteField) =>
  liveFieldValueRefusals(row.fieldValueRefusals, field).filter(
    (refusal) => refusal.rule === DEAD_LINK_HEALTH_REFUSAL_RULE && text(refusal.evidenceUrl),
  );

/**
 * The pages this stage refused, which the link-health lane must keep probing: it
 * rewrites a row's verdicts from the urls the row carries, and a cleared website is no
 * longer one of them, so without this the verdict a withdrawal waits on is never taken.
 */
export function deadLinkHealthRefusalEvidenceUrls(row: { fieldValueRefusals?: unknown }): string[] {
  return DEAD_WEBSITE_FIELDS.flatMap((field) =>
    deadLinkHealthRefusals(row, field).map((refusal) => text(refusal.evidenceUrl)),
  );
}

export interface DeadWebsiteRefusalWithdrawal {
  slug: string;
  field: DeadWebsiteField;
  url: string;
}

/**
 * A refusal this stage recorded stands only while the verdict it was recorded on does.
 * Only a HEALTHY reading withdraws it, the same bar `revivedValueWithdrawal` sets, so a
 * throttled or inconclusive probe keeps the page refused rather than re-admitting it.
 */
export function planDeadWebsiteRefusalWithdrawals(
  rows: ReadonlyArray<DeadWebsiteRow>,
): DeadWebsiteRefusalWithdrawal[] {
  const withdrawals: DeadWebsiteRefusalWithdrawal[] = [];
  for (const row of rows) {
    for (const field of DEAD_WEBSITE_FIELDS) {
      for (const refusal of deadLinkHealthRefusals(row, field)) {
        const url = text(refusal.evidenceUrl);
        if (findSourceLinkHealth(row.sourceLinkHealth, url)?.healthStatus !== 'HEALTHY') continue;
        withdrawals.push({ slug: text(row.slug), field, url });
      }
    }
  }
  return withdrawals;
}

export function planDeadWebsiteRefusalWithdrawalWrite(
  row: DeadWebsiteRow,
  withdrawals: readonly DeadWebsiteRefusalWithdrawal[],
  now: Date,
): Record<string, unknown> {
  const write: Record<string, unknown> = {};
  let refusals = row.fieldValueRefusals;
  for (const withdrawal of withdrawals) {
    const planned = planFieldValueRefusalWithdrawal(
      refusals,
      withdrawal.field,
      withdrawal.url,
      'the link-health lane read the page as healthy again, so it is admissible',
      now,
    );
    Object.assign(write, planned);
    refusals = { ...(refusals as Record<string, unknown>), ...unprefixed(planned) };
  }
  return write;
}

const unprefixed = (planned: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(planned).map(([path, value]) => [path.slice(path.indexOf('.') + 1), value]),
  );

/**
 * How a refusal should read in a scheduled report.
 *
 * `deliberate` is an exclusion somebody chose and the pass must honour, so a scheduled
 * run showing a steady count of them is working rather than stuck. `not-applicable` is
 * the ordinary bulk of the corpus. Keeping the two apart matters because a count that
 * reads as a remainder invites the next operator to try to drive it to zero, and on an
 * operator-locked row driving it to zero means overriding the operator (#3309).
 */
export const DEAD_WEBSITE_REFUSAL_KIND: Record<
  DeadWebsiteRefusal,
  'deliberate' | 'not-applicable'
> = {
  'no-dead-website': 'not-applicable',
  'operator-locked': 'deliberate',
  'url-owned-by-another-row': 'deliberate',
  'entity-identity-is-in-question': 'deliberate',
};

export interface DeadWebsiteRefusalReport {
  deliberatelyExcluded: Partial<Record<DeadWebsiteRefusal, number>>;
  notApplicable: Partial<Record<DeadWebsiteRefusal, number>>;
  deliberatelyExcludedTotal: number;
}

export function reportDeadWebsiteRefusals(
  refused: ReadonlyArray<{ reason: DeadWebsiteRefusal }>,
): DeadWebsiteRefusalReport {
  const counts = summarizeDeadWebsiteRefusals(refused);
  const deliberatelyExcluded: Partial<Record<DeadWebsiteRefusal, number>> = {};
  const notApplicable: Partial<Record<DeadWebsiteRefusal, number>> = {};
  let deliberatelyExcludedTotal = 0;
  for (const [reason, count] of Object.entries(counts) as Array<[DeadWebsiteRefusal, number]>) {
    if (DEAD_WEBSITE_REFUSAL_KIND[reason] === 'deliberate') {
      deliberatelyExcluded[reason] = count;
      deliberatelyExcludedTotal += count;
    } else {
      notApplicable[reason] = count;
    }
  }
  return { deliberatelyExcluded, notApplicable, deliberatelyExcludedTotal };
}

export function summarizeDeadWebsiteRefusals(
  refused: ReadonlyArray<{ reason: DeadWebsiteRefusal }>,
): Record<DeadWebsiteRefusal, number> {
  const counts: Record<DeadWebsiteRefusal, number> = {
    'no-dead-website': 0,
    'operator-locked': 0,
    'url-owned-by-another-row': 0,
    'entity-identity-is-in-question': 0,
  };
  for (const row of refused) counts[row.reason] += 1;
  return counts;
}
