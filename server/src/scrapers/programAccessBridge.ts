import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import type {
  EntryPathwayStatus,
  EntryPathwayType,
  PostedOpportunityStatus,
  ResearchEntityType,
} from '../models/researchAccessTypes';
import {
  upsertAccessSignal as defaultUpsertAccessSignal,
  type UpsertAccessSignalInput,
} from '../services/accessSignalService';
import {
  upsertContactRoute as defaultUpsertContactRoute,
  type UpsertContactRouteInput,
} from '../services/contactRouteService';
import {
  upsertEntryPathway as defaultUpsertEntryPathway,
  type UpsertEntryPathwayInput,
} from '../services/entryPathwayService';
import { findReviewLockedRecord, omitReviewLockedFields } from '../services/reviewLockUtils';
import { slugify } from './utils/scraperHelpers';

export type ProgramAccessRole =
  | 'FUNDING_ONLY'
  | 'STRUCTURED_ENTRY'
  | 'HOSTED_INTERNSHIP'
  | 'MENTOR_MATCHING'
  | 'UNKNOWN';

type FellowshipLike = {
  _id?: unknown;
  id?: unknown;
  title?: string;
  summary?: string;
  description?: string;
  sourceUrl?: string;
  applicationLink?: string;
  deadline?: Date | string;
  isAcceptingApplications?: boolean;
  programAccessRole?: ProgramAccessRole;
  programCategory?: string;
  hostedByResearchEntityName?: string;
  hostedByResearchEntityUrl?: string;
  updatedAt?: Date | string;
  createdAt?: Date | string;
};

export type ProgramAccessBridgeSkipped =
  | 'funding-only'
  | 'missing-host'
  | 'unsupported-role'
  | 'missing-fellowship-id'
  | 'missing-entry-pathway-id';

export interface ProgramAccessBridgeInputs {
  researchEntity: {
    slug: string;
    name: string;
    displayName: string;
    entityType: ResearchEntityType;
    kind: string;
    websiteUrl?: string;
  };
  entryPathway: Omit<UpsertEntryPathwayInput, 'researchEntityId'>;
  accessSignal?: Omit<UpsertAccessSignalInput, 'researchEntityId' | 'entryPathwayId'>;
  contactRoute?: Omit<UpsertContactRouteInput, 'researchEntityId' | 'entryPathwayId'>;
  postedOpportunity?: {
    title: string;
    deadline?: Date;
    applicationUrl?: string;
    status: PostedOpportunityStatus;
    compensationType: 'FELLOWSHIP';
    sourceUrls: string[];
    derivationKey: string;
    archived: boolean;
  };
}

export type ProgramAccessBridgeBuildResult =
  | ProgramAccessBridgeInputs
  | { skipped: ProgramAccessBridgeSkipped };

export interface ProgramAccessBridgeMaterializeResult {
  skipped?: ProgramAccessBridgeSkipped;
  researchEntities: number;
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  postedOpportunities: number;
}

export interface ProgramAccessBridgeDeps {
  researchEntityModel?: Pick<typeof ResearchEntity, 'findOneAndUpdate'>;
  upsertEntryPathway?: typeof defaultUpsertEntryPathway;
  upsertAccessSignal?: typeof defaultUpsertAccessSignal;
  upsertContactRoute?: typeof defaultUpsertContactRoute;
  postedOpportunityModel?: Pick<typeof PostedOpportunity, 'findOne' | 'updateOne'>;
}

export interface ProgramAccessBridgeOptions {
  dryRun?: boolean;
  now?: Date;
}

const STRUCTURED_PROGRAM_ACCESS_ROLES = new Set<ProgramAccessRole>([
  'STRUCTURED_ENTRY',
  'HOSTED_INTERNSHIP',
  'MENTOR_MATCHING',
]);

export function isStructuredProgramAccessRole(role: unknown): role is ProgramAccessRole {
  return STRUCTURED_PROGRAM_ACCESS_ROLES.has(role as ProgramAccessRole);
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Partial<T>;
}

function idToString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'toString' in value) return String(value);
  return undefined;
}

function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function sourceUrlsFor(fellowship: FellowshipLike): string[] {
  return Array.from(
    new Set(
      [fellowship.applicationLink, fellowship.sourceUrl, fellowship.hostedByResearchEntityUrl]
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter(Boolean),
    ),
  );
}

function inferResearchEntityType(name: string, url?: string): ResearchEntityType {
  const text = `${name} ${url || ''}`.toLowerCase();
  if (text.includes('institute')) return 'INSTITUTE';
  if (text.includes('museum') || text.includes('library') || text.includes('archive')) {
    return 'ARCHIVE_OR_MUSEUM_PROJECT';
  }
  if (text.includes('digital humanities')) return 'ARCHIVE_OR_MUSEUM_PROJECT';
  if (text.includes('center') || text.includes('centre') || text.includes('lab')) return 'CENTER';
  return 'PROGRAM';
}

