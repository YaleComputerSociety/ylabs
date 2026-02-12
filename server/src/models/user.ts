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
    title: {
        type: String,
        required: false,
    },
    unit: {
        type: String,
        required: false,
    },
    upi: {
        type: String,
        required: false,
    },
    physical_location: {
        type: String,
        required: false,
    },
    building_desk: {
        type: String,
        required: false,
    },
    mailing_address: {
        type: String,
        required: false,
    },
    primary_department: {
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
    },
    favFellowships: {
        type: [mongoose.Schema.ObjectId],
        default: [],
    },

    lastLogin: {
        type: Date,
        index: true
    },
    loginCount: {
        type: Number,
        default: 0
    },
    lastActive: {
        type: Date,
        index: true
    }
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model('users', userSchema);