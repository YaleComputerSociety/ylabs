/**
 * Every path by which an emitted observation is not stored. A run's emitted count minus its
 * stored count is exactly the sum of these, so a run reconciles from its report alone (#6441).
 */
export type ObservationHoldGuard =
  | 'removed-by-request'
  | 'uncitable-host'
  | 'description-on-shared-page'
  | 'furniture'
  | 'retired-field'
  | 'invalid-enum'
  | 'self-defeating-card'
  | 'regressive-prose'
  | 'weaker-prose'
  | 'card-losing-pair'
  | 'dry-run'
  | 'not-landed';

/** Held observations per guard, counted by field; never their values. */
export type ObservationsHeldByGuard = Partial<Record<ObservationHoldGuard, Record<string, number>>>;

export function heldObservationCount(held: ObservationsHeldByGuard): number {
  return Object.values(held).reduce(
    (total, byField) => total + Object.values(byField ?? {}).reduce((sum, n) => sum + n, 0),
    0,
  );
}

export function mergeObservationsHeldByGuard(
  into: ObservationsHeldByGuard,
  from: ObservationsHeldByGuard | undefined,
): ObservationsHeldByGuard {
  for (const [guard, byField] of Object.entries(from ?? {}) as Array<
    [ObservationHoldGuard, Record<string, number>]
  >) {
    const target = (into[guard] ??= {});
    for (const [field, n] of Object.entries(byField)) target[field] = (target[field] ?? 0) + n;
  }
  return into;
}

export const describeHeldByGuard = (held: ObservationsHeldByGuard): string =>
  (Object.entries(held) as Array<[ObservationHoldGuard, Record<string, number>]>)
    .map(
      ([guard, byField]) =>
        `${guard} (${Object.entries(byField)
          .map(([field, n]) => `${field} ${n}`)
          .join(', ')})`,
    )
    .join('; ');
