import type { Document } from 'mongodb';
import {
  escapePhase0HotPathRegex,
  type Phase0HotPathFixtureState,
  type Phase0HotPathQuerySpec,
  type Phase0HotPathSurface,
} from './phase0HotPathQueryCostCore';

const PUBLIC_ENTITY_FILTER = {
  archived: { $ne: true },
  studentVisibilityTier: { $in: ['student_ready'] },
};

const STUDENT_PATHWAY_FILTER = {
  archived: false,
  derivationKey: { $not: /^faculty-opportunity:/ },
  status: { $in: ['ACTIVE', 'RECURRING'] },
  evidenceStrength: { $in: ['DIRECT', 'STRONG', 'MODERATE'] },
  confidence: { $gte: 0.7 },
  sourceUrls: { $elemMatch: { $type: 'string', $regex: '^https?://' } },
};

function findSpec(
  label: string,
  surface: Phase0HotPathSurface,
  collection: string,
  filter: Document,
  options: {
    sort?: Document;
    limit?: number;
    projection?: Document;
  } = {},
): Phase0HotPathQuerySpec {
  return {
    label,
    surface,
    collection,
    operation: 'find',
    command: {
      find: collection,
      filter,
      ...(options.sort ? { sort: options.sort } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.projection ? { projection: options.projection } : {}),
      batchSize: Math.min(options.limit || 100, 100),
    },
  };
}

function distinctSpec(
  label: string,
  surface: Phase0HotPathSurface,
  collection: string,
  key: string,
  query: Document,
): Phase0HotPathQuerySpec {
  return {
    label,
    surface,
    collection,
    operation: 'distinct',
    command: { distinct: collection, key, query },
  };
}

function aggregateSpec(
  label: string,
  surface: Phase0HotPathSurface,
  collection: string,
  pipeline: Document[],
): Phase0HotPathQuerySpec {
  return {
    label,
    surface,
    collection,
    operation: 'aggregate',
    command: { aggregate: collection, pipeline, cursor: {}, allowDiskUse: true },
  };
}

function publicOpportunityFilter(now: Date): Document {
  return {
    $or: [
      { origin: { $ne: 'FACULTY_SUBMITTED' }, archived: false },
      {
        origin: 'FACULTY_SUBMITTED',
        archived: false,
        status: { $in: ['OPEN', 'ROLLING'] },
        'review.status': 'approved',
        $or: [
          { deadline: { $exists: false } },
          { deadline: null },
          { deadline: { $gte: now } },
        ],
      },
    ],
  };
}

function pathwayHydrationPipeline(pathwayIds: unknown[]): Document[] {
  return [
    {
      $match: {
        _id: { $in: pathwayIds },
        archived: { $ne: true },
        status: { $in: ['ACTIVE', 'RECURRING'] },
        evidenceStrength: { $in: ['DIRECT', 'STRONG', 'MODERATE'] },
        confidence: { $gte: 0.7 },
      },
    },
    {
      $lookup: {
        from: 'research_entities',
        localField: 'researchEntityId',
        foreignField: '_id',
        as: 'researchEntity',
      },
    },
    { $unwind: '$researchEntity' },
    {
      $match: {
        'researchEntity.archived': { $ne: true },
        'researchEntity.studentVisibilityTier': { $in: ['student_ready'] },
      },
    },
    {
      $lookup: {
        from: 'posted_opportunities',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  { $in: ['$status', ['OPEN', 'ROLLING']] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      { $eq: ['$researchEntityId', '$$entityId'] },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { deadline: 1, updatedAt: -1 } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'activePostedOpportunities',
      },
    },
    {
      $lookup: {
        from: 'access_signals',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      { $eq: ['$researchEntityId', '$$entityId'] },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { confidenceScore: -1, observedAt: -1 } },
          { $limit: 3 },
          { $project: { _id: 1 } },
        ],
        as: 'evidence',
      },
    },
    {
      $lookup: {
        from: 'contact_routes',
        let: { pathwayId: '$_id', entityId: '$researchEntityId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ['$archived', true] },
                  { $eq: ['$visibility', 'PUBLIC'] },
                  { $ne: ['$contactPolicy', 'NO_DIRECT_CONTACT'] },
                  {
                    $or: [
                      { $eq: ['$entryPathwayId', '$$pathwayId'] },
                      { $eq: ['$researchEntityId', '$$entityId'] },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { priority: 1, updatedAt: -1 } },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'contactRoutes',
      },
    },
    { $sort: { lastObservedAt: -1, confidence: -1, studentFacingLabel: 1 } },
    { $limit: Math.min(100, Math.max(1, pathwayIds.length)) },
    { $project: { _id: 1 } },
  ];
}

function accessReviewLookup(from: string, as: string, includeApplication = false): Document {
  return {
    $lookup: {
      from,
      let: { entityId: '$_id' },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ['$researchEntityId', '$$entityId'] },
            ...(from === 'posted_opportunities'
              ? { submissionStatus: { $ne: 'DRAFT' } }
              : from === 'entry_pathways'
                ? { derivationKey: { $not: /^faculty-opportunity:/ } }
                : {}),
          },
        },
        {
          $project: {
            _id: 0,
            status: '$review.status',
            ...(includeApplication ? { applicationUrl: 1 } : {}),
          },
        },
      ],
      as,
    },
  };
}

