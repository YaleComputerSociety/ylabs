import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { personNameFromEntityName } from '../scripts/attachFraNamedLeadsCore';
import { leadIsTheRecordSubjectFor } from './utils/labSiteLeadVerification';
import { listedPersonIsTheNamedLead } from './utils/personNameAgreement';
import mongoose from 'mongoose';

const GRANT_SHELL_SLUG = /^(?:nih|nsf|federal|doe|neh)-pi-/i;
const GRANT_SOURCE_URL =
  /(?:reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov\/awardsearch|api\.nsf\.gov|osti\.gov|(?:awardsearch|apps|securegrants)\.neh\.gov)/i;
const CANONICAL_LEAD_ROLES = LEAD_ROLE_CANONICAL_VALUES;
export const RESEARCH_HOME_CANDIDATE_FIELDS =
  'slug name entityType website websiteUrl sourceUrls archived';

export interface ResearchHomeCandidate {
  slug?: unknown;
  name?: unknown;
  entityType?: unknown;
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

export interface GrantTargetPerson {
  displayName?: unknown;
  profileLinks?: unknown;
}

const OFFICIAL_PROFILE_LINK_KIND = 'YALE_OFFICIAL';

function officialProfileSlugs(person: GrantTargetPerson): string[] {
  if (!Array.isArray(person.profileLinks)) return [];
  return person.profileLinks
    .filter((link: any) => link?.kind === OFFICIAL_PROFILE_LINK_KIND)
    .map((link: any) => {
      try {
        return new URL(text(link?.url)).pathname.split('/').filter(Boolean).at(-1) ?? '';
      } catch {
        return '';
      }
    })
    .map((slug) => slug.toLowerCase())
    .filter((slug) => slug.length >= 3);
}

function hyphenRunContains(haystack: string, needle: string): boolean {
  return `-${haystack.toLowerCase()}-`.includes(`-${needle}-`);
}

function rowCitesOfficialProfileSlug(row: ResearchHomeCandidate, slugs: string[]): boolean {
  if (slugs.length === 0) return false;
  const rowSlug = text(row.slug);
  const urls = [
    text(row.websiteUrl),
    text(row.website),
    ...(Array.isArray(row.sourceUrls) ? row.sourceUrls.map(text) : []),
  ].filter(Boolean);
  return slugs.some(
    (slug) =>
      hyphenRunContains(rowSlug, slug) ||
      urls.some((url) => url.toLowerCase().replace(/\/+$/, '').split('/').includes(slug)),
  );
}

const foldedWords = (value: unknown): string[] =>
  text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function rowKeyNamesPerson(rowSlug: unknown, displayName: unknown): boolean {
  const personWords = foldedWords(displayName).filter((word) => word.length >= 2);
  if (personWords.length < 2) return false;
  const keyWords = new Set(foldedWords(rowSlug));
  const surnames = personWords.slice(1).map((_, index) => personWords.slice(index + 1).join(''));
  if (!surnames.some((surname) => keyWords.has(surname))) return false;
  return keyWords.has(personWords[0]) || keyWords.has('lab');
}

/**
 * A faculty research row is one person's own, so a lead edge on it is a grant target only
 * for the person the row is about. Another person's edge there is how a shared lab site,
 * folded into one co-lead's row, made the other co-lead's grants land on it and re-assert
 * the edge (#5979). Ownership is the person's official profile slug in the row's key or
 * cited pages, the row's key naming the person or the person's lab, or its title naming them.
 */
export function isAnotherPersonsFacultyResearchRow(
  row: ResearchHomeCandidate,
  person: GrantTargetPerson,
): boolean {
  if (!leadIsTheRecordSubjectFor(row.entityType)) return false;
  return !rowIsNamedForPerson(row, person);
}

export function rowIsNamedForPerson(
  row: ResearchHomeCandidate,
  person: GrantTargetPerson,
): boolean {
  if (rowCitesOfficialProfileSlug(row, officialProfileSlugs(person))) return true;
  if (rowKeyNamesPerson(row.slug, person.displayName)) return true;
  const titledPerson = personNameFromEntityName(row.name);
  return Boolean(titledPerson && listedPersonIsTheNamedLead(person.displayName, titledPerson));
}

export interface LeadEdgeOnResearchHome {
  archived?: unknown;
  isCurrentMember?: unknown;
  target: ResearchHomeCandidate | null;
}

function targetsLiveRow(edge: LeadEdgeOnResearchHome): boolean {
  return Boolean(edge.target) && edge.target?.archived !== true;
}

function isCurrentEdgeOnAnotherPersonsFacultyRow(
  edge: LeadEdgeOnResearchHome,
  person: GrantTargetPerson,
): boolean {
  if (!edge.target || !targetsLiveRow(edge) || hasIneligibleLeadMembership([edge])) return false;
  return isAnotherPersonsFacultyResearchRow(edge.target, person);
}

export function resolveCanonicalResearchHomeFromLeadEdges(
  allEdges: LeadEdgeOnResearchHome[],
  person?: GrantTargetPerson,
): CanonicalResearchHomeResolution {
  const edges = person
    ? allEdges.filter((edge) => !isCurrentEdgeOnAnotherPersonsFacultyRow(edge, person))
    : allEdges;
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
    .select('_id displayName profileLinks')
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
        .select(RESEARCH_HOME_CANDIDATE_FIELDS)
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
              name: entity.name,
              entityType: entity.entityType,
              website: entity.website,
              websiteUrl: entity.websiteUrl,
              sourceUrls: entity.sourceUrls,
              archived: entity.archived,
            }
          : null,
      };
    }),
    researcher,
  );
}

