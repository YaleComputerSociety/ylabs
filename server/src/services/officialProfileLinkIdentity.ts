import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import { officialProfileDestinationStoredPattern } from './leadProfileIdentity';
import {
  profilePageOwnerNetids,
  type DirectoryNetidsByAddress,
  type ProfilePageOwnerNetids,
} from '../scrapers/directoryContradictedProfileNetid';
import { normalizeOfficialProfileDestination } from './leadProfileIdentity';
import { looksLikeYaleNetid } from '../utils/yaleNetid';

export interface PersonIdentityWitnesses {
  _id?: unknown;
  identifiers?: { netid?: unknown; email?: unknown } | null;
  netid?: unknown;
  email?: unknown;
}

export interface OfficialProfilePageIdentity {
  email?: string;
  netid?: string;
}

const lower = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const netidOf = (person: PersonIdentityWitnesses): string =>
  lower(person.identifiers?.netid ?? person.netid);

const emailOf = (person: PersonIdentityWitnesses): string =>
  lower(person.identifiers?.email ?? person.email);

const BARE_NETID = /^[a-z]+[0-9]+$/;

/**
 * A netid names exactly one person, so two records carrying different netids are two people.
 * Nothing else is read as a conflict: a name differs between a nickname and a full first name,
 * one person can publish several ORCIDs (a YSM page listed two for one owner, #5605), and a
 * person can have more than one address. A record with no netid is a possible second record
 * of the same person, so it decides nothing, and so does an email alias stored as a netid,
 * which names no one (#5740).
 */
export function identityWitnessesConflict(
  holder: PersonIdentityWitnesses,
  person: PersonIdentityWitnesses,
): boolean {
  if (holder._id !== undefined && String(holder._id) === String(person._id ?? '')) return false;
  const holderNetid = netidOf(holder);
  const personNetid = netidOf(person);
  return (
    looksLikeYaleNetid(holderNetid) &&
    looksLikeYaleNetid(personNetid) &&
    holderNetid !== personNetid
  );
}

/**
 * Whether the Yale directory pairs the person's own addresses with a netid other than the
 * candidate's and never with the candidate's, so a name or page match would join two people
 * (#5765).
 * A candidate with no netid of Yale shape, or one the directory does not hold, decides nothing,
 * as in `identityWitnessesConflict` and `profilePageContradictsNetid`.
 */
export function directoryPairsAddressesWithAnotherNetid(
  addresses: readonly unknown[],
  candidate: PersonIdentityWitnesses,
  directory: DirectoryNetidsByAddress,
): boolean {
  const candidateNetid = netidOf(candidate);
  if (!looksLikeYaleNetid(candidateNetid)) return false;
  const pairedNetids = new Set<string>();
  for (const address of addresses) {
    for (const netid of directory.get(lower(address)) ?? []) {
      if (looksLikeYaleNetid(netid)) pairedNetids.add(netid);
    }
  }
  if (pairedNetids.size === 0 || pairedNetids.has(candidateNetid)) return false;
  for (const named of directory.values()) if (named.has(candidateNetid)) return true;
  return false;
}

export interface OfficialProfileLinkHolderOptions {
  /**
   * The engine's observation read scope. With it, the page's own stated email decides a
   * conflict it can witness; without it the guard keeps refusing every conflict.
   */
  readScope?: Record<string, unknown>;
}

/**
 * Whether the page's own identity settles a netid conflict for the candidate: the directory
 * pairs the page's stated email with the candidate's netid and not with any conflicting
 * holder's. When it witnesses both, neither, or only a holder, nothing is settled (#5733).
 */
export function pageWitnessSettlesConflictForCandidate(
  pageOwners: ProfilePageOwnerNetids | undefined,
  url: unknown,
  person: PersonIdentityWitnesses,
  conflictingHolders: readonly PersonIdentityWitnesses[],
): boolean {
  if (!pageOwners) return false;
  const named = pageOwners.byPage.get(normalizeOfficialProfileDestination(String(url ?? '')));
  if (!named || named.size === 0) return false;
  if (!named.has(netidOf(person))) return false;
  return conflictingHolders.every((holder) => !named.has(netidOf(holder)));
}

/**
 * Whether another live researcher whose netid conflicts with this person's already carries
 * the page as a `YALE_OFFICIAL` link. Every writer of that link asks this before stamping:
 * a person page belongs to one person, so the second netid on it is the wrong one, and the
 * join and title rules that read the link as identity would graft one person's evidence onto
 * the other (#5605). A twin of the same person, with one netid or none, is not refused.
 *
 * The refusal is not symmetric when the page can say whose it is: a holder that reached the
 * page first under someone else's identity must not lock the page's own owner out of it, so
 * a page whose stated email names the candidate and no conflicting holder lets the candidate
 * through (#5733). The writer still only adds; the holder keeps its link until its own
 * evidence or a refusal takes it away.
 */
export async function officialProfileLinkHeldByConflictingIdentity(
  url: unknown,
  person: PersonIdentityWitnesses,
  options: OfficialProfileLinkHolderOptions = {},
): Promise<boolean> {
  if (!netidOf(person)) return false;
  const pattern = officialProfileDestinationStoredPattern(typeof url === 'string' ? url : '');
  if (!pattern) return false;
  // The writers run connected; an unconnected caller has no holder to read.
  if (mongoose.connection.readyState !== 1) return false;
  const holders = (await Researcher.find({
    archived: { $ne: true },
    profileLinks: { $elemMatch: { kind: 'YALE_OFFICIAL', url: pattern } },
  })
    .select('_id identifiers.netid')
    .limit(10)
    .lean()) as unknown as PersonIdentityWitnesses[];
  const conflicting = holders.filter((holder) => identityWitnessesConflict(holder, person));
  if (conflicting.length === 0) return false;
  if (!options.readScope) return true;
  const pageOwners = await profilePageOwnerNetids([url], options.readScope);
  return !pageWitnessSettlesConflictForCandidate(pageOwners, url, person, conflicting);
}

/**
 * Whether the page's own stated identity names this person: its email is the person's
 * address, its email or stated netid carries the person's netid, or the Yale directory pairs
 * its email with the person's netid. A name never counts, because a slug built from a display
 * name names every namesake equally.
 */
export function pageIdentityWitnessesPerson(
  page: OfficialProfilePageIdentity | undefined,
  person: PersonIdentityWitnesses,
  directory?: DirectoryNetidsByAddress,
): boolean {
  if (!page) return false;
  const pageEmail = lower(page.email);
  const pageNetid = lower(page.netid);
  const personEmail = emailOf(person);
  const personNetid = netidOf(person);
  if (pageEmail && personEmail && pageEmail === personEmail) return true;
  if (!personNetid) return false;
  if (pageNetid && pageNetid === personNetid) return true;
  const localPart = pageEmail.split('@')[0] ?? '';
  if (pageEmail.endsWith('@yale.edu') && BARE_NETID.test(localPart) && localPart === personNetid)
    return true;
  return Boolean(pageEmail && directory?.get(pageEmail)?.has(personNetid));
}
