import mongoose from 'mongoose';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { User } from '../models/user';
import { syncPathwaySearchIndexDocument } from './pathwaySearchIndexService';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type { CompensationType, PostedOpportunityStatus } from '../models/researchAccessTypes';

const FACULTY_ROLES = new Set(['professor', 'faculty']);
const OWNER_MEMBERSHIP_ROLES = ['pi', 'co-pi', 'director', 'co-director'];
const COMPENSATION_TYPES = new Set<CompensationType>([
  'PAID',
  'COURSE_CREDIT',
  'STIPEND',
  'VOLUNTEER',
  'WORK_STUDY',
  'FELLOWSHIP',
  'FELLOWSHIP_ELIGIBLE',
  'UNKNOWN',
]);
const EDITABLE_STATUSES = new Set<PostedOpportunityStatus>(['OPEN', 'ROLLING']);
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const NETID_RE = /^[A-Za-z0-9]{2,12}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_FACULTY_OPPORTUNITIES = 100;
const MAX_AUDIT_HISTORY = 100;
const MAX_DEADLINE_YEARS = 3;

export type FacultyOpportunityFieldErrors = Record<string, string>;

export class FacultyOpportunityError extends Error {
  status: number;
  code: string;
  fieldErrors?: FacultyOpportunityFieldErrors;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: FacultyOpportunityFieldErrors,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    Object.setPrototypeOf(this, FacultyOpportunityError.prototype);
  }
}

export interface FacultyOpportunityServiceDeps {
  userModel?: mongoose.Model<any>;
  researchEntityModel?: mongoose.Model<any>;
  memberModel?: mongoose.Model<any>;
  opportunityModel?: mongoose.Model<any>;
  pathwayModel?: mongoose.Model<any>;
  syncPathway?: (pathwayId: string) => Promise<unknown>;
  transaction?: <T>(work: (session: mongoose.ClientSession) => Promise<T>) => Promise<T>;
  now?: () => Date;
}

export interface FacultyOpportunityInput {
  researchEntityId?: unknown;
  title?: unknown;
  description?: unknown;
  term?: unknown;
  deadline?: unknown;
  applicationUrl?: unknown;
  status?: unknown;
  hoursPerWeek?: unknown;
  payRate?: unknown;
  compensationType?: unknown;
  eligibility?: unknown;
}

interface ValidatedFacultyOpportunity {
  researchEntityId?: string;
  title: string;
  description: string;
  term: string;
  deadline?: Date;
  applicationUrl: string;
  status: PostedOpportunityStatus;
  hoursPerWeek?: number;
  payRate: string;
  compensationType: CompensationType;
  eligibility: string;
}

const modelDeps = (
  deps: FacultyOpportunityServiceDeps = {},
): {
  userModel: any;
  researchEntityModel: any;
  memberModel: any;
  opportunityModel: any;
  pathwayModel: any;
} => ({
  userModel: deps.userModel || User,
  researchEntityModel: deps.researchEntityModel || ResearchEntity,
  memberModel: deps.memberModel || ResearchGroupMember,
  opportunityModel: deps.opportunityModel || PostedOpportunity,
  pathwayModel: deps.pathwayModel || EntryPathway,
});

const nowFor = (deps: FacultyOpportunityServiceDeps): Date => deps.now?.() || new Date();

const idString = (value: unknown): string => serializedDocumentId(value) || '';

const objectId = (value: unknown, field = 'id'): mongoose.Types.ObjectId => {
  const id = idString(value).trim();
  if (!OBJECT_ID_RE.test(id)) {
    throw new FacultyOpportunityError(400, 'INVALID_ID', `Invalid ${field}`);
  }
  return new mongoose.Types.ObjectId(id);
};

const normalizeNetid = (value: unknown): string => {
  const netid = typeof value === 'string' ? value.trim() : '';
  if (!NETID_RE.test(netid)) {
    throw new FacultyOpportunityError(401, 'AUTH_REQUIRED', 'Authentication is required');
  }
  return netid;
};

const boundedText = (
  value: unknown,
  field: string,
  maxLength: number,
  errors: FacultyOpportunityFieldErrors,
): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    errors[field] = 'Must be text';
    return '';
  }
  const text = value.replace(/\r\n/g, '\n').trim();
  if (text.length > maxLength) errors[field] = `Must be ${maxLength} characters or fewer`;
  return text;
};

