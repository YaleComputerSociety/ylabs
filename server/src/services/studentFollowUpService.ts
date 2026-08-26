import mongoose from 'mongoose';
import { StudentOutreach, StudentProfile, StudentTracking } from '../models/index';
import { getResearchGroupDetail } from './researchGroupService';
import { getSavedResearchEntities } from './researchPlanService';
import {
  TERMINAL_OUTREACH_OUTCOMES,
  daysSinceOutreach,
  isStaleUnansweredOutreach,
  MAX_STUDENT_FOLLOW_UPS,
  STUDENT_FOLLOW_UP_TEMPLATE_VERSION,
} from './studentFollowUpEligibility';
import { NotFoundError } from '../utils/errors';

const PUBLIC_LEAD_ROLES: ReadonlySet<string> = new Set(['pi', 'co-pi', 'director', 'co-director']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SavedResearchFollowUp {
  entityName: string;
  daysSinceOutreach: number;
  followUpsSent: number;
  recipientEmail?: string;
  leadName?: string;
}

interface OutreachRollup {
  latestReachedOutAt: Date | null;
  latestOutcome: string | null;
  hasTerminalOutcome: boolean;
  followUpsSent: number;
}

const coerceDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const resolveStudentProfileId = async (
  netid: unknown,
): Promise<mongoose.Types.ObjectId | null> => {
  const normalized = typeof netid === 'string' ? netid.trim().toLowerCase() : '';
  if (!normalized) return null;
  const profile = (await StudentProfile.findOne({ netid: normalized })
    .select('_id')
    .lean()) as { _id?: mongoose.Types.ObjectId } | null;
  return profile?._id ? new mongoose.Types.ObjectId(profile._id) : null;
};

const rollUpOutreachByEntity = (
  rows: Array<Record<string, any>>,
): Map<string, OutreachRollup> => {
  const byEntity = new Map<string, OutreachRollup>();
  for (const row of rows) {
    const entityId = String(row.researchEntityId ?? '').toLowerCase();
    if (!entityId) continue;
    const reachedOutAt = coerceDate(row.reachedOutAt);
    const outcome = typeof row.outcome === 'string' ? row.outcome : null;
    const isFollowUp = row.templateVersion === STUDENT_FOLLOW_UP_TEMPLATE_VERSION;

    const current = byEntity.get(entityId) ?? {
      latestReachedOutAt: null,
      latestOutcome: null,
      hasTerminalOutcome: false,
      followUpsSent: 0,
    };
    if (
      reachedOutAt &&
      (!current.latestReachedOutAt || reachedOutAt > current.latestReachedOutAt)
    ) {
      current.latestReachedOutAt = reachedOutAt;
      current.latestOutcome = outcome;
    }
    if (outcome && TERMINAL_OUTREACH_OUTCOMES.has(outcome)) current.hasTerminalOutcome = true;
    if (isFollowUp) current.followUpsSent += 1;
    byEntity.set(entityId, current);
  }
  return byEntity;
};

const resolveFollowUpRecipient = async (
  slug: string,
): Promise<{ recipientEmail?: string; leadName?: string }> => {
  const detail = await getResearchGroupDetail(slug);
  if (!detail) return {};
  const lead = detail.members.find((member) => {
    if (!PUBLIC_LEAD_ROLES.has(member.role)) return false;
    const email = String(member.user?.email || '').trim();
    return EMAIL_PATTERN.test(email);
  });
  if (!lead) return {};
  const email = String(lead.user?.email || '').trim();
  const name =
    String(lead.user?.displayName || '').trim() ||
    [lead.user?.fname, lead.user?.lname].filter(Boolean).join(' ').trim();
  return { recipientEmail: email, ...(name ? { leadName: name } : {}) };
};

export const getSavedResearchFollowUps = async (
  netid: unknown,
): Promise<Record<string, SavedResearchFollowUp>> => {
  const studentProfileId = await resolveStudentProfileId(netid);
  if (!studentProfileId) return {};

  const saved = await getSavedResearchEntities(netid);
  if (!saved.length) return {};

  const entityIds = saved.map((entity) => new mongoose.Types.ObjectId(entity._id));

  const [outreachRows, trackingRows] = await Promise.all([
    StudentOutreach.find({ studentProfileId, researchEntityId: { $in: entityIds } })
      .select('researchEntityId reachedOutAt outcome templateVersion')
      .lean(),
    StudentTracking.find({ studentProfileId, researchEntityId: { $in: entityIds } })
      .select('researchEntityId followUpNudgeDismissedAt')
      .lean(),
  ]);

  const outreachByEntity = rollUpOutreachByEntity(outreachRows as Array<Record<string, any>>);
  const dismissedByEntity = new Map<string, Date | null>();
  for (const row of trackingRows as Array<Record<string, any>>) {
    const entityId = String(row.researchEntityId ?? '').toLowerCase();
    if (entityId) dismissedByEntity.set(entityId, coerceDate(row.followUpNudgeDismissedAt));
  }

  const now = new Date();
  const result: Record<string, SavedResearchFollowUp> = {};
  for (const entity of saved) {
    const key = entity._id.toLowerCase();
    const rollup = outreachByEntity.get(key);
    if (!rollup) continue;
    const eligible = isStaleUnansweredOutreach(
      {
        latestReachedOutAt: rollup.latestReachedOutAt,
        latestOutcome: rollup.latestOutcome,
        hasTerminalOutcome: rollup.hasTerminalOutcome,
        followUpsSent: rollup.followUpsSent,
        dismissedAt: dismissedByEntity.get(key) ?? null,
      },
      { now },
    );
    if (!eligible) continue;

    const recipient = entity.slug ? await resolveFollowUpRecipient(entity.slug) : {};
    result[entity._id] = {
      entityName: entity.displayName?.trim() || entity.name,
      daysSinceOutreach: daysSinceOutreach(rollup.latestReachedOutAt, now),
      followUpsSent: rollup.followUpsSent,
      ...recipient,
    };
  }

  return result;
};

export const dismissSavedResearchFollowUp = async (
  netid: unknown,
  entityId: string,
): Promise<void> => {
  const studentProfileId = await resolveStudentProfileId(netid);
  if (!studentProfileId || !mongoose.isValidObjectId(entityId)) {
    throw new NotFoundError('Saved research entity not found');
  }
  const researchEntityId = new mongoose.Types.ObjectId(entityId);
  await StudentTracking.updateOne(
    { studentProfileId, researchEntityId },
    {
      $set: { followUpNudgeDismissedAt: new Date() },
      $setOnInsert: { studentProfileId, researchEntityId },
    },
    { upsert: true },
  );
};
