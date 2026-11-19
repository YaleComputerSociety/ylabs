export const LEAD_CONTRADICTED_BY_NAMESAKE_REASON = 'lead_contradicted_by_namesake';

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const comparableUrl = (value: unknown): string =>
  textValue(value)
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

export type ServedSiteLeadVerdict = 'CONFIRMED' | 'NAMESAKE';

interface LeadVerdictBearer {
  leadVerification?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
}

/**
 * Whether the row's lead verdict was read from the page the row still serves. A row that lost
 * its website, or now serves another one, keeps its last verdict because no lane run reaches it
 * again (#6281), so every reader of a verdict asks this first.
 */
export function leadVerificationReadsServedPage(entity: LeadVerdictBearer): boolean {
  const verification = entity?.leadVerification as
    { checkedUrl?: unknown; requestedUrl?: unknown } | null | undefined;
  if (!verification) return false;
  const served = comparableUrl(textValue(entity.websiteUrl) || entity.website);
  if (!served) return false;
  return [verification.checkedUrl, verification.requestedUrl].map(comparableUrl).includes(served);
}

/**
 * The verdicts the row's own website gave its leads, keyed by person, read only when the
 * verified page is the page the row still serves. A verdict about a website the row no
 * longer serves says nothing about the row, and the gate reads no contradiction shape but
 * `NAMESAKE` (#3750, #5962), so only a confirmation and a `NAMESAKE` contradiction are
 * returned.
 */
export function servedSiteLeadVerdicts(
  entity: LeadVerdictBearer,
): Map<string, ServedSiteLeadVerdict> {
  const verdicts = new Map<string, ServedSiteLeadVerdict>();
  const verification = entity?.leadVerification as { leads?: unknown } | undefined;
  if (!verification || !Array.isArray(verification.leads)) return verdicts;
  if (!leadVerificationReadsServedPage(entity)) return verdicts;
  for (const judgement of verification.leads as Array<Record<string, unknown>>) {
    const personId = String(judgement?.personId ?? '');
    if (!personId) continue;
    if (judgement?.verdict === 'CONFIRMED') verdicts.set(personId, 'CONFIRMED');
    else if (judgement?.verdict === 'CONTRADICTED' && judgement?.contradictedBy === 'NAMESAKE') {
      verdicts.set(personId, 'NAMESAKE');
    }
  }
  return verdicts;
}

/**
 * Whether the row's own website names a same-surname person whose given name cannot be
 * an attached lead's, on the page the row still serves (#4916).
 *
 * The lead must still be attached, so a detached lead's old verdict never holds a row.
 */
export function servedLeadIsContradictedByNamesake(
  entity: { leadVerification?: unknown; websiteUrl?: unknown; website?: unknown },
  leadMembers: ReadonlyArray<Record<string, any>>,
): boolean {
  const verdicts = servedSiteLeadVerdicts(entity);
  return leadMembers.some(
    (member) => verdicts.get(String(member?.userId ?? member?.user?._id ?? '')) === 'NAMESAKE',
  );
}