const YALE_TIME_ZONE = 'America/New_York';
const yaleDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: YALE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const yaleDateTimeToUtc = (year: number, month: number, day: number, hour: number): Date => {
  const target = Date.UTC(year, month - 1, day, hour);
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(
      yaleDateTimeFormatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant += target - represented;
  }
  return new Date(instant);
};

const endOfYaleCalendarDay = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  return new Date(
    yaleDateTimeToUtc(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
      0,
    ).getTime() - 1,
  );
};

const parseDeadline = (value: unknown, errors: FacultyOpportunityFieldErrors): Date | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && !(value instanceof Date)) {
    errors.deadline = 'Enter a valid deadline';
    return undefined;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  const calendarDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (calendarDateMatch) {
    const [, yearText, monthText, dayText] = calendarDateMatch;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const roundTrip = new Date(Date.UTC(year, month - 1, day));
    if (
      roundTrip.getUTCFullYear() !== year ||
      roundTrip.getUTCMonth() + 1 !== month ||
      roundTrip.getUTCDate() !== day
    ) {
      errors.deadline = 'Enter a valid deadline';
      return undefined;
    }
  }
  const deadline = calendarDateMatch
    ? endOfYaleCalendarDay(text)
    : value instanceof Date
      ? new Date(value)
      : new Date(text);
  if (Number.isNaN(deadline.getTime())) {
    errors.deadline = 'Enter a valid deadline';
    return undefined;
  }
  return deadline;
};

export function validateFacultyOpportunityInput(
  input: FacultyOpportunityInput,
  options: { requireComplete?: boolean; now?: Date } = {},
): ValidatedFacultyOpportunity {
  const requireComplete = options.requireComplete === true;
  const now = options.now || new Date();
  const errors: FacultyOpportunityFieldErrors = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const researchEntityId = idString(source.researchEntityId).trim();
  if (source.researchEntityId !== undefined && !OBJECT_ID_RE.test(researchEntityId)) {
    errors.researchEntityId = 'Choose a valid owned research profile';
  }
  const title = boundedText(source.title, 'title', 160, errors);
  const description = boundedText(source.description, 'description', 5000, errors);
  const term = boundedText(source.term, 'term', 120, errors);
  const applicationUrlRaw = boundedText(source.applicationUrl, 'applicationUrl', 2048, errors);
  const payRate = boundedText(source.payRate, 'payRate', 120, errors);
  const eligibility = boundedText(source.eligibility, 'eligibility', 2000, errors);
  const deadline = parseDeadline(source.deadline, errors);
  const status = typeof source.status === 'string' ? source.status.trim().toUpperCase() : '';
  const compensationType =
    typeof source.compensationType === 'string'
      ? source.compensationType.trim().toUpperCase()
      : 'UNKNOWN';

  if (title.length < (requireComplete ? 8 : 3)) {
    errors.title = requireComplete
      ? 'Enter a specific title of at least 8 characters'
      : 'Enter a title of at least 3 characters';
  }
  if (description && description.length < 20) {
    errors.description = 'Add at least 20 characters or leave the draft description empty';
  }
  if (requireComplete && description.length < 50) {
    errors.description = 'Add a description of at least 50 characters';
  }
  if (!EDITABLE_STATUSES.has(status as PostedOpportunityStatus)) {
    errors.status = 'Choose a dated opening or a rolling opening';
  }
  if (status === 'OPEN' && requireComplete && !deadline && !errors.deadline) {
    errors.deadline = 'A dated opening needs a deadline';
  }
  if (status === 'ROLLING' && deadline) {
    errors.deadline = 'Remove the deadline or choose a dated opening';
  }
  if (deadline) {
    if (requireComplete && deadline.getTime() <= now.getTime()) {
      errors.deadline = 'The deadline must be in the future';
    }
    const latest = new Date(now);
    latest.setUTCFullYear(latest.getUTCFullYear() + MAX_DEADLINE_YEARS);
    if (deadline.getTime() > latest.getTime()) {
      errors.deadline = `The deadline must be within ${MAX_DEADLINE_YEARS} years`;
    }
  }

  let applicationUrl = '';
  if (applicationUrlRaw) {
    applicationUrl = publicHttpUrl(applicationUrlRaw) || '';
    if (!applicationUrl || !applicationUrl.startsWith('https://')) {
      errors.applicationUrl = 'Enter a safe public HTTPS application URL';
    }
  } else if (requireComplete) {
    errors.applicationUrl = 'An official application URL is required';
  }

  let hoursPerWeek: number | undefined;
  if (
    source.hoursPerWeek !== undefined &&
    source.hoursPerWeek !== null &&
    source.hoursPerWeek !== ''
  ) {
    const parsed = Number(source.hoursPerWeek);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 80) {
      errors.hoursPerWeek = 'Enter a whole number from 1 to 80';
    } else {
      hoursPerWeek = parsed;
    }
  }
  if (!COMPENSATION_TYPES.has(compensationType as CompensationType)) {
    errors.compensationType = 'Choose a valid compensation type';
  }

  if (Object.keys(errors).length > 0) {
    throw new FacultyOpportunityError(
      400,
      'VALIDATION_FAILED',
      'Review the highlighted opportunity fields',
      errors,
    );
  }

  return {
    researchEntityId: researchEntityId || undefined,
    title,
    description,
    term,
    deadline,
    applicationUrl,
    status: status as PostedOpportunityStatus,
    hoursPerWeek,
    payRate,
    compensationType: compensationType as CompensationType,
    eligibility,
  };
}

