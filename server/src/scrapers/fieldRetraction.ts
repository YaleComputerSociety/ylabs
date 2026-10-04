/**
 * Field retraction: how the engine stops asserting a field a source no longer
 * states (#2542).
 *
 * The gap this closes. Observations are append-only and supersede on fingerprint,
 * so a source can only ever change a field by asserting something new for it. When
 * a profile drops its lab-website link, the source emits nothing for `websiteUrl`,
 * the last assertion stays live and unopposed, and no re-scrape and no
 * rematerialization can withdraw it. Recency decay cannot help (there is no rival
 * group), `LATEST_WINS_FINGERPRINT_FIELDS` cannot help (it needs a NEW row to
 * supersede with), and `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS` cannot help (it
 * fires only when no live observation exists, and the stale one is live). So the
 * only durable fix available before this was a script plus a permanent
 * `manuallyLockedFields` entry, which is why part of the locked corpus already
 * holds an empty value: a hand-rolled retraction (#2612). The dated corpus counts
 * live in `docs/research-data-pipeline.md`.
 *
 * The evidence a retraction is built from. Absence of an observation is not
 * evidence, and neither is a complete read that merely omits the field. What is
 * evidence is a source SAYING SO: a run whose observations carry
 * `assertsNoValueFor: [F]` for this entity, scoped to a COMPLETE READ - a run in
 * which the source emitted every field it emits unconditionally on a successful
 * read (`witnessFields`), which is what says "this source fetched and parsed this
 * entity's page in run R". If no later complete read exists, the source has not
 * looked again. If one exists but asserts nothing about F, the source looked and
 * declined to say F is gone. Neither retracts.
 *
 * Why an explicit assertion rather than the shape of a run. This was originally
 * built as "a complete read that omits F retracts F", and #2647 measured that
 * against Development: of 4 planned retractions, 2 were a
 * `classifyProfileLabWebsite` refusal of a lab link the profile STILL carried, one
 * of them on a student_ready row. A scraper omits a field both when the page
 * stopped stating it and when a guard refused a value the page still states, and
 * those are opposite facts that the observation log cannot separate. A refusal is
 * the ordinary output of a classifier, so inferring retraction from omission
 * deletes correct values as a matter of course. Only the source knows which case it
 * is in, so only the source may say.
 *
 * A per-source opt-in still bounds WHICH fields may be retracted at all, because a
 * field is only declarable when ingest cannot have dropped it
 * (`assertDeclarableRetractionField`): every quality-guarded prose field, every
 * list the label sanitizer can empty, and every enum-validated field is refused,
 * because for those an ingest rejection and a retraction are indistinguishable
 * downstream.
 *
 * The four guards, all of which fail closed:
 *
 *   1. A complete read, not a run. A partial fetch, a content-hash skip, or an
 *      SSRF refusal emits no witness, so it licenses nothing.
 *   1a. A positive absence assertion from that read. Silence about a field is not
 *      a claim about it (#2647).
 *   2. Two complete reads (`FIELD_RETRACTION_MIN_COMPLETE_READS`), mirroring the
 *      two-run rule in `facultyRosterDepartureReconciler` and
 *      `ysmLabDelistingReconciler`. A single anomalous parse cannot retract.
 *   3. A drop guard (`FIELD_RETRACTION_MAX_ABSENT_FRACTION`), the inverse of the
 *      0.5 fraction those two lanes already use. A broken selector stops asserting
 *      a field for everything the source reads, and it persists across runs, so it
 *      defeats guard 2; only the corpus-wide shape separates it from a handful of
 *      genuine delistings. Above the ceiling the whole (source, field) pair is
 *      frozen for the pass and reported, never applied partially.
 *
 * What a retraction writes. The stale observations are retired through
 * `retireObservations`, the same `superseded` plus `rollback.reason` write scripts
 * already make, so the retraction is durable and survives the next pass without
 * needing new state on the row. The stored value is cleared only when the
 * retraction removed the LAST live observation for that field and the stored value
 * is still the retracted one: with rival evidence surviving, the resolver decides
 * on the next materialization and clearing here would blank a field the corpus can
 * still support. That condition is also why this cannot be replaced by adding the
 * field to `CLEARABLE_ON_EMPTY_RESEARCH_ENTITY_FIELDS`: clear-on-empty reads an
 * absence, so it would also unset a value whose backing observation was merely
 * pruned, while this reads a positive retirement it performed itself in the same
 * pass.
 *
 * Locks are untouched, whatever their reason. `isRevisitableFieldLock` is
 * deliberately not consulted: branching on it here would make a sweep unfreeze
 * rows silently, and an unclassified lock can be a status-cache pin whose removal
 * flips a row from suppressed to student-visible. Re-opening a lock is its own
 * reviewed operation, `research-entity:release-field-locks`, which releases one
 * only when a dry-run projection derives the value the row already holds and
 * refuses the fields whose lock gates a reconciler instead of a projection
 * (#2612).
 *
 * A cleared field is re-gated. A row can be visible because of the field being
 * removed, so every row whose stored value this clears goes back through
 * `planStudentVisibilityGate`/`applyStudentVisibilityGatePlans` rather than
 * keeping a tier decided about evidence it no longer has.
 *
 * An absence claim is only as good as the code that made it (#3824). The log is
 * append-only, so when a lane is fixed because it asserted an empty slot it had not
 * read, every claim the old code made stays live and still counts toward the quorum.
 * Measured on Development after #3666: all 24 planned `websiteUrl` retractions had at
 * least one claim from pre-fix runs, and only 10 had two post-fix ones. So a contract
 * declares `absenceClaimCutoffs`, one per fixed field, naming the fix PR, its commit,
 * and its merge time, and `disregardPreFixAbsenceClaims` drops every claim whose run
 * did not carry the fix before the quorum is counted. The read itself still counts as
 * a later complete read that said nothing, so the quorum has to be met by post-fix
 * claims alone. Whether a run carried the fix is decided by ancestry when the run
 * recorded its commit (`ScrapeRun.codeSha`), because a run started after the merge on
 * a stale checkout still runs the old code (#3814), and by the merge time only when no
 * commit was recorded or git cannot resolve it. A run that cannot be found is refused.
 * A fix to a lane's absence-claim path gets its cutoff in a follow-up PR naming the
 * squash-merge commit and merge time, which do not exist until the fix merges; no
 * retraction apply for that field runs before it lands. A field has at most one
 * cutoff: the latest fix, whose commit contains the earlier ones.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import {
  MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS,
  listResearchEntityMergedInRowsBySurvivor,
  walkResearchEntityTombstoneChain,
  type ResearchEntityTombstoneNode,
} from '../services/researchEntityCanonicalTombstone';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { normalizeWebsiteUrlIdentityKey } from '../scripts/researchEntityPiDedupeCore';
import {
  classifySourceLinkHealth,
  probeSourceLink,
  type SourceLinkProbeResult,
} from '../services/sourceLinkHealth';
import { gitCommitIsAncestor, isFullCommitSha } from './scrapeRunCodeIdentity';
import {
  INGEST_REJECTABLE_PERSON_NAME_FIELDS,
  INGEST_REJECTABLE_RESEARCH_ENTITY_FIELDS,
} from './observationFieldSanitizer';
import {
  ENUM_VALIDATED_OBSERVATION_FIELDS,
  LATEST_WINS_FINGERPRINT_FIELDS,
  QUALITY_GUARDED_PROSE_FIELDS,
  retireObservations,
} from './observationStore';

export const FIELD_RETRACTION_MIN_COMPLETE_READS = 2;
export const FIELD_RETRACTION_MAX_ABSENT_FRACTION = 0.5;
export const FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION = 20;

export const FIELD_RETRACTION_ROLLBACK_REASON =
  'field retraction: the source completely re-read this entity and stated this field has no value (#2542, #2647)';

export interface SourceFieldRetractionContract {
  /**
   * Fields the source emits on EVERY successful read of an entity. Their joint
   * presence in one run is what makes that run a complete read; a run missing any
   * of them is treated as a partial or failed read and licenses no retraction.
   */
  witnessFields: readonly string[];
  retractableFields: readonly string[];
  absenceClaimCutoffs?: readonly AbsenceClaimCutoff[];
  notes: string;
}

