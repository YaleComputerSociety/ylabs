import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import {
  buildWebsiteUrlRefusalReport,
  type WebsiteUrlRefusalRow,
} from './researchHomeWebsiteUrlRefusalAuditCore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main(): Promise<void> {
  await initializeConnections();
  const rows = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    websiteUrl: { $type: 'string', $ne: '' },
  })
    .select({ websiteUrl: 1, entityType: 1, kind: 1, name: 1, displayName: 1 })
    .lean()) as WebsiteUrlRefusalRow[];

  console.log(JSON.stringify(buildWebsiteUrlRefusalReport(rows), null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