async function readVerifiedFaculty(netidValue: unknown, deps: FacultyOpportunityServiceDeps) {
  const netid = normalizeNetid(netidValue);
  const { userModel } = modelDeps(deps);
  const user = await userModel
    .findOne({ netid })
    .select('_id netid userType userConfirmed profileVerified facultyMemberId')
    .lean();
  if (!user) {
    throw new FacultyOpportunityError(401, 'AUTH_REQUIRED', 'Authentication is required');
  }
  if (!FACULTY_ROLES.has(String(user.userType || ''))) {
    throw new FacultyOpportunityError(
      403,
      'FACULTY_ACCESS_REQUIRED',
      'Verified faculty access is required',
    );
  }
  if (user.userConfirmed !== true) {
    throw new FacultyOpportunityError(
      403,
      'ACCOUNT_CONFIRMATION_REQUIRED',
      'Account confirmation is required',
    );
  }
  if (user.profileVerified !== true) {
    throw new FacultyOpportunityError(
      403,
      'PROFILE_VERIFICATION_REQUIRED',
      'Faculty profile verification is required',
    );
  }
  return user;
}

const memberFilter = (researchEntityId: mongoose.Types.ObjectId) => ({
  researchEntityId,
  archived: { $ne: true },
  isCurrentMember: { $ne: false },
  role: { $in: OWNER_MEMBERSHIP_ROLES },
});

function membershipHasConflict(memberships: any[], user: any): boolean {
  const userId = idString(user._id);
  const facultyMemberId = idString(user.facultyMemberId);
  const owned = memberships.filter((member) => idString(member.userId) === userId);
  if (owned.length === 0) return false;

  const ownedFacultyIds = new Set(
    owned.map((member) => idString(member.facultyMemberId)).filter(Boolean),
  );
  if (ownedFacultyIds.size > 1) return true;
  if (ownedFacultyIds.size === 1 && (!facultyMemberId || !ownedFacultyIds.has(facultyMemberId))) {
    return true;
  }
  if (
    facultyMemberId &&
    memberships.some(
      (member) =>
        idString(member.facultyMemberId) === facultyMemberId &&
        idString(member.userId) &&
        idString(member.userId) !== userId,
    )
  ) {
    return true;
  }
  return false;
}