export interface AbsenceClaimCutoff {
  field: string;
  fixedBy: string;
  fixCommit: string;
  fixMergedAt: Date;
}

const ABSENCE_CLAIM_FIX_3666: Omit<AbsenceClaimCutoff, 'field'> = {
  fixedBy: '#3666',
  fixCommit: '63ece2c57056f38e588b0c733e59827ba9691f83',
  fixMergedAt: new Date('2026-09-27T16:51:32Z'),
};

/**
 * Only sources whose emit path has been read end to end belong here.
 *
 * `ysm-faculty-directory` qualifies: `facultyToResearchEntityObservations` emits
 * `slug`, `name`, `kind`, `entityType`, `school`, `sourceUrls`, and
 * `inferredPiUserKey` for every profile it accepts, and emits `websiteUrl` only
 * when `classifyProfileLabWebsite` finds the profile links the person's OWN
 * research home. Crucially, only ONE of its two ways of not emitting `websiteUrl`
 * is a retraction, and it distinguishes them itself: an empty lab slot carries
 * `assertsNoValueFor: ['websiteUrl']`, and a refusal of a link the page still
 * carries carries nothing. This comment previously claimed both refusals were
 * retractable, which is the #2647 defect.
 *
 * `dept-faculty-roster` qualifies through `FacultyEntry.labSlotAttestation` (#3135).
 * On a `profileBelongsToRosterPerson` mismatch it keeps the citation and drops only
 * the enrichment, `labUrl` included, so that outcome is recorded as `refused`, and a
 * profile left unread (a fetch failure or an off-Yale link) withdraws the roster card's
 * `empty`: the profile is where the lab link usually lives, so an unread one states
 * nothing. #2385 records that dropping that edge strands the real lab, which
 * `observations:retarget-foreign-lab-websites` exists to repair rather than retract.
 *
 * Both of those lanes asserted `empty` on unread or refused profiles until #3666, so
 * each declares that fix as its `websiteUrl` cutoff; #3135 and #3658 predate it and are
 * contained in its commit.
 *
 * `yse-faculty-directory` qualifies for one case only. It emits `slug` and
 * `sourceUrls` for every entity it mints, and states `assertsNoValueFor:
 * ['websiteUrl']` only when it withdrew a lab because the linked site is known or
 * probed dead (#3452). A refused link and an empty slot state nothing, because
 * `extractLabUrl` can decline a link the page still carries. It declares no cutoff
 * because its claim path has not been fixed since #3566 introduced it.
 *
 * `ysm-atoz-index` does not qualify either, for the opposite reason: a delisted
 * lab vanishes from the index entirely, so it emits no witness and no partial
 * read ever occurs. That cohort is `ysmLabDelistingReconciler`'s.
 */
export const fieldRetractionContracts: Readonly<Record<string, SourceFieldRetractionContract>> = {
  'ysm-faculty-directory': {
    witnessFields: ['slug', 'sourceUrls'],
    retractableFields: ['websiteUrl'],
    absenceClaimCutoffs: [{ field: 'websiteUrl', ...ABSENCE_CLAIM_FIX_3666 }],
    notes:
      'Reads one official profile per entity and emits slug plus sourceUrls unconditionally. It states assertsNoValueFor: [websiteUrl] only when the profile carries no lab link at all, so a classifyProfileLabWebsite refusal of a link the page still carries retracts nothing (#2647).',
  },
  'yse-faculty-directory': {
    witnessFields: ['slug', 'sourceUrls'],
    retractableFields: ['websiteUrl'],
    notes:
      'Emits slug and sourceUrls on every entity it mints. It states assertsNoValueFor: [websiteUrl] only when it withdrew the lab because the linked site is dead on a stored or probed verdict, so the websiteUrl it asserted before it knew stops being live (#3452). A refused link and an empty lab slot state nothing.',
  },
  'official-profile-pi-backfill': {
    witnessFields: ['sourceUrls'],
    retractableFields: ['websiteUrl', 'website'],
    notes:
      'Re-reads the profiles behind the websites it set and states assertsNoValueFor: [websiteUrl, website] only when it re-read the same profile the stored website was observed from, that page carries no lab-website slot of any kind, and the stored link appears nowhere among its links. It retracts website beside websiteUrl because it asserts both from the same link and every reader serves websiteUrl || website. Every refusal of a link the page still carries states nothing, and a read of a different profile never claims (#4544).',
  },
  'dept-faculty-roster': {
    witnessFields: ['slug', 'sourceUrls'],
    retractableFields: ['websiteUrl'],
    absenceClaimCutoffs: [{ field: 'websiteUrl', ...ABSENCE_CLAIM_FIX_3666 }],
    notes:
      'Emits slug and sourceUrls on every entity it mints. It states assertsNoValueFor: [websiteUrl] only on a positively attested empty lab-website slot (FacultyEntry.labSlotAttestation === "empty"), which every parse that reads labUrl must set and which is never set when a candidate link was seen and not adopted. A parse that routes a single destination link, or that never looked, leaves the claim unmade (#3135). An unread profile withdraws the empty a roster card attested, and a profile refused as naming someone else records refused.',
  },
};

/**
 * Sources that cannot be given a contract, and why, so the gap is a decision rather
 * than an omission (#3261).
 *
 * #3135's plan listed `ysm-atoz-index` and `official-profile-pi-backfill` as the next
 * two contracts to declare. Reading both emit paths end to end, neither could state a
 * positive absence, and a contract a source cannot honour is worse than no contract: the
 * lane would then read their silence as a claim, which is precisely what #2647
 * measured going wrong when 2 of 4 planned retractions turned out to be refusals of
 * links the page still carried.
 *
 * `ysm-atoz-index` emits `websiteUrl` unconditionally, because the A-to-Z index IS a
 * list of lab URLs: a lab with no URL is not in the index at all. So its only "absence"
 * is a lab dropping out of the index, which is delisting rather than an empty slot, and
 * `ysmLabDelistingReconciler` already owns that. A contract here would count one
 * delisting twice under two mechanisms.
 *
 * `official-profile-pi-backfill` was listed here until #4544 gave it the parse-time
 * empty-slot signal #3153 asked for, `profileAttestsItsLabWebsiteIsGone`, which is kept
 * distinct from every refusal path, so it now carries a contract above.
 */
const SOURCES_THAT_CANNOT_ATTEST_ABSENCE: readonly string[] = ['ysm-atoz-index'];

export function sourceCannotAttestAbsence(sourceName: string): boolean {
  return SOURCES_THAT_CANNOT_ATTEST_ABSENCE.includes(sourceName);
}

/**
 * A witness field must be as undroppable as a retractable one: a rejected witness
 * would silently downgrade a complete read to a partial one and make the lane
 * inert, which is the dormancy shape #2410 spent three causes on.
 */
