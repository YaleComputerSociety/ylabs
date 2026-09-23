import {
  personNameTokensFromEntityTitle,
  personPageLeafNameTokens,
} from '../scrapers/utils/personProfileEntityMatch';
import {
  isLikelyOfficialPersonProfileUrl,
  normalizeOfficialProfileDestination,
} from '../services/leadProfileIdentity';
import {
  isCanonicalCmsProfileUrl,
  isYaleOfficialProfileUrl,
} from './backfillResearcherOfficialProfileLinksCore';
import { personPageUrlNamesPerson } from './fraProfileSynthesisCore';

export type WrongPersonProfileLinkRefusal =
  | 'bound-page-names-nobody'
  | 'bound-page-carries-another-surname'
  | 'bound-page-names-this-record'
  | 'record-has-no-person-page-of-its-own'
  | 'bound-page-is-claimed-by-no-other-record';

export interface WrongPersonProfileLinkRow {
  researcherId: string;
  displayName: string;
  /** The `YALE_OFFICIAL` / `PRIMARY_IDENTITY` link URL this record currently carries. */
  boundUrl: string;
  /**
   * Yale person pages this record's own evidence offers as its identity: the profile
   * and source URLs of its own live role assignments, and the citations of the
   * entities those assignments point at. Candidates, not conclusions: each one is
   * only adopted once it names this record.
   */
  ownPageCandidates: readonly string[];
  /**
   * Display names of the OTHER unarchived researcher records that carry `boundUrl`
   * as their own official identity link. A non-empty list is what proves the page is
   * already attached to somebody, so moving this record off it strands nothing.
   */
  claimantNames: readonly string[];
}

export interface WrongPersonProfileLinkRepoint {
  researcherId: string;
  fromUrl: string;
  toUrl: string;
}

export interface WrongPersonProfileLinkPlan {
  repoint: WrongPersonProfileLinkRepoint[];
  refused: Array<{ researcherId: string; reason: WrongPersonProfileLinkRefusal }>;
}

const pathLeaf = (value: string): string => {
  try {
    return new URL(value).pathname.replace(/\/+$/, '').split('/').pop() || '';
  } catch {
    return '';
  }
};

/**
 * The page this record should cite instead, chosen from the pages its own evidence
 * names it by. A site's canonical CMS profile page outranks its directory and
 * section listings of the same person, the same authority
 * `supersedesOfficialProfileUrl` encodes; within a rank the shorter destination wins
 * so the choice does not depend on the order the evidence happened to load.
 */
export function ownPersonPageForRecord(row: WrongPersonProfileLinkRow): string | undefined {
  const named = [...new Set(row.ownPageCandidates.map((value) => String(value ?? '').trim()))]
    .filter(
      (value) =>
        value &&
        isYaleOfficialProfileUrl(value) &&
        isLikelyOfficialPersonProfileUrl(value) &&
        personPageUrlNamesPerson(value, row.displayName),
    )
    .filter(
      (value) =>
        normalizeOfficialProfileDestination(value) !==
        normalizeOfficialProfileDestination(row.boundUrl),
    );
  return named.sort((a, b) => {
    const aCanonical = isCanonicalCmsProfileUrl(a) ? 0 : 1;
    const bCanonical = isCanonicalCmsProfileUrl(b) ? 0 : 1;
    if (aCanonical !== bCanonical) return aCanonical - bCanonical;
    const aDestination = normalizeOfficialProfileDestination(a);
    const bDestination = normalizeOfficialProfileDestination(b);
    return aDestination.length - bDestination.length || aDestination.localeCompare(bDestination);
  })[0];
}

/**
 * Why this record's bound page is not a candidate for moving, judged without reading
 * any of the record's own evidence, or `undefined` when it is. Exported so a caller
 * can decide which records are worth the per-record evidence queries and still
 * report the same refusal the plan would have reported.
 */
export function wrongPersonProfileLinkRefusalBeforeEvidence(
  row: Pick<WrongPersonProfileLinkRow, 'displayName' | 'boundUrl' | 'claimantNames'>,
): WrongPersonProfileLinkRefusal | undefined {
  const boundTokens = personPageLeafNameTokens(pathLeaf(String(row.boundUrl ?? '')));
  const recordTokens = personNameTokensFromEntityTitle(row.displayName);
  if (!boundTokens || !recordTokens) return 'bound-page-names-nobody';
  if (boundTokens.at(-1) !== recordTokens.at(-1)) return 'bound-page-carries-another-surname';
  if (personPageUrlNamesPerson(row.boundUrl, row.displayName)) {
    return 'bound-page-names-this-record';
  }
  if (row.claimantNames.length === 0) return 'bound-page-is-claimed-by-no-other-record';
  return undefined;
}

/**
 * Which records are bound to an official page that names a different person, and
 * which of their own pages to bind them to instead.
 *
 * Both halves of the arbitration are required, because either one alone gets a real
 * cohort wrong. That the bound page's slug disagrees with the record's given name is
 * not enough: a department publishes people under a short form, an initial and a
 * middle name, or a concatenated given name that no variant table lists, and on the
 * Development corpus that shape alone flags three same-person spellings for every
 * four genuine strangers. That another record holds the page is not enough either: a
 * duplicate pair of records for one person both carry that person's page, and the
 * page names only the spelling one of them uses.
 *
 * So a record only moves when the page it is leaving is already claimed by another
 * record AND it has a person page of its own. The first proves the page keeps its
 * owner, which is what makes this safe to run without re-deciding who the served
 * row's way in was (#2385); the second proves this record is not that owner and
 * gives it somewhere to go, so the move never costs a record its way in either.
 */
export function planWrongPersonOfficialProfileLinkRepoints(
  rows: readonly WrongPersonProfileLinkRow[],
): WrongPersonProfileLinkPlan {
  const plan: WrongPersonProfileLinkPlan = { repoint: [], refused: [] };
  for (const row of rows) {
    const refusedBeforeEvidence = wrongPersonProfileLinkRefusalBeforeEvidence(row);
    if (refusedBeforeEvidence) {
      plan.refused.push({ researcherId: row.researcherId, reason: refusedBeforeEvidence });
      continue;
    }
    const toUrl = ownPersonPageForRecord(row);
    if (!toUrl) {
      plan.refused.push({
        researcherId: row.researcherId,
        reason: 'record-has-no-person-page-of-its-own',
      });
      continue;
    }
    plan.repoint.push({ researcherId: row.researcherId, fromUrl: row.boundUrl, toUrl });
  }
  return plan;
}

export function summarizeWrongPersonProfileLinkRefusals(
  refused: WrongPersonProfileLinkPlan['refused'],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of refused) counts[row.reason] = (counts[row.reason] || 0) + 1;
  return counts;
}
