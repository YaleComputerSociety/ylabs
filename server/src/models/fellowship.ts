import mongoose from 'mongoose';

const fellowshipSchema = new mongoose.Schema(
  {
    // Core Information
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
      type: [{
        label: { type: String, default: '' },
        url: { type: String, default: '' },
      }],
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

    // Status
    isAcceptingApplications: {
      type: Boolean,
      default: false,
    },

    // Dates
    applicationOpenDate: {
      type: Date,
      required: false,
    },
    deadline: {
      type: Date,
      required: false,
    },

    // Contact
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

    // Search Filters (arrays for multi-select values)
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

    // Engagement
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
  }
);

// Add text index for search
fellowshipSchema.index({
  title: 'text',
  summary: 'text',
  description: 'text',
  eligibility: 'text',
  competitionType: 'text',
  applicationInformation: 'text',
  additionalInformation: 'text',
});

// Add indexes for filter fields
fellowshipSchema.index({ yearOfStudy: 1 });
fellowshipSchema.index({ termOfAward: 1 });
fellowshipSchema.index({ purpose: 1 });
fellowshipSchema.index({ globalRegions: 1 });
fellowshipSchema.index({ citizenshipStatus: 1 });
fellowshipSchema.index({ archived: 1 });
fellowshipSchema.index({ deadline: 1 });

export const Fellowship = mongoose.model('fellowships', fellowshipSchema);

// Export schema for use with different connections
export { fellowshipSchema };
