/**
 * Import enriched faculty data into the User collection.
 *
 * Usage:
 *   MONGODBURL="mongodb://..." npx ts-node server/src/scripts/importFaculty.ts [path-to-json]
 *
 * Default JSON path: ../../yale-faculty-enricher/enriched_faculty.json
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

import { User } from '../models/user';

/** Strip ALL-CAPS code prefix from department names (e.g., "SPHDPT Environmental Health Sciences (EHS)" -> "Environmental Health Sciences (EHS)") */
function cleanPrimaryDepartment(dept: string): string {
  if (!dept) return '';
  let cleaned = dept.trim();

  cleaned = cleaned.replace(/^[A-Z]{3,}\s+/, '');

  cleaned = cleaned.replace(/Divnity/g, 'Divinity');

  return cleaned.trim();
}

/** Known department names for splitting concatenated strings */
const KNOWN_DEPARTMENTS = [
  'Yale School of Medicine',
  'Yale School of Public Health',
  'Yale Medicine',
  'Yale Ventures',
  'Yale University School of Medicine',
  'General Internal Medicine',
  'Internal Medicine',
  'General Pediatrics',
  'Environmental Health Sciences',
  'Medical Oncology',
  'Occupational & Environmental Medicine Program',
  'Emerge Research Program',
  'Division of Neurocognition, Neurocomputation & Neurogenetics',
  'VA National Center for PTSD',
  'History of Medicine',
  'Pediatrics',
  'Psychiatry',
  'Dermatology',
  'Neurology',
  'Neurosurgery',
  'Radiology',
  'Surgery',
  'Anesthesiology',
  'Pathology',
  'Cardiology',
  'Endocrinology',
  'Gastroenterology',
  'Geriatrics',
  'Hematology',
  'Infectious Diseases',
  'Nephrology',
  'Pulmonary',
  'Rheumatology',
  'Urology',
  'Ophthalmology',
  'Orthopaedics',
  'Emergency Medicine',
  'Family Medicine',
  'Obstetrics, Gynecology & Reproductive Sciences',
  'Therapeutic Radiology',
  'Laboratory Medicine',
  'Genetics',
  'Cell Biology',
  'Pharmacology',
  'Physiology',
  'Immunobiology',
  'Microbial Pathogenesis',
  'Comparative Medicine',
  'Biomedical Engineering',
  'Chemical & Environmental Engineering',
  'Computer Science',
  'Electrical Engineering',
  'Mechanical Engineering & Materials Science',
  'Applied Physics',
  'Chemistry',
  'Mathematics',
  'Physics',
  'Statistics & Data Science',
  'Molecular Biophysics & Biochemistry',
  'Molecular, Cellular & Developmental Biology',
  'Ecology & Evolutionary Biology',
];

const SORTED_KNOWN_DEPTS = [...KNOWN_DEPARTMENTS].sort((a, b) => b.length - a.length);

function splitConcatenatedDepartments(dept: string): string[] {
  if (!dept) return [];

  if (dept.includes('#N#')) {
    return dept
      .split('#N#')
      .map((d) => d.trim())
      .filter(Boolean);
  }

  if (dept.length < 50) return [dept];

  let remaining = dept;
  const found: string[] = [];

  for (const knownDept of SORTED_KNOWN_DEPTS) {
    const idx = remaining.indexOf(knownDept);
    if (idx !== -1) {
      if (idx > 2) {
        const before = remaining.substring(0, idx).trim();
        if (before) found.push(before);
      }
      found.push(knownDept);
      remaining = remaining.substring(idx + knownDept.length);
    }
  }

  if (found.length > 0) {
    if (remaining.trim()) {
      found.push(remaining.trim());
    }
    return found;
  }

  return [dept];
}

