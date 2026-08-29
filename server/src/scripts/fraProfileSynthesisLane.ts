/**
 * The per-entity body of the FRA profile-synthesis lane, extracted from the CLI
 * so the integration test drives the same skip order, write path, and
 * materialize pass the CLI does instead of a hand-copied transcription of them.
 */
import { Observation } from '../models/observation';
import { appendObservations } from '../scrapers/observationStore';
import {
  synthesizeCoverageDescription,
  type CoverageSynthesisLLMFn,
} from '../scrapers/coverageSynthesis';
import { materializeEntity, materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import {
  fullDescriptionObservationFilter,
  type FullDescriptionObservationLike,
} from './grantCorpusSynthesisCore';
import { fullDescriptionQuality } from '../utils/researchEntityDescriptionQuality';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
  MIN_SNIPPETS_TO_SYNTHESIZE,
  hasResidualPronounLead,
  isBioShapedFacultyDescription,
  profileResearchSnippets,
  repairPronounLead,
} from './fraProfileSynthesisCore';

export const FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS =
  'slug name entityType archived researchAreas fullDescription sourceUrls manuallyLockedFields';

export const FRA_PROFILE_SYNTHESIS_ENTITY_TYPE = 'FACULTY_RESEARCH_AREA';

export interface FraProfileSynthesisEntity {
  _id?: unknown;
  slug?: unknown;
  name?: unknown;
  entityType?: unknown;
  archived?: unknown;
  researchAreas?: unknown;
  fullDescription?: unknown;
  sourceUrls?: unknown;
  manuallyLockedFields?: unknown;
}

export interface FraProfileSynthesisEntityReport {
  slug: string;
  snippets: number;
  synthesized: boolean;
  written: boolean;
  description?: string;
  sourceUrl?: string;
  skipped?: string;
}