export function isIngestDroppableObservationField(field: string): boolean {
  return (
    INGEST_REJECTABLE_RESEARCH_ENTITY_FIELDS.has(field) ||
    INGEST_REJECTABLE_PERSON_NAME_FIELDS.has(field) ||
    QUALITY_GUARDED_PROSE_FIELDS.has(field) ||
    ENUM_VALIDATED_OBSERVATION_FIELDS.has(field)
  );
}

export function assertDeclarableRetractionField(field: string, role: 'witness' | 'retractable') {
  if (!field.trim()) throw new Error(`A ${role} field name cannot be blank.`);
  if (isIngestDroppableObservationField(field)) {
    throw new Error(
      `Cannot declare ${role} field ${JSON.stringify(field)}: ingest can drop this field's value, so its absence from a run is not evidence about the page.`,
    );
  }
}

/**
 * A latest-wins witness would be a false witness. Its fingerprint omits `value`,
 * so every run's row supersedes the previous one and the log keeps a single
 * active copy; counting complete reads still works because this lane reads runs
 * rather than live rows, but a witness whose value drifts run to run cannot be
 * distinguished from one re-emitted unchanged, so the declaration stays on
 * value-fingerprinted fields where a run's row is its own record.
 */
export function assertFieldRetractionContractsAreDeclarable(
  contracts: Readonly<Record<string, SourceFieldRetractionContract>> = fieldRetractionContracts,
): void {
  for (const [sourceName, contract] of Object.entries(contracts)) {
    if (contract.witnessFields.length === 0) {
      throw new Error(`${sourceName} declares no witness field, so no read can be complete.`);
    }
    if (contract.retractableFields.length === 0) {
      throw new Error(`${sourceName} declares no retractable field.`);
    }
    for (const field of contract.witnessFields) {
      assertDeclarableRetractionField(field, 'witness');
      if (LATEST_WINS_FINGERPRINT_FIELDS.has(field)) {
        throw new Error(
          `${sourceName} cannot use latest-wins field ${JSON.stringify(field)} as a read witness.`,
        );
      }
    }
    for (const field of contract.retractableFields) {
      assertDeclarableRetractionField(field, 'retractable');
    }
    const cutFields = new Set<string>();
    for (const cutoff of contract.absenceClaimCutoffs ?? []) {
      if (!contract.retractableFields.includes(cutoff.field)) {
        throw new Error(
          `${sourceName} declares an absence-claim cutoff for ${JSON.stringify(cutoff.field)}, which is not a retractable field.`,
        );
      }
      if (cutFields.has(cutoff.field)) {
        throw new Error(
          `${sourceName} declares more than one cutoff for ${JSON.stringify(cutoff.field)}; keep only the latest fix.`,
        );
      }
      cutFields.add(cutoff.field);
      if (!isFullCommitSha(cutoff.fixCommit)) {
        throw new Error(`${sourceName} cutoff for ${cutoff.field} must name a full fix commit.`);
      }
      if (!/^#\d+$/.test(cutoff.fixedBy)) {
        throw new Error(`${sourceName} cutoff for ${cutoff.field} must name its fix PR as #<n>.`);
      }
      if (!(cutoff.fixMergedAt instanceof Date) || Number.isNaN(cutoff.fixMergedAt.getTime())) {
        throw new Error(`${sourceName} cutoff for ${cutoff.field} must carry a valid merge time.`);
      }
    }
  }
}

assertFieldRetractionContractsAreDeclarable();

export function fieldRetractionContractFor(
  sourceName: string,
): SourceFieldRetractionContract | undefined {
  return Object.prototype.hasOwnProperty.call(fieldRetractionContracts, sourceName)
    ? fieldRetractionContracts[sourceName]
    : undefined;
}

export function fieldRetractionEnabled(): boolean {
  return process.env.SCRAPER_FIELD_RETRACTION === 'true';
}

export interface FieldRetractionCompleteRead {
  entityKey: string;
  scrapeRunId: string;
  observedAt: Date;
  /**
   * Fields this run POSITIVELY asserted have no value, from the run's own
   * `assertsNoValueFor`. A complete read that says nothing about a field licenses
   * nothing for it (#2647).
   */
  assertsNoValueFor: readonly string[];
  /** Claims in `assertsNoValueFor` made by lane code that predates the field's fix. */
  preFixAbsenceClaims?: readonly string[];
}

export interface FieldRetractionRunProvenance {
  startedAt?: Date;
  codeSha?: string;
}

export type CommitIsAncestor = (ancestor: string, descendant: string) => boolean | undefined;

export function runCarriesAbsenceClaimFix(
  run: FieldRetractionRunProvenance | undefined,
  cutoff: AbsenceClaimCutoff,
  commitIsAncestor: CommitIsAncestor,
): boolean {
  if (!run) return false;
  if (run.codeSha) {
    const containsFix = commitIsAncestor(cutoff.fixCommit, run.codeSha);
    if (containsFix !== undefined) return containsFix;
  }
  return run.startedAt instanceof Date && run.startedAt.getTime() >= cutoff.fixMergedAt.getTime();
}

export function disregardPreFixAbsenceClaims(
  completeReads: readonly FieldRetractionCompleteRead[],
  contract: SourceFieldRetractionContract,
  runsById: ReadonlyMap<string, FieldRetractionRunProvenance>,
  commitIsAncestor: CommitIsAncestor,
): FieldRetractionCompleteRead[] {
  const cutoffs = contract.absenceClaimCutoffs ?? [];
  if (cutoffs.length === 0) return [...completeReads];
  return completeReads.map((read) => {
    const run = runsById.get(read.scrapeRunId);
    const preFix = cutoffs
      .filter(
        (cutoff) =>
          read.assertsNoValueFor.includes(cutoff.field) &&
          !runCarriesAbsenceClaimFix(run, cutoff, commitIsAncestor),
      )
      .map((cutoff) => cutoff.field);
    return { ...read, preFixAbsenceClaims: preFix };
  });
}

export interface FieldRetractionCandidateObservation {
  observationId: string;
  entityKey: string;
  field: string;
  value: unknown;
  scrapeRunId: string;
  observedAt: Date;
}

export interface FieldRetractionEntityState {
  entityId: string;
  entityKey: string;
  manuallyLockedFields: string[];
  storedValues: Record<string, unknown>;
  liveObservationCountByField: Record<string, number>;
  evidenceKeys?: string[];
}

export type FieldRetractionVerdict =
  'source-has-not-reread' | 'absence-not-witnessed' | 'awaiting-second-complete-read' | 'retract';

/**
 * A read only counts when it is BOTH a different run and strictly later than the
 * observation. Run inequality alone would let a concurrently-written sibling run
 * retract; timestamp alone would let the observation's own run retract it.
 *
 * It must also positively assert that THIS field has no value. Before #2647 a
 * later complete read counted merely by not carrying the field, which conflated
 * "the page stopped stating it" with "a guard refused a value the page still
 * states" - the second being the ordinary outcome of a classifier doing its job.
 */
export function completeReadsSupportingRetraction(
  observation: { scrapeRunId: string; observedAt: Date },
  completeReads: readonly FieldRetractionCompleteRead[],
  field: string,
): string[] {
  const runIds = new Set<string>();
  for (const read of completeReads) {
    if (read.scrapeRunId === observation.scrapeRunId) continue;
    if (!(read.observedAt.getTime() > observation.observedAt.getTime())) continue;
    if (!read.assertsNoValueFor.includes(field)) continue;
    if (read.preFixAbsenceClaims?.includes(field)) continue;
    runIds.add(read.scrapeRunId);
  }
  return Array.from(runIds);
}

/**
 * A merged-in key's state is its survivor's (#3560), and so is its re-read: the source reads
 * the survivor under the survivor's own key, so matching reads by the exact key the old
 * observation was filed under judged it `source-has-not-reread` forever (#4568). Each read is
 * shared with every key in its survivor's evidence group, and every other guard is unchanged.
 */
