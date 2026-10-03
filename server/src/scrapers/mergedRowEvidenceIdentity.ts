import mongoose from 'mongoose';
import type { MergedInResearchEntityRow } from '../services/researchEntityCanonicalTombstone';
import { serializedDocumentId } from '../utils/idSerialization';

export interface MergedRowEvidenceSubject {
  _id?: unknown;
  slug?: unknown;
}

export interface MergedRowEvidenceObservation {
  entityId?: unknown;
  entityKey?: unknown;
}

export type MergedInRowRef = Pick<MergedInResearchEntityRow, '_id' | 'slug'>;

export interface MergedRowEvidenceIdentity {
  readonly rowMember: string;
  readonly entityIds: ReadonlySet<string>;
  readonly entityKeys: ReadonlySet<string>;
  readonly memberSlugs: ReadonlyMap<string, string>;
  readonly memberByEntityId: ReadonlyMap<string, string>;
  readonly memberByEntityKey: ReadonlyMap<string, string>;
}

const slugText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const memberTokenOf = (member: MergedRowEvidenceSubject): string => {
  const id = serializedDocumentId(member._id);
  if (id) return `id:${id}`;
  const slug = slugText(member.slug);
  return slug ? `key:${slug}` : '';
};

export function mergedRowEvidenceIdentity(
  row: MergedRowEvidenceSubject,
  mergedIn: ReadonlyArray<MergedInRowRef> = [],
): MergedRowEvidenceIdentity {
  const memberSlugs = new Map<string, string>();
  const memberByEntityId = new Map<string, string>();
  const memberByEntityKey = new Map<string, string>();
  for (const member of [row, ...mergedIn]) {
    const token = memberTokenOf(member);
    if (!token || memberSlugs.has(token)) continue;
    const slug = slugText(member.slug);
    memberSlugs.set(token, slug);
    const id = serializedDocumentId(member._id);
    if (id && !memberByEntityId.has(id)) memberByEntityId.set(id, token);
    if (slug && !memberByEntityKey.has(slug)) memberByEntityKey.set(slug, token);
  }
  return {
    rowMember: memberTokenOf(row),
    entityIds: new Set(memberByEntityId.keys()),
    entityKeys: new Set(memberByEntityKey.keys()),
    memberSlugs,
    memberByEntityId,
    memberByEntityKey,
  };
}

/**
 * The member row an observation was filed under. An observation anchored to an id belongs to
 * that id alone, so a shared or re-minted slug cannot borrow another row's evidence (#1131).
 */
export function evidenceMemberOf(
  identity: MergedRowEvidenceIdentity,
  observation: MergedRowEvidenceObservation,
): string | undefined {
  const entityId = serializedDocumentId(observation.entityId);
  if (entityId) return identity.memberByEntityId.get(entityId);
  const entityKey = slugText(observation.entityKey);
  return entityKey ? identity.memberByEntityKey.get(entityKey) : undefined;
}

export function observationBelongsToMergedRow(
  identity: MergedRowEvidenceIdentity,
  observation: MergedRowEvidenceObservation,
): boolean {
  return evidenceMemberOf(identity, observation) !== undefined;
}

export function mergedInMemberOf(
  identity: MergedRowEvidenceIdentity,
  observation: MergedRowEvidenceObservation,
): { member: string; slug: string } | undefined {
  const member = evidenceMemberOf(identity, observation);
  if (member === undefined || member === identity.rowMember) return undefined;
  return { member, slug: identity.memberSlugs.get(member) ?? '' };
}

export function mergedInEntityKeysAndIds(identity: MergedRowEvidenceIdentity): string[] {
  const mergedIn = new Set<string>();
  for (const [id, member] of identity.memberByEntityId) {
    if (member !== identity.rowMember) mergedIn.add(id);
  }
  for (const [key, member] of identity.memberByEntityKey) {
    if (member !== identity.rowMember) mergedIn.add(key);
  }
  return [...mergedIn];
}

export function mergedRowEvidenceQueryClauses(
  identities: ReadonlyArray<Pick<MergedRowEvidenceIdentity, 'entityIds' | 'entityKeys'>>,
): Array<Record<string, unknown>> {
  const entityIds = [...new Set(identities.flatMap((identity) => [...identity.entityIds]))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const entityKeys = [...new Set(identities.flatMap((identity) => [...identity.entityKeys]))];
  const clauses: Array<Record<string, unknown>> = [];
  if (entityIds.length > 0) clauses.push({ entityId: { $in: entityIds } });
  if (entityKeys.length > 0) clauses.push({ entityId: null, entityKey: { $in: entityKeys } });
  return clauses;
}
