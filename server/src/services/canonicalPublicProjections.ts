import mongoose from 'mongoose';
import {
  isEvidenceClaimPredicate,
  type EvidenceClaimPredicate,
} from '../models/evidencePredicateRegistry';
import {
  isValidOrcid,
  researcherProfileLinkKinds,
  type ResearcherProfileLinkKind,
  type ResearcherProfileLinkPurpose,
} from '../models/researcher';
import { roleAssignmentRoles, type RoleAssignmentRole } from '../models/roleAssignment';
import { isStudentVisibilityTier, type StudentVisibilityTier } from '../models/studentVisibility';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { publicHttpUrl } from '../utils/urlSafety';

const MAX_BEST_NEXT_STEP_CATEGORY_LENGTH = 120;

export const MAX_PUBLIC_PERSON_NAME_LENGTH = 240;
export const MAX_PUBLIC_PERSON_RESEARCH_PROFILES = 2;
export const MAX_PUBLIC_EVIDENCE_ITEMS = 12;
export const MAX_PUBLIC_DISCOVERY_LEADS = 8;
export const MAX_PUBLIC_DISCOVERY_TEXT_LENGTH = 120;
export const MAX_PUBLIC_DISCOVERY_OPPORTUNITY_COUNT = 9_999;
export const MIN_PUBLIC_DISCOVERY_BROWSE_RANK = -1_000;
export const MAX_PUBLIC_DISCOVERY_BROWSE_RANK = 1_000;

/**
 * Discovery is recomputed for every affected entity after a successful
 * canonical materializer or moderated canonical write.
 * A scheduled reconciliation must repair missed invalidations before this
 * 24-hour bound is exceeded.
 */
export const RESEARCH_ENTITY_DISCOVERY_STALENESS_BOUND_MS = 24 * 60 * 60 * 1_000;
export const RESEARCH_ENTITY_DISCOVERY_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const researchEntityDiscoveryRecomputeTriggers = [
  'CANONICAL_MATERIALIZER_COMMIT',
  'MODERATED_CANONICAL_WRITE',
  'SCHEDULED_RECONCILIATION',
] as const;

const PRIMARY_PROFILE_PRECEDENCE: readonly ResearcherProfileLinkKind[] = [
  'YALE_OFFICIAL',
  'LAB_ABOUT',
  'PERSONAL_ACADEMIC',
];
const RESEARCH_PROFILE_PRECEDENCE: readonly ResearcherProfileLinkKind[] = [
  'GOOGLE_SCHOLAR',
  'ORCID',
];
const PROFILE_LABELS: Record<ResearcherProfileLinkKind, string> = {
  YALE_OFFICIAL: 'Yale profile',
  LAB_ABOUT: 'Lab profile',
  PERSONAL_ACADEMIC: 'Academic profile',
  GOOGLE_SCHOLAR: 'Google Scholar',
  ORCID: 'ORCID',
};

export interface PublicPersonProfileDto {
  kind: ResearcherProfileLinkKind;
  label: string;
  url: string;
}

export interface PublicPersonDto {
  id: string;
  displayName: string;
  primaryProfile?: PublicPersonProfileDto;
  researchProfiles: PublicPersonProfileDto[];
}

export interface PublicPersonProjectionOptions {
  hasCurrentApprovedRole?: boolean;
  now?: Date;
}

export interface PublicEvidenceClaimDto {
  predicate: EvidenceClaimPredicate;
  observedAt: string;
  confidence?: number;
}

export interface ResearchEntityDiscoveryLead {
  personId: string;
  displayName: string;
  role: RoleAssignmentRole;
  officialProfileUrl?: string;
}

export interface ResearchEntityDiscoveryProjection {
  leads: ResearchEntityDiscoveryLead[];
  accessState: string;
  bestNextStepCategory?: string;
  openOpportunityCount: number;
  browseRankScore: number;
  visibilityState: StudentVisibilityTier;
  computedAt: Date;
}

export interface ResearchEntityDiscoveryInput {
  leads?: readonly Record<string, unknown>[];
  accessState: unknown;
  bestNextStepCategory?: unknown;
  openOpportunityCount: unknown;
  browseRankScore: unknown;
  visibilityState: unknown;
  computedAt: unknown;
}

export interface ResearchEntityDiscoveryProjectionOptions {
  now?: Date;
}

export type ResearchEntityDiscoveryFreshness = 'missing' | 'fresh' | 'stale' | 'future';

function canonicalId(value: unknown): string | undefined {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return mongoose.isObjectIdOrHexString(trimmed)
    ? new mongoose.Types.ObjectId(trimmed).toHexString()
    : undefined;
}

