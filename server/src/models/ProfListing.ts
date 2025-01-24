import mongoose from 'mongoose';

const profListingSchema = new mongoose.Schema(
    {
    _id: {
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
    },
    id: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    upi: {
      type: String,
      required: false,
    },
    unit: {
      type: String,
      required: false,
    },
    department: {
      type: String,
      required: false,
    },
    location: {
      type: String,
      required: true,
    },
    building: {
      type: String,
      required: true,
    },
    mailing: {
      type: String,
      required: true,
    }
  },
  {
    timestamps: true,
  }
);

export const ProfListing = mongoose.model('profListings', profListingSchema);
export default ProfListing;