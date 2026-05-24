import axios from 'axios';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { User } from '../models/user';
import {
  buildFacultyPhotoUpdate,
  buildFacultyPhotoCoverageUserQuery,
  extractOfficialProfileMetadata,
  isReplaceableProfileImageUrl,
  officialYaleProfileUrlsForUser,
  parseFacultyPhotoCoverageArgs,
  validateProfileImageForUser,
  type FacultyPhotoUpdatePlan,
  type FacultyPhotoUser,
} from './facultyPhotoCoverageCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const USER_AGENT = 'ylabs-faculty-photo-coverage/1.0 (+https://yalelabs.io)';

async function fetchHtml(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    headers: { 'User-Agent': USER_AGENT },
  });
  return String(response.data || '');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index;
      index++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()),
  );
  return results;
}

async function planPhotoUpdate(user: FacultyPhotoUser): Promise<{
  userId: string;
  netid: string;
  name: string;
  profileUrls: string[];
  planned?: FacultyPhotoUpdatePlan;
  error?: string;
  skipped?: string;
}> {
  const profileUrls = officialYaleProfileUrlsForUser(user);
  const base = {
    userId: String(user._id || ''),
    netid: String(user.netid || ''),
    name: [user.fname, user.lname].map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    profileUrls,
  };

  for (const profileUrl of profileUrls) {
    try {
      const metadata = extractOfficialProfileMetadata(await fetchHtml(profileUrl), profileUrl);
      const imageUrl = validateProfileImageForUser(user, metadata);
      if (metadata.imageUrl && !imageUrl) {
        return {
          ...base,
          skipped: `profile-name-mismatch:${metadata.profileName || 'unknown'}`,
        };
      }
      const planned = imageUrl ? buildFacultyPhotoUpdate(user, profileUrl, imageUrl) : null;
      if (planned) return { ...base, planned };
    } catch (error: any) {
      return { ...base, error: `${profileUrl}: ${error?.message || error}` };
    }
  }

  return base;
}

async function main(): Promise<void> {
  const options = parseFacultyPhotoCoverageArgs(process.argv.slice(2));
  assertScriptApplyAllowed({
    apply: options.apply,
    scriptName: 'faculty:photo-coverage',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const query = buildFacultyPhotoCoverageUserQuery(options);

  const users = (await User.find(query)
    .select('_id netid fname lname imageUrl profileUrls dataSources')
    .sort({ updatedAt: -1 })
    .limit(options.limit)
    .lean()) as FacultyPhotoUser[];

  const withOfficialProfiles = users.filter(
    (user) => officialYaleProfileUrlsForUser(user).length > 0,
  );
  const results = await mapWithConcurrency(
    withOfficialProfiles,
    options.concurrency,
    planPhotoUpdate,
  );
  const planned = results.flatMap((result) => (result.planned ? [result.planned] : []));

  let updated = 0;
  if (options.apply && planned.length > 0) {
    for (const plan of planned) {
      const result = await User.updateOne(
        {
          _id: new mongoose.Types.ObjectId(plan.userId),
          $or: [
            { imageUrl: { $exists: false } },
            { imageUrl: null },
            { imageUrl: '' },
            { imageUrl: /\/styles\/social_media\//i },
          ],
        },
        plan.update,
      );
      updated += result.modifiedCount || 0;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        limit: options.limit,
        concurrency: options.concurrency,
        targetedNetids: options.netids,
        usersScanned: users.length,
        usersWithOfficialProfileUrls: withOfficialProfiles.length,
        plannedUpdates: planned.length,
        updated,
        errors: results.filter((result) => result.error).slice(0, 20),
        skipped: results.filter((result) => result.skipped).slice(0, 20),
        sampleUpdates: planned.slice(0, 20).map((plan) => ({
          netid: plan.netid,
          name: plan.name,
          profileUrl: plan.profileUrl,
          imageUrl: plan.imageUrl,
        })),
        ignoredExistingImages: results
          .filter((result) => !result.planned && result.profileUrls.length > 0)
          .filter((result) => {
            const user = users.find((candidate) => String(candidate._id) === result.userId);
            return user && !isReplaceableProfileImageUrl(user.imageUrl);
          })
          .slice(0, 20)
          .map((result) => ({
            netid: result.netid,
            name: result.name,
          })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
