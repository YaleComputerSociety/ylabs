import { ResearchScholarlyLink } from '../models/researchScholarlyLink';

export interface PaperQualityCounts {
  totalActiveScholarlyLinks: number;
  missingTitle: number;
  genericTitle: number;
  htmlTitle: number;
  missingInspectableLink: number;
  missingYearOrDate: number;
  missingSourceLabel: number;
  datasetLikeLinks: number;
  duplicateOpenAlexGroups: number;
  duplicateOpenAlexLinksToSuppress?: number;
  duplicateArxivGroups: number;
  duplicateArxivLinksToSuppress?: number;
  duplicateUrlGroups: number;
  duplicateUrlLinksToSuppress?: number;
  qualityFailureTotal?: number;
}

export interface PaperQualityReport {
  generatedAt: string;
  pass: boolean;
  counts: PaperQualityCounts & { qualityFailureTotal: number };
  warning: string;
  fixCommands: string[];
  samples?: Record<string, unknown[]>;
}

type DuplicateGroupField = 'externalIds.openAlexId' | 'externalIds.arxivId' | 'url';

const activeScholarlyLinkFilter = { archived: { $ne: true } };
const BETA_COMMAND_PREFIX = 'SCRAPER_ENV=beta ';

function betaCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return command;
  if (trimmed.startsWith(BETA_COMMAND_PREFIX)) return command;
  return `${BETA_COMMAND_PREFIX}${command}`;
}

const missingTextFilter = (field: string) => ({
  $or: [
    { [field]: { $exists: false } },
    { [field]: null },
    { [field]: '' },
    { [field]: /^\s*$/ },
  ],
});

const missingInspectableLinkFilter = {
  $and: [
    { $or: [{ url: { $exists: false } }, { url: null }, { url: '' }] },
    { $or: [{ sourceUrl: { $exists: false } }, { sourceUrl: null }, { sourceUrl: '' }] },
    { $or: [{ 'externalIds.openAlexId': { $exists: false } }, { 'externalIds.openAlexId': null }, { 'externalIds.openAlexId': '' }] },
    { $or: [{ 'externalIds.arxivId': { $exists: false } }, { 'externalIds.arxivId': null }, { 'externalIds.arxivId': '' }] },
  ],
};

const missingYearOrDateFilter = {
  $and: [
    { $or: [{ year: { $exists: false } }, { year: null }] },
    { $or: [{ observedAt: { $exists: false } }, { observedAt: null }] },
  ],
};

