export const LEAD_CONTRADICTED_BY_NAMESAKE_REASON = 'lead_contradicted_by_namesake';

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const comparableUrl = (value: unknown): string =>
  textValue(value)
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

/**
 * Whether the row's own website names a same-surname person whose given name cannot be
 * an attached lead's, on the page the row still serves (#4916).
 *
 * Only a `NAMESAKE` contradiction counts. A person named beside a lead-role phrase was
 * measured mostly wrong (#3750), and a verdict about a website the row no longer serves
 * says nothing about the row. The lead must still be attached, so a detached lead's old
 * verdict never holds a row.
 */
export function servedLeadIsContradictedByNamesake(
  entity: { leadVerification?: unknown; websiteUrl?: unknown; website?: unknown },
  leadMembers: ReadonlyArray<Record<string, any>>,
): boolean {
  const verification = entity?.leadVerification as
    { checkedUrl?: unknown; requestedUrl?: unknown; leads?: unknown } | undefined;
  if (!verification || !Array.isArray(verification.leads)) return false;
  const served = comparableUrl(textValue(entity.websiteUrl) || entity.website);
  if (!served) return false;
  const verifiedPages = [verification.checkedUrl, verification.requestedUrl].map(comparableUrl);
  if (!verifiedPages.includes(served)) return false;
  const attached = new Set(
    leadMembers.map((member) => String(member?.userId ?? member?.user?._id ?? '')).filter(Boolean),
  );
  return (verification.leads as Array<Record<string, unknown>>).some(
    (judgement) =>
      judgement?.verdict === 'CONTRADICTED' &&
      judgement?.contradictedBy === 'NAMESAKE' &&
      attached.has(String(judgement?.personId ?? '')),
  );
}
