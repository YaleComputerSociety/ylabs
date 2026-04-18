/**
 * Clean invalid department data from imported faculty profiles.
 * - Removes departments that don't match the predefined department list
 * - Resets profileVerified to false for all users
 *
 * Usage:
 *   MONGODBURL="mongodb://..." npx ts-node server/src/scripts/cleanDepartments.ts
 */

import mongoose from 'mongoose';
import { User } from '../models/user';
import { Department } from '../models/department';

async function cleanDepartments() {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    console.error('Error: MONGODBURL environment variable is required');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUrl);
  console.log('Connected');

  const validDepts = await Department.find({ isActive: true }).select('displayName').lean();
  const validNames = new Set(validDepts.map((d: any) => d.displayName));
  console.log(`Found ${validNames.size} valid departments`);

  const users = await User.find({
    userType: { $in: ['professor', 'faculty'] },
    $or: [
      { primary_department: { $exists: true, $ne: '' } },
      { secondary_departments: { $exists: true, $not: { $size: 0 } } },
    ],
  })
    .select('netid primary_department secondary_departments departments')
    .lean();

  console.log(`Checking ${users.length} faculty profiles...`);

  let cleaned = 0;
  let primaryCleared = 0;
  let secondaryCleared = 0;

  for (const user of users) {
    const u = user as any;
    const updates: Record<string, any> = {};
    let changed = false;

    if (u.primary_department && !validNames.has(u.primary_department)) {
      updates.primary_department = '';
      primaryCleared++;
      changed = true;
    }

    if (u.secondary_departments && u.secondary_departments.length > 0) {
      const validSecondary = u.secondary_departments.filter((d: string) => validNames.has(d));
      if (validSecondary.length !== u.secondary_departments.length) {
        updates.secondary_departments = validSecondary;
        secondaryCleared += u.secondary_departments.length - validSecondary.length;
        changed = true;
      }
    }

    if (changed) {
      const primary =
        updates.primary_department !== undefined
          ? updates.primary_department
          : u.primary_department;
      const secondary =
        updates.secondary_departments !== undefined
          ? updates.secondary_departments
          : u.secondary_departments || [];
      updates.departments = [primary, ...secondary].filter(Boolean);

      await User.updateOne({ _id: u._id }, { $set: updates });
      cleaned++;
    }
  }

  console.log(`\n=== Department Cleanup ===`);
  console.log(`Profiles cleaned: ${cleaned}`);
  console.log(`Invalid primary departments cleared: ${primaryCleared}`);
  console.log(`Invalid secondary departments removed: ${secondaryCleared}`);

  const resetResult = await User.updateMany(
    { profileVerified: true },
    { $set: { profileVerified: false } },
  );
  console.log(`\n=== Profile Verification Reset ===`);
  console.log(`Profiles reset to unverified: ${resetResult.modifiedCount}`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

cleanDepartments().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
