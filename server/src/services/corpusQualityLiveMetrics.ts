/**
 * The corpus metrics a single MongoDB aggregation can answer, computed on demand.
 *
 * Measured on 3,120 served Development rows: this returns byte-identical counts
 * to the roster-resolved representation pass for every metric it covers, in
 * ~150ms against ~13,000ms. So routing these through the representation bought
 * nothing and cost a live answer. The three metrics NOT here - lead sentence,
 * card-summary echo, and the public-description invariant - genuinely need the
 * representation and its quality rules, and stay snapshot-backed.
 *
 * If a future sanitizer starts rewriting `websiteUrl`, `name`, or
 * `researchAreas` at serve time, these counts would drift from the
 * representation. The snapshot keeps recording the representation-derived value
 * for the same metrics, so a divergence shows up as a disagreement between this
 * and the newest row rather than as a silently wrong number.
 */
import { ResearchEntity } from '../models/researchEntity';
import type { CorpusQualityRatio } from './corpusQualityReportCore';

const SERVED_TIER = 'student_ready';
const GENERIC_FACULTY_RESEARCH_TITLE = /\sFaculty Research$/;

export interface CorpusQualityLiveMetrics {
  computedAt: string;
  coverage: {
    entities: number;
    archived: number;
    studentReady: number;
    byTier: Array<{ tier: string; count: number }>;
    studentReadyBySchool: Array<{ school: string; count: number }>;
  };
  richness: {
    hasResearchWebsite: CorpusQualityRatio;
    hasTopic: CorpusQualityRatio;
    hasSourceUrl: CorpusQualityRatio;
    topicTotal: CorpusQualityRatio;
    noResearchWebsiteAndNoTopics: CorpusQualityRatio;
  };
  description: {
    nameIsGenericFacultyResearchTitle: CorpusQualityRatio;
  };
}

const hasText = (field: string) => ({ $gt: [{ $strLenCP: { $ifNull: [field, ''] } }, 0] });
const topicCount = { $size: { $ifNull: ['$researchAreas', []] } };
const sourceUrlCount = { $size: { $ifNull: ['$sourceUrls', []] } };
const countWhen = (condition: unknown) => ({ $sum: { $cond: [condition, 1, 0] } });

export async function readCorpusQualityLiveMetrics(
  computedAt = new Date(),
): Promise<CorpusQualityLiveMetrics> {
  const servedMatch = { studentVisibilityTier: SERVED_TIER, archived: { $ne: true } };
  const hasWebsite = { $or: [hasText('$websiteUrl'), hasText('$website')] };

  const [facet] = await ResearchEntity.aggregate([
    {
      $facet: {
        corpus: [
          {
            $group: {
              _id: null,
              entities: { $sum: 1 },
              archived: countWhen({ $eq: ['$archived', true] }),
            },
          },
        ],
        byTier: [
          { $match: { archived: { $ne: true } } },
          { $group: { _id: '$studentVisibilityTier', count: { $sum: 1 } } },
          { $project: { _id: 0, tier: { $ifNull: ['$_id', 'unset'] }, count: 1 } },
          { $sort: { count: -1 } },
        ],
        bySchool: [
          { $match: servedMatch },
          {
            $group: {
              _id: { $ifNull: ['$school', ''] },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ],
        served: [
          { $match: servedMatch },
          {
            $group: {
              _id: null,
              studentReady: { $sum: 1 },
              hasResearchWebsite: countWhen(hasWebsite),
              hasTopic: countWhen({ $gt: [topicCount, 0] }),
              hasSourceUrl: countWhen({ $gt: [sourceUrlCount, 0] }),
              topicTotal: { $sum: topicCount },
              noResearchWebsiteAndNoTopics: countWhen({
                $and: [{ $not: hasWebsite }, { $eq: [topicCount, 0] }],
              }),
              nameIsGenericFacultyResearchTitle: countWhen({
                $regexMatch: {
                  input: { $ifNull: ['$name', ''] },
                  regex: GENERIC_FACULTY_RESEARCH_TITLE,
                },
              }),
            },
          },
        ],
      },
    },
  ]);

  const corpus = facet?.corpus?.[0] || { entities: 0, archived: 0 };
  const served = facet?.served?.[0] || {
    studentReady: 0,
    hasResearchWebsite: 0,
    hasTopic: 0,
    hasSourceUrl: 0,
    topicTotal: 0,
    noResearchWebsiteAndNoTopics: 0,
    nameIsGenericFacultyResearchTitle: 0,
  };
  const of = served.studentReady;
  const ratio = (n: number): CorpusQualityRatio => ({ n, of });

  return {
    computedAt: computedAt.toISOString(),
    coverage: {
      entities: corpus.entities,
      archived: corpus.archived,
      studentReady: served.studentReady,
      byTier: (facet?.byTier || []) as Array<{ tier: string; count: number }>,
      studentReadyBySchool: ((facet?.bySchool || []) as Array<{ _id: string; count: number }>).map(
        (row) => ({ school: row._id.trim() || 'unknown', count: row.count }),
      ),
    },
    richness: {
      hasResearchWebsite: ratio(served.hasResearchWebsite),
      hasTopic: ratio(served.hasTopic),
      hasSourceUrl: ratio(served.hasSourceUrl),
      topicTotal: ratio(served.topicTotal),
      noResearchWebsiteAndNoTopics: ratio(served.noResearchWebsiteAndNoTopics),
    },
    description: {
      nameIsGenericFacultyResearchTitle: ratio(served.nameIsGenericFacultyResearchTitle),
    },
  };
}
