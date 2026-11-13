import mongoose from 'mongoose';
import { isValidOrcid, Researcher } from '../models/researcher';
import { isPlausiblePersonOrcid } from '../utils/orcid';
import { splitName } from '../scrapers/utils/scraperHelpers';
import {
  givenNamesCouldNameOnePerson,
  givenNamesEquivalent,
  surnameFetchRegex,
  surnameOnlyMatch,
  surnamesCompatible,
  SURNAME_FETCH_LIMIT,
} from '../scrapers/utils/piNameMatch';
import { plausiblePersonOrcid } from '../utils/orcid';
import { looksLikeYaleNetid } from '../utils/yaleNetid';

export type ResearcherPersonNameResolutionStatus = 'matched' | 'absent' | 'ambiguous';

export interface ResearcherPersonNameResolution {
  status: ResearcherPersonNameResolutionStatus;
  researcherId?: mongoose.Types.ObjectId;
  everyCandidateNamesSomeoneElse?: boolean;
  ambiguousCandidates?: ResearcherNameCandidate[];
}

export interface ResearcherNameCandidate {
  _id: mongoose.Types.ObjectId | string;
  displayName?: string;
  identifiers?: { email?: string; netid?: string; orcid?: string };
}

/**
 * The person's own identifiers, read from the evidence that names them. A name alone never
 * breaks a tie, so only these may (#5875).
 */
export interface PersonIdentityEvidence {
  emails?: readonly unknown[];
  orcid?: unknown;
}

export interface ResearcherPersonNameResolverDeps {
  findResearchersBySurname: (surnameRegex: RegExp) => Promise<ResearcherNameCandidate[]>;
  resolveResearcherIdByNetid: (netid: string) => Promise<mongoose.Types.ObjectId | undefined>;
  findResearcherByOrcid: (orcid: string) => Promise<ResearcherNameCandidate | undefined>;
}

const defaultFindResearchersBySurname = async (
  surnameRegex: RegExp,
): Promise<ResearcherNameCandidate[]> =>
  (await Researcher.find(
    { displayName: surnameRegex, archived: { $ne: true } },
    {
      _id: 1,
      displayName: 1,
      'identifiers.email': 1,
      'identifiers.netid': 1,
      'identifiers.orcid': 1,
    },
  )
    .limit(SURNAME_FETCH_LIMIT)
    .lean()) as ResearcherNameCandidate[];

const defaultResolveResearcherIdByNetid = async (
  netid: string,
): Promise<mongoose.Types.ObjectId | undefined> => {
  const byIdentifier: any = await Researcher.findOne({ 'identifiers.netid': netid })
    .select('_id')
    .lean();
  return byIdentifier?._id ?? undefined;
};

const defaultFindResearcherByOrcid = async (
  orcid: string,
): Promise<ResearcherNameCandidate | undefined> =>
  ((await Researcher.findOne(
    { 'identifiers.orcid': orcid, archived: { $ne: true } },
    { _id: 1, displayName: 1 },
  ).lean()) as ResearcherNameCandidate | null) ?? undefined;

export function normalizeOrcid(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bare = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '')
    .toUpperCase();
  return isValidOrcid(bare) && isPlausiblePersonOrcid(bare) ? bare : undefined;
}

const asResearcherId = (value: ResearcherNameCandidate['_id']): mongoose.Types.ObjectId =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));

const normalizeNetid = (value: unknown): string | undefined => {
  const netid = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return netid.length > 0 ? netid : undefined;
};

export async function resolveResearcherIdForOrcid(
  rawOrcid: string | undefined,
  claimedName: string,
  deps?: Partial<ResearcherPersonNameResolverDeps>,
): Promise<ResearcherPersonNameResolution> {
  const orcid = normalizeOrcid(rawOrcid);
  if (!orcid) return { status: 'absent' };
  const findResearcherByOrcid = deps?.findResearcherByOrcid ?? defaultFindResearcherByOrcid;
  const holder = await findResearcherByOrcid(orcid);
  if (!holder) return { status: 'absent' };
  const claimedSurname = splitName(claimedName).last;
  const holderSurname = splitName(holder.displayName || '').last;
  if (claimedSurname && !surnamesCompatible(claimedSurname, holderSurname)) {
    return { status: 'ambiguous' };
  }
  return { status: 'matched', researcherId: asResearcherId(holder._id) };
}

// A lone token is read as a surname. A single-token query reads its candidates the same way,
// because reading only the query that way made a single-token researcher unmatchable by its
// own name, so every pass minted it again. A full-name query keeps the plain split, so a bare
// surname record cannot turn a full name's lookup ambiguous.
function personNameParts(name: string): { first: string; last: string } {
  const { first, last } = splitName(name);
  if (!last && first && !/\s/.test(first)) return { first: '', last: first };
  return { first, last };
}

interface IdentityWitnesses {
  netid?: string;
  emails: ReadonlySet<string>;
  orcid: string;
}

const normalizedEmail = (value: unknown): string => {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^\s@]+@[^\s@]+$/.test(address) ? address : '';
};

function identityWitnessesOf(
  netid: string | undefined,
  identity: PersonIdentityEvidence | undefined,
): IdentityWitnesses | undefined {
  const emails = new Set((identity?.emails ?? []).map(normalizedEmail).filter(Boolean));
  const orcid = plausiblePersonOrcid(identity?.orcid);
  const yaleNetid = netid && looksLikeYaleNetid(netid) ? netid : undefined;
  if (!yaleNetid && emails.size === 0 && !orcid) return undefined;
  return { netid: yaleNetid, emails, orcid };
}

