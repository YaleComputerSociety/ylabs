import mongoose from 'mongoose';

const newListingSchema = new mongoose.Schema(
  {
    professorIds: {
        type: [String],
        required: true,
    },
    professorNames: {
        type: [String],
        required: true
    },
    departments: {
        type: [String],
        required: true,
    },
    emails: {
        type: [String],
        required: true,
    },
    websites: {
        type: [String],
        required: false,
    },
    description: {
        type: String,
        required: false,
    },
    keywords: {
        type: [String],
        required: false,
    },
    archived: {
        type: Boolean,
        default: false,
    }
  },
  {
    timestamps: true,
  }
);

export const NewListing = mongoose.model('newListings', newListingSchema);