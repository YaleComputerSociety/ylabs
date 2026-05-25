import { redactDirectContactInfo } from '../utils/contactRedaction';

export interface ListingResearchEntityProfileInput {
  entity?: Record<string, any> | null;
  listing?: Record<string, any> | null;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hasText = (value: unknown): boolean => textValue(value).length > 0;

const isHttpUrl = (value: unknown): value is string => /^https?:\/\//i.test(textValue(value));

const uniqueStrings = (values: unknown[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = textValue(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const stringArray = (value: unknown): string[] => (Array.isArray(value) ? uniqueStrings(value) : []);

const missingArray = (value: unknown): boolean => !Array.isArray(value) || value.length === 0;

const missingText = (value: unknown): boolean => !hasText(value);

const normalizedTextKey = (value: unknown): string =>
  textValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const looksLikeOwnerTitle = (listing: Record<string, any> | null): boolean => {
  const title = normalizedTextKey(listing?.title);
  const ownerName = normalizedTextKey([listing?.ownerFirstName, listing?.ownerLastName].filter(Boolean).join(' '));
  return !!title && !!ownerName && title === ownerName;
};

const looksLikePublicationBlurb = (value: string): boolean =>
  /\b(this|the)\s+(book|article|chapter|essay)\b/i.test(value) ||
  /\b(book|article|chapter|essay)\s+(explores|examines|argues|provides|introduces)\b/i.test(value);

const usableProfileDescription = (
  listing: Record<string, any> | null,
  description: string,
): string => {
  if (!description) return '';
  if (looksLikeOwnerTitle(listing) && looksLikePublicationBlurb(description)) return '';
  return description;
};

export function buildListingResearchEntityProfilePatch({
  entity = {},
  listing = {},
}: ListingResearchEntityProfileInput): Record<string, any> {
  const patch: Record<string, any> = {};
  const urls = uniqueStrings([
    ...(Array.isArray(listing?.websites) ? listing.websites : []),
    listing?.websiteUrl,
    listing?.website,
  ]).filter(isHttpUrl);
  const firstUrl = urls[0];
  const description = usableProfileDescription(
    listing,
    redactDirectContactInfo(textValue(listing?.description || listing?.summary)),
  );
  const departments = stringArray(listing?.departments);
  const researchAreas = uniqueStrings([
    ...(Array.isArray(listing?.researchAreas) ? listing.researchAreas : []),
    ...(Array.isArray(listing?.keywords) ? listing.keywords : []),
  ]);

  if (urls.length > 0 && missingArray(entity?.sourceUrls)) patch.sourceUrls = urls;
  if (firstUrl && missingText(entity?.websiteUrl) && missingText(entity?.website)) {
    patch.websiteUrl = firstUrl;
  }
  if (description) {
    if (missingText(entity?.shortDescription)) patch.shortDescription = description;
    if (missingText(entity?.fullDescription)) patch.fullDescription = description;
    if (missingText(entity?.description)) patch.description = description;
  }
  if (departments.length > 0 && missingArray(entity?.departments)) patch.departments = departments;
  if (researchAreas.length > 0 && missingArray(entity?.researchAreas)) {
    patch.researchAreas = researchAreas;
  }

  return patch;
}
