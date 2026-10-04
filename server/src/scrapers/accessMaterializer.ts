/**
 * Derives first-class, source-attributed access Signals from append-only
 * Observations. Contact routes and entry pathways are no longer modeled: the
 * contact action is derived at read time from official links, and browse runs
 * on the research-entity index rather than a separate pathway index.
 */
import mongoose from 'mongoose';
import { attributedArchiveSet } from '../models/entityArchival';
import { Observation, researchEntityObservationSubjects } from '../models/observation';
import { collapseLatestWins } from './observationStore';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { hasPastUndergradAdvisees } from '../services/hostedUndergraduates';
import { isPubliclyUnreachableSourceUrl } from '../services/sourceLinkHealth';
import { serializedDocumentId } from '../utils/idSerialization';
import type { AccessSignalConfidence, AccessSignalType } from '../models/researchAccessTypes';
import { upsertSignal, type UpsertSignalInput } from '../services/signalService';
import { omitSuppressionLockedFields } from '../services/suppressionLockUtils';
import {
  validateAccessArtifactBundle,
  type AccessArtifactCandidate,
} from '../services/claimValidation/accessClaims';
import { RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE } from './undergradEvidenceQuoteValidation';
import {
  isProgrammePageAdmittedAsJoinRoute,
  isSameJoinRoutePage,
  joinRouteKind,
  joinRouteTextAdmits,
  joinRouteUrlRefusal,
  textInvitesUndergraduates,
  type JoinPageEntity,
} from './undergradJoinPageAdmission';
import { isRecruitingOrContactPageUrl } from './undergradRosterEvidence';
import { listResearchEntityMergedInRowsBySurvivor } from '../services/researchEntityCanonicalTombstone';
import { observationIsKeyedToRow, type ContactEvidenceRow } from './rowKeyedContactEvidence';

/**
 * Every access-signal type the materializer has a live emission path for. This
 * is the producer contract: the read/serve layer must never derive a status
 * from a signal type absent here, or that status becomes permanently
 * unreachable (see #1303, POSTED_OPENING). Guarded by accessMaterializer tests.
 */
export const MATERIALIZED_ACCESS_SIGNAL_TYPES: readonly AccessSignalType[] = [
  'CREDIT_FORMALIZATION_POSSIBLE',
  'FACULTY_SUPERVISES_STUDENT_PROJECTS',
  'CURRENT_UNDERGRADS',
  'APPLICATION_FORM_EXISTS',
  'PAST_UNDERGRADS',
  'POSTED_OPENING',
];

const ACCESS_MATERIALIZER_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeAccessMaterializerObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return ACCESS_MATERIALIZER_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

function toAccessMaterializerObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  const id = normalizeAccessMaterializerObjectId(value);
  return id ? new mongoose.Types.ObjectId(id) : undefined;
}

export interface AccessObservation {
  _id?: unknown;
  entityId?: unknown;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceName: string;
  sourceUrl?: string;
  confidence: number;
  observedAt: Date;
}

export interface DerivedAccessSignal extends UpsertSignalInput {
  derivationKey: string;
}

export interface DerivedAccessArtifacts {
  accessSignals: DerivedAccessSignal[];
}

export interface AccessMaterializationResult {
  researchEntityId?: string;
  accessSignals: number;
  staleEvidenceSkipped: number;
  errors: number;
  skipped?: string;
  changes?: AccessSignalChangePlan;
}

export interface AccessArtifactDerivationResult {
  researchEntityId?: string;
  artifacts: DerivedAccessArtifacts;
  observations?: AccessObservation[];
  skipped?: string;
}

export interface StoredAccessSignal {
  _id?: unknown;
  derivationKey?: unknown;
  archived?: unknown;
  archivedReason?: unknown;
  suppression?: { reason?: string; lockedFields?: string[] };
  source?: { evidenceIds?: unknown } | null;
}

export interface CitedAccessEvidenceStatus {
  live: ReadonlySet<string>;
  retired: ReadonlySet<string>;
}

const NO_CITED_EVIDENCE_STATUS: CitedAccessEvidenceStatus = { live: new Set(), retired: new Set() };

export interface AccessSignalChange {
  signalId: string;
  derivationKey: string;
}

export interface AccessSignalChangePlan {
  retired: AccessSignalChange[];
  revived: AccessSignalChange[];
}

export const ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON = 'access-materializer:evidence-withdrawn';

