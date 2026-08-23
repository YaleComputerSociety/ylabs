import mongoose from 'mongoose';
import { Account } from '../models/account';
import {
  Researcher,
  isValidOrcid,
  type ResearcherDisplayProfile,
  type ResearcherProfileLink,
} from '../models/researcher';
import {
  RoleAssignment,
  roleAssignmentRoles,
  type RoleAssignmentRole,
  type RoleAssignmentRosterProvenance,
} from '../models/roleAssignment';
import { User } from '../models/user';
import { LEGACY_ROLE_BY_CANONICAL } from '../models/canonicalRoleMapping';
import { serializedDocumentId } from '../utils/idSerialization';

export interface ResearchEntityRosterEntry {
  researchEntityId: mongoose.Types.ObjectId;
  personId: mongoose.Types.ObjectId;
  accountId?: mongoose.Types.ObjectId;
  roleAssignmentId: mongoose.Types.ObjectId;
  name: string;
  netid: string;
  email: string;
  title?: string;
  primaryDepartment?: string;
  imageUrl?: string;
  websiteUrl?: string;
  role: string;
  roleCanonical: RoleAssignmentRole;
  state: string;
  isCurrentMember: boolean;
  startedAt?: Date;
  endedAt?: Date;
  confidence: number;
  reviewStatus: string;
  profileLinks: ResearcherProfileLink[];
  rosterProvenance?: RoleAssignmentRosterProvenance;
}

const uniqueObjectIds = (values: unknown[]): mongoose.Types.ObjectId[] => {
  const seen = new Set<string>();
  const out: mongoose.Types.ObjectId[] = [];
  for (const value of values) {
    if (!(value instanceof mongoose.Types.ObjectId)) continue;
    const id = value.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
};

const normalizeEntityObjectId = (value: unknown): mongoose.Types.ObjectId | null => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const id = serializedDocumentId(value);
  return id && mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null;
};

interface RosterEntryBuildContext {
  peopleById: Map<
    string,
    {
      displayName?: string;
      accountId?: mongoose.Types.ObjectId;
      profile?: ResearcherDisplayProfile;
      profileLinks?: ResearcherProfileLink[];
    }
  >;
  accountsById: Map<string, { netid?: string; email?: string }>;
}

const buildRosterEntry = (
  assignment: Record<string, any>,
  context: RosterEntryBuildContext,
): ResearchEntityRosterEntry | null => {
  const entityId = normalizeEntityObjectId(assignment?.target?.id);
  const personId =
    assignment?.personId instanceof mongoose.Types.ObjectId ? assignment.personId : null;
  if (!entityId || !personId) return null;

  const person = context.peopleById.get(personId.toString());
  if (!person) return null;

  const account = person.accountId
    ? context.accountsById.get(person.accountId.toString())
    : undefined;
  const roleCanonical = assignment.role as RoleAssignmentRole;
  const legacyRole = LEGACY_ROLE_BY_CANONICAL[roleCanonical];
  if (!legacyRole) return null;

  return {
    researchEntityId: entityId,
    personId,
    ...(person.accountId ? { accountId: person.accountId } : {}),
    roleAssignmentId: assignment._id,
    name: person.displayName || '',
    netid: account?.netid || '',
    email: account?.email || '',
    ...(person.profile?.title ? { title: person.profile.title } : {}),
    ...(person.profile?.primaryDepartment
      ? { primaryDepartment: person.profile.primaryDepartment }
      : {}),
    ...(person.profile?.imageUrl ? { imageUrl: person.profile.imageUrl } : {}),
    ...(person.profile?.websiteUrl ? { websiteUrl: person.profile.websiteUrl } : {}),
    role: legacyRole,
    roleCanonical,
    state: assignment.state,
    isCurrentMember: assignment.state === 'CURRENT',
    ...(assignment.startedAt ? { startedAt: assignment.startedAt } : {}),
    ...(assignment.endedAt ? { endedAt: assignment.endedAt } : {}),
    confidence: typeof assignment.confidence === 'number' ? assignment.confidence : 0,
    reviewStatus: assignment.reviewStatus,
    profileLinks: Array.isArray(person.profileLinks) ? person.profileLinks : [],
    ...(assignment.rosterProvenance
      ? { rosterProvenance: assignment.rosterProvenance as RoleAssignmentRosterProvenance }
      : {}),
  };
};

const canonicalRolePriority = (role: RoleAssignmentRole): number => {
  const index = roleAssignmentRoles.indexOf(role);
  return index === -1 ? roleAssignmentRoles.length : index;
};

