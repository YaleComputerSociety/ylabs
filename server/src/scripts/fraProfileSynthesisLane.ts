/**
 * The per-entity body of the FRA profile-synthesis lane, extracted from the CLI
 * so the integration test drives the same skip order, write path, and
 * materialize pass the CLI does instead of a hand-copied transcription of them.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { appendObservations } from '../scrapers/observationStore';
import {
  synthesizeCoverageDescription,
  type CoverageSynthesisLLMFn,
} from '../scrapers/coverageSynthesis';
import { materializeEntity, materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import {
  fullDescriptionObservationFilter,
  type FullDescriptionObservationLike,
} from './grantCorpusSynthesisCore';
import {
  describesResearchFocus,
  fullDescriptionQuality,
} from '../utils/researchEntityDescriptionQuality';
import { sanitizeServedResearchEntityCopyFields } from '../utils/researchEntityDescriptionText';
import {
  FRA_PROFILE_SYNTHESIS_CONFIDENCE,
  FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
  MIN_SNIPPETS_TO_SYNTHESIZE,
  hasResidualPronounLead,
  isBioShapedFacultyDescription,
  isCareerBiographyDescription,
  PROFILE_FETCH_FAILED_NOTE,
  profilePageProgressRank,
  profileResearchSnippets,
  repairPronounLead,
  selectFraProfileUrl,
  selectLeadProfileUrls,
  type FraProfileSynthesisLead,
} from './fraProfileSynthesisCore';

export const FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS =
  'slug name displayName entityType kind archived researchAreas fullDescription sourceUrls manuallyLockedFields';

export const FRA_PROFILE_SYNTHESIS_ENTITY_TYPE = 'FACULTY_RESEARCH_AREA';

export interface FraProfileSynthesisEntity {
  _id?: unknown;
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  leads?: readonly FraProfileSynthesisLead[];
  entityType?: unknown;
  kind?: unknown;
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
  adopted?: boolean;
  description?: string;
  sourceUrl?: string;
  skipped?: string;
}

export interface FraProfileSynthesisStep {
  entity: FraProfileSynthesisEntity;
  profileUrls: readonly string[];
  callLLM: CoverageSynthesisLLMFn;
  fetchProfileText: (url: string) => Promise<string>;
  apply: boolean;
  runId: string;
  sourceId?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/**
 * `Observation.scrapeRunId` is an ObjectId and `appendObservations` inserts with
 * `{ ordered: false }`, so a run id that cannot be cast is dropped without
 * throwing: the lane reported `written` and printed OK while persisting nothing
 * and leaving the biography served (#2200). Owned here rather than composed in
 * the CLI so the integration test drives the same run id an `--apply` run does.
 */
export function newFraProfileSynthesisRunId(): string {
  return new mongoose.Types.ObjectId().toString();
}

/**
 * Candidate people a cited person page may name for this entity, lead first.
 *
 * A lead's own display name is the better authority and the only one that carries
 * an initial or a formal given name the row's title drops, while the row's name and
 * displayName still reach an entity whose lead is unresolved. Same ranking and same
 * reasons as `candidatePersonNames` in the citation-repair lane.
 */
function candidateProfilePersonNames(entity: FraProfileSynthesisEntity): string[] {
  const leads = Array.isArray(entity.leads) ? entity.leads : [];
  return [...leads.map((lead) => lead.name), entity.name, entity.displayName]
    .map((value) => textValue(value))
    .filter(Boolean);
}

/**
 * The profile pages this lane may read for one entity, best evidence first.
 *
 * The row's own citation leads because the row asserting a page is the stronger
 * claim that the page is about it. A resolved lead's off-record official profile
 * follows, since a departmental stub with no research prose is exactly the case
 * where the row's own citation is not enough (#1937) and the lead's page is the only
 * other official authority the corpus holds on that person.
 */
export function profileUrlsOf(entity: FraProfileSynthesisEntity): string[] {
  const citedProfileUrl = selectFraProfileUrl(
    entity.sourceUrls,
    candidateProfilePersonNames(entity),
  );
  return [
    ...(citedProfileUrl ? [citedProfileUrl] : []),
    ...selectLeadProfileUrls(entity.leads ?? [], entity.sourceUrls, [
      entity.displayName,
      entity.name,
    ]),
  ];
}