export interface FraProfileSynthesisStep {
  entity: FraProfileSynthesisEntity;
  profileUrl: string;
  callLLM: CoverageSynthesisLLMFn;
  fetchProfileText: (url: string) => Promise<string>;
  apply: boolean;
  runId: string;
  sourceId?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function profileUrlOf(sourceUrls: unknown): string {
  return (
    (Array.isArray(sourceUrls) ? sourceUrls : []).find(
      (url): url is string => typeof url === 'string' && /\/profile\//i.test(url),
    ) ?? ''
  );
}

function isFullDescriptionLocked(entity: FraProfileSynthesisEntity): boolean {
  return (
    Array.isArray(entity.manuallyLockedFields) &&
    entity.manuallyLockedFields.includes('fullDescription')
  );
}

/**
 * The cohort declared by the seed source and the coverage registry: live
 * FACULTY_RESEARCH_AREA entities only. Checked here rather than only in the CLI's
 * default query because the faculty-directory scrapers mint a LAB from the same
 * profile page and stamp the same biography on it, so a `--slug` pointing at one
 * of those (or at an archived entity) would otherwise be written to.
 */
export function isFraProfileSynthesisScopedEntity(entity: FraProfileSynthesisEntity): boolean {
  return entity.entityType === FRA_PROFILE_SYNTHESIS_ENTITY_TYPE && entity.archived !== true;
}

/**
 * Only entities currently serving a biography are in scope. A FRA whose
 * description already reads as research is left alone: the A/B that justified
 * this lane measured the bio-shaped cohort only, and rewriting good descriptions
 * is the churn-without-benefit mistake #2183 recorded.
 */
export function selectFraProfileSynthesisTargets<T extends FraProfileSynthesisEntity>(
  entities: T[],
): T[] {
  return entities.filter(
    (entity) =>
      isFraProfileSynthesisScopedEntity(entity) &&
      !isFullDescriptionLocked(entity) &&
      isBioShapedFacultyDescription(entity.fullDescription) &&
      profileUrlOf(entity.sourceUrls),
  );
}

/**
 * A recorded non-bio research description already beats this lane on the
 * author's own ranking, so spending a fetch and an LLM call to append an
 * observation that must lose is waste. Mirrors the grant-corpus lane's
 * better-sourced skip, restricted to non-bio values because the bio-shaped
 * cohort is exactly what this lane targets.
 */
export async function entityHasNonBioSourcedDescription(
  entity: FraProfileSynthesisEntity,
): Promise<boolean> {
  const observations = (await Observation.find(
    fullDescriptionObservationFilter({
      entityKey: typeof entity.slug === 'string' ? entity.slug : undefined,
      entityId: entity._id,
      readScope: materializationReadScopeFilter(),
    }),
  )
    .select('value sourceName')
    .lean()) as unknown as FullDescriptionObservationLike[];
  return observations.some(
    (observation) =>
      observation.sourceName !== FRA_PROFILE_SYNTHESIS_SOURCE_NAME &&
      !isBioShapedFacultyDescription(observation.value) &&
      fullDescriptionQuality(observation.value, entity.researchAreas, entity.entityType).isUseful,
  );
}

export async function runFraProfileSynthesisEntity(
  step: FraProfileSynthesisStep,
): Promise<FraProfileSynthesisEntityReport> {
  const { entity, profileUrl } = step;
  const slug = textValue(entity.slug);
  const report: FraProfileSynthesisEntityReport = {
    slug,
    snippets: 0,
    synthesized: false,
    written: false,
  };

  if (!isFraProfileSynthesisScopedEntity(entity)) {
    report.skipped = 'out-of-scope entity (not a live FACULTY_RESEARCH_AREA)';
    return report;
  }
  if (isFullDescriptionLocked(entity)) {
    report.skipped = 'fullDescription-locked';
    return report;
  }
  if (await entityHasNonBioSourcedDescription(entity)) {
    report.skipped = 'better-sourced-description';
    return report;
  }

  let pageText = '';
  try {
    pageText = await step.fetchProfileText(profileUrl);
  } catch {
    report.skipped = 'profile fetch failed';
    return report;
  }

  const snippets = profileResearchSnippets(pageText, profileUrl);
  report.snippets = snippets.length;
  if (snippets.length < MIN_SNIPPETS_TO_SYNTHESIZE) {
    report.skipped = `only ${snippets.length} research snippet(s) on the profile page`;
    return report;
  }

  const result = await synthesizeCoverageDescription({
    snippets,
    entityName: textValue(entity.name) || 'Research',
    entityType: entity.entityType,
    researchAreas: entity.researchAreas,
    callLLM: step.callLLM,
  });
  if (!result) {
    report.skipped = 'synthesizer failed closed (grounding or quality gate)';
    return report;
  }

  const description = repairPronounLead(result.description);
  // Fail closed rather than trade one biography for another: a synthesis that
  // still reads as a person bio is not an improvement on what we serve.
  if (!description || isBioShapedFacultyDescription(description)) {
    report.skipped = 'synthesized text still reads as a person biography';
    return report;
  }
  if (hasResidualPronounLead(description)) {
    report.skipped = 'synthesized text keeps a dangling pronoun subject';
    return report;
  }
  // The synthesizer's quality gate ran on the pre-repair text, and repair drops
  // words ("Her research focuses on X" -> "Focuses on X"), so a value that just
  // cleared the length floor can fall back under it here.
  if (!fullDescriptionQuality(description, entity.researchAreas, entity.entityType).isUseful) {
    report.skipped = 'repaired text no longer clears the description-quality bar';
    return report;
  }
  report.synthesized = true;
  report.description = description;
  report.sourceUrl = result.sourceUrls[0] ?? profileUrl;

  if (!step.apply || !step.sourceId) return report;

  await appendObservations(
    [
      {
        entityType: 'researchEntity',
        entityKey: slug,
        field: 'fullDescription',
        value: description,
        sourceUrl: report.sourceUrl,
        confidenceOverride: FRA_PROFILE_SYNTHESIS_CONFIDENCE,
      },
    ],
    {
      scrapeRunId: step.runId,
      sourceId: step.sourceId,
      sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
      sourceWeight: FRA_PROFILE_SYNTHESIS_CONFIDENCE,
      dryRun: false,
    },
  );
  await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: false });
  report.written = true;
  return report;
}
