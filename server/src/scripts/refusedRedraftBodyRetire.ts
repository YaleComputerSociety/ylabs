import { servingBarAcceptsFullDescription } from '../scrapers/utils/fullDescriptionServingBar';

export const REFUSED_REDRAFT_RETIRE_REASON_PREFIX = 'written-description-refused-redraft';

export function refusedRedraftRetireReason(contract: string, refusal: string): string {
  return `${REFUSED_REDRAFT_RETIRE_REASON_PREFIX}:${contract}:draft-refused=${refusal}:adopted-body-failed-support-check`;
}

export type RefusedRedraftRetireOutcome =
  'kept-supported' | 'retire-with-fallback' | 'residual-no-fallback';

/**
 * What happens to an adopted written body when the redraft for its row is refused. A body
 * that still clears every writer arm against today's evidence is kept, whatever the redraft
 * says (#4979 retired 163 such bodies). An unsupported body is retired only when the row
 * would still serve a description without it, because a retire that leaves the row with
 * none is a visibility change the owner decides, not this lane.
 */
export function decideRefusedRedraftRetire(input: {
  adoptedBodyStillSupported: boolean;
  fallbackServes: boolean;
}): RefusedRedraftRetireOutcome {
  if (input.adoptedBodyStillSupported) return 'kept-supported';
  return input.fallbackServes ? 'retire-with-fallback' : 'residual-no-fallback';
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** Whether the dry-run projection without the adopted body still serves another description. */
export function fallbackServesAfterRetire(input: {
  entityDoc: Record<string, unknown> | null | undefined;
  plannedSet: Record<string, unknown> | undefined;
  plannedUnset: Record<string, unknown> | undefined;
  retiredBody: string;
  leadPersonName: string;
}): boolean {
  if (input.plannedUnset && Object.hasOwn(input.plannedUnset, 'fullDescription')) return false;
  const planned = textValue(
    input.plannedSet && Object.hasOwn(input.plannedSet, 'fullDescription')
      ? input.plannedSet.fullDescription
      : input.entityDoc?.fullDescription,
  );
  if (!planned || planned === textValue(input.retiredBody)) return false;
  return servingBarAcceptsFullDescription(
    input.entityDoc,
    input.plannedSet ?? {},
    planned,
    input.leadPersonName,
  );
}
