import mongoose from 'mongoose';
import { Account } from '../models/account';
import { Researcher, isValidOrcid } from '../models/researcher';
import {
  RoleAssignment,
  roleAssignmentReattachWrite,
  type RoleAssignmentReviewStatus,
  type RoleAssignmentRosterProvenance,
  type RoleAssignmentState,
} from '../models/roleAssignment';
import {
  canonicalRoleForLegacy,
  clampConfidence,
  reviewStatusForLegacyMembership,
  roleStateForLegacyMembership,
} from '../models/canonicalRoleMapping';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { sanitizePersonName } from '../utils/personNameHygiene';
import { escapeRegex } from '../utils/regex';
import { canonicalPersonName } from './utils/personNameCasing';

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
  return /^[a-z][a-z0-9]{1,15}$/.test(netid) ? netid : undefined;
};

const normalizedOrcid = (value: unknown): string | undefined => {
  const orcid = trimmed(value).toUpperCase();
  return orcid && isValidOrcid(orcid) ? orcid : undefined;
};

const ORGANIZATIONAL_MAILBOX_LOCAL_PARTS = new Set<string>([
  'info',
  'contact',
  'admin',
  'administration',
  'office',
  'help',
  'helpdesk',
  'support',
  'webmaster',
  'postmaster',
  'hostmaster',
  'noreply',
  'donotreply',
  'mailbox',
  'general',
  'inquiries',
  'inquiry',
  'enquiries',
  'enquiry',
  'hr',
  'humanresources',
  'ithelp',
  'staff',
  'team',
  'group',
  'dept',
  'department',
  'secretary',
  'reception',
  'communications',
  'comms',
  'media',
  'press',
  'events',
  'alumni',
  'giving',
  'development',
  'registrar',
  'admissions',
  'undergrad',
  'undergraduate',
  'graduate',
  'academics',
  'facilities',
  'finance',
  'operations',
  'marketing',
  'outreach',
  'recruiting',
  'recruitment',
  'careers',
  'service',
  'services',
  'program',
  'programs',
  'center',
  'centre',
  'lab',
  'committee',
  'council',
  'society',
  'organization',
  'library',
]);

const DEPARTMENT_MAILBOX_LOCAL_PARTS = new Set<string>([
  'physics',
  'chemistry',
  'biology',
  'mathematics',
  'statistics',
  'economics',
  'history',
  'english',
  'psychology',
  'sociology',
  'philosophy',
  'engineering',
  'neuroscience',
  'genetics',
  'astronomy',
  'anthropology',
  'geology',
  'geosciences',
  'linguistics',
  'nursing',
  'medicine',
  'surgery',
  'pharmacology',
  'pathology',
  'immunology',
  'radiology',
  'pediatrics',
  'psychiatry',
  'neurology',
  'cardiology',
  'oncology',
  'biochemistry',
  'biophysics',
  'microbiology',
  'ecology',
  'geography',
  'archaeology',
  'classics',
  'divinity',
  'forestry',
  'architecture',
  'management',
  'accounting',
  'politics',
  'government',
  'religion',
  'music',
  'theater',
  'theatre',
  'humanities',
  'sciences',
  'science',
]);

const ORGANIZATIONAL_MAILBOX_SEGMENTS = new Set<string>([
  'dept',
  'department',
  'office',
  'admin',
  'info',
  'noreply',
  'donotreply',
  'mailbox',
  'helpdesk',
  'webmaster',
  'postmaster',
  'contact',
  'support',
  'inquiries',
  'enquiries',
  'reception',
  'secretary',
  'committee',
  'group',
  'team',
  'lab',
]);

