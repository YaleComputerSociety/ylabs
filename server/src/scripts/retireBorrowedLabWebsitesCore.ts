import { fieldValueRefusalKey, valueIsRefused } from '../utils/researchEntityFieldValueRefusals';
import {
  eponymMatchesIdentity,
  personIdentityTokens,
} from '../utils/researchHomeNameIdentityAuthority';

export const PERSON_DIRECTORY_WEBSITE_LANES: readonly string[] = [
  'dept-faculty-roster',
  'ysm-faculty-directory',
  'yse-faculty-directory',
];

export interface DirectoryWebsiteClaim {
  observationId: string;
  entityKey: string;
  sourceName: string;
  value: unknown;
}

export interface LabWebsiteRow {
  entityId: string;
  slug: string;
  websiteUrl?: unknown;
  websiteUrlSourceName?: string;
  leadPersonIds: readonly string[];
  leadNames: readonly string[];
  fieldValueRefusals?: unknown;
  manuallyLockedFields?: unknown;
}

export interface BorrowedLabWebsitePlan {
  entityId: string;
  slug: string;
  url: string;
  sourceName: string;
  ownerSlug: string;
  supersedeObservationIds: string[];
  refuse: boolean;
  clearStored: boolean;
}

export interface BorrowedLabWebsiteOutcome {
  plans: BorrowedLabWebsitePlan[];
  keptAsCoLeadTwin: number;
  keptAsNamedForClaimant: number;
  keptByOtherEvidence: number;
  keptWithoutAuthoritativeOwner: number;
}

const websiteUrlIsLocked = (manuallyLockedFields: unknown): boolean =>
  Array.isArray(manuallyLockedFields) && manuallyLockedFields.includes('websiteUrl');

const RESEARCH_HOME_HEAD_NOUN_SUFFIX_RE = /[-_]?(?:labs?|laborator(?:y|ies)|group)$/;

const withoutHeadNoun = (part: string): string =>
  part.replace(RESEARCH_HOME_HEAD_NOUN_SUFFIX_RE, '') || part;

function urlNameParts(url: string): { hostLabel: string; leaf: string } {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const leaf = (segments[segments.length - 1] ?? '').replace(/\.[a-z]+$/i, '');
    const hostLabel = parsed.hostname.replace(/^www\./, '').split('.')[0] ?? '';
    return {
      hostLabel: withoutHeadNoun(hostLabel.toLowerCase()),
      leaf: withoutHeadNoun(leaf.toLowerCase()),
    };
  } catch {
    return { hostLabel: '', leaf: '' };
  }
}

const JOINT_NAME_SURNAME_MIN_LENGTH = 4;

const partIsEponymOf = (part: string, leadNames: readonly string[]): boolean =>
  part.length >= 3 &&
  leadNames.some((name) => eponymMatchesIdentity(part, personIdentityTokens(name)));

const partMentionsASurnameOf = (part: string, leadNames: readonly string[]): boolean =>
  leadNames.some((name) =>
    personIdentityTokens(name).some(
      (token) => token.length >= JOINT_NAME_SURNAME_MIN_LENGTH && part.includes(token),
    ),
  );

/** Strict: the page is named for one of these leads, so it is theirs. */
const urlIsNamedFor = (url: string, leadNames: readonly string[]): boolean => {
  const { hostLabel, leaf } = urlNameParts(url);
  return partIsEponymOf(hostLabel, leadNames) || partIsEponymOf(leaf, leadNames);
};

/**
 * Loose, and only ever used to keep a claim: a joint lab's site names each co-lead
 * inside one host label, which an eponym match cannot see, and a wrong keep costs
 * nothing a refusal would not.
 */
const urlMayBeNamedFor = (url: string, leadNames: readonly string[]): boolean => {
  if (urlIsNamedFor(url, leadNames)) return true;
  const { hostLabel, leaf } = urlNameParts(url);
  return partMentionsASurnameOf(hostLabel, leadNames) || partMentionsASurnameOf(leaf, leadNames);
};

/**
 * Whether the owner's hold on the page outranks a person-directory lane's claim for
 * someone else. A lab-level lane names the lab page as the lab's own, so it outranks a
 * member's profile link outright. Between two directory claims, the page belongs to the
 * row whose lead the page is named for, and to neither when that is undecided.
 * A page named for the claimant is never outranked; the caller settles that first.
 */
