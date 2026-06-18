/**
 * Mongoose schema and model for fellowship/funding opportunity records.
 */
import mongoose from 'mongoose';
import { studentVisibilityFields } from './studentVisibility';

export const programCategories = [
  'FELLOWSHIP',
  'CENTER_INTERNSHIP',
  'RECURRING_PROGRAM',
  'SUMMER_RESEARCH_PROGRAM',
] as const;

export type ProgramCategory = (typeof programCategories)[number];

export const programKinds = [
  'STRUCTURED_PROGRAM',
  'CENTER_INTERNSHIP',
  'RA_PROGRAM',
  'MENTOR_MATCHING',
  'FELLOWSHIP_FUNDING',
  'TRAVEL_RESEARCH_GRANT',
  'SENIOR_THESIS_FUNDING',
  'OTHER',
] as const;

export type ProgramKind = (typeof programKinds)[number];

export const programEntryModes = [
  'APPLY_TO_PROGRAM',
  'APPLY_TO_PROJECT',
  'SECURE_MENTOR_THEN_APPLY',
  'DIRECT_FACULTY_MATCHING',
  'TRACK_NEXT_CYCLE',
  'UNKNOWN',
] as const;

export type ProgramEntryMode = (typeof programEntryModes)[number];

const fellowshipSchema = new mongoose.Schema(
  {
    programCategory: {
      type: String,
      enum: programCategories,
      default: 'FELLOWSHIP',
    },
    programKind: {
      type: String,
      enum: programKinds,
      default: 'OTHER',
    },
    entryMode: {
      type: String,
      enum: programEntryModes,
      default: 'UNKNOWN',
    },
    studentFacingCategory: {
      type: String,
      default: '',
    },
    requiresMentorBeforeApply: {
      type: Boolean,
      default: false,
    },
    mentorMatching: {
      type: Boolean,
      default: false,
    },
    undergraduateOnly: {
      type: Boolean,
      required: false,
    },
    yaleCollegeOnly: {
      type: Boolean,
      required: false,
    },
    compensationSummary: {
      type: String,
      default: '',
    },
    hoursPerWeek: {
      type: Number,
      required: false,
    },
    programDates: {
      type: String,
      default: '',
    },
    bestNextStep: {
      type: String,
      default: '',
    },
    prepSteps: {
      type: [String],
      default: [],
    },
    title: {
      type: String,
      required: true,
    },
    competitionType: {
      type: String,
      default: '',
    },
    summary: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      default: '',
    },
    applicationInformation: {
      type: String,
      default: '',
    },
    eligibility: {
      type: String,
      default: '',
    },
    restrictionsToUseOfAward: {
      type: String,
      default: '',
    },
    additionalInformation: {
      type: String,
      default: '',
    },
    links: {
      type: [
        {
          label: { type: String, default: '' },
          url: { type: String, default: '' },
        },
      ],
      default: [],
    },
    applicationLink: {
      type: String,
      default: '',
    },
    awardAmount: {
      type: String,
      default: '',
    },
    isAcceptingApplications: {
      type: Boolean,
      default: false,
    },
    applicationOpenDate: {
      type: Date,
      required: false,
    },
    deadline: {
      type: Date,
      required: false,
    },
    contactName: {
      type: String,
      default: '',
    },
    contactEmail: {
      type: String,
      default: '',
    },
    contactPhone: {
      type: String,
      default: '',
    },
    contactOffice: {
      type: String,
      default: '',
    },
    yearOfStudy: {
      type: [String],
      default: [],
    },
    termOfAward: {
      type: [String],
      default: [],
    },
    purpose: {
      type: [String],
      default: [],
    },
    globalRegions: {
      type: [String],
      default: [],
    },
    citizenshipStatus: {
      type: [String],
      default: [],
    },
    sourceName: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    sourceKey: {
      type: String,
      required: false,
    },
    sourceFingerprint: {
      type: String,
      default: '',
    },
    sourceLastVerifiedAt: {
      type: Date,
      required: false,
    },
    sourceLastChangedAt: {
      type: Date,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    audited: {
      type: Boolean,
      default: false,
    },
    views: {
      type: Number,
      default: 0,
    },
    favorites: {
      type: Number,
      default: 0,
    },
    ...studentVisibilityFields,
  },
  {
    timestamps: true,
  },
);

fellowshipSchema.index({
  title: 'text',
  summary: 'text',
  description: 'text',
  eligibility: 'text',
  competitionType: 'text',
  applicationInformation: 'text',
  additionalInformation: 'text',
});

fellowshipSchema.index({ yearOfStudy: 1 });
fellowshipSchema.index({ termOfAward: 1 });
fellowshipSchema.index({ purpose: 1 });
fellowshipSchema.index({ globalRegions: 1 });
fellowshipSchema.index({ citizenshipStatus: 1 });
fellowshipSchema.index({ programCategory: 1 });
fellowshipSchema.index({ programKind: 1 });
fellowshipSchema.index({ entryMode: 1 });
fellowshipSchema.index({ requiresMentorBeforeApply: 1 });
fellowshipSchema.index({ mentorMatching: 1 });
fellowshipSchema.index({ archived: 1 });
fellowshipSchema.index({ studentVisibilityTier: 1, archived: 1 });
fellowshipSchema.index({ studentVisibilityComputedAt: -1 });
fellowshipSchema.index({ deadline: 1 });
fellowshipSchema.index(
  { sourceKey: 1 },
  { unique: true, sparse: true, partialFilterExpression: { sourceKey: { $type: 'string' } } },
);
fellowshipSchema.index({ sourceName: 1, sourceLastVerifiedAt: -1 });

export const Fellowship = mongoose.model('Fellowship', fellowshipSchema);

export { fellowshipSchema };
