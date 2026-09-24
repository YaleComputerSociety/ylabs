/**
 * The per-entity body of the FRA profile-synthesis lane, extracted from the CLI
 * so the integration test drives the same skip order, write path, and
 * materialize pass the CLI does instead of a hand-copied transcription of them.
 */
import type { ResearchEntityType } from '../models/researchAccessTypes';
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { appendObservations, retireObservations } from '../scrapers/observationStore';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import {
  coverageSynthesisDecision,
  type CoverageSynthesisLLMFn,
} from '../scrapers/coverageSynthesis';
import { materializeEntity, materializationReadScopeFilter } from '../scrapers/entityMaterializer';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import { withPublicDescriptionGateFields } from '../services/researchEntityPublicDescription';
import { researchEntityDescriptionIsCoherent } from '../services/studentVisibilityTier';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
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
import { LEAD_ROLE_LEGACY_LABELS } from '../models/canonicalRoleMapping';

/**
 * Every field the lane reads, including the whole public-description gate
 * projection: the lane now asks the gate's own description question of the row
 * before and after its write, and that question fails closed on a field it cannot
 * see, so a narrower projection would report a served row as unserved and decline
 * every write (#2425 is the same projection trap on the serve side).
 */
export const FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS = withPublicDescriptionGateFields(
  'slug name displayName entityType kind archived researchAreas fullDescription sourceUrls manuallyLockedFields studentVisibilityTier',
);

export const FRA_PROFILE_SYNTHESIS_ENTITY_TYPE = 'FACULTY_RESEARCH_AREA';

export interface FraProfileSynthesisEntity {
  _id?: unknown;
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  leads?: readonly FraProfileSynthesisLead[];
  entityType?: ResearchEntityType;
  kind?: unknown;
  archived?: unknown;
  researchAreas?: unknown;
  fullDescription?: unknown;
  sourceUrls?: unknown;
  manuallyLockedFields?: unknown;
  studentVisibilityTier?: unknown;
}

export interface FraProfileSynthesisEntityReport {
  slug: string;
  snippets: number;
  synthesized: boolean;
  /**
   * Whether the lane left a value behind that the corpus can still adopt. A
   * reverted write reads `false`: its observation is retired, so no later
   * materialize can reach it, and counting it as written would overstate the run
   * the way #2440's repair queue overstated promotions.
   */
  written: boolean;
  adopted?: boolean;
  /**
   * Whether the gate was asked to look at this row again after the write. A write
   * that changes a gate input and leaves the stored verdict alone is how #3248's
   * cohort came to hold prose behind a verdict computed before that prose existed.
   */
  regated?: boolean;
  reverted?: boolean;
  revertedReason?: string;
  revertRestoredServedCard?: boolean;
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

const IDENTIFIED_LEAD_ROLES = LEAD_ROLE_LEGACY_LABELS;

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
 * withheld the live rows that serve a student nothing at all from the only lane that
 * could describe them (#1937). `skills/scrapers/SKILL.md` records how large that
 * cohort measured on Development, so the count lives there rather than here.
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
      fullDescriptionQuality(observation.value, entity.researchAreas, entity.entityType).isUseful &&
      // The alternative must survive the SERVED sanitizer, not merely pass quality.
      // An affiliated organization's own description grafted onto a person's row
      // ("Yale Translational Research Imaging Center was founded in 2010...") reads
      // as useful research prose and is correctly stripped at serve time, so the
      // student sees nothing. Judged on quality alone it counted as better-sourced
      // and this lane skipped the row, which made the graft self-perpetuating: the
      // only lane that could give the row its own description was blocked by the
      // value that guarantees it serves none. Measured on Development: 16
      // student_ready rows, two of them sharing one facility's text verbatim.
      wouldServeAsFullDescription(entity, observation.value),
  );
}