export function completeReadsAcrossMergedEvidence(
  reads: readonly FieldRetractionCompleteRead[],
  entities: readonly Pick<FieldRetractionEntityState, 'entityKey' | 'evidenceKeys'>[],
): FieldRetractionCompleteRead[] {
  const readsByKey = new Map<string, FieldRetractionCompleteRead[]>();
  for (const read of reads) {
    const group = readsByKey.get(read.entityKey);
    if (group) group.push(read);
    else readsByKey.set(read.entityKey, [read]);
  }
  const merged = new Map<string, FieldRetractionCompleteRead>();
  const add = (entityKey: string, read: FieldRetractionCompleteRead) => {
    const identity = `${entityKey}\u0000${read.scrapeRunId}`;
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, { ...read, entityKey });
      return;
    }
    merged.set(identity, {
      ...existing,
      observedAt:
        read.observedAt.getTime() > existing.observedAt.getTime()
          ? read.observedAt
          : existing.observedAt,
      assertsNoValueFor: [...new Set([...existing.assertsNoValueFor, ...read.assertsNoValueFor])],
    });
  };
  for (const read of reads) add(read.entityKey, read);
  for (const entity of entities) {
    for (const memberKey of entity.evidenceKeys ?? []) {
      if (memberKey === entity.entityKey) continue;
      for (const read of readsByKey.get(memberKey) ?? []) add(entity.entityKey, read);
    }
  }
  return [...merged.values()];
}

/**
 * `absence-not-witnessed` is reported separately from `source-has-not-reread`
 * because they call for opposite responses: the first means the source looked and
 * declined to say the value is gone, the second means it has not looked. Collapsing
 * them would hide a source that re-reads constantly and never witnesses absence,
 * which is what a source with no absence-assertion path looks like.
 */
export function classifyFieldRetraction(params: {
  observation: { scrapeRunId: string; observedAt: Date; field: string };
  completeReads: readonly FieldRetractionCompleteRead[];
  minCompleteReads?: number;
}): FieldRetractionVerdict {
  const laterReads = params.completeReads.filter(
    (read) =>
      read.scrapeRunId !== params.observation.scrapeRunId &&
      read.observedAt.getTime() > params.observation.observedAt.getTime(),
  );
  if (laterReads.length === 0) return 'source-has-not-reread';
  const supporting = completeReadsSupportingRetraction(
    params.observation,
    params.completeReads,
    params.observation.field,
  );
  if (supporting.length === 0) return 'absence-not-witnessed';
  const min = params.minCompleteReads ?? FIELD_RETRACTION_MIN_COMPLETE_READS;
  return supporting.length >= min ? 'retract' : 'awaiting-second-complete-read';
}

/**
 * The fraction ceiling only applies once the population is large enough for a
 * fraction to say anything. Three of five holders dropping a lab link is an
 * ordinary month at that scale, so a ceiling there would freeze the lane
 * permanently on small sources while protecting nothing; above the floor a broken
 * selector is unmistakable because it stops asserting for every holder at once.
 * Below the floor the two-complete-read rule and the operator's `--max-apply`
 * ceiling are what bound the damage.
 */
export function passesFieldRetractionDropGuard(
  absentEntityCount: number,
  assertingEntityCount: number,
  maxFraction: number = FIELD_RETRACTION_MAX_ABSENT_FRACTION,
  minPopulation: number = FIELD_RETRACTION_DROP_GUARD_MIN_POPULATION,
): boolean {
  if (assertingEntityCount <= 0) return false;
  if (assertingEntityCount < minPopulation) return true;
  return absentEntityCount <= maxFraction * assertingEntityCount;
}

