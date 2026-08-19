import mongoose from 'mongoose';
import { Account } from '../models/account';
import { Researcher, isValidOrcid } from '../models/researcher';
import {
  RoleAssignment,
  type RoleAssignmentReviewStatus,
  type RoleAssignmentState,
} from '../models/roleAssignment';
import {
  canonicalRoleForLegacy,
  clampConfidence,
  reviewStatusForLegacyMembership,
  roleStateForLegacyMembership,
} from '../models/canonicalRoleMapping';
import { sanitizeLogValue } from '../utils/logSanitizer';

const toObjectId = (value: unknown): mongoose.Types.ObjectId | undefined => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return undefined;
};

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizedEmail = (value: unknown): string | undefined => {
  const email = trimmed(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
};

const normalizedNetid = (value: unknown): string | undefined => {
  const netid = trimmed(value).toLowerCase();
  return /^[a-z]{2,3}\d{1,6}$/.test(netid) ? netid : undefined;
};

const normalizedOrcid = (value: unknown): string | undefined => {
  const orcid = trimmed(value).toUpperCase();
  return orcid && isValidOrcid(orcid) ? orcid : undefined;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: number }).code === 11000);

export interface CanonicalMemberIdentity {
  netid?: unknown;
  email?: unknown;
  orcid?: unknown;
  displayName?: unknown;
  hasCanonicalSourceReference?: boolean;
}

export interface CanonicalMemberFacts {
  legacyRole: string;
  displayName?: string;
  evidenceStatus?: string | null;
  isCurrentMember?: boolean;
  archived?: boolean;
  confidence?: unknown;
  startedAt?: Date;
  endedAt?: Date | null;
}

export interface CanonicalRoleAssignmentUpsert {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
}

export function buildCanonicalRoleAssignmentUpsert(
  personId: mongoose.Types.ObjectId,
  researchEntityId: mongoose.Types.ObjectId,
  legacyRole: string,
  options: {
    state: RoleAssignmentState;
    confidence: number;
    reviewStatus: RoleAssignmentReviewStatus;
    startedAt?: Date;
    endedAt?: Date | null;
  },
): CanonicalRoleAssignmentUpsert | null {
  const role = canonicalRoleForLegacy(legacyRole);
  if (!role) return null;

  const filter = {
    personId,
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': researchEntityId,
    role,
  };
  const set: Record<string, unknown> = {
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
    role,
    state: options.state,
    confidence: clampConfidence(options.confidence),
    reviewStatus: options.reviewStatus,
    archived: false,
  };
  const update: Record<string, unknown> = {
    $set: set,
    $setOnInsert: {
      startedAt: options.startedAt ?? new Date(),
      evidenceClaimIds: [],
    },
  };
  if (options.state === 'HISTORICAL' && options.endedAt) {
    set.endedAt = options.endedAt;
  } else {
    update.$unset = { endedAt: '' };
  }
  return { filter, update };
}