const isOrganizationalMailboxLocalPart = (localPart: string): boolean => {
  const value = localPart.trim().toLowerCase();
  if (!value) return false;
  if (ORGANIZATIONAL_MAILBOX_LOCAL_PARTS.has(value)) return true;
  if (DEPARTMENT_MAILBOX_LOCAL_PARTS.has(value)) return true;
  const joined = value.replace(/[-._]+/g, '');
  if (joined !== value && ORGANIZATIONAL_MAILBOX_LOCAL_PARTS.has(joined)) return true;
  const segments = value.split(/[-._]+/).filter(Boolean);
  return segments.some((segment) => ORGANIZATIONAL_MAILBOX_SEGMENTS.has(segment));
};

export const identityIsOrganizationalMailbox = (identity: CanonicalMemberIdentity): boolean => {
  const netid = normalizedNetid(identity.netid);
  if (netid && isOrganizationalMailboxLocalPart(netid)) return true;
  const email = normalizedEmail(identity.email);
  const emailLocalPart = email?.split('@')[0] ?? '';
  return Boolean(emailLocalPart) && isOrganizationalMailboxLocalPart(emailLocalPart);
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
  rosterProvenance?: RoleAssignmentRosterProvenance;
}

const coerceProvenanceDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }
  return undefined;
};

const cleanRosterProvenance = (
  provenance: RoleAssignmentRosterProvenance | undefined,
): RoleAssignmentRosterProvenance | undefined => {
  if (!provenance) return undefined;
  const cleaned: RoleAssignmentRosterProvenance = {};
  if (trimmed(provenance.sourceName)) cleaned.sourceName = trimmed(provenance.sourceName);
  if (trimmed(provenance.sourceUrl)) cleaned.sourceUrl = trimmed(provenance.sourceUrl);
  if (trimmed(provenance.profileUrl)) cleaned.profileUrl = trimmed(provenance.profileUrl);
  if (trimmed(provenance.sectionLabel)) cleaned.sectionLabel = trimmed(provenance.sectionLabel);
  if (trimmed(provenance.evidenceStatus))
    cleaned.evidenceStatus = trimmed(provenance.evidenceStatus);
  if (trimmed(provenance.membershipKey)) cleaned.membershipKey = trimmed(provenance.membershipKey);
  const observedAt = coerceProvenanceDate(provenance.observedAt);
  if (observedAt) cleaned.observedAt = observedAt;
  const freshnessExpiresAt = coerceProvenanceDate(provenance.freshnessExpiresAt);
  if (freshnessExpiresAt) cleaned.freshnessExpiresAt = freshnessExpiresAt;
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
};

export interface CanonicalRoleAssignmentUpsert {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  reattach: {
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
  };
}

/**
 * The write that records what a source says about one person's role on one entity.
 *
 * `archived` and `reviewStatus` are deliberately NOT in the upsert's `$set`. They
 * are the two fields a retirement repair writes, and the upsert's filter matches on
 * `(personId, target, role)` only, so a `$set` of `archived: false` reached the very
 * rows a repair had just archived and silently re-attached them: measured on
 * Development, 133 of 391 retired edges were back to `archived: false` and
 * `UNREVIEWED` with the repair's own `reviewNotes` still attached, across #2880,
 * #1897 and #2768 (#3143). A repair that reports a detachment count was therefore
 * reporting a write, not an outcome.
 *
 * So re-attachment is a second, guarded write: it clears the detachment only on a
 * row that is not `DISPUTED`. A disputed row keeps its verdict and its note, and
 * only a human clearing the dispute can let a scrape re-attach it. Every other
 * field still updates on a disputed row, so a detached edge keeps accurate evidence
 * while staying off the served surface.
 *
 * It cannot be one atomic upsert with `reviewStatus: { $ne: 'DISPUTED' }` folded
 * into the filter, because `role_assignments` carries no unique index on
 * `(personId, target, role)`: a filter that skipped the disputed row would insert a
 * second, un-disputed edge for the same person and re-attach by another route.
 */
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
    rosterProvenance?: RoleAssignmentRosterProvenance;
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
  };
  const rosterProvenance = cleanRosterProvenance(options.rosterProvenance);
  if (rosterProvenance) set.rosterProvenance = rosterProvenance;
  const update: Record<string, unknown> = {
    $set: set,
    $setOnInsert: {
      startedAt: options.startedAt ?? new Date(),
      archived: false,
      reviewStatus: options.reviewStatus,
    },
  };
  if (options.state === 'HISTORICAL' && options.endedAt) {
    set.endedAt = options.endedAt;
  } else {
    update.$unset = { endedAt: '' };
  }
  return { filter, update, reattach: roleAssignmentReattachWrite(filter, options.reviewStatus) };
}