function normalizedComparableValue(value: unknown): string {
  if (typeof value === 'string') {
    const urlKey = normalizeWebsiteUrlIdentityKey(value);
    return urlKey || value.trim().toLowerCase();
  }
  if (Array.isArray(value)) {
    return `[${value.map(normalizedComparableValue).sort().join(',')}]`;
  }
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

export function storedValueIsRetractedValue(storedValue: unknown, retractedValues: unknown[]) {
  const stored = normalizedComparableValue(storedValue);
  if (!stored) return false;
  return retractedValues.some((value) => normalizedComparableValue(value) === stored);
}

export interface PlannedFieldRetraction {
  entityId: string;
  entityKey: string;
  field: string;
  observationIds: string[];
  clearsStoredValue: boolean;
  /**
   * The retracted values, and how many distinct stored rows this source asserts
   * each of them for, a survivor and its merged-in keys counting once. A value
   * asserted for many entities cannot be any one of their
   * research websites, so the count is the ownership signal - see
   * `classifyRetractionValueOwnership`.
   */
  retractedValues: string[];
  maxEntitiesSharingAValue: number;
}

export interface FrozenFieldRetraction {
  sourceName: string;
  field: string;
  absentEntities: number;
  /**
   * Entities this source read that hold a live assertion for the field. The
   * denominator is scoped to holders rather than to everything read, because a
   * broken selector shows up as "every holder stopped asserting" and a real
   * delisting cohort as a handful of them; diluting it with entities that never
   * had the field would let a total selector failure pass the guard.
   */
  assertingEntities: number;
}

export interface FieldRetractionCounts {
  /** Entities holding a live assertion for a retractable field that this source read. */
  candidateEntities: number;
  candidateObservations: number;
  sourceHasNotReread: number;
  /** The source re-read the entity and did NOT assert the field is gone (#2647). */
  absenceNotWitnessed: number;
  awaitingSecondCompleteRead: number;
  lockedSkipped: number;
  unmatchedEntities: number;
  retractedObservations: number;
  storedValuesCleared: number;
  /** Retired, but rival live evidence survives, so the resolver decides next pass. */
  deferredToResolver: number;
  /** Retired, but the stored value is no longer the retracted one, so nothing is cleared. */
  storedValueDiverged: number;
  /** The retracted value is asserted for several entities, so it is page boilerplate. */
  sharedBoilerplateValue: number;
  /** Sole-holder value withheld because a probe did not positively find it dead. */
  soleHolderValueWithheld: number;
  /** Sole-holder value retracted because a probe positively found it dead. */
  soleHolderValueProbedDead: number;
  /** Per field with a declared cutoff: what disregarding pre-fix claims changed. */
  preFixAbsenceClaims: Record<string, PreFixAbsenceClaimCounts>;
}

export interface PreFixAbsenceClaimCounts {
  /** Absence claims, one per (entity, run), made by runs on pre-fix lane code. */
  excludedClaims: number;
  /** Observations that would have been retracted had those claims counted. */
  heldObservations: number;
  heldEntities: number;
}

export interface FieldRetractionPlan {
  retractions: PlannedFieldRetraction[];
  frozenFields: FrozenFieldRetraction[];
  counts: FieldRetractionCounts;
}

export function planFieldRetractions(input: {
  sourceName: string;
  contract: SourceFieldRetractionContract;
  completeReads: readonly FieldRetractionCompleteRead[];
  activeObservations: readonly FieldRetractionCandidateObservation[];
  entities: readonly FieldRetractionEntityState[];
  minCompleteReads?: number;
  maxAbsentFraction?: number;
  dropGuardMinPopulation?: number;
}): FieldRetractionPlan {
  const retractableFields = new Set(input.contract.retractableFields);
  const readsByEntity = new Map<string, FieldRetractionCompleteRead[]>();
  for (const read of input.completeReads) {
    const group = readsByEntity.get(read.entityKey);
    if (group) group.push(read);
    else readsByEntity.set(read.entityKey, [read]);
  }
  const entityStates = new Map(input.entities.map((entity) => [entity.entityKey, entity]));

  const assertingEntitiesByField = new Map<string, Set<string>>();
  const counts: FieldRetractionCounts = {
    candidateEntities: 0,
    candidateObservations: 0,
    sourceHasNotReread: 0,
    absenceNotWitnessed: 0,
    awaitingSecondCompleteRead: 0,
    lockedSkipped: 0,
    unmatchedEntities: 0,
    retractedObservations: 0,
    storedValuesCleared: 0,
    deferredToResolver: 0,
    storedValueDiverged: 0,
    sharedBoilerplateValue: 0,
    soleHolderValueWithheld: 0,
    soleHolderValueProbedDead: 0,
    preFixAbsenceClaims: {},
  };
  const heldEntitiesByField = new Map<string, Set<string>>();
  for (const cutoff of input.contract.absenceClaimCutoffs ?? []) {
    counts.preFixAbsenceClaims[cutoff.field] = {
      excludedClaims: 0,
      heldObservations: 0,
      heldEntities: 0,
    };
    heldEntitiesByField.set(cutoff.field, new Set());
  }
  for (const read of input.completeReads) {
    for (const field of read.preFixAbsenceClaims ?? []) {
      const tally = counts.preFixAbsenceClaims[field];
      if (tally) tally.excludedClaims += 1;
    }
  }

  const entitiesByValue = new Map<string, Set<string>>();
  for (const observation of input.activeObservations) {
    if (!retractableFields.has(observation.field)) continue;
    const value = normalizedComparableValue(observation.value);
    if (!value) continue;
    const holders = entitiesByValue.get(value) ?? new Set<string>();
    holders.add(entityStates.get(observation.entityKey)?.entityId || observation.entityKey);
    entitiesByValue.set(value, holders);
  }

  const retractedByKey = new Map<
    string,
    { entityKey: string; field: string; observationIds: string[]; values: unknown[] }
  >();
  for (const observation of input.activeObservations) {
    if (!retractableFields.has(observation.field)) continue;
    const completeReads = readsByEntity.get(observation.entityKey);
    if (!completeReads) continue;
    counts.candidateObservations += 1;
    const asserting = assertingEntitiesByField.get(observation.field) ?? new Set<string>();
    asserting.add(observation.entityKey);
    assertingEntitiesByField.set(observation.field, asserting);
    const verdict = classifyFieldRetraction({
      observation,
      completeReads,
      minCompleteReads: input.minCompleteReads,
    });
    const tally = counts.preFixAbsenceClaims[observation.field];
    if (
      tally &&
      verdict !== 'retract' &&
      classifyFieldRetraction({
        observation,
        completeReads: completeReads.map((read) => ({ ...read, preFixAbsenceClaims: [] })),
        minCompleteReads: input.minCompleteReads,
      }) === 'retract'
    ) {
      tally.heldObservations += 1;
      heldEntitiesByField.get(observation.field)?.add(observation.entityKey);
    }
    if (verdict === 'source-has-not-reread') {
      counts.sourceHasNotReread += 1;
      continue;
    }
    if (verdict === 'absence-not-witnessed') {
      counts.absenceNotWitnessed += 1;
      continue;
    }
    if (verdict === 'awaiting-second-complete-read') {
      counts.awaitingSecondCompleteRead += 1;
      continue;
    }
    const key = `${observation.entityKey}\u0000${observation.field}`;
    const group = retractedByKey.get(key);
    if (group) {
      group.observationIds.push(observation.observationId);
      group.values.push(observation.value);
    } else {
      retractedByKey.set(key, {
        entityKey: observation.entityKey,
        field: observation.field,
        observationIds: [observation.observationId],
        values: [observation.value],
      });
    }
  }

  counts.candidateEntities = new Set(
    Array.from(assertingEntitiesByField.values()).flatMap((entities) => Array.from(entities)),
  ).size;
  for (const [field, entities] of heldEntitiesByField) {
    counts.preFixAbsenceClaims[field].heldEntities = entities.size;
  }

  const frozenFields: FrozenFieldRetraction[] = [];
  const frozen = new Set<string>();
  for (const field of retractableFields) {
    const absentEntities = new Set(
      Array.from(retractedByKey.values())
        .filter((group) => group.field === field)
        .map((group) => group.entityKey),
    );
    if (absentEntities.size === 0) continue;
    const assertingEntities = assertingEntitiesByField.get(field)?.size ?? 0;
    if (
      !passesFieldRetractionDropGuard(
        absentEntities.size,
        assertingEntities,
        input.maxAbsentFraction,
        input.dropGuardMinPopulation,
      )
    ) {
      frozen.add(field);
      frozenFields.push({
        sourceName: input.sourceName,
        field,
        absentEntities: absentEntities.size,
        assertingEntities,
      });
    }
  }

  // Several keys can store into one row (a survivor and its merged-in losers), so
  // whether rival evidence survives is decided per stored row and field, not per key.
  const retractingByStoredRowField = new Map<string, { observations: number; values: unknown[] }>();
  for (const group of retractedByKey.values()) {
    if (frozen.has(group.field)) continue;
    const entity = entityStates.get(group.entityKey);
    if (!entity || entity.manuallyLockedFields.includes(group.field)) continue;
    const key = `${entity.entityId}\u0000${group.field}`;
    const total = retractingByStoredRowField.get(key) ?? { observations: 0, values: [] };
    total.observations += group.observationIds.length;
    total.values.push(...group.values);
    retractingByStoredRowField.set(key, total);
  }
  const clearDecidedForStoredRowField = new Set<string>();

  const retractions: PlannedFieldRetraction[] = [];
  for (const group of retractedByKey.values()) {
    if (frozen.has(group.field)) continue;
    const entity = entityStates.get(group.entityKey);
    if (!entity) {
      counts.unmatchedEntities += 1;
      continue;
    }
    if (entity.manuallyLockedFields.includes(group.field)) {
      counts.lockedSkipped += 1;
      continue;
    }
    const storedRowField = `${entity.entityId}\u0000${group.field}`;
    const retracting = retractingByStoredRowField.get(storedRowField) ?? {
      observations: group.observationIds.length,
      values: group.values,
    };
    const liveCount = entity.liveObservationCountByField[group.field] ?? 0;
    const rivalEvidenceSurvives = liveCount > retracting.observations;
    const clearAlreadyDecided = clearDecidedForStoredRowField.has(storedRowField);
    clearDecidedForStoredRowField.add(storedRowField);
    const clearsStoredValue =
      !clearAlreadyDecided &&
      !rivalEvidenceSurvives &&
      storedValueIsRetractedValue(entity.storedValues[group.field], retracting.values);
    counts.retractedObservations += group.observationIds.length;
    if (clearsStoredValue) counts.storedValuesCleared += 1;
    else if (!clearAlreadyDecided && rivalEvidenceSurvives) counts.deferredToResolver += 1;
    else if (!clearAlreadyDecided && normalizedComparableValue(entity.storedValues[group.field])) {
      counts.storedValueDiverged += 1;
    }
    // Raw values, not `normalizedComparableValue` output: the identity key drops the
    // scheme, so it groups correctly and cannot be fetched. The probe needs the URL.
    const retractedValues = Array.from(
      new Set(
        group.values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0),
      ),
    );
    const maxEntitiesSharingAValue = retractedValues.reduce(
      (most, value) =>
        Math.max(most, entitiesByValue.get(normalizedComparableValue(value))?.size ?? 0),
      0,
    );
    if (classifyRetractionValueOwnership(maxEntitiesSharingAValue) === 'shared-boilerplate') {
      counts.sharedBoilerplateValue += 1;
    }
    retractions.push({
      entityId: entity.entityId,
      entityKey: group.entityKey,
      field: group.field,
      observationIds: group.observationIds,
      clearsStoredValue,
      retractedValues,
      maxEntitiesSharingAValue,
    });
  }

  return { retractions, frozenFields, counts };
}

