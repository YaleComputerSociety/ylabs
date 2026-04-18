import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Listing } from '../server/src/models/listing';
import { Department } from '../server/src/models/department';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

// Special marker for departments that should be removed entirely
const REMOVE_DEPARTMENT = '__REMOVE__';

// =============================================================================
// MANUAL MAPPINGS - All old department values must be explicitly mapped here
// Format: "old value" -> "new displayName" | ["multiple", "departments"] | REMOVE_DEPARTMENT
// =============================================================================
const MANUAL_MAPPINGS: Record<string, string | string[]> = {
  // ===== HUMANITIES =====
  "African Studies": "AFST - African Studies",
  "American Studies": "AMST - American Studies",
  "Architecture": "ARCH - Architecture",
  "Art": "ART - Art",
  "Art History": "HSAR - History of Art",
  "Black Studies": "AFAM - Black Studies",
  "African American Studies": "AFAM - Black Studies",
  "Classics": "CLSS - Classics",
  "Classical Studies": "CLSS - Classics",
  "Comparative Literature": "CPLT - Comparative Literature",
  "Early Modern Studies": "EMST - Early Modern Studies",
  "East Asian Languages & Literatures": "EALL - East Asian Languages & Literatures",
  "East Asian Languages and Literatures": "EALL - East Asian Languages & Literatures",
  "English": "ENGL - English Language & Literature",
  "English Language & Literature": "ENGL - English Language & Literature",
  "English Language and Literature": "ENGL - English Language & Literature",
  "Ethnicity, Race, & Migration": "ER&M - Ethnicity, Race, & Migration",
  "Ethnicity, Race and Migration": "ER&M - Ethnicity, Race, & Migration",
  "Ethnicity, Race & Migration": "ER&M - Ethnicity, Race, & Migration",
  "Film & Media Studies": "FILM - Film & Media Studies",
  "Film and Media Studies": "FILM - Film & Media Studies",
  "Film Studies": "FILM - Film & Media Studies",
  "French": "FREN - French",
  "German": "GMAN - German",
  "German Studies": "GMAN - German",
  "Hellenic Studies": "HELN - Hellenic Studies",
  "Greek Studies": "HELN - Hellenic Studies",
  "History": "HIST - History",
  "History of Art": "HSAR - History of Art",
  "History of Science & Medicine": "HSHM - History of Science & Medicine",
  "History of Science and Medicine": "HSHM - History of Science & Medicine",
  "Humanities": "HUMS - Humanities",
  "Italian Studies": "ITAL - Italian Studies",
  "Italian": "ITAL - Italian Studies",
  "Jewish Studies": "JDST - Jewish Studies",
  "Judaic Studies": "JDST - Jewish Studies",
  "Medieval Studies": "MDVL - Medieval Studies",
  "Music": "MUSI - Music",
  "Near Eastern Languages & Civilizations": "NELC - Near Eastern Languages & Civilizations",
  "Near Eastern Languages and Civilizations": "NELC - Near Eastern Languages & Civilizations",
  "Near Eastern Langauges and Civilizations": "NELC - Near Eastern Languages & Civilizations", // typo variant
  "NELC": "NELC - Near Eastern Languages & Civilizations",
  "Philosophy": "PHIL - Philosophy",
  "Religious Studies": "RLST - Religious Studies",
  "Religion": "RLST - Religious Studies",
  "Slavic Languages & Literatures": "SLAV - Slavic Languages & Literatures",
  "Slavic Languages and Literatures": "SLAV - Slavic Languages & Literatures",
  "Spanish & Portuguese": "SPAN/PORT - Spanish & Portuguese",
  "Spanish and Portuguese": "SPAN/PORT - Spanish & Portuguese",
  "Spanish": "SPAN/PORT - Spanish & Portuguese",
  "Theater, Dance, & Performance Studies": "TDPS - Theater, Dance, & Performance Studies",
  "Theater, Dance, and Performance Studies": "TDPS - Theater, Dance, & Performance Studies",
  "Theater Studies": "TDPS - Theater, Dance, & Performance Studies",
  "Theatre Studies": "TDPS - Theater, Dance, & Performance Studies",
  "Theater": "TDPS - Theater, Dance, & Performance Studies",
  "Women's, Gender, & Sexuality Studies": "WGSS - Women's, Gender, & Sexuality Studies",
  "Women's, Gender, and Sexuality Studies": "WGSS - Women's, Gender, & Sexuality Studies",
  "Women\u2019s, Gender, and Sexuality Studies": "WGSS - Women's, Gender, & Sexuality Studies", // curly apostrophe variant (U+2019)
  "Women's Studies": "WGSS - Women's, Gender, & Sexuality Studies",
  "Gender Studies": "WGSS - Women's, Gender, & Sexuality Studies",

  // ===== SOCIAL SCIENCES =====
  "Anthropology": "ANTH - Anthropology",
  "Archaeological Studies": "ARCG - Archaeological Studies",
  "Archaeology": "ARCG - Archaeological Studies",
  "East Asian Studies": "EAST - East Asian Studies",
  "Economics": "ECON - Economics",
  "European & Russian Studies": "RSEE - European & Russian Studies",
  "European and Russian Studies": "RSEE - European & Russian Studies",
  "Global Affairs": "GLBL - Global Affairs",
  "International Affairs": "GLBL - Global Affairs",
  "Latin American Studies": "LAST - Latin American Studies",
  "Law": "LAW - Law",
  "Linguistics": "LING - Linguistics",
  "Management": "MGT - Management",
  "Modern Middle East Studies": "MMES - Modern Middle East Studies",
  "Middle East Studies": "MMES - Modern Middle East Studies",
  "Political Science": "PLSC - Political Science",
  "Psychology": "PSYC - Psychology",
  "Sociology": "SOCY - Sociology",
  "South Asian Studies": "SAST - South Asian Studies",
  "Statistics & Data Science": "S&DS - Statistics & Data Science",
  "Statistics and Data Science": "S&DS - Statistics & Data Science",
  "Statistics": "S&DS - Statistics & Data Science",
  "Data Science": "S&DS - Statistics & Data Science",
  "Biostatistics": "BIS - Biostatistics",
  "Cognitive Science": "CGSC - Cognitive Science",

  // ===== PHYSICAL SCIENCES =====
  "Applied Mathematics": "AMTH - Applied Mathematics",
  "Applied Math": "AMTH - Applied Mathematics",
  "Applied Physics": "APHY - Applied Physics",
  "Astronomy": "ASTR - Astronomy",
  "Chemistry": "CHEM - Chemistry",
  "Earth & Planetary Sciences": "EPS - Earth & Planetary Sciences",
  "Earth and Planetary Sciences": "EPS - Earth & Planetary Sciences",
  "EPS": "EPS - Earth & Planetary Sciences",
  "Geology": "EPS - Earth & Planetary Sciences",
  "Geophysics": "EPS - Earth & Planetary Sciences",
  "Geology and Geophysics": "EPS - Earth & Planetary Sciences",
  "Mathematics": "MATH - Mathematics",
  "Math": "MATH - Mathematics",
  "Physics": "PHYS - Physics",

  // ===== BIOLOGICAL SCIENCES =====
  "Biological & Biomedical Sciences": "BIOL - Biological & Biomedical Sciences",
  "Biological and Biomedical Sciences": "BIOL - Biological & Biomedical Sciences",
  "Biology": "BIOL - Biological & Biomedical Sciences",
  "Cell Biology": "CBIO - Cell Biology",
  "Cellular & Molecular Physiology": "C&MP - Cellular & Molecular Physiology",
  "Cellular and Molecular Physiology": "C&MP - Cellular & Molecular Physiology",
  "Computational Biology & Biomedical Informatics": "CB&B - Computational Biology & Biomedical Informatics",
  "Computational Biology and Biomedical Informatics": "CB&B - Computational Biology & Biomedical Informatics",
  "Computational Biology": "CB&B - Computational Biology & Biomedical Informatics",
  "Computational Biology and Bioinformatics": "CB&B - Computational Biology & Biomedical Informatics",
  "CB&B": "CB&B - Computational Biology & Biomedical Informatics",
  "Ecology & Evolutionary Biology": "EEB - Ecology & Evolutionary Biology",
  "Ecology and Evolutionary Biology": "EEB - Ecology & Evolutionary Biology",
  "EEB": "EEB - Ecology & Evolutionary Biology",
  "Ecology": "EEB - Ecology & Evolutionary Biology",
  "Evolutionary Biology": "EEB - Ecology & Evolutionary Biology",
  "Environment": "EVST - Environment",
  "Environmental Studies": "EVST - Environment",
  "Forestry": "F&ES - Forestry",
  "Forestry & Environmental Studies": ["F&ES - Forestry", "EVST - Environment"],
  "Forestry and Environmental Studies": ["F&ES - Forestry", "EVST - Environment"],
  "School of Forestry & Environmental Studies": ["F&ES - Forestry", "EVST - Environment"],
  "F&ES": ["F&ES - Forestry", "EVST - Environment"],
  "Yale School of the Environment": ["F&ES - Forestry", "EVST - Environment"],
  "Microbiology": "MBIO - Microbiology",
  "Microbial Pathogenesis": "MBP - Microbial Pathogenesis",
  "MBP": "MBP - Microbial Pathogenesis",
  "Molecular Biophysics & Biochemistry": "MB&B - Molecular Biophysics & Biochemistry",
  "Molecular Biophysics and Biochemistry": "MB&B - Molecular Biophysics & Biochemistry",
  "MB&B": "MB&B - Molecular Biophysics & Biochemistry",
  "Biochemistry": "MB&B - Molecular Biophysics & Biochemistry",
  "Molecular, Cellular & Developmental Biology": "MCDB - Molecular, Cellular & Developmental Biology",
  "Molecular, Cellular and Developmental Biology": "MCDB - Molecular, Cellular & Developmental Biology",
  "MCDB": "MCDB - Molecular, Cellular & Developmental Biology",
  "Neuroscience": "NSCI - Neuroscience",

  // ===== ENGINEERING =====
  "Biomedical Engineering": "BENG - Biomedical Engineering",
  "Biomedical Informatics and Data Science": "BIDS - Biomedical Informatics and Data Science",
  "Biomedical Informatics": "BIDS - Biomedical Informatics and Data Science",
  "Chemical & Environmental Engineering": "CEE - Chemical & Environmental Engineering",
  "Chemical and Environmental Engineering": "CEE - Chemical & Environmental Engineering",
  "Chemical Engineering": "CEE - Chemical & Environmental Engineering",
  "Computer Science": "CPSC - Computer Science",
  "CS": "CPSC - Computer Science",
  "Electrical & Computer Engineering": "ECE - Electrical & Computer Engineering",
  "Electrical and Computer Engineering": "ECE - Electrical & Computer Engineering",
  "Electrical Engineering": "ECE - Electrical & Computer Engineering",
  "EE": "ECE - Electrical & Computer Engineering",
  "Engineering & Applied Science": "ENAS - Engineering & Applied Science",
  "Engineering and Applied Science": "ENAS - Engineering & Applied Science",
  "Engineering": "ENAS - Engineering & Applied Science",
  "Mechanical Engineering & Materials Science": "MENG - Mechanical Engineering & Materials Science",
  "Mechanical Engineering and Materials Science": "MENG - Mechanical Engineering & Materials Science",
  "Mechanical Engineering": "MENG - Mechanical Engineering & Materials Science",
  "Materials Science": "MENG - Mechanical Engineering & Materials Science",

  // ===== HEALTH & MEDICINE =====
  "Anesthesiology": "ANES - Anesthesiology",
  "Child Study Center": "CHLD - Child Study Center",
  "Chronic Disease Epidemiology": "CDE - Chronic Disease Epidemiology",
  "Comparative Medicine": "CPMD - Comparative Medicine",
  "Dermatology": "DERM - Dermatology",
  "Emergency Medicine": "EM - Emergency Medicine",
  "Environmental Health Sciences": "EHS - Environmental Health Sciences",
  "Epidemiology of Microbial Diseases": "EMD - Epidemiology of Microbial Diseases",
  "Experimental Pathology": "EXPA - Experimental Pathology",
  "Genetics": "GENE - Genetics",
  "Health Care Management": "HCM - Health Care Management",
  "Health Policy & Management": "HPM - Health Policy & Management",
  "Health Policy and Management": "HPM - Health Policy & Management",
  "Immunobiology": "IBIO - Immunobiology",
  "Immunology": "IBIO - Immunobiology",
  "Internal Medicine": "INMD - Internal Medicine",
  "Investigative Medicine": "IMED - Investigative Medicine",
  "Medicine": "YSM - Yale School of Medicine",
  "Medical School": "YSM - Yale School of Medicine",
  "Yale School of Medicine": "YSM - Yale School of Medicine",
  "YSM": "YSM - Yale School of Medicine",
  "Neurology": "NRLG - Neurology",
  "Neurosurgery": "NRSG - Neurosurgery",
  "NRSG": "NRSG - Neurosurgery",
  "Nursing": "NURS - Nursing",
  "School of Nursing": "NURS - Nursing",
  "Obstetrics, Gynecology & Reproductive Sciences": "OBGN - Obstetrics, Gynecology & Reproductive Sciences",
  "Obstetrics, Gynecology and Reproductive Sciences": "OBGN - Obstetrics, Gynecology & Reproductive Sciences",
  "OB/GYN": "OBGN - Obstetrics, Gynecology & Reproductive Sciences",
  "Ophthalmology & Visual Science": "OPVS - Ophthalmology & Visual Science",
  "Ophthalmology and Visual Science": "OPVS - Ophthalmology & Visual Science",
  "Ophthalmology": "OPVS - Ophthalmology & Visual Science",
  "Orthopaedics & Rehabilitation": "OPRH - Orthopaedics & Rehabilitation",
  "Orthopaedics and Rehabilitation": "OPRH - Orthopaedics & Rehabilitation",
  "Orthopedics": "OPRH - Orthopaedics & Rehabilitation",
  "Pathology": "PATH - Pathology",
  "Pediatrics": "PEDT - Pediatrics",
  "Pharmacology": "PHAR - Pharmacology",
  "Psychiatry": "PSYT - Psychiatry",
  "Public Health": "EPH - Public Health",
  "School of Public Health": "EPH - Public Health",
  "Radiology & Biomedical Imaging": "R&BI - Radiology & Biomedical Imaging",
  "Radiology and Biomedical Imaging": "R&BI - Radiology & Biomedical Imaging",
  "Radiology": "R&BI - Radiology & Biomedical Imaging",
  "Surgery": "SURG - Surgery",
  "Urology": "URLG - Urology",
  "URLG": "URLG - Urology",
  "Therapeutic Radiology/Radiation Oncology": "TRAD - Therapeutic Radiology/Radiation Oncology",
  "Therapeutic Radiology": "TRAD - Therapeutic Radiology/Radiation Oncology",
  "Radiation Oncology": "TRAD - Therapeutic Radiology/Radiation Oncology",

  // ===== DEPARTMENTS TO REMOVE =====
  "Laboratory Medicine": REMOVE_DEPARTMENT,
};

