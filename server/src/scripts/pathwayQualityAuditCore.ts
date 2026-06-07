export interface PathwayQualityPathwayFact {
  id: string;
  researchEntityId: string;
  pathwayType?: string;
  status?: string;
  evidenceStrength?: string;
  derivationKey?: string;
  sourceUrls?: string[];
  sourceEvidenceIds?: string[];
}

export interface PathwayQualityRouteFact {
  id: string;
  researchEntityId: string;
  entryPathwayId?: string;
  routeType?: string;
  sourceUrl?: string;
  sourceEvidenceIds?: string[];
}

export interface PathwayQualityListingFact {
  id: string;
  researchEntityId?: string;
  hasPostedOpportunity: boolean;
}

export interface PathwayQualityEntityContext {
  researchEntityId: string;
  sourceUrlCount: number;
  leadCount: number;
  accessSignalCount: number;
  publicContactRouteCount: number;
}

export interface PathwayQualityAuditInput {
  pathways: PathwayQualityPathwayFact[];
  routes: PathwayQualityRouteFact[];
  listings: PathwayQualityListingFact[];
  entityContexts: PathwayQualityEntityContext[];
  sampleLimit?: number;
}

export interface PathwayQualityAuditResult {
  generatedAt: string;
  summary: {
    activePathways: number;
    officialApplicationRoutes: number;
    activeListings: number;
    activeListingsWithoutPostedOpportunity: number;
    routesWithoutLinkedPathway: number;
    weakPathwaysNeedingEvidence: number;
    missingSourceUrls: number;
    missingSourceEvidenceIds: number;
  };
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byEvidenceStrength: Record<string, number>;
  byDerivationPrefix: Record<string, number>;
  samples: {
    activeListingsWithoutPostedOpportunity: PathwayQualityListingFact[];
    routesWithoutLinkedPathway: PathwayQualityRouteFact[];
    weakPathwaysNeedingEvidence: Array<
      PathwayQualityPathwayFact & { missingContext: string[] }
    >;
    missingSourceUrls: PathwayQualityPathwayFact[];
    missingSourceEvidenceIds: PathwayQualityPathwayFact[];
  };
}

function increment(target: Record<string, number>, key?: string): void {
  const normalized = key && key.trim() ? key.trim() : 'UNKNOWN';
  target[normalized] = (target[normalized] || 0) + 1;
}

function derivationPrefix(value?: string): string {
  const text = value || '';
  const [prefix] = text.split(':');
  return prefix || 'UNKNOWN';
}

function nonEmpty(values?: string[]): string[] {
  return (values || []).filter((value) => typeof value === 'string' && value.trim().length > 0);
}

function contextMap(
  contexts: PathwayQualityEntityContext[],
): Map<string, PathwayQualityEntityContext> {
  return new Map(contexts.map((context) => [context.researchEntityId, context]));
}

function missingContextForWeakPathway(
  pathway: PathwayQualityPathwayFact,
  context?: PathwayQualityEntityContext,
): string[] {
  const missing: string[] = [];
  if (nonEmpty(pathway.sourceUrls).length === 0) missing.push('source_url');
  if (nonEmpty(pathway.sourceEvidenceIds).length === 0) missing.push('source_evidence');
  if (!context || context.sourceUrlCount === 0) missing.push('entity_source');
  if (!context || context.leadCount === 0) missing.push('lead_pi');
  if (!context || context.accessSignalCount === 0) missing.push('access_signal');
  if (!context || context.publicContactRouteCount === 0) missing.push('public_contact_route');
  return missing;
}

function take<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

export function buildPathwayQualityAudit(
  input: PathwayQualityAuditInput,
): PathwayQualityAuditResult {
  const sampleLimit = input.sampleLimit ?? 20;
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byEvidenceStrength: Record<string, number> = {};
  const byDerivationPrefix: Record<string, number> = {};
  const contexts = contextMap(input.entityContexts);

  for (const pathway of input.pathways) {
    increment(byType, pathway.pathwayType);
    increment(byStatus, pathway.status);
    increment(byEvidenceStrength, pathway.evidenceStrength);
    increment(byDerivationPrefix, derivationPrefix(pathway.derivationKey));
  }

  const missingSourceUrls = input.pathways.filter(
    (pathway) => nonEmpty(pathway.sourceUrls).length === 0,
  );
  const missingSourceEvidenceIds = input.pathways.filter(
    (pathway) => nonEmpty(pathway.sourceEvidenceIds).length === 0,
  );
  const officialApplicationRoutes = input.routes.filter(
    (route) => route.routeType === 'OFFICIAL_APPLICATION',
  );
  const routesWithoutLinkedPathway = officialApplicationRoutes.filter(
    (route) => !route.entryPathwayId,
  );
  const activeListingsWithoutPostedOpportunity = input.listings.filter(
    (listing) => !listing.hasPostedOpportunity,
  );
  const weakPathwaysNeedingEvidence = input.pathways
    .map((pathway) => ({
      ...pathway,
      missingContext: missingContextForWeakPathway(pathway, contexts.get(pathway.researchEntityId)),
    }))
    .filter(
      (pathway) =>
        pathway.evidenceStrength === 'WEAK' &&
        pathway.pathwayType !== 'POSTED_ROLE' &&
        pathway.missingContext.length > 0,
    );

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      activePathways: input.pathways.length,
      officialApplicationRoutes: officialApplicationRoutes.length,
      activeListings: input.listings.length,
      activeListingsWithoutPostedOpportunity: activeListingsWithoutPostedOpportunity.length,
      routesWithoutLinkedPathway: routesWithoutLinkedPathway.length,
      weakPathwaysNeedingEvidence: weakPathwaysNeedingEvidence.length,
      missingSourceUrls: missingSourceUrls.length,
      missingSourceEvidenceIds: missingSourceEvidenceIds.length,
    },
    byType,
    byStatus,
    byEvidenceStrength,
    byDerivationPrefix,
    samples: {
      activeListingsWithoutPostedOpportunity: take(activeListingsWithoutPostedOpportunity, sampleLimit),
      routesWithoutLinkedPathway: take(routesWithoutLinkedPathway, sampleLimit),
      weakPathwaysNeedingEvidence: take(weakPathwaysNeedingEvidence, sampleLimit),
      missingSourceUrls: take(missingSourceUrls, sampleLimit),
      missingSourceEvidenceIds: take(missingSourceEvidenceIds, sampleLimit),
    },
  };
}