export type RetractionValueOwnership = 'shared-boilerplate' | 'sole-holder';

/**
 * A value this source asserts for more than one entity cannot be the research
 * website of any of them, so it is page boilerplate and always retractable. That
 * is the whole of the #2460 donor-page cohort and the A-to-Z catalog cohort: one
 * link harvested for everybody listed on the page.
 *
 * Liveness deliberately plays no part in this call. Those boilerplate pages answer
 * `200`, so a reachability probe would protect them, and the subject question a
 * probe would have to answer instead is one #2534 measured it cannot: the resolver
 * is not a subject check.
 */
export function classifyRetractionValueOwnership(
  entitiesSharingTheValue: number,
): RetractionValueOwnership {
  return entitiesSharingTheValue > 1 ? 'shared-boilerplate' : 'sole-holder';
}

export interface RetractionProbeVerdict {
  positivelyDead: boolean;
}

export interface WithheldFieldRetraction {
  entityKey: string;
  field: string;
  reason: 'sole-holder-value-still-answers';
  values: string[];
}

/**
 * The apply-time precondition, not an operator's checklist item: a sole-holder
 * value is that row's own claim, so retiring it needs positive evidence the page
 * is gone rather than the absence of evidence that it is there. Anything short of
 * a positively dead probe - a `200`, a throttle, a timeout, a TLS failure - keeps
 * the value, because retraction is the one operation that removes something a
 * student can see.
 *
 * The probe is injected so the decision is testable without a network, and because
 * a concurrent writer can move `clearsStoredValue` between plan and apply, which
 * makes a stale flag expected rather than exceptional (#3135).
 */
export async function withholdSoleHolderRetractionsThatStillAnswer(
  retractions: readonly PlannedFieldRetraction[],
  probeValue: (value: string) => Promise<RetractionProbeVerdict>,
): Promise<{
  retained: PlannedFieldRetraction[];
  withheld: WithheldFieldRetraction[];
  probedValues: number;
}> {
  const retained: PlannedFieldRetraction[] = [];
  const withheld: WithheldFieldRetraction[] = [];
  const withheldStoredRowFields = new Set<string>();
  let probedValues = 0;
  for (const retraction of retractions) {
    if (
      classifyRetractionValueOwnership(retraction.maxEntitiesSharingAValue) === 'shared-boilerplate'
    ) {
      retained.push(retraction);
      continue;
    }
    let everyValueIsDead = retraction.retractedValues.length > 0;
    for (const value of retraction.retractedValues) {
      probedValues += 1;
      const verdict = await probeValue(value);
      if (!verdict.positivelyDead) {
        everyValueIsDead = false;
        break;
      }
    }
    if (everyValueIsDead) retained.push(retraction);
    else {
      withheldStoredRowFields.add(`${retraction.entityId}\u0000${retraction.field}`);
      withheld.push({
        entityKey: retraction.entityKey,
        field: retraction.field,
        reason: 'sole-holder-value-still-answers',
        values: retraction.retractedValues,
      });
    }
  }
  return {
    retained: retained.map((retraction) =>
      retraction.clearsStoredValue &&
      withheldStoredRowFields.has(`${retraction.entityId}\u0000${retraction.field}`)
        ? { ...retraction, clearsStoredValue: false }
        : retraction,
    ),
    withheld,
    probedValues,
  };
}

/**
 * Named causes rather than a bare zero, for the reason #2410 gives: an operator
 * who switched this on has to be able to tell an uneventful pass from a lane that
 * never executed.
 */
export type FieldRetractionOutcome =
  | 'disabled'
  | 'invalid-run-id'
  | 'unknown-run'
  | 'source-not-retraction-capable'
  | 'no-complete-reads'
  | 'planned'
  | 'reconciled';

export interface FieldRetractionResult {
  outcome: FieldRetractionOutcome;
  sourceName?: string;
  dryRun: boolean;
  counts: FieldRetractionCounts;
  frozenFields: FrozenFieldRetraction[];
  regatedEntities: number;
  retractions: PlannedFieldRetraction[];
  withheld?: WithheldFieldRetraction[];
}

const emptyCounts = (): FieldRetractionCounts => ({
  candidateEntities: 0,
  candidateObservations: 0,
  sourceHasNotReread: 0,
  absenceNotWitnessed: 0,
  awaitingSecondCompleteRead: 0,
  lockedSkipped: 0,
  unmatchedEntities: 0,
  retractedObservations: 0,
  storedValuesCleared: 0,
  deferredToResolver: 0,
  storedValueDiverged: 0,
  sharedBoilerplateValue: 0,
  soleHolderValueWithheld: 0,
  soleHolderValueProbedDead: 0,
  preFixAbsenceClaims: {},
});

const emptyResult = (outcome: FieldRetractionOutcome, dryRun: boolean): FieldRetractionResult => ({
  outcome,
  dryRun,
  counts: emptyCounts(),
  frozenFields: [],
  regatedEntities: 0,
  retractions: [],
  withheld: [],
});

const observationEntityKey = (observation: { entityKey?: unknown; entityId?: unknown }): string => {
  const key = typeof observation.entityKey === 'string' ? observation.entityKey.trim() : '';
  return key || serializedDocumentId(observation.entityId) || '';
};

/**
 * One complete read per (entity, run) in which every witness field was observed.
 *
 * Superseded witness rows are deliberately included: a witness is a record that a
 * run happened, and the newest run's row supersedes the previous one on an
 * unchanged value, so reading live rows only would collapse every historical read
 * into one and make the two-read rule unsatisfiable. Retention still bounds this -
 * `pruneDeadObservations` keeps the last 3 runs per source - and losing older
 * witnesses only ever makes this lane more conservative.
 *
 * Scoped to the entities that actually hold a live assertion for a retractable
 * field, so the aggregation is proportional to the candidate population rather
 * than to every entity the source has ever read.
 */
export async function loadCompleteReads(
  sourceName: string,
  witnessFields: readonly string[],
  entityKeys: readonly string[],
): Promise<FieldRetractionCompleteRead[]> {
  if (entityKeys.length === 0) return [];
  const groups = (await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        sourceName,
        entityKey: { $in: [...entityKeys] },
        field: { $in: [...witnessFields] },
        scrapeRunId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { entityKey: '$entityKey', entityId: '$entityId', scrapeRunId: '$scrapeRunId' },
        fields: { $addToSet: '$field' },
        observedAt: { $max: '$observedAt' },
        assertsNoValueFor: { $push: '$assertsNoValueFor' },
      },
    },
  ])) as Array<{
    _id: { entityKey?: unknown; entityId?: unknown; scrapeRunId: unknown };
    fields: string[];
    observedAt: Date;
    assertsNoValueFor?: unknown[];
  }>;

  const reads: FieldRetractionCompleteRead[] = [];
  for (const group of groups) {
    const observed = new Set(group.fields);
    if (!witnessFields.every((field) => observed.has(field))) continue;
    const entityKey = observationEntityKey(group._id);
    const scrapeRunId = serializedDocumentId(group._id.scrapeRunId) || '';
    if (!entityKey || !scrapeRunId || !(group.observedAt instanceof Date)) continue;
    // Unioned across the run's rows because a source may carry the assertion on
    // whichever observation it finds natural, and $push preserves a null per row
    // that carries none.
    const asserted = new Set<string>();
    for (const entry of group.assertsNoValueFor ?? []) {
      if (!Array.isArray(entry)) continue;
      for (const field of entry) if (typeof field === 'string' && field) asserted.add(field);
    }
    reads.push({
      entityKey,
      scrapeRunId,
      observedAt: group.observedAt,
      assertsNoValueFor: [...asserted],
    });
  }
  return reads;
}

