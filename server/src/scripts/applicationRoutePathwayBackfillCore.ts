import type mongoose from 'mongoose';
import type { ContactRouteType, EntryPathwayType } from '../models/researchAccessTypes';
import type { materializeAccessForResearchGroup } from '../scrapers/accessMaterializer';
import type { upsertAccessSignal } from '../services/accessSignalService';
import type { upsertEntryPathway } from '../services/entryPathwayService';
import { isPublicHttpUrl } from '../utils/urlSafety';

export interface ApplicationRoutePathwayBackfillOptions {
  dryRun?: boolean;
  limit?: number;
}

export interface ApplicationRoutePathwayBackfillRoute {
  _id: unknown;
  researchEntityId?: unknown;
  entryPathwayId?: unknown;
  routeType?: ContactRouteType | string;
  url?: string;
  sourceUrl?: string;
  sourceEvidenceId?: unknown;
  sourceEvidenceIds?: unknown[];
  observedAt?: Date;
  sourceName?: string;
}

export interface ApplicationRoutePathwayBackfillEntity {
  _id: unknown;
  archived?: boolean;
}

export interface ApplicationRoutePathwayBackfillDeps {
  contactRouteModel: mongoose.Model<any> | any;
  researchEntityModel: mongoose.Model<any> | any;
  materializeAccessForResearchGroup: typeof materializeAccessForResearchGroup;
  upsertEntryPathway: typeof upsertEntryPathway;
  upsertAccessSignal: typeof upsertAccessSignal;
}

export interface ApplicationRoutePathwayBackfillResult {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  rematerialized: number;
  routeBackfilled: number;
  blocked: number;
  blockerReasons: Record<string, number>;
  candidateRouteIds: string[];
  rematerializedRouteIds: string[];
  routeBackfilledRouteIds: string[];
}

const DEFAULT_BACKFILL_LIMIT = 150;

interface RouteClassification {
  pathwayType: EntryPathwayType;
  status: 'PLAUSIBLE' | 'RECURRING';
  evidenceStrength: 'MODERATE' | 'STRONG';
  studentFacingLabel: string;
  explanation: string;
  bestNextStep: string;
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function strings(values: unknown[] | undefined): string[] {
  return (values || [])
    .map((value) => stringId(value))
    .filter((value) => value.trim().length > 0);
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] || 0) + 1;
}

function normalizeBackfillLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_BACKFILL_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('--limit must be a safe positive integer');
  }
  return limit;
}

function publicHttpUrl(value?: string): URL | null {
  return isPublicHttpUrl(value) ? new URL(value.trim()) : null;
}

function isTrustedOfficialDomain(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return (
    host === 'yale.edu' ||
    host.endsWith('.yale.edu') ||
    host === 'yale-nus.edu.sg' ||
    host.endsWith('.yale-nus.edu.sg') ||
    host === 'qualtrics.com' ||
    host.endsWith('.qualtrics.com')
  );
}

function sourceEvidenceIds(route: ApplicationRoutePathwayBackfillRoute): string[] {
  return Array.from(
    new Set([
      ...strings(route.sourceEvidenceIds),
      stringId(route.sourceEvidenceId),
    ].filter(Boolean)),
  );
}

export function applicationRouteBackfillDerivationKey(
  route: ApplicationRoutePathwayBackfillRoute,
  evidenceIds = sourceEvidenceIds(route),
): string {
  const evidenceKey = evidenceIds.length > 0
    ? [...evidenceIds].sort().join('+')
    : stringId(route._id);
  return `application-route-backfill:${evidenceKey}`;
}

function routeUrl(route: ApplicationRoutePathwayBackfillRoute): URL | null {
  if (route.url !== undefined) return publicHttpUrl(route.url);
  return publicHttpUrl(route.sourceUrl);
}

function hasTrustedOfficialUrl(route: ApplicationRoutePathwayBackfillRoute): boolean {
  const url = routeUrl(route);
  const sourceUrl = route.url === undefined ? publicHttpUrl(route.sourceUrl) : null;
  return Boolean(
    (url && isTrustedOfficialDomain(url)) ||
      (sourceUrl && isTrustedOfficialDomain(sourceUrl)),
  );
}