// `signal:APPLICATION_FORM_EXISTS:JOIN_PAGE` is absent on purpose: #4562 left its stored
// rows to be re-cited at serve time until a re-run of the lane is re-measured.
export const EVIDENCE_GOVERNED_ACCESS_SIGNAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'signal:CURRENT_UNDERGRADS': ['currentUndergradCount'],
  'signal:CREDIT_FORMALIZATION_POSSIBLE': ['offersIndependentStudy', 'independentStudyCourses'],
  'signal:FACULTY_SUPERVISES_STUDENT_PROJECTS:SENIOR_THESIS': [
    'offersIndependentStudy',
    'independentStudyCourses',
  ],
  'signal:PAST_UNDERGRADS': ['pastUndergradAdvisees'],
};

function observationId(obs: AccessObservation): string | undefined {
  return serializedDocumentId(obs._id);
}

function maxConfidence(observations: AccessObservation[]): number {
  if (observations.length === 0) return 0;
  return Math.max(...observations.map((obs) => Number(obs.confidence) || 0));
}

function latestObservedAt(observations: AccessObservation[]): Date {
  const times = observations
    .map((obs) => new Date(obs.observedAt).getTime())
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return new Date();
  return new Date(Math.max(...times));
}

function confidenceLabel(score: number): AccessSignalConfidence {
  if (score >= 0.75) return 'HIGH';
  if (score >= 0.45) return 'MEDIUM';
  return 'LOW';
}

function firstString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstUrlValue(value: unknown): string {
  const url = firstString(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function undergradAccessVerdict(value: unknown): 'yes' | 'no' | 'unclear' {
  if (!value || typeof value !== 'object') return 'unclear';
  const verdict = (value as { openToUndergrads?: unknown }).openToUndergrads;
  return verdict === 'yes' || verdict === 'no' ? verdict : 'unclear';
}

function undergradAccessEvidenceQuote(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return firstString((value as { evidenceQuote?: unknown }).evidenceQuote);
}

export interface ParsedPostedOpening {
  title: string;
  applyUrl: string;
  deadline: Date;
  evidenceQuote?: string;
}

function toHttpUrl(value: unknown): string {
  return firstUrlValue(value);
}

function toFutureAwareDeadline(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  const text = firstString(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

/**
 * Parse a producer-emitted `postedOpening` observation value into a validated
 * posting, or return null. A posting is only honored when it carries all four
 * evidence-first requirements (#1568): a title, an apply route (http(s) URL), a
 * resolvable hiring home (the observation is keyed to a research entity, so
 * that requirement is satisfied by the caller), and an application deadline.
 * Undated or apply-routeless postings fail closed so a scraped page can never
 * manufacture a top-tier "Apply" signal (the #1332 failure mode).
 */
export function parsePostedOpening(value: unknown): ParsedPostedOpening | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const title = firstString(record.title);
  const applyUrl = toHttpUrl(record.applyUrl);
  const deadline = toFutureAwareDeadline(record.deadline);
  if (!title || !applyUrl || !deadline) return null;
  const evidenceQuote = firstString(record.evidenceQuote) || undefined;
  return { title, applyUrl, deadline, evidenceQuote };
}

function postedOpeningDerivationKey(applyUrl: string): string {
  return `signal:POSTED_OPENING:${applyUrl}`;
}

function postedOpeningExcerpt(posting: ParsedPostedOpening): string {
  const deadlineLabel = posting.deadline.toISOString().slice(0, 10);
  const base = `${posting.title}. Apply by ${deadlineLabel}.`;
  return posting.evidenceQuote ? `${base} ${posting.evidenceQuote}` : base;
}

function isPositiveBoolean(obs: AccessObservation): boolean {
  return obs.value === true;
}

function isCourseArray(value: unknown): value is Array<{ code?: string; title?: string }> {
  return Array.isArray(value) && value.length > 0;
}

function isSeniorProjectCourse(course: { code?: string; title?: string }): boolean {
  const title = (course.title || '').trim();
  return /senior (essay|thesis|project)/i.test(title);
}

function undergradCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bestObservation(observations: AccessObservation[]): AccessObservation | undefined {
  return [...observations].sort((a, b) => {
    const byConfidence = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
    if (byConfidence !== 0) return byConfidence;
    return new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime();
  })[0];
}

function makeSignal(input: {
  researchEntityId: string;
  derivationKey: string;
  type: AccessSignalType;
  score: number;
  observations: AccessObservation[];
  excerpt?: string;
  sourceUrl?: string;
  expiresAt?: Date;
}): DerivedAccessSignal {
  const obs = bestObservation(input.observations);
  const sourceEvidenceId = obs ? observationId(obs) : undefined;
  return {
    researchEntityId: input.researchEntityId,
    derivationKey: input.derivationKey,
    type: input.type,
    confidence: confidenceLabel(input.score),
    confidenceScore: input.score,
    sourceEvidenceId: sourceEvidenceId || '',
    observedAt: latestObservedAt(input.observations),
    expiresAt: input.expiresAt,
    excerpt: input.excerpt,
    sourceName: obs?.sourceName,
    sourceUrl: input.sourceUrl || obs?.sourceUrl,
    originalConfidence: obs?.confidence,
  };
}

function uniqueByDerivationKey<T extends { derivationKey: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.derivationKey, item])).values());
}