const countDuplicateGroups = async (field: string): Promise<number> => {
  const rows = await ResearchScholarlyLink.aggregate([
    {
      $match: {
        ...activeScholarlyLinkFilter,
        [field]: { $exists: true, $nin: [null, ''] },
        $or: [
          { userId: { $exists: true, $ne: null } },
          { researchEntityId: { $exists: true, $ne: null } },
        ],
      },
    },
    {
      $group: {
        _id: {
          owner: { $ifNull: ['$researchEntityId', '$userId'] },
          value: `$${field}`,
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $count: 'count' },
  ]);
  return rows[0]?.count || 0;
};

const countDuplicateLoserRows = async (field: string): Promise<number> => {
  const rows = await ResearchScholarlyLink.aggregate([
    {
      $match: {
        ...activeScholarlyLinkFilter,
        [field]: { $exists: true, $nin: [null, ''] },
        $or: [
          { userId: { $exists: true, $ne: null } },
          { researchEntityId: { $exists: true, $ne: null } },
        ],
      },
    },
    {
      $group: {
        _id: {
          owner: { $ifNull: ['$researchEntityId', '$userId'] },
          value: `$${field}`,
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    {
      $group: {
        _id: null,
        count: { $sum: { $subtract: ['$count', 1] } },
      },
    },
  ]);
  return rows[0]?.count || 0;
};

export async function buildPaperQualityDuplicateGroupSamples(
  field: DuplicateGroupField,
  sampleLimit: number,
) {
  const groups = await ResearchScholarlyLink.aggregate([
    {
      $match: {
        ...activeScholarlyLinkFilter,
        [field]: { $exists: true, $nin: [null, ''] },
        $or: [
          { userId: { $exists: true, $ne: null } },
          { researchEntityId: { $exists: true, $ne: null } },
        ],
      },
    },
    { $sort: { confidence: -1, observedAt: -1, updatedAt: -1, _id: 1 } },
    {
      $group: {
        _id: {
          owner: { $ifNull: ['$researchEntityId', '$userId'] },
          value: `$${field}`,
        },
        count: { $sum: 1 },
        links: {
          $push: {
            _id: '$_id',
            title: '$title',
            url: '$url',
            sourceUrl: '$sourceUrl',
            displaySource: '$displaySource',
            year: '$year',
            externalIds: '$externalIds',
            confidence: '$confidence',
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: sampleLimit },
  ]);

  return groups.map((group: any) => ({
    ownerId: String(group._id?.owner || ''),
    field,
    value: String(group._id?.value || ''),
    count: Number(group.count) || 0,
    links: (Array.isArray(group.links) ? group.links : []).map((link: any) => ({
      id: String(link._id || ''),
      title: String(link.title || ''),
      ...(link.url ? { url: String(link.url) } : {}),
      ...(link.sourceUrl ? { sourceUrl: String(link.sourceUrl) } : {}),
      ...(link.displaySource ? { displaySource: String(link.displaySource) } : {}),
      ...(link.year ? { year: link.year } : {}),
      ...(link.externalIds ? { externalIds: link.externalIds } : {}),
      ...(link.confidence !== undefined ? { confidence: link.confidence } : {}),
    })),
  }));
}

const qualityFailureTotal = (counts: PaperQualityCounts): number =>
  counts.missingTitle +
  counts.genericTitle +
  counts.htmlTitle +
  counts.missingInspectableLink +
  counts.missingYearOrDate +
  counts.missingSourceLabel +
  counts.datasetLikeLinks +
  counts.duplicateOpenAlexGroups +
  counts.duplicateArxivGroups +
  counts.duplicateUrlGroups;

export function buildPaperQualityReportFromCounts(
  counts: PaperQualityCounts,
  samples?: Record<string, unknown[]>,
): PaperQualityReport {
  const total = counts.qualityFailureTotal ?? qualityFailureTotal(counts);
  const fixCommands: string[] = [];
  const duplicateOpenAlexLinksToSuppress =
    counts.duplicateOpenAlexLinksToSuppress ?? counts.duplicateOpenAlexGroups;
  const duplicateArxivLinksToSuppress =
    counts.duplicateArxivLinksToSuppress ?? counts.duplicateArxivGroups;
  const duplicateUrlLinksToSuppress =
    counts.duplicateUrlLinksToSuppress ?? counts.duplicateUrlGroups;
  const suppressionAuditPlannedChanges =
    counts.datasetLikeLinks +
    counts.htmlTitle +
    duplicateOpenAlexLinksToSuppress +
    duplicateArxivLinksToSuppress +
    duplicateUrlLinksToSuppress;

  if (counts.missingYearOrDate > 0 || counts.missingInspectableLink > 0) {
    fixCommands.push('Backfill scholarly link years and inspectable links from trusted source evidence.');
  }
  if (suppressionAuditPlannedChanges > 0) {
    fixCommands.unshift(
      betaCommand(
        `yarn --cwd server scholarly-links:suppression-audit --apply --max-apply=${suppressionAuditPlannedChanges} --confirm-scholarly-link-apply`,
      ),
    );
  }
  if (counts.missingTitle > 0 || counts.genericTitle > 0 || counts.htmlTitle > 0) {
    fixCommands.push('Repair scholarly link titles from trusted metadata sources; do not show HTML/generic titles.');
  }
  if (counts.missingInspectableLink > 0) {
    fixCommands.push('Suppress scholarly links without inspectable source links from student-facing activity.');
  }
  if (counts.missingSourceLabel > 0) {
    fixCommands.push('Backfill displaySource from scholarly link provenance before launch.');
  }

  return {
    generatedAt: new Date().toISOString(),
    pass: total === 0,
    counts: {
      ...counts,
      qualityFailureTotal: total,
    },
    warning: total > 0 ? 'Scholarly link quality launch blockers remain.' : '',
    fixCommands,
    ...(samples ? { samples } : {}),
  };
}

export async function buildPaperQualityAudit(sampleLimit = 20): Promise<PaperQualityReport> {
  const [
    totalActiveScholarlyLinks,
    missingTitle,
    genericTitle,
    htmlTitle,
    missingInspectableLink,
    missingYearOrDate,
    missingSourceLabel,
    datasetLikeLinks,
    duplicateOpenAlexGroups,
    duplicateArxivGroups,
    duplicateUrlGroups,
    duplicateOpenAlexLinksToSuppress,
    duplicateArxivLinksToSuppress,
    duplicateUrlLinksToSuppress,
  ] = await Promise.all([
    ResearchScholarlyLink.countDocuments(activeScholarlyLinkFilter),
    ResearchScholarlyLink.countDocuments({ ...activeScholarlyLinkFilter, ...missingTextFilter('title') }),
    ResearchScholarlyLink.countDocuments({
      ...activeScholarlyLinkFilter,
      title: /^(untitled|unknown|n\/a|no title|test paper)$/i,
    }),
    ResearchScholarlyLink.countDocuments({
      ...activeScholarlyLinkFilter,
      title: /<[^>]+>|&(?:amp|lt|gt|quot|nbsp|#39);/i,
    }),
    ResearchScholarlyLink.countDocuments({ ...activeScholarlyLinkFilter, ...missingInspectableLinkFilter }),
    ResearchScholarlyLink.countDocuments({ ...activeScholarlyLinkFilter, ...missingYearOrDateFilter }),
    ResearchScholarlyLink.countDocuments({
      ...activeScholarlyLinkFilter,
      ...missingTextFilter('displaySource'),
    }),
    ResearchScholarlyLink.countDocuments({
      ...activeScholarlyLinkFilter,
      $or: [
        { venue: /mendeley data|figshare|zenodo/i },
        { url: /doi\.org\/10\.17632\//i },
        { 'externalIds.doi': /^10\.17632\//i },
        { title: /^raw data\b/i },
        { title: /^data from\b/i },
        { title: /^figure\s+s?\d+\s+from\b/i },
        { title: /\b(dataset|data set|supplementary data)\b/i },
      ],
    }),
    countDuplicateGroups('externalIds.openAlexId'),
    countDuplicateGroups('externalIds.arxivId'),
    countDuplicateGroups('url'),
    countDuplicateLoserRows('externalIds.openAlexId'),
    countDuplicateLoserRows('externalIds.arxivId'),
    countDuplicateLoserRows('url'),
  ]);

  const samples =
    sampleLimit > 0
      ? {
          missingInspectableLink: await ResearchScholarlyLink.find({
            ...activeScholarlyLinkFilter,
            ...missingInspectableLinkFilter,
          })
            .select('_id title url sourceUrl destinationKind displaySource externalIds year discoveredVia')
            .limit(sampleLimit)
            .lean(),
          missingYearOrDate: await ResearchScholarlyLink.find({
            ...activeScholarlyLinkFilter,
            ...missingYearOrDateFilter,
          })
            .select('_id title url sourceUrl externalIds year observedAt displaySource discoveredVia')
            .limit(sampleLimit)
            .lean(),
          titleQuality: await ResearchScholarlyLink.find({
            ...activeScholarlyLinkFilter,
            $or: [
              missingTextFilter('title'),
              { title: /^(untitled|unknown|n\/a|no title|test paper)$/i },
              { title: /<[^>]+>|&(?:amp|lt|gt|quot|nbsp|#39);/i },
            ],
          })
            .select('_id title url sourceUrl externalIds displaySource discoveredVia')
            .limit(sampleLimit)
            .lean(),
          datasetLikeLinks: await ResearchScholarlyLink.find({
            ...activeScholarlyLinkFilter,
            $or: [
              { venue: /mendeley data|figshare|zenodo/i },
              { url: /doi\.org\/10\.17632\//i },
              { 'externalIds.doi': /^10\.17632\//i },
              { title: /^raw data\b/i },
              { title: /^data from\b/i },
              { title: /^figure\s+s?\d+\s+from\b/i },
              { title: /\b(dataset|data set|supplementary data)\b/i },
            ],
          })
            .select('_id title url sourceUrl externalIds year venue displaySource discoveredVia')
            .limit(sampleLimit)
            .lean(),
          duplicateOpenAlexGroups: await buildPaperQualityDuplicateGroupSamples(
            'externalIds.openAlexId',
            sampleLimit,
          ),
          duplicateArxivGroups: await buildPaperQualityDuplicateGroupSamples(
            'externalIds.arxivId',
            sampleLimit,
          ),
          duplicateUrlGroups: await buildPaperQualityDuplicateGroupSamples('url', sampleLimit),
        }
      : undefined;

  return buildPaperQualityReportFromCounts(
    {
      totalActiveScholarlyLinks,
      missingTitle,
      genericTitle,
      htmlTitle,
      missingInspectableLink,
      missingYearOrDate,
      missingSourceLabel,
      datasetLikeLinks,
      duplicateOpenAlexGroups,
      duplicateOpenAlexLinksToSuppress,
      duplicateArxivGroups,
      duplicateArxivLinksToSuppress,
      duplicateUrlGroups,
      duplicateUrlLinksToSuppress,
    },
    samples,
  );
}
