import { grantAwardIdentity } from './grantAwardIdentity';
import { mergeGrantInvestigators, type GrantInvestigator } from './grantInvestigators';

export interface RecentGrantPeriod {
  id: string;
  agency: string;
  startDate?: Date;
  endDate?: Date;
  investigators?: GrantInvestigator[];
}

interface DatedAward {
  id: string;
  agency: string;
  startDate?: Date;
  endDate?: Date;
  investigators?: GrantInvestigator[];
}

export function recentGrantPeriodsOf(awards: readonly DatedAward[]): RecentGrantPeriod[] {
  const periods = new Map<string, RecentGrantPeriod>();
  for (const award of awards) {
    const key = grantAwardIdentity(award);
    if (!key) continue;
    const held = periods.get(key);
    if (held) {
      if (held.investigators && award.investigators) {
        held.investigators = mergeGrantInvestigators(held.investigators, award.investigators);
      }
      continue;
    }
    periods.set(key, {
      id: award.id,
      agency: award.agency,
      ...(award.startDate ? { startDate: award.startDate } : {}),
      ...(award.endDate ? { endDate: award.endDate } : {}),
      ...(award.investigators ? { investigators: award.investigators } : {}),
    });
  }
  return [...periods.values()];
}