function accessArtifactCandidatesFromDerived(
  artifacts: DerivedAccessArtifacts,
): AccessArtifactCandidate[] {
  return artifacts.accessSignals.map((signal): AccessArtifactCandidate => ({
    artifactType: 'AccessSignal',
    researchEntityId: signal.researchEntityId,
    derivationKey: signal.derivationKey,
    signalType: signal.type,
    sourceEvidenceIds: [signal.sourceEvidenceId].filter((id): id is string => Boolean(id)),
    sourceUrls: [signal.sourceUrl].filter((url): url is string => Boolean(url)),
    sourceName: signal.sourceName,
    sourceUrl: signal.sourceUrl,
  }));
}

function filterArtifactsByValidatedClaims(
  artifacts: DerivedAccessArtifacts,
): DerivedAccessArtifacts {
  const validation = validateAccessArtifactBundle(accessArtifactCandidatesFromDerived(artifacts));
  const acceptedKeys = new Set(
    validation.accepted.map(
      (result) => `${result.claim.artifactType}:${result.claim.derivationKey}`,
    ),
  );
  return {
    accessSignals: artifacts.accessSignals.filter((signal) =>
      acceptedKeys.has(`AccessSignal:${signal.derivationKey}`),
    ),
  };
}

interface AccessQuotePage {
  sourceName: string;
  url: string;
  quote: string;
}

// The lane records the sentence that admitted its join page beside the verdict, so the page
// is judged on its own words as well as on the one quote the model chose.
function accessQuotePages(obs: AccessObservation): AccessQuotePage[] {
  const value = (obs.value || {}) as {
    quoteSourceUrl?: unknown;
    joinPageUrl?: unknown;
    joinPageInvitation?: unknown;
  };
  const pages = [
    {
      sourceName: obs.sourceName,
      url: toHttpUrl(value.quoteSourceUrl) || toHttpUrl(obs.sourceUrl),
      quote: undergradAccessEvidenceQuote(obs.value),
    },
  ];
  const invitation = firstString(value.joinPageInvitation);
  const joinPageUrl = toHttpUrl(value.joinPageUrl);
  if (invitation && joinPageUrl) {
    pages.push({ sourceName: obs.sourceName, url: joinPageUrl, quote: invitation });
  }
  return pages;
}

/**
 * The page an application signal cites for one `joinPageUrl` observation, or none (#4543).
 * The lane names the join page as the observation's value and records the page it was
 * reading as its source, so the value is the citation: 212 of 554 stored join-page signals
 * on served rows cited the page read instead. A source that quotes its access evidence
 * must back the page with a quote on it that `joinRouteTextAdmits` for the page's kind, or,
 * for a join page, a quote anywhere on the row that invites undergraduates by name. A
 * department's own undergraduate research programme names its audience in its address and
 * needs no quote, and a source that quotes nothing, such as a department page's
 * application form, is judged on the address alone.
 * When the named page fails, the row's home page or profile is the route if its quote
 * invites undergraduates by name.
 */
function joinRouteCitation(
  obs: AccessObservation,
  rowQuotePages: readonly AccessQuotePage[],
  entity?: JoinPageEntity,
): string | undefined {
  const joinPageUrl = firstUrlValue(obs.value);
  if (!joinPageUrl) return undefined;
  const quotePages = rowQuotePages.filter(
    (page) => page.sourceName === obs.sourceName && page.quote,
  );
  if (!joinRouteUrlRefusal(joinPageUrl, entity)) {
    if (quotePages.length === 0) return joinPageUrl;
    if (isProgrammePageAdmittedAsJoinRoute(joinPageUrl, entity)) return joinPageUrl;
    const quotesOnJoinPage = quotePages
      .filter((page) => isSameJoinRoutePage(page.url, joinPageUrl))
      .map((page) => page.quote);
    const kind = joinRouteKind(joinPageUrl, entity);
    const admitted =
      quotesOnJoinPage.some((quote) => joinRouteTextAdmits(kind, quote)) ||
      (kind === 'join-page' && quotePages.some((page) => textInvitesUndergraduates(page.quote)));
    if (admitted) return joinPageUrl;
  }
  return quotePages.find(
    (page) =>
      joinRouteKind(page.url, entity) === 'home-or-profile' &&
      textInvitesUndergraduates(page.quote) &&
      !joinRouteUrlRefusal(page.url, entity),
  )?.url;
}

