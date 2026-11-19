import { randomUUID } from 'crypto';

import { Account, PRODUCT_ANALYTICS_ID_PATTERN } from '../models/account';

type AccountAnalyticsIdentity = { _id: unknown; productAnalyticsId?: unknown };

const validProductAnalyticsId = (value: unknown): string | null =>
  typeof value === 'string' && PRODUCT_ANALYTICS_ID_PATTERN.test(value) ? value : null;

export const normalizeProductAnalyticsId = (value: unknown): string | null =>
  validProductAnalyticsId(typeof value === 'string' ? value.trim().toLowerCase() : value);

const activeAccountFilter = (netid: string) => ({
  netid: netid.trim().toLowerCase(),
  archived: { $ne: true },
});

export const ensureProductAnalyticsId = async (netid: string): Promise<string | null> => {
  const account = (await Account.findOne(activeAccountFilter(netid), {
    productAnalyticsId: 1,
  }).lean()) as AccountAnalyticsIdentity | null;
  if (!account) return null;

  const existing = validProductAnalyticsId(account.productAnalyticsId);
  if (existing) return existing;

  const assigned = (await Account.findOneAndUpdate(
    { _id: account._id, productAnalyticsId: { $exists: false } },
    { $set: { productAnalyticsId: randomUUID() } },
    { returnDocument: 'after', runValidators: true, projection: { productAnalyticsId: 1 } },
  ).lean()) as AccountAnalyticsIdentity | null;
  if (assigned) return validProductAnalyticsId(assigned.productAnalyticsId);

  const concurrent = (await Account.findById(account._id, {
    productAnalyticsId: 1,
  }).lean()) as AccountAnalyticsIdentity | null;
  return validProductAnalyticsId(concurrent?.productAnalyticsId);
};

export const findNetidForProductAnalyticsId = async (
  productAnalyticsId: string,
): Promise<string | null> => {
  const account = (await Account.findOne({ productAnalyticsId }, { netid: 1 }).lean()) as {
    netid?: unknown;
  } | null;
  return typeof account?.netid === 'string' ? account.netid : null;
};
