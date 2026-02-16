/**
 * Institution affiliation detection (YSM, YSPH, YC) from department names.
 */
import facultyDepartments from './facultyDepartments.json';

const YSM_KEYWORDS = [
  'medicine', 'surgery', 'pathology', 'radiology', 'anesthesiology',
  'dermatology', 'neurology', 'neurosurgery', 'ophthalmology', 'orthopedics',
  'otolaryngology', 'pediatrics', 'psychiatry', 'urology', 'obstetrics',
  'gynecology', 'cardiology', 'oncology', 'emergency', 'pharmacology',
  'physiology', 'cell biology', 'genetics', 'immunobiology', 'microbial',
  'therapeutic radiology', 'laboratory medicine', 'internal medicine',
  'comparative medicine', 'cellular', 'molecular', 'ysm',
];

const YSPH_KEYWORDS = [
  'public health', 'epidemiology', 'biostatistics', 'environmental health',
  'health policy', 'chronic disease', 'social and behavioral', 'ysph',
  'microbial diseases',
];

/**
 * Get the primary department for a faculty member from the CSV lookup.
 * Returns null if not found.
 */
export function getFacultyPrimaryDepartment(fullName: string): string | null {
  if (facultyDepartments[fullName as keyof typeof facultyDepartments]) {
    return facultyDepartments[fullName as keyof typeof facultyDepartments];
  }

  const nameLower = fullName.toLowerCase().trim();
  for (const [key, dept] of Object.entries(facultyDepartments)) {
    if (key.toLowerCase().trim() === nameLower) {
      return dept;
    }
  }

  return null;
}

/**
 * Determine institution affiliation based on departments.
 * YSM = Yale School of Medicine, YSPH = Yale School of Public Health, YC = Yale College (default)
 */
export function getInstitutionAffiliation(departments: string[]): string {
  if (!departments || departments.length === 0) return 'YC';

  const deptStr = departments.join(' ').toLowerCase();

  if (YSPH_KEYWORDS.some(kw => deptStr.includes(kw))) {
    return 'YSPH';
  }

  if (YSM_KEYWORDS.some(kw => deptStr.includes(kw))) {
    return 'YSM';
  }

  return 'YC';
}

/**
 * Get the full label for an institution code.
 */
export function getInstitutionLabel(code: string): string {
  switch (code) {
    case 'YSM': return 'Yale School of Medicine';
    case 'YSPH': return 'Yale School of Public Health';
    case 'YC': return 'Yale College';
    default: return code;
  }
}
