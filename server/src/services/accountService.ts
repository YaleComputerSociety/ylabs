import { Account } from '../models/account';

const NETID_INPUT_RE = /^[A-Za-z0-9]{2,12}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountLoginInput {
  netid: string;
  email?: string;
}

export interface AccountRecordView {
  _id: string;
  netid: string;
  email: string;
  status: string;
  archived: boolean;
  lastLoginAt?: Date;
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
});

export const validateAccount = async (netid: unknown): Promise<AccountRecordView | null> => {
  const normalizedNetid = normalizeNetid(netid);
  if (!normalizedNetid) return null;
  const account = await Account.findOne({ netid: normalizedNetid }).lean();
  return account ? toAccountView(account) : null;
};

export const recordAccountLogin = async (
  input: AccountLoginInput,
): Promise<AccountRecordView> => {
  const normalizedNetid = normalizeNetid(input.netid);
  if (!normalizedNetid) {
    throw new Error('Invalid authentication principal');
  }

  const account = await Account.findOneAndUpdate(
    { netid: normalizedNetid },
    {
      $set: { lastLoginAt: new Date() },
      $setOnInsert: {
        netid: normalizedNetid,
        email: normalizeLoginEmail(input.email, normalizedNetid),
        status: 'ACTIVE',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();

  return toAccountView(account);
};