function cleanSecondaryDepartments(depts: string[]): string[] {
  if (!depts || depts.length === 0) return [];

  const cleaned: string[] = [];

  for (const dept of depts) {
    if (dept === 'Other Departments & Organizations') continue;
    if (!dept || !dept.trim()) continue;

    const split = splitConcatenatedDepartments(dept);
    for (let d of split) {
      d = d.trim();
      if (d === 'New Haven') continue;
      d = d.replace(/^[A-Z]{3,}\s+/, '');
      if (d) cleaned.push(d);
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const d of cleaned) {
    const key = d.toLowerCase();
    const keyNoDept = key.replace(/\s+department$/, '');
    if (!seen.has(key) && !seen.has(keyNoDept)) {
      seen.add(key);
      seen.add(keyNoDept);
      unique.push(d);
    }
  }

  return unique;
}

interface RawFacultyEntry {
  netid: string;
  name: string;
  first_name: string;
  last_name: string;
  primary_department: string;
  secondary_departments: string[];
  title: string;
  bio: string;
  email: string;
  phone: string;
  image_url: string;
  orcid: string | null;
  openalex_id: string | null;
  h_index: number | null;
  profile_urls: Record<string, string>;
  publications: Array<{
    title: string;
    doi: string | null;
    year: number;
    venue: string;
    cited_by_count: number;
    open_access_url: string | null;
    source: string;
  }>;
  research_interests: string[];
  topics: string[];
  catalog_departments: string[];
  data_sources: string[];
}

async function importFaculty() {
  const mongoUrl = process.env.MONGODBURL;
  if (!mongoUrl) {
    console.error('Error: MONGODBURL environment variable is required');
    process.exit(1);
  }

  const jsonPath =
    process.argv[2] ||
    path.resolve(__dirname, '../../../yale-faculty-enricher/enriched_faculty.json');

  if (!fs.existsSync(jsonPath)) {
    console.error(`Error: File not found: ${jsonPath}`);
    process.exit(1);
  }

  console.log(`Reading faculty data from: ${jsonPath}`);
  const raw: RawFacultyEntry[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Loaded ${raw.length} faculty entries`);

  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoUrl);
  console.log('Connected');

  const BATCH_SIZE = 500;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < raw.length; i += BATCH_SIZE) {
    const batch = raw.slice(i, i + BATCH_SIZE);
    const operations: any[] = [];

    for (const entry of batch) {
      if (!entry.netid) {
        skipped++;
        continue;
      }

      const primaryDept = cleanPrimaryDepartment(entry.primary_department || '');
      const secondaryDepts = cleanSecondaryDepartments(entry.secondary_departments || []);

      const cleanedData: Record<string, any> = {
        fname: entry.first_name || entry.name?.split(' ')[0] || 'NA',
        lname: entry.last_name || entry.name?.split(' ').slice(1).join(' ') || 'NA',
        email: entry.email || `${entry.netid}@yale.edu`,
        title: entry.title || '',
        bio: entry.bio || '',
        phone: entry.phone || '',
        primary_department: primaryDept,
        secondary_departments: secondaryDepts,
        departments: [primaryDept, ...secondaryDepts].filter(Boolean),
        image_url: entry.image_url || '',
        orcid: entry.orcid || undefined,
        openalex_id: entry.openalex_id || undefined,
        h_index: entry.h_index || undefined,
        profile_urls: entry.profile_urls || {},
        publications: (entry.publications || []).map((p) => ({
          title: p.title,
          doi: p.doi || undefined,
          year: p.year,
          venue: p.venue || '',
          cited_by_count: p.cited_by_count || 0,
          open_access_url: p.open_access_url || undefined,
          source: p.source || '',
        })),
        research_interests: entry.research_interests || [],
        topics: entry.topics || [],
        data_sources: entry.data_sources || [],
        userType: 'professor',
        userConfirmed: true,
        profileVerified: false,
      };

      for (const key of Object.keys(cleanedData)) {
        if (cleanedData[key] === undefined) {
          delete cleanedData[key];
        }
      }

      operations.push({
        updateOne: {
          filter: { netid: entry.netid },
          update: {
            $set: cleanedData,
            $setOnInsert: {
              netid: entry.netid,
              favListings: [],
              favFellowships: [],
              ownListings: [],
            },
          },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      try {
        const result = await User.bulkWrite(operations, { ordered: false });
        created += result.upsertedCount;
        updated += result.modifiedCount;
      } catch (err: any) {
        if (err.result) {
          created += err.result.nUpserted || 0;
          updated += err.result.nModified || 0;
          errors += err.writeErrors?.length || 0;
        } else {
          console.error(`Batch error at offset ${i}:`, err.message);
          errors += batch.length;
        }
      }
    }

    const processed = Math.min(i + BATCH_SIZE, raw.length);
    if (processed % 2000 === 0 || processed === raw.length) {
      console.log(
        `Progress: ${processed} / ${raw.length} (created: ${created}, updated: ${updated}, skipped: ${skipped}, errors: ${errors})`,
      );
    }
  }

  console.log('\n=== Import Complete ===');
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors:  ${errors}`);
  console.log(`Total:   ${raw.length}`);

  console.log('\n=== Verification ===');
  const sphdptCount = await User.countDocuments({ primary_department: /^SPHDPT/i });
  const otherDeptCount = await User.countDocuments({
    secondary_departments: 'Other Departments & Organizations',
  });
  const divnityCount = await User.countDocuments({
    $or: [{ primary_department: /Divnity/i }, { secondary_departments: /Divnity/i }],
  });

  console.log(`Entries with SPHDPT prefix remaining: ${sphdptCount} (should be 0)`);
  console.log(`Entries with "Other Departments & Organizations": ${otherDeptCount} (should be 0)`);
  console.log(`Entries with "Divnity" typo: ${divnityCount} (should be 0)`);

  await mongoose.disconnect();
  console.log('Done.');
}

importFaculty().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
