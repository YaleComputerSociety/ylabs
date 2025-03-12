import mongoose from 'mongoose';

const arrayNotEmpty = (arr: any[]) => Array.isArray(arr) && arr.length > 0;

const newListingSchema = new mongoose.Schema(
  {
    professorIds: {
        type: [String],
        validate: [arrayNotEmpty, 'professorIds cannot be empty']
    },
    professorNames: {
        type: [String],
        required: true,
        validate: [arrayNotEmpty, 'professorNames cannot be empty']
    },
    departments: {
        type: [String],
        required: true,
        validate: [arrayNotEmpty, 'departments cannot be empty']
    },
    emails: {
        type: [String],
        required: true,
        validate: [arrayNotEmpty, 'emails cannot be empty']
    },
    title: {
        type: String,
        required: true,
    },
    hiringStatus: {
        type: Number,
        default: 0,
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
    established: {
        type: Date,
        required: false,
    },
    views: {
        type: Number,
        default: 0,
    },
    favorites: {
        type: Number,
        default: 0,
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