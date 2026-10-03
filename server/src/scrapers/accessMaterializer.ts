/**
 * Derives first-class, source-attributed access Signals from append-only
 * Observations. Contact routes and entry pathways are no longer modeled: the
 * contact action is derived at read time from official links, and browse runs
 * on the research-entity index rather than a separate pathway index.
 */
import mongoose from 'mongoose';
import { attributedArchiveSet } from '../models/entityArchival';
import { Observation, researchEntityObservationSubjects } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Signal } from '../models/signal';
import { hasPastUndergradAdvisees } from '../services/accessAcceptanceLevel';
import { isPubliclyUnreachableSourceUrl } from '../services/sourceLinkHealth';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { serializedDocumentId } from '../utils/idSerialization';
import type { AccessSignalConfidence, AccessSignalType } from '../models/researchAccessTypes';
import { upsertSignal, type UpsertSignalInput } from '../services/signalService';
import { omitSuppressionLockedFields } from '../services/suppressionLockUtils';
import {
  validateAccessArtifactBundle,
  type AccessArtifactCandidate,
} from '../services/claimValidation/accessClaims';
import {
  isExplicitUndergradUnavailabilityPhrase,
  isPlausibleUndergradEvidenceQuote,
  RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE,
} from './undergradEvidenceQuoteValidation';
import {
  CONTACT_FIELDS_SIGNAL_DERIVATION_KEY,
  RESEARCH_ENTITY_CONTACT_FIELDS,
  observationIsKeyedToRow,
  type ContactEvidenceRow,
} from './rowKeyedContactEvidence';
import { contactQuoteStatesAnInstruction } from './contactInstructionQuoteAdmission';

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

// `signal:CURRENT_UNDERGRADS` and `signal:APPLICATION_FORM_EXISTS:JOIN_PAGE` are absent
// on purpose: #4430 owns whether those two types are admissible at all (#3920).
export const EVIDENCE_GOVERNED_ACCESS_SIGNAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'signal:REACH_OUT_PLAUSIBLE': ['undergradAccessEvidence'],
  'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE': [
    'contactInstructionsQuote',
    'undergradAccessEvidence',
  ],
  'signal:NOT_CURRENTLY_AVAILABLE': [
    'undergradAccessEvidence',
    'undergradConstraintQuote',
    'undergradEvidenceQuote',
  ],
  'signal:CREDIT_FORMALIZATION_POSSIBLE': ['offersIndependentStudy', 'independentStudyCourses'],
  'signal:FACULTY_SUPERVISES_STUDENT_PROJECTS:SENIOR_THESIS': [
    'offersIndependentStudy',
    'independentStudyCourses',
  ],
  'signal:PAST_UNDERGRADS': ['pastUndergradAdvisees'],
  'signal:FELLOWSHIP_COMPATIBLE': ['pastUndergradAdvisees'],
  [CONTACT_FIELDS_SIGNAL_DERIVATION_KEY]: [...RESEARCH_ENTITY_CONTACT_FIELDS],
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

