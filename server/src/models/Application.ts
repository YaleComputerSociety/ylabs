import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    listingId: {
      type: String,
      required: true,
      ref: 'newListings'
    },
    studentId: {
      type: String,
      required: true,
      ref: 'users'
    },
    studentName: {
      type: String,
      required: true,
    },
    studentEmail: {
      type: String,
      required: true,
    },
    studentNetId: {
      type: String,
      required: true,
    },
    resumeUrl: {
      type: String,
      required: false,
    },
    coverLetter: {
      type: String,
      required: false,
    },
    customQuestions: [{
      question: String,
      answer: String
    }],
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    professorNotes: {
      type: String,
      required: false,
    },
    appliedAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
  }
);

export const Application = mongoose.model('applications', applicationSchema);

