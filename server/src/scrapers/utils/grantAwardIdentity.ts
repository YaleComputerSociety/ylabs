const NIH_APPLICATION_NUMBER = /^\d?([A-Z]\d{2}[A-Z]{2}\d{6})(?:\d{2}[A-Z0-9]*)?$/;
const DOE_AWARD_NUMBER = /^(?:DE)?([A-Z]{2}\d{2}[A-Z0-9]*)$/;

const compactAwardNumber = (value: unknown): string =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const funderKey = (agency: unknown): string => compactAwardNumber(agency);

/**
 * One award reported by several lanes must count once, so identity is the award
 * number with case and punctuation dropped, scoped to the funder that issued it.
 * An NIH application number collapses to its core project number whichever
 * institute label a lane attached, and a DOE award number keeps one identity
 * with or without its `DE-` prefix.
 */
export function grantAwardIdentity(grant: { id?: unknown; agency?: unknown }): string | null {
  const award = compactAwardNumber(grant.id);
  if (!award) return null;
  const nih = NIH_APPLICATION_NUMBER.exec(award);
  if (nih) return `NIH:${nih[1]}`;
  const funder = funderKey(grant.agency);
  if (funder === 'DOE') {
    const doe = DOE_AWARD_NUMBER.exec(award);
    if (doe) return `DOE:${doe[1]}`;
  }
  return `${funder}:${award}`;
}
