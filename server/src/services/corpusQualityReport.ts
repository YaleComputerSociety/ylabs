import { ResearchEntity } from '../models/researchEntity';
import {
  buildResearchAreasCardSummary,
  describesResearchFocus,
} from '../utils/researchEntityDescriptionQuality';
import { buildResearchEntityPublicDescriptionRepresentation } from './researchEntityPublicDescription';
import {
  getResearchEntityRosterByEntityId,
  type ResearchEntityRosterEntry,
} from './researchEntityMembershipAccessor';
import { PUBLIC_LEAD_ROLES } from './researchGroupService';
import {
  buildCorpusQualityReport,
  type CorpusQualityCorpusCounts,
  type CorpusQualityReport,
  type CorpusQualityServedRowFacts,
} from './corpusQualityReportCore';

const SERVED_TIER = 'student_ready';
const ROSTER_BATCH_SIZE = 400;
const GENERIC_FACULTY_RESEARCH_TITLE = /\sFaculty Research$/;

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const leadSentence = (value: unknown): string => {
  const text = textValue(value);
  if (!text) return '';
  const [first] = text.split(/(?<=[.!?])\s+/);
  return first || text;
};

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const researchAreaList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry) => textValue(entry).length > 0) : [];

export const publicLeadMemberNames = (roster: readonly ResearchEntityRosterEntry[]): string[] =>
  roster
    .filter((entry) => PUBLIC_LEAD_ROLES.has(textValue(entry.role).toLowerCase()))
    .map((entry) => textValue(entry.name))
    .filter((name) => name.length > 0);

export function servedRowFacts(
  entity: Record<string, any>,
  leadMemberNames: string[],
): CorpusQualityServedRowFacts {
  // Judge the representation, never the stored document. The representation is
  // what the detail route serves: it resolves the roster, rewrites
  // self-referential copy, strips body chrome and derives a card description, so
  // a metric read off stored fields describes copy no student sees (#2671).
  const representation = buildResearchEntityPublicDescriptionRepresentation({
    entity,
    leadMemberNames,
  });
  const served = representation.entity;
  const researchAreas = researchAreaList(served.researchAreas);
  const shortDescription = textValue(served.shortDescription);
  const areaSummary = textValue(buildResearchAreasCardSummary(served.researchAreas));

  return {
    school: textValue(served.school),
    hasResearchHome: hasHttpUrl(served.websiteUrl) || hasHttpUrl(served.website),
    hasResearchArea: researchAreas.length > 0,
    hasSourceUrl: researchAreaList(served.sourceUrls).some(hasHttpUrl),
    researchAreaCount: researchAreas.length,
    fullDescriptionUseful: representation.quality.full.isUseful,
    shortDescriptionUseful: representation.quality.short.isUseful,
    leadSentenceStatesResearch: describesResearchFocus(
      leadSentence(representation.fullDescription || served.fullDescription),
    ),
    shortDescriptionIsAreaEchoOnly: shortDescription.length > 0 && shortDescription === areaSummary,
    nameIsGenericFacultyResearchTitle: GENERIC_FACULTY_RESEARCH_TITLE.test(textValue(served.name)),
    publicDescriptionInvariantPasses: representation.invariant.pass,
  };
}

export const readCorpusCoverageCounts = async (): Promise<CorpusQualityCorpusCounts> => {
  const [entities, archived, studentReady, byTier] = await Promise.all([
    ResearchEntity.countDocuments({}),
    ResearchEntity.countDocuments({ archived: true }),
    ResearchEntity.countDocuments({ studentVisibilityTier: SERVED_TIER, archived: { $ne: true } }),
    ResearchEntity.aggregate<{ tier: string; count: number }>([
      { $match: { archived: { $ne: true } } },
      { $group: { _id: '$studentVisibilityTier', count: { $sum: 1 } } },
      { $project: { _id: 0, tier: { $ifNull: ['$_id', 'unset'] }, count: 1 } },
      { $sort: { count: -1 } },
    ]),
  ]);
  return { entities, archived, studentReady, byTier };
};

export async function readCorpusQualityReport(
  generatedAt = new Date(),
): Promise<CorpusQualityReport> {
  const corpus = await readCorpusCoverageCounts();
  const servedRows = await ResearchEntity.find({
    studentVisibilityTier: SERVED_TIER,
    archived: { $ne: true },
  }).lean();

  const facts: CorpusQualityServedRowFacts[] = [];
  for (let offset = 0; offset < servedRows.length; offset += ROSTER_BATCH_SIZE) {
    const batch = servedRows.slice(offset, offset + ROSTER_BATCH_SIZE);
    const rosters = await getResearchEntityRosterByEntityId(batch.map((row: any) => row._id));
    for (const row of batch as any[]) {
      facts.push(servedRowFacts(row, publicLeadMemberNames(rosters.get(String(row._id)) || [])));
    }
  }

  return buildCorpusQualityReport({ facts, corpus, generatedAt });
}
