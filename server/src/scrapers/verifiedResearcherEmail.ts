import { Observation } from '../models/observation';
import { escapeRegex } from '../utils/regex';
import { looksLikeYaleNetid } from '../utils/yaleNetid';
import { Researcher } from '../models/researcher';
import { officialProfileDestinationStoredPattern } from '../services/leadProfileIdentity';
import { identityWitnessesConflict } from '../services/officialProfileLinkIdentity';
import { isLikelyPersonSpecificYaleEmail } from './utils/scraperHelpers';
import { loadPersonPageDepartures } from './personPageDeparture';
import { materializationReadScopeFilter, userIdentityJoinForKey } from './entityMaterializer';
import {
  invalidatedScrapeRunIds,
  partitionObservationsByInvalidatedRun,
} from './invalidatedScrapeRuns';
import {
  OFFICIAL_PROFILE_PI_BACKFILL_SOURCE,
  loadDirectoryNetidsByAddress,
  directoryContradictsNetidForAddress,
  netidOfNetidUserKey,
} from './directoryContradictedProfileNetid';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';

export const YALE_DIRECTORY_EMAIL_SOURCE = 'yale-directory';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BARE_NETID = /^[a-z0-9]+$/;

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizedEmail = (value: unknown): string => {
  const email = textValue(value).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
};

const bareNetid = (value: unknown): string => {
  const netid = textValue(value).toLowerCase();
  return BARE_NETID.test(netid) ? netid : '';
};

export interface EmailEvidencePerson {
  _id?: unknown;
  netid: string;
  displayName?: string;
}

/**
 * Whether the page's email is already held by a live researcher with a different netid
 * from the key's person, which is positive evidence that the page belongs to someone else
 * and its identity must not be filed under this key (#5606). A holder with no netid is a
 * possible second record of the same person, so it decides nothing.
 */
export async function pageEmailHeldByAnotherResearcher(
  email: unknown,
  person: EmailEvidencePerson,
): Promise<boolean> {
  const address = textValue(email).toLowerCase();
  if (!address) return false;
  // Without a database connection the holder cannot be read; the lane only runs connected, and
  // its offline unit tests exercise extraction rather than identity ownership.
  if (!mongooseConnectionWasOpened()) return false;
  const holders = (await Researcher.find({ archived: { $ne: true }, 'identifiers.email': address })
    .select('_id identifiers.netid')
    .limit(5)
    .lean()) as unknown as Array<{ _id: unknown; identifiers?: { netid?: string } }>;
  return holders.some((holder) =>
    identityWitnessesConflict(holder, {
      _id: person._id ?? '',
      netid: textValue(person.netid),
    }),
  );
}

async function pageIsOnlyThePersonsOwnOfficialLink(
  pageUrl: unknown,
  researcherId: unknown,
): Promise<boolean> {
  const pattern = officialProfileDestinationStoredPattern(textValue(pageUrl));
  if (!pattern) return false;
  const holdsPage = {
    archived: { $ne: true },
    profileLinks: { $elemMatch: { kind: 'YALE_OFFICIAL', url: pattern } },
  };
  const [personHoldsIt, anotherHoldsIt] = await Promise.all([
    Researcher.exists({ ...holdsPage, _id: researcherId }),
    Researcher.exists({ ...holdsPage, _id: { $ne: researcherId } }),
  ]);
  return Boolean(personHoldsIt) && !anotherHoldsIt;
}

export type VerifiedEmailSource = 'yale-directory' | 'official-profile-page';

export type VerifiedResearcherEmail =
  | { status: 'verified'; email: string; sources: VerifiedEmailSource[] }
  | { status: 'none' }
  | { status: 'conflicting'; emails: string[] };

export type EmailObservation = {
  scrapeRunId?: unknown;
  entityKey?: unknown;
  value?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
};