async function loadRunProvenance(
  scrapeRunIds: readonly string[],
): Promise<Map<string, FieldRetractionRunProvenance>> {
  const ids = [...new Set(scrapeRunIds)]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return new Map();
  const rows = (await ScrapeRun.find({ _id: { $in: ids } })
    .select('_id startedAt codeSha')
    .lean()) as Array<{ _id: unknown; startedAt?: unknown; codeSha?: unknown }>;
  const runs = new Map<string, FieldRetractionRunProvenance>();
  for (const row of rows) {
    const id = serializedDocumentId(row._id);
    if (!id) continue;
    runs.set(id, {
      startedAt: row.startedAt instanceof Date ? row.startedAt : undefined,
      codeSha: isFullCommitSha(row.codeSha) ? row.codeSha : undefined,
    });
  }
  return runs;
}

async function loadActiveRetractableObservations(
  sourceName: string,
  retractableFields: readonly string[],
): Promise<FieldRetractionCandidateObservation[]> {
  const rows = (await Observation.find({
    entityType: 'researchEntity',
    sourceName,
    field: { $in: [...retractableFields] },
    superseded: { $ne: true },
    scrapeRunId: { $exists: true, $ne: null },
  })
    .select('_id entityKey entityId field value scrapeRunId observedAt')
    .lean()) as any[];

  const observations: FieldRetractionCandidateObservation[] = [];
  for (const row of rows) {
    const observationId = serializedDocumentId(row._id) || '';
    const entityKey = observationEntityKey(row);
    const scrapeRunId = serializedDocumentId(row.scrapeRunId) || '';
    if (!observationId || !entityKey || !scrapeRunId || !(row.observedAt instanceof Date)) continue;
    observations.push({
      observationId,
      entityKey,
      field: row.field,
      value: row.value,
      scrapeRunId,
      observedAt: row.observedAt,
    });
  }
  return observations;
}

/**
 * Live evidence is counted across ALL sources, not just the retracting one:
 * whether clearing the stored value is safe turns on whether the corpus still has
 * any assertion for that field, and a rival source's assertion is exactly what
 * must stop the clear.
 *
 * A key whose row was merged away stores nothing a student sees: its evidence backs
 * the live survivor its tombstone chain reaches (#3560). So that key's state is the
 * survivor's stored value and locks, and the live evidence counted is every key and
 * id merged into the survivor, since any of them can still refill the field (#3609).
 */
async function loadEntityStates(
  entityKeys: string[],
  retractableFields: readonly string[],
): Promise<FieldRetractionEntityState[]> {
  if (entityKeys.length === 0) return [];
  const selection = [
    'slug',
    'archived',
    'canonicalGroupId',
    'manuallyLockedFields',
    ...retractableFields,
  ].join(' ');
  const keyed = (await ResearchEntity.find({ slug: { $in: entityKeys } })
    .select(selection)
    .lean()) as any[];

  const rowsById = new Map<string, any>(keyed.map((row) => [String(row._id), row]));
  let pending = keyed.filter((row) => row.archived === true && row.canonicalGroupId);
  for (let hop = 0; hop < MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS && pending.length > 0; hop += 1) {
    const unloaded = [...new Set(pending.map((row) => String(row.canonicalGroupId)))].filter(
      (id) => !rowsById.has(id) && mongoose.isValidObjectId(id),
    );
    const loaded =
      unloaded.length > 0
        ? ((await ResearchEntity.find({
            _id: { $in: unloaded.map((id) => new mongoose.Types.ObjectId(id)) },
          })
            .select(selection)
            .lean()) as any[])
        : [];
    for (const row of loaded) rowsById.set(String(row._id), row);
    pending = loaded.filter((row) => row.archived === true && row.canonicalGroupId);
  }
  const findLoadedById = async (id: string) =>
    (rowsById.get(id) as ResearchEntityTombstoneNode | undefined) ?? null;

  const storedRowByKey = new Map<string, any>();
  for (const entity of keyed) {
    const entityKey = typeof entity.slug === 'string' ? entity.slug : '';
    if (!entityKey) continue;
    const storedRow =
      entity.archived === true && entity.canonicalGroupId
        ? ((await walkResearchEntityTombstoneChain(entity, { findById: findLoadedById })) ?? entity)
        : entity;
    storedRowByKey.set(entityKey, storedRow);
  }

  const mergedInBySurvivor = await listResearchEntityMergedInRowsBySurvivor(
    [...storedRowByKey.values()].filter((row) => row.archived !== true).map((row) => row._id),
  );
  const evidenceKeysByStoredRow = new Map<string, { keys: Set<string>; ids: Set<string> }>();
  for (const storedRow of storedRowByKey.values()) {
    const storedRowId = serializedDocumentId(storedRow._id) || '';
    if (!storedRowId || evidenceKeysByStoredRow.has(storedRowId)) continue;
    const merged = mergedInBySurvivor.get(storedRowId) ?? [];
    evidenceKeysByStoredRow.set(storedRowId, {
      keys: new Set(
        [storedRow.slug, ...merged.map((row) => row.slug)].filter(
          (slug): slug is string => typeof slug === 'string' && slug.length > 0,
        ),
      ),
      ids: new Set([storedRowId, ...merged.map((row) => String(row._id))]),
    });
  }
  const allEvidenceKeys = [...evidenceKeysByStoredRow.values()].flatMap(({ keys }) => [...keys]);
  const allEvidenceIds = [...evidenceKeysByStoredRow.values()].flatMap(({ ids }) =>
    [...ids]
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id)),
  );

  const liveEvidence = (await Observation.aggregate([
    {
      $match: {
        entityType: 'researchEntity',
        $or: [{ entityKey: { $in: allEvidenceKeys } }, { entityId: { $in: allEvidenceIds } }],
        field: { $in: [...retractableFields] },
        superseded: { $ne: true },
      },
    },
    {
      $group: {
        _id: { entityKey: '$entityKey', entityId: '$entityId', field: '$field' },
        count: { $sum: 1 },
      },
    },
  ])) as Array<{ _id: { entityKey?: string; entityId?: unknown; field: string }; count: number }>;

  const countsByStoredRow = new Map<string, Record<string, number>>();
  for (const [storedRowId, { keys, ids }] of evidenceKeysByStoredRow) {
    const counts: Record<string, number> = {};
    for (const row of liveEvidence) {
      const entityId = serializedDocumentId(row._id.entityId) || '';
      const backsThisRow = entityId ? ids.has(entityId) : keys.has(String(row._id.entityKey || ''));
      if (backsThisRow) counts[row._id.field] = (counts[row._id.field] ?? 0) + row.count;
    }
    countsByStoredRow.set(storedRowId, counts);
  }

  const states: FieldRetractionEntityState[] = [];
  for (const [entityKey, storedRow] of storedRowByKey) {
    const entityId = serializedDocumentId(storedRow._id) || '';
    if (!entityId) continue;
    const storedValues: Record<string, unknown> = {};
    for (const field of retractableFields) storedValues[field] = storedRow[field];
    states.push({
      entityId,
      entityKey,
      evidenceKeys: [...(evidenceKeysByStoredRow.get(entityId)?.keys ?? [])],
      manuallyLockedFields: Array.isArray(storedRow.manuallyLockedFields)
        ? storedRow.manuallyLockedFields.filter((value: unknown) => typeof value === 'string')
        : [],
      storedValues,
      liveObservationCountByField: countsByStoredRow.get(entityId) ?? {},
    });
  }
  return states;
}