function accessReviewPipeline(input: {
  search?: string;
  hasUnreviewed?: boolean;
  sort: 'unreviewed' | 'official-application' | 'updated';
}): Document[] {
  const filter: Document = input.search
    ? {
        $or: [
          { name: new RegExp(escapePhase0HotPathRegex(input.search), 'i') },
          { displayName: new RegExp(escapePhase0HotPathRegex(input.search), 'i') },
          { slug: new RegExp(escapePhase0HotPathRegex(input.search), 'i') },
          { departments: new RegExp(escapePhase0HotPathRegex(input.search), 'i') },
          { researchAreas: new RegExp(escapePhase0HotPathRegex(input.search), 'i') },
        ],
      }
    : {};
  return [
    { $match: filter },
    accessReviewLookup('entry_pathways', '_pathways'),
    accessReviewLookup('access_signals', '_signals'),
    accessReviewLookup('contact_routes', '_routes'),
    accessReviewLookup('posted_opportunities', '_opportunities', true),
    {
      $set: {
        totalUnreviewed: {
          $add: ['$_pathways', '$_signals', '$_routes', '$_opportunities'].map((inputName) => ({
            $size: {
              $filter: {
                input: inputName,
                as: 'record',
                cond: {
                  $in: [
                    { $ifNull: ['$$record.status', 'unreviewed'] },
                    ['unreviewed', null],
                  ],
                },
              },
            },
          })),
        },
        hasOfficialApplication: {
          $anyElementTrue: {
            $map: {
              input: '$_opportunities',
              as: 'record',
              in: {
                $gt: [{ $strLenCP: { $ifNull: ['$$record.applicationUrl', ''] } }, 0],
              },
            },
          },
        },
      },
    },
    ...(input.hasUnreviewed === true
        ? [{ $match: { totalUnreviewed: { $gt: 0 } } }]
        : []),
    {
      $sort:
        input.sort === 'updated'
          ? { updatedAt: -1, _id: 1 }
          : input.sort === 'official-application'
            ? { hasOfficialApplication: -1, totalUnreviewed: -1, updatedAt: -1, _id: 1 }
            : { totalUnreviewed: -1, hasOfficialApplication: -1, updatedAt: -1, _id: 1 },
    },
    {
      $facet: {
        rows: [{ $skip: 0 }, { $limit: 25 }, { $project: { _id: 1 } }],
        meta: [{ $count: 'total' }],
      },
    },
  ];
}

function progressCountSpec(
  label: string,
  collection: string,
  reviewedToday: boolean,
  startOfDay: Date,
): Phase0HotPathQuerySpec {
  const visibleQueueFilter =
    collection === 'entry_pathways'
      ? { derivationKey: { $not: /^faculty-opportunity:/ } }
      : collection === 'posted_opportunities'
        ? { submissionStatus: { $ne: 'DRAFT' } }
        : {};
  const filter = reviewedToday
    ? {
        ...visibleQueueFilter,
        'review.status': { $ne: 'unreviewed' },
        'review.reviewedAt': { $gte: startOfDay },
      }
    : {
        ...visibleQueueFilter,
        $or: [{ 'review.status': 'unreviewed' }, { 'review.status': { $exists: false } }],
      };
  return aggregateSpec(label, 'admin-access-review', collection, [
    { $match: filter },
    { $count: 'count' },
  ]);
}

