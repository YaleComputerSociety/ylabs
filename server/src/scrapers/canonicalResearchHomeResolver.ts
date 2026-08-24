import { ResearchEntity } from '../models/researchEntity';
import { RoleAssignment, type RoleAssignmentRole } from '../models/roleAssignment';
import { canonicalRoleForLegacy } from '../models/canonicalRoleMapping';
import { resolveResearcherIdForLegacyUser } from '../services/researchEntityMembershipAccessor';
import mongoose from 'mongoose';

const GRANT_SHELL_SLUG = /^(?:nih|nsf|federal)-pi-/i;
const GRANT_SOURCE_URL =
  /(?:reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov\/awardsearch|api\.nsf\.gov|usaspending\.gov)/i;
const LEAD_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const CANONICAL_LEAD_ROLES = LEAD_ROLES.map((role) => canonicalRoleForLegacy(role)).filter(
  (role): role is RoleAssignmentRole => Boolean(role),
);

export interface ResearchHomeCandidate {
  slug?: unknown;
  website?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
  archived?: unknown;
}

export type CanonicalResearchHomeResolution =
  | { status: 'safe-shell' }
  | { status: 'canonical'; slug: string }
  | { status: 'ineligible' }
  | { status: 'ambiguous' };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function hasIneligibleLeadMembership(
  memberships: Array<{ archived?: unknown; isCurrentMember?: unknown }>,
): boolean {
  return memberships.some(
    (membership) => membership.archived === true || membership.isCurrentMember === false,
  );
}

function hasNonGrantOfficialWebsite(candidate: ResearchHomeCandidate): boolean {
  const urls = [
    text(candidate.websiteUrl),
    text(candidate.website),
    ...(Array.isArray(candidate.sourceUrls) ? candidate.sourceUrls.map(text) : []),
  ].filter(Boolean);
  return urls.some((url) => /^https?:\/\//i.test(url) && !GRANT_SOURCE_URL.test(url));
}

export function isOfficialResearchHomeCandidate(candidate: ResearchHomeCandidate): boolean {
  const slug = text(candidate.slug);
  if (!slug || candidate.archived === true || GRANT_SHELL_SLUG.test(slug)) return false;
  return hasNonGrantOfficialWebsite(candidate);
}

export function isGraduatedGrantShellCandidate(candidate: ResearchHomeCandidate): boolean {
  const slug = text(candidate.slug);
  if (!slug || candidate.archived === true || !GRANT_SHELL_SLUG.test(slug)) return false;
  return hasNonGrantOfficialWebsite(candidate);
}

function distinctSlugs(candidates: ResearchHomeCandidate[]): string[] {
  return Array.from(new Set(candidates.map((candidate) => text(candidate.slug)).filter(Boolean)));
}

export function selectCanonicalResearchHomeSlug(
  candidates: ResearchHomeCandidate[],
): string | null {
  const officialSlugs = distinctSlugs(candidates.filter(isOfficialResearchHomeCandidate));
  if (officialSlugs.length === 1) return officialSlugs[0];
  if (officialSlugs.length > 1) return null;
  const graduatedSlugs = distinctSlugs(candidates.filter(isGraduatedGrantShellCandidate));
  return graduatedSlugs.length === 1 ? graduatedSlugs[0] : null;
}

export function resolveCanonicalResearchHome(
  candidates: ResearchHomeCandidate[],
): CanonicalResearchHomeResolution {
  if (candidates.length === 0) return { status: 'safe-shell' };
  const officialSlugs = distinctSlugs(candidates.filter(isOfficialResearchHomeCandidate));
  if (officialSlugs.length === 1) return { status: 'canonical', slug: officialSlugs[0] };
  if (officialSlugs.length > 1) return { status: 'ambiguous' };

  const graduatedSlugs = distinctSlugs(candidates.filter(isGraduatedGrantShellCandidate));
  if (graduatedSlugs.length === 1) return { status: 'canonical', slug: graduatedSlugs[0] };
  if (graduatedSlugs.length > 1) return { status: 'ambiguous' };
  return { status: 'ineligible' };
}

export async function resolveCanonicalResearchHomeForUser(
  userId: string,
): Promise<CanonicalResearchHomeResolution> {
  if (!mongoose.isValidObjectId(userId)) return { status: 'ineligible' };
  const personId = await resolveResearcherIdForLegacyUser(userId);
  if (!personId) return { status: 'safe-shell' };
  const assignments = await RoleAssignment.find({
    personId,
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: CANONICAL_LEAD_ROLES },
  })
    .select('target state archived')
    .lean();
  const memberships = (assignments as any[]).map((assignment) => ({
    researchEntityId: assignment.target?.id,
    isCurrentMember: assignment.state !== 'HISTORICAL',
    archived: assignment.archived,
  }));
  if (hasIneligibleLeadMembership(memberships)) {
    return { status: 'ineligible' };
  }
  const entityIds = Array.from(
    new Set(
      memberships.map((membership) => String(membership.researchEntityId || '')).filter(Boolean),
    ),
  );
  if (entityIds.length === 0) return { status: 'safe-shell' };

  const entities = await ResearchEntity.find({ _id: { $in: entityIds } })
    .select('slug website websiteUrl sourceUrls archived')
    .lean();
  if (entities.length === 0) return { status: 'ineligible' };
  return resolveCanonicalResearchHome(
    entities.map((entity) => ({
      slug: entity.slug,
      website: entity.website,
      websiteUrl: entity.websiteUrl,
      sourceUrls: entity.sourceUrls,
      archived: entity.archived,
    })),
  );
}
