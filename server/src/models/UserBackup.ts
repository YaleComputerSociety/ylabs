import mongoose from 'mongoose';

const userBackupSchema = new mongoose.Schema(
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
    isProfessor: {
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

export const UserBackup = mongoose.model('user_backups', userBackupSchema);