function ownerOutranksClaimant(owner: LabWebsiteRow, url: string): boolean {
  const ownerSource = owner.websiteUrlSourceName ?? '';
  if (ownerSource && !PERSON_DIRECTORY_WEBSITE_LANES.includes(ownerSource)) return true;
  return urlIsNamedFor(url, owner.leadNames);
}

/**
 * Which person-directory `websiteUrl` claims name a lab page that is another lead's
 * research website rather than this row's own (#4980).
 *
 * A member's profile links the lab they work in, and the roster lane reads any
 * `/lab/<x>/` link as the member's own lab, so the member's row is minted as a second
 * lab on the same page. The lane honours a `wrong_owner` refusal against the URL and
 * withdraws the lab name, kind and type with it (#3452), so the refusal is what this
 * records. `retire-shared-roster-websites` cannot see the case, because the owner's
 * claim comes from a different lane.
 *
 * A row sharing a lead with the owner is the same lab seen from a co-lead's profile,
 * which is a merge rather than a refusal, so it is left alone and counted. So is a page
 * named for the claimant's own lead, where the owner is the borrower, a row another lane
 * independently gives the page, and a manually locked `websiteUrl`.
 */
export function planBorrowedLabWebsiteRetirement(input: {
  claims: readonly DirectoryWebsiteClaim[];
  rowsBySlug: ReadonlyMap<string, LabWebsiteRow>;
  ownersByUrlKey: ReadonlyMap<string, readonly LabWebsiteRow[]>;
  otherLaneSupport: ReadonlySet<string>;
}): BorrowedLabWebsiteOutcome {
  const outcome: BorrowedLabWebsiteOutcome = {
    plans: [],
    keptAsCoLeadTwin: 0,
    keptAsNamedForClaimant: 0,
    keptByOtherEvidence: 0,
    keptWithoutAuthoritativeOwner: 0,
  };
  const claimsByRowAndKey = new Map<
    string,
    { slug: string; key: string; claims: DirectoryWebsiteClaim[] }
  >();
  for (const claim of input.claims) {
    const key = fieldValueRefusalKey('websiteUrl', claim.value);
    if (!key || !input.rowsBySlug.has(claim.entityKey)) continue;
    const rowKey = `${claim.entityKey}|${key}`;
    const entry = claimsByRowAndKey.get(rowKey) ?? { slug: claim.entityKey, key, claims: [] };
    entry.claims.push(claim);
    claimsByRowAndKey.set(rowKey, entry);
  }

  for (const rowKey of [...claimsByRowAndKey.keys()].sort()) {
    const { slug, key, claims } = claimsByRowAndKey.get(rowKey)!;
    const row = input.rowsBySlug.get(slug)!;
    const url = String(claims[0].value).trim();
    const otherOwners = (input.ownersByUrlKey.get(key) ?? []).filter(
      (owner) => owner.slug !== slug,
    );
    if (otherOwners.length === 0) continue;
    if (
      otherOwners.some((owner) =>
        owner.leadPersonIds.some((personId) => row.leadPersonIds.includes(personId)),
      )
    ) {
      outcome.keptAsCoLeadTwin += 1;
      continue;
    }
    if (urlMayBeNamedFor(url, row.leadNames)) {
      outcome.keptAsNamedForClaimant += 1;
      continue;
    }
    const owner = otherOwners.find((candidate) => ownerOutranksClaimant(candidate, url));
    if (!owner) {
      outcome.keptWithoutAuthoritativeOwner += 1;
      continue;
    }
    if (input.otherLaneSupport.has(rowKey)) {
      outcome.keptByOtherEvidence += 1;
      continue;
    }
    if (websiteUrlIsLocked(row.manuallyLockedFields)) continue;
    outcome.plans.push({
      entityId: row.entityId,
      slug,
      url,
      sourceName: claims[0].sourceName,
      ownerSlug: owner.slug,
      supersedeObservationIds: claims.map((claim) => claim.observationId).sort(),
      refuse: !valueIsRefused(row.fieldValueRefusals, 'websiteUrl', url),
      clearStored: fieldValueRefusalKey('websiteUrl', row.websiteUrl) === key,
    });
  }
  return outcome;
}
