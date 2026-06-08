/**
 * Derives first-class access/pathway/contact records from append-only
 * Observations. This runs beside the legacy entity materializer: it should not
 * replace scalar ResearchGroup compatibility fields yet.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import type {
  AccessSignalConfidence,
  AccessSignalType,
  CompensationType,
  ContactPolicy,
  ContactRouteType,
  ContactRouteVisibility,
  EntryPathwayStatus,
  EntryPathwayType,
  EvidenceStrength,
} from '../models/researchAccessTypes';
import {
  upsertAccessSignal,
  type UpsertAccessSignalInput,
} from '../services/accessSignalService';
import {
  upsertContactRoute,
  type UpsertContactRouteInput,
} from '../services/contactRouteService';
import {
  upsertEntryPathway,
  type UpsertEntryPathwayInput,
} from '../services/entryPathwayService';
import {
  validateAccessArtifactBundle,
  type AccessArtifactCandidate,
} from '../services/claimValidation/accessClaims';

const ENTITY_DISCOVERY_ONLY_SOURCES = new Set([
  'ysm-atoz-index',
  'yse-centers-index',
]);

const PATHWAY_SPECIFIC_ACCEPTING_SOURCES = new Set([
  'undergrad-fellowships-recipients',
]);

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

export interface DerivedEntryPathway extends UpsertEntryPathwayInput {
  derivationKey: string;
}

export interface DerivedAccessSignal extends UpsertAccessSignalInput {
  derivationKey: string;
}

export interface DerivedContactRoute extends UpsertContactRouteInput {
  derivationKey: string;
}

export interface DerivedAccessArtifacts {
  entryPathways: DerivedEntryPathway[];
  accessSignals: DerivedAccessSignal[];
  contactRoutes: DerivedContactRoute[];
}

export interface AccessMaterializationResult {
  researchEntityId?: string;
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  guardedContactRoutes: number;
  staleEvidenceSkipped: number;
  errors: number;
  skipped?: string;
}

function observationId(obs: AccessObservation): string | undefined {
  if (obs._id === undefined || obs._id === null) return undefined;
  return String(obs._id);
}

function observationIds(observations: AccessObservation[]): string[] {
  return observations.map(observationId).filter((id): id is string => !!id);
}

function sourceUrls(observations: AccessObservation[]): string[] {
  return Array.from(
    new Set(
      observations
        .map((obs) => (obs.sourceUrl || '').trim())
        .filter((url) => url.length > 0),
    ),
  );
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

function evidenceStrength(score: number): EvidenceStrength {
  if (score >= 0.85) return 'DIRECT';
  if (score >= 0.7) return 'STRONG';
  if (score >= 0.45) return 'MODERATE';
  return 'WEAK';
}

function firstString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function publicExcerpt(value: unknown): string | undefined {
  const text = firstString(value);
  return text ? redactDirectContactInfo(text) : undefined;
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

function makePathway(input: {
  researchEntityId: string;
  derivationKey: string;
  pathwayType: EntryPathwayType;
  status: EntryPathwayStatus;
  score: number;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: CompensationType;
  observations: AccessObservation[];
}): DerivedEntryPathway {
  return {
    researchEntityId: input.researchEntityId,
    derivationKey: input.derivationKey,
    pathwayType: input.pathwayType,
    status: input.status,
    evidenceStrength: evidenceStrength(input.score),
    studentFacingLabel: input.studentFacingLabel,
    explanation: input.explanation,
    bestNextStep: input.bestNextStep,
    compensation: input.compensation || 'UNKNOWN',
    confidence: input.score,
    sourceEvidenceIds: observationIds(input.observations),
    sourceUrls: sourceUrls(input.observations),
    lastMaterializedAt: new Date(),
  };
}

function makeSignal(input: {
  researchEntityId: string;
  derivationKey: string;
  signalType: AccessSignalType;
  score: number;
  observations: AccessObservation[];
  entryPathwayId?: string;
  excerpt?: string;
}): DerivedAccessSignal {
  const obs = bestObservation(input.observations);
  const sourceEvidenceId = obs ? observationId(obs) : undefined;
  return {
    researchEntityId: input.researchEntityId,
    derivationKey: input.derivationKey,
    signalType: input.signalType,
    confidence: confidenceLabel(input.score),
    confidenceScore: input.score,
    sourceEvidenceId: sourceEvidenceId || '',
    observedAt: latestObservedAt(input.observations),
    entryPathwayId: input.entryPathwayId,
    excerpt: input.excerpt,
    sourceName: obs?.sourceName,
    sourceUrl: obs?.sourceUrl,
    originalConfidence: obs?.confidence,
  };
}

function officialApplicationPathwayType(
  observations: AccessObservation[],
): { pathwayType: EntryPathwayType; status: EntryPathwayStatus; label: string; explanation: string; bestNextStep: string } {
  const sourceText = observations
    .map((obs) => `${obs.sourceName || ''} ${obs.sourceUrl || ''}`)
    .join(' ')
    .toLowerCase();
  if (sourceText.includes('department-undergrad-research')) {
    return {
      pathwayType: 'RECURRING_PROGRAM',
      status: 'RECURRING',
      label: 'Department research application',
      explanation: 'An official department page describes an undergraduate research application or matching route.',
      bestNextStep: 'Use the official application route and follow the department instructions.',
    };
  }
  if (sourceText.includes('internship')) {
    return {
      pathwayType: 'CENTER_INTERNSHIP',
      status: 'RECURRING',
      label: 'Official internship route',
      explanation: 'An official source describes an internship or application route for students.',
      bestNextStep: 'Use the official application route and check timing or eligibility on the source page.',
    };
  }
  return {
    pathwayType: 'VOLUNTEER_OUTREACH',
    status: 'PLAUSIBLE',
    label: 'Official application route',
    explanation: 'An official join, opportunities, or application page was found for undergraduate access.',
    bestNextStep: 'Use the official route before trying direct outreach.',
  };
}

function uniqueByDerivationKey<T extends { derivationKey: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.derivationKey, item])).values());
}

function accessArtifactCandidatesFromDerived(
  artifacts: DerivedAccessArtifacts,
): AccessArtifactCandidate[] {
  return [
    ...artifacts.entryPathways.map((pathway): AccessArtifactCandidate => ({
      artifactType: 'EntryPathway',
      researchEntityId: pathway.researchEntityId,
      derivationKey: pathway.derivationKey,
      pathwayType: pathway.pathwayType,
      sourceEvidenceIds: pathway.sourceEvidenceIds,
      sourceUrls: pathway.sourceUrls,
    })),
    ...artifacts.accessSignals.map((signal): AccessArtifactCandidate => ({
      artifactType: 'AccessSignal',
      researchEntityId: signal.researchEntityId,
      entryPathwayId: signal.entryPathwayId,
      derivationKey: signal.derivationKey,
      signalType: signal.signalType,
      sourceEvidenceIds: [signal.sourceEvidenceId].filter((id): id is string => Boolean(id)),
      sourceUrls: [signal.sourceUrl].filter((url): url is string => Boolean(url)),
      sourceName: signal.sourceName,
      sourceUrl: signal.sourceUrl,
    })),
    ...artifacts.contactRoutes.map((route): AccessArtifactCandidate => ({
      artifactType: 'ContactRoute',
      researchEntityId: route.researchEntityId,
      entryPathwayId: route.entryPathwayId,
      derivationKey: route.derivationKey,
      routeType: route.routeType,
      url: route.url,
      sourceEvidenceIds: [
        ...(route.sourceEvidenceIds || []),
        route.sourceEvidenceId,
      ].filter((id): id is string => Boolean(id)),
      sourceUrls: [route.sourceUrl].filter((url): url is string => Boolean(url)),
      sourceName: route.sourceName,
      sourceUrl: route.sourceUrl,
    })),
  ];
}

function filterArtifactsByValidatedClaims(
  artifacts: DerivedAccessArtifacts,
): DerivedAccessArtifacts {
  const validation = validateAccessArtifactBundle(accessArtifactCandidatesFromDerived(artifacts));
  const acceptedKeys = new Set(
    validation.accepted.map((result) => `${result.claim.artifactType}:${result.claim.derivationKey}`),
  );
  return {
    entryPathways: artifacts.entryPathways.filter((pathway) =>
      acceptedKeys.has(`EntryPathway:${pathway.derivationKey}`),
    ),
    accessSignals: artifacts.accessSignals.filter((signal) =>
      acceptedKeys.has(`AccessSignal:${signal.derivationKey}`),
    ),
    contactRoutes: artifacts.contactRoutes.filter((route) =>
      acceptedKeys.has(`ContactRoute:${route.derivationKey}`),
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

  const entryPathways: DerivedEntryPathway[] = [];
  const accessSignals: DerivedAccessSignal[] = [];
  const contactRoutes: DerivedContactRoute[] = [];

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
        signalType: 'CREDIT_FORMALIZATION_POSSIBLE',
        score,
        observations: independentStudyObservations,
        excerpt: courses.map((course) => [course.code, course.title].filter(Boolean).join(' ')).join('; '),
      }),
    );

    if (seniorProjectCourses.length > 0) {
      accessSignals.push(
        makeSignal({
          researchEntityId,
          derivationKey: 'signal:FACULTY_SUPERVISES_STUDENT_PROJECTS:SENIOR_THESIS',
          signalType: 'FACULTY_SUPERVISES_STUDENT_PROJECTS',
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
    entryPathways.push(
      makePathway({
        researchEntityId,
        derivationKey: 'pathway:EXPLORATORY_CONTACT:CURRENT_UNDERGRADS',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        score,
        studentFacingLabel: 'Exploratory outreach',
        explanation: 'Current undergraduate members are listed, but no active posting was found.',
        bestNextStep: 'Plan a specific outreach note that references the group’s work.',
        compensation: 'UNKNOWN',
        observations: currentUndergradObservations,
      }),
    );
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CURRENT_UNDERGRADS',
        signalType: 'CURRENT_UNDERGRADS',
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
  if (positiveAccepting.length > 0) {
    const score = maxConfidence(positiveAccepting);
    const quote =
      publicExcerpt(bestObservation(byField.get('undergradRoleEvidenceQuote') || [])?.value) ||
      publicExcerpt(bestObservation(byField.get('undergradEvidenceQuote') || [])?.value);
    entryPathways.push(
      makePathway({
        researchEntityId,
        derivationKey: 'pathway:EXPLORATORY_CONTACT:ACCEPTING_SIGNAL',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        score,
        studentFacingLabel: 'Exploratory outreach',
        explanation: 'Source evidence suggests undergraduates may be able to participate.',
        bestNextStep: 'Use the evidence to plan targeted outreach rather than treating this as an open posting.',
        compensation: 'UNKNOWN',
        observations: positiveAccepting,
      }),
    );
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:REACH_OUT_PLAUSIBLE',
        signalType: 'REACH_OUT_PLAUSIBLE',
        score,
        observations: positiveAccepting,
        excerpt: quote || undefined,
      }),
    );
  }

  const negativeAccepting = [
    ...acceptingObservations.filter(isNegativeBoolean),
    ...negativeAccessEvidence,
  ];
  if (negativeAccepting.length > 0) {
    const score = maxConfidence(negativeAccepting);
    const quote =
      publicExcerpt(bestObservation(byField.get('undergradConstraintQuote') || [])?.value) ||
      publicExcerpt(bestObservation(byField.get('undergradEvidenceQuote') || [])?.value);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:NOT_CURRENTLY_AVAILABLE',
        signalType: 'NOT_CURRENTLY_AVAILABLE',
        score,
        observations: negativeAccepting,
        excerpt: quote || undefined,
      }),
    );
  }

  const joinPageObservations = (byField.get('joinPageUrl') || []).filter((obs) =>
    firstUrlValue(obs.value),
  );
  if (joinPageObservations.length > 0) {
    const score = maxConfidence(joinPageObservations);
    const bestJoinPage = bestObservation(joinPageObservations);
    const joinUrl = firstUrlValue(bestJoinPage?.value);
    if (positiveAccepting.length > 0) {
      const applicationObservations = [...joinPageObservations, ...positiveAccepting];
      const classification = officialApplicationPathwayType(applicationObservations);
      entryPathways.push(
        makePathway({
          researchEntityId,
          derivationKey: 'pathway:OFFICIAL_APPLICATION:JOIN_PAGE',
          pathwayType: classification.pathwayType,
          status: classification.status,
          score: maxConfidence(applicationObservations),
          studentFacingLabel: classification.label,
          explanation: classification.explanation,
          bestNextStep: classification.bestNextStep,
          compensation: 'UNKNOWN',
          observations: applicationObservations,
        }),
      );
    }
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
        signalType: 'APPLICATION_FORM_EXISTS',
        score,
        observations: joinPageObservations,
        excerpt: 'A join, opportunities, or application page was found.',
      }),
    );
    contactRoutes.push({
      researchEntityId,
      derivationKey: `route:OFFICIAL_APPLICATION:${joinUrl}`.toLowerCase(),
      routeType: 'OFFICIAL_APPLICATION',
      priority: 0,
      visibility: 'PUBLIC',
      contactPolicy: 'APPLICATION_ONLY',
      url: joinUrl,
      rationale: 'Derived from a public join or opportunities page.',
      sourceEvidenceIds: observationIds(joinPageObservations),
      sourceEvidenceId: bestJoinPage ? observationId(bestJoinPage) : undefined,
      observedAt: latestObservedAt(joinPageObservations),
      sourceName: bestJoinPage?.sourceName,
      sourceUrl: bestJoinPage?.sourceUrl,
    });
  }

  const contactInstructionObservations = byField.get('contactInstructionsQuote') || [];
  if (contactInstructionObservations.length > 0) {
    const score = maxConfidence(contactInstructionObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
        signalType: 'CONTACT_INSTRUCTIONS_EXIST',
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
    entryPathways.push(
      makePathway({
        researchEntityId,
        derivationKey: 'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        score,
        studentFacingLabel: 'Exploratory outreach',
        explanation: 'Past undergraduate fellowship or advisee evidence suggests students have found mentored projects here.',
        bestNextStep: 'Plan outreach and ask how student projects are usually formalized.',
        compensation: 'UNKNOWN',
        observations: pastAdviseeObservations,
      }),
    );
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:PAST_UNDERGRADS',
        signalType: 'PAST_UNDERGRADS',
        score,
        observations: pastAdviseeObservations,
      }),
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:FELLOWSHIP_COMPATIBLE',
        signalType: 'FELLOWSHIP_COMPATIBLE',
        score,
        observations: pastAdviseeObservations,
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
    const role = contactRole.toLowerCase();
    const routeType: ContactRouteType = role.includes('lab manager')
      ? 'LAB_MANAGER'
      : role.includes('program manager')
        ? 'PROGRAM_MANAGER'
        : role.includes('instructor')
          ? 'COURSE_INSTRUCTOR'
          : role.includes('pi') || role.includes('professor')
            ? 'FACULTY_PI'
          : 'UNKNOWN';
    const visibility: ContactRouteVisibility = contactEmail ? 'AUTHENTICATED' : 'PUBLIC';
    const contactPolicy: ContactPolicy =
      routeType === 'UNKNOWN'
        ? 'UNKNOWN'
        : routeType === 'COURSE_INSTRUCTOR'
          ? 'OFFICIAL_ROUTE_PREFERRED'
          : 'DIRECT_CONTACT_OK';

    const bestContactObservation = bestObservation(contactObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:CONTACT_FIELDS',
        signalType: 'CONTACT_INSTRUCTIONS_EXIST',
        score,
        observations: contactObservations,
        excerpt: contactSignalExcerpt({ contactName, contactRole, contactEmail }),
      }),
    );
    contactRoutes.push({
      researchEntityId,
      derivationKey: `route:${contactEmail || contactName || contactRole}`.toLowerCase(),
      routeType,
      priority: routeType === 'LAB_MANAGER' || routeType === 'PROGRAM_MANAGER' ? 10 : 50,
      visibility,
      contactPolicy,
      name: contactName || undefined,
      email: contactEmail || undefined,
      role: contactRole || undefined,
      rationale:
        routeType === 'COURSE_INSTRUCTOR'
          ? 'Derived from explicit course instructor evidence.'
          : 'Derived from research entity contact fields.',
      sourceEvidenceIds: observationIds(contactObservations),
      sourceEvidenceId: bestContactObservation ? observationId(bestContactObservation) : undefined,
      observedAt: latestObservedAt(contactObservations),
      sourceName: bestContactObservation?.sourceName,
      sourceUrl: bestContactObservation?.sourceUrl,
    });
  }

  return filterArtifactsByValidatedClaims({
    entryPathways: uniqueByDerivationKey(entryPathways),
    accessSignals: uniqueByDerivationKey(accessSignals),
    contactRoutes: uniqueByDerivationKey(contactRoutes),
  });
}

/**
 * Research-home entity types where an identified faculty lead plus an official
 * (non-grant) source page is itself a legitimate, evidence-based "ways in":
 * the student can plan specific outreach to a named faculty mentor whose
 * documented work matches their interest. This is the same EXPLORATORY_CONTACT
 * framing the observation pipeline already produces for current-undergrad /
 * accepting / past-advisee evidence — extended to the common case where the
 * only evidence is the faculty member's own official research page.
 *
 * Excluded by design: programs/fellowships (own program logic), core
 * facilities, and any entity the visibility gate has flagged as a duplicate.
 */
