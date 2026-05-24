import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { Observation } from '../models/observation';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type Confidence = 'High' | 'Medium' | 'Low' | 'Unsupported';
type Recommendation =
  | 'keep'
  | 'remove'
  | 'search-only-internal-context'
  | 'convert-to-suggestion'
  | 'needs-more-data';

interface FilterAuditRow {
  filter: string;
  status: string;
  source: string;
  coverageCount: number;
  coveragePercent: number;
  matchingResults: number;
  confidence: Confidence;
  recommendation: Recommendation;
  examples: string[];
  falsePositiveRisk: string;
  falseNegativeRisk: string;
}

const activeEntityMatch = { archived: { $ne: true } };
const activeArtifactMatch = { archived: { $ne: true } };

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

function textRegex(words: string[]): RegExp {
  return new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function entityText(entity: Record<string, unknown>): string {
  return [
    entity.name,
    entity.displayName,
    entity.shortDescription,
    entity.description,
    entity.fullDescription,
    entity.school,
    ...asArray(entity.schools),
    ...asArray(entity.departments),
    ...asArray(entity.researchAreas),
    ...asArray(entity.sourceUrls),
  ]
    .filter(Boolean)
    .join(' ');
}

async function sampleEntityNames(match: Record<string, unknown>, limit = 5): Promise<string[]> {
  const docs = await ResearchEntity.find({ ...activeEntityMatch, ...match })
    .select('name displayName')
    .limit(limit)
    .lean();
  return docs.map((doc: any) => doc.displayName || doc.name).filter(Boolean);
}

async function sampleEntityNamesByIds(ids: unknown[], limit = 5): Promise<string[]> {
  const cleanIds = ids.filter(Boolean).slice(0, limit * 4);
  const docs = await ResearchEntity.find({ _id: { $in: cleanIds }, ...activeEntityMatch })
    .select('name displayName')
    .limit(limit)
    .lean();
  return docs.map((doc: any) => doc.displayName || doc.name).filter(Boolean);
}

async function countEntityField(predicate: (entity: Record<string, unknown>) => boolean) {
  const cursor = ResearchEntity.find(activeEntityMatch)
    .select(
      'name displayName school schools departments researchAreas website websiteUrl contactEmail shortDescription description fullDescription sourceUrls acceptingUndergrads offersIndependentStudy currentUndergradCount fundingPrograms creditOptions typicalUndergradRoles recentPaperCount lastPaperAtCache',
    )
    .lean()
    .cursor();
  let count = 0;
  const examples: string[] = [];
  for await (const entity of cursor as AsyncIterable<Record<string, unknown>>) {
    if (!predicate(entity)) continue;
    count += 1;
    if (examples.length < 5) {
      examples.push(String(entity.displayName || entity.name || 'Untitled'));
    }
  }
  return { count, examples };
}

async function distinctEntityCount(model: mongoose.Model<any>, match: Record<string, unknown>) {
  const ids = await model.distinct('researchEntityId', {
    ...activeArtifactMatch,
    ...match,
    researchEntityId: { $exists: true, $ne: null },
  });
  return {
    count: ids.length,
    examples: await sampleEntityNamesByIds(ids),
  };
}

function row(input: Omit<FilterAuditRow, 'coveragePercent'>, total: number): FilterAuditRow {
  return {
    ...input,
    coveragePercent: pct(input.coverageCount, total),
  };
}

async function main() {
  await initializeConnections();
  const total = await ResearchEntity.countDocuments(activeEntityMatch);
  const allEntities = await ResearchEntity.find(activeEntityMatch)
    .select(
      'name displayName school schools departments researchAreas website websiteUrl contactEmail shortDescription description fullDescription sourceUrls recentPaperCount lastPaperAtCache',
    )
    .lean();

  const keywordCount = async (label: string, words: string[]) => {
    const re = textRegex(words);
    const matches = allEntities.filter((entity: any) => re.test(entityText(entity)));
    return {
      label,
      count: matches.length,
      examples: matches
        .slice(0, 5)
        .map((entity: any) => entity.displayName || entity.name)
        .filter(Boolean),
    };
  };

  const departments = await countEntityField((entity) => asArray(entity.departments).length > 0);
  const school = await countEntityField(
    (entity) => Boolean(String(entity.school || '').trim()) || asArray(entity.schools).length > 0,
  );
  const researchAreas = await countEntityField((entity) => asArray(entity.researchAreas).length > 0);
  const website = await countEntityField(
    (entity) => Boolean(String(entity.websiteUrl || entity.website || '').trim()),
  );
  const contactEmail = await countEntityField(
    (entity) => Boolean(String(entity.contactEmail || '').trim()),
  );
  const professorName = await distinctEntityCount(ContactRoute, {
    routeType: 'FACULTY_PI',
  });
  const recentPubs = await countEntityField(
    (entity) =>
      Number(entity.recentPaperCount || 0) > 0 ||
      Boolean(entity.lastPaperAtCache),
  );
  const openPosted = await distinctEntityCount(PostedOpportunity, {
    status: { $in: ['OPEN', 'ROLLING'] },
  });
  const openSignals = await distinctEntityCount(AccessSignal, {
    signalType: { $in: ['POSTED_OPENING', 'APPLICATION_FORM_EXISTS'] },
  });
  const openListings = { count: 0, examples: [] as string[] };
  const paidPathways = await distinctEntityCount(EntryPathway, {
    compensation: { $in: ['PAID', 'STIPEND', 'WORK_STUDY', 'FELLOWSHIP', 'FELLOWSHIP_ELIGIBLE'] },
  });
  const paidListings = { count: 0, examples: [] as string[] };
  const acceptsUndergrads = await distinctEntityCount(AccessSignal, {
    signalType: { $in: ['CURRENT_UNDERGRADS', 'PAST_UNDERGRADS', 'REACH_OUT_PLAUSIBLE'] },
  });
  const priorExperience = await Observation.distinct('entityId', {
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    superseded: false,
    field: { $in: ['undergradConstraintQuote', 'contactInstructionsQuote'] },
    value: /experience|prior|previous|required|must have|eligib/i,
  });
  const priorExperienceExamples = await sampleEntityNamesByIds(priorExperience);

  const keywordDefinitions: Array<[string, string[]]> = [
    ['Method', ['method', 'methods', 'assay', 'sequencing', 'survey', 'interview', 'modeling', 'analysis']],
    ['Wet lab', ['wet lab', 'molecular biology', 'cell biology', 'cellular', 'assay', 'mouse model', 'in vitro']],
    ['Clinical research', ['clinical trial', 'clinical research', 'patient', 'patients', 'translational']],
    ['Computational/data', ['computational', 'data science', 'statistical', 'quantitative', 'bioinformatics', 'modeling']],
    ['Machine learning/AI', ['machine learning', 'artificial intelligence', 'deep learning', 'neural network']],
    ['Public health', ['public health', 'epidemiology', 'population health']],
    ['Neuroscience', ['neuroscience', 'neural', 'brain', 'cognitive']],
    ['Psychology', ['psychology', 'psychological', 'cognition', 'behavioral']],
    ['Economics/policy', ['economics', 'policy', 'political economy', 'governance']],
    ['Environment/climate', ['environment', 'climate', 'sustainability', 'ecology']],
    ['Summer', ['summer']],
    ['Beginner-friendly', ['beginner', 'no prior experience', 'no experience necessary', 'first year', 'first-year']],
    ['Thesis-friendly', ['senior thesis', 'thesis', 'senior essay', 'senior project']],
  ];
  const keywordAudits = Object.fromEntries(
    await Promise.all(
      keywordDefinitions.map(async ([label, words]) => [label, await keywordCount(label, words)]),
    ),
  ) as Record<string, { label: string; count: number; examples: string[] }>;

  const rows: FilterAuditRow[] = [
    row({
      filter: 'Department',
      status: 'Supported',
      source: 'research_entities.departments from Yale directory, department rosters, indexes, and manual/profile data',
      coverageCount: departments.count,
      matchingResults: departments.count,
      confidence: 'High',
      recommendation: 'keep',
      examples: departments.examples,
      falsePositiveRisk: 'Some legacy department strings are school/index labels rather than canonical departments.',
      falseNegativeRisk: 'Sparse entities and centers may have no department even when a Yale affiliation exists.',
    }, total),
    row({
      filter: 'School',
      status: 'Weakly supported',
      source: 'research_entities.school/schools',
      coverageCount: school.count,
      matchingResults: school.count,
      confidence: 'Medium',
      recommendation: 'search-only-internal-context',
      examples: school.examples,
      falsePositiveRisk: 'Schools may be inferred from index source or department context, not explicitly owned by the lab.',
      falseNegativeRisk: 'Many entities only have departments, not school.',
    }, total),
    row({
      filter: 'Research area/topic',
      status: 'Partly supported',
      source: 'research_entities.researchAreas; often LLM/profile/publication-derived',
      coverageCount: researchAreas.count,
      matchingResults: researchAreas.count,
      confidence: 'Medium',
      recommendation: 'search-only-internal-context',
      examples: researchAreas.examples,
      falsePositiveRisk: 'Some labels are generated from descriptions/profile terms and can be broad.',
      falseNegativeRisk: 'Many real topics are missing when descriptions are sparse.',
    }, total),
    ...[
      'Method',
      'Wet lab',
      'Clinical research',
      'Computational/data',
      'Machine learning/AI',
      'Public health',
      'Neuroscience',
      'Psychology',
      'Economics/policy',
      'Environment/climate',
    ].map((filterName) => {
      const audit = keywordAudits[filterName];
      return row({
        filter: filterName,
        status: 'Keyword/topic inferred only',
        source: 'Keyword match over entity names, descriptions, departments, researchAreas, schools, and source URLs',
        coverageCount: audit.count,
        matchingResults: audit.count,
        confidence: filterName === 'Method' ? 'Low' : 'Medium',
        recommendation: 'search-only-internal-context',
        examples: audit.examples,
        falsePositiveRisk: 'Keyword mentions may describe a collaborator, publication, or broad field rather than the student role.',
        falseNegativeRisk: 'Labs using different vocabulary will be missed.',
      }, total);
    }),
    row({
      filter: 'Open roles',
      status: 'Not safe as a broad filter',
      source: 'posted_opportunities OPEN/ROLLING and access_signals POSTED_OPENING/APPLICATION_FORM_EXISTS',
      coverageCount: Math.max(openPosted.count, openSignals.count, openListings.count),
      matchingResults: openPosted.count,
      confidence: openPosted.count > 0 ? 'Low' : 'Unsupported',
      recommendation: 'remove',
      examples: [...new Set([...openPosted.examples, ...openSignals.examples, ...openListings.examples])].slice(0, 5),
      falsePositiveRisk: 'Inferred application pages may not be undergraduate openings.',
      falseNegativeRisk: 'The scraper does not comprehensively crawl opportunity pages across Yale.',
    }, total),
    row({
      filter: 'Paid/funded',
      status: 'Not safe as lab filter',
      source: 'entry_pathways.compensation',
      coverageCount: Math.max(paidPathways.count, paidListings.count),
      matchingResults: paidPathways.count,
      confidence: paidPathways.count > 0 ? 'Low' : 'Unsupported',
      recommendation: 'remove',
      examples: [...new Set([...paidPathways.examples, ...paidListings.examples])].slice(0, 5),
      falsePositiveRisk: 'Funding/grants prove lab funding, not paid undergraduate availability; fellowship compatibility is not a paid role.',
      falseNegativeRisk: 'Actual paid jobs may exist outside scraped pages.',
    }, total),
    ...['Summer', 'Beginner-friendly', 'Thesis-friendly'].map((filterName) => {
      const audit = keywordAudits[filterName];
      return row({
        filter: filterName,
        status: filterName === 'Beginner-friendly' ? 'Unsupported' : 'Keyword-only',
        source: 'Keyword search only; no durable explicit V1 field',
        coverageCount: audit.count,
        matchingResults: audit.count,
        confidence: filterName === 'Beginner-friendly' ? 'Unsupported' : 'Low',
        recommendation: 'remove',
        examples: audit.examples,
        falsePositiveRisk: 'A text mention does not prove current eligibility or student fit.',
        falseNegativeRisk: 'Real routes may not use this exact language.',
      }, total);
    }),
    row({
      filter: 'Accepts undergrads',
      status: 'Evidence exists but should not be a hard filter yet',
      source: 'access_signals CURRENT_UNDERGRADS, PAST_UNDERGRADS, REACH_OUT_PLAUSIBLE; legacy acceptingUndergrads',
      coverageCount: acceptsUndergrads.count,
      matchingResults: acceptsUndergrads.count,
      confidence: 'Low',
      recommendation: 'search-only-internal-context',
      examples: acceptsUndergrads.examples,
      falsePositiveRisk: 'Past/current undergrads suggest plausibility, not current acceptance.',
      falseNegativeRisk: 'Many labs accept students without saying so publicly.',
    }, total),
    row({
      filter: 'Requires prior experience',
      status: 'Unsupported as filter',
      source: 'Sparse quote keyword match in observations',
      coverageCount: priorExperience.length,
      matchingResults: priorExperience.length,
      confidence: 'Unsupported',
      recommendation: 'remove',
      examples: priorExperienceExamples,
      falsePositiveRisk: 'Requirements may apply to graduate applicants, jobs, or courses rather than undergrad research.',
      falseNegativeRisk: 'Most pages do not state prerequisites.',
    }, total),
    row({
      filter: 'Professor name',
      status: 'Supported through search, not facet',
      source: 'faculty_members, research group members, contact routes, and text search',
      coverageCount: professorName.count,
      matchingResults: professorName.count,
      confidence: 'High',
      recommendation: 'keep',
      examples: professorName.examples,
      falsePositiveRisk: 'Name collisions and stale memberships are possible.',
      falseNegativeRisk: 'Sparse centers/programs may not have a single PI contact.',
    }, total),
    row({
      filter: 'Recent publications',
      status: 'Supported as ranking/context, not student-fit filter',
      source: 'papers plus research_entities.recentPaperCount/lastPaperAtCache',
      coverageCount: recentPubs.count,
      matchingResults: recentPubs.count,
      confidence: 'Medium',
      recommendation: 'search-only-internal-context',
      examples: recentPubs.examples,
      falsePositiveRisk: 'Publications prove scholarly activity, not undergraduate access.',
      falseNegativeRisk: 'Humanities/arts outputs and non-paper projects are undercounted.',
    }, total),
    row({
      filter: 'Lab website exists',
      status: 'Supported',
      source: 'research_entities.websiteUrl/website',
      coverageCount: website.count,
      matchingResults: website.count,
      confidence: 'High',
      recommendation: 'keep',
      examples: website.examples,
      falsePositiveRisk: 'Some URLs are generic department/profile URLs rather than lab sites.',
      falseNegativeRisk: 'Some valid sites are missing or filtered as generic.',
    }, total),
    row({
      filter: 'Contact email exists',
      status: 'Do not expose as public filter',
      source: 'research_entities.contactEmail and guarded contact_routes.email',
      coverageCount: contactEmail.count,
      matchingResults: contactEmail.count,
      confidence: 'Medium',
      recommendation: 'remove',
      examples: contactEmail.examples,
      falsePositiveRisk: 'A found email is not permission to contact; visibility policy may require authentication.',
      falseNegativeRisk: 'Official contact forms/routes may exist without an email.',
    }, total),
  ];

  const summary = {
    generatedAt: new Date().toISOString(),
    totalResearchEntities: total,
    totalFacultyMembers: 0,
    totalPapers: 0,
    totalEntryPathways: await EntryPathway.countDocuments(activeArtifactMatch),
    totalAccessSignals: await AccessSignal.countDocuments(activeArtifactMatch),
    totalPostedOpportunities: await PostedOpportunity.countDocuments(activeArtifactMatch),
    totalContactRoutes: await ContactRoute.countDocuments(activeArtifactMatch),
    rows,
  };

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
