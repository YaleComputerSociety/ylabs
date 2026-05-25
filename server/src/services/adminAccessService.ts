/**
 * Admin access source of truth.
 */
import { AdminGrant } from '../models/adminGrant';
import { User } from '../models/user';
import { isDevelopment, isTest } from '../utils/environment';
import { isDevFixtureAccount } from '../utils/devAuthGuard';

export interface AdminAccessUser {
  netid: string;
  fname?: string;
  lname?: string;
  email?: string;
  userType?: string;
}

export interface AdminAccessGrant {
  netid: string;
  status: 'active' | 'revoked';
  source: 'bootstrap' | 'manual' | 'migration';
  grantedBy?: string;
  grantedAt?: Date | string;
  revokedBy?: string;
  revokedAt?: Date | string;
  note?: string;
  user?: AdminAccessUser;
}

export interface AdminAccessSummary {
  activeCount: number;
  grants: AdminAccessGrant[];
  legacyAdminsWithoutGrant: AdminAccessUser[];
}

const normalizeNetid = (netid: unknown): string => String(netid || '').trim().toLowerCase();
const normalizeNote = (note: unknown): string | undefined => {
  const normalized = String(note || '').trim();
  return normalized || undefined;
};

const canUseLocalDevAdmin = () => (isDevelopment() || isTest());
const isLocalDevAdminNetid = (netid: string): boolean => netid === 'devadmin';

export class AdminAccessError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AdminAccessError';
    this.statusCode = statusCode;
  }
}

export async function isAdminNetid(netid: unknown): Promise<boolean> {
  const normalized = normalizeNetid(netid);
  if (!normalized) return false;
  if (canUseLocalDevAdmin() && isLocalDevAdminNetid(normalized)) return true;

  const grant = await AdminGrant.findOne({ netid: normalized, status: 'active' });
  return Boolean(grant);
}

export function effectiveUserType(user: any, isAdmin: boolean): string {
  if (isAdmin) return 'admin';
  return user?.userType === 'admin' ? 'unknown' : user?.userType || 'unknown';
}

export async function grantAdminAccess({
  netid,
  actorNetid,
  note,
}: {
  netid: unknown;
  actorNetid: unknown;
  note?: unknown;
}): Promise<AdminAccessGrant> {
  const normalizedNetid = normalizeNetid(netid);
  const normalizedActorNetid = normalizeNetid(actorNetid);
  if (!normalizedNetid) {
    throw new AdminAccessError('NetID is required', 400);
  }
  if (!normalizedActorNetid) {
    throw new AdminAccessError('Admin actor is required', 400);
  }

  const user = await User.findOne({ netid: normalizedNetid })
    .select('netid fname lname email userType')
    .lean();
  if (!user) {
    throw new AdminAccessError('User not found', 404);
  }

  const existingGrant = await AdminGrant.findOne({
    netid: normalizedNetid,
    status: 'active',
  });
  if (existingGrant) {
    throw new AdminAccessError('Active admin grant already exists', 409);
  }

  const grant = await AdminGrant.create({
    netid: normalizedNetid,
    status: 'active',
    source: 'manual',
    grantedBy: normalizedActorNetid,
    grantedAt: new Date(),
    note: normalizeNote(note),
  });

  return grant as AdminAccessGrant;
}

export async function revokeAdminAccess({
  netid,
  actorNetid,
  note,
}: {
  netid: unknown;
  actorNetid: unknown;
  note?: unknown;
}): Promise<AdminAccessGrant> {
  const normalizedNetid = normalizeNetid(netid);
  const normalizedActorNetid = normalizeNetid(actorNetid);
  if (!normalizedNetid) {
    throw new AdminAccessError('NetID is required', 400);
  }
  if (!normalizedActorNetid) {
    throw new AdminAccessError('Admin actor is required', 400);
  }
  if (normalizedNetid === normalizedActorNetid) {
    throw new AdminAccessError('Admins cannot revoke their own admin grant', 400);
  }

  const update: Record<string, unknown> = {
    status: 'revoked',
    revokedBy: normalizedActorNetid,
    revokedAt: new Date(),
  };
  const normalizedNote = normalizeNote(note);
  if (normalizedNote) update.note = normalizedNote;

  const grant = await AdminGrant.findOneAndUpdate(
    { netid: normalizedNetid, status: 'active' },
    update,
    { new: true, runValidators: true },
  ).lean();

  if (!grant) {
    throw new AdminAccessError('Active admin grant not found', 404);
  }

  return grant as AdminAccessGrant;
}

const userByNetid = (users: any[] = []): Map<string, AdminAccessUser> =>
  new Map(
    users
      .filter((user) => user?.netid)
      .map((user) => [
        normalizeNetid(user.netid),
        {
          netid: normalizeNetid(user.netid),
          fname: user.fname,
          lname: user.lname,
          email: user.email,
          userType: user.userType,
        },
      ]),
  );

export async function listAdminAccess(): Promise<AdminAccessSummary> {
  const grants = await AdminGrant.find({ status: { $in: ['active', 'revoked'] } })
    .sort({ status: 1, grantedAt: -1, netid: 1 })
    .lean();
  const grantNetids = Array.from(new Set(grants.map((grant: any) => normalizeNetid(grant.netid))));
  const activeGrantNetids = new Set(
    grants
      .filter((grant: any) => grant.status === 'active')
      .map((grant: any) => normalizeNetid(grant.netid)),
  );

  const grantUsers =
    grantNetids.length > 0
      ? await User.find({ netid: { $in: grantNetids } })
          .select('netid fname lname email userType')
          .lean()
      : [];
  const usersByNetid = userByNetid(grantUsers);

  const legacyAdminRows = await User.find({ userType: 'admin' })
    .select('netid fname lname email userType')
    .lean();
  const legacyAdminsWithoutGrant = legacyAdminRows
    .filter((user: any) => !activeGrantNetids.has(normalizeNetid(user.netid)))
    .filter((user: any) => !isDevFixtureAccount(user))
    .map((user: any) => ({
      netid: normalizeNetid(user.netid),
      fname: user.fname,
      lname: user.lname,
      email: user.email,
      userType: user.userType,
    }));

  const decoratedGrants = grants.map((grant: any) => {
    const netid = normalizeNetid(grant.netid);
    return {
      netid,
      status: grant.status,
      source: grant.source,
      grantedBy: grant.grantedBy,
      grantedAt: grant.grantedAt,
      revokedBy: grant.revokedBy,
      revokedAt: grant.revokedAt,
      note: grant.note,
      user: usersByNetid.get(netid),
    };
  });

  return {
    activeCount: decoratedGrants.filter((grant) => grant.status === 'active').length,
    grants: decoratedGrants,
    legacyAdminsWithoutGrant,
  };
}
