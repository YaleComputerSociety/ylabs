import mongoose from 'mongoose';

const arrayNotEmpty = (arr: any[]) => Array.isArray(arr) && arr.length > 0;

const listingSchema = new mongoose.Schema(
  {
    ownerId: {
        type: String,
        required: true
    },
    ownerFirstName: {
        type: String,
        required: true
    },
    ownerLastName: {
        type: String,
        required: true
    },
    ownerEmail: {
        type: String,
        required: true
    },
    professorIds: {
        type: [String],
        default: []
    },
    professorNames: {
        type: [String],
        default: []
    },
    departments: {
        type: [String],
        default: []
    },
    emails: {
        type: [String],
        default: []
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
        required: true,
    },
    keywords: {
        type: [String],
        required: false,
    },
    established: {
        type: Number,
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
    },
    confirmed: {
        type: Boolean,
        default: true,
    },
    applicationsEnabled: {
        type: Boolean,
        default: false,
    },
    applicationQuestions: [{
        question: String,
        required: {
            type: Boolean,
            default: false
        }
    }]
  },
  {
    timestamps: true,
  }
);

export const Listing = mongoose.model('listings', listingSchema);