async function requireOwnedResearchEntity(
  researchEntityIdValue: unknown,
  user: any,
  deps: FacultyOpportunityServiceDeps,
) {
  const researchEntityId = objectId(researchEntityIdValue, 'research entity id');
  const { researchEntityModel, memberModel } = modelDeps(deps);
  const [entity, memberships] = await Promise.all([
    researchEntityModel
      .findOne({ _id: researchEntityId, archived: { $ne: true } })
      .select(
        '_id slug name displayName entityType kind studentVisibilityReasons studentVisibilityComputedReasons',
      )
      .lean(),
    memberModel
      .find(memberFilter(researchEntityId))
      .select('_id userId facultyMemberId role')
      .lean(),
  ]);
  if (!entity) {
    throw new FacultyOpportunityError(404, 'ENTITY_NOT_FOUND', 'Research profile not found');
  }
  const ownedMemberships = (memberships as any[]).filter(
    (membership) => idString(membership.userId) === idString(user._id),
  );
  if (ownedMemberships.length === 0) {
    throw new FacultyOpportunityError(
      403,
      'OWNERSHIP_REQUIRED',
      'A current lead membership is required for this research profile',
    );
  }
  const entityReasons = [
    ...(Array.isArray(entity.studentVisibilityReasons) ? entity.studentVisibilityReasons : []),
    ...(Array.isArray(entity.studentVisibilityComputedReasons)
      ? entity.studentVisibilityComputedReasons
      : []),
  ];
  if (entityReasons.includes('pi_identity_conflict') || membershipHasConflict(memberships, user)) {
    throw new FacultyOpportunityError(
      409,
      'OWNERSHIP_CONFLICT',
      'This research profile has an identity conflict that must be reviewed before posting',
    );
  }
  return { entity, membership: ownedMemberships[0] };
}

function opportunityState(opportunity: any, now: Date): string {
  if (opportunity.archived === true || opportunity.status === 'ARCHIVED') return 'ARCHIVED';
  if (opportunity.status === 'CLOSED') return 'CLOSED';
  if (
    opportunity.status === 'OPEN' &&
    opportunity.deadline &&
    new Date(opportunity.deadline).getTime() < now.getTime()
  ) {
    return 'CLOSED';
  }
  if (opportunity.submissionStatus === 'PENDING_REVIEW') return 'PENDING_REVIEW';
  if (opportunity.review?.status === 'approved') return 'APPROVED_LIVE';
  if (opportunity.review?.status === 'needs_source') return 'REJECTED_NEEDS_SOURCE';
  if (opportunity.review?.status === 'disputed') return 'OWNERSHIP_CONFLICT';
  return 'DRAFT';
}

export function facultyOpportunityDto(opportunity: any, now = new Date()) {
  return {
    _id: idString(opportunity._id),
    researchEntityId: idString(opportunity.researchEntityId),
    entryPathwayId: idString(opportunity.entryPathwayId),
    title: String(opportunity.title || ''),
    description: String(opportunity.description || ''),
    term: String(opportunity.term || ''),
    deadline: opportunity.deadline || undefined,
    applicationUrl: String(opportunity.applicationUrl || ''),
    status: opportunity.status,
    hoursPerWeek: opportunity.hoursPerWeek,
    payRate: String(opportunity.payRate || ''),
    compensationType: opportunity.compensationType || 'UNKNOWN',
    eligibility: String(opportunity.eligibility || ''),
    workflowState: opportunityState(opportunity, now),
    submissionStatus: opportunity.submissionStatus || 'DRAFT',
    reviewStatus: opportunity.review?.status || 'unreviewed',
    reviewNote: String(opportunity.review?.note || ''),
    revision: Number.isInteger(opportunity.revision) ? opportunity.revision : 0,
    submittedAt: opportunity.submittedAt || undefined,
    closedAt: opportunity.closedAt || undefined,
    archivedAt: opportunity.archivedAt || undefined,
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
    auditHistory: (Array.isArray(opportunity.auditHistory) ? opportunity.auditHistory : [])
      .slice(-MAX_AUDIT_HISTORY)
      .map((entry: any) => ({
        action: entry.action,
        occurredAt: entry.occurredAt,
        revision: entry.revision,
      })),
  };
}

async function runOptionalPathwaySync(
  pathwayId: string,
  deps: FacultyOpportunityServiceDeps,
): Promise<void> {
  if (!pathwayId) return;
  if (!deps.syncPathway && process.env.PATHWAY_SEARCH_SYNC !== 'true') return;
  const sync = deps.syncPathway || syncPathwaySearchIndexDocument;
  await sync(pathwayId).catch((error) => {
    console.error('Faculty opportunity pathway sync failed:', sanitizeLogValue(error));
  });
}

