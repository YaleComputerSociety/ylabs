/**
 * A signal whose `expiresAt` has passed is not served to students, so a posted opening
 * stops reading as open once its deadline passes instead of when its source is next
 * re-materialized (#4628). A signal with no `expiresAt` never expires.
 *
 * This is a query clause rather than a filter over fetched rows because the detail
 * route caps its signal read, and filtering after the cap would let expired rows
 * crowd live ones out of it. Every query that serves signals to students spreads it.
 */
export const unexpiredSignalClause = (now: Date) => ({
  expiresAt: { $not: { $lte: now } },
});
