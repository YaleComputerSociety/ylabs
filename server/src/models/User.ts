import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    netid: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
    },
    userType: {
        type: String,
        enum: ['undergraduate', 'graduate', 'professor', 'faculty', 'unknown', 'admin'],
        default: 'unknown',
    },
    userConfirmed: {
        type: Boolean,
        default: false,
    },
    fname: {
        type: String,
        required: true,
    },
    lname: {
        type: String,
        required: true,
    },
    website: {
        type: String,
    },
    bio: {
        type: String,
    },
    departments: {
        type: [String],
        default: [],
    },
    college: {
        type: String,
        required: false,
    },
    year: {
        type: String,
        required: false,
    },
    major: {
        type: [String],
        default: [],
    },
    phone: {
        type: String,
        required: false,
    },
    ownListings: {
        type: [mongoose.Schema.ObjectId],
        default: [],
    },
    favListings: {
        type: [mongoose.Schema.ObjectId],
        default: [],
    }
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model('users', userSchema);