/**
 * MongoDB connection management and model initialization.
 */
import mongoose from 'mongoose';

export async function initializeConnections(): Promise<void> {
  const url = process.env.MONGODBURL;
  if (!url) {
    throw new Error('MONGODBURL is required');
  }
  await mongoose.connect(url);
  console.log(`Connected to database 🚀`);
}