export function buildPhase0HotPathQuerySpecs(
  fixtures: Phase0HotPathFixtureState,
  now = new Date(),
): Phase0HotPathQuerySpec[] {
  const specs: Phase0HotPathQuerySpec[] = [];
  const browseIds = fixtures.browseEntityIds;

  if (browseIds.length > 0) {
    specs.push(
      findSpec(
        'research-browse-visible-entities',
        'research-browse',
        'research_entities',
        { _id: { $in: browseIds }, ...PUBLIC_ENTITY_FILTER },
        { limit: 100, projection: { _id: 1 } },
      ),
      findSpec(
        'research-browse-mongo-fallback',
        'research-browse',
        'research_entities',
        PUBLIC_ENTITY_FILTER,
        { projection: { _id: 1 } },
      ),
      distinctSpec(
        'research-browse-active-listings',
        'research-browse',
        'listings',
        'researchEntityId',
        { researchEntityId: { $in: browseIds }, archived: false },
      ),
      findSpec(
        'research-browse-access-signals',
        'research-browse',
        'access_signals',
        { researchEntityId: { $in: browseIds }, archived: false },
        { sort: { observedAt: -1 }, projection: { _id: 1 } },
      ),
      findSpec(
        'research-browse-entry-pathways',
        'research-browse',
        'entry_pathways',
        {
          researchEntityId: { $in: browseIds },
          archived: false,
          derivationKey: { $not: /^faculty-opportunity:/ },
        },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-browse-posted-opportunities',
        'research-browse',
        'posted_opportunities',
        {
          researchEntityId: { $in: browseIds },
          ...publicOpportunityFilter(now),
        },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-browse-contact-routes',
        'research-browse',
        'contact_routes',
        {
          researchEntityId: { $in: browseIds },
          archived: false,
          'review.status': 'approved',
        },
        { projection: { _id: 1 } },
      ),
    );
  }

  const detailEntityId = fixtures.highFanoutEntityId || fixtures.typicalEntityId;
  if (detailEntityId && fixtures.typicalEntitySlug) {
    specs.push(
      findSpec(
        'research-detail-entity-by-slug',
        'research-detail',
        'research_entities',
        { slug: fixtures.typicalEntitySlug, ...PUBLIC_ENTITY_FILTER },
        { limit: 1, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-current-members',
        'research-detail',
        'research_entity_members',
        {
          researchEntityId: detailEntityId,
          isCurrentMember: { $ne: false },
          archived: { $ne: true },
        },
        { sort: { role: 1, updatedAt: -1 }, limit: 100, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-users',
        'research-detail',
        'users',
        { _id: { $in: fixtures.detailUserIds } },
        { limit: 100, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-faculty-members',
        'research-detail',
        'faculty_members',
        { _id: { $in: fixtures.detailFacultyIds }, archived: { $ne: true } },
        { limit: 100, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-shared-images',
        'research-detail',
        'users',
        { imageUrl: { $in: fixtures.detailImageUrls } },
        { limit: 500, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-member-attributions',
        'research-detail',
        'research_scholarly_attributions',
        {
          targetUserId: { $in: fixtures.detailMemberUserIds },
          archived: { $ne: true },
        },
        { sort: { observedAt: -1, updatedAt: -1 }, limit: 80, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-attributed-scholarly-links',
        'research-detail',
        'research_scholarly_links',
        {
          _id: { $in: fixtures.detailAttributedScholarlyLinkIds },
          archived: { $ne: true },
        },
        {
          sort: { observedAt: -1, year: -1, updatedAt: -1 },
          limit: 20,
          projection: { _id: 1 },
        },
      ),
      findSpec(
        'research-detail-published-papers',
        'research-detail',
        'papers',
        {
          yaleAuthorIds: { $in: fixtures.detailUserIds },
          $or: [
            { publicationStage: { $exists: false } },
            { publicationStage: { $ne: 'PREPRINT' } },
          ],
        },
        { sort: { publishedAt: -1 }, limit: 10, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-arxiv-preprints',
        'research-detail',
        'papers',
        {
          archived: false,
          yaleAuthorIds: { $in: fixtures.detailUserIds },
          $or: [{ preprintServer: 'arxiv' }, { publicationStage: 'PREPRINT' }],
        },
        {
          sort: { postedAt: -1, versionDate: -1, publishedAt: -1 },
          limit: 10,
          projection: { _id: 1 },
        },
      ),
      findSpec(
        'research-detail-entity-scholarly-links',
        'research-detail',
        'research_scholarly_links',
        { researchEntityId: detailEntityId, archived: { $ne: true } },
        { sort: { observedAt: -1, year: -1, updatedAt: -1 }, limit: 10, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-listings',
        'research-detail',
        'listings',
        { researchEntityId: detailEntityId, archived: false },
        { sort: { updatedAt: -1 }, limit: 50, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-entry-pathways',
        'research-detail',
        'entry_pathways',
        { researchEntityId: detailEntityId, ...STUDENT_PATHWAY_FILTER },
        { sort: { updatedAt: -1 }, limit: 50, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-access-signals',
        'research-detail',
        'access_signals',
        { researchEntityId: detailEntityId, archived: false },
        { sort: { observedAt: -1 }, limit: 50, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-contact-routes',
        'research-detail',
        'contact_routes',
        {
          researchEntityId: detailEntityId,
          archived: false,
          visibility: 'PUBLIC',
          'review.status': 'approved',
        },
        { sort: { priority: 1 }, limit: 50, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-posted-opportunities',
        'research-detail',
        'posted_opportunities',
        { researchEntityId: detailEntityId, ...publicOpportunityFilter(now) },
        { sort: { deadline: 1 }, limit: 50, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-access-summary-entry-pathways',
        'research-detail',
        'entry_pathways',
        {
          researchEntityId: { $in: [detailEntityId] },
          archived: false,
          derivationKey: { $not: /^faculty-opportunity:/ },
        },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-access-summary-access-signals',
        'research-detail',
        'access_signals',
        { researchEntityId: { $in: [detailEntityId] }, archived: false },
        { sort: { observedAt: -1 }, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-access-summary-posted-opportunities',
        'research-detail',
        'posted_opportunities',
        {
          researchEntityId: { $in: [detailEntityId] },
          ...publicOpportunityFilter(now),
          status: { $in: ['OPEN', 'ROLLING'] },
        },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-planning-entry-pathways',
        'research-detail',
        'entry_pathways',
        { researchEntityId: { $in: [detailEntityId] }, archived: false },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-planning-contact-routes',
        'research-detail',
        'contact_routes',
        {
          researchEntityId: { $in: [detailEntityId] },
          archived: false,
          'review.status': 'approved',
        },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-planning-posted-opportunities',
        'research-detail',
        'posted_opportunities',
        {
          $or: [
            { researchEntityId: { $in: [detailEntityId] } },
            { entryPathwayId: { $in: fixtures.detailEntryPathwayIds } },
          ],
          archived: false,
          status: { $in: ['OPEN', 'ROLLING'] },
        },
        { projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-relationships-outbound',
        'research-detail',
        'research_entity_relationships',
        { sourceResearchEntityId: detailEntityId, archived: { $ne: true } },
        { sort: { confidence: -1, updatedAt: -1 }, limit: 51, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-relationships-inbound',
        'research-detail',
        'research_entity_relationships',
        { targetResearchEntityId: detailEntityId, archived: { $ne: true } },
        { sort: { confidence: -1, updatedAt: -1 }, limit: 51, projection: { _id: 1 } },
      ),
      findSpec(
        'research-detail-related-entities',
        'research-detail',
        'research_entities',
        {
          _id: { $in: fixtures.detailRelatedEntityIds },
          archived: { $ne: true },
          studentVisibilityTier: { $in: ['student_ready'] },
        },
        { projection: { _id: 1 } },
      ),
    );
  }

  const opportunity = fixtures.ordinaryOpportunity;
  if (opportunity) {
    specs.push(
      findSpec(
        'opportunity-detail-opportunity',
        'opportunity-detail',
        'posted_opportunities',
        { _id: opportunity.id, ...publicOpportunityFilter(now) },
        { limit: 1, projection: { _id: 1 } },
      ),
      findSpec(
        'opportunity-detail-pathway',
        'opportunity-detail',
        'entry_pathways',
        { _id: opportunity.entryPathwayId, archived: false },
        { limit: 1, projection: { _id: 1 } },
      ),
      findSpec(
        'opportunity-detail-entity',
        'opportunity-detail',
        'research_entities',
        { _id: opportunity.researchEntityId, ...PUBLIC_ENTITY_FILTER },
        { limit: 1, projection: { _id: 1 } },
      ),
      findSpec(
        'opportunity-detail-observations',
        'opportunity-detail',
        'observations',
        { _id: { $in: opportunity.evidenceIds.slice(0, 100) }, superseded: { $ne: true } },
        { sort: { observedAt: -1 }, limit: 100, projection: { _id: 1 } },
      ),
    );
  }
  if (fixtures.highEvidenceOpportunity) {
    specs.push(
      findSpec(
        'opportunity-detail-high-evidence-observations',
        'opportunity-detail',
        'observations',
        {
          _id: { $in: fixtures.highEvidenceOpportunity.evidenceIds.slice(0, 100) },
          superseded: { $ne: true },
        },
        { sort: { observedAt: -1 }, limit: 100, projection: { _id: 1 } },
      ),
    );
  }

  for (const account of fixtures.accounts) {
    const suffix = account.fixtureClass;
    specs.push(
      findSpec(
        `account-planning-user-${suffix}`,
        'account-planning',
        'users',
        {
          netid: {
            $regex: `^${escapePhase0HotPathRegex(account.netid)}$`,
            $options: 'i',
          },
        },
        { limit: 1, projection: { _id: 1 } },
      ),
      findSpec(
        `account-planning-visible-entities-${suffix}`,
        'account-planning',
        'research_entities',
        {
          _id: { $in: account.savedResearchEntityIds },
          ...PUBLIC_ENTITY_FILTER,
        },
        { limit: 100, projection: { _id: 1 } },
      ),
      aggregateSpec(
        `account-planning-pathway-hydration-${suffix}`,
        'account-planning',
        'entry_pathways',
        pathwayHydrationPipeline(account.pathwayIds),
      ),
    );
  }
  specs.push(
    findSpec(
      'account-planning-fellowships',
      'account-planning',
      'fellowships',
      { archived: { $ne: true } },
      { sort: { deadline: 1, updatedAt: -1 }, projection: { _id: 1 } },
    ),
  );

  specs.push(
    aggregateSpec(
      'admin-access-review-default',
      'admin-access-review',
      'research_entities',
      accessReviewPipeline({ sort: 'unreviewed' }),
    ),
    aggregateSpec(
      'admin-access-review-official-application',
      'admin-access-review',
      'research_entities',
      accessReviewPipeline({ sort: 'official-application' }),
    ),
    aggregateSpec(
      'admin-access-review-updated',
      'admin-access-review',
      'research_entities',
      accessReviewPipeline({ sort: 'updated' }),
    ),
    aggregateSpec(
      'admin-access-review-has-unreviewed-false',
      'admin-access-review',
      'research_entities',
      accessReviewPipeline({ sort: 'unreviewed', hasUnreviewed: false }),
    ),
  );
  if (fixtures.adminSearchTerm) {
    specs.push(
      aggregateSpec(
        'admin-access-review-search',
        'admin-access-review',
        'research_entities',
        accessReviewPipeline({ sort: 'unreviewed', search: fixtures.adminSearchTerm }),
      ),
    );
  }

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  for (const [name, collection] of [
    ['entry-pathways', 'entry_pathways'],
    ['access-signals', 'access_signals'],
    ['contact-routes', 'contact_routes'],
    ['posted-opportunities', 'posted_opportunities'],
  ] as const) {
    specs.push(
      progressCountSpec(
        `admin-access-review-progress-${name}-remaining`,
        collection,
        false,
        startOfDay,
      ),
      progressCountSpec(
        `admin-access-review-progress-${name}-reviewed-today`,
        collection,
        true,
        startOfDay,
      ),
    );
  }

  if (detailEntityId) {
    specs.push(
      findSpec(
        'admin-access-review-detail-entity',
        'admin-access-review',
        'research_entities',
        { _id: detailEntityId },
        { limit: 1, projection: { _id: 1 } },
      ),
      findSpec(
        'admin-access-review-detail-entry-pathways',
        'admin-access-review',
        'entry_pathways',
        {
          researchEntityId: detailEntityId,
          derivationKey: { $not: /^faculty-opportunity:/ },
        },
        { sort: { archived: 1, updatedAt: -1 }, projection: { _id: 1 } },
      ),
      findSpec(
        'admin-access-review-detail-access-signals',
        'admin-access-review',
        'access_signals',
        { researchEntityId: detailEntityId },
        { sort: { archived: 1, observedAt: -1 }, projection: { _id: 1 } },
      ),
      findSpec(
        'admin-access-review-detail-contact-routes',
        'admin-access-review',
        'contact_routes',
        { researchEntityId: detailEntityId },
        { sort: { archived: 1, priority: 1 }, projection: { _id: 1 } },
      ),
      findSpec(
        'admin-access-review-detail-posted-opportunities',
        'admin-access-review',
        'posted_opportunities',
        { researchEntityId: detailEntityId, submissionStatus: { $ne: 'DRAFT' } },
        { sort: { archived: 1, deadline: 1 }, projection: { _id: 1 } },
      ),
    );
  }

  return specs;
}
