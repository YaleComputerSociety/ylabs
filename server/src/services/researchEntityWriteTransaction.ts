import mongoose from 'mongoose';

/**
 * Runs a research-entity mutation inside a transaction.
 *
 * Replaces `mutateAndRefreshAdminAccessReviewProjection`, which wrapped these
 * same writes in a transaction only so it could invalidate and rebuild the
 * retired admin access-review projection in the same commit. The projection is
 * gone; the transactional boundary the callers relied on is not.
 */
export async function withResearchEntityWriteTransaction<T>(
  mutate: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await mongoose.connection.transaction(async (session) => {
    result = await mutate(session);
  });
  return result as T;
}