const collapseRosterEntriesByPerson = (
  entries: ResearchEntityRosterEntry[],
): ResearchEntityRosterEntry[] => {
  const bestByPerson = new Map<string, ResearchEntityRosterEntry>();
  const order: string[] = [];
  const outranks = (
    candidate: ResearchEntityRosterEntry,
    incumbent: ResearchEntityRosterEntry,
  ): boolean => {
    if (candidate.isCurrentMember !== incumbent.isCurrentMember) return candidate.isCurrentMember;
    return canonicalRolePriority(candidate.roleCanonical) < canonicalRolePriority(incumbent.roleCanonical);
  };
  for (const entry of entries) {
    const personKey = entry.personId.toString();
    const incumbent = bestByPerson.get(personKey);
    if (!incumbent) {
      bestByPerson.set(personKey, entry);
      order.push(personKey);
    } else if (outranks(entry, incumbent)) {
      bestByPerson.set(personKey, entry);
    }
  }
  return order.map((personKey) => bestByPerson.get(personKey) as ResearchEntityRosterEntry);
};

export async function getResearchEntityRosterByEntityId(
  entityIds: unknown[],
): Promise<Map<string, ResearchEntityRosterEntry[]>> {
  const byEntityId = new Map<string, ResearchEntityRosterEntry[]>();
  const normalizedEntityIds = uniqueObjectIds(entityIds.map(normalizeEntityObjectId));
  if (normalizedEntityIds.length === 0) return byEntityId;

  const assignments = await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: normalizedEntityIds },
    archived: { $ne: true },
  }).lean();
  if (assignments.length === 0) return byEntityId;

  const personIds = uniqueObjectIds(assignments.map((assignment: any) => assignment.personId));
  const people = personIds.length
    ? await Researcher.find({ _id: { $in: personIds }, archived: { $ne: true } })
        .select('_id displayName accountId profile profileLinks')
        .lean()
    : [];

  const peopleById = new Map<
    string,
    {
      displayName?: string;
      accountId?: mongoose.Types.ObjectId;
      profile?: ResearcherDisplayProfile;
      profileLinks?: ResearcherProfileLink[];
    }
  >(people.map((person: any) => [person._id.toString(), person]));

  const accountIds = uniqueObjectIds(people.map((person: any) => person.accountId));
  const accounts = accountIds.length
    ? await Account.find({ _id: { $in: accountIds } })
        .select('_id netid email')
        .lean()
    : [];
  const accountsById = new Map<string, { netid?: string; email?: string }>(
    accounts.map((account: any) => [account._id.toString(), account]),
  );

  for (const assignment of assignments as any[]) {
    const entry = buildRosterEntry(assignment, { peopleById, accountsById });
    if (!entry) continue;
    const key = serializedDocumentId(entry.researchEntityId);
    if (!key) continue;
    byEntityId.set(key, [...(byEntityId.get(key) || []), entry]);
  }

  for (const [entityKey, entries] of byEntityId) {
    byEntityId.set(entityKey, collapseRosterEntriesByPerson(entries));
  }

  return byEntityId;
}

export async function getResearchEntityRoster(
  entityId: unknown,
): Promise<ResearchEntityRosterEntry[]> {
  const key = serializedDocumentId(normalizeEntityObjectId(entityId));
  if (!key) return [];
  const byEntityId = await getResearchEntityRosterByEntityId([entityId]);
  return byEntityId.get(key) || [];
}

const normalizedResolverOrcid = (value: unknown): string | undefined => {
  const orcid = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return orcid && isValidOrcid(orcid) ? orcid : undefined;
};

export async function resolveResearcherIdForLegacyUser(
  userId?: unknown,
): Promise<mongoose.Types.ObjectId | undefined> {
  let netid: string | undefined;
  let orcid: string | undefined;
  let displayName: string | undefined;

  const uid = normalizeEntityObjectId(userId);
  if (uid) {
    const user: any = await User.findById(uid).select('netid orcid fname lname displayName').lean();
    if (user) {
      netid = typeof user.netid === 'string' ? user.netid.trim().toLowerCase() : undefined;
      orcid = normalizedResolverOrcid(user.orcid);
      displayName =
        (typeof user.displayName === 'string' && user.displayName.trim()) ||
        [user.fname, user.lname].filter(Boolean).join(' ').trim() ||
        undefined;
    }
  }

  if (netid) {
    const account: any = await Account.findOne({ netid }).select('_id').lean();
    if (account?._id) {
      const researcher: any = await Researcher.findOne({ accountId: account._id })
        .select('_id')
        .lean();
      if (researcher?._id) return researcher._id;
    }
  }
  if (orcid) {
    const researcher: any = await Researcher.findOne({ 'identifiers.orcid': orcid })
      .select('_id')
      .lean();
    if (researcher?._id) return researcher._id;
  }
  if (displayName) {
    const matches: any[] = await Researcher.find({ displayName, archived: { $ne: true } })
      .select('_id')
      .limit(2)
      .lean();
    if (matches.length === 1) return matches[0]._id;
  }
  return undefined;
}
