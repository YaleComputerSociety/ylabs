import mongoose from 'mongoose';
import { Account } from '../models/account';
import { Researcher } from '../models/researcher';
import { splitName } from '../scrapers/utils/scraperHelpers';
import {
  givenNamesEquivalent,
  surnameFetchRegex,
  surnameOnlyMatch,
  surnamesCompatible,
  SURNAME_FETCH_LIMIT,
} from '../scrapers/utils/piNameMatch';

export type ResearcherPersonNameResolutionStatus = 'matched' | 'absent' | 'ambiguous';

export interface ResearcherPersonNameResolution {
  status: ResearcherPersonNameResolutionStatus;
  researcherId?: mongoose.Types.ObjectId;
}

export interface ResearcherNameCandidate {
  _id: mongoose.Types.ObjectId | string;
  displayName?: string;
}

export interface ResearcherPersonNameResolverDeps {
  findResearchersBySurname: (surnameRegex: RegExp) => Promise<ResearcherNameCandidate[]>;
  resolveResearcherIdByNetid: (netid: string) => Promise<mongoose.Types.ObjectId | undefined>;
}

const defaultFindResearchersBySurname = async (
  surnameRegex: RegExp,
): Promise<ResearcherNameCandidate[]> =>
  (await Researcher.find(
    { displayName: surnameRegex, archived: { $ne: true } },
    { _id: 1, displayName: 1 },
  )
    .limit(SURNAME_FETCH_LIMIT)
    .lean()) as ResearcherNameCandidate[];

const defaultResolveResearcherIdByNetid = async (
  netid: string,
): Promise<mongoose.Types.ObjectId | undefined> => {
  const byIdentifier: any = await Researcher.findOne({ 'identifiers.netid': netid })
    .select('_id')
    .lean();
  if (byIdentifier?._id) return byIdentifier._id;
  const account: any = await Account.findOne({ netid }).select('_id').lean();
  if (!account?._id) return undefined;
  const researcher: any = await Researcher.findOne({ accountId: account._id })
    .select('_id')
    .lean();
  return researcher?._id ?? undefined;
};

const asResearcherId = (value: ResearcherNameCandidate['_id']): mongoose.Types.ObjectId =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));

const normalizeNetid = (value: unknown): string | undefined => {
  const netid = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return netid.length > 0 ? netid : undefined;
};

export async function resolveResearcherIdForPersonName(
  name: string,
  opts: { netid?: string; deps?: Partial<ResearcherPersonNameResolverDeps> } = {},
): Promise<ResearcherPersonNameResolution> {
  const findResearchersBySurname =
    opts.deps?.findResearchersBySurname ?? defaultFindResearchersBySurname;
  const resolveResearcherIdByNetid =
    opts.deps?.resolveResearcherIdByNetid ?? defaultResolveResearcherIdByNetid;

  const netid = normalizeNetid(opts.netid);
  if (netid) {
    const researcherId = await resolveResearcherIdByNetid(netid);
    if (researcherId) return { status: 'matched', researcherId };
  }

  if (!name) return { status: 'absent' };
  let { first, last } = splitName(name);
  if (!last && first && !/\s/.test(first)) {
    last = first;
    first = '';
  }
  if (!last) return { status: 'absent' };

  const surnameRe = surnameFetchRegex(last);
  if (!surnameRe) return { status: 'absent' };

  const fetched = await findResearchersBySurname(surnameRe);
  if (fetched.length >= SURNAME_FETCH_LIMIT) return { status: 'ambiguous' };

  const candidates = fetched
    .map((candidate) => ({ candidate, parsed: splitName(candidate.displayName || '') }))
    .filter(({ parsed }) => surnamesCompatible(last, parsed.last));

  if (!first) {
    return { status: surnameOnlyMatch(candidates.length) };
  }

  const firstToken = first.split(/\s+/)[0]?.replace(/\./g, '') || first;
  const exact = candidates.filter(
    ({ parsed }) =>
      parsed.first.toLowerCase() === first.toLowerCase() ||
      givenNamesEquivalent(firstToken, parsed.first),
  );
  if (exact.length === 1) {
    return { status: 'matched', researcherId: asResearcherId(exact[0].candidate._id) };
  }
  if (exact.length > 1) return { status: 'ambiguous' };

  if (firstToken.length > 1) {
    const prefix = first.toLowerCase();
    const byPrefix = candidates.filter(({ parsed }) =>
      parsed.first.toLowerCase().startsWith(prefix),
    );
    if (byPrefix.length === 1) {
      return { status: 'matched', researcherId: asResearcherId(byPrefix[0].candidate._id) };
    }
    if (byPrefix.length > 1) return { status: 'ambiguous' };
  }

  return candidates.length > 0 ? { status: 'ambiguous' } : { status: 'absent' };
}