function deriveContactFieldsSignal(
  researchEntityId: string,
  byField: Map<string, AccessObservation[]>,
): DerivedAccessSignal | undefined {
  const contactObservations = [
    ...(byField.get('contactName') || []),
    ...(byField.get('contactEmail') || []),
    ...(byField.get('contactRole') || []),
  ];
  const contactEmail = firstString(bestObservation(byField.get('contactEmail') || [])?.value);
  const contactName = firstString(bestObservation(byField.get('contactName') || [])?.value);
  const contactRole = firstString(bestObservation(byField.get('contactRole') || [])?.value);
  if (contactObservations.length === 0 || !(contactEmail || contactName || contactRole)) {
    return undefined;
  }
  return makeSignal({
    researchEntityId,
    derivationKey: CONTACT_FIELDS_SIGNAL_DERIVATION_KEY,
    type: 'CONTACT_INSTRUCTIONS_EXIST',
    score: maxConfidence(contactObservations),
    observations: contactObservations,
    excerpt: contactSignalExcerpt({ contactName, contactRole, contactEmail }),
  });
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

function newestReadPerSource(observations: AccessObservation[]): AccessObservation[] {
  const newest = new Map<string, AccessObservation>();
  for (const obs of observations) {
    const incumbent = newest.get(obs.sourceName);
    if (
      !incumbent ||
      new Date(obs.observedAt).getTime() > new Date(incumbent.observedAt).getTime()
    ) {
      newest.set(obs.sourceName, obs);
    }
  }
  return [...newest.values()];
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
  // against, so its counts cannot back a current-undergraduates signal (#3789).
  const currentUndergradObservations = (byField.get('currentUndergradCount') || []).filter(
    (obs) =>
      undergradCount(obs.value) > 0 && obs.sourceName !== RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE,
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
  const negativeAccessEvidence = undergradAccessEvidence.filter(
    (obs) => undergradAccessVerdict(obs.value) === 'no',
  );
  const currentAccessEvidence = newestReadPerSource(undergradAccessEvidence);
  const currentPositiveAccessEvidence = currentAccessEvidence.filter(
    (obs) => undergradAccessVerdict(obs.value) === 'yes',
  );
  const currentNegativeAccessEvidence = currentAccessEvidence.filter(
    (obs) => undergradAccessVerdict(obs.value) === 'no',
  );
  const plausibleUndergradEvidenceQuote = (byField.get('undergradEvidenceQuote') || []).filter(
    (obs) => typeof obs.value !== 'string' || isPlausibleUndergradEvidenceQuote(obs.value),
  );
  const undergradAccessQuote =
    publicExcerpt(
      bestObservation(newestReadPerSource(byField.get('undergradRoleEvidenceQuote') || []))?.value,
    ) || publicExcerpt(bestObservation(plausibleUndergradEvidenceQuote)?.value);
  if (currentPositiveAccessEvidence.length > 0) {
    const score = maxConfidence(currentPositiveAccessEvidence);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:REACH_OUT_PLAUSIBLE',
        type: 'REACH_OUT_PLAUSIBLE',
        score,
        observations: currentPositiveAccessEvidence,
        excerpt: undergradAccessQuote || undefined,
      }),
    );
  }

  const negativeUnavailabilityQuote = [
    firstString(bestObservation(byField.get('undergradConstraintQuote') || [])?.value),
    firstString(bestObservation(byField.get('undergradEvidenceQuote') || [])?.value),
    ...negativeAccessEvidence.map((obs) => undergradAccessEvidenceQuote(obs.value)),
  ].find(isExplicitUndergradUnavailabilityPhrase);
  if (negativeAccessEvidence.length > 0 && negativeUnavailabilityQuote) {
    const score = maxConfidence(negativeAccessEvidence);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:NOT_CURRENTLY_AVAILABLE',
        type: 'NOT_CURRENTLY_AVAILABLE',
        score,
        observations: negativeAccessEvidence,
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
  const contactInstructionObservations = newestReadPerSource(
    byField.get('contactInstructionsQuote') || [],
  ).filter((obs) => contactQuoteStatesAnInstruction(obs.value));
  const hasExplicitUndergradExclusion = currentNegativeAccessEvidence.length > 0;
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
    hasPastUndergradAdvisees(obs.value),
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

  const contactFieldsSignal = deriveContactFieldsSignal(researchEntityId, byField);
  if (contactFieldsSignal) accessSignals.push(contactFieldsSignal);

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

  const artifacts = deriveAccessArtifactsFromObservations(researchEntityId, observations);

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
    .select('_id derivationKey archived archivedReason suppression source.evidenceIds')
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
  const changes = planEvidenceGovernedSignalChanges(
    new Set(artifacts.accessSignals.map((signal) => signal.derivationKey)),
    derivation.observations ?? [],
    stored,
    await citedAccessEvidenceStatus(stored),
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

interface ContactSignalLike {
  _id?: unknown;
  researchEntityId?: unknown;
  derivationKey?: unknown;
  source?: { excerpt?: unknown } | null;
}

const idText = (value: unknown): string => (value == null ? '' : String(value).trim());

// The access pass keeps a signal whose cited evidence it did not read (#3920), so a
// contact signal derived before #3609 from another row's contact evidence is withheld
// here at serve time and kept as history. Its stored
// evidence id names only the single best contact observation while its excerpt
// combines the best of each contact field, so the excerpt itself is re-derived.
export async function foreignContactFieldSignalIds(
  signals: readonly ContactSignalLike[],
  rows: readonly ContactEvidenceRow[],
): Promise<Set<string>> {
  const contactSignals = signals.filter(
    (signal) => signal.derivationKey === CONTACT_FIELDS_SIGNAL_DERIVATION_KEY,
  );
  if (contactSignals.length === 0) return new Set();
  const rowIds = rows
    .map((row) => toAccessMaterializerObjectId(row._id))
    .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const slugs = rows.map((row) => idText(row.slug)).filter(Boolean);
  const liveContactObservations = (await Observation.find({
    entityType: { $in: researchEntityObservationSubjects },
    superseded: false,
    field: { $in: [...RESEARCH_ENTITY_CONTACT_FIELDS] },
    $or: [{ entityId: { $in: rowIds } }, { entityKey: { $in: slugs } }],
  }).lean()) as unknown as AccessObservation[];
  const rowsById = new Map(rows.map((row) => [idText(row._id), row]));

  const foreign = new Set<string>();
  for (const signal of contactSignals) {
    const row = rowsById.get(idText(signal.researchEntityId));
    const byField = new Map<string, AccessObservation[]>();
    for (const observation of liveContactObservations) {
      if (!row || !observationIsKeyedToRow(observation, row)) continue;
      byField.set(observation.field, [...(byField.get(observation.field) || []), observation]);
    }
    const rowKeyedExcerpt = deriveContactFieldsSignal(idText(row?._id), byField)?.excerpt;
    const statedByRow =
      rowKeyedExcerpt !== undefined &&
      sanitizeEvidenceExcerpt(rowKeyedExcerpt) === firstString(signal.source?.excerpt);
    if (!statedByRow) foreign.add(idText(signal._id));
  }
  return foreign;
}