export function deriveAccessArtifactsFromObservations(
  researchEntityId: string,
  observations: AccessObservation[],
  entity?: JoinPageEntity,
): DerivedAccessArtifacts {
  const byField = new Map<string, AccessObservation[]>();
  for (const obs of observations) {
    if (obs.field) {
      byField.set(obs.field, [...(byField.get(obs.field) || []), obs]);
    }
  }

  const accessSignals: DerivedAccessSignal[] = [];

  const independentStudyObservations = [
    ...(byField.get('offersIndependentStudy') || []).filter(isPositiveBoolean),
    ...(byField.get('independentStudyCourses') || []).filter((obs) => isCourseArray(obs.value)),
  ];
  if (independentStudyObservations.length > 0) {
    const score = maxConfidence(independentStudyObservations);
    const courseObs = (byField.get('independentStudyCourses') || []).find((obs) =>
      isCourseArray(obs.value),
    );
    const courses = isCourseArray(courseObs?.value) ? courseObs.value : [];
    const seniorProjectCourses = courses.filter(isSeniorProjectCourse);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CREDIT_FORMALIZATION_POSSIBLE',
        type: 'CREDIT_FORMALIZATION_POSSIBLE',
        score,
        observations: independentStudyObservations,
        excerpt: courses
          .map((course) => [course.code, course.title].filter(Boolean).join(' '))
          .join('; '),
      }),
    );

    if (seniorProjectCourses.length > 0) {
      accessSignals.push(
        makeSignal({
          researchEntityId,
          derivationKey: 'signal:FACULTY_SUPERVISES_STUDENT_PROJECTS:SENIOR_THESIS',
          type: 'FACULTY_SUPERVISES_STUDENT_PROJECTS',
          score,
          observations: independentStudyObservations,
          excerpt: seniorProjectCourses
            .map((course) => [course.code, course.title].filter(Boolean).join(' '))
            .join('; '),
        }),
      );
    }
  }

  // The retired cache-backfill lane carried no roster snippet a count could be checked
  // against, so its counts cannot back a current-undergraduates signal (#3789). A count
  // citing a recruiting or contact page was read from a page that lists no one (#4430).
  // Collapsed first, like the join page below, so a lane's newer read replaces the count an
  // older read of a merged-in row stated instead of standing beside it.
  const currentUndergradObservations = collapseLatestWins(
    byField.get('currentUndergradCount') || [],
    'researchEntity',
  ).filter(
    (obs) =>
      undergradCount(obs.value) > 0 &&
      obs.sourceName !== RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE &&
      !isRecruitingOrContactPageUrl(obs.sourceUrl),
  );
  if (currentUndergradObservations.length > 0) {
    const score = maxConfidence(currentUndergradObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CURRENT_UNDERGRADS',
        type: 'CURRENT_UNDERGRADS',
        score,
        observations: currentUndergradObservations,
        excerpt: `${undergradCount(bestObservation(currentUndergradObservations)?.value)} current undergraduate(s) listed`,
      }),
    );
  }

  // Undergraduate access is read only from `undergradAccessEvidence`, which carries
  // a verdict, the quote that backs it and the page the quote came from. The retired
  // `acceptingUndergrads` boolean carried none of those, so the source allowlists and
  // the two-independent-source corroboration rule that used to compensate for a bare
  // `true` were retired with the field rather than carried onto the evidence object
  // (#2055).
  const undergradAccessEvidence = byField.get('undergradAccessEvidence') || [];
  const positiveAccessEvidence = undergradAccessEvidence.filter(
    (obs) => undergradAccessVerdict(obs.value) === 'yes',
  );
  // Collapsed before admission, so a lane's newer read that found no admissible join page
  // (an empty value) replaces the page an older read named instead of standing beside it.
  const quotePages = positiveAccessEvidence.flatMap(accessQuotePages);
  const joinRoutes = collapseLatestWins(byField.get('joinPageUrl') || [], 'researchEntity')
    .map((obs) => ({ obs, citation: joinRouteCitation(obs, quotePages, entity) }))
    .filter((route): route is { obs: AccessObservation; citation: string } =>
      Boolean(route.citation),
    );
  if (joinRoutes.length > 0 && positiveAccessEvidence.length > 0) {
    const joinPageObservations = joinRoutes.map((route) => route.obs);
    const best = bestObservation(joinPageObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
        type: 'APPLICATION_FORM_EXISTS',
        score: maxConfidence(joinPageObservations),
        observations: joinPageObservations,
        excerpt: 'A join, opportunities, or application page was found.',
        sourceUrl: joinRoutes.find((route) => route.obs === best)?.citation,
      }),
    );
  }

  const pastAdviseeObservations = (byField.get('pastUndergradAdvisees') || []).filter((obs) =>
    hasPastUndergradAdvisees(obs.value),
  );
  if (pastAdviseeObservations.length > 0) {
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:PAST_UNDERGRADS',
        type: 'PAST_UNDERGRADS',
        score: maxConfidence(pastAdviseeObservations),
        observations: pastAdviseeObservations,
      }),
    );
  }
  const postedOpeningObservations = (byField.get('postedOpening') || []).filter(
    (obs) => parsePostedOpening(obs.value) !== null,
  );
  const seenPostingKeys = new Set<string>();
  for (const postingObs of postedOpeningObservations) {
    const posting = parsePostedOpening(postingObs.value);
    if (!posting) continue;
    const derivationKey = postedOpeningDerivationKey(posting.applyUrl);
    if (seenPostingKeys.has(derivationKey)) continue;
    seenPostingKeys.add(derivationKey);
    const score = Math.max(Number(postingObs.confidence) || 0, 0.75);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey,
        type: 'POSTED_OPENING',
        score,
        observations: [postingObs],
        excerpt: postedOpeningExcerpt(posting),
        sourceUrl: posting.applyUrl,
        expiresAt: posting.deadline,
      }),
    );
  }

  return filterArtifactsByValidatedClaims({
    accessSignals: uniqueByDerivationKey(accessSignals),
  });
}