async function resolveOrCreateAccountId(
  identity: CanonicalMemberIdentity,
): Promise<mongoose.Types.ObjectId | undefined> {
  if (identityIsOrganizationalMailbox(identity)) return undefined;
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

/**
 * Netid identity has two disjoint keys, `accounts.netid` and
 * `researchers.identifiers.netid`, and the upsert below reads only the first. A
 * researcher holding its netid at `identifiers.netid` with no `accountId` is
 * therefore invisible to it, so the next observation of that same human minted a
 * second row: one person split across two `researchers`, each serving as its own
 * lead. That also bypassed a detachment rather than overriding it, because the
 * detachment is keyed to a `personId` and the twin is a different person (#3152).
 *
 * Only a bare normalized netid is looked up, which is what every other
 * `identifiers.netid` reader does, so a malformed stored key cannot be matched
 * here and is left to its own repair (#2864). Only a live holder is adopted, so
 * an archived person is never resurrected and the accountId mint below still
 * runs unchanged for that case.
 *
 * The accountId is stamped onto the adopted row so the two keys converge on one
 * identity: a detachment keyed to a person is only as durable as the guarantee
 * that the person has one row.
 */
async function adoptAccountlessNetidHolderId(
  identity: CanonicalMemberIdentity,
  accountId: mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId | undefined> {
  const netid = normalizedNetid(identity.netid);
  if (!netid) return undefined;
  const holder = await Researcher.findOne({
    'identifiers.netid': netid,
    accountId: { $exists: false },
    archived: { $ne: true },
  })
    .select('_id')
    .lean();
  const holderId = toObjectId((holder as { _id?: unknown } | null)?._id);
  if (!holderId) return undefined;
  try {
    await Researcher.updateOne(
      { _id: holderId, accountId: { $exists: false } },
      { $set: { accountId } },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  return holderId;
}

async function resolveOrCreateResearcherId(
  identity: CanonicalMemberIdentity,
  accountId: mongoose.Types.ObjectId | undefined,
): Promise<mongoose.Types.ObjectId | undefined> {
  if (identityIsOrganizationalMailbox(identity)) return undefined;
  const displayName = canonicalPersonName(trimmed(identity.displayName));
  const orcid = normalizedOrcid(identity.orcid);

  if (accountId) {
    const existingByAccount = await Researcher.findOne({ accountId }).select('_id').lean();
    if (!existingByAccount) {
      const adopted = await adoptAccountlessNetidHolderId(identity, accountId);
      if (adopted) return adopted;
    }
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
  return resolveOrCreateNameOnlyResearcherId(displayName);
}

const nameOnlyResolutionLocks = new Map<string, Promise<mongoose.Types.ObjectId | undefined>>();

const NOISY_NAME_ADOPTION_CANDIDATE_LIMIT = 20;

/**
 * A name-only researcher has no netid, email or ORCID, so its stored `displayName` IS
 * its identity. That makes the row unreachable by exact match once name hygiene starts
 * cleaning the scraped name at ingest: the corpus holds "Photo of <name>." while the
 * next scrape now asserts "<name>", and minting a second row would fork one human into
 * two people carrying two CURRENT role assignments on the same entity, which the entity
 * page renders twice and no repair pass merges back (#2951).
 *
 * So the miss is retried against the sanitized form of the stored names and the adopted
 * row is healed in place. Narrowed by case-insensitive substring first, which is sound
 * because every hygiene rule only drops or re-cases characters: the cleaned name is
 * always a substring of the value it was cleaned from. This also removes the ordering
 * constraint that the corpus repair must be run before ingest hygiene is deployed.
 */
async function adoptNoisyNameOnlyResearcherId(
  displayName: string,
): Promise<mongoose.Types.ObjectId | undefined> {
  const candidates = await Researcher.find({
    displayName: new RegExp(escapeRegex(displayName), 'i'),
    archived: { $ne: true },
    accountId: { $exists: false },
    'identifiers.orcid': { $exists: false },
  })
    .select('_id displayName')
    .sort({ _id: 1 })
    .limit(NOISY_NAME_ADOPTION_CANDIDATE_LIMIT)
    .lean();
  const adopted = candidates.find(
    (candidate) =>
      canonicalPersonName(
        sanitizePersonName(trimmed((candidate as { displayName?: unknown }).displayName)),
      ) === displayName,
  );
  const adoptedId = toObjectId((adopted as { _id?: unknown } | undefined)?._id);
  if (!adoptedId) return undefined;
  await Researcher.updateOne({ _id: adoptedId }, { $set: { displayName } });
  return adoptedId;
}

async function findOrCreateNameOnlyResearcherId(
  displayName: string,
): Promise<mongoose.Types.ObjectId | undefined> {
  const nameOnlyFilter = {
    displayName,
    archived: { $ne: true },
    accountId: { $exists: false },
    'identifiers.orcid': { $exists: false },
  };
  const existingNameOnly = await Researcher.findOne(nameOnlyFilter).select('_id').lean();
  if (existingNameOnly) return toObjectId((existingNameOnly as { _id?: unknown })._id);
  const adopted = await adoptNoisyNameOnlyResearcherId(displayName);
  if (adopted) return adopted;
  try {
    const created = await Researcher.create({ displayName, profileLinks: [], archived: false });
    return toObjectId(created._id);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const fallback = await Researcher.findOne(nameOnlyFilter).select('_id').lean();
      return toObjectId((fallback as { _id?: unknown } | null)?._id);
    }
    throw error;
  }
}

async function resolveOrCreateNameOnlyResearcherId(
  displayName: string,
): Promise<mongoose.Types.ObjectId | undefined> {
  const previous = nameOnlyResolutionLocks.get(displayName) ?? Promise.resolve(undefined);
  const current = previous
    .catch(() => undefined)
    .then(() => findOrCreateNameOnlyResearcherId(displayName));
  nameOnlyResolutionLocks.set(displayName, current);
  try {
    return await current;
  } finally {
    if (nameOnlyResolutionLocks.get(displayName) === current) {
      nameOnlyResolutionLocks.delete(displayName);
    }
  }
}

export async function resolveOrCreateResearcherIdForIdentity(
  identity: CanonicalMemberIdentity,
): Promise<mongoose.Types.ObjectId | undefined> {
  const accountId = await resolveOrCreateAccountId(identity);
  return resolveOrCreateResearcherId(identity, accountId);
}

export async function resolveCanonicalResearcherId(
  identity: CanonicalMemberIdentity,
): Promise<mongoose.Types.ObjectId | undefined> {
  const displayName = canonicalPersonName(trimmed(identity.displayName));
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
  if (identityIsOrganizationalMailbox(identity)) {
    console.warn(
      `[canonical-membership] skipped mint for entity ${sanitizeLogValue(
        researchEntityId,
      )}: identity resembles an organizational mailbox, not an individual`,
    );
    return;
  }

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
      rosterProvenance: facts.rosterProvenance,
    });
    if (!upsert) return;
    await RoleAssignment.updateOne(upsert.filter, upsert.update, { upsert: true });
    await RoleAssignment.updateOne(upsert.reattach.filter, upsert.reattach.update);
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