export function classifyApplicationRoutePathway(
  route: ApplicationRoutePathwayBackfillRoute,
): RouteClassification {
  const text = `${route.url || ''} ${route.sourceUrl || ''} ${route.sourceName || ''}`.toLowerCase();
  if (text.includes('internship')) {
    return {
      pathwayType: 'CENTER_INTERNSHIP',
      status: 'RECURRING',
      evidenceStrength: 'STRONG',
      studentFacingLabel: 'Official internship route',
      explanation: 'An official source describes an internship or application route for students.',
      bestNextStep:
        'Use the official application route and check timing or eligibility on the source page.',
    };
  }
  if (text.includes('undergraduate-research') || text.includes('department-undergrad-research')) {
    return {
      pathwayType: 'RECURRING_PROGRAM',
      status: 'RECURRING',
      evidenceStrength: 'STRONG',
      studentFacingLabel: 'Department research application',
      explanation:
        'An official department page describes an undergraduate research application or matching route.',
      bestNextStep: 'Use the official application route and follow the department instructions.',
    };
  }
  return {
    pathwayType: 'VOLUNTEER_OUTREACH',
    status: 'PLAUSIBLE',
    evidenceStrength: 'MODERATE',
    studentFacingLabel: 'Official application route',
    explanation: 'An official join, opportunities, or application page was found for undergraduate access.',
    bestNextStep: 'Use the official route before trying direct outreach.',
  };
}

function routeBlockedReason(
  route: ApplicationRoutePathwayBackfillRoute,
  entity?: ApplicationRoutePathwayBackfillEntity | null,
): string | null {
  if (!route.researchEntityId) return 'missing-research-entity-id';
  if (!entity || entity.archived === true) return 'missing-active-research-entity';
  if (sourceEvidenceIds(route).length === 0) return 'missing-source-evidence';
  if (!routeUrl(route)) {
    return route.url || route.sourceUrl ? 'untrusted-application-url' : 'missing-valid-url';
  }
  if (!hasTrustedOfficialUrl(route)) return 'untrusted-application-url';
  return null;
}

async function leanQuery(query: any): Promise<any> {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

async function fetchRoutes(
  deps: ApplicationRoutePathwayBackfillDeps,
  limit: number,
): Promise<ApplicationRoutePathwayBackfillRoute[]> {
  const query = deps.contactRouteModel
    .find({
      archived: { $ne: true },
      routeType: 'OFFICIAL_APPLICATION',
      $or: [{ entryPathwayId: { $exists: false } }, { entryPathwayId: null }],
    })
    .select(
      '_id researchEntityId entryPathwayId routeType url sourceUrl sourceEvidenceId sourceEvidenceIds observedAt sourceName',
    )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit);
  return (await leanQuery(query)) as ApplicationRoutePathwayBackfillRoute[];
}

async function fetchEntity(
  deps: ApplicationRoutePathwayBackfillDeps,
  researchEntityId: unknown,
): Promise<ApplicationRoutePathwayBackfillEntity | null> {
  if (!researchEntityId) return null;
  const query = deps.researchEntityModel
    .findOne({ _id: researchEntityId, archived: { $ne: true } })
    .select('_id archived');
  return (await leanQuery(query)) as ApplicationRoutePathwayBackfillEntity | null;
}

async function refetchRoute(
  deps: ApplicationRoutePathwayBackfillDeps,
  routeId: unknown,
): Promise<ApplicationRoutePathwayBackfillRoute | null> {
  const query = deps.contactRouteModel.findById(routeId).select('_id entryPathwayId');
  return (await leanQuery(query)) as ApplicationRoutePathwayBackfillRoute | null;
}

