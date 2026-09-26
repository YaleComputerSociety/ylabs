// Issue #2578 removed `deriveIdentifiedLeadWaysIn`, the producer of
// these two Signal derivation keys. Deleting a producer never removes what it
// already wrote, so every environment still carries its rows.
export const RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS = [
  'signal:REACH_OUT_PLAUSIBLE:IDENTIFIED_FACULTY_LEAD',
  'signal:REACH_OUT_PLAUSIBLE:ORGANIZATIONAL_HOME',
] as const;

export const retiredIdentifiedLeadWaysInFilter = {
  derivationKey: { $in: [...RETIRED_IDENTIFIED_LEAD_WAYS_IN_DERIVATION_KEYS] },
  archived: { $ne: true },
} as const;

export function assertIdentifiedLeadWaysInSignalsFullyRetired(presentAfter: number): void {
  if (presentAfter !== 0) {
    throw new Error(
      `retire:identified-lead-ways-in invariant violated: ${presentAfter} live signals still carry a retired identified-lead ways-in derivation key after apply.`,
    );
  }
}

/**
 * Every stored row carries a synthesized excerpt, and the #1343 rule admits any
 * REACH_OUT_PLAUSIBLE that has one. So `IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS`
 * in accessAcceptanceLevel.ts is the only thing keeping these rows from lifting
 * an entity's acceptance level, and it must outlive the data. This asserts that
 * ordering from the data side: if the denylist is gone while rows remain, the
 * retirement is being run in the wrong order.
 */
export function assertAcceptanceDenylistStillGuards(args: {
  presentBefore: number;
  denylistPresent: boolean;
}): void {
  if (args.presentBefore > 0 && !args.denylistPresent) {
    throw new Error(
      `Refusing to proceed: ${args.presentBefore} retired ways-in signals are still stored while IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS has already been removed, so every one of them is now counting toward acceptance. Restore the denylist, or run this retirement first.`,
    );
  }
}
