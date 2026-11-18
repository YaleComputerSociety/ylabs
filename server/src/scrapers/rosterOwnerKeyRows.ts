import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { personProfileIdentityFromUrl } from '../scripts/researchEntityPiDedupeCore';
import { mongooseConnectionWasOpened } from '../utils/mongooseConnectionWasOpened';
import { userKeyNamesRoleOrUnitMailbox } from './roleMailboxUserKey';
import { PERSONAL_RESEARCH_ROW_TYPES } from './utils/centerMemberProfileResearch';

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
  /**
   * The live row an earlier roster row of this person was folded into (#6536). A fold is a
   * same-person verdict already made, so it is the attach target outright.
   */
  foldSurvivor?: boolean;
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
  reason:
    | 'mint-own'
    | 'attach-existing'
    | 'attach-fold-survivor'
    | 'attach-minted-this-run'
    | 'refused-name-disagrees';
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
  const ownRow = rows.find((row) => row.slug === input.ownSlug && !row.foldSurvivor);
  const survivor = rows.find((row) => row.foldSurvivor && row.slug !== input.ownSlug);
  if (survivor && !ownRow) return { targetSlug: survivor.slug, reason: 'attach-fold-survivor' };
  const elsewhere = rows.filter(
    (row) => row.rosterPrefix !== input.ownRosterPrefix && !row.foldSurvivor,
  );
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
  if (rosterRows.length === 0) {
    await addFoldSurvivors(byKey, rosterPrefixForSlug);
    return byKey;
  }
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
  await addFoldSurvivors(byKey, rosterPrefixForSlug);
  return byKey;
}

/**
 * A roster row archived into a canonical group no longer lists as the person's row, so the
 * next roster read minted a new one beside the live survivor it had been folded into, and
 * the duplicate was folded again on the next dedupe (#6536). The survivor is listed under
 * the owner key that keyed the folded row.
 */
const MAX_FOLD_CHAIN_DEPTH = 8;

interface FoldSurvivor {
  id: string;
  slug: string;
  createdAt?: Date | null;
}

/**
 * The live person-scoped row each folded row's canonical group ends in, following a fold of a
 * fold (A into B into C) to the end. A chain that loops, runs past the depth bound, ends in
 * an archived row with no further group, or ends in a row that is not person-scoped (a fold
 * can merge a person's row into a center) resolves to nothing.
 */
async function finalFoldSurvivors(
  startIds: readonly mongoose.Types.ObjectId[],
): Promise<Map<string, FoldSurvivor | null>> {
  const resolved = new Map<string, FoldSurvivor | null>();
  const pending = new Map<string, { current: string; seen: Set<string> }>();
  for (const id of startIds) pending.set(String(id), { current: String(id), seen: new Set() });
  for (let depth = 0; depth < MAX_FOLD_CHAIN_DEPTH && pending.size > 0; depth += 1) {
    const ids = [...new Set([...pending.values()].map((walk) => walk.current))];
    const rows = (await ResearchEntity.find(
      { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
      { _id: 1, slug: 1, createdAt: 1, archived: 1, canonicalGroupId: 1, entityType: 1 },
    ).lean()) as Array<{
      _id: mongoose.Types.ObjectId;
      slug?: string;
      createdAt?: Date;
      archived?: boolean;
      canonicalGroupId?: mongoose.Types.ObjectId | null;
      entityType?: string;
    }>;
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    for (const [start, walk] of [...pending]) {
      const row = byId.get(walk.current);
      walk.seen.add(walk.current);
      if (!row) {
        resolved.set(start, null);
        pending.delete(start);
      } else if (row.archived !== true) {
        const personScoped = PERSONAL_RESEARCH_ROW_TYPES.includes(String(row.entityType));
        resolved.set(
          start,
          personScoped && row.slug
            ? { id: String(row._id), slug: row.slug, createdAt: row.createdAt ?? null }
            : null,
        );
        pending.delete(start);
      } else if (row.canonicalGroupId && !walk.seen.has(String(row.canonicalGroupId))) {
        walk.current = String(row.canonicalGroupId);
      } else {
        resolved.set(start, null);
        pending.delete(start);
      }
    }
  }
  for (const start of pending.keys()) resolved.set(start, null);
  return resolved;
}

/**
 * A roster row archived into a canonical group no longer lists as the person's row, so the
 * next roster read minted a new one beside the live survivor it had been folded into, and
 * the duplicate was folded again on the next dedupe (#6536). The survivor is listed under
 * the owner key that keyed the folded row, and only when that key reaches exactly one
 * distinct survivor, so the target never depends on read order.
 */
async function addFoldSurvivors(
  byKey: Map<string, RosterOwnerKeyRow[]>,
  rosterPrefixForSlug: (slug: string) => string,
): Promise<void> {
  const folded = (await ResearchEntity.find(
    { slug: { $regex: '^dept-' }, archived: true, canonicalGroupId: { $ne: null } },
    { slug: 1, canonicalGroupId: 1 },
  ).lean()) as Array<{ slug?: string; canonicalGroupId?: mongoose.Types.ObjectId }>;
  const foldedRoster = folded.filter(
    (row) => row.slug && row.canonicalGroupId && rosterPrefixForSlug(row.slug),
  );
  if (foldedRoster.length === 0) return;
  const survivorByGroup = await finalFoldSurvivors(
    foldedRoster.map((row) => row.canonicalGroupId as mongoose.Types.ObjectId),
  );
  const keyObservations = (await Observation.find(
    {
      entityType: 'researchEntity',
      entityKey: { $in: foldedRoster.map((row) => row.slug as string) },
      field: 'inferredPiUserKey',
      sourceName: ROSTER_SOURCE_NAME,
      superseded: false,
    },
    { entityKey: 1, value: 1 },
  ).lean()) as Array<{ entityKey?: string; value?: unknown }>;
  const ownerKeysBySlug = new Map<string, Set<string>>();
  for (const observation of keyObservations) {
    if (!observation.entityKey || typeof observation.value !== 'string') continue;
    if (!rosterOwnerKeyIsAttachWitness(observation.value)) continue;
    const keys = ownerKeysBySlug.get(observation.entityKey) ?? new Set<string>();
    keys.add(observation.value);
    ownerKeysBySlug.set(observation.entityKey, keys);
  }
  const survivorsByOwnerKey = new Map<string, Map<string, FoldSurvivor>>();
  for (const row of foldedRoster) {
    const keys = ownerKeysBySlug.get(row.slug as string);
    const survivor = survivorByGroup.get(String(row.canonicalGroupId));
    if (!keys || keys.size !== 1 || !survivor) continue;
    const [ownerKey] = [...keys];
    const reached = survivorsByOwnerKey.get(ownerKey) ?? new Map<string, FoldSurvivor>();
    reached.set(survivor.slug, survivor);
    survivorsByOwnerKey.set(ownerKey, reached);
  }
  for (const [ownerKey, reached] of survivorsByOwnerKey) {
    if (reached.size !== 1) continue;
    const [survivor] = [...reached.values()];
    const list = byKey.get(ownerKey) ?? [];
    if (list.some((candidate) => candidate.slug === survivor.slug)) continue;
    list.push({
      id: survivor.id,
      slug: survivor.slug,
      rosterPrefix: rosterPrefixForSlug(survivor.slug),
      createdAt: survivor.createdAt ?? null,
      mintedFromRosterHost: '',
      leadPrimaryIdentityUrls: [],
      foldSurvivor: true,
    });
    byKey.set(ownerKey, list);
  }
}

export function rosterHostOfUrl(url: string | undefined | null): string {
  return hostOf(url);
}