export interface OfficialLeadRow {
  slug: string;
  leadPersonIds: string[];
}

const isCurrentLiveEdge = (assignment: any): boolean =>
  assignment.archived !== true && assignment.state !== 'HISTORICAL';

export function coLedOfficialLeadRows(
  rows: readonly OfficialLeadRow[],
  researcherId: string,
): OfficialLeadRow[] {
  return rows.filter(
    (row) =>
      row.leadPersonIds.includes(researcherId) &&
      row.leadPersonIds.some((personId) => personId !== researcherId),
  );
}

export async function loadOfficialLeadRowsForResearcher(
  researcherId: string,
): Promise<OfficialLeadRow[]> {
  if (!mongoose.isValidObjectId(researcherId)) return [];
  const researcher: any = await Researcher.findById(researcherId)
    .select('_id displayName profileLinks')
    .lean();
  if (!researcher?._id) return [];
  const ownEdges = (await RoleAssignment.find({
    personId: researcherId,
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: CANONICAL_LEAD_ROLES },
  })
    .select('target state archived')
    .lean()) as any[];
  const targetIds = Array.from(
    new Set(
      ownEdges
        .filter(isCurrentLiveEdge)
        .map((assignment) => String(assignment.target?.id || ''))
        .filter(Boolean),
    ),
  );
  if (targetIds.length === 0) return [];
  const entities = (await ResearchEntity.find({ _id: { $in: targetIds } })
    .select(RESEARCH_HOME_CANDIDATE_FIELDS)
    .lean()) as any[];
  const officialRows = entities.filter(
    (entity) =>
      isOfficialResearchHomeCandidate(entity) &&
      !isAnotherPersonsFacultyResearchRow(entity, researcher),
  );
  if (officialRows.length === 0) return [];
  const rowEdges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: officialRows.map((entity) => entity._id) },
    role: { $in: CANONICAL_LEAD_ROLES },
  })
    .select('personId target state archived')
    .lean()) as any[];
  const leadsByTarget = new Map<string, Set<string>>();
  for (const assignment of rowEdges.filter(isCurrentLiveEdge)) {
    const targetId = String(assignment.target?.id || '');
    const leads = leadsByTarget.get(targetId) ?? new Set<string>();
    leads.add(String(assignment.personId));
    leadsByTarget.set(targetId, leads);
  }
  return officialRows.map((entity) => ({
    slug: text(entity.slug),
    leadPersonIds: [...(leadsByTarget.get(String(entity._id)) ?? [])],
  }));
}
