/**
 * Derives first-class, source-attributed access Signals from append-only
 * Observations. Contact routes and entry pathways are no longer modeled: the
 * contact action is derived at read time from official links, and browse runs
 * on the research-entity index rather than a separate pathway index.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchEntityRoster } from '../services/researchEntityMembershipAccessor';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import type { AccessSignalConfidence, AccessSignalType } from '../models/researchAccessTypes';
import { upsertSignal, type UpsertSignalInput } from '../services/signalService';
import {
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
} from '../services/accessAcceptanceLevel';
import {
  validateAccessArtifactBundle,
  type AccessArtifactCandidate,
} from '../services/claimValidation/accessClaims';
import {
  isExplicitUndergradUnavailabilityPhrase,
  isPlausibleUndergradEvidenceQuote,
} from './undergradEvidenceQuoteValidation';

export { isExplicitUndergradUnavailabilityPhrase };

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
  'REACH_OUT_PLAUSIBLE',
  'NOT_CURRENTLY_AVAILABLE',
  'APPLICATION_FORM_EXISTS',
  'CONTACT_INSTRUCTIONS_EXIST',
  'PAST_UNDERGRADS',
  'FELLOWSHIP_COMPATIBLE',
  'POSTED_OPENING',
];

const ENTITY_DISCOVERY_ONLY_SOURCES = new Set(['ysm-atoz-index', 'yse-centers-index']);

const PATHWAY_SPECIFIC_ACCEPTING_SOURCES = new Set(['undergrad-fellowships-recipients']);
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
}

export interface AccessArtifactDerivationResult {
  researchEntityId?: string;
  artifacts: DerivedAccessArtifacts;
  skipped?: string;
}

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

function publicExcerpt(value: unknown): string | undefined {
  return sanitizeEvidenceExcerpt(firstString(value)) || undefined;
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

function isNegativeBoolean(obs: AccessObservation): boolean {
  return obs.value === false;
}

function isCourseArray(value: unknown): value is Array<{ code?: string; title?: string }> {
  return Array.isArray(value) && value.length > 0;
}

function isSeniorProjectCourse(course: { code?: string; title?: string }): boolean {
  const title = (course.title || '').trim();
  return /senior (essay|thesis|project)/i.test(title);
}

function hasPastAdvisees(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const count = Number((row as any).count ?? 1);
    return count > 0;
  });
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

function contactSignalExcerpt(input: {
  contactName: string;
  contactRole: string;
  contactEmail: string;
}): string {
  const parts = [input.contactName, input.contactRole].filter(Boolean);
  if (parts.length > 0) return `Official contact listed: ${parts.join(', ')}.`;
  if (input.contactEmail) return 'Official contact email listed.';
  return 'Official contact listed.';
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
  return artifacts.accessSignals.map(
    (signal): AccessArtifactCandidate => ({
      artifactType: 'AccessSignal',
      researchEntityId: signal.researchEntityId,
      derivationKey: signal.derivationKey,
      signalType: signal.type,
      sourceEvidenceIds: [signal.sourceEvidenceId].filter((id): id is string => Boolean(id)),
      sourceUrls: [signal.sourceUrl].filter((url): url is string => Boolean(url)),
      sourceName: signal.sourceName,
      sourceUrl: signal.sourceUrl,
    }),
  );
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

export function deriveAccessArtifactsFromObservations(
  researchEntityId: string,
  observations: AccessObservation[],
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
  const independentStudySourceNames = new Set(
    independentStudyObservations.map((obs) => obs.sourceName),
  );
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

  const currentUndergradObservations = (byField.get('currentUndergradCount') || []).filter(
    (obs) => undergradCount(obs.value) > 0,
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

  const acceptingObservations = (byField.get('acceptingUndergrads') || []).filter(
    (obs) =>
      !ENTITY_DISCOVERY_ONLY_SOURCES.has(obs.sourceName) &&
      !PATHWAY_SPECIFIC_ACCEPTING_SOURCES.has(obs.sourceName) &&
      !independentStudySourceNames.has(obs.sourceName),
  );
  const undergradAccessEvidence = byField.get('undergradAccessEvidence') || [];
  const positiveAccessEvidence = undergradAccessEvidence.filter(
    (obs) => undergradAccessVerdict(obs.value) === 'yes',
  );
  const negativeAccessEvidence = undergradAccessEvidence.filter(
    (obs) => undergradAccessVerdict(obs.value) === 'no',
  );
  const positiveAccepting = [
    ...acceptingObservations.filter(isPositiveBoolean),
    ...positiveAccessEvidence,
  ];
  const plausibleUndergradEvidenceQuote = (byField.get('undergradEvidenceQuote') || []).filter(
    (obs) => typeof obs.value !== 'string' || isPlausibleUndergradEvidenceQuote(obs.value),
  );
  const undergradAccessQuote =
    publicExcerpt(bestObservation(byField.get('undergradRoleEvidenceQuote') || [])?.value) ||
    publicExcerpt(bestObservation(plausibleUndergradEvidenceQuote)?.value);
  const independentPositiveSources = new Set(
    positiveAccepting.map((obs) => obs.sourceName).filter(Boolean),
  );
  const hasCorroboratedUndergradAccess =
    positiveAccessEvidence.length > 0 || independentPositiveSources.size >= 2;
  if (positiveAccepting.length > 0 && hasCorroboratedUndergradAccess) {
    const score = maxConfidence(positiveAccepting);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:REACH_OUT_PLAUSIBLE',
        type: 'REACH_OUT_PLAUSIBLE',
        score,
        observations: positiveAccepting,
        excerpt: undergradAccessQuote || undefined,
      }),
    );
  }

  const negativeAccepting = [
    ...acceptingObservations.filter(isNegativeBoolean),
    ...negativeAccessEvidence,
  ];
  const negativeUnavailabilityQuote = [
    firstString(bestObservation(byField.get('undergradConstraintQuote') || [])?.value),
    firstString(bestObservation(byField.get('undergradEvidenceQuote') || [])?.value),
    ...negativeAccessEvidence.map((obs) => undergradAccessEvidenceQuote(obs.value)),
  ].find(isExplicitUndergradUnavailabilityPhrase);
  if (negativeAccepting.length > 0 && negativeUnavailabilityQuote) {
    const score = maxConfidence(negativeAccepting);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:NOT_CURRENTLY_AVAILABLE',
        type: 'NOT_CURRENTLY_AVAILABLE',
        score,
        observations: negativeAccepting,
        excerpt: publicExcerpt(negativeUnavailabilityQuote) || undefined,
      }),
    );
  }

  const joinPageObservations = (byField.get('joinPageUrl') || []).filter((obs) =>
    firstUrlValue(obs.value),
  );
  if (joinPageObservations.length > 0 && positiveAccessEvidence.length > 0) {
    const score = maxConfidence(joinPageObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
        type: 'APPLICATION_FORM_EXISTS',
        score,
        observations: joinPageObservations,
        excerpt: 'A join, opportunities, or application page was found.',
      }),
    );
  }

  // A microsite that explicitly states it does not take undergraduates still
  // usually lists generic contact instructions (e.g. "email the PI") aimed at
  // prospective postdocs/graduate students. Those instructions must not be
  // minted into undergraduate action evidence: an explicit negative verdict
  // vetoes the credit, matching the join-page path's positive-evidence guard
  // above so an "open to undergrads: no" lab is never surfaced as reach-out.
  const contactInstructionObservations = byField.get('contactInstructionsQuote') || [];
  const hasExplicitUndergradExclusion = negativeAccessEvidence.length > 0;
  if (contactInstructionObservations.length > 0 && !hasExplicitUndergradExclusion) {
    const score = maxConfidence(contactInstructionObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
        type: 'CONTACT_INSTRUCTIONS_EXIST',
        score,
        observations: contactInstructionObservations,
        excerpt: publicExcerpt(bestObservation(contactInstructionObservations)?.value),
      }),
    );
  }

  const pastAdviseeObservations = (byField.get('pastUndergradAdvisees') || []).filter((obs) =>
    hasPastAdvisees(obs.value),
  );
  if (pastAdviseeObservations.length > 0) {
    const score = maxConfidence(pastAdviseeObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:PAST_UNDERGRADS',
        type: 'PAST_UNDERGRADS',
        score,
        observations: pastAdviseeObservations,
      }),
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:FELLOWSHIP_COMPATIBLE',
        type: 'FELLOWSHIP_COMPATIBLE',
        score,
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

  const contactObservations = [
    ...(byField.get('contactName') || []),
    ...(byField.get('contactEmail') || []),
    ...(byField.get('contactRole') || []),
  ];
  const contactEmail = firstString(bestObservation(byField.get('contactEmail') || [])?.value);
  const contactName = firstString(bestObservation(byField.get('contactName') || [])?.value);
  const contactRole = firstString(bestObservation(byField.get('contactRole') || [])?.value);
  if (contactObservations.length > 0 && (contactEmail || contactName || contactRole)) {
    const score = maxConfidence(contactObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:CONTACT_FIELDS',
        type: 'CONTACT_INSTRUCTIONS_EXIST',
        score,
        observations: contactObservations,
        excerpt: contactSignalExcerpt({ contactName, contactRole, contactEmail }),
      }),
    );
  }

  return filterArtifactsByValidatedClaims({
    accessSignals: uniqueByDerivationKey(accessSignals),
  });
}

/**
 * Research-home entity types where an identified faculty lead plus an official
 * (non-grant) source page is itself a legitimate, evidence-based "ways in":
 * the student can plan specific outreach to a named faculty mentor whose
 * documented work matches their interest. Organizational homes here fall back
 * to the lead-optional center-level ways-in when no single director is named.
 *
 * Must be a superset of ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES: any type granted a
 * lead-exempt organizational ways-in must also be eligible here, or that class
 * (e.g. CORE_FACILITY, #1361) can never derive its organizational signal and is
 * left a permanent missing_action_evidence dead-end. Guarded by a subset test.
 *
 * Excluded by design: programs/fellowships (own program logic) and any entity
 * the visibility gate has flagged as a duplicate.
 */
