/**
 * What the corpus's stated titles claim about research ownership, and which live rows those
 * claims disagree with.
 *
 * Read-only by construction: this module plans nothing and the script around it takes no
 * `--apply`. #3576 exists because a title string alone is not a safe basis for an
 * irreversible archive, so the audit's job is to size the population and to surface the
 * rows where a second witness is needed, not to queue writes.
 */
import {
  namesARankItServesRatherThanHolds,
  titleRankSpans,
  titleResearchOwnership,
  type TitleResearchOwnership,
} from '../scrapers/utils/titleResearchOwnership';

export interface TitleOwnershipRow {
  id: string;
  slug?: string;
  entityType?: string;
  tier?: string;
  identityProfileUrl?: string | null;
  storedTitles?: readonly string[];
  /** Live lead-shaped role edges this row's identity person holds on OTHER entities. */
  leadEdgesElsewhere?: number;
}

export type TitleOwnershipBucket =
  | 'owns_research'
  | 'works_in_another_group'
  | 'states_no_rank'
  | 'titles_disagree'
  | 'no_identity_profile'
  | 'no_stored_title';

export interface TitleOwnershipFinding {
  id: string;
  bucket: TitleOwnershipBucket;
  entityType: string;
  tier: string;
  served: boolean;
  ranksNamed: string[];
  namesARankItServes: boolean;
  corroboratedByALeadEdgeElsewhere: boolean;
}

export interface TitleOwnershipAudit {
  scanned: number;
  byBucket: Record<TitleOwnershipBucket, number>;
  servedByBucket: Record<TitleOwnershipBucket, number>;
  worksInAnotherGroup: {
    rows: number;
    served: number;
    /** The known limit of the predicate, reported so a reader can subtract it. */
    namingARankTheyServe: number;
    /** The rows a second, non-string witness already corroborates. */
    corroboratedByALeadEdgeElsewhere: number;
    byEntityType: Record<string, number>;
  };
  findings: TitleOwnershipFinding[];
}

const emptyCounts = (): Record<TitleOwnershipBucket, number> => ({
  owns_research: 0,
  works_in_another_group: 0,
  states_no_rank: 0,
  titles_disagree: 0,
  no_identity_profile: 0,
  no_stored_title: 0,
});

/**
 * Unanimity, as in the retirement pass: several lanes write a `title` against one profile
 * URL and none of them owns the question, so a row whose titles disagree is its own bucket
 * rather than being resolved by recency.
 */
function bucketFor(titles: readonly string[]): TitleOwnershipBucket {
  const verdicts = new Set<TitleResearchOwnership>(titles.map((t) => titleResearchOwnership(t)));
  if (verdicts.size > 1) return 'titles_disagree';
  const [only] = [...verdicts];
  return only;
}

export function auditTitleResearchOwnership(
  rows: readonly TitleOwnershipRow[],
): TitleOwnershipAudit {
  const byBucket = emptyCounts();
  const servedByBucket = emptyCounts();
  const findings: TitleOwnershipFinding[] = [];
  const byEntityType: Record<string, number> = {};
  let worksRows = 0;
  let worksServed = 0;
  let namingARankTheyServe = 0;
  let corroborated = 0;

  for (const row of rows) {
    const served = row.tier === 'student_ready';
    const titles = (row.storedTitles || [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value !== '');

    let bucket: TitleOwnershipBucket;
    if (!row.identityProfileUrl) bucket = 'no_identity_profile';
    else if (titles.length === 0) bucket = 'no_stored_title';
    else bucket = bucketFor(titles);

    byBucket[bucket] += 1;
    if (served) servedByBucket[bucket] += 1;
    if (bucket !== 'works_in_another_group') continue;

    const namesARankItServes = titles.some((t) => namesARankItServesRatherThanHolds(t));
    const corroboratedByALeadEdgeElsewhere = (row.leadEdgesElsewhere || 0) > 0;
    worksRows += 1;
    if (served) worksServed += 1;
    if (namesARankItServes) namingARankTheyServe += 1;
    if (corroboratedByALeadEdgeElsewhere) corroborated += 1;
    byEntityType[String(row.entityType || '')] =
      (byEntityType[String(row.entityType || '')] || 0) + 1;

    findings.push({
      id: row.id,
      bucket,
      entityType: String(row.entityType || ''),
      tier: String(row.tier || ''),
      served,
      ranksNamed: [
        ...new Set(titles.flatMap((t) => titleRankSpans(t).map((span) => span.text.toLowerCase()))),
      ].sort(),
      namesARankItServes,
      corroboratedByALeadEdgeElsewhere,
    });
  }

  return {
    scanned: rows.length,
    byBucket,
    servedByBucket,
    worksInAnotherGroup: {
      rows: worksRows,
      served: worksServed,
      namingARankTheyServe,
      corroboratedByALeadEdgeElsewhere: corroborated,
      byEntityType,
    },
    findings,
  };
}
