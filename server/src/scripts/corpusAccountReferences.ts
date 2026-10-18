import type { Db } from 'mongodb';

export interface AccountIdReferenceField {
  collection: string;
  field: string;
}

export const ACCOUNT_ID_REFERENCE_FIELDS: ReadonlyArray<AccountIdReferenceField> = [
  { collection: 'researchers', field: 'accountId' },
  { collection: 'research_entities', field: 'studentVisibilityReviewedByAccountId' },
  { collection: 'fellowships', field: 'studentVisibilityReviewedByAccountId' },
  { collection: 'research_plans', field: 'accountId' },
];

/**
 * The shared corpus fields that can hold an account `_id`. Accounts are
 * environment-local (#5088), so an `_id` written in one environment names nobody
 * once the row is copied to another.
 */
export const CORPUS_ACCOUNT_ID_REFERENCE_FIELDS: ReadonlyArray<AccountIdReferenceField> =
  ACCOUNT_ID_REFERENCE_FIELDS.filter(({ collection }) => collection !== 'research_plans');

export interface CorpusAccountReference extends AccountIdReferenceField {
  count: number;
}

export async function corpusAccountReferences(
  sourceDb: Db,
  copiedCollectionNames: readonly string[],
): Promise<CorpusAccountReference[]> {
  const rows = await Promise.all(
    CORPUS_ACCOUNT_ID_REFERENCE_FIELDS.filter(({ collection }) =>
      copiedCollectionNames.includes(collection),
    ).map(async ({ collection, field }) => {
      const exists = await sourceDb
        .listCollections({ name: collection }, { nameOnly: true })
        .hasNext();
      const count = exists
        ? await sourceDb.collection(collection).countDocuments({ [field]: { $nin: [null] } })
        : 0;
      return { collection, field, count };
    }),
  );
  return rows.filter((row) => row.count > 0);
}

export function corpusAccountReferenceBlockers(
  references: readonly CorpusAccountReference[],
): string[] {
  return references.map(
    ({ collection, field, count }) =>
      `${count} ${collection} ${count === 1 ? 'row carries' : 'rows carry'} an account _id in ${field}; accounts are environment-local, so the copy would leave ${count === 1 ? 'it' : 'them'} pointing at nobody (#5088).`,
  );
}

export function assertNoCorpusAccountReferences(
  references: readonly CorpusAccountReference[],
): void {
  const blockers = corpusAccountReferenceBlockers(references);
  if (blockers.length > 0) {
    throw new Error(`Copy blocked: ${blockers.join(' ')}`);
  }
}