export async function loadVerifiableEmailObservations(netid: string): Promise<EmailObservation[]> {
  const read = (await Observation.find(
    {
      entityType: 'user',
      field: 'email',
      ...materializationReadScopeFilter(),
      $or: [
        { sourceName: YALE_DIRECTORY_EMAIL_SOURCE, entityKey: { $in: [netid, `netid:${netid}`] } },
        { sourceName: OFFICIAL_PROFILE_PI_BACKFILL_SOURCE, entityKey: `netid:${netid}` },
      ],
    },
    { entityKey: 1, value: 1, sourceName: 1, sourceUrl: 1, scrapeRunId: 1 },
  ).lean()) as EmailObservation[];
  return partitionObservationsByInvalidatedRun(read, await invalidatedScrapeRunIds()).kept;
}

/**
 * The email a researcher's identity-verified evidence states, read on every resolve so a
 * stored address follows its evidence without a lock (#5627). Only two kinds of evidence
 * verify identity: the Yale directory's record keyed by the person's own netid, and the
 * person's own official page observed under their own `netid:` key. A page counts only when
 * the person already holds it as their official link and no other live researcher does, and
 * when the directory does not pair its address with a different netid. Either source is
 * refused when a researcher with a different netid already holds the address (#5606), and
 * verified sources that disagree decide nothing.
 */
export async function verifiedResearcherEmail(
  person: EmailEvidencePerson,
): Promise<VerifiedResearcherEmail> {
  const netid = bareNetid(person.netid);
  if (!netid) return { status: 'none' };
  return verifiedResearcherEmailFrom(person, await loadVerifiableEmailObservations(netid));
}

/**
 * The address a researcher's stored email should hold after this resolve, or undefined to keep
 * it. An empty value is filled from any verified address. A non-empty value is replaced only
 * when the person's own official page is among the verified sources and no official-page
 * evidence on the person's key still states the stored address (#5627): a directory-only
 * candidate, or page evidence that states both addresses, cannot tell which one is current.
 */
export async function derivedResearcherEmail(
  person: EmailEvidencePerson,
  storedEmail: string,
): Promise<string | undefined> {
  const netid = bareNetid(person.netid);
  if (!netid) return undefined;
  return derivedResearcherEmailFrom(
    person,
    storedEmail,
    await loadVerifiableEmailObservations(netid),
  );
}

/**
 * A person whose own official page marks them deceased or departed gets no fill and no
 * replacement (#5721): the address would be served as a way to reach someone who is gone.
 */
async function personPageMarksDeparted(person: EmailEvidencePerson): Promise<boolean> {
  const id = person._id === undefined || person._id === null ? '' : String(person._id);
  if (!id) return false;
  return (await loadPersonPageDepartures([id], new Date())).has(id);
}

/**
 * Whether live evidence states the address under a key the engine join resolves to anyone
 * but this person (#5731). Only a netid-shaped key is an identity witness: an email-local-part
 * placeholder such as a dotted alias names nobody on its own, so it is skipped. A name-derived key that joins to the same researcher is the same
 * person and decides nothing; a key that joins to nobody, or cannot be told apart, fails
 * closed, because the address could then belong to someone the corpus has not resolved.
 */
async function anotherKeyStatesAddress(
  email: string,
  person: EmailEvidencePerson,
  netid: string,
): Promise<boolean> {
  const ownKeys = [netid, `netid:${netid}`];
  const keys = (await Observation.distinct('entityKey', {
    entityType: 'user',
    field: 'email',
    value: new RegExp(`^${escapeRegex(email)}$`, 'i'),
    entityKey: { $nin: ownKeys },
    ...materializationReadScopeFilter(),
  })) as unknown[];
  const personId = person._id === undefined || person._id === null ? '' : String(person._id);
  for (const key of keys) {
    if (typeof key !== 'string' || !key) continue;
    if (!looksLikeYaleNetid(key.replace(/^netid:/i, ''))) continue;
    const joined = (await userIdentityJoinForKey(key))?.join?.researcher?._id;
    if (!joined || String(joined) !== personId) return true;
  }
  return false;
}

