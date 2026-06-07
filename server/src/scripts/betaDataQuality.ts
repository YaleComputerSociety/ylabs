import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import type { Collection, Document, Filter } from 'mongodb';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import { pruneSupersededObservations } from '../scrapers/observationRetention';
import { buildSourceHealthRows, type SourceHealthRow } from '../services/sourceHealthService';
import {
  buildBetaDataQualitySummary,
  buildReferenceIntegritySummary,
  buildResearchEntityContentPageLeakSummary,
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
} from './betaDataQualityCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ACTIVE_FILTER: Filter<Document> = { archived: { $ne: true } };
const OPEN_OPPORTUNITY_STATUSES = ['OPEN', 'ROLLING'];
const SUSPICIOUS_USER_EMAIL_PATTERN =
  /(^test[+@.]|@example\.|placeholder|unknown|invalid|dummy|no-?reply|^none@|^na@)/i;

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

interface DuplicateEntityCluster {
  normalizedName: string;
  count: number;
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

  await mongoose.connect(mongoUrl);
  const scorecard = await buildBetaDataQualityScorecard(options, mongoUrl);
  writeScorecardOutput(scorecard, options.output);
  console.log(JSON.stringify(scorecard, null, 2));

  if (options.strict && shouldStrictModeFail(scorecard.summary)) {
    process.exitCode = 1;
  }
}

