import mongoose from 'mongoose';
import { Account, type AccountProfile } from '../models/account';
import { Researcher } from '../models/researcher';
import { normalizedSessionVersion } from '../utils/sessionClaim';

const NETID_INPUT_RE = /^[A-Za-z0-9]{2,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountLoginInput {
  netid: string;
  email?: string;
  profile?: AccountProfile;
}

/**
 * Paths a login used to persist that nothing ever read (#4162). They are off the schema
 * now, so a login that resolves a Yalies record replaces `profile` wholesale and sheds
 * them; a login whose lookup was unavailable writes no profile at all, and unsets them
 * explicitly so an account that keeps signing in stops carrying them either way.
 */
const RETIRED_PROFILE_PATHS = ['profile.college', 'profile.year', 'profile.major'];

const sanitizeLoginProfile = (profile?: AccountProfile): AccountProfile | undefined => {
  if (!profile) return undefined;
  const entries = Object.entries(profile).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0,
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as AccountProfile) : undefined;
};

export interface AccountRecordView {
  _id: string;
  netid: string;
  email: string;
  status: string;
  archived: boolean;
  lastLoginAt?: Date;
  sessionVersion: number;
}

const normalizeNetid = (value: unknown): string | null => {
  const netid = typeof value === 'string' ? value.trim() : '';
  return NETID_INPUT_RE.test(netid) ? netid.toLowerCase() : null;
};

const placeholderEmail = (netid: string): string => `${netid}@yale.edu`;

const normalizeLoginEmail = (email: unknown, netid: string): string => {
  const candidate = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return candidate && EMAIL_RE.test(candidate) ? candidate : placeholderEmail(netid);
};

const toAccountView = (account: any): AccountRecordView => ({
  _id: String(account._id),
  netid: String(account.netid),
  email: String(account.email),
  status: String(account.status ?? 'ACTIVE'),
  archived: account.archived === true,
  lastLoginAt: account.lastLoginAt ? new Date(account.lastLoginAt) : undefined,
  sessionVersion: normalizedSessionVersion(account.sessionVersion),
});

export const validateAccount = async (netid: unknown): Promise<AccountRecordView | null> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!normalizedNetid) return null;
  const account = await Account.findOne({ netid: normalizedNetid }).lean();
  return account ? toAccountView(account) : null;
};

export const revokeAccountSessions = async (netid: unknown): Promise<void> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!normalizedNetid) return;
  await Account.updateOne({ netid: normalizedNetid }, { $inc: { sessionVersion: 1 } });
};

export const lastKnownAccountUserType = async (netid: unknown): Promise<string | undefined> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!normalizedNetid) return undefined;
  const account = await Account.findOne({ netid: normalizedNetid })
    .select('profile.userType')
    .lean();
  const userType = (account as { profile?: { userType?: unknown } } | null)?.profile?.userType;
  return typeof userType === 'string' && userType.trim() ? userType.trim() : undefined;
};

export const resolveAccountIdByNetid = async (netid: unknown): Promise<mongoose.Types.ObjectId> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!normalizedNetid) {
    const error: any = new Error('Invalid account netid');
    error.status = 400;
    throw error;
  }
  const existing = (await Account.findOne({ netid: normalizedNetid }).select('_id').lean()) as {
    _id?: unknown;
  } | null;
  if (existing?._id) return new mongoose.Types.ObjectId(String(existing._id));
  const account = await Account.findOneAndUpdate(
    { netid: normalizedNetid },
    {
      $setOnInsert: {
        netid: normalizedNetid,
        email: placeholderEmail(normalizedNetid),
        status: 'ACTIVE',
      },
    },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
  return new mongoose.Types.ObjectId(String((account as { _id: unknown })._id));
};

export interface ReporterIdentity {
  email: string;
  name: string;
}

export const resolveReporterIdentityByNetid = async (netid: unknown): Promise<ReporterIdentity> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!normalizedNetid) return { email: '', name: '' };
  const account: any = await Account.findOne({ netid: normalizedNetid }).select('_id email').lean();
  if (!account?._id) return { email: '', name: '' };
  const researcher: any = await Researcher.findOne({ accountId: account._id })
    .select('displayName')
    .lean();
  return {
    email: typeof account.email === 'string' ? account.email : '',
    name: typeof researcher?.displayName === 'string' ? researcher.displayName : '',
  };
};

export const recordAccountLogin = async (input: AccountLoginInput): Promise<AccountRecordView> => {
  const normalizedNetid = normalizeNetid(input.netid);
  if (!normalizedNetid) {
    throw new Error('Invalid authentication principal');
  }

  const profile = sanitizeLoginProfile(input.profile);
  const unsetsRetiredProfilePaths = !profile;
  const account = await Account.findOneAndUpdate(
    { netid: normalizedNetid },
    {
      $set: { lastLoginAt: new Date(), ...(profile ? { profile } : {}) },
      ...(unsetsRetiredProfilePaths
        ? { $unset: Object.fromEntries(RETIRED_PROFILE_PATHS.map((path) => [path, ''])) }
        : {}),
      $setOnInsert: {
        netid: normalizedNetid,
        email: normalizeLoginEmail(input.email, normalizedNetid),
        status: 'ACTIVE',
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
      ...(unsetsRetiredProfilePaths ? { strict: false } : {}),
    },
  ).lean();

  return toAccountView(account);
};
