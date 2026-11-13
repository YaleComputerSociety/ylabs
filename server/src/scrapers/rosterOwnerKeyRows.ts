import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { personProfileIdentityFromUrl } from '../scripts/researchEntityPiDedupeCore';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';
import { userKeyNamesRoleOrUnitMailbox } from './roleMailboxUserKey';

/**
 * One person on two department rosters (#5969).
 *
 * The roster lane keys a person by their own Yale mailbox (`netid:<local part>`) and
 * keys the research row it mints by roster (`dept-<roster>-<name>`), so a person listed
 * by two rosters used to get two rows. Measured on Development on 2026-11-12, 352 people
 * had roster rows on two or more rosters and 2 still had two live rows, both served,
 * because their lead edges resolved to two different researchers and every same-lead
 * guard keys on the lead.
 *
 * The witness here is the mailbox and never the name: a `dept:<roster>:<slug>` key is a
 * name and never attaches, and an office or role mailbox never attaches. A shared lead
 * researcher id is not a witness either, because a blind ballot found it wrong-person on
 * 4 of 17 pairs. The name is only a refusal: a candidate row whose name does not carry
 * the entry's surname means two people share the address, so nothing attaches.
 */

const ROSTER_SOURCE_NAME = 'dept-faculty-roster';
const ATTACH_WITNESS_KEY = /^netid:[a-z0-9._-]+$/i;

export interface RosterOwnerKeyRow {
  id: string;
  slug: string;
  rosterPrefix: string;
  createdAt?: Date | string | null;
  mintedFromRosterHost: string;
  leadPrimaryIdentityUrls: string[];
}

export type RosterOwnerKeyRows = ReadonlyMap<string, readonly RosterOwnerKeyRow[]>;
export type RosterOwnerKeyRowLoader = () => Promise<RosterOwnerKeyRows>;

export function rosterOwnerKeyIsAttachWitness(ownerKey: string | undefined | null): boolean {
  const key = String(ownerKey || '').trim();
  if (!ATTACH_WITNESS_KEY.test(key)) return false;
  return !userKeyNamesRoleOrUnitMailbox(key, []);
}

