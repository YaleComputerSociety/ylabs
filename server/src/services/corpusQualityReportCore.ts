export interface CorpusQualityRatio {
  n: number;
  of: number;
}

export interface CorpusQualityServedRowFacts {
  school: string;
  hasResearchWebsite: boolean;
  hasTopic: boolean;
  hasSourceUrl: boolean;
  topicCount: number;
  fullDescriptionUseful: boolean;
  shortDescriptionUseful: boolean;
  leadSentenceStatesResearch: boolean;
  shortDescriptionIsAreaEchoOnly: boolean;
  nameIsGenericFacultyResearchTitle: boolean;
  publicDescriptionInvariantPasses: boolean;
}

export interface CorpusQualityCorpusCounts {
  entities: number;
  archived: number;
  studentReady: number;
  byTier: Array<{ tier: string; count: number }>;
}

export interface CorpusQualityReport {
  generatedAt: string;
  surface: string;
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
    fullDescriptionUseful: CorpusQualityRatio;
    shortDescriptionUseful: CorpusQualityRatio;
    leadSentenceStatesResearch: CorpusQualityRatio;
    shortDescriptionIsAreaEchoOnly: CorpusQualityRatio;
    nameIsGenericFacultyResearchTitle: CorpusQualityRatio;
  };
  integrity: {
    publicDescriptionInvariantFails: CorpusQualityRatio;
  };
}

export const CORPUS_QUALITY_SURFACE =
  'served student_ready rows, roster-resolved public description representation';

const UNKNOWN_SCHOOL = 'unknown';

const ratio = (n: number, of: number): CorpusQualityRatio => ({ n, of });

const countWhere = (
  facts: readonly CorpusQualityServedRowFacts[],
  predicate: (row: CorpusQualityServedRowFacts) => boolean,
): number => facts.reduce((total, row) => (predicate(row) ? total + 1 : total), 0);

const studentReadyBySchool = (
  facts: readonly CorpusQualityServedRowFacts[],
): Array<{ school: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const row of facts) {
    const school = row.school.trim() || UNKNOWN_SCHOOL;
    counts.set(school, (counts.get(school) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([school, count]) => ({ school, count }))
    .sort((left, right) => right.count - left.count || left.school.localeCompare(right.school));
};

export function buildCorpusQualityReport({
  facts,
  corpus,
  generatedAt = new Date(),
}: {
  facts: readonly CorpusQualityServedRowFacts[];
  corpus: CorpusQualityCorpusCounts;
  generatedAt?: Date;
}): CorpusQualityReport {
  const served = facts.length;
  return {
    generatedAt: generatedAt.toISOString(),
    surface: CORPUS_QUALITY_SURFACE,
    coverage: {
      entities: corpus.entities,
      archived: corpus.archived,
      studentReady: corpus.studentReady,
      byTier: corpus.byTier,
      studentReadyBySchool: studentReadyBySchool(facts),
    },
    richness: {
      hasResearchWebsite: ratio(
        countWhere(facts, (row) => row.hasResearchWebsite),
        served,
      ),
      hasTopic: ratio(
        countWhere(facts, (row) => row.hasTopic),
        served,
      ),
      hasSourceUrl: ratio(
        countWhere(facts, (row) => row.hasSourceUrl),
        served,
      ),
      topicTotal: ratio(
        facts.reduce((total, row) => total + row.topicCount, 0),
        served,
      ),
      noResearchWebsiteAndNoTopics: ratio(
        countWhere(facts, (row) => !row.hasResearchWebsite && !row.hasTopic),
        served,
      ),
    },
    description: {
      fullDescriptionUseful: ratio(
        countWhere(facts, (row) => row.fullDescriptionUseful),
        served,
      ),
      shortDescriptionUseful: ratio(
        countWhere(facts, (row) => row.shortDescriptionUseful),
        served,
      ),
      leadSentenceStatesResearch: ratio(
        countWhere(facts, (row) => row.leadSentenceStatesResearch),
        served,
      ),
      shortDescriptionIsAreaEchoOnly: ratio(
        countWhere(facts, (row) => row.shortDescriptionIsAreaEchoOnly),
        served,
      ),
      nameIsGenericFacultyResearchTitle: ratio(
        countWhere(facts, (row) => row.nameIsGenericFacultyResearchTitle),
        served,
      ),
    },
    integrity: {
      publicDescriptionInvariantFails: ratio(
        countWhere(facts, (row) => !row.publicDescriptionInvariantPasses),
        served,
      ),
    },
  };
}
