import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import type { Collection, Document, Filter } from 'mongodb';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { pruneSupersededObservations } from '../scrapers/observationRetention';
import {
  buildSourceHealthReviewSummary,
  resolveSourceHealthRowsWithReviewArtifacts,
} from './sourceHealth';
import { buildSourceHealthRows, type SourceHealthRow } from '../services/sourceHealthService';
import { serializedDocumentId } from '../utils/idSerialization';
import {
  buildArrayRefOrphanSamplePipeline,
  buildBetaDataQualityDiagnostics,
  buildBetaDataQualityOutput,
  buildBetaDataQualityRecommendedCommands,
  buildBetaDataQualityRetentionOptions,
  buildBetaDataQualitySummary,
  buildDuplicateEntityPlanReviewSummary,
  buildDuplicateEntityReviewSummary,
  buildMissingRequiredRefSamplePipeline,
  buildReferenceIntegritySummary,
  buildResearchEntityContentPageLeakSummary,
  buildSamePiDedupeReviewSummary,
  buildScalarRefOrphanSamplePipeline,
  buildSuspiciousUserEmailScorecardSummary,
  classifyDuplicateEntityCluster,
  formatBetaDataQualityProgressEvent,
  isInvalidObservationSourceUrl,
  isInvalidOptionalEmail,
  isInvalidOptionalUrl,
  parseBetaDataQualityArgs,
  selectLiveLinkCandidates,
  shouldStrictModeFail,
  writeScorecardOutput,
  type BetaDataQualityOptions,
  type BetaDataQualityScorecard,
  type LinkCandidateInput,
  type ReferenceAuditInput,
  type ReferenceAuditSample,
  type SuspiciousUserEmailScorecardSummary,
} from './betaDataQualityCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../utils/ssrfGuard';
import {
  getSuspiciousUserEmailReason,
  isExcludedByLaneAProductionCopy,
  isSuspiciousUserEmail,
} from './userEmailHygieneCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ACTIVE_FILTER: Filter<Document> = { archived: { $ne: true } };
const OPEN_OPPORTUNITY_STATUSES = ['OPEN', 'ROLLING'];
interface FieldIssueSample {
  collection: string;
  field: string;
  id: string;
  value: unknown;
}

interface FieldIssueSummary {
  invalidTotal: number;
  byField: Array<{
    collection: string;
    field: string;
    invalidCount: number;
  }>;
  samples?: FieldIssueSample[];
}

interface StudentAnalyticsContaminationSummary {
  count: number;
  distinctNetids: number;
  samples?: Array<{
    netid: string;
    userType?: string;
    eventType?: string;
    count: number;
    firstEventAt?: Date;
    lastEventAt?: Date;
  }>;
}

interface DuplicateEntityCluster {
  normalizedName: string;
  count: number;
  reviewCategory?: ReturnType<typeof classifyDuplicateEntityCluster>;
  entities: Array<{
    id: string;
    name: string;
    slug?: string;
    kind?: string;
    entityType?: string;
    school?: string;
    schools?: string[];
    departments?: string[];
    researchAreas?: string[];
    website?: string;
    websiteUrl?: string;
    sourceUrls?: string[];
    contactName?: string;
    contactEmail?: string;
  }>;
}

interface LiveLinkCheckResult {
  enabled: boolean;
  sampleSize: number;
  checked: number;
  ok: number;
  failed: number;
  skipped: number;
  failures: Array<{
    url: string;
    sources: string[];
    status?: number;
    error?: string;
  }>;
}

async function main(): Promise<void> {
  const options = parseBetaDataQualityArgs(process.argv.slice(2));
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    throw new Error('MONGODBURL is required for beta:data-quality');
  }
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'beta:data-quality',
    mongoUrl,
  });

  await mongoose.connect(mongoUrl);
  const scorecard = await buildBetaDataQualityScorecard(options, mongoUrl);
  const output = buildBetaDataQualityOutput(scorecard, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  writeScorecardOutput(output, options.output);
  console.log(JSON.stringify(output, null, 2));

  if (options.strict && shouldStrictModeFail(scorecard.summary)) {
    process.exitCode = 1;
  }
}