function kindForEntityType(entityType: ResearchEntityType): string {
  if (entityType === 'INSTITUTE') return 'institute';
  if (entityType === 'CENTER' || entityType === 'ARCHIVE_OR_MUSEUM_PROJECT') return 'center';
  return 'program';
}

function pathwayTypeForRole(role: ProgramAccessRole): EntryPathwayType {
  if (role === 'HOSTED_INTERNSHIP') return 'CENTER_INTERNSHIP';
  return 'RECURRING_PROGRAM';
}

function postedOpportunityStatusFor(fellowship: FellowshipLike, now = new Date()): PostedOpportunityStatus {
  if (fellowship.isAcceptingApplications === true) return 'OPEN';
  const deadline = toDate(fellowship.deadline);
  if (deadline && deadline.getTime() >= now.getTime()) return 'OPEN';
  if (fellowship.isAcceptingApplications === false && deadline && deadline.getTime() < now.getTime()) {
    return 'CLOSED';
  }
  return 'ROLLING';
}

function shouldBuildPostedOpportunity(fellowship: FellowshipLike, status: PostedOpportunityStatus): boolean {
  if (!fellowship.applicationLink) return false;
  return status === 'OPEN' || status === 'ROLLING';
}

export function buildProgramAccessBridgeInputs(
  fellowship: FellowshipLike,
  options: ProgramAccessBridgeOptions = {},
): ProgramAccessBridgeBuildResult {
  const role = fellowship.programAccessRole;
  if (role === 'FUNDING_ONLY') return { skipped: 'funding-only' };
  if (!isStructuredProgramAccessRole(role)) return { skipped: 'unsupported-role' };

  const hostName = fellowship.hostedByResearchEntityName?.trim();
  if (!hostName) return { skipped: 'missing-host' };

  const fellowshipId = idToString(fellowship._id || fellowship.id);
  if (!fellowshipId) return { skipped: 'missing-fellowship-id' };

  const hostUrl = fellowship.hostedByResearchEntityUrl?.trim();
  const entityType = inferResearchEntityType(hostName, hostUrl);
  const entitySlug = slugify(hostName);
  const observedAt =
    toDate(fellowship.updatedAt) || toDate(fellowship.createdAt) || options.now || new Date();
  const sourceUrls = sourceUrlsFor(fellowship);
  const sourceUrl = fellowship.applicationLink || fellowship.sourceUrl || hostUrl;
  const hasApplicationLink = !!fellowship.applicationLink;
  const pathwayType = pathwayTypeForRole(role);
  const status: EntryPathwayStatus = 'ACTIVE';
  const opportunityStatus = postedOpportunityStatusFor(fellowship, options.now);

  return {
    researchEntity: compactObject({
      slug: entitySlug,
      name: hostName,
      displayName: hostName,
      entityType,
      kind: kindForEntityType(entityType),
      websiteUrl: hostUrl,
    }) as ProgramAccessBridgeInputs['researchEntity'],
    entryPathway: {
      pathwayType,
      status,
      evidenceStrength: 'DIRECT',
      studentFacingLabel: 'Structured research program',
      explanation: `${fellowship.title || 'This program'} is a source-backed structured research entry program hosted by ${hostName}.`,
      bestNextStep: fellowship.applicationLink
        ? 'Apply through the official program application.'
        : 'Review the official program page for application instructions.',
      compensation: 'FELLOWSHIP',
      sourceEvidenceIds: [],
      sourceUrls,
      confidence: 1,
      derivationKey: `program:${fellowshipId}:pathway`,
      archived: false,
      lastObservedAt: observedAt,
    },
    accessSignal: {
      signalType: hasApplicationLink ? 'APPLICATION_FORM_EXISTS' : 'RECURRING_PROGRAM',
      confidence: 'HIGH',
      observedAt,
      excerpt: fellowship.summary || fellowship.description || fellowship.title,
      sourceName: 'program-access-bridge',
      sourceUrl,
      originalConfidence: 1,
      confidenceScore: 1,
      derivationKey: hasApplicationLink
        ? `program:${fellowshipId}:signal:application`
        : `program:${fellowshipId}:signal:recurring-program`,
      archived: false,
    },
    contactRoute: hasApplicationLink
      ? {
          routeType: 'OFFICIAL_APPLICATION',
          priority: 1,
          visibility: 'PUBLIC',
          contactPolicy: 'APPLICATION_ONLY',
          url: fellowship.applicationLink,
          rationale: 'The source identifies an official program application route.',
          sourceEvidenceIds: [],
          observedAt,
          sourceName: 'program-access-bridge',
          sourceUrl,
          derivationKey: `program:${fellowshipId}:route:official-application`,
        }
      : undefined,
    postedOpportunity: shouldBuildPostedOpportunity(fellowship, opportunityStatus)
      ? {
          title: fellowship.title || 'Structured research program',
          deadline: toDate(fellowship.deadline),
          applicationUrl: fellowship.applicationLink,
          status: opportunityStatus,
          compensationType: 'FELLOWSHIP',
          sourceUrls,
          derivationKey: `program:${fellowshipId}:opportunity`,
          archived: false,
        }
      : undefined,
  };
}

