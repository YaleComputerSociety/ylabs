import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';

export interface ScholarlyActivityAuditCounts {
  activeScholarlyLinks: number;
  entityLinkedScholarlyLinks: number;
  userLinkedScholarlyLinks: number;
  activeAttributions: number;
  nullTargetAttributions: number;
  orphanAttributions: number;
  activeLinksWithoutOwner: number;
  qualityFailureTotal?: number;
}

export interface ScholarlyActivityAuditReport {
  generatedAt: string;
  pass: boolean;
  counts: ScholarlyActivityAuditCounts & { qualityFailureTotal: number };
  warning: string;
  fixCommand: string;
}

const BETA_COMMAND_PREFIX = 'SCRAPER_ENV=beta ';

function betaCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return command;
  if (trimmed.startsWith(BETA_COMMAND_PREFIX)) return command;
  return `${BETA_COMMAND_PREFIX}${command}`;
}

const countOrphanAttributions = async (): Promise<number> => {
  const rows = await ResearchScholarlyAttribution.aggregate([
    { $match: { archived: { $ne: true } } },
    {
      $lookup: {
        from: 'research_scholarly_links',
        localField: 'scholarlyLinkId',
        foreignField: '_id',
        as: 'link',
      },
    },
    { $match: { link: { $eq: [] } } },
    { $count: 'count' },
  ]);
  return Number(rows[0]?.count || 0);
};

export function buildScholarlyActivityAuditReportFromCounts(
  counts: ScholarlyActivityAuditCounts,
): ScholarlyActivityAuditReport {
  const qualityFailureTotal =
    counts.qualityFailureTotal ??
    counts.nullTargetAttributions +
      counts.orphanAttributions +
      counts.activeLinksWithoutOwner;

  return {
    generatedAt: new Date().toISOString(),
    pass: qualityFailureTotal === 0,
    counts: {
      ...counts,
      qualityFailureTotal,
    },
    warning:
      qualityFailureTotal > 0
        ? 'Scholarly activity provenance blockers remain.'
        : '',
    fixCommand:
      qualityFailureTotal > 0
        ? betaCommand(
            `yarn --cwd server scholarly-links:provenance-audit --apply --max-apply=${qualityFailureTotal} --confirm-scholarly-link-apply`,
          )
        : '',
  };
}

export async function buildScholarlyActivityAudit(): Promise<ScholarlyActivityAuditReport> {
  const [
    activeScholarlyLinks,
    entityLinkedScholarlyLinks,
    userLinkedScholarlyLinks,
    activeAttributions,
    nullTargetAttributions,
    orphanAttributions,
    activeLinksWithoutOwner,
  ] = await Promise.all([
    ResearchScholarlyLink.countDocuments({ archived: { $ne: true } }),
    ResearchScholarlyLink.countDocuments({
      archived: { $ne: true },
      researchEntityId: { $exists: true, $ne: null },
    }),
    ResearchScholarlyLink.countDocuments({
      archived: { $ne: true },
      userId: { $exists: true, $ne: null },
    }),
    ResearchScholarlyAttribution.countDocuments({ archived: { $ne: true } }),
    ResearchScholarlyAttribution.countDocuments({
      archived: { $ne: true },
      $or: [{ targetUserId: { $exists: false } }, { targetUserId: null }],
    }),
    countOrphanAttributions(),
    ResearchScholarlyLink.countDocuments({
      archived: { $ne: true },
      $and: [
        { $or: [{ userId: { $exists: false } }, { userId: null }] },
        { $or: [{ researchEntityId: { $exists: false } }, { researchEntityId: null }] },
      ],
    }),
  ]);

  return buildScholarlyActivityAuditReportFromCounts({
    activeScholarlyLinks,
    entityLinkedScholarlyLinks,
    userLinkedScholarlyLinks,
    activeAttributions,
    nullTargetAttributions,
    orphanAttributions,
    activeLinksWithoutOwner,
  });
}