function hostOf(value: string | undefined | null): string {
  try {
    return new URL(String(value || '').trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugTokens(slug: string): string[] {
  return slug.toLowerCase().split('-').filter(Boolean);
}

function surnameToken(name: string | undefined | null): string {
  const tokens = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
  return tokens.at(-1) || '';
}

export function rowNamesRosterPerson(
  row: Pick<RosterOwnerKeyRow, 'slug' | 'rosterPrefix'>,
  personName: string,
): boolean {
  const surname = surnameToken(personName);
  if (!surname) return false;
  const nameSlug = row.slug.startsWith(row.rosterPrefix)
    ? row.slug.slice(row.rosterPrefix.length)
    : row.slug;
  return slugTokens(nameSlug).includes(surname);
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/**
 * The one row a person's roster appointments attach to: the row minted by the roster of
 * the person's own official profile when exactly one candidate is, else the oldest row,
 * then the lowest slug. Every input is corpus state, so each roster's run derives the
 * same target and the second run changes nothing.
 */
export function selectRosterAttachTarget(
  candidates: readonly RosterOwnerKeyRow[],
): RosterOwnerKeyRow | undefined {
  if (candidates.length === 0) return undefined;
  const primaryUrl = [...new Set(candidates.flatMap((row) => row.leadPrimaryIdentityUrls))]
    .sort()
    .find((url) => Boolean(personProfileIdentityFromUrl(url)));
  const appointmentHost = hostOf(primaryUrl);
  if (appointmentHost) {
    const onAppointmentRoster = candidates.filter(
      (row) => row.mintedFromRosterHost !== '' && row.mintedFromRosterHost === appointmentHost,
    );
    if (onAppointmentRoster.length === 1) return onAppointmentRoster[0];
  }
  return [...candidates].sort(
    (a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || a.slug.localeCompare(b.slug),
  )[0];
}

export interface RosterAttachDecision {
  targetSlug: string;
  reason: 'mint-own' | 'attach-existing' | 'attach-minted-this-run' | 'refused-name-disagrees';
}

/**
 * Whether this roster entry mints its own row or attaches to the person's existing
 * roster row on another roster. `mintedThisRun` covers two rosters listing the person
 * in one run before either row exists.
 */
export function decideRosterAttach(input: {
  ownerKey: string;
  ownSlug: string;
  ownRosterPrefix: string;
  personName: string;
  rowsByOwnerKey: RosterOwnerKeyRows;
  mintedThisRun: ReadonlyMap<string, RosterOwnerKeyRow>;
}): RosterAttachDecision {
  const mintOwn: RosterAttachDecision = { targetSlug: input.ownSlug, reason: 'mint-own' };
  if (!input.ownSlug || !rosterOwnerKeyIsAttachWitness(input.ownerKey)) return mintOwn;
  const rows = input.rowsByOwnerKey.get(input.ownerKey) ?? [];
  const ownRow = rows.find((row) => row.slug === input.ownSlug);
  const elsewhere = rows.filter((row) => row.rosterPrefix !== input.ownRosterPrefix);
  if (elsewhere.length > 0) {
    if (elsewhere.some((row) => !rowNamesRosterPerson(row, input.personName))) {
      return { targetSlug: input.ownSlug, reason: 'refused-name-disagrees' };
    }
    const target = selectRosterAttachTarget(ownRow ? [ownRow, ...elsewhere] : elsewhere);
    if (!target || target.slug === input.ownSlug) return mintOwn;
    return { targetSlug: target.slug, reason: 'attach-existing' };
  }
  if (ownRow) return mintOwn;
  const minted = input.mintedThisRun.get(input.ownerKey);
  if (!minted || minted.rosterPrefix === input.ownRosterPrefix) return mintOwn;
  if (!rowNamesRosterPerson(minted, input.personName)) {
    return { targetSlug: input.ownSlug, reason: 'refused-name-disagrees' };
  }
  return { targetSlug: minted.slug, reason: 'attach-minted-this-run' };
}

/**
 * Live roster rows grouped by the mailbox key the roster read them under. Two reads:
 * the live `dept-*` rows and their roster `inferredPiUserKey` observations, both on
 * indexed paths, then the lead researchers' primary identity links for the target rule.
 */
export async function loadRosterOwnerKeyRows(
  rosterPrefixForSlug: (slug: string) => string,
  rosterHostForPrefix: (prefix: string) => string,
): Promise<Map<string, RosterOwnerKeyRow[]>> {
  const byKey = new Map<string, RosterOwnerKeyRow[]>();
  if (!mongooseConnectionWasOpened()) return byKey;
  const rows = (await ResearchEntity.find(
    { slug: { $regex: '^dept-' }, archived: { $ne: true } },
    { _id: 1, slug: 1, createdAt: 1 },
  ).lean()) as Array<{ _id: mongoose.Types.ObjectId; slug?: string; createdAt?: Date }>;
  const rosterRows = rows.filter((row) => row.slug && rosterPrefixForSlug(row.slug));
  if (rosterRows.length === 0) return byKey;
  const keyObservations = (await Observation.find(
    {
      entityType: 'researchEntity',
      entityKey: { $in: rosterRows.map((row) => row.slug as string) },
      field: 'inferredPiUserKey',
      sourceName: ROSTER_SOURCE_NAME,
      superseded: false,
    },
    { entityKey: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: string; value?: unknown }>;
  const keysBySlug = new Map<string, Set<string>>();
  for (const observation of keyObservations) {
    if (!observation.entityKey || typeof observation.value !== 'string') continue;
    if (!rosterOwnerKeyIsAttachWitness(observation.value)) continue;
    const keys = keysBySlug.get(observation.entityKey) ?? new Set<string>();
    keys.add(observation.value);
    keysBySlug.set(observation.entityKey, keys);
  }
  const keyedRows = rosterRows.filter((row) => keysBySlug.get(row.slug as string)?.size === 1);
  const edges = (await RoleAssignment.find(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': { $in: keyedRows.map((row) => row._id) },
      role: { $in: [...LEAD_ROLE_CANONICAL_VALUES] },
      state: { $ne: 'HISTORICAL' },
      archived: { $ne: true },
    },
    { personId: 1, 'target.id': 1 },
  ).lean()) as Array<{ personId?: unknown; target?: { id?: unknown } }>;
  const leads = (await Researcher.find(
    { _id: { $in: edges.map((edge) => edge.personId).filter(Boolean) } },
    { profileLinks: 1 },
  ).lean()) as Array<{ _id: unknown; profileLinks?: Array<{ purpose?: string; url?: string }> }>;
  const primaryByPerson = new Map(
    leads.map((lead) => [
      String(lead._id),
      (lead.profileLinks || [])
        .filter((link) => link.purpose === 'PRIMARY_IDENTITY' && typeof link.url === 'string')
        .map((link) => link.url as string),
    ]),
  );
  const primaryByRow = new Map<string, string[]>();
  for (const edge of edges) {
    const id = String(edge.target?.id);
    primaryByRow.set(id, [
      ...(primaryByRow.get(id) ?? []),
      ...(primaryByPerson.get(String(edge.personId)) ?? []),
    ]);
  }
  for (const row of keyedRows) {
    const slug = row.slug as string;
    const [ownerKey] = [...(keysBySlug.get(slug) as Set<string>)];
    const rosterPrefix = rosterPrefixForSlug(slug);
    const list = byKey.get(ownerKey) ?? [];
    list.push({
      id: String(row._id),
      slug,
      rosterPrefix,
      createdAt: row.createdAt ?? null,
      mintedFromRosterHost: rosterHostForPrefix(rosterPrefix),
      leadPrimaryIdentityUrls: primaryByRow.get(String(row._id)) ?? [],
    });
    byKey.set(ownerKey, list);
  }
  return byKey;
}

export function rosterHostOfUrl(url: string | undefined | null): string {
  return hostOf(url);
}
