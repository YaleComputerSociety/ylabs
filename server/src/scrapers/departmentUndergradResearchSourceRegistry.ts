/**
 * Department undergraduate-research-pathway source registry for scraper
 * coverage planning.
 *
 * This is the department-pathway analogue of `facultyDirectoryRegistry.ts`,
 * `centersInstitutesRegistry.ts`, and `fellowshipProgramSourceRegistry.ts`: a
 * declarative map of Yale departments' public undergraduate-research /
 * senior-essay / independent-study / department-RA guidance pages, each
 * annotated with whether `departmentUndergradResearchScraper` already ingests
 * it. It drives the coverage program - entries with status `gap` are
 * candidates for a new `DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES` config
 * row, `covered` entries are wired, and `evaluated-skipped` entries were
 * assessed and deliberately kept out of the burn-down (their `notes` record
 * why), so they are neither a to-do gap nor a live source.
 *
 * These `url` values are the department's own undergraduate-research /
 * senior-essay page - a legitimate provenance source for that department, per
 * the same self-referential / index-page source guards as the other three
 * registries (see #516 / #549 / #560). The registry exists for planning and
 * reporting; it does not itself change scraper behavior, and wiring an
 * individual `gap` row into `DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES`
 * remains a per-department follow-up this registry makes discoverable.
 *
 * `coveredBy` names are `Source.name` keys from `sourceCoverageRegistry`.
 */
import type { SourceCoverageName } from './sourceCoverageRegistry';

export type DepartmentUndergradResearchCoverageStatus =
  | 'covered'
  | 'partial'
  | 'gap'
  | 'evaluated-skipped';

/**
 * ROI ranking for a student seeking a department "how do I get involved"
 * pathway, highest first:
 *   1 large/high-demand major with a dedicated senior-essay/research page
 *   2 mid-size major or program with a dedicated pathway page
 *   3 smaller major or interdisciplinary program pathway page
 *   4 college-wide/hub guidance page (breadth over a single department)
 *   5 low-ROI / niche pathway
 */
export type DepartmentUndergradResearchImpactTier = 1 | 2 | 3 | 4 | 5;

export interface DepartmentUndergradResearchEntry {
  /** The department's own undergraduate-research/senior-essay page. See module doc. */
  url: string;
  department: string;
  school: string;
  status: DepartmentUndergradResearchCoverageStatus;
  impactTier: DepartmentUndergradResearchImpactTier;
  /** `key` in `DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES` that ingests this page, when wired. */
  coveredByKey?: string;
  /** Existing scraper source(s) that already cover this page. */
  coveredBy?: SourceCoverageName[];
  notes?: string;
}

