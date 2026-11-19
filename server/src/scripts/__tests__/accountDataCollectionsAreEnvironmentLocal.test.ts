import { describe, expect, it } from 'vitest';
import { ACCOUNT_DELETION_REQUEST_COLLECTION } from '../../models/accountDeletionRequest';
import { DELETED_ACCOUNT_EVENT_TALLY_COLLECTION } from '../../models/deletedAccountEventTally';
import {
  NEVER_COPY_COLLECTIONS,
  PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS,
} from '../mirrorCollectionPolicy';
import {
  promotionCollectionNamesForOptions,
  type PromotionOptions,
} from '../promoteAcceptedBetaCopy';
import { betaToDevelopmentCollectionNames } from '../syncBetaToDevelopment';

const ACCOUNT_DATA_COLLECTIONS = [
  'accounts',
  'research_plans',
  'analytics_events',
  'entitycorrectionreports',
  'admin_grants',
  'admin_audit_events',
  DELETED_ACCOUNT_EVENT_TALLY_COLLECTION,
  ACCOUNT_DELETION_REQUEST_COLLECTION,
];

const widestPromotion = {
  includeObservations: true,
  includeScrapeRuns: true,
} as PromotionOptions;

describe('a deleted account stays deleted across promotion and sync (#4156)', () => {
  it('copies none of the collections an account deletion writes during a promotion', () => {
    const copied = promotionCollectionNamesForOptions(widestPromotion);
    expect(copied.length).toBeGreaterThan(0);
    for (const collection of ACCOUNT_DATA_COLLECTIONS) {
      expect(copied).not.toContain(collection);
    }
  });

  it('copies none of them during a Beta and Development sync', () => {
    const copied = betaToDevelopmentCollectionNames(true);
    expect(copied.length).toBeGreaterThan(0);
    for (const collection of ACCOUNT_DATA_COLLECTIONS) {
      expect(copied).not.toContain(collection);
    }
  });

  it.each([DELETED_ACCOUNT_EVENT_TALLY_COLLECTION, ACCOUNT_DELETION_REQUEST_COLLECTION])(
    'keeps %s local and preserved across a Development refresh',
    (collection) => {
      expect(NEVER_COPY_COLLECTIONS).toContain(collection);
      expect(PRESERVED_ENVIRONMENT_LOCAL_COLLECTIONS).toContain(collection);
    },
  );
});