const runTransaction = <T>(
  deps: FacultyOpportunityServiceDeps,
  work: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> =>
  (deps.transaction || ((callback) => mongoose.connection.transaction(callback)))(work);

function pathwayFields(input: ValidatedFacultyOpportunity, archived = false) {
  return {
    status: archived ? 'NOT_CURRENTLY_AVAILABLE' : 'ACTIVE',
    evidenceStrength: 'DIRECT',
    studentFacingLabel: input.title,
    explanation: input.description,
    bestNextStep: input.applicationUrl ? 'Apply through the official application.' : '',
    compensation: input.compensationType,
    sourceUrls: input.applicationUrl ? [input.applicationUrl] : [],
    confidence: 1,
    archived,
    lastObservedAt: new Date(),
    lastMaterializedAt: new Date(),
    'review.status': 'unreviewed',
    'review.reviewedByUserId': null,
    'review.reviewedAt': null,
    'review.note': '',
    'review.lockedFields': [],
  };
}

function opportunityContent(input: ValidatedFacultyOpportunity) {
  return {
    title: input.title,
    description: input.description,
    term: input.term,
    deadline: input.deadline || null,
    applicationUrl: input.applicationUrl,
    status: input.status,
    hoursPerWeek: input.hoursPerWeek ?? null,
    payRate: input.payRate,
    compensationType: input.compensationType,
    eligibility: input.eligibility,
    sourceUrls: input.applicationUrl ? [input.applicationUrl] : [],
  };
}

const auditEntry = (action: string, actorUserId: unknown, revision: number, occurredAt: Date) => ({
  action,
  actorUserId,
  occurredAt,
  revision,
});

function normalizeExpectedRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new FacultyOpportunityError(
      400,
      'REVISION_REQUIRED',
      'A valid opportunity revision is required',
    );
  }
  return revision;
}

function normalizeIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new FacultyOpportunityError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
    );
  }
  return key;
}

export async function listOwnedResearchEntities(
  netid: unknown,
  deps: FacultyOpportunityServiceDeps = {},
) {
  const user = await readVerifiedFaculty(netid, deps);
  const { memberModel, researchEntityModel } = modelDeps(deps);
  const memberships = await memberModel
    .find({
      userId: user._id,
      archived: { $ne: true },
      isCurrentMember: { $ne: false },
      role: { $in: OWNER_MEMBERSHIP_ROLES },
    })
    .select('researchEntityId')
    .limit(MAX_FACULTY_OPPORTUNITIES)
    .lean();
  const entityIds = Array.from(
    new Set(
      (memberships as any[])
        .map((membership) => idString(membership.researchEntityId))
        .filter(Boolean),
    ),
  ).map((id) => new mongoose.Types.ObjectId(id));
  if (entityIds.length === 0) return [];
  const entities = await researchEntityModel
    .find({ _id: { $in: entityIds }, archived: { $ne: true } })
    .select('_id slug name displayName entityType kind')
    .sort({ name: 1, _id: 1 })
    .lean();

  const owned = [];
  let hasOwnershipConflict = false;
  for (const entity of entities as any[]) {
    try {
      await requireOwnedResearchEntity(entity._id, user, deps);
      owned.push({
        _id: idString(entity._id),
        slug: entity.slug || '',
        name: entity.displayName || entity.name || '',
        entityType: entity.entityType,
        kind: entity.kind,
      });
    } catch (error) {
      if (error instanceof FacultyOpportunityError && error.code === 'OWNERSHIP_CONFLICT') {
        hasOwnershipConflict = true;
      } else {
        throw error;
      }
    }
  }
  if (owned.length === 0 && hasOwnershipConflict) {
    throw new FacultyOpportunityError(
      409,
      'OWNERSHIP_CONFLICT',
      'A linked research profile has an identity conflict that must be reviewed before posting',
    );
  }
  return owned;
}

export async function listFacultyOpportunities(
  netid: unknown,
  deps: FacultyOpportunityServiceDeps = {},
) {
  const user = await readVerifiedFaculty(netid, deps);
  const { opportunityModel } = modelDeps(deps);
  const opportunities = await opportunityModel
    .find({ createdByUserId: user._id })
    .sort({ updatedAt: -1, _id: 1 })
    .limit(MAX_FACULTY_OPPORTUNITIES)
    .lean();
  return (opportunities as any[]).map((opportunity) =>
    facultyOpportunityDto(opportunity, nowFor(deps)),
  );
}

