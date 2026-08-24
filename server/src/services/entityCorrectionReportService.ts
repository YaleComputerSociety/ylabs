/**
 * Service layer for authenticated reader-submitted ResearchEntity correction
 * reports. Reports enqueue an admin review record and never mutate served data.
 */
import mongoose from 'mongoose';
import {
  EntityCorrectionReport,
  EntityCorrectionReportCategory,
  EntityCorrectionReportStatus,
} from '../models/entityCorrectionReport';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { normalizeResearchDetailSlug } from './researchGroupService';
import { BadRequestError, NotFoundError, ObjectIdError } from '../utils/errors';
import { replaceAsciiControls } from '../utils/asciiControl';

const CATEGORIES = new Set<string>(EntityCorrectionReportCategory);
const RESOLUTION_STATUSES = new Set<string>(['accepted', 'dismissed']);
const STATUS_FILTERS = new Set<string>(EntityCorrectionReportStatus);

const MAX_NOTE_LENGTH = 2000;
const MAX_REVIEWER_NOTE_LENGTH = 2000;

const STUDENT_USER_TYPES = new Set(['undergraduate', 'graduate', 'student']);
const FACULTY_USER_TYPES = new Set(['professor', 'faculty']);

export type EntityCorrectionReporter = {
  netId?: string;
  email?: string;
  fname?: string;
  lname?: string;
  userType?: string;
};

export type CreateEntityCorrectionReportInput = {
  category?: unknown;
  note?: unknown;
};

type ResearchEntitySnapshot = {
  _id: mongoose.Types.ObjectId;
  slug?: string;
  name?: string;
  displayName?: string;
  kind?: string;
  entityType?: string;
};

export const deriveReporterRole = (userType: unknown): 'student' | 'faculty' | 'staff' | 'other' => {
  const normalized = typeof userType === 'string' ? userType.trim().toLowerCase() : '';
  if (STUDENT_USER_TYPES.has(normalized)) return 'student';
  if (FACULTY_USER_TYPES.has(normalized)) return 'faculty';
  if (normalized === 'staff') return 'staff';
  return 'other';
};

const normalizeRequestBody = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
};

export const sanitizeReportNote = (value: unknown, maxLength = MAX_NOTE_LENGTH): string => {
  if (typeof value !== 'string') return '';
  return replaceAsciiControls(value, ' ').replace(/[ \t]{2,}/g, ' ').trim().slice(0, maxLength);
};

export const createEntityCorrectionReport = async (
  slug: string,
  input: unknown,
  reporter: EntityCorrectionReporter,
) => {
  if (!reporter.netId) {
    const error: any = new Error('Authenticated reporter is required');
    error.status = 401;
    throw error;
  }

  const normalizedSlug = normalizeResearchDetailSlug(slug);
  if (!normalizedSlug) {
    throw new BadRequestError('Invalid slug');
  }

  const body = normalizeRequestBody(input);
  const category = body.category;
  if (typeof category !== 'string' || !CATEGORIES.has(category)) {
    throw new BadRequestError('Invalid report category');
  }

  const note = sanitizeReportNote(body.note);

  const entity = (await ResearchEntity.findOne({
    slug: normalizedSlug,
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select('_id slug name displayName kind entityType')
    .lean()) as ResearchEntitySnapshot | null;
  if (!entity) {
    throw new NotFoundError(`Research entity not found with slug: ${normalizedSlug}`);
  }

  const existingPending = await EntityCorrectionReport.findOne({
    researchEntityId: entity._id,
    category,
    'reporter.netId': reporter.netId,
    status: 'unreviewed',
  })
    .select('_id')
    .lean();
  if (existingPending) {
    const error: any = new Error('An open report of this type already exists for this page');
    error.status = 409;
    throw error;
  }

  const report = await EntityCorrectionReport.create({
    researchEntityId: entity._id,
    entitySlug: entity.slug || normalizedSlug,
    entitySnapshot: {
      name: entity.displayName || entity.name || '',
      kind: entity.kind || '',
      entityType: entity.entityType || '',
    },
    category,
    note,
    reporter: {
      netId: reporter.netId,
      email: reporter.email || '',
      name: [reporter.fname, reporter.lname].filter(Boolean).join(' '),
      userType: reporter.userType || 'unknown',
      role: deriveReporterRole(reporter.userType),
    },
  });

  console.info(
    `Correction report ${report._id} submitted for ${entity._id} (${category}) by ${reporter.netId}`,
  );

  return report.toObject();
};

export const listEntityCorrectionReports = async (params: {
  status?: string;
  researchEntityId?: string;
  entitySlug?: string;
  reporterNetId?: string;
  page?: string;
  pageSize?: string;
}) => {
  const filter: Record<string, unknown> = {};

  if (params.status && STATUS_FILTERS.has(params.status)) filter.status = params.status;
  if (params.researchEntityId) {
    if (!mongoose.Types.ObjectId.isValid(params.researchEntityId)) {
      throw new ObjectIdError('Did not received expected id type ObjectId');
    }
    filter.researchEntityId = params.researchEntityId;
  }
  if (params.entitySlug) {
    const normalizedSlug = normalizeResearchDetailSlug(params.entitySlug);
    if (!normalizedSlug) throw new BadRequestError('Invalid slug');
    filter.entitySlug = normalizedSlug;
  }
  if (params.reporterNetId) filter['reporter.netId'] = params.reporterNetId;

  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize || '25', 10) || 25));

  const [reports, total] = await Promise.all([
    EntityCorrectionReport.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    EntityCorrectionReport.countDocuments(filter),
  ]);

  return {
    reports,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

export const readEntityCorrectionReport = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }

  const report = await EntityCorrectionReport.findById(id).lean();
  if (!report) {
    throw new NotFoundError(`Correction report not found with ObjectId: ${id}`);
  }

  return report;
};

export const reviewEntityCorrectionReport = async (
  id: string,
  reviewerNetId: string,
  input: unknown,
) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ObjectIdError('Did not received expected id type ObjectId');
  }

  const body = normalizeRequestBody(input);
  const status = body.status;
  if (typeof status !== 'string' || !RESOLUTION_STATUSES.has(status)) {
    throw new BadRequestError('Status must be accepted or dismissed');
  }

  const note = sanitizeReportNote(body.reviewerNote, MAX_REVIEWER_NOTE_LENGTH);
  const reviewedAt = new Date();

  const report = await EntityCorrectionReport.findOneAndUpdate(
    { _id: id, status: 'unreviewed' },
    {
      status,
      reviewerNote: note,
      reviewedBy: reviewerNetId,
      reviewedAt,
      $push: { reviewHistory: { status, note, reviewedBy: reviewerNetId, reviewedAt } },
    },
    { new: true, runValidators: true },
  ).lean();

  if (!report) {
    throw new NotFoundError(`Open correction report not found with ObjectId: ${id}`);
  }

  return report;
};