export const DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY: DepartmentUndergradResearchEntry[] = [
  // ---- Covered: current DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES entries -------
  {
    url: 'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
    department: 'Physics',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'physics',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
    department: 'Chemistry',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'chemistry',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
    department: 'Molecular, Cellular and Developmental Biology',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'mcdb',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://economics.yale.edu/undergraduate/tobin-ra/tobin-research-assistantship-application',
    department: 'Economics',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'economics-tobin-ra',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://psychology.yale.edu/what-undergraduate-research-opportunities-are-available',
    department: 'Psychology',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'psychology',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://astronomy.yale.edu/academics/undergraduate-program/undergraduate-research',
    department: 'Astronomy',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'astronomy',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://math.yale.edu/undergraduates/undergraduate-research',
    department: 'Mathematics',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'mathematics',
    coveredBy: ['department-undergrad-research'],
    notes: 'Also the pathway page for Applied Mathematics, which has no separate department site.',
  },
  {
    url: 'https://engineering.yale.edu/academic-study/undergraduate/research',
    department: 'Engineering',
    school: 'Yale School of Engineering & Applied Science',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'engineering',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://cogsci.yale.edu/research/undergraduate-research-opportunities',
    department: 'Cognitive Science',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'cognitive-science',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://eeb.yale.edu/academics/undergraduate-program/undergraduate-research-opportunities',
    department: 'Ecology and Evolutionary Biology',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'eeb',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://science.yalecollege.yale.edu/yale-undergraduate-research/research-opportunities',
    department: 'Science and Quantitative Reasoning Education',
    school: 'Yale College',
    status: 'covered',
    impactTier: 4,
    coveredByKey: 'yale-undergraduate-research-science',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://anthropology.yale.edu/undergraduate-program/undergraduate-research-in-anthropology',
    department: 'Anthropology',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'anthropology',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://earth.yale.edu/undergraduate-program',
    department: 'Earth and Planetary Sciences',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'earth-planetary-sciences',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://politicalscience.yale.edu/academics/about-undergraduate-program',
    department: 'Political Science',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'political-science',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://history.yale.edu/academics/undergraduate-program',
    department: 'History',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'history',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://neuroscience.yale.edu/research-opportunities',
    department: 'Neuroscience',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'neuroscience',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://mbb.yale.edu/introduction-undergraduate-program',
    department: 'Molecular Biophysics and Biochemistry',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'molecular-biophysics-biochemistry',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://ling.yale.edu/academics/undergraduate/research-opportunities/linguistics-research-opportunities-yale',
    department: 'Linguistics',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 3,
    coveredByKey: 'linguistics',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
    department: 'Computer Science',
    school: 'Yale School of Engineering & Applied Science',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'computer-science',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://sociology.yale.edu/undergraduate-program/senior-project',
    department: 'Sociology',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'sociology',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://engineering.yale.edu/academic-study/departments/biomedical-engineering/undergraduate-study',
    department: 'Biomedical Engineering',
    school: 'Yale School of Engineering & Applied Science',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'biomedical-engineering',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://statistics.yale.edu/undergraduates/the-major/49104920-senior-essay',
    department: 'Statistics and Data Science',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'statistics-and-data-science',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://english.yale.edu/undergraduate/senior-essay',
    department: 'English',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 1,
    coveredByKey: 'english',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://complit.yale.edu/undergraduates/the-senior-essay',
    department: 'Comparative Literature',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 3,
    coveredByKey: 'comparative-literature',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://religiousstudies.yale.edu/undergraduate/senior-essay',
    department: 'Religious Studies',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 3,
    coveredByKey: 'religious-studies',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://americanstudies.yale.edu/undergraduate-program/senior-year/senior-essay-course-requirements',
    department: 'American Studies',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 2,
    coveredByKey: 'american-studies',
    coveredBy: ['department-undergrad-research'],
  },
  {
    url: 'https://wgss.yale.edu/single-term-senior-essay-instructions-and-registration-form',
    department: "Women's, Gender, and Sexuality Studies",
    school: 'Yale Faculty of Arts and Sciences',
    status: 'covered',
    impactTier: 3,
    coveredByKey: 'womens-gender-sexuality-studies',
    coveredBy: ['department-undergrad-research'],
  },

  // ---- Gaps: verified live pathway pages not yet wired ----------------------------
  {
    url: 'https://arthistory.yale.edu/undergraduate/senior-essay',
    department: 'History of Art',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'gap',
    impactTier: 3,
    notes:
      'Verified live: a real, year-dated senior-essay page with proposal deadlines, a staged milestone timeline (proposal, outline, draft, final essay), and two Senior Essay Workshop/Colloquium sessions per term. No config entry yet.',
  },
  {
    url: 'https://erm.yale.edu/undergraduate/senior-requirement',
    department: 'Ethnicity, Race, and Migration',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'gap',
    impactTier: 3,
    notes:
      'Verified live: describes two senior-requirement paths (year-long senior essay/project with a senior colloquium and project seminar, or a two-seminar path with a shorter essay), plus an independent-study request form and a senior-essay adviser form. No config entry yet.',
  },
  {
    url: 'https://filmstudies.yale.edu/undergraduate/senior-requirement',
    department: 'Film and Media Studies',
    school: 'Yale Faculty of Arts and Sciences',
    status: 'gap',
    impactTier: 3,
    notes:
      'Verified live: describes three senior-requirement tracks (two-seminar essay, independent research via FILM 491/492 with a faculty-approved prospectus, or a hybrid), plus a creative senior-project alternative and a production track. No config entry yet.',
  },
  {
    url: 'https://jackson.yale.edu/faculty-research/undergraduate-capstone-faculty',
    department: 'Global Affairs',
    school: 'Jackson School of Global Affairs',
    status: 'gap',
    impactTier: 2,
    notes:
      'Verified live: lists named capstone faculty and describes the Global Affairs major senior capstone (a client-facing public-policy group project overseen by a faculty instructor, weekly team meetings) in place of an individual senior thesis. No config entry yet.',
  },
];

export function getDepartmentUndergradResearchPagesByStatus(
  status: DepartmentUndergradResearchCoverageStatus,
): DepartmentUndergradResearchEntry[] {
  return DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY.filter((entry) => entry.status === status);
}

/**
 * Actionable uncovered department pathway pages (status `gap` or `partial`),
 * ranked by student research ROI: impact tier first. `evaluated-skipped`
 * pages are intentionally excluded because they were audited and deliberately
 * left un-crawled, so they are not a coverage to-do.
 */
export function getDepartmentUndergradResearchGaps(): DepartmentUndergradResearchEntry[] {
  return DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY.filter(
    (entry) => entry.status === 'gap' || entry.status === 'partial',
  ).sort((a, b) => a.impactTier - b.impactTier);
}

/**
 * Department pathway pages audited and deliberately left un-crawled (their
 * `notes` record the rationale). Kept distinct from gaps so evaluated pages
 * are never silently dropped nor re-proposed as coverage work.
 */
export function getEvaluatedSkippedDepartmentUndergradResearchPages(): DepartmentUndergradResearchEntry[] {
  return DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE_REGISTRY.filter(
    (entry) => entry.status === 'evaluated-skipped',
  );
}
