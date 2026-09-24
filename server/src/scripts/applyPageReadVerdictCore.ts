/**
 * The three verdicts a page read can support on a row whose served heading disagrees
 * with its own type, kept apart because they are different fixes (#3252).
 *
 * They are deliberately not one arm. Each rests on a different fact about the page, and
 * collapsing them is how a repair reports success having done a third of the job.
 */
export const PAGE_READ_ARMS = [
  /**
   * The page NAMES the laboratory, in its own title or first heading, matching the
   * row's name. That is evidence, and it is the only reason a promotion is allowed
   * here.
   *
   * The distinction is the whole of #2686 and it will be mis-cited: a `websiteUrl`
   * merely EXISTING is not evidence of a laboratory, measured as a gradient at 72
   * against 23 percent, and promoting on it would have typed roughly 240 personal
   * homepages as laboratories. The honest FRA-to-LAB ceiling measured 28 rather than
   * 480. This arm is not that. It requires the page to state the lab's name, it is
   * per-row, and one row qualifying is not a licence for a cohort.
   */
  'promote-declared-lab',
  /**
   * The row's `websiteUrl` is a department or division landing page, so it is not that
   * row's own site and supports nothing about it. The URL is refused and the row keeps
   * whatever its remaining evidence supports, which may be nothing.
   */
  'refuse-borrowed-site',
  /**
   * An affiliated organization was grafted onto a person-scoped row. The graft reaches
   * several fields at once, so refusing only the heading leaves the rest of it live and
   * free to win a later pass.
   */
  'refuse-grafted-organization',
] as const;

export type PageReadArm = (typeof PAGE_READ_ARMS)[number];

export interface PageReadRow {
  slug: string;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  websiteUrl?: unknown;
  manuallyLockedFields?: unknown;
  /** Live observation values on the row, so a plan can say what survives a refusal. */
  observations: ReadonlyArray<{ field: string; value: string }>;
  /** Other live rows carrying the same `websiteUrl`. */
  rowsSharingTheWebsiteUrl: number;
}

export type PageReadRefusal =
  | 'manually-locked'
  | 'already-the-declared-type'
  | 'no-website-to-refuse'
  | 'another-row-shares-the-site'
  | 'no-graft-to-refuse'
  | 'refusing-the-name-would-leave-no-heading';

export interface PageReadPlan {
  slug: string;
  arm: PageReadArm;
  /** Values to refuse, field and value together. */
  refusals: Array<{ field: string; value: string }>;
  /** Stored fields to set, applied before the rematerialize. */
  set: Record<string, string>;
}

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function planPageReadVerdict(
  row: PageReadRow,
  arm: PageReadArm,
): { plan?: PageReadPlan; refused?: PageReadRefusal } {
  const locked = Array.isArray(row.manuallyLockedFields)
    ? row.manuallyLockedFields.map((value) => String(value))
    : [];
  if (locked.length > 0) return { refused: 'manually-locked' };

  if (arm === 'promote-declared-lab') {
    if (textValue(row.entityType).toUpperCase() === 'LAB') {
      return { refused: 'already-the-declared-type' };
    }
    // Any observation asserting the person-scoped type has to be refused, or the next
    // pass re-derives it over the stored value. Nothing else is touched: the name is
    // already what the page carries, which is why this row qualifies at all.
    const refusals = row.observations.filter(
      (observation) =>
        (observation.field === 'entityType' && observation.value.toUpperCase() !== 'LAB') ||
        (observation.field === 'kind' && observation.value.toLowerCase() !== 'lab'),
    );
    return { plan: { slug: row.slug, arm, refusals, set: { entityType: 'LAB', kind: 'lab' } } };
  }

  if (arm === 'refuse-borrowed-site') {
    const websiteUrl = textValue(row.websiteUrl);
    if (!websiteUrl) return { refused: 'no-website-to-refuse' };
    // Clearing a borrowed URL promotes the borrower, measured at 3 grafted rows
    // published when 10 were cleared. With no other row on the URL there is no borrower
    // to promote, and a shared URL needs the other row read first.
    if (row.rowsSharingTheWebsiteUrl > 0) return { refused: 'another-row-shares-the-site' };
    // The stored value is cleared as well as refused. A refusal keeps the observation
    // from being admitted again; it does not remove what the row already serves, so
    // without this a student keeps seeing a department page as the row's own site.
    return {
      plan: {
        slug: row.slug,
        arm,
        refusals: [{ field: 'websiteUrl', value: websiteUrl }],
        set: { websiteUrl: '' },
      },
    };
  }

  const graftedHeading = textValue(row.displayName);
  if (!graftedHeading) return { refused: 'no-graft-to-refuse' };
  const ownName = textValue(row.name);
  // The fallback rule. Refusing the heading is safe only because `name` holds a value
  // that is not the graft: without one the row would serve a blank heading, which
  // preserves the fabrication rather than removing it.
  if (!ownName || ownName.toLowerCase() === graftedHeading.toLowerCase()) {
    return { refused: 'refusing-the-name-would-leave-no-heading' };
  }
  // A graft reaches several fields at once, so every field carrying the grafted value is
  // refused together, plus the organizational type it brought with it. Refusing only the
  // heading leaves the rest live and free to win a later pass.
  const refusals: Array<{ field: string; value: string }> = [
    { field: 'displayName', value: graftedHeading },
  ];
  for (const observation of row.observations) {
    if (
      (observation.field === 'name' || observation.field === 'displayName') &&
      observation.value.toLowerCase() === graftedHeading.toLowerCase()
    ) {
      refusals.push({ field: observation.field, value: observation.value });
    }
    if (observation.field === 'entityType' && observation.value.toUpperCase() === 'LAB') {
      refusals.push({ field: 'entityType', value: observation.value });
    }
    if (observation.field === 'kind' && observation.value.toLowerCase() === 'lab') {
      refusals.push({ field: 'kind', value: observation.value });
    }
  }
  const deduped = new Map(refusals.map((entry) => [`${entry.field}|${entry.value}`, entry]));
  return {
    plan: { slug: row.slug, arm, refusals: Array.from(deduped.values()), set: { displayName: '' } },
  };
}
