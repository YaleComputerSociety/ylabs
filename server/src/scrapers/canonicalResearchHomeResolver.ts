import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import mongoose from 'mongoose';

const GRANT_SHELL_SLUG = /^(?:nih|nsf|federal|doe|neh)-pi-/i;
const GRANT_SOURCE_URL =
  /(?:reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov\/awardsearch|api\.nsf\.gov|osti\.gov|(?:awardsearch|apps|securegrants)\.neh\.gov)/i;
const CANONICAL_LEAD_ROLES = LEAD_ROLE_CANONICAL_VALUES;

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

export interface LeadEdgeOnResearchHome {
  archived?: unknown;
  isCurrentMember?: unknown;
  target: ResearchHomeCandidate | null;
}

function targetsLiveRow(edge: LeadEdgeOnResearchHome): boolean {
  return Boolean(edge.target) && edge.target?.archived !== true;
}

export function resolveCanonicalResearchHomeFromLeadEdges(
  edges: LeadEdgeOnResearchHome[],
): CanonicalResearchHomeResolution {
  if (edges.length === 0) return { status: 'safe-shell' };
  const edgesOnLiveRows = edges.filter(targetsLiveRow);
  if (edgesOnLiveRows.length === 0 || hasIneligibleLeadMembership(edgesOnLiveRows)) {
    return { status: 'ineligible' };
  }
  return resolveCanonicalResearchHome(
    edgesOnLiveRows.map((edge) => edge.target as ResearchHomeCandidate),
  );
}

export async function resolveCanonicalResearchHomeForResearcher(
  researcherId: string,
): Promise<CanonicalResearchHomeResolution> {
  if (!mongoose.isValidObjectId(researcherId)) return { status: 'ineligible' };
  const researcher: any = await Researcher.findOne({
    _id: researcherId,
    archived: { $ne: true },
  })
    .select('_id')
    .lean();
  if (!researcher?._id) return { status: 'safe-shell' };
  const assignments = (await RoleAssignment.find({
    personId: researcher._id,
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: CANONICAL_LEAD_ROLES },
  })
    .select('target state archived')
    .lean()) as any[];
  const targetIds = Array.from(
    new Set(assignments.map((assignment) => String(assignment.target?.id || '')).filter(Boolean)),
  );
  const entities = targetIds.length
    ? await ResearchEntity.find({ _id: { $in: targetIds } })
        .select('slug website websiteUrl sourceUrls archived')
        .lean()
    : [];
  const entityById = new Map(entities.map((entity: any) => [String(entity._id), entity]));
  return resolveCanonicalResearchHomeFromLeadEdges(
    assignments.map((assignment) => {
      const entity: any = entityById.get(String(assignment.target?.id || ''));
      return {
        archived: assignment.archived,
        isCurrentMember: assignment.state !== 'HISTORICAL',
        target: entity
          ? {
              slug: entity.slug,
              website: entity.website,
              websiteUrl: entity.websiteUrl,
              sourceUrls: entity.sourceUrls,
              archived: entity.archived,
            }
          : null,
      };
    }),
  );
}
