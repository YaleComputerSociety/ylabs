import { grantAwardIdentity } from './grantAwardIdentity';

export interface RecentGrantPeriod {
  id: string;
  agency: string;
  startDate?: Date;
  endDate?: Date;
}

interface DatedAward {
  id: string;
  agency: string;
  startDate?: Date;
  endDate?: Date;
}

export function recentGrantPeriodsOf(awards: readonly DatedAward[]): RecentGrantPeriod[] {
  const periods = new Map<string, RecentGrantPeriod>();
  for (const award of awards) {
    const key = grantAwardIdentity(award);
    if (!key || periods.has(key)) continue;
    periods.set(key, {
      id: award.id,
      agency: award.agency,
      ...(award.startDate ? { startDate: award.startDate } : {}),
      ...(award.endDate ? { endDate: award.endDate } : {}),
    });
  }
  return [...periods.values()];
}
