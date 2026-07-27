import mongoose from 'mongoose';
import {
  canonicalSchemaVersionField,
  defineCanonicalSchemaVersion,
} from './canonicalSchemaVersion';

export const RESEARCH_PLAN_SCHEMA_VERSION = defineCanonicalSchemaVersion({
  currentVersion: 1,
});

export const researchPlanTargetKinds = ['RESEARCH_ENTITY', 'PROGRAM'] as const;
export const researchPlanStages = [
  'SAVED',
  'EXPLORING',
  'PREPARING',
  'CONTACTED',
  'APPLIED',
  'CLOSED',
] as const;

export type ResearchPlanTargetKind = (typeof researchPlanTargetKinds)[number];
export type ResearchPlanStage = (typeof researchPlanStages)[number];

export const MAX_RESEARCH_PLAN_NOTES_LENGTH = 8_000;
export const MAX_RESEARCH_PLAN_CHECKLIST_ITEMS = 50;
export const MAX_RESEARCH_PLAN_DEADLINES = 20;
export const MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH = 240;

const boundedArray = (maximum: number, label: string) => ({
  validator: (values: unknown[]) => Array.isArray(values) && values.length <= maximum,
  message: `${label} must contain at most ${maximum} items.`,
});

const researchPlanTargetSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [...researchPlanTargetKinds],
      required: true,
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
  },
  { _id: false },
);

const researchPlanChecklistItemSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH,
    },
    completed: {
      type: Boolean,
      default: false,
      validate: {
        validator(this: { completedAt?: Date }, completed: boolean) {
          return completed ? Boolean(this.completedAt) : !this.completedAt;
        },
        message:
          'completed checklist items require completedAt, and incomplete items must omit it.',
      },
    },
    completedAt: {
      type: Date,
      required(this: { completed?: boolean }) {
        return this.completed === true;
      },
    },
  },
  { _id: true },
);

const researchPlanDeadlineSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_RESEARCH_PLAN_ITEM_TEXT_LENGTH,
    },
    dueAt: {
      type: Date,
      required: true,
    },
    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SourceDocument',
      required: false,
    },
  },
  { _id: true },
);

export const researchPlanSchema = new mongoose.Schema<Record<string, unknown>>(
  {
    schemaVersion: canonicalSchemaVersionField(RESEARCH_PLAN_SCHEMA_VERSION),
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    target: {
      type: researchPlanTargetSchema,
      required: true,
    },
    stage: {
      type: String,
      enum: [...researchPlanStages],
      default: 'SAVED',
      required: true,
    },
    privateNotes: {
      type: String,
      default: '',
      maxlength: MAX_RESEARCH_PLAN_NOTES_LENGTH,
      select: false,
    },
    checklist: {
      type: [researchPlanChecklistItemSchema],
      default: [],
      select: false,
      validate: boundedArray(MAX_RESEARCH_PLAN_CHECKLIST_ITEMS, 'checklist'),
    },
    deadlines: {
      type: [researchPlanDeadlineSchema],
      default: [],
      select: false,
      validate: boundedArray(MAX_RESEARCH_PLAN_DEADLINES, 'deadlines'),
    },
    exportPreferences: {
      includePrivateNotes: {
        type: Boolean,
        default: false,
      },
      includeChecklist: {
        type: Boolean,
        default: false,
      },
      includeDeadlines: {
        type: Boolean,
        default: false,
      },
    },
    archived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'research_plans',
  },
);

researchPlanSchema.index({ accountId: 1, 'target.kind': 1, 'target.id': 1 }, { unique: true });
researchPlanSchema.index({ accountId: 1, archived: 1, updatedAt: -1 });
researchPlanSchema.index({ 'target.kind': 1, 'target.id': 1, archived: 1 });

export const ResearchPlan =
  mongoose.models.ResearchPlan ||
  mongoose.model('ResearchPlan', researchPlanSchema, 'research_plans');
