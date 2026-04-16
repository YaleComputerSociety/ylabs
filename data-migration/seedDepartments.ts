import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from server/.env
dotenv.config({ path: path.resolve(__dirname, '../server/.env') });

enum DepartmentCategory {
  COMPUTING_AI = "Computing & AI",
  LIFE_SCIENCES = "Life Sciences",
  PHYSICAL_SCIENCES = "Physical Sciences & Engineering",
  HEALTH_MEDICINE = "Health & Medicine",
  SOCIAL_SCIENCES = "Social Sciences",
  HUMANITIES_ARTS = "Humanities & Arts",
  ENVIRONMENTAL = "Environmental Sciences",
  ECONOMICS = "Economics",
  MATHEMATICS = "Mathematics"
}

// Category to colorKey mapping (aligned with Research Field colors)
const categoryColorKeys: Record<DepartmentCategory, number> = {
  [DepartmentCategory.COMPUTING_AI]: 0,        // blue
  [DepartmentCategory.LIFE_SCIENCES]: 1,       // green
  [DepartmentCategory.PHYSICAL_SCIENCES]: 2,   // yellow
  [DepartmentCategory.HEALTH_MEDICINE]: 3,     // red
  [DepartmentCategory.SOCIAL_SCIENCES]: 4,     // purple
  [DepartmentCategory.HUMANITIES_ARTS]: 5,     // pink
  [DepartmentCategory.ENVIRONMENTAL]: 6,       // teal
  [DepartmentCategory.ECONOMICS]: 7,           // orange
  [DepartmentCategory.MATHEMATICS]: 8          // indigo
};