function boundedPublicText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = redactDirectContactInfo(value.normalize('NFKC').replace(/\s+/g, ' ').trim()).slice(
    0,
    maximum,
  );
  return text || undefined;
}

function validDate(value: unknown, now?: Date): Date | undefined {
  const date = value instanceof Date ? new Date(value.getTime()) : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  if (now && date.getTime() > now.getTime()) return undefined;
  return date;
}

function canonicalProfileUrl(kind: ResearcherProfileLinkKind, value: unknown): string | undefined {
  const url = publicHttpUrl(value);
  if (!url || !url.startsWith('https://')) return undefined;
  const parsed = new URL(url);

  if (kind === 'YALE_OFFICIAL') {
    return parsed.hostname === 'yale.edu' || parsed.hostname.endsWith('.yale.edu')
      ? url
      : undefined;
  }
  if (kind === 'GOOGLE_SCHOLAR') {
    const scholarId = parsed.searchParams.get('user');
    return parsed.hostname === 'scholar.google.com' &&
      parsed.pathname === '/citations' &&
      typeof scholarId === 'string' &&
      /^[A-Za-z0-9_-]+$/.test(scholarId)
      ? `https://scholar.google.com/citations?user=${encodeURIComponent(scholarId)}`
      : undefined;
  }
  if (kind === 'ORCID') {
    const match = /^\/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/i.exec(parsed.pathname);
    const orcid = match?.[1].toUpperCase();
    return parsed.hostname === 'orcid.org' &&
      orcid !== undefined &&
      isValidOrcid(orcid) &&
      !parsed.search &&
      !parsed.hash
      ? `https://orcid.org/${orcid}`
      : undefined;
  }
  return url;
}

function publicProfileLink(
  value: unknown,
  expectedPurpose: ResearcherProfileLinkPurpose,
  now: Date,
): PublicPersonProfileDto | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const link = value as Record<string, unknown>;
  if (
    !researcherProfileLinkKinds.includes(link.kind as ResearcherProfileLinkKind) ||
    link.purpose !== expectedPurpose ||
    (link.healthStatus !== 'HEALTHY' && link.healthStatus !== 'UNKNOWN') ||
    !validDate(link.verifiedAt, now)
  ) {
    return undefined;
  }

  const kind = link.kind as ResearcherProfileLinkKind;
  const url = canonicalProfileUrl(kind, link.url);
  if (!url) return undefined;
  return {
    kind,
    label: PROFILE_LABELS[kind],
    url,
  };
}

/**
 * Projects the only supported public Researcher shape.
 *
 * ACTIVE people may render directly.
 * UNKNOWN people require a current approved role as corroboration.
 * DEPARTED people always fail closed even if a stale role says CURRENT.
 */
export function toPublicPersonDto(
  person: Record<string, unknown>,
  options: PublicPersonProjectionOptions = {},
): PublicPersonDto | undefined {
  if (person.archived !== false || person.status === 'DEPARTED') return undefined;
  if (
    person.status !== 'ACTIVE' &&
    !(person.status === 'UNKNOWN' && options.hasCurrentApprovedRole === true)
  ) {
    return undefined;
  }

  const id = canonicalId(person._id ?? person.id);
  const displayName = boundedPublicText(person.displayName, MAX_PUBLIC_PERSON_NAME_LENGTH);
  if (!id || !displayName) return undefined;

  const now = options.now ?? new Date();
  const links = Array.isArray(person.profileLinks)
    ? person.profileLinks.slice(0, researcherProfileLinkKinds.length)
    : [];
  const primaryProfile = PRIMARY_PROFILE_PRECEDENCE.flatMap((kind) => {
    const candidate = links.find(
      (link) => link && typeof link === 'object' && (link as Record<string, unknown>).kind === kind,
    );
    const projected = publicProfileLink(candidate, 'PRIMARY_IDENTITY', now);
    return projected ? [projected] : [];
  })[0];
  const researchProfiles = RESEARCH_PROFILE_PRECEDENCE.flatMap((kind) => {
    const candidate = links.find(
      (link) => link && typeof link === 'object' && (link as Record<string, unknown>).kind === kind,
    );
    const projected = publicProfileLink(candidate, 'SCHOLARLY', now);
    return projected ? [projected] : [];
  }).slice(0, MAX_PUBLIC_PERSON_RESEARCH_PROFILES);

  return {
    id,
    displayName,
    ...(primaryProfile ? { primaryProfile } : {}),
    researchProfiles,
  };
}

/**
 * Projects public claim metadata only.
 *
 * Claim values, excerpts, source-document identifiers, raw source documents,
 * review notes, and diagnostics are deliberately not accepted into the DTO.
 */