/**
 * Whether a candidate `fullDescription` survives the canonical served-copy
 * sanitizer for this entity. Mirrors `servedFullDescription`, which asks the same
 * question of the stored value.
 */
export function wouldServeAsFullDescription(
  entity: FraProfileSynthesisEntity,
  value: unknown,
): boolean {
  const text = textValue(value);
  if (!text) return false;
  const served = sanitizeServedResearchEntityCopyFields({
    fullDescription: text,
    name: entity.name,
    displayName: entity.displayName,
    slug: entity.slug,
    entityType: entity.entityType,
    kind: entity.kind,
    researchAreas: entity.researchAreas,
  });
  return textValue((served as { fullDescription?: unknown }).fullDescription).length > 0;
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

  const decision = await coverageSynthesisDecision({
    snippets,
    entityName: textValue(entity.name) || 'Research',
    entityType: entity.entityType,
    researchAreas: entity.researchAreas,
    callLLM: step.callLLM,
  });
  const result = decision.result;
  if (!result) {
    // The refusing arm, not one label for all eight. #1878 recorded 40 rows as
    // "refused by the synthesizer's own gates" under the collapsed label, and two of
    // the arms are transport failures rather than gates, so a row that was never
    // judged read as a quality verdict (#3068's rule applied to this lane).
    return {
      snippets: snippets.length,
      skipped: `synthesizer refused: ${decision.refusal}`,
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
 *
 * Adoption is read off `fieldProvenance`, never off string equality with the value the
 * lane composed. The serve sanitizer rewrites an adopted body - it relabels a research
 * home ("The Lin Laboratory studies" -> "The Lin research program studies") and trims
 * an area echo - so comparing text reports a row the lane did fix as unadopted, and an
 * instrument that undercounts its own successes is no better than one that overcounts.
 * Provenance names the source the resolver actually chose, and the served re-read then
 * says the serve layer did not blank what it chose.
 */
type PersistedLaneRow = FraProfileSynthesisEntity & { fieldProvenance?: any };

const readPersistedRow = async (slug: string): Promise<PersistedLaneRow | null> =>
  (await ResearchEntity.findOne({ slug })
    .select(FRA_PROFILE_SYNTHESIS_ENTITY_FIELDS)
    .lean()) as PersistedLaneRow | null;

function laneValueIsServed(persisted: PersistedLaneRow | null): boolean {
  if (!persisted) return false;
  const provenance = persisted.fieldProvenance?.fullDescription;
  if (textValue(provenance?.sourceName) !== FRA_PROFILE_SYNTHESIS_SOURCE_NAME) return false;
  return Boolean(servedFullDescription(persisted));
}

/**
 * The lead names the card gate is asked to judge this row's copy against, which is
 * the identity `sanitizeResearchEntityPublicDescriptionFields` strips a name-framed
 * sentence on. The visibility gate supplies them from the same roster read, so
 * withholding them here would answer a different question than the gate does.
 */
function laneLeadMemberNames(entity: FraProfileSynthesisEntity): string[] {
  return (entity.leads ?? []).map((lead) => textValue(lead.name)).filter(Boolean);
}

/**
 * Whether a student can see this row right now, which is what the lane must not take
 * away.
 *
 * Both halves are required. The stored tier is the gate's own verdict on whether the
 * row is published, and the description coherence check is the live re-read the tier
 * can go stale against (#2597). A row held at `operator_review` deliberately is NOT
 * protected: its body is still an improvement a later card lane can turn into a card,
 * and refusing the write there would block progress no student is currently getting.
 */
function rowServesStudentsToday(
  entity: FraProfileSynthesisEntity,
  leadMemberNames: readonly string[],
): boolean {
  const tier = textValue(entity.studentVisibilityTier) as StudentVisibilityTier;
  if (!publicStudentVisibilityTiers.includes(tier)) return false;
  return researchEntityDescriptionIsCoherent(entity, leadMemberNames);
}

/**
 * Undo a write that cost the row its served card.
 *
 * Retiring only THIS run's observation is load-bearing: `fullDescription` uses a
 * latest-wins fingerprint, so this run's write already superseded any earlier value
 * from this lane, and a broader retirement would drop a value that was serving
 * fine. It is also sufficient, because the guard can only fire on a row that served
 * a card before the run, and a row serving a non-bio description this lane wrote is
 * out of scope for selection - so the body being restored always comes from another
 * source, which the retirement leaves untouched.
 */
async function revertLaneWrite(
  step: FraProfileSynthesisStep,
  slug: string,
): Promise<{ restoredServedCard: boolean }> {
  await retireObservations(
    {
      entityType: 'researchEntity',
      entityKey: slug,
      field: 'fullDescription',
      sourceName: FRA_PROFILE_SYNTHESIS_SOURCE_NAME,
      scrapeRunId: step.runId,
    },
    'fra-profile-synthesis write removed the row from the served surface (#2954)',
  );
  await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: false });
  const restored = await readPersistedRow(slug);
  return {
    restoredServedCard: Boolean(
      restored && researchEntityDescriptionIsCoherent(restored, laneLeadMemberNames(step.entity)),
    ),
  };
}

/**
 * Re-gate the row this lane just wrote, through the gate planner.
 *
 * `fullDescription` is an INPUT to the student-visibility gate, and this lane changes it.
 * Nothing else re-evaluates the row: `materializeEntity` resolves fields and reads
 * `studentVisibilityTier` only for identity resolution, so before this the stored verdict
 * outlived its own inputs until an unrelated corpus sweep happened to recompute it. That
 * left "somebody must remember to re-gate" as the mechanism, which is not a mechanism.
 *
 * `planStudentVisibilityGate` then `applyStudentVisibilityGatePlans`, the pair
 * `clearDeadLabResearchHomes` already uses, so the tier is never written directly. A
 * repair that stamps a tier has decided a visibility question it is not entitled to
 * decide; this only asks the gate to look again at a row whose evidence changed.
 *
 * Measured blast radius on Development over the 245 rows this lane had written that serve
 * nothing: the recomputed verdict equalled the stored one on 244, and 1 moved
 * `suppressed` to `student_ready`. So this is correctness rather than a release: the rows
 * are held on `duplicate_risk`, `missing_lead` and the description invariant, none of
 * which prose can clear.
 */
async function regateWrittenRow(persisted: FraProfileSynthesisEntity | null): Promise<boolean> {
  const recordId = persisted ? String((persisted as { _id?: unknown })._id ?? '') : '';
  if (!recordId) return false;
  const plans = await planStudentVisibilityGate({
    collection: 'research',
    mode: 'apply',
    recordIds: [recordId],
  });
  if (plans.length === 0) return false;
  await applyStudentVisibilityGatePlans(plans);
  return true;
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

  const leadMemberNames = laneLeadMemberNames(entity);
  const servesStudentsBefore = rowServesStudentsToday(entity, leadMemberNames);

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
  const persisted = await readPersistedRow(slug);

  // A better body is not an improvement if it costs the row its place on the served
  // surface. The card is scored RELATIVE to the body, so replacing a biography can
  // invalidate a card that was fine and leave the row held on
  // `missing_card_description` with the public-description invariant still passing -
  // a loss `adopted` cannot see, because the body WAS adopted (#2954).
  if (
    servesStudentsBefore &&
    persisted &&
    !researchEntityDescriptionIsCoherent(persisted, leadMemberNames)
  ) {
    const revert = await revertLaneWrite(step, slug);
    report.reverted = true;
    report.revertedReason = 'would remove the row from the served surface (no derivable card)';
    report.revertRestoredServedCard = revert.restoredServedCard;
    return report;
  }

  report.written = true;
  report.adopted = laneValueIsServed(persisted);
  report.regated = await regateWrittenRow(persisted);
  return report;
}