const GRANT_OR_DIRECTORY_ONLY_HOST =
  /(reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov|api\.nsf\.gov|orcid\.org)$/i;

function isGrantOrOrcidOnlyUrl(value: string): boolean {
  try {
    return GRANT_OR_DIRECTORY_ONLY_HOST.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * First official, non-grant http(s) URL describing the research home, skipping
 * any the corpus already knows is gone.
 *
 * The link-health check is not cosmetic: this URL is what the visibility gate
 * reads as proof the entity has a way in, while the detail page hides a link
 * whose stored verdict says it is dead. Without it the two halves disagree, and
 * an entity is published on the strength of a link the same product then
 * refuses to render (#2531). An unprobed URL still counts - absence of a verdict
 * is not evidence of death, and failing closed on silence would demote every
 * entity whose links have not been probed yet.
 *
 * "Gone" is not the only way a link fails to be a way in. A host that resolves
 * only into private address space is alive and unopenable at the same time, and
 * because that refusal records no liveness verdict it read here as an unprobed
 * URL and therefore as proof of access (#2556). The URL stays a legitimate
 * citation - it is real provenance - but it may not be the thing that makes an
 * entity publishable, which is why the skip happens in this projection rather
 * than by deleting the citation.
 */
export function officialNonGrantSourceUrl(entity: {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
  sourceLinkHealth?: unknown;
}): string {
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]
    .map(firstString)
    .filter((url) => /^https?:\/\//i.test(url));
  return (
    urls.find(
      (url) =>
        !isGrantOrOrcidOnlyUrl(url) &&
        !isPubliclyUnreachableSourceUrl(entity.sourceLinkHealth, url),
    ) || ''
  );
}

async function resolveResearchEntityId(identifier: {
  researchEntityId?: string;
  entityKey?: string;
}): Promise<string | null> {
  const researchEntityId = normalizeAccessMaterializerObjectId(identifier.researchEntityId);
  if (researchEntityId) return researchEntityId;
  if (!identifier.entityKey) return null;
  const group: any = await ResearchEntity.findOne(
    { slug: identifier.entityKey },
    { _id: 1 },
  ).lean();
  return normalizeAccessMaterializerObjectId(group?._id) || null;
}

/**
 * An empty observation read yields no signals here, and that is a no-op rather
 * than a retraction: `materializeAccessForResearchGroup` archives a signal it did
 * not derive only when the read holds that signal's own evidence fields (#3921)
 * or every observation the signal cites was superseded or rolled back (#3920),
 * so an empty store archives nothing and an empty read archives only signals
 * whose cited evidence was withdrawn. So do NOT move an observation-store
 * availability guard into this function, which #2514 proposed. Three paths reach
 * the read below without supplying observations - the reconcile lane, the entity
 * materializer through the wrapper, and the orphan-reference repair's
 * `rematerialize_access` recovery - so a throw here would abort a scrape over a
 * condition only the reconcile lane is endangered by. The guard belongs where an
 * empty read becomes a retirement, which is that lane.
 */
export async function deriveAccessArtifactsForResearchGroup(
  identifier: { researchEntityId?: string; entityKey?: string },
  inputObservations?: AccessObservation[],
): Promise<AccessArtifactDerivationResult> {
  const researchEntityId = await resolveResearchEntityId(identifier);
  if (!researchEntityId) {
    return {
      artifacts: { accessSignals: [] },
      skipped: 'research-entity-not-found',
    };
  }
  const researchEntityObjectId = toAccessMaterializerObjectId(researchEntityId);
  if (!researchEntityObjectId) {
    return {
      artifacts: { accessSignals: [] },
      skipped: 'research-entity-not-found',
    };
  }

  const observations =
    inputObservations ||
    ((await Observation.find({
      entityType: { $in: researchEntityObservationSubjects },
      superseded: false,
      $or: [
        { entityId: researchEntityObjectId },
        identifier.entityKey ? { entityKey: identifier.entityKey } : {},
      ].filter((clause) => Object.keys(clause).length > 0),
    }).lean()) as unknown as AccessObservation[]);

  const entity = observations.some((obs) => obs.field === 'joinPageUrl')
    ? ((await ResearchEntity.findOne(
        { _id: researchEntityObjectId },
        { entityType: 1, kind: 1, websiteUrl: 1, departments: 1, name: 1, slug: 1 },
      ).lean()) as JoinPageEntity | null)
    : null;
  const artifacts = deriveAccessArtifactsFromObservations(
    researchEntityId,
    observations,
    entity ?? undefined,
  );

  return { researchEntityId, artifacts, observations };
}

function archiveIsSuppressionLocked(signal: StoredAccessSignal): boolean {
  return !('archived' in omitSuppressionLockedFields({ archived: true }, signal));
}

function citedEvidenceIds(signal: StoredAccessSignal): string[] {
  const ids = signal.source?.evidenceIds;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => serializedDocumentId(id)).filter((id): id is string => Boolean(id));
}

export function planEvidenceGovernedSignalChanges(
  derivedKeys: ReadonlySet<string>,
  observations: readonly AccessObservation[],
  stored: readonly StoredAccessSignal[],
  citedEvidence: CitedAccessEvidenceStatus = NO_CITED_EVIDENCE_STATUS,
): AccessSignalChangePlan {
  const fieldsRead = new Set(observations.map((obs) => obs.field));
  const idsRead = new Set(
    observations.map((obs) => observationId(obs)).filter((id): id is string => Boolean(id)),
  );
  const citesLiveEvidenceThisReadMissed = (cited: readonly string[]) =>
    cited.some((id) => citedEvidence.live.has(id) && !idsRead.has(id));
  const citedEvidenceWasWithdrawn = (cited: readonly string[]) =>
    cited.length > 0 && cited.every((id) => citedEvidence.retired.has(id));
  const plan: AccessSignalChangePlan = { retired: [], revived: [] };
  for (const signal of stored) {
    const derivationKey = firstString(signal.derivationKey);
    const evidenceFields = EVIDENCE_GOVERNED_ACCESS_SIGNAL_FIELDS[derivationKey];
    const signalId = serializedDocumentId(signal._id);
    if (!evidenceFields || !signalId || archiveIsSuppressionLocked(signal)) continue;
    const derived = derivedKeys.has(derivationKey);
    if (signal.archived === true) {
      if (derived && signal.archivedReason === ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON) {
        plan.revived.push({ signalId, derivationKey });
      }
      continue;
    }
    if (derived) continue;
    const cited = citedEvidenceIds(signal);
    if (citesLiveEvidenceThisReadMissed(cited)) continue;
    if (evidenceFields.some((field) => fieldsRead.has(field)) || citedEvidenceWasWithdrawn(cited)) {
      plan.retired.push({ signalId, derivationKey });
    }
  }
  return plan;
}

async function storedEvidenceGovernedSignals(
  researchEntityId: string,
): Promise<StoredAccessSignal[]> {
  return (await Signal.find({
    researchEntityId: toAccessMaterializerObjectId(researchEntityId),
    derivationKey: { $in: Object.keys(EVIDENCE_GOVERNED_ACCESS_SIGNAL_FIELDS) },
  })
    .select('_id type derivationKey archived archivedReason suppression source.evidenceIds')
    .lean()) as unknown as StoredAccessSignal[];
}

async function citedAccessEvidenceStatus(
  stored: readonly StoredAccessSignal[],
): Promise<CitedAccessEvidenceStatus> {
  const ids = [...new Set(stored.flatMap(citedEvidenceIds))]
    .map((id) => toAccessMaterializerObjectId(id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  if (ids.length === 0) return NO_CITED_EVIDENCE_STATUS;
  const found = (await Observation.find({ _id: { $in: ids } })
    .select('_id superseded rollback.rolledBackAt')
    .lean()) as Array<{ _id?: unknown; superseded?: boolean; rollback?: { rolledBackAt?: Date } }>;
  const live = new Set<string>();
  const retired = new Set<string>();
  for (const observation of found) {
    const id = serializedDocumentId(observation._id);
    if (!id) continue;
    if (observation.superseded === true || observation.rollback?.rolledBackAt) retired.add(id);
    else live.add(id);
  }
  return { live, retired };
}

async function applyAccessSignalChanges(
  accessSignals: readonly DerivedAccessSignal[],
  changes: AccessSignalChangePlan,
): Promise<void> {
  const revivedKeys = new Set(changes.revived.map((change) => change.derivationKey));
  for (const signal of accessSignals) {
    await upsertSignal(
      revivedKeys.has(signal.derivationKey) ? { ...signal, archived: false } : signal,
    );
  }
  if (changes.retired.length === 0) return;
  await Signal.updateMany(
    {
      _id: { $in: changes.retired.map((change) => toAccessMaterializerObjectId(change.signalId)) },
      archived: { $ne: true },
    },
    {
      $set: attributedArchiveSet(ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON, {
        lastMaterializedAt: new Date(),
      }),
    },
  );
}

// The pass reads only this row's own observations, but a merged-in row's evidence still
// derives a re-derived type at serve time (`judgeReDerivedAccessSignals`), so retiring on
// the pass alone would archive a signal the detail route serves (#4580).
async function withoutRetirementsMergedInEvidenceDerives(
  researchEntityId: string,
  changes: AccessSignalChangePlan,
  stored: readonly StoredAccessSignal[],
): Promise<AccessSignalChangePlan> {
  const storedById = new Map(stored.map((signal) => [serializedDocumentId(signal._id), signal]));
  const reDerived = changes.retired
    .map(
      (change) =>
        storedById.get(change.signalId) as (StoredAccessSignal & { type?: unknown }) | undefined,
    )
    .filter(
      (signal): signal is StoredAccessSignal & { type?: unknown } =>
        Boolean(signal) && isReDerivedAccessSignalType(signal?.type),
    );
  if (reDerived.length === 0) return changes;
  const row = (await ResearchEntity.findOne(
    { _id: toAccessMaterializerObjectId(researchEntityId) },
    { entityType: 1, kind: 1, websiteUrl: 1, departments: 1, name: 1, slug: 1 },
  ).lean()) as AccessEvidenceRow | null;
  if (!row) return changes;
  const { underived } = await judgeReDerivedAccessSignals(
    reDerived.map((signal) => ({ ...signal, researchEntityId })),
    [row],
  );
  const stillDerived = new Set(
    reDerived
      .map((signal) => serializedDocumentId(signal._id))
      .filter((id): id is string => Boolean(id) && !underived.has(id as string)),
  );
  return {
    ...changes,
    retired: changes.retired.filter((change) => !stillDerived.has(change.signalId)),
  };
}

export async function materializeAccessForResearchGroup(
  identifier: { researchEntityId?: string; entityKey?: string },
  inputObservations?: AccessObservation[],
  options: { dryRun?: boolean } = {},
): Promise<AccessMaterializationResult> {
  const derivation = await deriveAccessArtifactsForResearchGroup(identifier, inputObservations);
  if (!derivation.researchEntityId) {
    return {
      researchEntityId: undefined,
      accessSignals: 0,
      staleEvidenceSkipped: 0,
      errors: 0,
      skipped: derivation.skipped || 'research-entity-not-found',
    };
  }
  const { researchEntityId, artifacts } = derivation;
  const stored = await storedEvidenceGovernedSignals(researchEntityId);
  const planned = planEvidenceGovernedSignalChanges(
    new Set(artifacts.accessSignals.map((signal) => signal.derivationKey)),
    derivation.observations ?? [],
    stored,
    await citedAccessEvidenceStatus(stored),
  );
  const changes = await withoutRetirementsMergedInEvidenceDerives(
    researchEntityId,
    planned,
    stored,
  );
  if (!options.dryRun) await applyAccessSignalChanges(artifacts.accessSignals, changes);

  return {
    researchEntityId,
    accessSignals: artifacts.accessSignals.length,
    staleEvidenceSkipped: 0,
    errors: 0,
    changes,
  };
}

const idText = (value: unknown): string => (value == null ? '' : String(value).trim());

/**
 * The signal types whose stored copies are re-derived at read time. Each is minted only by
 * this materializer, from the fields below, so a type the row's live evidence no longer
 * derives is a claim nothing backs any more (#4430): a retired lane's count, a count a
 * later read replaced with zero, or a join page an admission rule now refuses. Measured
 * on Development, 223 of 528 served join-page signals and 90 of 246 served
 * current-undergraduate signals had no live evidence on their row that derived them.
 */
export const RE_DERIVED_ACCESS_SIGNAL_TYPES: readonly AccessSignalType[] = [
  'APPLICATION_FORM_EXISTS',
  'CURRENT_UNDERGRADS',
];

const RE_DERIVED_ACCESS_SIGNAL_FIELDS = [
  'joinPageUrl',
  'undergradAccessEvidence',
  'currentUndergradCount',
];

interface ReDerivedSignalLike {
  _id?: unknown;
  researchEntityId?: unknown;
  type?: unknown;
}

export interface AccessEvidenceRow extends JoinPageEntity {
  _id?: unknown;
  slug?: unknown;
}

const isReDerivedAccessSignalType = (type: unknown): boolean =>
  RE_DERIVED_ACCESS_SIGNAL_TYPES.includes(type as AccessSignalType);

export interface ReDerivedAccessSignalJudgement {
  underived: Set<string>;
  citations: Map<string, string>;
}

// A stored signal this materializer would no longer derive is withheld at serve time and
// not counted by the gate. The next pass also withdraws a current-undergraduates one
// (#4580); a join page's stored row stays as history. A merged-in row's evidence still
// counts, because the dedupe merge carries its signals onto the survivor.
export async function underivedAccessSignalIds(
  signals: readonly ReDerivedSignalLike[],
  rows: readonly AccessEvidenceRow[],
): Promise<Set<string>> {
  return (await judgeReDerivedAccessSignals(signals, rows)).underived;
}

/**
 * `underived` as above, and for each stored application signal the live evidence still
 * derives, the join page that derivation cites (#4543). A stored signal keeps the page its
 * last materialization recorded, often the page the lane was reading rather than the join
 * page it found, so the detail route serves the derived page and a re-cite needs no write.
 */
export async function judgeReDerivedAccessSignals(
  signals: readonly ReDerivedSignalLike[],
  rows: readonly AccessEvidenceRow[],
): Promise<ReDerivedAccessSignalJudgement> {
  const rowsById = new Map(rows.map((row) => [idText(row._id), row]));
  const judged = signals.filter(
    (signal) =>
      isReDerivedAccessSignalType(signal.type) && rowsById.has(idText(signal.researchEntityId)),
  );
  if (judged.length === 0) return { underived: new Set(), citations: new Map() };
  const rowIds = Array.from(new Set(judged.map((signal) => idText(signal.researchEntityId))));
  const mergedInBySurvivor = await listResearchEntityMergedInRowsBySurvivor(rowIds);
  const evidenceRowsById = new Map<string, ContactEvidenceRow[]>(
    rowIds.map((rowId) => [
      rowId,
      [rowsById.get(rowId) as ContactEvidenceRow, ...(mergedInBySurvivor.get(rowId) || [])],
    ]),
  );
  const evidenceRows = Array.from(evidenceRowsById.values()).flat();
  const objectIds = evidenceRows
    .map((row) => toAccessMaterializerObjectId(row._id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const slugs = evidenceRows.map((row) => idText(row.slug)).filter(Boolean);
  const liveObservations = (await Observation.find({
    entityType: { $in: researchEntityObservationSubjects },
    superseded: false,
    field: { $in: RE_DERIVED_ACCESS_SIGNAL_FIELDS },
    $or: [{ entityId: { $in: objectIds } }, { entityKey: { $in: slugs } }],
  }).lean()) as unknown as AccessObservation[];

  const derivedTypesByRow = new Map<string, Set<AccessSignalType>>();
  const derivedCitationByRowType = new Map<string, string>();
  for (const rowId of rowIds) {
    const keyedRows = evidenceRowsById.get(rowId) || [];
    const rowObservations = liveObservations.filter((observation) =>
      keyedRows.some((row) => observationIsKeyedToRow(observation, row)),
    );
    const derived = deriveAccessArtifactsFromObservations(
      rowId,
      rowObservations,
      rowsById.get(rowId),
    );
    derivedTypesByRow.set(rowId, new Set(derived.accessSignals.map((signal) => signal.type)));
    for (const signal of derived.accessSignals) {
      if (signal.type === 'APPLICATION_FORM_EXISTS' && signal.sourceUrl) {
        derivedCitationByRowType.set(`${rowId}:${signal.type}`, signal.sourceUrl);
      }
    }
  }

  const underived = new Set<string>();
  const citations = new Map<string, string>();
  for (const signal of judged) {
    const rowId = idText(signal.researchEntityId);
    if (!derivedTypesByRow.get(rowId)?.has(signal.type as AccessSignalType)) {
      underived.add(idText(signal._id));
      continue;
    }
    const citation = derivedCitationByRowType.get(`${rowId}:${String(signal.type)}`);
    if (citation) citations.set(idText(signal._id), citation);
  }
  return { underived, citations };
}