const IDENTIFIED_LEAD_WAYS_IN_ENTITY_TYPES = new Set([
  'LAB',
  'CENTER',
  'INSTITUTE',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'INITIATIVE',
  'GROUP',
  'INDIVIDUAL_RESEARCH',
]);

const IDENTIFIED_LEAD_ROLES = new Set(['pi', 'co-pi', 'director', 'co-director']);

/**
 * Organizational research homes (centers, institutes, initiatives, core
 * facilities) are institutionally contactable via their official page — so they
 * get a center-level ways-in even when no single named director is published.
 */
const ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
]);

const GRANT_OR_DIRECTORY_ONLY_HOST = /(reporter\.nih\.gov|api\.reporter\.nih\.gov|nsf\.gov|api\.nsf\.gov|orcid\.org)$/i;

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
  const urls = [entity.websiteUrl, entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])]
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
 * Pure derivation of the identified-faculty-lead ways-in bundle. Returns empty
 * artifacts when the entity is not an eligible research home, is flagged as a
 * duplicate, or has no supporting source evidence (so the claim gate keeps it).
 */
export function deriveIdentifiedLeadWaysIn(
  input: IdentifiedLeadWaysInInput,
): DerivedAccessArtifacts {
  const empty: DerivedAccessArtifacts = { entryPathways: [], accessSignals: [], contactRoutes: [] };
  const entityType = firstString(input.entity.entityType).toUpperCase();
  if (!IDENTIFIED_LEAD_WAYS_IN_ENTITY_TYPES.has(entityType)) return empty;
  const reasons = Array.isArray(input.entity.studentVisibilityReasons)
    ? input.entity.studentVisibilityReasons.map((r) => firstString(r))
    : [];
  if (reasons.includes('duplicate_risk') || reasons.includes('exact_url_duplicate_risk')) return empty;
  if (!/^https?:\/\//i.test(input.officialUrl) || isGrantOrOrcidOnlyUrl(input.officialUrl)) return empty;
  if (input.supportingObservations.length === 0) return empty;

  const score = Math.min(0.4, maxConfidence(input.supportingObservations) || 0.4);
  const leadName = firstString(input.leadName);
  const homeName = firstString(input.entity.displayName) || firstString(input.entity.name) || 'this research home';
  // Organizational homes with no named lead get a center-level ways-in; faculty
  // homes (or any entity with a named lead) get the identified-lead ways-in.
  const organizational = !leadName && ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES.has(entityType);

  const evidenceObs = input.supportingObservations;
  const entryPathways: DerivedEntryPathway[] = [
    makePathway({
      researchEntityId: input.researchEntityId,
      derivationKey: organizational
        ? 'pathway:EXPLORATORY_CONTACT:ORGANIZATIONAL_HOME'
        : 'pathway:EXPLORATORY_CONTACT:IDENTIFIED_FACULTY_LEAD',
      pathwayType: 'EXPLORATORY_CONTACT',
      status: 'PLAUSIBLE',
      score,
      studentFacingLabel: organizational ? 'Explore this center' : 'Exploratory outreach',
      explanation: organizational
        ? `An official page describes ${homeName}; explore its programs and affiliated people to find a way in.`
        : `An official research page identifies ${leadName} leading ${homeName}; no active posting was found.`,
      bestNextStep: organizational
        ? `Explore ${homeName}'s official page and reach out through its listed programs, staff, or affiliated faculty.`
        : `Plan a specific outreach note referencing ${leadName}'s documented research before assuming an opening.`,
      compensation: 'UNKNOWN',
      observations: evidenceObs,
    }),
  ];
  const accessSignals: DerivedAccessSignal[] = [
    makeSignal({
      researchEntityId: input.researchEntityId,
      derivationKey: organizational
        ? 'signal:REACH_OUT_PLAUSIBLE:ORGANIZATIONAL_HOME'
        : 'signal:REACH_OUT_PLAUSIBLE:IDENTIFIED_FACULTY_LEAD',
      signalType: 'REACH_OUT_PLAUSIBLE',
      score,
      observations: evidenceObs,
      excerpt: organizational
        ? 'Official center/institute page found; explore its programs and affiliated people for a way in.'
        : 'Identified faculty lead with an official research page; outreach is plausible but no posting was found.',
    }),
  ];
  const contactRoutes: DerivedContactRoute[] = [
    organizational
      ? {
          researchEntityId: input.researchEntityId,
          derivationKey: `route:department_contact:organizational:${input.officialUrl}`.toLowerCase(),
          routeType: 'DEPARTMENT_CONTACT',
          priority: 70,
          visibility: 'PUBLIC',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          url: input.officialUrl,
          rationale: 'Derived from the official center or institute page.',
          sourceEvidenceIds: observationIds(evidenceObs),
          sourceEvidenceId: evidenceObs[0] ? observationId(evidenceObs[0]) : undefined,
          observedAt: latestObservedAt(evidenceObs),
          sourceName: evidenceObs[0]?.sourceName,
          sourceUrl: evidenceObs[0]?.sourceUrl || input.officialUrl,
        }
      : {
          researchEntityId: input.researchEntityId,
          derivationKey: `route:faculty_pi:identified:${input.officialUrl}`.toLowerCase(),
          routeType: 'FACULTY_PI',
          priority: 60,
          visibility: 'PUBLIC',
          contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
          name: leadName || undefined,
          url: input.officialUrl,
          rationale: 'Derived from an official research page that identifies the faculty lead.',
          sourceEvidenceIds: observationIds(evidenceObs),
          sourceEvidenceId: evidenceObs[0] ? observationId(evidenceObs[0]) : undefined,
          observedAt: latestObservedAt(evidenceObs),
          sourceName: evidenceObs[0]?.sourceName,
          sourceUrl: evidenceObs[0]?.sourceUrl || input.officialUrl,
        },
  ];

  return filterArtifactsByValidatedClaims({ entryPathways, accessSignals, contactRoutes });
}

/**
 * Fetch the entity, its current PI/director lead, and a supporting identity
 * observation, then derive the identified-faculty-lead ways-in. Returns empty
 * artifacts unless the entity qualifies and has an attached lead.
 */
async function deriveIdentifiedLeadWaysInForEntity(
  researchEntityId: string,
): Promise<DerivedAccessArtifacts> {
  const empty: DerivedAccessArtifacts = { entryPathways: [], accessSignals: [], contactRoutes: [] };
  const entity: any = await ResearchEntity.findById(researchEntityId, {
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

  const lead: any = await ResearchGroupMember.findOne({
    researchEntityId: new mongoose.Types.ObjectId(researchEntityId),
    role: { $in: Array.from(IDENTIFIED_LEAD_ROLES) },
    isCurrentMember: { $ne: false },
    $or: [
      { userId: { $exists: true, $ne: null } },
      { facultyMemberId: { $exists: true, $ne: null } },
    ],
  })
    .select('userId facultyMemberId name role')
    .lean();
  const entityTypeUpper = firstString(entity.entityType).toUpperCase();
  const isOrganizational = ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES.has(entityTypeUpper);
  // A named lead is required for faculty/lab homes; organizational homes
  // (centers/institutes/initiatives) get a center-level ways-in without one.
  if (!lead && !isOrganizational) return empty;

  let leadName = firstString(lead?.name);
  let leadProfileUrl = '';
  if (lead?.userId) {
    const user: any = await mongoose.connection
      .collection('users')
      .findOne({ _id: lead.userId }, { projection: { fname: 1, lname: 1, profileUrls: 1 } });
    if (user) {
      if (!leadName) leadName = [user.fname, user.lname].map(firstString).filter(Boolean).join(' ');
      // profileUrls is stored as a source-keyed object; pick a non-grant Yale URL.
      const candidateUrls = user.profileUrls
        ? Array.isArray(user.profileUrls)
          ? user.profileUrls
          : Object.values(user.profileUrls)
        : [];
      leadProfileUrl =
        candidateUrls
          .map(firstString)
          .find(
            (u: string) => /^https?:\/\//i.test(u) && /yale\.edu/i.test(u) && !isGrantOrOrcidOnlyUrl(u),
          ) || '';
    }
  }

  // Prefer the entity's own official page; otherwise (e.g. grant-shell-named
  // faculty labs whose only entity URL is an NIH/NSF link) point the faculty
  // ways-in at the lead's own official Yale profile.
  const officialUrl = officialNonGrantSourceUrl(entity) || leadProfileUrl;
  if (!officialUrl) return empty;

  // Find a supporting source observation (needed so the claim gate keeps the
  // artifacts). Observations may be keyed by entityId OR by entityKey (slug),
  // so match either.
  const identityMatch: Record<string, any>[] = [
    { entityId: new mongoose.Types.ObjectId(researchEntityId) },
  ];
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
  if (
    identifier.researchEntityId &&
    mongoose.Types.ObjectId.isValid(identifier.researchEntityId)
  ) {
    return identifier.researchEntityId;
  }
  if (!identifier.entityKey) return null;
  const group: any = await ResearchEntity.findOne({ slug: identifier.entityKey }, { _id: 1 }).lean();
  return group?._id ? String(group._id) : null;
}

function pathwayDerivationKeyForSignal(signal: DerivedAccessSignal): string | undefined {
  switch (signal.signalType) {
    case 'APPLICATION_FORM_EXISTS':
      return 'pathway:OFFICIAL_APPLICATION:JOIN_PAGE';
    case 'CURRENT_UNDERGRADS':
      return 'pathway:EXPLORATORY_CONTACT:CURRENT_UNDERGRADS';
    case 'REACH_OUT_PLAUSIBLE':
      return 'pathway:EXPLORATORY_CONTACT:ACCEPTING_SIGNAL';
    case 'PAST_UNDERGRADS':
    case 'FELLOWSHIP_COMPATIBLE':
      return 'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS';
    default:
      return undefined;
  }
}

function pathwayDerivationKeyForRoute(route: DerivedContactRoute): string | undefined {
  if (route.routeType === 'OFFICIAL_APPLICATION') {
    return 'pathway:OFFICIAL_APPLICATION:JOIN_PAGE';
  }
  return undefined;
}

export async function materializeAccessForResearchGroup(
  identifier: { researchEntityId?: string; entityKey?: string },
  inputObservations?: AccessObservation[],
): Promise<AccessMaterializationResult> {
  const researchEntityId = await resolveResearchEntityId(identifier);
  if (!researchEntityId) {
    return {
      researchEntityId: undefined,
      entryPathways: 0,
      accessSignals: 0,
      contactRoutes: 0,
      guardedContactRoutes: 0,
      staleEvidenceSkipped: 0,
      errors: 0,
      skipped: 'research-entity-not-found',
    };
  }

  const observations =
    inputObservations ||
    ((await Observation.find({
      entityType: { $in: ['researchEntity', 'researchGroup'] },
      superseded: false,
      $or: [
        { entityId: new mongoose.Types.ObjectId(researchEntityId) },
        identifier.entityKey ? { entityKey: identifier.entityKey } : {},
      ].filter((clause) => Object.keys(clause).length > 0),
    }).lean()) as unknown as AccessObservation[]);

  const artifacts = deriveAccessArtifactsFromObservations(researchEntityId, observations);

  // Fallback ways-in: when observations yielded no *source-backed* entry pathway
  // (the visibility gate only counts pathways carrying an http(s) source URL as
  // action evidence), a research home with an identified faculty lead and an
  // official source page is still a legitimate, evidence-based exploratory
  // contact route. This removes the dominant `missing_action_evidence` blocker
  // for real faculty research homes — including those left with only empty-URL
  // legacy pathways — without manufacturing undergrad-access claims.
  const hasQualifyingPathway = artifacts.entryPathways.some((pathway) =>
    (pathway.sourceUrls || []).some((url) => /^https?:\/\//i.test(String(url || ''))),
  );
  if (!hasQualifyingPathway) {
    const leadWaysIn = await deriveIdentifiedLeadWaysInForEntity(researchEntityId);
    const existingPathwayKeys = new Set(artifacts.entryPathways.map((p) => p.derivationKey));
    const existingSignalKeys = new Set(artifacts.accessSignals.map((s) => s.derivationKey));
    const existingRouteKeys = new Set(artifacts.contactRoutes.map((r) => r.derivationKey));
    artifacts.entryPathways.push(
      ...leadWaysIn.entryPathways.filter((p) => !existingPathwayKeys.has(p.derivationKey)),
    );
    artifacts.accessSignals.push(
      ...leadWaysIn.accessSignals.filter((s) => !existingSignalKeys.has(s.derivationKey)),
    );
    artifacts.contactRoutes.push(
      ...leadWaysIn.contactRoutes.filter((r) => !existingRouteKeys.has(r.derivationKey)),
    );
  }

  const guardedContactRoutes = artifacts.contactRoutes.filter(
    (route) => route.visibility !== 'PUBLIC' || route.contactPolicy === 'NO_DIRECT_CONTACT',
  ).length;

  const pathwayIdByKey = new Map<string, string>();
  for (const pathway of artifacts.entryPathways) {
    const result = await upsertEntryPathway(pathway);
    if (result.pathwayId) {
      pathwayIdByKey.set(pathway.derivationKey, result.pathwayId);
    }
  }

  for (const signal of artifacts.accessSignals) {
    const linkedPathwayKey = pathwayDerivationKeyForSignal(signal);
    await upsertAccessSignal({
      ...signal,
      entryPathwayId:
        signal.entryPathwayId ||
        (linkedPathwayKey ? pathwayIdByKey.get(linkedPathwayKey) : undefined),
    });
  }

  for (const route of artifacts.contactRoutes) {
    const linkedPathwayKey = pathwayDerivationKeyForRoute(route);
    await upsertContactRoute({
      ...route,
      entryPathwayId:
        route.entryPathwayId ||
        (linkedPathwayKey ? pathwayIdByKey.get(linkedPathwayKey) : undefined),
    });
  }

  return {
    researchEntityId,
    entryPathways: artifacts.entryPathways.length,
    accessSignals: artifacts.accessSignals.length,
    contactRoutes: artifacts.contactRoutes.length,
    guardedContactRoutes,
    staleEvidenceSkipped: 0,
    errors: 0,
  };
}
