/**
 * Rows whose stored name is the anchor text of a hyperlink rather than a research
 * home's name: "Patel Lab Website", "Chen Lab Page", "Zucker Homepage".
 *
 * The ingest sanitizer now strips this chrome and refuses what is left when nothing
 * identifying survives (#2752), but a sanitizer only governs what arrives next. The
 * values already stored keep the chrome, so a student keeps reading a link label as a
 * lab's name until this repair rewrites them.
 *
 * Two outcomes, because the population splits:
 *
 * `strip` - a real name survives underneath, so the chrome is removed and the name
 * beneath it kept. Deterministic and self-evidencing: the value is a prefix of what
 * the source already asserted.
 *
 * `withdraw` - nothing identifying survives ("Zucker" from "Zucker Homepage"). The
 * name cannot be repaired from itself, so the assertion is retired and the row falls
 * back to whatever else names it. Acquiring a real name is a separate step: the
 * linked page usually names itself, and the identity lane is what reads it.
 */
import {
  isPersonPageLinkLabelName,
  stripResearchHomeNameLinkChrome,
} from '../utils/researchHomeNameIdentityAuthority';

export type LinkChromeNameOutcome = 'strip' | 'withdraw' | 'no-chrome' | 'locked';

export interface LinkChromeNameCandidate {
  slug: string;
  name?: unknown;
  displayName?: unknown;
  manuallyLockedFields?: unknown;
}

export interface LinkChromeNameRow {
  slug: string;
  outcome: LinkChromeNameOutcome;
  storedName: string;
  repairedName?: string;
  storedDisplayName?: string;
  repairedDisplayName?: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export function classifyLinkChromeName(candidate: LinkChromeNameCandidate): LinkChromeNameRow {
  const storedName = text(candidate.name);
  const storedDisplayName = text(candidate.displayName);
  const row: LinkChromeNameRow = { slug: candidate.slug, outcome: 'no-chrome', storedName };
  if (storedDisplayName) row.storedDisplayName = storedDisplayName;

  const locked = asStringArray(candidate.manuallyLockedFields);
  if (locked.includes('name') || locked.includes('displayName')) {
    return { ...row, outcome: 'locked' };
  }

  if (isPersonPageLinkLabelName(storedName)) return { ...row, outcome: 'withdraw' };

  const stripped = stripResearchHomeNameLinkChrome(storedName);
  if (stripped && stripped !== storedName) {
    const strippedDisplay = stripResearchHomeNameLinkChrome(storedDisplayName);
    return {
      ...row,
      outcome: 'strip',
      repairedName: stripped,
      ...(storedDisplayName && strippedDisplay !== storedDisplayName
        ? { repairedDisplayName: strippedDisplay }
        : {}),
    };
  }
  return row;
}

export function planLinkChromeNameRepair(
  candidates: LinkChromeNameCandidate[],
): LinkChromeNameRow[] {
  return candidates.map((candidate) => classifyLinkChromeName(candidate));
}

export function summarizeLinkChromeNameRepair(
  rows: LinkChromeNameRow[],
): Record<LinkChromeNameOutcome, number> {
  const summary: Record<LinkChromeNameOutcome, number> = {
    strip: 0,
    withdraw: 0,
    'no-chrome': 0,
    locked: 0,
  };
  for (const row of rows) summary[row.outcome] += 1;
  return summary;
}