export async function buildBetaDataQualityScorecard(
  options: BetaDataQualityOptions,
  mongoUrl: string = process.env.MONGODBURL || '',
): Promise<BetaDataQualityScorecard> {
  const generatedAt = new Date();
  const phaseDurationsMs: Record<string, number> = {};
  const reportProgress = options.progress
    ? (event: Parameters<typeof formatBetaDataQualityProgressEvent>[0]) => {
        console.error(formatBetaDataQualityProgressEvent(event));
      }
    : undefined;
  const timed = async <T>(phaseName: string, fn: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    reportProgress?.({ phase: phaseName, status: 'started' });
    try {
      return await fn();
    } finally {
      const durationMs = Date.now() - startedAt;
      phaseDurationsMs[phaseName] = durationMs;
      reportProgress?.({ phase: phaseName, status: 'finished', durationMs });
    }
  };
  const [
    counts,
    referenceIntegrity,
    urlHygiene,
    emailHygiene,
    opportunityState,
    paperAuthorship,
    sourceHealth,
    coverage,
    descriptionQuality,
    duplicateEntityNames,
    researchEntityContentPageLeaks,
    studentAnalyticsContamination,
    retention,
    liveLinks,
  ] = await Promise.all([
    timed('collectionCounts', () => buildCollectionCounts()),
    timed('referenceIntegrity', () => buildReferenceIntegrity(options.includeSamples)),
    timed('urlHygiene', () => buildUrlHygiene(options.includeSamples)),
    timed('emailHygiene', () => buildEmailHygiene(options.includeSamples)),
    timed('opportunityState', () => buildOpportunityState(options.includeSamples, generatedAt)),
    timed('paperAuthorship', () => buildPaperAuthorshipSummary(options.includeSamples)),
    timed('sourceHealth', () => buildSourceHealthSummary(options.days, options.includeSamples)),
    timed('researchEntityCoverage', () => buildResearchEntityCoverage()),
    timed('descriptionQuality', () => buildDescriptionQuality(options.includeSamples)),
    timed('duplicateEntityNames', () => buildDuplicateEntityNames(options.includeSamples)),
    timed('researchEntityContentPageLeaks', () => buildResearchEntityContentPageLeaks()),
    timed('studentAnalyticsContamination', () =>
      buildStudentAnalyticsContamination(options.includeSamples),
    ),
    timed('scraperRetention', () =>
      pruneSupersededObservations(buildBetaDataQualityRetentionOptions()),
    ),
    timed('liveLinks', () => buildLiveLinkCheck(options)),
  ]);

  const summary = buildBetaDataQualitySummary({
    referenceHardFailures: referenceIntegrity.hardFailureTotal,
    invalidUrlCount: urlHygiene.invalidTotal,
    invalidEmailCount: emailHygiene.invalidTotal,
    expiredOpenOpportunityCount: opportunityState.expiredOpenCount,
    paperAuthorshipIntegrityFailures: paperAuthorship.integrityFailureTotal,
    sourceHealthErrors: sourceHealth.riskCounts.error,
    sourceHealthWarnings: sourceHealth.riskCounts.warn,
    duplicateEntityClusterCount: duplicateEntityNames.clusterCount,
    researchEntityContentPageLeakCount: researchEntityContentPageLeaks.count,
    missingShortDescriptionCount: descriptionQuality.missingCount,
    weakShortDescriptionCount: descriptionQuality.weakCount,
    suspiciousUserEmailCount: emailHygiene.suspiciousUserEmails.count,
    suspiciousUserEmailsProductionCopyExclusionComplete:
      options.includeSamples &&
      emailHygiene.suspiciousUserEmails.productionCopyExclusion.sampledCoverageComplete &&
      emailHygiene.suspiciousUserEmails.productionCopyExclusion.sampledNeedsReviewBeforeCopy === 0,
    betaStudentAnalyticsEventCount: studentAnalyticsContamination.count,
    retentionCandidateCount: retention.candidates,
    liveLinkFailureCount: liveLinks.failed,
    coverageGaps: {
      withoutPathways: coverage.withoutPathways,
      withoutAccessSignals: coverage.withoutAccessSignals,
      withoutContactRoutes: coverage.withoutContactRoutes,
    },
  });

  return {
    generatedAt: generatedAt.toISOString(),
    mongoTarget: describeMongoTarget(mongoUrl),
    options,
    diagnostics: buildBetaDataQualityDiagnostics(phaseDurationsMs),
    summary,
    counts,
    referenceIntegrity,
    hygiene: {
      urls: urlHygiene,
      emails: emailHygiene,
      betaStudentAnalyticsEvents: studentAnalyticsContamination,
    },
    opportunityState,
    paperAuthorship,
    sourceHealth,
    researchEntityCoverage: coverage,
    descriptionQuality,
    duplicateEntityNames,
    samePiDedupeReview: buildSamePiDedupeReviewSummary(),
    researchEntityContentPageLeaks,
    scraperRetention: retention,
    liveLinks,
    recommendedCommands: buildBetaDataQualityRecommendedCommands(),
  };
}

async function buildCollectionCounts(): Promise<Record<string, number>> {
  const collectionNames = [
    'users',
    'listings',
    'research_entities',
    'entry_pathways',
    'access_signals',
    'contact_routes',
    'posted_opportunities',
    'papers',
    'paper_authors',
    'observations',
    'scrape_runs',
    'sources',
  ];
  const counts = await Promise.all(
    collectionNames.map(async (name) => [name, await collection(name).countDocuments({})] as const),
  );
  return Object.fromEntries(counts);
}