interface DepartmentDoc {
  abbreviation: string;
  name: string;
  displayName: string;
}

interface ChangeLog {
  listingId: string;
  listingTitle: string;
  oldDepartment: string;
  newDepartment: string;
  matchType: 'manual' | 'exact-displayName' | 'removed';
}

interface UnmappedLog {
  department: string;
  listingIds: string[];
  listingTitles: string[];
}

async function migrateDepartments(dryRun: boolean = true) {
  const sourceUrl = process.env.MONGODBURL;
  const targetUrl = process.env.MONGODBURL_MIGRATION;

  if (!sourceUrl) {
    console.error('ERROR: MONGODBURL (Production) not set in environment');
    process.exit(1);
  }

  if (!targetUrl) {
    console.error('ERROR: MONGODBURL_MIGRATION (ProductionMigration) not set in environment');
    process.exit(1);
  }

  console.log('\n=== Department Migration (Manual Mappings Only) ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be applied)'}\n`);

  const changeLogs: ChangeLog[] = [];
  const unmappedDepts: Map<string, UnmappedLog> = new Map();

  try {
    // Connect to Production to get valid departments (for validation)
    console.log('Connecting to Production database to fetch departments...');
    const sourceConnection = await mongoose.createConnection(sourceUrl).asPromise();
    const SourceDepartment = sourceConnection.model('departments', Department.schema);

    const departments = await SourceDepartment.find({}).lean() as unknown as DepartmentDoc[];
    console.log(`Loaded ${departments.length} valid departments from Production`);

    // Create a set of valid displayNames for validation
    const validDisplayNames = new Set(departments.map(d => d.displayName));
    console.log(`Valid department displayNames: ${validDisplayNames.size}\n`);

    // Validate all manual mappings
    console.log('Validating manual mappings...');
    let invalidMappings = 0;
    for (const [oldDept, mapping] of Object.entries(MANUAL_MAPPINGS)) {
      if (mapping === REMOVE_DEPARTMENT) continue;

      const targets = Array.isArray(mapping) ? mapping : [mapping];
      for (const target of targets) {
        if (!validDisplayNames.has(target)) {
          console.error(`  ERROR: "${oldDept}" maps to invalid department "${target}"`);
          invalidMappings++;
        }
      }
    }
    if (invalidMappings > 0) {
      console.error(`\nFound ${invalidMappings} invalid mappings. Please fix them before running migration.`);
      await sourceConnection.close();
      process.exit(1);
    }
    console.log('All manual mappings are valid!\n');

    // Connect to ProductionMigration to update listings
    console.log('Connecting to ProductionMigration database...');
    const targetConnection = await mongoose.createConnection(targetUrl).asPromise();
    const TargetListing = targetConnection.model('listings', Listing.schema);

    // Fetch all listings
    const listings = await TargetListing.find({}).lean();
    console.log(`Found ${listings.length} listings in ProductionMigration\n`);

    // Collect all unique department values
    const allDepts = new Set<string>();
    for (const listing of listings) {
      if (listing.departments && Array.isArray(listing.departments)) {
        for (const dept of listing.departments) {
          if (dept && typeof dept === 'string') {
            allDepts.add(dept);
          }
        }
      }
    }
    console.log(`Found ${allDepts.size} unique department values in listings\n`);

    // Process each listing
    console.log('Processing listings...\n');
    let listingsToUpdate = 0;

    for (const listing of listings) {
      if (!listing.departments || !Array.isArray(listing.departments) || listing.departments.length === 0) {
        continue;
      }

      const newDepartments: string[] = [];
      let hasChanges = false;

      for (const oldDept of listing.departments) {
        if (!oldDept || typeof oldDept !== 'string') {
          continue;
        }

        // Check manual mapping first
        const mapping = MANUAL_MAPPINGS[oldDept];

        if (mapping === REMOVE_DEPARTMENT) {
          // Remove this department
          hasChanges = true;
          changeLogs.push({
            listingId: listing._id.toString(),
            listingTitle: listing.title,
            oldDepartment: oldDept,
            newDepartment: '(REMOVED)',
            matchType: 'removed'
          });
          continue;
        }

        if (mapping) {
          // Use manual mapping (can be single or multiple)
          const targets = Array.isArray(mapping) ? mapping : [mapping];
          for (const target of targets) {
            if (!newDepartments.includes(target)) {
              newDepartments.push(target);
            }
            if (target !== oldDept || targets.length > 1) {
              hasChanges = true;
              changeLogs.push({
                listingId: listing._id.toString(),
                listingTitle: listing.title,
                oldDepartment: oldDept,
                newDepartment: target,
                matchType: 'manual'
              });
            }
          }
          continue;
        }

        // Check if already in correct displayName format
        if (validDisplayNames.has(oldDept)) {
          newDepartments.push(oldDept);
          continue;
        }

        // Unmapped department
        newDepartments.push(oldDept); // Keep old value

        if (!unmappedDepts.has(oldDept)) {
          unmappedDepts.set(oldDept, {
            department: oldDept,
            listingIds: [],
            listingTitles: []
          });
        }
        const unmapped = unmappedDepts.get(oldDept)!;
        unmapped.listingIds.push(listing._id.toString());
        unmapped.listingTitles.push(listing.title);
      }

      // Update the listing if there are changes
      if (hasChanges && !dryRun) {
        await TargetListing.updateOne(
          { _id: listing._id },
          { $set: { departments: newDepartments } }
        );
        listingsToUpdate++;
      } else if (hasChanges) {
        listingsToUpdate++;
      }
    }

    // Print results
    console.log('\n' + '='.repeat(80));
    console.log('CHANGES' + (dryRun ? ' (would be made)' : ' (applied)'));
    console.log('='.repeat(80) + '\n');

    if (changeLogs.length === 0) {
      console.log('No changes needed - all departments already match.\n');
    } else {
      // Group by old department for cleaner output
      const byOldDept = new Map<string, ChangeLog[]>();
      for (const log of changeLogs) {
        const key = `${log.oldDepartment} -> ${log.newDepartment}`;
        if (!byOldDept.has(key)) {
          byOldDept.set(key, []);
        }
        byOldDept.get(key)!.push(log);
      }

      for (const [change, logs] of byOldDept) {
        console.log(`  ${change} (${logs.length} listings)`);
      }

      console.log(`\n\nTotal changes: ${changeLogs.length}`);
      console.log(`Listings affected: ${listingsToUpdate}`);
    }

    // Print unmapped departments
    console.log('\n' + '='.repeat(80));
    console.log('UNMAPPED DEPARTMENTS (need manual mapping)');
    console.log('='.repeat(80) + '\n');

    if (unmappedDepts.size === 0) {
      console.log('All departments were successfully mapped!\n');
    } else {
      console.log(`Found ${unmappedDepts.size} unmapped department values:\n`);

      for (const [dept, info] of unmappedDepts) {
        console.log(`  "${dept}"`);
        console.log(`    Used in ${info.listingIds.length} listing(s):`);
        for (let i = 0; i < Math.min(3, info.listingTitles.length); i++) {
          console.log(`      - ${info.listingTitles[i]}`);
        }
        if (info.listingTitles.length > 3) {
          console.log(`      ... and ${info.listingTitles.length - 3} more`);
        }
        console.log();
      }

      console.log('\nTo fix, add entries to MANUAL_MAPPINGS in MigrateDepartments.ts:');
      console.log('```');
      for (const [dept] of unmappedDepts) {
        console.log(`  "${dept}": "ABBR - Department Name",`);
      }
      console.log('```\n');
    }

    // Close connections
    await sourceConnection.close();
    await targetConnection.close();

    if (dryRun && changeLogs.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('To apply these changes, run with --live flag:');
      console.log('  npm run migrate:departments:live');
      console.log('='.repeat(80) + '\n');
    }

  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);
const dryRun = !args.includes('--live');

migrateDepartments(dryRun).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