/**
 * A replacement overwrites an address the person may still use, so a Yale candidate must name
 * the person, judged by the predicate every lane applies to a person email: it refuses role and
 * office mailboxes as well as an address that names someone else. A candidate outside Yale has
 * no such predicate and is left to the page rules.
 */
function yaleCandidateIsNotThePersonsOwnAddress(
  candidate: string,
  person: EmailEvidencePerson,
): boolean {
  if (!candidate.endsWith('@yale.edu')) return false;
  return !isLikelyPersonSpecificYaleEmail(candidate, textValue(person.displayName));
}

export async function derivedResearcherEmailFrom(
  person: EmailEvidencePerson,
  storedEmail: string,
  observations: readonly EmailObservation[],
): Promise<string | undefined> {
  const netid = bareNetid(person.netid);
  if (!netid) return undefined;
  if (await personPageMarksDeparted(person)) return undefined;
  const verified = await verifiedResearcherEmailFrom(person, observations);
  if (verified.status !== 'verified') return undefined;
  const stored = normalizedEmail(storedEmail);
  if (!stored) return verified.email;
  if (stored === verified.email) return undefined;
  if (!verified.sources.includes('official-profile-page')) return undefined;
  if (yaleCandidateIsNotThePersonsOwnAddress(verified.email, person)) {
    return undefined;
  }
  const pageEvidenceStatesStored = observations.some(
    (observation) =>
      observation.sourceName === OFFICIAL_PROFILE_PI_BACKFILL_SOURCE &&
      netidOfNetidUserKey(observation.entityKey) === netid &&
      normalizedEmail(observation.value) === stored,
  );
  return pageEvidenceStatesStored ? undefined : verified.email;
}

export async function verifiedResearcherEmailFrom(
  person: EmailEvidencePerson,
  observations: readonly EmailObservation[],
): Promise<VerifiedResearcherEmail> {
  const netid = bareNetid(person.netid);
  if (!netid || observations.length === 0) return { status: 'none' };

  const sourcesByEmail = new Map<string, Set<VerifiedEmailSource>>();
  const accept = (email: string, source: VerifiedEmailSource) =>
    sourcesByEmail.set(email, (sourcesByEmail.get(email) ?? new Set()).add(source));

  const directory = await loadDirectoryNetidsByAddress();
  for (const observation of observations) {
    const email = normalizedEmail(observation.value);
    if (!email) continue;
    if (observation.sourceName === YALE_DIRECTORY_EMAIL_SOURCE) {
      if (bareNetid(String(observation.entityKey ?? '').replace(/^netid:/i, '')) !== netid)
        continue;
      if (await pageEmailHeldByAnotherResearcher(email, { _id: person._id, netid })) continue;
      accept(email, 'yale-directory');
      continue;
    }
    if (observation.sourceName !== OFFICIAL_PROFILE_PI_BACKFILL_SOURCE) continue;
    if (netidOfNetidUserKey(observation.entityKey) !== netid) continue;
    if (directoryContradictsNetidForAddress(netid, email, directory)) continue;
    if (!(await pageIsOnlyThePersonsOwnOfficialLink(observation.sourceUrl, person._id))) continue;
    if (await pageEmailHeldByAnotherResearcher(email, { _id: person._id, netid })) continue;
    accept(email, 'official-profile-page');
  }

  const emails = [...sourcesByEmail.keys()].sort();
  if (emails.length === 0) return { status: 'none' };
  if (emails.length > 1) return { status: 'conflicting', emails };
  if (await anotherKeyStatesAddress(emails[0], person, netid)) return { status: 'none' };
  return {
    status: 'verified',
    email: emails[0],
    sources: [...sourcesByEmail.get(emails[0])!].sort(),
  };
}