export async function previewFacultyOpportunityDraft(
  netid: unknown,
  input: FacultyOpportunityInput,
  deps: FacultyOpportunityServiceDeps = {},
) {
  const user = await readVerifiedFaculty(netid, deps);
  const validated = validateFacultyOpportunityInput(input, { now: nowFor(deps) });
  if (!validated.researchEntityId) {
    throw new FacultyOpportunityError(
      400,
      'VALIDATION_FAILED',
      'Choose an owned research profile',
      {
        researchEntityId: 'Choose an owned research profile',
      },
    );
  }
  const { entity } = await requireOwnedResearchEntity(validated.researchEntityId, user, deps);
  return {
    ...opportunityContent(validated),
    researchEntityId: idString(entity._id),
    researchEntity: {
      slug: entity.slug || '',
      name: entity.displayName || entity.name || '',
      entityType: entity.entityType,
      kind: entity.kind,
    },
    workflowState: 'DRAFT',
  };
}

export async function createFacultyOpportunityDraft(
  netid: unknown,
  input: FacultyOpportunityInput,
  idempotencyKeyValue: unknown,
  deps: FacultyOpportunityServiceDeps = {},
): Promise<{ opportunity: ReturnType<typeof facultyOpportunityDto>; created: boolean }> {
  const user = await readVerifiedFaculty(netid, deps);
  const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyValue);
  const validated = validateFacultyOpportunityInput(input, { now: nowFor(deps) });
  if (!validated.researchEntityId) {
    throw new FacultyOpportunityError(
      400,
      'VALIDATION_FAILED',
      'Choose an owned research profile',
      {
        researchEntityId: 'Choose an owned research profile',
      },
    );
  }
  const { entity, membership } = await requireOwnedResearchEntity(
    validated.researchEntityId,
    user,
    deps,
  );
  const { opportunityModel, pathwayModel } = modelDeps(deps);
  const existing = await opportunityModel
    .findOne({ createdByUserId: user._id, idempotencyKey })
    .lean();
  if (existing) {
    if (idString(existing.researchEntityId) !== idString(entity._id)) {
      throw new FacultyOpportunityError(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This idempotency key belongs to a different opportunity draft',
      );
    }
    return { opportunity: facultyOpportunityDto(existing, nowFor(deps)), created: false };
  }

  const now = nowFor(deps);
  const opportunityId = new mongoose.Types.ObjectId();
  const pathwayId = new mongoose.Types.ObjectId();
  const derivationKey = `faculty-opportunity:${opportunityId.toHexString()}`;
  await pathwayModel.create({
    _id: pathwayId,
    researchEntityId: entity._id,
    pathwayType: 'POSTED_ROLE',
    derivationKey,
    ...pathwayFields(validated, true),
  });

  try {
    const opportunity = await opportunityModel.create({
      _id: opportunityId,
      entryPathwayId: pathwayId,
      researchEntityId: entity._id,
      createdByUserId: user._id,
      ownerMembershipId: membership._id,
      idempotencyKey,
      origin: 'FACULTY_SUBMITTED',
      submissionStatus: 'DRAFT',
      revision: 0,
      archived: false,
      review: { status: 'unreviewed' },
      auditHistory: [auditEntry('DRAFT_CREATED', user._id, 0, now)],
      ...opportunityContent(validated),
    });
    const plain = typeof opportunity.toObject === 'function' ? opportunity.toObject() : opportunity;
    await runOptionalPathwaySync(pathwayId.toHexString(), deps);
    return { opportunity: facultyOpportunityDto(plain, now), created: true };
  } catch (error) {
    await pathwayModel.deleteOne({ _id: pathwayId }).catch(() => undefined);
    if ((error as any)?.code === 11000) {
      const retry = await opportunityModel
        .findOne({ createdByUserId: user._id, idempotencyKey })
        .lean();
      if (retry) return { opportunity: facultyOpportunityDto(retry, now), created: false };
    }
    throw error;
  }
}