async function resolveOrCreateAccountId(
  identity: CanonicalMemberIdentity,
): Promise<mongoose.Types.ObjectId | undefined> {
  const netid = normalizedNetid(identity.netid);
  const email = normalizedEmail(identity.email);
  if (!netid || !email) return undefined;
  try {
    const account = await Account.findOneAndUpdate(
      { netid },
      { $setOnInsert: { netid, email, status: 'UNKNOWN', archived: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
      .select('_id')
      .lean();
    return toObjectId((account as { _id?: unknown } | null)?._id);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await Account.findOne({ netid }).select('_id').lean();
      return toObjectId((existing as { _id?: unknown } | null)?._id);
    }
    throw error;
  }
}

async function resolveOrCreateResearcherId(
  identity: CanonicalMemberIdentity,
  accountId: mongoose.Types.ObjectId | undefined,
): Promise<mongoose.Types.ObjectId | undefined> {
  const displayName = trimmed(identity.displayName);
  const orcid = normalizedOrcid(identity.orcid);

  if (accountId) {
    const setOnInsert: Record<string, unknown> = {
      profileLinks: [],
      archived: false,
      accountId,
    };
    if (displayName) setOnInsert.displayName = displayName;
    try {
      const researcher = await Researcher.findOneAndUpdate(
        { accountId },
        { $setOnInsert: setOnInsert },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
        .select('_id')
        .lean();
      return toObjectId((researcher as { _id?: unknown } | null)?._id);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const existing = await Researcher.findOne({ accountId }).select('_id').lean();
        return toObjectId((existing as { _id?: unknown } | null)?._id);
      }
      throw error;
    }
  }

  if (orcid) {
    const existing = await Researcher.findOne({ 'identifiers.orcid': orcid })
      .select('_id accountId')
      .lean();
    if (existing) {
      const existingAccountId = toObjectId((existing as { accountId?: unknown }).accountId);
      if (existingAccountId) return undefined;
      return toObjectId((existing as { _id?: unknown })._id);
    }
    if (!displayName) return undefined;
    try {
      const created = await Researcher.create({
        displayName,
        identifiers: { orcid },
        profileLinks: [],
        archived: false,
      });
      return toObjectId(created._id);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        const fallback = await Researcher.findOne({ 'identifiers.orcid': orcid })
          .select('_id accountId')
          .lean();
        if (fallback && toObjectId((fallback as { accountId?: unknown }).accountId))
          return undefined;
        return toObjectId((fallback as { _id?: unknown } | null)?._id);
      }
      throw error;
    }
  }

  if (!displayName) return undefined;
  const nameMatches = await Researcher.find({ displayName, archived: { $ne: true } })
    .select('_id accountId identifiers')
    .limit(2)
    .lean();
  if (nameMatches.length === 1) {
    const match = nameMatches[0] as {
      _id?: unknown;
      accountId?: unknown;
      identifiers?: { orcid?: unknown };
    };
    if (!toObjectId(match.accountId) && !match.identifiers?.orcid) {
      return toObjectId(match._id);
    }
  }
  const created = await Researcher.create({ displayName, profileLinks: [], archived: false });
  return toObjectId(created._id);
}

export async function resolveCanonicalResearcherId(
  identity: CanonicalMemberIdentity,
): Promise<mongoose.Types.ObjectId | undefined> {
  const displayName = trimmed(identity.displayName);
  const orcid = normalizedOrcid(identity.orcid);
  const netid = normalizedNetid(identity.netid);
  if (netid) {
    const account = await Account.findOne({ netid }).select('_id').lean();
    const accountId = toObjectId((account as { _id?: unknown } | null)?._id);
    if (accountId) {
      const researcher = await Researcher.findOne({ accountId }).select('_id').lean();
      const personId = toObjectId((researcher as { _id?: unknown } | null)?._id);
      if (personId) return personId;
    }
  }
  if (orcid) {
    const researcher = await Researcher.findOne({ 'identifiers.orcid': orcid })
      .select('_id')
      .lean();
    const personId = toObjectId((researcher as { _id?: unknown } | null)?._id);
    if (personId) return personId;
  }
  if (displayName) {
    const matches = await Researcher.find({ displayName, archived: { $ne: true } })
      .select('_id')
      .limit(2)
      .lean();
    if (matches.length === 1) return toObjectId((matches[0] as { _id?: unknown })._id);
  }
  return undefined;
}

export async function materializeCanonicalMembership(
  researchEntityId: string,
  facts: CanonicalMemberFacts,
  identity: CanonicalMemberIdentity,
): Promise<void> {
  const entityObjectId = toObjectId(researchEntityId);
  if (!entityObjectId) return;
  if (!canonicalRoleForLegacy(facts.legacyRole)) return;

  const state = roleStateForLegacyMembership(facts);
  const resolution = identity.hasCanonicalSourceReference
    ? 'CANONICAL_SOURCE_REFERENCE'
    : undefined;
  const reviewStatus = reviewStatusForLegacyMembership(facts, state, resolution);

  try {
    const accountId = await resolveOrCreateAccountId(identity);
    const personId = await resolveOrCreateResearcherId(identity, accountId);
    if (!personId) return;

    const upsert = buildCanonicalRoleAssignmentUpsert(personId, entityObjectId, facts.legacyRole, {
      state,
      confidence: clampConfidence(facts.confidence),
      reviewStatus,
      startedAt: facts.startedAt,
      endedAt: state === 'HISTORICAL' ? (facts.endedAt ?? undefined) : undefined,
    });
    if (!upsert) return;
    await RoleAssignment.updateOne(upsert.filter, upsert.update, { upsert: true });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      console.warn(
        `[canonical-membership] skipped canonical write for entity ${sanitizeLogValue(
          researchEntityId,
        )} due to duplicate key`,
      );
      return;
    }
    throw error;
  }
}

export async function archiveCanonicalRoleAssignmentsForPersons(
  researchEntityId: string,
  personIds: mongoose.Types.ObjectId[],
  endedAt: Date,
): Promise<void> {
  const entityObjectId = toObjectId(researchEntityId);
  if (!entityObjectId || personIds.length === 0) return;
  await RoleAssignment.updateMany(
    {
      personId: { $in: personIds },
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityObjectId,
      state: { $ne: 'HISTORICAL' },
    },
    { $set: { state: 'HISTORICAL', endedAt } },
  );
}

const CANONICAL_ROLES_SUPERSEDED_BY_DIRECTOR = ['CORE_FACULTY', 'AFFILIATED'] as const;

export async function archiveSupersededCanonicalRoleAssignments(
  researchEntityId: string,
  personId: mongoose.Types.ObjectId,
  supersededRoles: readonly string[] = CANONICAL_ROLES_SUPERSEDED_BY_DIRECTOR,
): Promise<void> {
  const entityObjectId = toObjectId(researchEntityId);
  if (!entityObjectId) return;
  await RoleAssignment.updateMany(
    {
      personId,
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityObjectId,
      role: { $in: [...supersededRoles] },
      archived: { $ne: true },
    },
    { $set: { archived: true } },
  );
}
