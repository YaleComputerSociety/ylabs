/**
 * Service helpers for explicit admin authority grants.
 */
import { AdminGrant } from '../models/adminGrant';
import { User } from '../models/user';
import { isLocalDevelopmentRuntime } from '../utils/environment';

const NETID_RE = /^[A-Za-z0-9]{2,12}$/;
export const MAX_ADMIN_GRANT_NOTE_LENGTH = 512;

export class AdminGrantValidationError extends Error {}
export class AdminGrantConflictError extends Error {}

export interface AdminGrantResponse {
  activeCount: number;
  grants: any[];
  legacyAdminsWithoutGrant: any[];
}

const normalizeNetid = (netid: unknown) =>
  typeof netid === 'string' ? netid.trim().toLowerCase() : '';

const assertValidNetid = (netid: string) => {
  if (!NETID_RE.test(netid)) {
    throw new AdminGrantValidationError('Invalid admin grant request');
  }
};

const normalizeAdminGrantNote = (note: unknown): string => {
  if (typeof note !== 'string') throw new AdminGrantValidationError('Reviewer note is required');
  const normalized = note.trim();
  if (!normalized || normalized.length > MAX_ADMIN_GRANT_NOTE_LENGTH) {
    throw new AdminGrantValidationError('Reviewer note is required and must be bounded');
  }
  return normalized;
};

export const allowsLegacyAdminUserType = (env: NodeJS.ProcessEnv = process.env): boolean =>
  isLocalDevelopmentRuntime(env);

export const hasAdminAuthorityForUser = async (
  user: { netId?: unknown; netid?: unknown; userType?: unknown } | null | undefined,
): Promise<boolean> => {
  if (!user || user.userType !== 'admin') return false;

  const netid = user.netId || user.netid;
  return (await hasActiveAdminGrant(netid)) || allowsLegacyAdminUserType();
};

const userSummaryByNetid = async (netids: string[]) => {
  if (netids.length === 0) return new Map<string, any>();
  const users = await User.find({ netid: { $in: netids } })
    .select('netid fname lname email userType profileVerified userConfirmed')
    .lean();
  return new Map(users.map((user: any) => [normalizeNetid(user.netid), user]));
};

export const listAdminGrants = async (): Promise<AdminGrantResponse> => {
  const grants = await AdminGrant.find({ status: 'active' }).sort({ grantedAt: -1 }).lean();
  const activeNetids = grants.map((grant: any) => normalizeNetid(grant.netid));
  const usersByNetid = await userSummaryByNetid(activeNetids);

  const legacyAdminsWithoutGrant = await User.find({
    userType: 'admin',
    netid: { $nin: activeNetids },
  })
    .select('netid fname lname email userType profileVerified userConfirmed')
    .sort({ netid: 1 })
    .lean();

  return {
    activeCount: grants.length,
    grants: grants.map((grant: any) => ({
      ...grant,
      user: usersByNetid.get(normalizeNetid(grant.netid)),
    })),
    legacyAdminsWithoutGrant,
  };
};

// Session deserialization checks admin authority on every authenticated
// request, so the grant lookup is cached briefly to keep it off the hot path.
// Grant/revoke invalidate this instance immediately; the TTL bounds staleness
// anywhere else.
const ADMIN_GRANT_CACHE_TTL_MS = 60 * 1000;
const ADMIN_GRANT_CACHE_MAX_ENTRIES = 10_000;
const adminGrantCache = new Map<string, { value: boolean; expiresAt: number }>();

export const clearAdminGrantCache = (): void => {
  adminGrantCache.clear();
};

export const hasActiveAdminGrant = async (netid: unknown): Promise<boolean> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!NETID_RE.test(normalizedNetid)) return false;

  const cached = adminGrantCache.get(normalizedNetid);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const grant = await AdminGrant.exists({ netid: normalizedNetid, status: 'active' });
  const value = Boolean(grant);
  if (adminGrantCache.size >= ADMIN_GRANT_CACHE_MAX_ENTRIES) adminGrantCache.clear();
  adminGrantCache.set(normalizedNetid, {
    value,
    expiresAt: Date.now() + ADMIN_GRANT_CACHE_TTL_MS,
  });
  return value;
};

export const grantAdminAccess = async ({
  netid,
  actorNetid,
  note,
  source = 'manual',
}: {
  netid: unknown;
  actorNetid: unknown;
  note?: unknown;
  source?: 'manual' | 'bootstrap';
}) => {
  const normalizedNetid = normalizeNetid(netid);
  const normalizedActor = normalizeNetid(actorNetid);
  assertValidNetid(normalizedNetid);
  assertValidNetid(normalizedActor);
  if (normalizedNetid === normalizedActor) {
    throw new AdminGrantValidationError('Administrators cannot grant access to themselves');
  }
  const normalizedNote = normalizeAdminGrantNote(note);
  const now = new Date();

  let grant;
  try {
    grant = await AdminGrant.findOneAndUpdate(
      { netid: normalizedNetid, status: { $ne: 'active' } },
      {
        $set: {
          netid: normalizedNetid,
          status: 'active',
          source,
          grantedBy: normalizedActor,
          grantedAt: now,
          note: normalizeAdminGrantNote(note),
        },
        $unset: {
          revokedBy: '',
          revokedAt: '',
          revokeNote: '',
        },
        $push: {
          history: {
            action: 'granted',
            actorNetid: normalizedActor,
            note: normalizedNote,
            at: now,
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new AdminGrantConflictError('Admin access is already active');
    }
    throw error;
  }
  if (!grant) throw new AdminGrantConflictError('Admin access is already active');
  adminGrantCache.delete(normalizedNetid);
  return grant;
};

export const revokeAdminAccess = async ({
  netid,
  actorNetid,
  note,
}: {
  netid: unknown;
  actorNetid: unknown;
  note?: unknown;
}) => {
  const normalizedNetid = normalizeNetid(netid);
  const normalizedActor = normalizeNetid(actorNetid);
  assertValidNetid(normalizedNetid);
  assertValidNetid(normalizedActor);
  const normalizedNote = normalizeAdminGrantNote(note);
  const now = new Date();

  const grant = await AdminGrant.findOneAndUpdate(
    { netid: normalizedNetid, status: 'active' },
    {
      $set: {
        status: 'revoked',
        revokedBy: normalizedActor,
        revokedAt: now,
        revokeNote: normalizeAdminGrantNote(note),
      },
      $push: {
        history: { action: 'revoked', actorNetid: normalizedActor, note: normalizedNote, at: now },
      },
    },
    { new: true },
  ).lean();
  if (grant) adminGrantCache.delete(normalizedNetid);
  return grant;
};
