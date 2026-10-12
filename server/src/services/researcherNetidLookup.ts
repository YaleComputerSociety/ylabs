import mongoose from 'mongoose';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';

export interface ResearcherByNetid {
  _id: mongoose.Types.ObjectId;
  displayName?: string;
  email?: string;
}

const LIVE_RESEARCHER = { archived: { $ne: true } };

const uniqueNetids = (netids: readonly string[]): string[] => [
  ...new Set(netids.filter((netid) => typeof netid === 'string' && netid.length > 0)),
];

const toResearcherByNetid = (researcher: any): ResearcherByNetid => ({
  _id: researcher._id,
  ...(typeof researcher.displayName === 'string' ? { displayName: researcher.displayName } : {}),
  ...(typeof researcher.identifiers?.email === 'string'
    ? { email: researcher.identifiers.email }
    : {}),
});

// The account fallback keeps a researcher reachable whose own identifiers do not yet
// carry the netid, until accounts hold only logins (#5000).
export async function researchersByNetid(
  netids: readonly string[],
): Promise<Map<string, ResearcherByNetid>> {
  const wanted = uniqueNetids(netids);
  const byNetid = new Map<string, ResearcherByNetid>();
  if (wanted.length === 0) return byNetid;

  const byIdentifier = await Researcher.find({
    'identifiers.netid': { $in: wanted },
    ...LIVE_RESEARCHER,
  })
    .select('_id displayName identifiers.netid identifiers.email')
    .lean();
  for (const researcher of byIdentifier as any[]) {
    const netid = researcher.identifiers?.netid;
    if (typeof netid === 'string') byNetid.set(netid, toResearcherByNetid(researcher));
  }

  const unresolved = wanted.filter((netid) => !byNetid.has(netid));
  if (unresolved.length === 0) return byNetid;
  const accounts = await Account.find({ netid: { $in: unresolved } })
    .select('_id netid')
    .lean();
  if (accounts.length === 0) return byNetid;
  const netidByAccountId = new Map(
    accounts.map((account: any) => [String(account._id), account.netid as string]),
  );
  const byAccount = await Researcher.find({
    accountId: { $in: accounts.map((account: any) => account._id) },
  })
    .select('_id displayName accountId identifiers.email')
    .lean();
  for (const researcher of byAccount as any[]) {
    const netid = netidByAccountId.get(String(researcher.accountId));
    if (netid && !byNetid.has(netid)) byNetid.set(netid, toResearcherByNetid(researcher));
  }
  return byNetid;
}

export async function liveResearcherHoldsNetid(netid: string): Promise<boolean> {
  return Boolean(await Researcher.exists({ 'identifiers.netid': netid, ...LIVE_RESEARCHER }));
}
