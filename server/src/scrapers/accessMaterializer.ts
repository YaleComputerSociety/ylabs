/**
 * Derives first-class access/pathway/contact records from append-only
 * Observations. This runs beside the legacy entity materializer: it should not
 * replace scalar ResearchGroup compatibility fields yet.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { EntryPathway } from '../models/entryPathway';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
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
import { upsertAccessSignal, type UpsertAccessSignalInput } from '../services/accessSignalService';
import { upsertContactRoute, type UpsertContactRouteInput } from '../services/contactRouteService';
import { upsertEntryPathway, type UpsertEntryPathwayInput } from '../services/entryPathwayService';
import { parseNormalizedHttpUrl } from '../utils/urlNormalization';

const ENTITY_DISCOVERY_ONLY_SOURCES = new Set([
  'centers-institutes-index',
  'ysm-atoz-index',
  'yse-centers-index',
]);

const PATHWAY_SPECIFIC_ACCEPTING_SOURCES = new Set(['undergrad-fellowships-recipients']);

export const EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY = 'pathway:EXPLORATORY_CONTACT';
export const LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS = [
  'pathway:EXPLORATORY_CONTACT:CURRENT_UNDERGRADS',
  'pathway:EXPLORATORY_CONTACT:ACCEPTING_SIGNAL',
  'pathway:EXPLORATORY_CONTACT:PAST_UNDERGRADS',
];

const HARD_NEGATIVE_CONSTRAINT_RE =
  /\b(not currently accepting|not accepting|not taking|do not accept|don't accept|do not take|don't take|no bandwidth|don't have bandwidth|do not have bandwidth|cannot respond|can't respond|unable to respond|please do not email|not available)\b/i;
const GRAD_ONLY_INSTRUCTION_RE =
  /\b(prospective\s+(phd|graduate)|ph\.?d\.?\s+(students?|applicants?)|doctoral\s+(students?|applicants?)|graduate\s+(students?|applicants?))\b/i;
const UNDERGRAD_REFERENCE_RE = /\bundergrad(?:uate)?s?\b/i;

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

export interface EntryPathwayMergeSnapshot {
  sourceEvidenceIds?: unknown[];
  sourceUrls?: unknown[];
  confidence?: unknown;
  lastObservedAt?: unknown;
  lastMaterializedAt?: unknown;
}

export interface MergedEntryPathwayData {
  sourceEvidenceIds: string[];
  sourceUrls: string[];
  confidence?: number;
  lastObservedAt?: Date;
  lastMaterializedAt?: Date;
}

export interface LegacyExploratoryContactPathwayMergeResult {
  researchEntityId: string;
  canonicalPathwayId: string;
  legacyPathwayIds: string[];
  canonicalUpdated: number;
  relinkedAccessSignals: number;
  relinkedContactRoutes: number;
  archivedLegacyPathways: number;
  mergedSourceEvidenceIds: string[];
  mergedSourceUrls: string[];
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
      observations.map((obs) => (obs.sourceUrl || '').trim()).filter((url) => url.length > 0),
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

export function materializerStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeHardNegativeConstraint(value: unknown): boolean {
  const text = materializerStringValue(value);
  return text.length > 0 && HARD_NEGATIVE_CONSTRAINT_RE.test(text);
}

function looksLikeGraduateOnlyInstruction(value: unknown): boolean {
  const text = materializerStringValue(value);
  return (
    text.length > 0 && GRAD_ONLY_INSTRUCTION_RE.test(text) && !UNDERGRAD_REFERENCE_RE.test(text)
  );
}

export function publicAccessExcerpt(value: unknown): string | undefined {
  const text = materializerStringValue(value);
  return text ? redactDirectContactInfo(text) : undefined;
}

function firstUrlValue(value: unknown): string {
  const url = materializerStringValue(value);
  if (!url) return '';
  return parseNormalizedHttpUrl(url)?.href || '';
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

export function bestMaterializerObservation<
  T extends { confidence?: unknown; observedAt?: unknown },
>(observations: T[]): T | undefined {
  return [...observations].sort((a, b) => {
    const byConfidence = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
    if (byConfidence !== 0) return byConfidence;
    return (
      new Date(String(b.observedAt || 0)).getTime() -
      new Date(String(a.observedAt || 0)).getTime()
    );
  })[0];
}

function uniqueObservations(observations: AccessObservation[]): AccessObservation[] {
  return Array.from(
    new Map(
      observations.map((observation) => [
        observationId(observation) ||
          `${observation.field}:${observation.sourceName}:${observation.sourceUrl || ''}:${JSON.stringify(observation.value)}`,
        observation,
      ]),
    ).values(),
  );
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
  const obs = bestMaterializerObservation(input.observations);
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

function uniqueByDerivationKey<T extends { derivationKey: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.derivationKey, item])).values());
}

function mergeStringArrays(...arrays: Array<string[] | undefined>): string[] {
  return Array.from(new Set(arrays.flatMap((array) => array || []).filter(Boolean)));
}

function mergeUnknownStringArrays(...arrays: Array<unknown[] | undefined>): string[] {
  return Array.from(
    new Set(
      arrays
        .flatMap((array) => array || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
}

function maybeDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function laterDate(a?: Date, b?: Date): Date | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export function buildMergedEntryPathwayData(
  pathways: EntryPathwayMergeSnapshot[],
): MergedEntryPathwayData {
  const confidences = pathways
    .map((pathway) => Number(pathway.confidence))
    .filter((confidence) => Number.isFinite(confidence));
  const lastObservedAt = pathways.reduce<Date | undefined>(
    (latest, pathway) => laterDate(latest, maybeDate(pathway.lastObservedAt)),
    undefined,
  );
  const lastMaterializedAt = pathways.reduce<Date | undefined>(
    (latest, pathway) => laterDate(latest, maybeDate(pathway.lastMaterializedAt)),
    undefined,
  );

  return {
    sourceEvidenceIds: mergeUnknownStringArrays(
      ...pathways.map((pathway) => pathway.sourceEvidenceIds),
    ),
    sourceUrls: mergeUnknownStringArrays(...pathways.map((pathway) => pathway.sourceUrls)),
    confidence: confidences.length > 0 ? Math.max(...confidences) : undefined,
    lastObservedAt,
    lastMaterializedAt,
  };
}

function mergeExploratoryContactPathways(pathways: DerivedEntryPathway[]): DerivedEntryPathway[] {
  const exploratory = pathways.filter((pathway) => pathway.pathwayType === 'EXPLORATORY_CONTACT');
  if (exploratory.length <= 1) {
    return pathways.map((pathway) =>
      pathway.pathwayType === 'EXPLORATORY_CONTACT'
        ? { ...pathway, derivationKey: EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY }
        : pathway,
    );
  }

  const primary = [...exploratory].sort((a, b) => {
    const confidence = (b.confidence || 0) - (a.confidence || 0);
    if (confidence !== 0) return confidence;
    return (b.lastObservedAt?.getTime() || 0) - (a.lastObservedAt?.getTime() || 0);
  })[0];
  const merged: DerivedEntryPathway = {
    ...primary,
    derivationKey: EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY,
    sourceEvidenceIds: mergeStringArrays(
      ...exploratory.map((pathway) => pathway.sourceEvidenceIds),
    ),
    sourceUrls: mergeStringArrays(...exploratory.map((pathway) => pathway.sourceUrls)),
    confidence: Math.max(...exploratory.map((pathway) => pathway.confidence || 0)),
    lastObservedAt: exploratory.reduce<Date | undefined>(
      (latest, pathway) => laterDate(latest, pathway.lastObservedAt),
      undefined,
    ),
    lastMaterializedAt: exploratory.reduce<Date | undefined>(
      (latest, pathway) => laterDate(latest, pathway.lastMaterializedAt),
      undefined,
    ),
  };

  return [...pathways.filter((pathway) => pathway.pathwayType !== 'EXPLORATORY_CONTACT'), merged];
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
        excerpt: `${undergradCount(
          bestMaterializerObservation(currentUndergradObservations)?.value,
        )} current undergraduate(s) listed`,
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
  const contactInstructionObservations = byField.get('contactInstructionsQuote') || [];
  const explicitConstraintObservations = (byField.get('undergradConstraintQuote') || []).filter(
    (obs) => materializerStringValue(obs.value).length > 0,
  );
  const hardNegativeConstraintObservations = uniqueObservations([
    ...explicitConstraintObservations.filter((obs) => looksLikeHardNegativeConstraint(obs.value)),
    ...(byField.get('undergradEvidenceQuote') || []).filter((obs) =>
      looksLikeHardNegativeConstraint(obs.value),
    ),
    ...contactInstructionObservations.filter((obs) => looksLikeHardNegativeConstraint(obs.value)),
  ]);
  const gradOnlyConstraintObservations = uniqueObservations([
    ...explicitConstraintObservations.filter((obs) => looksLikeGraduateOnlyInstruction(obs.value)),
    ...contactInstructionObservations.filter((obs) => looksLikeGraduateOnlyInstruction(obs.value)),
  ]);
  if (positiveAccepting.length > 0) {
    const score = maxConfidence(positiveAccepting);
    const quote =
      publicAccessExcerpt(
        bestMaterializerObservation(byField.get('undergradRoleEvidenceQuote') || [])?.value,
      ) ||
      publicAccessExcerpt(
        bestMaterializerObservation(byField.get('undergradEvidenceQuote') || [])?.value,
      );
    entryPathways.push(
      makePathway({
        researchEntityId,
        derivationKey: 'pathway:EXPLORATORY_CONTACT:ACCEPTING_SIGNAL',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        score,
        studentFacingLabel: 'Exploratory outreach',
        explanation: 'Source evidence suggests undergraduates may be able to participate.',
        bestNextStep:
          'Use the evidence to plan targeted outreach rather than treating this as an open posting.',
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
  const negativeAvailabilityObservations = uniqueObservations([
    ...negativeAccepting,
    ...(negativeAccepting.length === 0 && positiveAccepting.length === 0
      ? hardNegativeConstraintObservations
      : []),
  ]);
  if (negativeAvailabilityObservations.length > 0) {
    const score = maxConfidence(negativeAvailabilityObservations);
    const quote =
      publicAccessExcerpt(bestMaterializerObservation(hardNegativeConstraintObservations)?.value) ||
      publicAccessExcerpt(bestMaterializerObservation(explicitConstraintObservations)?.value) ||
      publicAccessExcerpt(
        bestMaterializerObservation(byField.get('undergradEvidenceQuote') || [])?.value,
      ) ||
      publicAccessExcerpt(bestMaterializerObservation(contactInstructionObservations)?.value);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:NOT_CURRENTLY_AVAILABLE',
        signalType: 'NOT_CURRENTLY_AVAILABLE',
        score,
        observations: negativeAvailabilityObservations,
        excerpt: quote || undefined,
      }),
    );
  }

  const joinPageObservations = (byField.get('joinPageUrl') || []).filter((obs) =>
    firstUrlValue(obs.value),
  );
  const joinPageBlockedByConstraint =
    hardNegativeConstraintObservations.length > 0 || gradOnlyConstraintObservations.length > 0;
  const joinPageHasUndergradAccessContext = positiveAccepting.length > 0;
  if (
    joinPageObservations.length > 0 &&
    joinPageHasUndergradAccessContext &&
    !joinPageBlockedByConstraint
  ) {
    const score = maxConfidence(joinPageObservations);
    const bestJoinPage = bestMaterializerObservation(joinPageObservations);
    const joinUrl = firstUrlValue(bestJoinPage?.value);
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

  if (contactInstructionObservations.length > 0) {
    const score = maxConfidence(contactInstructionObservations);
    accessSignals.push(
      makeSignal({
        researchEntityId,
        derivationKey: 'signal:CONTACT_INSTRUCTIONS_EXIST:MICROSITE',
        signalType: 'CONTACT_INSTRUCTIONS_EXIST',
        score,
        observations: contactInstructionObservations,
        excerpt: publicAccessExcerpt(
          bestMaterializerObservation(contactInstructionObservations)?.value,
        ),
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
        explanation:
          'Past undergraduate fellowship or advisee evidence suggests students have found mentored projects here.',
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
  const contactEmail = materializerStringValue(
    bestMaterializerObservation(byField.get('contactEmail') || [])?.value,
  );
  const contactName = materializerStringValue(
    bestMaterializerObservation(byField.get('contactName') || [])?.value,
  );
  const contactRole = materializerStringValue(
    bestMaterializerObservation(byField.get('contactRole') || [])?.value,
  );
  if (contactObservations.length > 0 && (contactEmail || contactName || contactRole)) {
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

    const bestContactObservation = bestMaterializerObservation(contactObservations);
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

  return {
    entryPathways: uniqueByDerivationKey(mergeExploratoryContactPathways(entryPathways)),
    accessSignals: uniqueByDerivationKey(accessSignals),
    contactRoutes: uniqueByDerivationKey(contactRoutes),
  };
}

async function resolveResearchEntityId(identifier: {
  researchEntityId?: string;
  entityKey?: string;
}): Promise<string | null> {
  if (identifier.researchEntityId && mongoose.Types.ObjectId.isValid(identifier.researchEntityId)) {
    return identifier.researchEntityId;
  }
  if (!identifier.entityKey) return null;
  const group: any = await ResearchEntity.findOne(
    { slug: identifier.entityKey },
    { _id: 1 },
  ).lean();
  return group?._id ? String(group._id) : null;
}

function pathwayDerivationKeyForSignal(signal: DerivedAccessSignal): string | undefined {
  switch (signal.signalType) {
    case 'CURRENT_UNDERGRADS':
    case 'REACH_OUT_PLAUSIBLE':
    case 'PAST_UNDERGRADS':
    case 'FELLOWSHIP_COMPATIBLE':
      return EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY;
    default:
      return undefined;
  }
}

export async function mergeLegacyExploratoryContactPathwaysForEntity(
  researchEntityId: string,
  canonicalPathwayId: string,
  explicitLegacyPathwayIds?: string[],
): Promise<LegacyExploratoryContactPathwayMergeResult> {
  const legacyFilter = explicitLegacyPathwayIds
    ? {
        researchEntityId,
        archived: { $ne: true },
        _id: {
          $in: explicitLegacyPathwayIds.filter((id) => mongoose.Types.ObjectId.isValid(id)),
          $ne: canonicalPathwayId,
        },
      }
    : {
        researchEntityId,
        derivationKey: { $in: LEGACY_EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEYS },
        archived: { $ne: true },
      };
  const legacyPathways = await EntryPathway.find(legacyFilter)
    .select('_id sourceEvidenceIds sourceUrls confidence lastObservedAt lastMaterializedAt')
    .lean();

  if (legacyPathways.length === 0) {
    return {
      researchEntityId,
      canonicalPathwayId,
      legacyPathwayIds: [],
      canonicalUpdated: 0,
      relinkedAccessSignals: 0,
      relinkedContactRoutes: 0,
      archivedLegacyPathways: 0,
      mergedSourceEvidenceIds: [],
      mergedSourceUrls: [],
    };
  }

  const canonicalPathway = await EntryPathway.findById(canonicalPathwayId)
    .select('_id sourceEvidenceIds sourceUrls confidence lastObservedAt lastMaterializedAt')
    .lean();
  const merged = buildMergedEntryPathwayData([
    ...(canonicalPathway ? [canonicalPathway] : []),
    ...legacyPathways,
  ]);
  const legacyPathwayIds = legacyPathways.map((pathway: any) => pathway._id).filter(Boolean);
  const now = new Date();

  const canonicalUpdate = await EntryPathway.updateOne(
    { _id: canonicalPathwayId },
    {
      $addToSet: {
        sourceEvidenceIds: { $each: merged.sourceEvidenceIds },
        sourceUrls: { $each: merged.sourceUrls },
      },
      $max: {
        ...(merged.confidence !== undefined ? { confidence: merged.confidence } : {}),
        ...(merged.lastObservedAt ? { lastObservedAt: merged.lastObservedAt } : {}),
        ...(merged.lastMaterializedAt ? { lastMaterializedAt: merged.lastMaterializedAt } : {}),
      },
    },
  );

  const [accessSignals, contactRoutes] = await Promise.all([
    AccessSignal.updateMany(
      { entryPathwayId: { $in: legacyPathwayIds }, archived: { $ne: true } },
      { $set: { entryPathwayId: canonicalPathwayId, lastMaterializedAt: now } },
    ),
    ContactRoute.updateMany(
      { entryPathwayId: { $in: legacyPathwayIds }, archived: { $ne: true } },
      { $set: { entryPathwayId: canonicalPathwayId, lastMaterializedAt: now } },
    ),
  ]);

  const archivedLegacy = await EntryPathway.updateMany(
    { _id: { $in: legacyPathwayIds }, archived: { $ne: true } },
    {
      $set: {
        archived: true,
        lastMaterializedAt: now,
      },
    },
  );

  return {
    researchEntityId,
    canonicalPathwayId,
    legacyPathwayIds: legacyPathwayIds.map(String),
    canonicalUpdated: canonicalUpdate.modifiedCount || 0,
    relinkedAccessSignals: accessSignals.modifiedCount || 0,
    relinkedContactRoutes: contactRoutes.modifiedCount || 0,
    archivedLegacyPathways: archivedLegacy.modifiedCount || 0,
    mergedSourceEvidenceIds: merged.sourceEvidenceIds,
    mergedSourceUrls: merged.sourceUrls,
  };
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

  const exploratoryPathwayId = pathwayIdByKey.get(EXPLORATORY_CONTACT_PATHWAY_DERIVATION_KEY);
  if (exploratoryPathwayId) {
    await mergeLegacyExploratoryContactPathwaysForEntity(researchEntityId, exploratoryPathwayId);
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
    await upsertContactRoute(route);
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
