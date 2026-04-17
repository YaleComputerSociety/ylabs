/**
 * Mongoose schema and model for fellowship/funding opportunity records.
 */
import mongoose from 'mongoose';

const fellowshipSchema = new mongoose.Schema(
  {
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
fellowshipSchema.index({ archived: 1 });
fellowshipSchema.index({ deadline: 1 });

export const Fellowship = mongoose.model('fellowships', fellowshipSchema);

export { fellowshipSchema };