function pathwayIdFrom(result: Awaited<ReturnType<typeof defaultUpsertEntryPathway>>): string | undefined {
  return result.pathwayId || idToString(result.doc?._id) || idToString((result as any)._id);
}

export async function materializeProgramAccessBridge(
  fellowship: FellowshipLike,
  deps: ProgramAccessBridgeDeps = {},
  options: ProgramAccessBridgeOptions = {},
): Promise<ProgramAccessBridgeMaterializeResult> {
  const inputs = buildProgramAccessBridgeInputs(fellowship, options);
  if ('skipped' in inputs) {
    return {
      skipped: inputs.skipped,
      researchEntities: 0,
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
    };
  }

  if (options.dryRun) {
    return {
      skipped: undefined,
      researchEntities: 1,
      entryPathways: 1,
      accessSignals: inputs.accessSignal ? 1 : 0,
      contactRoutes: inputs.contactRoute ? 1 : 0,
      postedOpportunities: inputs.postedOpportunity ? 1 : 0,
    };
  }

  const researchEntityModel = deps.researchEntityModel || ResearchEntity;
  const upsertEntryPathway = deps.upsertEntryPathway || defaultUpsertEntryPathway;
  const upsertAccessSignal = deps.upsertAccessSignal || defaultUpsertAccessSignal;
  const upsertContactRoute = deps.upsertContactRoute || defaultUpsertContactRoute;
  const postedOpportunityModel = deps.postedOpportunityModel || PostedOpportunity;

  const researchEntity = await researchEntityModel.findOneAndUpdate(
    { slug: inputs.researchEntity.slug },
    {
      $setOnInsert: compactObject({
        slug: inputs.researchEntity.slug,
        name: inputs.researchEntity.name,
        displayName: inputs.researchEntity.displayName,
        entityType: inputs.researchEntity.entityType,
        kind: inputs.researchEntity.kind,
        websiteUrl: inputs.researchEntity.websiteUrl,
        website: inputs.researchEntity.websiteUrl,
      }),
      $set: {
        lastObservedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const researchEntityId = idToString((researchEntity as any)?._id);

  if (!researchEntityId) {
    return {
      skipped: 'missing-host',
      researchEntities: 0,
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
    };
  }

  const pathway = await upsertEntryPathway({
    researchEntityId,
    ...inputs.entryPathway,
  });
  const entryPathwayId = pathwayIdFrom(pathway);
  if (!entryPathwayId) {
    return {
      skipped: 'missing-entry-pathway-id',
      researchEntities: 1,
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      postedOpportunities: 0,
    };
  }

  if (inputs.accessSignal) {
    await upsertAccessSignal({
      researchEntityId,
      entryPathwayId,
      ...inputs.accessSignal,
    });
  }
  if (inputs.contactRoute) {
    await upsertContactRoute({
      researchEntityId,
      entryPathwayId,
      ...inputs.contactRoute,
    });
  }

  let postedOpportunities = 0;
  if (inputs.postedOpportunity) {
    const postedOpportunityFilter = {
      entryPathwayId,
      derivationKey: inputs.postedOpportunity.derivationKey,
    };
    const existingPostedOpportunity = await findReviewLockedRecord(
      postedOpportunityModel as any,
      postedOpportunityFilter,
    );
    await postedOpportunityModel.updateOne(
      postedOpportunityFilter,
      {
        $setOnInsert: compactObject({
          entryPathwayId,
          researchEntityId,
          title: inputs.postedOpportunity.title,
          compensationType: inputs.postedOpportunity.compensationType,
          derivationKey: inputs.postedOpportunity.derivationKey,
        }),
        $set: omitReviewLockedFields(
          compactObject({
            status: inputs.postedOpportunity.status,
            deadline: inputs.postedOpportunity.deadline,
            applicationUrl: inputs.postedOpportunity.applicationUrl,
            archived: inputs.postedOpportunity.archived,
          }),
          existingPostedOpportunity,
        ),
        $addToSet: {
          sourceUrls: { $each: inputs.postedOpportunity.sourceUrls },
        },
      },
      { upsert: true },
    );
    postedOpportunities = 1;
  }

  return {
    skipped: undefined,
    researchEntities: 1,
    entryPathways: 1,
    accessSignals: inputs.accessSignal ? 1 : 0,
    contactRoutes: inputs.contactRoute ? 1 : 0,
    postedOpportunities,
  };
}
