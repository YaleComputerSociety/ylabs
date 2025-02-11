import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    netid: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    isProfessor: {
        type: Boolean,
        required: true,
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
        required: false,
    },
    bio: {
        type: String,
        required: false,
    },
    departments: {
        type: [String],
        required: false,
    },
    ownListings: {
        type: [mongoose.Schema.ObjectId],
        required: true,
    },
    favListings: {
        type: [mongoose.Schema.ObjectId],
        required: true,
    }
  }
);

export const User = mongoose.model('users', userSchema);
export default User;