export async function buildBetaDataQualityScorecard(
  options: BetaDataQualityOptions,
  mongoUrl: string = process.env.MONGODBURL || '',
): Promise<BetaDataQualityScorecard> {
  const generatedAt = new Date();
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
    retention,
    liveLinks,
  ] = await Promise.all([
    buildCollectionCounts(),
    buildReferenceIntegrity(),
    buildUrlHygiene(options.includeSamples),
    buildEmailHygiene(options.includeSamples),
    buildOpportunityState(options.includeSamples, generatedAt),
    buildPaperAuthorshipSummary(options.includeSamples),
    buildSourceHealthSummary(options.days, options.includeSamples),
    buildResearchEntityCoverage(),
    buildDescriptionQuality(options.includeSamples),
    buildDuplicateEntityNames(options.includeSamples),
    buildResearchEntityContentPageLeaks(),
    pruneSupersededObservations({ apply: false, olderThanDays: 30, keepRuns: 3 }),
    buildLiveLinkCheck(options),
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
    summary,
    counts,
    referenceIntegrity,
    hygiene: {
      urls: urlHygiene,
      emails: emailHygiene,
    },
    opportunityState,
    paperAuthorship,
    sourceHealth,
    researchEntityCoverage: coverage,
    descriptionQuality,
    duplicateEntityNames,
    researchEntityContentPageLeaks,
    scraperRetention: retention,
    liveLinks,
    recommendedCommands: {
      weeklyAudit:
        'yarn --cwd server beta:data-quality --include-samples --output /tmp/ylabs-beta-quality.json',
      strictAudit: 'yarn --cwd server beta:data-quality --strict --include-samples',
      retentionDryRun: 'yarn scrape prune-observations --older-than-days 30 --keep-runs 3',
    },
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
    'research_scholarly_links',
    'research_scholarly_attributions',
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

async function buildReferenceIntegrity(): Promise<ReturnType<typeof buildReferenceIntegritySummary>> {
  const audits: Array<Promise<ReferenceAuditInput>> = [
    referenceAudit('observations.sourceId', 'observations', 'sourceId', 'sources', true),
    referenceAudit('scrape_runs.sourceId', 'scrape_runs', 'sourceId', 'sources', true),
    referenceAudit('research_entities.canonicalGroupId', 'research_entities', 'canonicalGroupId', 'research_entities', false),
    referenceAudit('research_entities.primaryDepartmentId', 'research_entities', 'primaryDepartmentId', 'departments', false),
    referenceAudit('research_entities.departmentIds', 'research_entities', 'departmentIds', 'departments', false, true),
    referenceAudit('research_entities.researchAreaIds', 'research_entities', 'researchAreaIds', 'research_areas', false, true),
    referenceAudit('research_entities.featuredPaperIds', 'research_entities', 'featuredPaperIds', 'papers', false, true),
    referenceAudit('research_entities.claimedByUserId', 'research_entities', 'claimedByUserId', 'users', false),
    referenceAudit(
      'research_entities.studentVisibilityReviewedByUserId',
      'research_entities',
      'studentVisibilityReviewedByUserId',
      'users',
      false,
    ),
    referenceAudit(
      'fellowships.studentVisibilityReviewedByUserId',
      'fellowships',
      'studentVisibilityReviewedByUserId',
      'users',
      false,
    ),
    referenceAudit('entry_pathways.researchEntityId', 'entry_pathways', 'researchEntityId', 'research_entities', true),
    referenceAudit('entry_pathways.sourceEvidenceIds', 'entry_pathways', 'sourceEvidenceIds', 'observations', false, true),
    referenceAudit(
      'entry_pathways.review.reviewedByUserId',
      'entry_pathways',
      'review.reviewedByUserId',
      'users',
      false,
    ),
    referenceAudit('access_signals.researchEntityId', 'access_signals', 'researchEntityId', 'research_entities', true),
    referenceAudit('access_signals.entryPathwayId', 'access_signals', 'entryPathwayId', 'entry_pathways', false),
    referenceAudit('access_signals.sourceEvidenceId', 'access_signals', 'sourceEvidenceId', 'observations', false),
    referenceAudit('access_signals.observationId', 'access_signals', 'observationId', 'observations', false),
    referenceAudit(
      'access_signals.review.reviewedByUserId',
      'access_signals',
      'review.reviewedByUserId',
      'users',
      false,
    ),
    referenceAudit('contact_routes.researchEntityId', 'contact_routes', 'researchEntityId', 'research_entities', true),
    referenceAudit('contact_routes.entryPathwayId', 'contact_routes', 'entryPathwayId', 'entry_pathways', false),
    referenceAudit('contact_routes.personId', 'contact_routes', 'personId', 'users', false),
    referenceAudit(
      'contact_routes.review.reviewedByUserId',
      'contact_routes',
      'review.reviewedByUserId',
      'users',
      false,
    ),
    referenceAudit('contact_routes.sourceEvidenceId', 'contact_routes', 'sourceEvidenceId', 'observations', false),
    referenceAudit('contact_routes.sourceEvidenceIds', 'contact_routes', 'sourceEvidenceIds', 'observations', false, true),
    referenceAudit('posted_opportunities.entryPathwayId', 'posted_opportunities', 'entryPathwayId', 'entry_pathways', true),
    referenceAudit('posted_opportunities.researchEntityId', 'posted_opportunities', 'researchEntityId', 'research_entities', false),
    referenceAudit('posted_opportunities.listingId', 'posted_opportunities', 'listingId', 'listings', false),
    referenceAudit(
      'posted_opportunities.review.reviewedByUserId',
      'posted_opportunities',
      'review.reviewedByUserId',
      'users',
      false,
    ),
    referenceAudit('posted_opportunities.sourceEvidenceIds', 'posted_opportunities', 'sourceEvidenceIds', 'observations', false, true),
    referenceAudit('research_entity_members.userId', 'research_entity_members', 'userId', 'users', false),
    referenceAudit(
      'research_scholarly_links.userId',
      'research_scholarly_links',
      'userId',
      'users',
      false,
    ),
    referenceAudit(
      'research_scholarly_attributions.targetUserId',
      'research_scholarly_attributions',
      'targetUserId',
      'users',
      false,
    ),
    referenceAudit(
      'research_scholarly_attributions.scholarlyLinkId',
      'research_scholarly_attributions',
      'scholarlyLinkId',
      'research_scholarly_links',
      true,
    ),
    referenceAudit('paper_authors.paperId', 'paper_authors', 'paperId', 'papers', true),
    referenceAudit('paper_authors.userId', 'paper_authors', 'userId', 'users', false),
    referenceAudit('paper_authors.facultyMemberId', 'paper_authors', 'facultyMemberId', 'faculty_members', false),
    referenceAudit('papers.yaleAuthorIds', 'papers', 'yaleAuthorIds', 'users', false, true),
    referenceAudit('papers.facultyMemberIds', 'papers', 'facultyMemberIds', 'faculty_members', false, true),
    referenceAudit('papers.researchEntityIds', 'papers', 'researchEntityIds', 'research_entities', false, true),
    referenceAudit('listings.researchEntityId', 'listings', 'researchEntityId', 'research_entities', false),
    referenceAudit('listings.createdByUserId', 'listings', 'createdByUserId', 'users', false),
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
): Promise<ReferenceAuditInput> {
  const missingRequired = required
    ? await collection(collectionName).countDocuments({
        $or: [{ [localField]: { $exists: false } }, { [localField]: null }],
      })
    : 0;
  const orphanedPresentRefs = isArray
    ? await countArrayRefOrphans(collectionName, localField, targetCollectionName)
    : await countScalarRefOrphans(collectionName, localField, targetCollectionName);
  return {
    name,
    required,
    missingRequired,
    orphanedPresentRefs,
  };
}

async function countScalarRefOrphans(
  collectionName: string,
  localField: string,
  targetCollectionName: string,
): Promise<number> {
  return countFromAggregate(collectionName, [
    { $match: { [localField]: { $exists: true, $nin: [null, ''] } } },
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
): Promise<number> {
  return countFromAggregate(collectionName, [
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
  ]);
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
    suspiciousUserEmails: {
      count: number;
      samples?: Array<{
        id: string;
        netid?: string;
        name: string;
        email: string;
        reason: string;
      }>;
    };
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

  const suspiciousSamples: Array<{ id: string; netid?: string; name: string; email: string; reason: string }> = [];
  let suspiciousCount = 0;
  const cursor = collection('users')
    .find({ email: { $exists: true, $ne: '' } })
    .project({ email: 1, netid: 1, fname: 1, lname: 1 });
  for await (const row of cursor) {
    const email = asString(row.email).trim();
    if (!email || isInvalidOptionalEmail(email) || !SUSPICIOUS_USER_EMAIL_PATTERN.test(email)) {
      continue;
    }
    suspiciousCount += 1;
    if (includeSamples && suspiciousSamples.length < 25) {
      suspiciousSamples.push({
        id: stringifyId(row._id),
        netid: asString(row.netid) || undefined,
        name: [asString(row.fname), asString(row.lname)].filter(Boolean).join(' '),
        email,
        reason: 'placeholder-or-synthetic-pattern',
      });
    }
  }

  return {
    ...emailSyntax,
    suspiciousUserEmails: {
      count: suspiciousCount,
      ...(includeSamples ? { samples: suspiciousSamples } : {}),
    },
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
  totalScholarlyLinks: number;
  totalScholarlyAttributions: number;
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
    totalScholarlyLinks,
    totalScholarlyAttributions,
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
    collection('research_scholarly_links').countDocuments({ archived: { $ne: true } }),
    collection('research_scholarly_attributions').countDocuments({ archived: { $ne: true } }),
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
    totalScholarlyLinks,
    totalScholarlyAttributions,
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
  rows?: SourceHealthRow[];
  queueItems?: Array<{
    sourceName: string;
    risk: string;
    queueType: string;
    action: string;
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
  const rows = buildSourceHealthRows(
    sources as Parameters<typeof buildSourceHealthRows>[0],
    runs as Parameters<typeof buildSourceHealthRows>[1],
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
    }));

  return {
    windowDays: days,
    sources: rows.length,
    riskCounts,
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

  return {
    clusterCount: rows.length,
    entityCountInClusters: rows.reduce((sum, row) => sum + row.count, 0),
    ...(includeSamples
      ? {
          clusters: rows.slice(0, 50).map((row) => ({
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
          })),
        }
      : {}),
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
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(7000),
      });
    }
    return { ok: response.status >= 200 && response.status < 400, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && 'toString' in value) return value.toString();
  return String(value);
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
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