function candidateAgreesWith(
  candidate: ResearcherNameCandidate,
  witnesses: IdentityWitnesses,
): boolean {
  const email = normalizedEmail(candidate.identifiers?.email);
  const orcid = plausiblePersonOrcid(candidate.identifiers?.orcid);
  return (
    (Boolean(email) && witnesses.emails.has(email)) ||
    (Boolean(orcid) && orcid === witnesses.orcid) ||
    (Boolean(witnesses.netid) && normalizeNetid(candidate.identifiers?.netid) === witnesses.netid)
  );
}

function candidateConflictsWith(
  candidate: ResearcherNameCandidate,
  witnesses: IdentityWitnesses,
): boolean {
  const netid = normalizeNetid(candidate.identifiers?.netid);
  const orcid = plausiblePersonOrcid(candidate.identifiers?.orcid);
  return (
    (Boolean(witnesses.netid) &&
      Boolean(netid) &&
      looksLikeYaleNetid(netid) &&
      netid !== witnesses.netid) ||
    (Boolean(witnesses.orcid) && Boolean(orcid) && orcid !== witnesses.orcid)
  );
}

/**
 * Breaks a name tie only on the person's own identifiers: exactly one candidate sharing an
 * email, a plausible ORCID or a netid, and contradicting none, is this person; a pool every
 * member of which holds another netid or another plausible ORCID names someone else. Anything
 * else leaves the tie standing, so a missing or one-sided witness fails closed (#5875).
 */
function identityResolutionOfTie(
  tied: readonly ResearcherNameCandidate[],
  everyoneWhoCouldBeThisPerson: readonly ResearcherNameCandidate[],
  witnesses: IdentityWitnesses | undefined,
): ResearcherPersonNameResolution | undefined {
  if (!witnesses || tied.length === 0) return undefined;
  const agreeing = tied.filter((candidate) => candidateAgreesWith(candidate, witnesses));
  if (agreeing.length === 1 && !candidateConflictsWith(agreeing[0], witnesses)) {
    return { status: 'matched', researcherId: asResearcherId(agreeing[0]._id) };
  }
  const namesSomeoneElse = (candidate: ResearcherNameCandidate) =>
    !candidateAgreesWith(candidate, witnesses) && candidateConflictsWith(candidate, witnesses);
  if (tied.every(namesSomeoneElse) && everyoneWhoCouldBeThisPerson.every(namesSomeoneElse)) {
    return { status: 'ambiguous', everyCandidateNamesSomeoneElse: true };
  }
  return undefined;
}

export async function resolveResearcherIdForPersonName(
  name: string,
  opts: {
    netid?: string;
    identity?: PersonIdentityEvidence;
    deps?: Partial<ResearcherPersonNameResolverDeps>;
  } = {},
): Promise<ResearcherPersonNameResolution> {
  const findResearchersBySurname =
    opts.deps?.findResearchersBySurname ?? defaultFindResearchersBySurname;
  const resolveResearcherIdByNetid =
    opts.deps?.resolveResearcherIdByNetid ?? defaultResolveResearcherIdByNetid;

  const netid = normalizeNetid(opts.netid);
  if (netid) {
    const researcherId = await resolveResearcherIdByNetid(netid);
    if (researcherId) return { status: 'matched', researcherId };
  }

  if (!name) return { status: 'absent' };
  const { first, last } = personNameParts(name);
  if (!last) return { status: 'absent' };

  const surnameRe = surnameFetchRegex(last);
  if (!surnameRe) return { status: 'absent' };

  const fetched = await findResearchersBySurname(surnameRe);
  if (fetched.length >= SURNAME_FETCH_LIMIT) return { status: 'ambiguous' };

  const candidates = fetched
    .map((candidate) => ({
      candidate,
      parsed: first
        ? splitName(candidate.displayName || '')
        : personNameParts(candidate.displayName || ''),
    }))
    .filter(({ parsed }) => surnamesCompatible(last, parsed.last));

  if (!first) {
    return { status: surnameOnlyMatch(candidates.length) };
  }

  const exact = candidates.filter(
    ({ parsed }) =>
      parsed.first.toLowerCase() === first.toLowerCase() ||
      givenNamesEquivalent(first, parsed.first),
  );
  if (exact.length === 1) {
    return { status: 'matched', researcherId: asResearcherId(exact[0].candidate._id) };
  }
  const witnesses = identityWitnessesOf(netid, opts.identity);
  const couldBeThisPerson = candidates
    .filter(({ parsed }) => givenNamesCouldNameOnePerson(first, parsed.first))
    .map(({ candidate }) => candidate);
  if (exact.length > 1) {
    const tied = exact.map(({ candidate }) => candidate);
    return (
      identityResolutionOfTie(tied, couldBeThisPerson, witnesses) ?? {
        status: 'ambiguous',
        ambiguousCandidates: tied,
      }
    );
  }
  // No prefix rule: a complete short given name is a prefix of a stranger's longer one (#5324).

  if (candidates.length === 0) return { status: 'absent' };
  if (couldBeThisPerson.length === 0) {
    return { status: 'ambiguous', everyCandidateNamesSomeoneElse: true };
  }
  return (
    identityResolutionOfTie(couldBeThisPerson, couldBeThisPerson, witnesses) ?? {
      status: 'ambiguous',
      ambiguousCandidates: couldBeThisPerson,
    }
  );
}
