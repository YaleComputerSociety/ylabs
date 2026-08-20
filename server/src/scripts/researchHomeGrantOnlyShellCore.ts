import {
  hasUsableWebsiteUrl,
  isGrantOrIdentifierUrl,
  isPromotableWebsiteUrl,
  type WebsiteUrlBackfillCandidateEntity,
} from './backfillResearchEntityWebsiteUrlsCore';

export const GRANT_OR_IDENTIFIER_SOURCE_URL_REGEX =
  /(reporter\.nih\.gov|nih\.gov|nsf\.gov|orcid\.org|scholar\.google\.com|doi\.org)/i;

function evidenceUrls(entity: WebsiteUrlBackfillCandidateEntity): unknown[] {
  return [entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])];
}

/**
 * A grant-only shell is a research entity whose only stored evidence is a
 * grant/identifier host (reporter.nih.gov, nsf.gov, orcid.org, scholar.google.com,
 * doi.org) and that carries no official URL anywhere. The zero-network promotion
 * lane cannot fill it because there is nothing promotable to copy into websiteUrl,
 * so it must go through the network-verified lead-profile lane instead.
 */
export function isGrantOnlyShell(entity: WebsiteUrlBackfillCandidateEntity): boolean {
  if (hasUsableWebsiteUrl(entity)) return false;
  const evidence = evidenceUrls(entity);
  if (evidence.some(isPromotableWebsiteUrl)) return false;
  return evidence.some(isGrantOrIdentifierUrl);
}