export function toPublicEvidenceClaimDtos(
  claims: readonly Record<string, unknown>[],
  now = new Date(),
): PublicEvidenceClaimDto[] {
  if (!Array.isArray(claims)) return [];
  return claims
    .flatMap((claim) => {
      if (
        claim.sensitivity !== 'PUBLIC' ||
        claim.status !== 'ACTIVE' ||
        !isEvidenceClaimPredicate(claim.predicate)
      ) {
        return [];
      }
      const observedAt = validDate(claim.observedAt, now);
      if (!observedAt) return [];
      const confidence =
        typeof claim.confidence === 'number' &&
        Number.isFinite(claim.confidence) &&
        claim.confidence >= 0 &&
        claim.confidence <= 1
          ? claim.confidence
          : undefined;
      return [
        {
          predicate: claim.predicate,
          observedAt: observedAt.toISOString(),
          ...(confidence === undefined ? {} : { confidence }),
        },
      ];
    })
    .slice(0, MAX_PUBLIC_EVIDENCE_ITEMS);
}

function boundedDiscoveryCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_PUBLIC_DISCOVERY_OPPORTUNITY_COUNT);
}

function boundedBrowseRank(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(
    MIN_PUBLIC_DISCOVERY_BROWSE_RANK,
    Math.min(value, MAX_PUBLIC_DISCOVERY_BROWSE_RANK),
  );
}

function discoveryLead(value: Record<string, unknown>): ResearchEntityDiscoveryLead | undefined {
  const personId = canonicalId(value.personId);
  const displayName = boundedPublicText(value.displayName, MAX_PUBLIC_DISCOVERY_TEXT_LENGTH);
  if (
    !personId ||
    !displayName ||
    !roleAssignmentRoles.includes(value.role as RoleAssignmentRole)
  ) {
    return undefined;
  }
  const role = value.role as RoleAssignmentRole;
  const officialProfileUrl = canonicalProfileUrl('YALE_OFFICIAL', value.officialProfileUrl);
  return {
    personId,
    displayName,
    role,
    ...(officialProfileUrl ? { officialProfileUrl } : {}),
  };
}

/**
 * Builds the bounded ResearchEntity.discovery cache shape.
 *
 * It does not read or write MongoDB.
 * Callers must persist it only after the canonical transaction or materializer
 * inputs commit successfully.
 */
export function buildResearchEntityDiscoveryProjection(
  input: ResearchEntityDiscoveryInput,
  options: ResearchEntityDiscoveryProjectionOptions = {},
): ResearchEntityDiscoveryProjection | undefined {
  const accessState = boundedPublicText(input.accessState, MAX_PUBLIC_DISCOVERY_TEXT_LENGTH);
  const computedAt = validDate(input.computedAt, options.now ?? new Date());
  const bestNextStepCategory =
    input.bestNextStepCategory === undefined
      ? undefined
      : boundedPublicText(input.bestNextStepCategory, MAX_BEST_NEXT_STEP_CATEGORY_LENGTH);
  if (
    !accessState ||
    !computedAt ||
    !isStudentVisibilityTier(input.visibilityState) ||
    (input.bestNextStepCategory !== undefined && !bestNextStepCategory)
  ) {
    return undefined;
  }

  const leads: ResearchEntityDiscoveryLead[] = [];
  const seenPersonIds = new Set<string>();
  for (const value of Array.isArray(input.leads) ? input.leads : []) {
    const lead = discoveryLead(value);
    if (!lead || seenPersonIds.has(lead.personId)) continue;
    seenPersonIds.add(lead.personId);
    leads.push(lead);
    if (leads.length === MAX_PUBLIC_DISCOVERY_LEADS) break;
  }

  return {
    leads,
    accessState,
    ...(bestNextStepCategory === undefined ? {} : { bestNextStepCategory }),
    openOpportunityCount: boundedDiscoveryCount(input.openOpportunityCount),
    browseRankScore: boundedBrowseRank(input.browseRankScore),
    visibilityState: input.visibilityState,
    computedAt,
  };
}

export function researchEntityDiscoveryFreshness(
  discovery: Pick<ResearchEntityDiscoveryProjection, 'computedAt'> | undefined,
  now = new Date(),
): ResearchEntityDiscoveryFreshness {
  if (!discovery) return 'missing';
  const computedAt = validDate(discovery.computedAt);
  if (!computedAt) return 'missing';
  const age = now.getTime() - computedAt.getTime();
  if (age < 0) return 'future';
  return age <= RESEARCH_ENTITY_DISCOVERY_STALENESS_BOUND_MS ? 'fresh' : 'stale';
}

export function shouldRecomputeResearchEntityDiscovery(
  discovery: Pick<ResearchEntityDiscoveryProjection, 'computedAt'> | undefined,
  now = new Date(),
): boolean {
  return researchEntityDiscoveryFreshness(discovery, now) !== 'fresh';
}