async function buildReferenceIntegrity(
  includeSamples: boolean,
): Promise<ReturnType<typeof buildReferenceIntegritySummary>> {
  const audits: Array<Promise<ReferenceAuditInput>> = [
    referenceAudit('observations.sourceId', 'observations', 'sourceId', 'sources', true, false, includeSamples),
    referenceAudit('scrape_runs.sourceId', 'scrape_runs', 'sourceId', 'sources', true, false, includeSamples),
    referenceAudit('research_entities.canonicalGroupId', 'research_entities', 'canonicalGroupId', 'research_entities', false, false, includeSamples),
    referenceAudit('research_entities.primaryDepartmentId', 'research_entities', 'primaryDepartmentId', 'departments', false, false, includeSamples),
    referenceAudit('research_entities.departmentIds', 'research_entities', 'departmentIds', 'departments', false, true, includeSamples),
    referenceAudit('research_entities.researchAreaIds', 'research_entities', 'researchAreaIds', 'research_areas', false, true, includeSamples),
    referenceAudit('research_entities.featuredPaperIds', 'research_entities', 'featuredPaperIds', 'papers', false, true, includeSamples),
    referenceAudit('research_entities.claimedByUserId', 'research_entities', 'claimedByUserId', 'users', false, false, includeSamples),
    referenceAudit(
      'research_entities.studentVisibilityReviewedByUserId',
      'research_entities',
      'studentVisibilityReviewedByUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit(
      'fellowships.studentVisibilityReviewedByUserId',
      'fellowships',
      'studentVisibilityReviewedByUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit('entry_pathways.researchEntityId', 'entry_pathways', 'researchEntityId', 'research_entities', true, false, includeSamples),
    referenceAudit('entry_pathways.sourceEvidenceIds', 'entry_pathways', 'sourceEvidenceIds', 'observations', false, true, includeSamples),
    referenceAudit(
      'entry_pathways.review.reviewedByUserId',
      'entry_pathways',
      'review.reviewedByUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit('access_signals.researchEntityId', 'access_signals', 'researchEntityId', 'research_entities', true, false, includeSamples),
    referenceAudit('access_signals.entryPathwayId', 'access_signals', 'entryPathwayId', 'entry_pathways', false, false, includeSamples),
    referenceAudit('access_signals.sourceEvidenceId', 'access_signals', 'sourceEvidenceId', 'observations', false, false, includeSamples),
    referenceAudit('access_signals.observationId', 'access_signals', 'observationId', 'observations', false, false, includeSamples),
    referenceAudit(
      'access_signals.review.reviewedByUserId',
      'access_signals',
      'review.reviewedByUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit('contact_routes.researchEntityId', 'contact_routes', 'researchEntityId', 'research_entities', true, false, includeSamples),
    referenceAudit('contact_routes.entryPathwayId', 'contact_routes', 'entryPathwayId', 'entry_pathways', false, false, includeSamples),
    referenceAudit('contact_routes.personId', 'contact_routes', 'personId', 'users', false, false, includeSamples),
    referenceAudit(
      'contact_routes.review.reviewedByUserId',
      'contact_routes',
      'review.reviewedByUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit('contact_routes.sourceEvidenceId', 'contact_routes', 'sourceEvidenceId', 'observations', false, false, includeSamples),
    referenceAudit('contact_routes.sourceEvidenceIds', 'contact_routes', 'sourceEvidenceIds', 'observations', false, true, includeSamples),
    referenceAudit('posted_opportunities.entryPathwayId', 'posted_opportunities', 'entryPathwayId', 'entry_pathways', true, false, includeSamples),
    referenceAudit('posted_opportunities.researchEntityId', 'posted_opportunities', 'researchEntityId', 'research_entities', false, false, includeSamples),
    referenceAudit('posted_opportunities.listingId', 'posted_opportunities', 'listingId', 'listings', false, false, includeSamples),
    referenceAudit(
      'posted_opportunities.review.reviewedByUserId',
      'posted_opportunities',
      'review.reviewedByUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit('posted_opportunities.sourceEvidenceIds', 'posted_opportunities', 'sourceEvidenceIds', 'observations', false, true, includeSamples),
    referenceAudit(
      'research_entity_members.userId',
      'research_entity_members',
      'userId',
      'users',
      false,
      false,
      includeSamples,
      ACTIVE_FILTER,
    ),
    referenceAudit(
      'research_scholarly_links.userId',
      'research_scholarly_links',
      'userId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit(
      'research_scholarly_attributions.targetUserId',
      'research_scholarly_attributions',
      'targetUserId',
      'users',
      false,
      false,
      includeSamples,
    ),
    referenceAudit('paper_authors.paperId', 'paper_authors', 'paperId', 'papers', true, false, includeSamples),
    referenceAudit('paper_authors.userId', 'paper_authors', 'userId', 'users', false, false, includeSamples),
    referenceAudit('paper_authors.facultyMemberId', 'paper_authors', 'facultyMemberId', 'faculty_members', false, false, includeSamples),
    referenceAudit('papers.yaleAuthorIds', 'papers', 'yaleAuthorIds', 'users', false, true, includeSamples),
    referenceAudit('papers.facultyMemberIds', 'papers', 'facultyMemberIds', 'faculty_members', false, true, includeSamples),
    referenceAudit('papers.researchEntityIds', 'papers', 'researchEntityIds', 'research_entities', false, true, includeSamples),
    referenceAudit('listings.researchEntityId', 'listings', 'researchEntityId', 'research_entities', false, false, includeSamples),
    referenceAudit('listings.createdByUserId', 'listings', 'createdByUserId', 'users', false, false, includeSamples),
  ];

  return buildReferenceIntegritySummary(await Promise.all(audits));
}

async function referenceAudit(
  name: string,
  collectionName: string,
  localField: string,
  targetCollectionName: string,
  required: boolean,
  isArray = false,
  includeSamples = false,
  ownerFilter: Filter<Document> = {},
): Promise<ReferenceAuditInput> {
  const missingRequired = required
    ? await collection(collectionName).countDocuments({
        ...ownerFilter,
        $or: [{ [localField]: { $exists: false } }, { [localField]: null }],
      })
    : 0;
  const orphanedPresentRefs = isArray
    ? await countArrayRefOrphans(collectionName, localField, targetCollectionName, ownerFilter)
    : await countScalarRefOrphans(collectionName, localField, targetCollectionName, ownerFilter);
  return {
    name,
    required,
    missingRequired,
    orphanedPresentRefs,
    ...(includeSamples
      ? {
          samples: await buildReferenceAuditSamples({
            collectionName,
            localField,
            targetCollectionName,
            required,
            isArray,
            ownerFilter,
          }),
        }
      : {}),
  };
}

async function buildReferenceAuditSamples(input: {
  collectionName: string;
  localField: string;
  targetCollectionName: string;
  required: boolean;
  isArray: boolean;
  ownerFilter: Filter<Document>;
}): Promise<ReferenceAuditSample[]> {
  const sampleLimit = 10;
  const samples: ReferenceAuditSample[] = [];

  if (input.required) {
    const missingRows = await collection(input.collectionName)
      .aggregate<{ id?: unknown; value?: unknown }>(
        buildMissingRequiredRefSamplePipeline(input.localField, sampleLimit, input.ownerFilter),
      )
      .toArray();
    samples.push(
      ...missingRows.map((row) =>
        buildReferenceAuditSample(input.collectionName, input.localField, row, 'missing_required'),
      ),
    );
  }

  const remainingLimit = sampleLimit - samples.length;
  if (remainingLimit <= 0) {
    return samples;
  }

  const orphanPipeline = input.isArray
    ? buildArrayRefOrphanSamplePipeline(
        input.localField,
        input.targetCollectionName,
        remainingLimit,
        input.ownerFilter,
      )
    : buildScalarRefOrphanSamplePipeline(
        input.localField,
        input.targetCollectionName,
        remainingLimit,
        input.ownerFilter,
      );
  const orphanRows = await collection(input.collectionName)
    .aggregate<{ id?: unknown; value?: unknown }>(orphanPipeline)
    .toArray();

  samples.push(
    ...orphanRows.map((row) =>
      buildReferenceAuditSample(
        input.collectionName,
        input.localField,
        row,
        'orphaned_present_ref',
      ),
    ),
  );

  return samples;
}

function buildReferenceAuditSample(
  collectionName: string,
  localField: string,
  row: { id?: unknown; value?: unknown },
  failureType: ReferenceAuditSample['failureType'],
): ReferenceAuditSample {
  return {
    collection: collectionName,
    field: localField,
    id: stringifyId(row.id),
    failureType,
    value: stringifyId(row.value),
  };
}

async function countScalarRefOrphans(
  collectionName: string,
  localField: string,
  targetCollectionName: string,
  ownerFilter: Filter<Document> = {},
): Promise<number> {
  return countFromAggregate(collectionName, [
    { $match: { ...ownerFilter, [localField]: { $exists: true, $nin: [null, ''] } } },
    {
      $lookup: {
        from: targetCollectionName,
        localField,
        foreignField: '_id',
        as: '_refTarget',
      },
    },
    { $match: { _refTarget: { $size: 0 } } },
    { $count: 'count' },
  ]);
}

async function countArrayRefOrphans(
  collectionName: string,
  localField: string,
  targetCollectionName: string,
  ownerFilter: Filter<Document> = {},
): Promise<number> {
  const pipeline: Document[] = [
    { $project: { ref: { $ifNull: [`$${localField}`, []] } } },
    { $unwind: '$ref' },
    { $match: { ref: { $ne: null } } },
    {
      $lookup: {
        from: targetCollectionName,
        localField: 'ref',
        foreignField: '_id',
        as: '_refTarget',
      },
    },
    { $match: { _refTarget: { $size: 0 } } },
    { $count: 'count' },
  ];
  return countFromAggregate(
    collectionName,
    Object.keys(ownerFilter).length > 0 ? [{ $match: ownerFilter }, ...pipeline] : pipeline,
  );
}

async function buildUrlHygiene(includeSamples: boolean): Promise<FieldIssueSummary> {
  return scanStringFields({
    specs: [
      { collection: 'research_entities', scalarFields: ['website', 'websiteUrl'], arrayFields: ['sourceUrls'] },
      { collection: 'users', scalarFields: ['website', 'imageUrl'], arrayFields: ['scholarCandidateProfileUrls'] },
      { collection: 'listings', scalarFields: [], arrayFields: ['websites'] },
      { collection: 'entry_pathways', scalarFields: [], arrayFields: ['sourceUrls'] },
      { collection: 'access_signals', scalarFields: ['sourceUrl'], arrayFields: [] },
      { collection: 'contact_routes', scalarFields: ['url', 'sourceUrl'], arrayFields: [] },
      { collection: 'posted_opportunities', scalarFields: ['applicationUrl'], arrayFields: ['sourceUrls'] },
      {
        collection: 'papers',
        scalarFields: ['url', 'openAccessUrl', 'landingPageUrl', 'pdfUrl'],
        arrayFields: [],
      },
      { collection: 'observations', scalarFields: ['sourceUrl'], arrayFields: [] },
    ],
    validator: (value, context) =>
      context.collection === 'observations' && context.field === 'sourceUrl'
        ? isInvalidObservationSourceUrl(value)
        : isInvalidOptionalUrl(value),
    includeSamples,
  });
}

async function buildEmailHygiene(includeSamples: boolean): Promise<
  FieldIssueSummary & {
    suspiciousUserEmails: SuspiciousUserEmailScorecardSummary;
  }
> {
  const emailSyntax = await scanStringFields({
    specs: [
      { collection: 'users', scalarFields: ['email'], arrayFields: [] },
      { collection: 'listings', scalarFields: ['ownerEmail'], arrayFields: ['emails'] },
      { collection: 'contact_routes', scalarFields: ['email'], arrayFields: [] },
      { collection: 'research_entities', scalarFields: ['contactEmail'], arrayFields: [] },
    ],
    validator: isInvalidOptionalEmail,
    includeSamples,
  });

  const suspiciousSamples: Array<{
    id: string;
    netid?: string;
    name: string;
    email: string;
    reason: string;
    productionCopyExcludedByDefault: boolean;
  }> = [];
  let suspiciousCount = 0;
  const cursor = collection('users')
    .find({ email: { $exists: true, $ne: '' } })
    .project({ email: 1, netid: 1, fname: 1, lname: 1 });
  for await (const row of cursor) {
    const email = asString(row.email).trim();
    if (!email || !isSuspiciousUserEmail(email)) {
      continue;
    }
    suspiciousCount += 1;
    if (includeSamples && suspiciousSamples.length < 25) {
      const netid = asString(row.netid) || undefined;
      suspiciousSamples.push({
        id: stringifyId(row._id),
        netid,
        name: [asString(row.fname), asString(row.lname)].filter(Boolean).join(' '),
        email,
        reason: getSuspiciousUserEmailReason(email) || 'placeholder-or-synthetic-pattern',
        productionCopyExcludedByDefault: isExcludedByLaneAProductionCopy({
          id: stringifyId(row._id),
          netid,
          fname: asString(row.fname),
          lname: asString(row.lname),
          email,
        }),
      });
    }
  }

  return {
    ...emailSyntax,
    suspiciousUserEmails: buildSuspiciousUserEmailScorecardSummary({
      count: suspiciousCount,
      includeSamples,
      samples: suspiciousSamples,
    }),
  };
}

async function buildStudentAnalyticsContamination(
  includeSamples: boolean,
): Promise<StudentAnalyticsContaminationSummary> {
  const filter: Filter<Document> = {
    userType: { $in: ['student', 'undergraduate', 'graduate'] },
    netid: { $nin: ['devadmin', 'test123'], $not: /^(dev|test)/i },
  };
  const events = collection('analytics_events');
  const [count, netids, samples] = await Promise.all([
    events.countDocuments(filter),
    events.distinct('netid', filter),
    includeSamples
      ? events
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: {
                  netid: '$netid',
                  userType: '$userType',
                  eventType: '$eventType',
                },
                count: { $sum: 1 },
                firstEventAt: { $min: '$timestamp' },
                lastEventAt: { $max: '$timestamp' },
              },
            },
            { $sort: { count: -1, '_id.netid': 1, '_id.eventType': 1 } },
            { $limit: 25 },
          ])
          .toArray()
      : Promise.resolve([]),
  ]);

  return {
    count,
    distinctNetids: netids.length,
    ...(includeSamples
      ? {
          samples: samples.map((row) => ({
            netid: asString(row._id?.netid),
            userType: asString(row._id?.userType) || undefined,
            eventType: asString(row._id?.eventType) || undefined,
            count: Number(row.count) || 0,
            firstEventAt: row.firstEventAt,
            lastEventAt: row.lastEventAt,
          })),
        }
      : {}),
  };
}

async function buildOpportunityState(includeSamples: boolean, now: Date): Promise<{
  expiredOpenCount: number;
  samples?: Array<{ id: string; title: string; status: string; deadline: string }>;
}> {
  const filter: Filter<Document> = {
    archived: { $ne: true },
    status: { $in: OPEN_OPPORTUNITY_STATUSES },
    deadline: { $lt: now },
  };
  const expiredOpenCount = await collection('posted_opportunities').countDocuments(filter);
  const rows = includeSamples
    ? await collection('posted_opportunities')
        .find(filter)
        .project({ title: 1, status: 1, deadline: 1 })
        .limit(25)
        .toArray()
    : [];

  return {
    expiredOpenCount,
    ...(includeSamples
      ? {
          samples: rows.map((row) => ({
            id: stringifyId(row._id),
            title: asString(row.title),
            status: asString(row.status),
            deadline: row.deadline instanceof Date ? row.deadline.toISOString() : asString(row.deadline),
          })),
        }
      : {}),
  };
}

async function buildPaperAuthorshipSummary(includeSamples: boolean): Promise<{
  totalPapers: number;
  totalPaperAuthors: number;
  papersWithYaleAuthorIds: number;
  papersWithPaperAuthorRows: number;
  invalidPaperAuthorRows: number;
  orphanedPaperAuthorRows: number;
  duplicatePaperAuthorLinks: number;
  unsupportedDirectAuthorLinks: number;
  activeDirectAuthorFieldObservations: number;
  integrityFailureTotal: number;
  samples?: Record<string, unknown[]>;
}> {
  const [
    totalPapers,
    totalPaperAuthors,
    papersWithYaleAuthorIds,
    papersWithPaperAuthorRows,
    invalidPaperAuthorRows,
    orphanedPaperAuthorRows,
    duplicatePaperAuthorLinks,
    unsupportedDirectAuthorLinks,
    activeDirectAuthorFieldObservations,
  ] = await Promise.all([
    collection('papers').countDocuments({ archived: { $ne: true } }),
    collection('paper_authors').countDocuments({}),
    collection('papers').countDocuments({ yaleAuthorIds: { $exists: true, $ne: [] }, archived: { $ne: true } }),
    countFromAggregate('paper_authors', [{ $group: { _id: '$paperId' } }, { $count: 'count' }]),
    collection('paper_authors').countDocuments({
      $or: [
        { paperId: { $exists: false } },
        { paperId: null },
        { displayName: { $exists: false } },
        { displayName: '' },
      ],
    }),
    countPaperAuthorOrphans(),
    countDuplicatePaperAuthorLinks(),
    countUnsupportedDirectAuthorLinks(),
    collection('observations').countDocuments({
      entityType: 'paper',
      field: { $in: ['yaleAuthorIds', 'yaleAuthorNetIds'] },
      superseded: { $ne: true },
      sourceName: { $ne: 'manual' },
    }),
  ]);

  const integrityFailureTotal =
    invalidPaperAuthorRows +
    orphanedPaperAuthorRows +
    duplicatePaperAuthorLinks +
    unsupportedDirectAuthorLinks +
    activeDirectAuthorFieldObservations;

  const samples = includeSamples
    ? {
        invalidPaperAuthorRows: await collection('paper_authors')
          .find({
            $or: [
              { paperId: { $exists: false } },
              { paperId: null },
              { displayName: { $exists: false } },
              { displayName: '' },
            ],
          })
          .project({ paperId: 1, userId: 1, facultyMemberId: 1, displayName: 1 })
          .limit(10)
          .toArray(),
      }
    : undefined;

  return {
    totalPapers,
    totalPaperAuthors,
    papersWithYaleAuthorIds,
    papersWithPaperAuthorRows,
    invalidPaperAuthorRows,
    orphanedPaperAuthorRows,
    duplicatePaperAuthorLinks,
    unsupportedDirectAuthorLinks,
    activeDirectAuthorFieldObservations,
    integrityFailureTotal,
    ...(samples ? { samples } : {}),
  };
}

async function countPaperAuthorOrphans(): Promise<number> {
  return countFromAggregate('paper_authors', [
    {
      $lookup: {
        from: 'papers',
        localField: 'paperId',
        foreignField: '_id',
        as: '_paper',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: '_user',
      },
    },
    {
      $lookup: {
        from: 'faculty_members',
        localField: 'facultyMemberId',
        foreignField: '_id',
        as: '_faculty',
      },
    },
    {
      $match: {
        $or: [
          { _paper: { $size: 0 } },
          { $and: [{ userId: { $exists: true, $ne: null } }, { _user: { $size: 0 } }] },
          { $and: [{ facultyMemberId: { $exists: true, $ne: null } }, { _faculty: { $size: 0 } }] },
        ],
      },
    },
    { $count: 'count' },
  ]);
}

async function countDuplicatePaperAuthorLinks(): Promise<number> {
  return countFromAggregate('paper_authors', [
    {
      $group: {
        _id: {
          paperId: '$paperId',
          userId: '$userId',
          facultyMemberId: '$facultyMemberId',
          displayName: { $toLower: { $trim: { input: '$displayName' } } },
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $count: 'count' },
  ]);
}

async function countUnsupportedDirectAuthorLinks(): Promise<number> {
  return countFromAggregate('papers', [
    { $match: { yaleAuthorIds: { $exists: true, $ne: [] }, archived: { $ne: true } } },
    {
      $lookup: {
        from: 'paper_authors',
        localField: '_id',
        foreignField: 'paperId',
        as: '_paperAuthors',
      },
    },
    { $match: { _paperAuthors: { $size: 0 } } },
    { $count: 'count' },
  ]);
}

async function buildSourceHealthSummary(days: number, includeSamples: boolean): Promise<{
  windowDays: number;
  sources: number;
  riskCounts: Record<'ok' | 'warn' | 'error', number>;
  reviewSummary: ReturnType<typeof buildSourceHealthReviewSummary>;
  rows?: SourceHealthRow[];
  queueItems?: Array<{
    sourceName: string;
    risk: string;
    queueType: string;
    action: string;
    nextCommand?: string;
    latestRunId?: string;
    materializationErrors?: number;
    materializationConflicts?: number;
  }>;
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sources = await Source.find({ enabled: { $ne: false } })
    .select('name displayName enabled cadence coverage')
    .sort({ 'coverage.priority': 1, name: 1 })
    .lean();
  const sourceNames = sources.map((source) => source.name);
  const runs = await ScrapeRun.find({
    sourceName: { $in: sourceNames },
    startedAt: { $gte: since },
  })
    .select(
      'sourceName status startedAt finishedAt observationCount materializationErrors materializationConflicts invalidated',
    )
    .sort({ sourceName: 1, startedAt: -1 })
    .lean();
  const rows = resolveSourceHealthRowsWithReviewArtifacts(
    buildSourceHealthRows(
      sources as Parameters<typeof buildSourceHealthRows>[0],
      runs as Parameters<typeof buildSourceHealthRows>[1],
    ),
  );
  const riskCounts = rows.reduce(
    (counts, row) => {
      counts[row.risk] += 1;
      return counts;
    },
    { ok: 0, warn: 0, error: 0 },
  );

  const queueItems = rows
    .filter((row) => row.risk !== 'ok')
    .map((row) => ({
      sourceName: row.sourceName,
      risk: row.risk,
      queueType: classifySourceWarning(row),
      action: row.action,
      ...(row.nextCommand ? { nextCommand: row.nextCommand } : {}),
      ...(row.latestRun?.id ? { latestRunId: row.latestRun.id } : {}),
      ...(row.latestRun
        ? {
            materializationErrors: row.latestRun.materializationErrors,
            materializationConflicts: row.latestRun.materializationConflicts,
          }
        : {}),
    }));

  return {
    windowDays: days,
    sources: rows.length,
    riskCounts,
    reviewSummary: buildSourceHealthReviewSummary(rows),
    ...(includeSamples ? { rows, queueItems } : { queueItems }),
  };
}

async function buildResearchEntityCoverage(): Promise<{
  activeEntities: number;
  withPathways: number;
  withoutPathways: number;
  withAccessSignals: number;
  withoutAccessSignals: number;
  withContactRoutes: number;
  withoutContactRoutes: number;
}> {
  const [activeEntities, withoutPathways, withoutAccessSignals, withoutContactRoutes] = await Promise.all([
    collection('research_entities').countDocuments(ACTIVE_FILTER),
    countEntitiesMissingChild('entry_pathways'),
    countEntitiesMissingChild('access_signals'),
    countEntitiesMissingChild('contact_routes'),
  ]);

  return {
    activeEntities,
    withPathways: activeEntities - withoutPathways,
    withoutPathways,
    withAccessSignals: activeEntities - withoutAccessSignals,
    withoutAccessSignals,
    withContactRoutes: activeEntities - withoutContactRoutes,
    withoutContactRoutes,
  };
}

async function countEntitiesMissingChild(childCollection: string): Promise<number> {
  return countFromAggregate('research_entities', [
    { $match: ACTIVE_FILTER },
    {
      $lookup: {
        from: childCollection,
        let: { entityId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$researchEntityId', '$$entityId'] },
              archived: { $ne: true },
            },
          },
          { $limit: 1 },
        ],
        as: '_children',
      },
    },
    { $match: { _children: { $size: 0 } } },
    { $count: 'count' },
  ]);
}

async function buildDescriptionQuality(includeSamples: boolean): Promise<{
  missingCount: number;
  weakCount: number;
  weakThresholdChars: number;
  samples?: {
    missing: Array<{ id: string; name: string; departments?: string[] }>;
    weak: Array<{ id: string; name: string; shortDescription: string }>;
  };
}> {
  const weakThresholdChars = 80;
  const [missingCount, weakCount] = await Promise.all([
    countFromAggregate('research_entities', [
      { $match: ACTIVE_FILTER },
      {
        $project: {
          descriptionLength: {
            $strLenCP: { $trim: { input: { $ifNull: ['$shortDescription', ''] } } },
          },
        },
      },
      { $match: { descriptionLength: 0 } },
      { $count: 'count' },
    ]),
    countFromAggregate('research_entities', [
      { $match: ACTIVE_FILTER },
      {
        $project: {
          descriptionLength: {
            $strLenCP: { $trim: { input: { $ifNull: ['$shortDescription', ''] } } },
          },
        },
      },
      { $match: { descriptionLength: { $gt: 0, $lt: weakThresholdChars } } },
      { $count: 'count' },
    ]),
  ]);

  if (!includeSamples) {
    return { missingCount, weakCount, weakThresholdChars };
  }

  const [missingRows, weakRows] = await Promise.all([
    collection('research_entities')
      .find({
        ...ACTIVE_FILTER,
        $or: [{ shortDescription: { $exists: false } }, { shortDescription: null }, { shortDescription: '' }],
      })
      .project({ name: 1, departments: 1 })
      .sort({ name: 1 })
      .limit(25)
      .toArray(),
    collection('research_entities')
      .find({ ...ACTIVE_FILTER, shortDescription: { $exists: true, $nin: [null, ''] } })
      .project({ name: 1, shortDescription: 1 })
      .sort({ name: 1 })
      .limit(50)
      .toArray(),
  ]);

  return {
    missingCount,
    weakCount,
    weakThresholdChars,
    samples: {
      missing: missingRows.map((row) => ({
        id: stringifyId(row._id),
        name: asString(row.name),
        departments: asStringArray(row.departments),
      })),
      weak: weakRows
        .map((row) => ({
          id: stringifyId(row._id),
          name: asString(row.name),
          shortDescription: asString(row.shortDescription).trim(),
        }))
        .filter((row) => row.shortDescription.length > 0 && row.shortDescription.length < weakThresholdChars)
        .slice(0, 25),
    },
  };
}

async function buildDuplicateEntityNames(includeSamples: boolean): Promise<{
  clusterCount: number;
  entityCountInClusters: number;
  reviewSummary: ReturnType<typeof buildDuplicateEntityReviewSummary>;
  planReview: ReturnType<typeof buildDuplicateEntityPlanReviewSummary>;
  clusters?: DuplicateEntityCluster[];
}> {
  const rows = (await collection('research_entities')
    .aggregate([
      { $match: { ...ACTIVE_FILTER, name: { $exists: true, $ne: '' } } },
      {
        $project: {
          normalizedName: { $toLower: { $trim: { input: '$name' } } },
          name: 1,
          slug: 1,
          kind: 1,
          entityType: 1,
          school: 1,
          schools: 1,
          departments: 1,
          researchAreas: 1,
          website: 1,
          websiteUrl: 1,
          sourceUrls: 1,
          contactName: 1,
          contactEmail: 1,
        },
      },
      { $match: { normalizedName: { $ne: '' } } },
      {
        $group: {
          _id: '$normalizedName',
          count: { $sum: 1 },
          entities: { $push: '$$ROOT' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ])
    .toArray()) as Array<Document & { _id: string; count: number; entities: Document[] }>;

  const clusters: DuplicateEntityCluster[] = rows.map((row) => {
    const cluster: DuplicateEntityCluster = {
      normalizedName: row._id,
      count: row.count,
      entities: row.entities.slice(0, 10).map((entity) => ({
        id: stringifyId(entity._id),
        name: asString(entity.name),
        slug: optionalString(entity.slug),
        kind: optionalString(entity.kind),
        entityType: optionalString(entity.entityType),
        school: optionalString(entity.school),
        schools: asStringArray(entity.schools),
        departments: asStringArray(entity.departments),
        researchAreas: asStringArray(entity.researchAreas),
        website: optionalString(entity.website),
        websiteUrl: optionalString(entity.websiteUrl),
        sourceUrls: asStringArray(entity.sourceUrls),
        contactName: optionalString(entity.contactName),
        contactEmail: optionalString(entity.contactEmail),
      })),
    };
    return {
      ...cluster,
      reviewCategory: classifyDuplicateEntityCluster(cluster),
    };
  });

  const reviewSummary = buildDuplicateEntityReviewSummary(clusters);

  return {
    clusterCount: rows.length,
    entityCountInClusters: rows.reduce((sum, row) => sum + row.count, 0),
    reviewSummary,
    planReview: buildDuplicateEntityPlanReviewSummary(reviewSummary),
    ...(includeSamples ? { clusters: clusters.slice(0, 50) } : {}),
  };
}

async function buildResearchEntityContentPageLeaks(): Promise<ReturnType<typeof buildResearchEntityContentPageLeakSummary>> {
  const rows = await collection('research_entities')
    .find(ACTIVE_FILTER)
    .project({
      name: 1,
      displayName: 1,
      slug: 1,
      kind: 1,
      entityType: 1,
      website: 1,
      websiteUrl: 1,
      sourceUrls: 1,
    })
    .toArray();

  return buildResearchEntityContentPageLeakSummary(
    rows.map((row) => ({
      id: stringifyId(row._id),
      name: optionalString(row.name),
      displayName: optionalString(row.displayName),
      slug: optionalString(row.slug),
      kind: optionalString(row.kind),
      entityType: optionalString(row.entityType),
      website: optionalString(row.website),
      websiteUrl: optionalString(row.websiteUrl),
      sourceUrls: asStringArray(row.sourceUrls),
    })),
  );
}

async function buildLiveLinkCheck(options: BetaDataQualityOptions): Promise<LiveLinkCheckResult> {
  if (!options.liveLinks) {
    return {
      enabled: false,
      sampleSize: options.linkSampleSize,
      checked: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    };
  }

  const candidates = selectLiveLinkCandidates(await collectLinkCandidateInputs(options.linkSampleSize * 6), options.linkSampleSize);
  const failures: LiveLinkCheckResult['failures'] = [];
  let ok = 0;

  for (const candidate of candidates) {
    const result = await checkLiveLink(candidate.url);
    if (result.ok) {
      ok += 1;
      continue;
    }
    failures.push({
      url: candidate.url,
      sources: candidate.sources,
      status: result.status,
      error: result.error,
    });
  }

  return {
    enabled: true,
    sampleSize: options.linkSampleSize,
    checked: candidates.length,
    ok,
    failed: failures.length,
    skipped: Math.max(0, options.linkSampleSize - candidates.length),
    failures,
  };
}

async function collectLinkCandidateInputs(limit: number): Promise<LinkCandidateInput[]> {
  const inputs: LinkCandidateInput[] = [];
  const specs = [
    { collection: 'research_entities', fields: ['websiteUrl', 'website', 'sourceUrls'] },
    { collection: 'entry_pathways', fields: ['sourceUrls'] },
    { collection: 'contact_routes', fields: ['url', 'sourceUrl'] },
    { collection: 'posted_opportunities', fields: ['applicationUrl', 'sourceUrls'] },
    { collection: 'papers', fields: ['url', 'openAccessUrl', 'landingPageUrl', 'pdfUrl'] },
  ];

  for (const spec of specs) {
    if (inputs.length >= limit) break;
    const projection = Object.fromEntries(spec.fields.map((field) => [field, 1]));
    const rows = await collection(spec.collection)
      .find({})
      .project(projection)
      .limit(Math.ceil(limit / specs.length) + 10)
      .toArray();
    for (const row of rows) {
      for (const field of spec.fields) {
        const value = row[field];
        if (Array.isArray(value)) {
          for (const item of value) {
            inputs.push({ value: item, source: `${spec.collection}.${field}` });
          }
        } else {
          inputs.push({ value, source: `${spec.collection}.${field}` });
        }
      }
    }
  }

  return inputs;
}

async function checkLiveLink(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const safeUrl = await assertPublicHttpUrl(url);
    const agents = ssrfSafeAgents();
    const request = async (method: 'HEAD' | 'GET') => axios.request({
      url: safeUrl.toString(),
      method,
      maxRedirects: 5,
      timeout: 7000,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
      responseType: method === 'GET' ? 'stream' : 'json',
      validateStatus: () => true,
    });

    let response = await request('HEAD');
    if (response.status === 405 || response.status === 403) {
      response = await request('GET');
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    }
    return { ok: response.status >= 200 && response.status < 400, status: response.status };
  } catch (error) {
    return { ok: false, error: String(sanitizeLogValue(error)) };
  }
}

async function scanStringFields(input: {
  specs: Array<{ collection: string; scalarFields: string[]; arrayFields: string[] }>;
  validator: (value: unknown, context: { collection: string; field: string; isArray: boolean }) => boolean;
  includeSamples: boolean;
}): Promise<FieldIssueSummary> {
  const byField: FieldIssueSummary['byField'] = [];
  const samples: FieldIssueSample[] = [];
  let invalidTotal = 0;

  for (const spec of input.specs) {
    for (const field of spec.scalarFields) {
      const invalidRows = await collectInvalidFieldRows({
        collectionName: spec.collection,
        field,
        isArray: false,
        validator: (value) => input.validator(value, { collection: spec.collection, field, isArray: false }),
        sampleLimit: input.includeSamples ? 25 : 0,
      });
      invalidTotal += invalidRows.invalidCount;
      if (invalidRows.invalidCount > 0) {
        byField.push({ collection: spec.collection, field, invalidCount: invalidRows.invalidCount });
        samples.push(...invalidRows.samples);
      }
    }

    for (const field of spec.arrayFields) {
      const invalidRows = await collectInvalidFieldRows({
        collectionName: spec.collection,
        field,
        isArray: true,
        validator: (value) => input.validator(value, { collection: spec.collection, field, isArray: true }),
        sampleLimit: input.includeSamples ? 25 : 0,
      });
      invalidTotal += invalidRows.invalidCount;
      if (invalidRows.invalidCount > 0) {
        byField.push({ collection: spec.collection, field, invalidCount: invalidRows.invalidCount });
        samples.push(...invalidRows.samples);
      }
    }
  }

  return {
    invalidTotal,
    byField,
    ...(input.includeSamples ? { samples: samples.slice(0, 50) } : {}),
  };
}

async function collectInvalidFieldRows(input: {
  collectionName: string;
  field: string;
  isArray: boolean;
  validator: (value: unknown) => boolean;
  sampleLimit: number;
}): Promise<{ invalidCount: number; samples: FieldIssueSample[] }> {
  const cursor = collection(input.collectionName)
    .find({ [input.field]: { $exists: true, $ne: null } })
    .project({ [input.field]: 1 });
  let invalidCount = 0;
  const samples: FieldIssueSample[] = [];

  for await (const row of cursor) {
    const values = input.isArray && Array.isArray(row[input.field]) ? row[input.field] : [row[input.field]];
    for (const value of values) {
      if (!input.validator(value)) {
        continue;
      }
      invalidCount += 1;
      if (samples.length < input.sampleLimit) {
        samples.push({
          collection: input.collectionName,
          field: input.field,
          id: stringifyId(row._id),
          value,
        });
      }
    }
  }

  return { invalidCount, samples };
}

async function countFromAggregate(collectionName: string, pipeline: Document[]): Promise<number> {
  const rows = await collection(collectionName).aggregate<{ count: number }>(pipeline).toArray();
  return rows[0]?.count || 0;
}

function classifySourceWarning(row: SourceHealthRow): string {
  if (row.latestRun?.materializationErrors || row.latestRun?.materializationConflicts) {
    return 'conflict-review';
  }
  if (!row.latestRun) {
    return 'no-recent-run-decision';
  }
  if (row.recentRuns.total === 0 || row.latestRun.observationCount === 0) {
    return 'implemented-but-not-promoted';
  }
  return 'source-health-review';
}

function collection(name: string): Collection<Document> {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not initialized');
  }
  return db.collection(name);
}

function describeMongoTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '') || '(default-db)';
    return `${parsed.protocol}//${parsed.hostname}/${database}`;
  } catch {
    return '(unparseable-mongodb-url)';
  }
}

function stringifyId(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | undefined {
  const stringValue = asString(value).trim();
  return stringValue || undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error(sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
