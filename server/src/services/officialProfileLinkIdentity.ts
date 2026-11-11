import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import { officialProfileDestinationStoredPattern } from './leadProfileIdentity';
import type { DirectoryNetidsByAddress } from '../scrapers/directoryContradictedProfileNetid';

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
 * of the same person, so it decides nothing.
 */
export function identityWitnessesConflict(
  holder: PersonIdentityWitnesses,
  person: PersonIdentityWitnesses,
): boolean {
  if (holder._id !== undefined && String(holder._id) === String(person._id ?? '')) return false;
  const holderNetid = netidOf(holder);
  const personNetid = netidOf(person);
  return Boolean(holderNetid) && Boolean(personNetid) && holderNetid !== personNetid;
}

/**
 * Whether another live researcher whose netid conflicts with this person's already carries
 * the page as a `YALE_OFFICIAL` link. Every writer of that link asks this before stamping:
 * a person page belongs to one person, so the second netid on it is the wrong one, and the
 * join and title rules that read the link as identity would graft one person's evidence onto
 * the other (#5605). A twin of the same person, with one netid or none, is not refused.
 */
export async function officialProfileLinkHeldByConflictingIdentity(
  url: unknown,
  person: PersonIdentityWitnesses,
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
  return holders.some((holder) => identityWitnessesConflict(holder, person));
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
