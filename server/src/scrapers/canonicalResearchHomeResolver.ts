import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import mongoose from 'mongoose';

const GRANT_SHELL_SLUG = /^(?:nih|nsf)-pi-/i;
const GRANT_SOURCE_URL = /(?:reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov\/awardsearch|api\.nsf\.gov)/i;
const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];

export interface ResearchHomeCandidate {
  slug?: unknown;
  website?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  archived?: unknown;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function isOfficialResearchHomeCandidate(candidate: ResearchHomeCandidate): boolean {
  const slug = text(candidate.slug);
  if (!slug || candidate.archived === true || GRANT_SHELL_SLUG.test(slug)) return false;

  const urls = [
    text(candidate.websiteUrl),
    text(candidate.website),
    ...(Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls.map(text) : []),
  ].filter(Boolean);
  return urls.some((url) => /^https?:\/\//i.test(url) && !GRANT_SOURCE_URL.test(url));
}

export function selectCanonicalResearchHomeSlug(
  candidates: ResearchHomeCandidate[],
): string | null {
  const eligible = candidates.filter(isOfficialResearchHomeCandidate);
  const slugs = Array.from(new Set(eligible.map((candidate) => text(candidate.slug)).filter(Boolean)));
  return slugs.length === 1 ? slugs[0] : null;
}

export async function findCanonicalResearchHomeSlugForUser(userId: string): Promise<string | null> {
  if (!mongoose.isValidObjectId(userId)) return null;
  const memberships = await ResearchGroupMember.find({
    userId,
    role: { $in: LEAD_ROLES },
    isCurrentMember: { $ne: false },
    archived: { $ne: true },
  })
    .select('researchEntityId')
    .lean();
  const entityIds = Array.from(
    new Set(memberships.map((membership) => String(membership.researchEntityId || '')).filter(Boolean)),
  );
  if (entityIds.length === 0) return null;

  const entities = await ResearchEntity.find({ _id: { $in: entityIds }, archived: { $ne: true } })
    .select('slug website websiteUrl sourceUrls archived')
    .lean();
  return selectCanonicalResearchHomeSlug(
    entities.map((entity) => ({
      slug: entity.slug,
      website: entity.website,
      websiteUrl: entity.websiteUrl,
      sourceUrls: entity.sourceUrls,
      archived: entity.archived,
    })),
  );
}
