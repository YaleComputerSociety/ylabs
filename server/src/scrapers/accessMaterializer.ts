/**
 * Derives first-class access/pathway/contact records from append-only
 * Observations. This runs beside the legacy entity materializer: it should not
 * replace scalar ResearchGroup compatibility fields yet.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
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

function uniqueByDerivationKey<T extends { derivationKey: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.derivationKey, item])).values());
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
    entryPathways: uniqueByDerivationKey(entryPathways),
    accessSignals: uniqueByDerivationKey(accessSignals),
    contactRoutes: uniqueByDerivationKey(contactRoutes),
  };
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