async function readOwnedOpportunity(
  idValue: unknown,
  user: any,
  deps: FacultyOpportunityServiceDeps,
) {
  const id = objectId(idValue, 'opportunity id');
  const { opportunityModel } = modelDeps(deps);
  const opportunity = await opportunityModel.findOne({ _id: id, createdByUserId: user._id }).lean();
  if (!opportunity) {
    throw new FacultyOpportunityError(404, 'OPPORTUNITY_NOT_FOUND', 'Opportunity not found');
  }
  await requireOwnedResearchEntity(opportunity.researchEntityId, user, deps);
  return opportunity;
}

export async function updateFacultyOpportunityDraft(
  netid: unknown,
  idValue: unknown,
  input: FacultyOpportunityInput,
  expectedRevisionValue: unknown,
  deps: FacultyOpportunityServiceDeps = {},
) {
  const user = await readVerifiedFaculty(netid, deps);
  const current = await readOwnedOpportunity(idValue, user, deps);
  if (current.archived === true || current.status === 'ARCHIVED') {
    throw new FacultyOpportunityError(
      409,
      'ARCHIVED_OPPORTUNITY',
      'Archived opportunities cannot be changed',
    );
  }
  const expectedRevision = normalizeExpectedRevision(expectedRevisionValue);
  const validated = validateFacultyOpportunityInput(
    { ...current, ...input, researchEntityId: idString(current.researchEntityId) },
    { now: nowFor(deps) },
  );
  if (
    input.researchEntityId !== undefined &&
    idString(input.researchEntityId) !== idString(current.researchEntityId)
  ) {
    throw new FacultyOpportunityError(
      400,
      'ENTITY_IMMUTABLE',
      'The research profile cannot be changed after draft creation',
    );
  }
  const { opportunityModel, pathwayModel } = modelDeps(deps);
  const now = nowFor(deps);
  const nextRevision = expectedRevision + 1;
  const updated = await runTransaction(deps, async (session) => {
    const result = await opportunityModel
      .findOneAndUpdate(
        { _id: current._id, createdByUserId: user._id, revision: expectedRevision },
        {
          $set: {
            ...opportunityContent(validated),
            submissionStatus: 'DRAFT',
            submittedAt: null,
            'review.status': 'unreviewed',
            'review.reviewedByUserId': null,
            'review.reviewedAt': null,
            'review.note': '',
            'review.lockedFields': [],
          },
          $inc: { revision: 1 },
          $push: {
            auditHistory: {
              $each: [auditEntry('DRAFT_UPDATED', user._id, nextRevision, now)],
              $slice: -MAX_AUDIT_HISTORY,
            },
          },
        },
        { new: true, runValidators: true, session },
      )
      .lean();
    if (!result) {
      throw new FacultyOpportunityError(
        409,
        'STALE_REVISION',
        'This draft changed in another session. Reload it before saving again',
      );
    }
    const pathwayResult = await pathwayModel.updateOne(
      { _id: current.entryPathwayId },
      { $set: pathwayFields(validated, true) },
      { runValidators: true, session },
    );
    if (pathwayResult.matchedCount === 0) throw new Error('Linked pathway not found');
    return result;
  });
  await runOptionalPathwaySync(idString(current.entryPathwayId), deps);
  return facultyOpportunityDto(updated, now);
}