export const IDENTIFIED_LEAD_WAYS_IN_ENTITY_TYPES = new Set([
  'LAB',
  'CENTER',
  'INSTITUTE',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'INITIATIVE',
  'CORE_FACILITY',
  'GROUP',
  'INDIVIDUAL_RESEARCH',
]);

const IDENTIFIED_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

/**
 * Organizational research homes (centers, institutes, initiatives, core
 * facilities, and the humanities/collections project homes - digital-humanities
 * projects, collections initiatives, archive/museum projects) are
 * institutionally contactable via their official page - so they get a
 * center-level ways-in even when no single named director is published.
 */
export const ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
]);

const GRANT_OR_DIRECTORY_ONLY_HOST =
  /(reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov|api\.nsf\.gov|orcid\.org)$/i;

function isGrantOrOrcidOnlyUrl(value: string): boolean {
  try {
    return GRANT_OR_DIRECTORY_ONLY_HOST.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** First official, non-grant http(s) URL describing the research home. */
export function officialNonGrantSourceUrl(entity: {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}): string {
  const urls = [
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]
    .map(firstString)
    .filter((url) => /^https?:\/\//i.test(url));
  return urls.find((url) => !isGrantOrOrcidOnlyUrl(url)) || '';
}

export interface IdentifiedLeadWaysInInput {
  researchEntityId: string;
  entity: {
    entityType?: string;
    name?: string;
    displayName?: string;
    studentVisibilityReasons?: unknown;
  };
  officialUrl: string;
  leadName?: string;
  supportingObservations: AccessObservation[];
}

/**
 * Pure derivation of the identified-faculty-lead ways-in signal. Returns empty
 * artifacts when the entity is not an eligible research home, is flagged as a
 * duplicate, or has no supporting source evidence (so the claim gate keeps it).
 */
export function deriveIdentifiedLeadWaysIn(
  input: IdentifiedLeadWaysInInput,
): DerivedAccessArtifacts {
  const empty: DerivedAccessArtifacts = { accessSignals: [] };
  const entityType = firstString(input.entity.entityType).toUpperCase();
  if (!IDENTIFIED_LEAD_WAYS_IN_ENTITY_TYPES.has(entityType)) return empty;
  const reasons = Array.isArray(input.entity.studentVisibilityReasons)
    ? input.entity.studentVisibilityReasons.map((r) => firstString(r))
    : [];
  if (reasons.includes('duplicate_risk') || reasons.includes('exact_url_duplicate_risk'))
    return empty;
  if (!/^https?:\/\//i.test(input.officialUrl) || isGrantOrOrcidOnlyUrl(input.officialUrl))
    return empty;
  if (input.supportingObservations.length === 0) return empty;

  const score = Math.min(0.4, maxConfidence(input.supportingObservations) || 0.4);
  const leadName = firstString(input.leadName);
  const organizational = !leadName && ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES.has(entityType);

  const accessSignals: DerivedAccessSignal[] = [
    makeSignal({
      researchEntityId: input.researchEntityId,
      derivationKey: organizational
        ? ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY
        : IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
      type: 'REACH_OUT_PLAUSIBLE',
      score,
      observations: input.supportingObservations,
      excerpt: organizational
        ? 'Official center/institute page found; explore its programs and affiliated people for a way in.'
        : 'Identified faculty lead with an official research page; outreach is plausible but no posting was found.',
    }),
  ];

  return filterArtifactsByValidatedClaims({ accessSignals });
}

/**
 * Fetch the entity, its current PI/director lead, and a supporting identity
 * observation, then derive the identified-faculty-lead ways-in. Returns empty
 * artifacts unless the entity qualifies and has an attached lead.
 */
async function deriveIdentifiedLeadWaysInForEntity(
  researchEntityId: string,
): Promise<DerivedAccessArtifacts> {
  const empty: DerivedAccessArtifacts = { accessSignals: [] };
  const researchEntityObjectId = toAccessMaterializerObjectId(researchEntityId);
  if (!researchEntityObjectId) return empty;
  const entity: any = await ResearchEntity.findById(researchEntityObjectId, {
    entityType: 1,
    name: 1,
    displayName: 1,
    slug: 1,
    websiteUrl: 1,
    website: 1,
    sourceUrls: 1,
    studentVisibilityReasons: 1,
  }).lean();
  if (!entity) return empty;

  const roster = await getResearchEntityRoster(researchEntityObjectId);
  const lead = roster.find(
    (entry) =>
      entry.state !== 'HISTORICAL' &&
      IDENTIFIED_LEAD_ROLES.has(entry.role) &&
      firstString(entry.name).length > 0,
  );
  const entityTypeUpper = firstString(entity.entityType).toUpperCase();
  const isOrganizational = ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES.has(entityTypeUpper);
  if (!lead && !isOrganizational) return empty;

  const leadName = firstString(lead?.name);
  const candidateLeadUrls = lead
    ? [lead.websiteUrl, ...(lead.profileLinks || []).map((link) => link.url)]
    : [];
  const leadProfileUrl =
    candidateLeadUrls
      .map(firstString)
      .find(
        (u: string) => /^https?:\/\//i.test(u) && /yale\.edu/i.test(u) && !isGrantOrOrcidOnlyUrl(u),
      ) || '';

  const officialUrl = officialNonGrantSourceUrl(entity) || leadProfileUrl;
  if (!officialUrl) return empty;

  const identityMatch: Record<string, any>[] = [{ entityId: researchEntityObjectId }];
  if (entity.slug) identityMatch.push({ entityKey: entity.slug });
  const identityObs: any = await Observation.findOne({
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    superseded: false,
    sourceUrl: { $regex: '^https?://', $options: 'i' },
    $or: identityMatch,
  })
    .sort({ observedAt: -1 })
    .lean();

  const supporting: AccessObservation[] = identityObs
    ? [
        {
          _id: identityObs._id,
          field: identityObs.field,
          value: identityObs.value,
          sourceName: identityObs.sourceName,
          sourceUrl: identityObs.sourceUrl || officialUrl,
          confidence: Number(identityObs.confidence) || 0.4,
          observedAt: identityObs.observedAt || new Date(),
        },
      ]
    : [];

  return deriveIdentifiedLeadWaysIn({
    researchEntityId,
    entity,
    officialUrl,
    leadName,
    supportingObservations: supporting,
  });
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
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      superseded: false,
      $or: [
        { entityId: researchEntityObjectId },
        identifier.entityKey ? { entityKey: identifier.entityKey } : {},
      ].filter((clause) => Object.keys(clause).length > 0),
    }).lean()) as unknown as AccessObservation[]);

  const artifacts = deriveAccessArtifactsFromObservations(researchEntityId, observations);

  // Fallback ways-in: when observations yielded no source-backed access signal
  // (a signal carrying an http(s) source URL as action evidence), a research
  // home with an identified faculty lead and an official source page is still a
  // legitimate, evidence-based exploratory contact. This removes the dominant
  // `missing_action_evidence` blocker for real faculty research homes without
  // manufacturing undergrad-access claims.
  const hasQualifyingSignal = artifacts.accessSignals.some((signal) =>
    /^https?:\/\//i.test(String(signal.sourceUrl || '')),
  );
  if (!hasQualifyingSignal) {
    const leadWaysIn = await deriveIdentifiedLeadWaysInForEntity(researchEntityId);
    const existingSignalKeys = new Set(artifacts.accessSignals.map((s) => s.derivationKey));
    artifacts.accessSignals.push(
      ...leadWaysIn.accessSignals.filter((s) => !existingSignalKeys.has(s.derivationKey)),
    );
  }

  return { researchEntityId, artifacts };
}

export async function materializeAccessForResearchGroup(
  identifier: { researchEntityId?: string; entityKey?: string },
  inputObservations?: AccessObservation[],
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

  for (const signal of artifacts.accessSignals) {
    await upsertSignal(signal);
  }

  return {
    researchEntityId,
    accessSignals: artifacts.accessSignals.length,
    staleEvidenceSkipped: 0,
    errors: 0,
  };
}
