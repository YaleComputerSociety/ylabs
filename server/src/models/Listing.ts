import mongoose from 'mongoose';

const listingSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    departments: {
      type: [String],
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    website: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
    },
    keywords: {
      type: String,
      required: false,
    },
    last_updated: {
      type: String,
      required: true,
    },
    lname: {
      type: String,
      required: true,
    },
    fname: {
      type: String,
      required: true,
    }
  },
  {
    timestamps: true,
  }
);

export const Listing = mongoose.model('listings', listingSchema);