// Full department data with updated category assignments
// Categories aligned with Research Fields for consistent colors
const departments = [
  { abbreviation: "AFST", name: "African Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "AMST", name: "American Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "ANES", name: "Anesthesiology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "ANTH", name: "Anthropology", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "AMTH", name: "Applied Mathematics", categories: [DepartmentCategory.MATHEMATICS] },
  { abbreviation: "APHY", name: "Applied Physics", categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "ARCG", name: "Archaeological Studies", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "ARCH", name: "Architecture", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "ART", name: "Art", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "ASTR", name: "Astronomy", categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "BIOL", name: "Biological & Biomedical Sciences", categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "BENG", name: "Biomedical Engineering", categories: [DepartmentCategory.PHYSICAL_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "BIDS", name: "Biomedical Informatics and Data Science", categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "BIS", name: "Biostatistics", categories: [DepartmentCategory.MATHEMATICS, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "AFAM", name: "Black Studies", categories: [DepartmentCategory.HUMANITIES_ARTS, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "CBIO", name: "Cell Biology", categories: [DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: "C&MP", name: "Cellular & Molecular Physiology", categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "CEE", name: "Chemical & Environmental Engineering", categories: [DepartmentCategory.PHYSICAL_SCIENCES, DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: "CHEM", name: "Chemistry", categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "CHLD", name: "Child Study Center", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "CDE", name: "Chronic Disease Epidemiology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "CLSS", name: "Classics", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "CGSC", name: "Cognitive Science", categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "CPLT", name: "Comparative Literature", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "CPMD", name: "Comparative Medicine", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "CB&B", name: "Computational Biology & Biomedical Informatics", categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: "CPSC", name: "Computer Science", categories: [DepartmentCategory.COMPUTING_AI] },
  { abbreviation: "DERM", name: "Dermatology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "EMST", name: "Early Modern Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "EPS", name: "Earth & Planetary Sciences", categories: [DepartmentCategory.ENVIRONMENTAL, DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "EALL", name: "East Asian Languages & Literatures", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "EAST", name: "East Asian Studies", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "EEB", name: "Ecology & Evolutionary Biology", categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: "ECON", name: "Economics", categories: [DepartmentCategory.ECONOMICS] },
  { abbreviation: "ECE", name: "Electrical & Computer Engineering", categories: [DepartmentCategory.COMPUTING_AI, DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "EM", name: "Emergency Medicine", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "ENAS", name: "Engineering & Applied Science", categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "ENGL", name: "English Language & Literature", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "EVST", name: "Environment", categories: [DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: "EHS", name: "Environmental Health Sciences", categories: [DepartmentCategory.ENVIRONMENTAL, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "EMD", name: "Epidemiology of Microbial Diseases", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "ER&M", name: "Ethnicity, Race, & Migration", categories: [DepartmentCategory.HUMANITIES_ARTS, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "RSEE", name: "European & Russian Studies", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "EXPA", name: "Experimental Pathology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "FILM", name: "Film & Media Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "F&ES", name: "Forestry", categories: [DepartmentCategory.ENVIRONMENTAL] },
  { abbreviation: "FREN", name: "French", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "GENE", name: "Genetics", categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "GMAN", name: "German", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "GLBL", name: "Global Affairs", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "HCM", name: "Health Care Management", categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.ECONOMICS] },
  { abbreviation: "HPM", name: "Health Policy & Management", categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "HELN", name: "Hellenic Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "HIST", name: "History", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "HSAR", name: "History of Art", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "HSHM", name: "History of Science & Medicine", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "HUMS", name: "Humanities", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "IBIO", name: "Immunobiology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "INMD", name: "Internal Medicine", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "IMED", name: "Investigative Medicine", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "ITAL", name: "Italian Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "JDST", name: "Jewish Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "LAST", name: "Latin American Studies", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "LAW", name: "Law", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "LING", name: "Linguistics", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "MGT", name: "Management", categories: [DepartmentCategory.ECONOMICS] },
  { abbreviation: "MATH", name: "Mathematics", categories: [DepartmentCategory.MATHEMATICS] },
  { abbreviation: "MENG", name: "Mechanical Engineering & Materials Science", categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "MDVL", name: "Medieval Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "MBIO", name: "Microbiology", categories: [DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: "MBP", name: "Microbial Pathogenesis", categories: [DepartmentCategory.HEALTH_MEDICINE, DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: "MMES", name: "Modern Middle East Studies", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "MB&B", name: "Molecular Biophysics & Biochemistry", categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "MCDB", name: "Molecular, Cellular & Developmental Biology", categories: [DepartmentCategory.LIFE_SCIENCES] },
  { abbreviation: "MUSI", name: "Music", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "NELC", name: "Near Eastern Languages & Civilizations", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "NRLG", name: "Neurology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "NRSG", name: "Neurosurgery", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "NSCI", name: "Neuroscience", categories: [DepartmentCategory.LIFE_SCIENCES, DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "NURS", name: "Nursing", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "OBGN", name: "Obstetrics, Gynecology & Reproductive Sciences", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "OPVS", name: "Ophthalmology & Visual Science", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "OPRH", name: "Orthopaedics & Rehabilitation", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "PATH", name: "Pathology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "PEDT", name: "Pediatrics", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "PHAR", name: "Pharmacology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "PHIL", name: "Philosophy", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "PHYS", name: "Physics", categories: [DepartmentCategory.PHYSICAL_SCIENCES] },
  { abbreviation: "PLSC", name: "Political Science", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "PSYT", name: "Psychiatry", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "PSYC", name: "Psychology", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "EPH", name: "Public Health", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "R&BI", name: "Radiology & Biomedical Imaging", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "RLST", name: "Religious Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "SLAV", name: "Slavic Languages & Literatures", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "SOCY", name: "Sociology", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "SAST", name: "South Asian Studies", categories: [DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "SPAN/PORT", name: "Spanish & Portuguese", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "S&DS", name: "Statistics & Data Science", categories: [DepartmentCategory.MATHEMATICS, DepartmentCategory.COMPUTING_AI] },
  { abbreviation: "SURG", name: "Surgery", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "TDPS", name: "Theater, Dance, & Performance Studies", categories: [DepartmentCategory.HUMANITIES_ARTS] },
  { abbreviation: "TRAD", name: "Therapeutic Radiology/Radiation Oncology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "URLG", name: "Urology", categories: [DepartmentCategory.HEALTH_MEDICINE] },
  { abbreviation: "WGSS", name: "Women's, Gender, & Sexuality Studies", categories: [DepartmentCategory.HUMANITIES_ARTS, DepartmentCategory.SOCIAL_SCIENCES] },
  { abbreviation: "YSM", name: "Yale School of Medicine", categories: [DepartmentCategory.HEALTH_MEDICINE] },
];

const departmentSchema = new mongoose.Schema({
  abbreviation: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  categories: { type: [String], required: true, enum: Object.values(DepartmentCategory) },
  primaryCategory: { type: String, required: true, enum: Object.values(DepartmentCategory) },
  colorKey: { type: Number, required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

departmentSchema.index({ abbreviation: 1 });
departmentSchema.index({ name: 'text', abbreviation: 'text' });
departmentSchema.index({ primaryCategory: 1 });

const Department = mongoose.model('departments', departmentSchema);

async function seedDepartments(dbUrl: string, dbName: string) {
  console.log(`\n=== Seeding Departments to ${dbName} ===\n`);

  try {
    await mongoose.connect(dbUrl);
    console.log('Connected to MongoDB');

    const existingCount = await Department.countDocuments();
    console.log(`Existing departments: ${existingCount}`);

    // Prepare documents
    const deptDocs = departments.map(dept => ({
      abbreviation: dept.abbreviation,
      name: dept.name,
      displayName: `${dept.abbreviation} - ${dept.name}`,
      categories: dept.categories,
      primaryCategory: dept.categories[0],
      colorKey: categoryColorKeys[dept.categories[0]],
      isActive: true
    }));

    console.log(`Preparing to seed ${deptDocs.length} departments...`);

    const bulkOps = deptDocs.map(dept => ({
      updateOne: {
        filter: { abbreviation: dept.abbreviation },
        update: { $set: dept },
        upsert: true
      }
    }));

    const result = await Department.bulkWrite(bulkOps);

    console.log(`Upserted: ${result.upsertedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);
    console.log(`Total departments now: ${await Department.countDocuments()}`);

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB\n');
  } catch (error) {
    console.error('Error seeding departments:', error);
    await mongoose.disconnect();
    throw error;
  }
}

// Main execution
async function main() {
  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in environment');
    process.exit(1);
  }

  console.log('=== Departments Seeding Script ===');
  await seedDepartments(url, 'Database');
  console.log('=== Departments Seeding Complete ===\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