const IDENTIFIED_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

/**
 * Each entity's current leads with the identity a candidate profile page is judged
 * against, resolved in one batch query rather than per entity. A `HISTORICAL` entry
 * is excluded because a departed lead's name is not evidence about whose page a
 * citation is, which is the same selection the citation repair lane makes.
 *
 * An `UNAVAILABLE` profile link is dropped here rather than left for the fetch to
 * discover: the corpus has already probed that page and recorded it gone, and
 * spending a fetch to rediscover a known 404 is the waste `isKnownDeadSourceUrl`
 * avoids on the materializer's own projection of the same links.
 */
export async function fraProfileSynthesisLeads(
  entities: readonly FraProfileSynthesisEntity[],
): Promise<Map<string, FraProfileSynthesisLead[]>> {
  const rosterByEntityId = await getResearchEntityRosterByEntityId(
    entities.map((entity) => entity._id),
  );
  const leadsByEntityId = new Map<string, FraProfileSynthesisLead[]>();
  for (const [entityId, roster] of rosterByEntityId) {
    leadsByEntityId.set(
      entityId,
      roster
        .filter(
          (entry) =>
            entry.state !== 'HISTORICAL' &&
            IDENTIFIED_LEAD_ROLES.has(String(entry.role || '').toLowerCase()),
        )
        .map((entry) => ({
          name: textValue(entry.name),
          netid: textValue(entry.netid),
          officialProfileUrls: (entry.profileLinks ?? [])
            .filter((link) => link.kind === 'YALE_OFFICIAL' && link.healthStatus !== 'UNAVAILABLE')
            .map((link) => textValue(link.url))
            .filter(Boolean),
        }))
        .filter((lead) => lead.name || lead.netid),
    );
  }
  return leadsByEntityId;
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
 * The long description this row actually serves, which is not the same thing as the
 * one it stores.
 *
 * Delegates to `sanitizeServedResearchEntityCopyFields`, the single canonical
 * serve-time sanitizer every serving surface runs (`researchEntityDto.ts`,
 * `profileService.ts`, `researchPlanService.ts`), rather than re-applying a chosen
 * stage of it. Naming one stage picks a different answer than the card in both
 * directions: `sanitizeResearchEntityDescription` blanks a publications dump, an
 * area echo, escaped markup and recruitment-flyer copy that
 * `publicResearchEntityDescriptionText` alone keeps, and the repair passes that run
 * ahead of the blanking predicates rescue a body a lone predicate call calls blank.
 * Either divergence makes the lane decide the opposite of what a student sees, which
 * is #1937 in one direction and the #2183 churn in the other.
 *
 * Called with no lead names, matching the card path: `servedResearchEntityCopy` in
 * `researchEntityDto.ts` passes none either.
 */
export function servedFullDescription(entity: FraProfileSynthesisEntity): string {
  const stored = textValue(entity.fullDescription);
  if (!stored) return '';
  const served = sanitizeServedResearchEntityCopyFields({
    fullDescription: stored,
    name: entity.name,
    displayName: entity.displayName,
    slug: entity.slug,
    entityType: entity.entityType,
    kind: entity.kind,
    researchAreas: entity.researchAreas,
  });
  return textValue(served.fullDescription);
}

/**
 * An entity serving a biography, or serving nothing at all, is in scope. A FRA whose
 * description already reads as research is left alone: the A/B that justified this
 * lane measured the bio-shaped cohort only, and rewriting good descriptions is the
 * churn-without-benefit mistake #2183 recorded.
 *
 * The serves-nothing arm is not a widening of that A/B's risk, it is the case the risk
 * cannot apply to: there is no served description to churn, and the row serves no card
 * at all. Its exclusion was a construction accident rather than a decision, and it
 * withheld 571 live rows from the only lane that could describe them (#1937).
 *
 * It reads the served text rather than the stored field, so a row storing an
 * appointment dump or another organization's prose - which serves as blank - is in
 * scope on the same footing as a row storing nothing.
 */
export function selectFraProfileSynthesisTargets<T extends FraProfileSynthesisEntity>(
  entities: T[],
): T[] {
  return entities.filter(
    (entity) =>
      isFraProfileSynthesisScopedEntity(entity) &&
      !isFullDescriptionLocked(entity) &&
      // Selection keys on a career biography, never on isHighConfidencePersonBio:
      // that detector flags name-framed research prose ("Dr. Sauler's research
      // investigates mechanisms of lung injury") which must be left alone. Scoping
      // selection to it rewrote 99 already-good descriptions on Development.
      (isCareerBiographyDescription(entity.fullDescription) || !servedFullDescription(entity)) &&
      profileUrlsOf(entity).length > 0,
  );
}

/**
 * A recorded non-bio research description already beats this lane on the
 * author's own ranking, so spending a fetch and an LLM call to append an
 * observation that must lose is waste. Mirrors the grant-corpus lane's
 * better-sourced skip, restricted to non-bio values because the
 * career-biography cohort is exactly what this lane targets.
 *
 * The alternative has to actually describe research, not merely lack career
 * markers: `fullDescriptionQuality` is flag-based, so clinical-service prose
 * ("sees patients at Smilow Cancer Hospital and serves on the ethics committee")
 * clears it while saying nothing about the research, and skipping on it leaves
 * the entity with no research description at all.
 *
 * It also has to be a description the row actually serves, which
 * `servedFullDescription` decides. "Already beats this lane" is a claim about a
 * contest that has been held, and on a row serving nothing the recorded alternative
 * demonstrably did not win, so reading it as a winner leaves the row blank forever.
 * Ten live rows on Development store nothing and are in exactly that state, and the
 * rows that store a body the serve layer withholds are in it too, which is why this
 * reads the served text and not the stored field.
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
      !isCareerBiographyDescription(observation.value) &&
      describesResearchFocus(observation.value) &&
      fullDescriptionQuality(observation.value, entity.researchAreas, entity.entityType).isUseful,
  );
}

interface ProfileSynthesisAttempt {
  snippets: number;
  description?: string;
  sourceUrl?: string;
  skipped?: string;
}

interface SynthesizedProfileAttempt extends ProfileSynthesisAttempt {
  description: string;
}

const isSynthesized = (attempt: ProfileSynthesisAttempt): attempt is SynthesizedProfileAttempt =>
  Boolean(attempt.description);

const NO_CANDIDATE_PAGE_SKIP = 'no candidate profile page';

/**
 * The candidate whose outcome the report describes when none produced a description:
 * the one that got furthest, ranked by snippet count and then by having reached a gate
 * at all rather than never loading.
 *
 * One attempt, not a best-of per field. Taking the snippet count from the candidate
 * that carried prose and the reason from a different candidate prints a row as
 * `{ snippets: 4, skipped: 'only 0 research snippet(s) on the profile page' }`, which
 * names a page that does not exist; the per-row report and the CLI's `skipped` tally
 * are this lane's only instrument, and #2440 is the precedent for a lane counter that
 * misreported its own outcome.
 */
function furthestAttempt(
  attempts: readonly ProfileSynthesisAttempt[],
): ProfileSynthesisAttempt | undefined {
  const rank = (attempt: ProfileSynthesisAttempt): number =>
    profilePageProgressRank({
      snippets: attempt.snippets,
      fetchFailed: attempt.skipped === PROFILE_FETCH_FAILED_NOTE,
    });
  return attempts.reduce<ProfileSynthesisAttempt | undefined>(
    (best, attempt) => (!best || rank(attempt) > rank(best) ? attempt : best),
    undefined,
  );
}

async function attemptProfileSynthesis(
  step: FraProfileSynthesisStep,
  profileUrl: string,
): Promise<ProfileSynthesisAttempt> {
  const { entity } = step;
  let pageText = '';
  try {
    pageText = await step.fetchProfileText(profileUrl);
  } catch {
    return { snippets: 0, skipped: PROFILE_FETCH_FAILED_NOTE };
  }

  const snippets = profileResearchSnippets(pageText, profileUrl);
  if (snippets.length < MIN_SNIPPETS_TO_SYNTHESIZE) {
    return {
      snippets: snippets.length,
      skipped: `only ${snippets.length} research snippet(s) on the profile page`,
    };
  }

  const result = await synthesizeCoverageDescription({
    snippets,
    entityName: textValue(entity.name) || 'Research',
    entityType: entity.entityType,
    researchAreas: entity.researchAreas,
    callLLM: step.callLLM,
  });
  if (!result) {
    return {
      snippets: snippets.length,
      skipped: 'synthesizer failed closed (grounding or quality gate)',
    };
  }

  const description = repairPronounLead(result.description);
  // Fail closed rather than trade one biography for another: a synthesis that
  // still reads as a person bio is not an improvement on what we serve.
  if (!description || isBioShapedFacultyDescription(description)) {
    return {
      snippets: snippets.length,
      skipped: 'synthesized text still reads as a person biography',
    };
  }
  if (hasResidualPronounLead(description)) {
    return {
      snippets: snippets.length,
      skipped: 'synthesized text keeps a dangling pronoun subject',
    };
  }
  // The synthesizer's quality gate ran on the pre-repair text, and repair drops
  // words ("Her research focuses on X" -> "Focuses on X"), so a value that just
  // cleared the length floor can fall back under it here.
  if (!fullDescriptionQuality(description, entity.researchAreas, entity.entityType).isUseful) {
    return {
      snippets: snippets.length,
      skipped: 'repaired text no longer clears the description-quality bar',
    };
  }
  return {
    snippets: snippets.length,
    description,
    sourceUrl: result.sourceUrls[0] ?? profileUrl,
  };
}

/**
 * Whether the value this lane just recorded is the one the row now serves.
 *
 * `written` only says an observation was persisted, and at 0.48 the lane still loses
 * to any higher-confidence value the resolver ranks ahead of it. That includes a body
 * the serve layer withholds, because `confidenceResolver` demotes person-bio groups
 * and has no rule for a value it stores but no surface shows: such a row serves
 * nothing before the run and nothing after it, while the report reads
 * `synthesized: true, written: true` and the next run repeats the fetch and the LLM
 * call. A run that reports a fix no student can see is the self-reporting counter
 * #2440 records, and this repository's definition of done for a stored-data fix is a
 * re-read of the served surface, so the lane performs that re-read itself rather than
 * leaving the residual cohort to be inferred from a write count.
 */
async function laneValueIsServed(slug: string, description: string): Promise<boolean> {
  const persisted = (await ResearchEntity.findOne({ slug })
    .select(FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS)
    .lean()) as FraProfileSynthesisEntity | null;
  if (!persisted) return false;
  return servedFullDescription(persisted) === textValue(description);
}

export async function runFraProfileSynthesisEntity(
  step: FraProfileSynthesisStep,
): Promise<FraProfileSynthesisEntityReport> {
  const { entity } = step;
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
  if (servedFullDescription(entity) && (await entityHasNonBioSourcedDescription(entity))) {
    report.skipped = 'better-sourced-description';
    return report;
  }

  // Candidates are tried in order and the first that yields a usable description
  // wins, so a bare departmental contact stub no longer ends the attempt for a row
  // whose lead carries a second official page (#1937).
  const attempts: ProfileSynthesisAttempt[] = [];
  for (const profileUrl of step.profileUrls) {
    const attempt = await attemptProfileSynthesis(step, profileUrl);
    attempts.push(attempt);
    if (attempt.description) break;
  }

  // The report describes one candidate, so a page that carried snippets and failed a
  // gate is neither erased by a later candidate that failed to load nor merged with it
  // into a row that names no real page.
  const reported = attempts.find(isSynthesized) ?? furthestAttempt(attempts);
  report.snippets = reported?.snippets ?? 0;
  if (!reported || !isSynthesized(reported)) {
    report.skipped = reported?.skipped ?? NO_CANDIDATE_PAGE_SKIP;
    return report;
  }
  const description = reported.description;
  report.synthesized = true;
  report.description = description;
  report.sourceUrl = reported.sourceUrl;

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
  report.adopted = await laneValueIsServed(slug, description);
  return report;
}