export async function submitFacultyOpportunity(
  netid: unknown,
  idValue: unknown,
  expectedRevisionValue: unknown,
  deps: FacultyOpportunityServiceDeps = {},
) {
  const user = await readVerifiedFaculty(netid, deps);
  const current = await readOwnedOpportunity(idValue, user, deps);
  const expectedRevision = normalizeExpectedRevision(expectedRevisionValue);
  if (current.archived === true || current.status === 'ARCHIVED' || current.status === 'CLOSED') {
    throw new FacultyOpportunityError(
      409,
      'NOT_SUBMITTABLE',
      'Closed or archived opportunities cannot be submitted',
    );
  }
  if (current.submissionStatus === 'PENDING_REVIEW') {
    return facultyOpportunityDto(current, nowFor(deps));
  }
  if (current.submissionStatus !== 'DRAFT') {
    throw new FacultyOpportunityError(
      409,
      'NOT_SUBMITTABLE',
      'Update and save this opportunity as a new draft before submitting it again',
    );
  }
  const now = nowFor(deps);
  const validated = validateFacultyOpportunityInput(current, { requireComplete: true, now });
  const { opportunityModel, pathwayModel } = modelDeps(deps);
  const nextRevision = expectedRevision + 1;
  const submitted = await runTransaction(deps, async (session) => {
    const result = await opportunityModel
      .findOneAndUpdate(
        { _id: current._id, createdByUserId: user._id, revision: expectedRevision },
        {
          $set: {
            submissionStatus: 'PENDING_REVIEW',
            submittedAt: now,
            'review.status': 'unreviewed',
            'review.reviewedByUserId': null,
            'review.reviewedAt': null,
            'review.note': '',
            'review.lockedFields': [],
          },
          $inc: { revision: 1 },
          $push: {
            auditHistory: {
              $each: [auditEntry('SUBMITTED', user._id, nextRevision, now)],
              $slice: -MAX_AUDIT_HISTORY,
            },
          },
        },
        { new: true, runValidators: true, session },
      )
      .lean();
    if (!result) {
      throw new FacultyOpportunityError(
        409,
        'STALE_REVISION',
        'This draft changed in another session. Reload it before submitting',
      );
    }
    const pathwayResult = await pathwayModel.updateOne(
      { _id: current.entryPathwayId },
      { $set: pathwayFields(validated) },
      { runValidators: true, session },
    );
    if (pathwayResult.matchedCount === 0) throw new Error('Linked pathway not found');
    return result;
  });
  await runOptionalPathwaySync(idString(current.entryPathwayId), deps);
  return facultyOpportunityDto(submitted, now);
}

async function setInactiveFacultyOpportunity(
  netid: unknown,
  idValue: unknown,
  expectedRevisionValue: unknown,
  action: 'CLOSED' | 'ARCHIVED',
  deps: FacultyOpportunityServiceDeps,
) {
  const user = await readVerifiedFaculty(netid, deps);
  const current = await readOwnedOpportunity(idValue, user, deps);
  const isArchive = action === 'ARCHIVED';
  if (
    (isArchive && (current.archived === true || current.status === 'ARCHIVED')) ||
    (!isArchive && current.status === 'CLOSED')
  ) {
    return facultyOpportunityDto(current, nowFor(deps));
  }
  const expectedRevision = normalizeExpectedRevision(expectedRevisionValue);
  const now = nowFor(deps);
  const { opportunityModel, pathwayModel } = modelDeps(deps);
  const nextRevision = expectedRevision + 1;
  const updated = await runTransaction(deps, async (session) => {
    const result = await opportunityModel
      .findOneAndUpdate(
        { _id: current._id, createdByUserId: user._id, revision: expectedRevision },
        {
          $set: {
            status: action,
            archived: isArchive,
            ...(isArchive ? { archivedAt: now } : { closedAt: now }),
          },
          $inc: { revision: 1 },
          $push: {
            auditHistory: {
              $each: [auditEntry(action, user._id, nextRevision, now)],
              $slice: -MAX_AUDIT_HISTORY,
            },
          },
        },
        { new: true, runValidators: true, session },
      )
      .lean();
    if (!result) {
      throw new FacultyOpportunityError(
        409,
        'STALE_REVISION',
        'This opportunity changed in another session. Reload it before trying again',
      );
    }
    const pathwayResult = await pathwayModel.updateOne(
      { _id: current.entryPathwayId },
      {
        $set: {
          status: 'NOT_CURRENTLY_AVAILABLE',
          bestNextStep: 'This posted opportunity is not currently available.',
          archived: isArchive,
        },
      },
      { runValidators: true, session },
    );
    if (pathwayResult.matchedCount === 0) throw new Error('Linked pathway not found');
    return result;
  });
  await runOptionalPathwaySync(idString(current.entryPathwayId), deps);
  return facultyOpportunityDto(updated, now);
}

export const closeFacultyOpportunity = (
  netid: unknown,
  idValue: unknown,
  expectedRevisionValue: unknown,
  deps: FacultyOpportunityServiceDeps = {},
) => setInactiveFacultyOpportunity(netid, idValue, expectedRevisionValue, 'CLOSED', deps);

export const archiveFacultyOpportunity = (
  netid: unknown,
  idValue: unknown,
  expectedRevisionValue: unknown,
  deps: FacultyOpportunityServiceDeps = {},
) => setInactiveFacultyOpportunity(netid, idValue, expectedRevisionValue, 'ARCHIVED', deps);
