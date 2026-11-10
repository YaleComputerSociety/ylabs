import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DELETED_ACCOUNT_EVENT_TALLY_COLLECTION } from '../../models/deletedAccountEventTally';
import {
  NEVER_COPY_COLLECTIONS,
  PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
} from '../mirrorCollectionPolicy';

const ACCOUNT_DATA_COLLECTIONS = [
  'accounts',
  'research_plans',
  'analytics_events',
  'entitycorrectionreports',
  'admin_grants',
  'admin_audit_events',
  DELETED_ACCOUNT_EVENT_TALLY_COLLECTION,
];

const sourceBlock = (file: string, start: string, end: string): string => {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url).pathname, 'utf8');
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
};

describe('a deleted account stays deleted across promotion and sync (#4156)', () => {
  it('copies none of the collections an account deletion writes during a promotion', () => {
    const copyBlock = sourceBlock(
      'promoteAcceptedBetaCopy.ts',
      'const COPY_COLLECTIONS',
      'export interface PromotionOptions',
    );
    for (const collection of ACCOUNT_DATA_COLLECTIONS) {
      expect(copyBlock).not.toContain(`'${collection}'`);
    }
  });

  it('copies none of them during a Beta and Development sync', () => {
    const copyBlock = sourceBlock(
      'syncBetaToDevelopment.ts',
      'const BASE_COPY_COLLECTIONS',
      'const EXCLUDED_BETA_COLLECTIONS',
    );
    for (const collection of ACCOUNT_DATA_COLLECTIONS) {
      expect(copyBlock).not.toContain(`'${collection}'`);
    }
  });

  it('keeps the deleted-account tally local and preserved across a Development refresh', () => {
    expect(NEVER_COPY_COLLECTIONS).toContain(DELETED_ACCOUNT_EVENT_TALLY_COLLECTION);
    expect(PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS).toContain(
      DELETED_ACCOUNT_EVENT_TALLY_COLLECTION,
    );
  });
});
