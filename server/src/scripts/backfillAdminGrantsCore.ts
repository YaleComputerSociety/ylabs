import { isDevFixtureAccount } from '../utils/devAuthGuard';

export interface LegacyAdminUser {
  netid?: string;
  email?: string | null;
  fname?: string;
  lname?: string;
  userType?: string;
}

export interface BackfillAdminGrantsOptions {
  apply: boolean;
  users: LegacyAdminUser[];
  existingActiveGrantNetids: Set<string>;
  now: Date;
  createGrant: (grant: {
    netid: string;
    status: 'active';
    source: 'migration';
    grantedAt: Date;
    note: string;
  }) => Promise<unknown> | unknown;
}

export interface BackfillAdminGrantsResult {
  apply: boolean;
  candidates: string[];
  created: string[];
  skippedExisting: string[];
  skippedFixtures: string[];
}

const normalizeNetid = (value: unknown): string => String(value || '').trim().toLowerCase();

export async function backfillAdminGrants(
  options: BackfillAdminGrantsOptions,
): Promise<BackfillAdminGrantsResult> {
  const result: BackfillAdminGrantsResult = {
    apply: options.apply,
    candidates: [],
    created: [],
    skippedExisting: [],
    skippedFixtures: [],
  };

  for (const user of options.users) {
    const netid = normalizeNetid(user.netid);
    if (!netid) continue;

    if (isDevFixtureAccount(user)) {
      result.skippedFixtures.push(netid);
      continue;
    }

    if (options.existingActiveGrantNetids.has(netid)) {
      result.skippedExisting.push(netid);
      continue;
    }

    result.candidates.push(netid);

    if (options.apply) {
      await options.createGrant({
        netid,
        status: 'active',
        source: 'migration',
        grantedAt: options.now,
        note: 'Backfilled from legacy users.userType=admin.',
      });
      result.created.push(netid);
    }
  }

  return result;
}