/**
 * The mechanism. It carries no environment switch of its own: the sweep path
 * (`reconcileFieldRetractionsFromRun`) is gated by `SCRAPER_FIELD_RETRACTION`, and
 * the operator path by the script's own apply guard plus confirm flag, so the same
 * action never has two switches that can disagree.
 */
const REDIRECT_LOOP_ERROR_CODES = new Set(['ERR_FR_TOO_MANY_REDIRECTS', 'ERR_TOO_MANY_REDIRECTS']);

const comparableRegistrableHost = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};

/**
 * A different question from "is the host up": does the address we cited still serve
 * the thing we cited? A redirect loop and a landing on another registrable host both
 * answer no, deterministically and repeatably, which is what separates them from the
 * throttle and timeout that `UNKNOWN` exists for.
 *
 * A lapsed academic domain re-registered as an unrelated commercial site is the case
 * that forces this. It answers `200`, so reachability protects it, and it is worse
 * than a dead link precisely because it answers. The same rule retracts a value whose
 * site merely MOVED, which is correct: the stale address stops being asserted and the
 * new one has to be re-acquired as its own observation rather than inherited.
 */
export function citedAddressNoLongerServesTheResource(probe: SourceLinkProbeResult): boolean {
  if (probe.errorCode && REDIRECT_LOOP_ERROR_CODES.has(probe.errorCode)) return true;
  const status = probe.status;
  if (typeof status !== 'number' || status < 200 || status >= 300) return false;
  const requested = comparableRegistrableHost(probe.requestedUrl);
  const landed = comparableRegistrableHost(probe.finalUrl);
  if (!requested || !landed) return false;
  return requested !== landed;
}

/**
 * `UNAVAILABLE` is the only health verdict that licenses removal. `UNKNOWN` covers a
 * throttle, a timeout and a TLS failure, all of which mean a server may well be
 * serving the page, so they are not evidence of absence (#2751).
 */
export async function probeRetractionValueLiveness(value: string): Promise<RetractionProbeVerdict> {
  const probe = await probeSourceLink(value);
  const health = classifySourceLinkHealth(probe);
  return {
    positivelyDead:
      health.healthStatus === 'UNAVAILABLE' || citedAddressNoLongerServesTheResource(probe),
  };
}

export async function reconcileFieldRetractions(options: {
  sourceName: string;
  dryRun?: boolean;
  probeValue?: (value: string) => Promise<RetractionProbeVerdict>;
  commitIsAncestor?: CommitIsAncestor;
}): Promise<FieldRetractionResult> {
  const dryRun = options.dryRun === true;
  const contract = fieldRetractionContractFor(options.sourceName);
  if (!contract) return emptyResult('source-not-retraction-capable', dryRun);

  const activeObservations = await loadActiveRetractableObservations(
    options.sourceName,
    contract.retractableFields,
  );
  const candidateEntityKeys = Array.from(
    new Set(activeObservations.map((observation) => observation.entityKey)),
  );
  const entities = await loadEntityStates(candidateEntityKeys, contract.retractableFields);
  const loadedReads = completeReadsAcrossMergedEvidence(
    await loadCompleteReads(options.sourceName, contract.witnessFields, [
      ...new Set([
        ...candidateEntityKeys,
        ...entities.flatMap((entity) => entity.evidenceKeys ?? []),
      ]),
    ]),
    entities,
  );
  const completeReads =
    (contract.absenceClaimCutoffs ?? []).length > 0
      ? disregardPreFixAbsenceClaims(
          loadedReads,
          contract,
          await loadRunProvenance(loadedReads.map((read) => read.scrapeRunId)),
          options.commitIsAncestor ?? gitCommitIsAncestor,
        )
      : loadedReads;
  if (completeReads.length === 0) {
    return { ...emptyResult('no-complete-reads', dryRun), sourceName: options.sourceName };
  }

  const plan = planFieldRetractions({
    sourceName: options.sourceName,
    contract,
    completeReads,
    activeObservations,
    entities,
  });

  for (const frozen of plan.frozenFields) {
    console.warn(
      `[field-retraction] frozen ${sanitizeLogValue(frozen.sourceName)}.${sanitizeLogValue(frozen.field)}: ${frozen.absentEntities} of ${frozen.assertingEntities} asserting entities would retract (above the drop guard)`,
    );
  }

  const screened = await withholdSoleHolderRetractionsThatStillAnswer(
    plan.retractions,
    options.probeValue ?? probeRetractionValueLiveness,
  );
  plan.counts.soleHolderValueWithheld = screened.withheld.length;
  plan.counts.storedValuesCleared = screened.retained.filter(
    (retraction) => retraction.clearsStoredValue,
  ).length;
  plan.counts.soleHolderValueProbedDead = screened.retained.filter(
    (retraction) =>
      classifyRetractionValueOwnership(retraction.maxEntitiesSharingAValue) === 'sole-holder',
  ).length;
  for (const entry of screened.withheld) {
    console.warn(
      `[field-retraction] withheld ${sanitizeLogValue(options.sourceName)}.${sanitizeLogValue(entry.field)} for one entity: its sole-holder value still answers`,
    );
  }

  if (dryRun) {
    return {
      outcome: 'planned',
      sourceName: options.sourceName,
      dryRun,
      counts: plan.counts,
      frozenFields: plan.frozenFields,
      regatedEntities: 0,
      retractions: screened.retained,
      withheld: screened.withheld,
    };
  }

  const observationIds = screened.retained.flatMap((retraction) => retraction.observationIds);
  if (observationIds.length > 0) {
    await retireObservations(
      { _id: { $in: observationIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      FIELD_RETRACTION_ROLLBACK_REASON,
    );
  }

  const clearedEntityIds: string[] = [];
  for (const retraction of screened.retained) {
    if (!retraction.clearsStoredValue) continue;
    await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(retraction.entityId) },
      {
        $unset: {
          [retraction.field]: '',
          [`fieldProvenance.${retraction.field}`]: '',
        },
      },
    );
    clearedEntityIds.push(retraction.entityId);
  }

  let regatedEntities = 0;
  const regateIds = Array.from(new Set(clearedEntityIds));
  if (regateIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = regateIds.length;
  }

  return {
    outcome: 'reconciled',
    sourceName: options.sourceName,
    dryRun,
    counts: plan.counts,
    frozenFields: plan.frozenFields,
    regatedEntities,
    retractions: screened.retained,
    withheld: screened.withheld,
  };
}

export async function reconcileFieldRetractionsFromRun(
  scrapeRunId: string,
  options: { dryRun?: boolean } = {},
): Promise<FieldRetractionResult> {
  const dryRun = options.dryRun === true;
  if (!fieldRetractionEnabled()) return emptyResult('disabled', dryRun);
  let runObjectId: mongoose.Types.ObjectId;
  try {
    runObjectId = new mongoose.Types.ObjectId(scrapeRunId);
  } catch {
    return emptyResult('invalid-run-id', dryRun);
  }
  const run = (await ScrapeRun.findById(runObjectId).select('sourceName').lean()) as {
    sourceName?: unknown;
  } | null;
  const sourceName = typeof run?.sourceName === 'string' ? run.sourceName : '';
  if (!sourceName) return emptyResult('unknown-run', dryRun);
  return reconcileFieldRetractions({ sourceName, dryRun });
}
