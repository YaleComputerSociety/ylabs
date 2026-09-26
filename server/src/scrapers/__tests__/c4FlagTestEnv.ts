/**
 * The C4 rollout flags, and a hermetic reset for the tests that assert what
 * happens on either side of them.
 *
 * Every C4 test pins two contracts: the flag-ON behavior, and the flag-OFF
 * "unchanged behavior" that the rollback story depends on. The flag-OFF half was
 * only ever protected by an `afterEach` cleanup, so it read the ambient
 * environment: once a flag is set where `dotenv` can see it - which is exactly
 * what `docs/c4-rollout-runbook.md` step 3 tells an operator to do on
 * Development - the flag-OFF cases silently become flag-ON cases. Five of them
 * failed that way, and the guarantee they exist to protect stopped being tested
 * at the moment it mattered most (#2063).
 *
 * Call `clearC4Flags()` in `beforeEach` so each test states its own flag
 * position rather than inheriting one.
 */
export const C4_FLAG_ENV_VARS = [
  'C4_RESOLVE_AT_MINT_USERS',
  'C4_RESOLVE_AT_MINT_ENTITIES',
  'C4_LOSSLESS_INGEST',
] as const;

export function clearC4Flags(): void {
  for (const flag of C4_FLAG_ENV_VARS) delete process.env[flag];
}
