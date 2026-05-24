export interface DirectoryCsvRow {
  netid: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  department: string;
  departmentUnit: string;
  school: string;
  schoolCode: string;
  physicalLocation: string;
}

export type DirectoryCsvDecision =
  | 'AUTO_RESEARCH_PERSON'
  | 'REVIEW_RESEARCH_ADJACENT'
  | 'IDENTITY_ONLY'
  | 'SUPPRESS_NOISE';

export interface DirectoryCsvClassification {
  decision: DirectoryCsvDecision;
  reasons: string[];
  score: number;
}

const FACULTY_TITLE_RE =
  /\b(professor|assistant professor|associate professor|lecturer|senior lecturer|lector|instructor|research scientist|research scholar|research fellow|postdoctoral|postdoc|clinical professor|clinical instructor|emerit|visiting scholar|visiting professor|visiting fellow)\b/i;

const RESEARCH_ADJACENT_TITLE_RE =
  /\b(clinical research|research coordinator|research assistant|research associate|research specialist|research staff|research aide|program in research|laboratory associate|lab associate|research affiliate)\b/i;

const GENERIC_AFFILIATE_TITLE_RE = /\b(research affiliates?|affiliate researcher|research visitor)\b/i;
const LIBRARY_COLLECTIONS_RE = /\b(library|librarian|curator|curatorial|archive|archivist|archives|collections?|manuscripts?|rare books?|museum)\b/i;
const ACADEMIC_UNIT_RE =
  /\b(history|biology|chemistry|physics|astronomy|mathematics|statistics|computer science|engineering|economics|psychology|sociology|anthropology|political science|linguistics|philosophy|english|classics|earth|environment|medicine|public health|nursing|law|divinity|architecture|art|music|drama|school of management|school of medicine|faculty of arts and sciences|fashis|fas|yale college)\b/i;

const HARD_SUPPRESS_TITLE_RE =
  /\b(custodian|janitor|hospitality|dining|chef|cook|cashier|driver|security|police|parking|facilities|maintenance|tradesperson|electrician|plumber|mechanic|vendor|spouse|retiree spouse|volunteer spouse|assistant to|administrative assistant|senior administrative assistant|office assistant|receptionist|scheduler|payroll|human resources|hr generalist|accountant|billing|procurement|mail clerk|stock clerk)\b/i;

const GENERIC_AFFILIATE_NOISE_RE = /\b(affiliate|associate|assistant|coordinator|manager|specialist)\b/i;

function haystack(row: DirectoryCsvRow): string {
  return [row.title, row.department, row.departmentUnit, row.school, row.schoolCode]
    .filter(Boolean)
    .join(' ');
}

export function classifyDirectoryCsvRow(row: DirectoryCsvRow): DirectoryCsvClassification {
  const title = row.title.trim();
  const text = haystack(row);
  const reasons: string[] = [];
  let score = 0;

  if (!title) {
    reasons.push('blank-title');
  }

  if (HARD_SUPPRESS_TITLE_RE.test(title)) {
    reasons.push('hard-suppress-title');
    return { decision: 'SUPPRESS_NOISE', reasons, score: -10 };
  }

  if (FACULTY_TITLE_RE.test(title)) {
    reasons.push('faculty-title');
    score += 5;
  }
  if (ACADEMIC_UNIT_RE.test(text)) {
    reasons.push('academic-unit');
    score += 2;
  }
  if (RESEARCH_ADJACENT_TITLE_RE.test(title)) {
    reasons.push('research-adjacent-title');
    score += 2;
  }
  if (GENERIC_AFFILIATE_TITLE_RE.test(title)) {
    reasons.push('generic-affiliate-title');
    score += 1;
  }
  if (LIBRARY_COLLECTIONS_RE.test(text)) {
    reasons.push('library-collections-signal');
    score += 1;
  }
  if (GENERIC_AFFILIATE_NOISE_RE.test(title) && !FACULTY_TITLE_RE.test(title)) {
    reasons.push('generic-affiliate-title');
  }

  if (reasons.includes('faculty-title') && score >= 5) {
    return { decision: 'AUTO_RESEARCH_PERSON', reasons, score };
  }

  if (
    reasons.includes('research-adjacent-title') ||
    reasons.includes('generic-affiliate-title') ||
    reasons.includes('library-collections-signal')
  ) {
    return { decision: 'REVIEW_RESEARCH_ADJACENT', reasons, score };
  }

  if (reasons.includes('blank-title') || reasons.includes('academic-unit')) {
    return { decision: 'IDENTITY_ONLY', reasons, score };
  }

  return { decision: 'IDENTITY_ONLY', reasons: reasons.length ? reasons : ['no-research-signal'], score };
}
