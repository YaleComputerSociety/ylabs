import mongoose from 'mongoose';
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
  return byNetid;
}

export async function liveResearcherHoldsNetid(netid: string): Promise<boolean> {
  return Boolean(await Researcher.exists({ 'identifiers.netid': netid, ...LIVE_RESEARCHER }));
}