async function routeBackfill(
  route: ApplicationRoutePathwayBackfillRoute,
  deps: ApplicationRoutePathwayBackfillDeps,
): Promise<boolean> {
  const classification = classifyApplicationRoutePathway(route);
  const evidenceIds = sourceEvidenceIds(route);
  const url = routeUrl(route);
  const sourceUrls = Array.from(new Set([route.url, route.sourceUrl].filter(Boolean) as string[]));
  const derivationKey = applicationRouteBackfillDerivationKey(route, evidenceIds);
  const pathway = await deps.upsertEntryPathway({
    researchEntityId: stringId(route.researchEntityId),
    pathwayType: classification.pathwayType,
    status: classification.status,
    evidenceStrength: classification.evidenceStrength,
    studentFacingLabel: classification.studentFacingLabel,
    explanation: classification.explanation,
    bestNextStep: classification.bestNextStep,
    compensation: 'UNKNOWN',
    sourceEvidenceIds: evidenceIds,
    sourceUrls,
    confidence: classification.evidenceStrength === 'STRONG' ? 0.8 : 0.6,
    derivationKey,
    lastObservedAt: route.observedAt,
    lastMaterializedAt: new Date(),
  });
  if (!pathway.pathwayId) return false;

  await deps.upsertAccessSignal({
    researchEntityId: stringId(route.researchEntityId),
    entryPathwayId: pathway.pathwayId,
    signalType: 'APPLICATION_FORM_EXISTS',
    confidence: classification.evidenceStrength === 'STRONG' ? 'HIGH' : 'MEDIUM',
    observedAt: route.observedAt || new Date(),
    excerpt: 'An official application, join, or opportunities route was found.',
    sourceName: route.sourceName,
    sourceUrl: route.sourceUrl || url?.toString(),
    sourceEvidenceId: evidenceIds[0],
    originalConfidence: classification.evidenceStrength === 'STRONG' ? 0.8 : 0.6,
    confidenceScore: classification.evidenceStrength === 'STRONG' ? 0.8 : 0.6,
    derivationKey: `${derivationKey}:APPLICATION_FORM_EXISTS`,
  });

  const update = await deps.contactRouteModel.updateOne(
    { _id: route._id },
    { $set: { entryPathwayId: pathway.pathwayId, lastMaterializedAt: new Date() } },
  );
  return Boolean((update as any).modifiedCount || (update as any).matchedCount);
}

export async function backfillApplicationRoutePathways(
  options: ApplicationRoutePathwayBackfillOptions,
  deps: ApplicationRoutePathwayBackfillDeps,
): Promise<ApplicationRoutePathwayBackfillResult> {
  const dryRun = options.dryRun !== false;
  const limit = normalizeBackfillLimit(options.limit);
  const routes = await fetchRoutes(deps, limit);
  const result: ApplicationRoutePathwayBackfillResult = {
    dryRun,
    scanned: routes.length,
    candidates: routes.length,
    rematerialized: 0,
    routeBackfilled: 0,
    blocked: 0,
    blockerReasons: {},
    candidateRouteIds: routes.map((route) => stringId(route._id)).slice(0, 50),
    rematerializedRouteIds: [],
    routeBackfilledRouteIds: [],
  };

  for (const route of routes) {
    const entity = await fetchEntity(deps, route.researchEntityId);
    const blockedReason = routeBlockedReason(route, entity);
    if (blockedReason) {
      result.blocked++;
      increment(result.blockerReasons, blockedReason);
      continue;
    }

    if (dryRun) continue;

    await deps.materializeAccessForResearchGroup({
      researchEntityId: stringId(route.researchEntityId),
    });
    const rematerializedRoute = await refetchRoute(deps, route._id);
    if (rematerializedRoute?.entryPathwayId) {
      result.rematerialized++;
      result.rematerializedRouteIds.push(stringId(route._id));
      continue;
    }

    if (await routeBackfill(route, deps)) {
      result.routeBackfilled++;
      result.routeBackfilledRouteIds.push(stringId(route._id));
    } else {
      result.blocked++;
      increment(result.blockerReasons, 'fallback-write-failed');
    }
  }

  return result;
}
