/**
 * Faculty-directory source registry for scraper coverage planning.
 *
 * This is a declarative map of every known Yale faculty/people directory that a
 * roster scraper could ingest, annotated with which existing scraper (if any)
 * already covers it. It drives the coverage program: entries with status `gap`
 * are candidates for a new per-directory scraper config; `partial` entries are
 * only fractionally covered (e.g. one department of a multi-department index).
 *
 * These `url` values are crawl ENTRY POINTS (directory roots / index / loader
 * pages). They must never be persisted as an Observation/Source citation: every
 * emitted artifact cites the individual faculty's own profile URL, not the
 * directory root, per the self-referential/index-page source guards
 * (see #516 and #549). The registry exists for planning and reporting; it does
 * not itself change scraper behavior.
 *
 * `coveredBy` names are `Source.name` keys from `sourceCoverageRegistry`.
 */
import type { SourceCoverageName } from './sourceCoverageRegistry';

export type FacultyDirectoryRendering = 'static' | 'js-rendered';

export type FacultyDirectoryCoverageStatus = 'covered' | 'partial' | 'gap';

/**
 * ROI ranking for a student seeking research, highest first:
 *   1 school-wide index (most labs per crawl)
 *   2 high-density STEM / life-science department
 *   3 cross-cutting research institute / center
 *   4 health school or research-active social science
 *   5 humanities department
 *   6 professional / graduate school
 */
export type FacultyDirectoryImpactTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface FacultyDirectoryEntry {
  /** Directory root / index entry point. Never cited as a source; see module doc. */
  url: string;
  school: string;
  department: string;
  rendering: FacultyDirectoryRendering;
  status: FacultyDirectoryCoverageStatus;
  studentImpactTier: FacultyDirectoryImpactTier;
  /** Existing scraper source(s) that already cover this directory (roster or member level). */
  coveredBy?: SourceCoverageName[];
  /** Approximate faculty/member count observed on the live page (rounded). */
  approxFacultyCount?: number;
  /** True when the listing spans multiple pages (`?page=N`, Load More, etc.). */
  paginated?: boolean;
  notes?: string;
}

export const FACULTY_DIRECTORY_REGISTRY: FacultyDirectoryEntry[] = [
  // ---- Tier 1: school-wide indexes -------------------------------------------------
  {
    url: 'https://medicine.yale.edu/faculty/faculty-directory/facultylist/',
    school: 'Yale School of Medicine',
    department: 'All departments (school-wide A-Z)',
    rendering: 'static',
    status: 'partial',
    studentImpactTier: 1,
    coveredBy: ['ysm-atoz-index'],
    approxFacultyCount: 4000,
    notes:
      'Partially covered via the A-Z lab index (ysm-atoz-index), which ingests YSM lab research homes. The Yalies API is a school-wide faculty-identity source that is not specific to this directory, so it is not counted as coverage here. There is no scraper that walks the YSM faculty directory per-faculty for profile enrichment / lab-website discovery.',
  },
  {
    url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory',
    school: 'Yale School of Engineering & Applied Science',
    department: 'All departments (school-wide)',
    rendering: 'js-rendered',
    status: 'partial',
    studentImpactTier: 1,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 124,
    notes:
      'Only Computer Science is configured (via its client-side load_faculty JSON endpoint). Applied Physics, Biomedical Engineering, Chemical & Environmental Engineering, Electrical & Computer Engineering, Mechanical Engineering, and Materials Science are not covered. JS-rendered SPA; per-department pages have no static roster.',
  },

  // ---- Tier 2: high-density STEM / life-science departments -----------------------
  {
    url: 'https://mcdb.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Molecular, Cellular and Developmental Biology',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 40,
    paginated: true,
  },
  {
    url: 'https://physics.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Physics',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 60,
  },
  {
    url: 'https://psychology.yale.edu/people/faculty/primary',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Psychology',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 30,
    notes: 'Roster lives on the /primary subpage; the parent /people/faculty renders empty.',
  },
  {
    url: 'https://statistics.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Statistics & Data Science',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 30,
  },
  {
    url: 'https://astronomy.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Astronomy',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 24,
  },
  {
    url: 'https://math.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Mathematics',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 21,
  },
  {
    url: 'https://earth.yale.edu/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Earth and Planetary Sciences',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 24,
  },
  {
    url: 'https://chem.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Chemistry',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 2,
    approxFacultyCount: 38,
    notes:
      'Undergraduate-research page is covered by department-undergrad-research; the roster is not.',
  },
  {
    url: 'https://mbb.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Molecular Biophysics & Biochemistry',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 40,
  },
  {
    url: 'https://eeb.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Ecology & Evolutionary Biology',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 2,
    approxFacultyCount: 40,
  },

  // ---- Tier 3: cross-cutting research institutes / centers ------------------------
  {
    url: 'https://wlab.yale.edu/people/faculty/primary-faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Wright Laboratory (Physics)',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 13,
    notes:
      'Wright Laboratory is a physics research center whose primary-faculty page lists members with directory-listing cards linking wlab.yale.edu/profile/<slug> official-profile pages. Ingested official-profile-only (officialProfileOnly) so it captures each faculty member\'s Wright Lab profile URL as an official-profile source without minting duplicate lab entities; the faculty already own physics lab entities elsewhere.',
  },
  {
    url: 'https://wti.yale.edu/humans/faculty',
    school: 'Wu Tsai Institute',
    department: 'Institute faculty',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['centers-institutes-index'],
    approxFacultyCount: 100,
  },
  {
    url: 'https://medicine.yale.edu/cancer/research/membership/directory',
    school: 'Yale Cancer Center',
    department: 'Member directory',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['centers-institutes-index'],
    approxFacultyCount: 400,
  },
  {
    url: 'https://quantuminstitute.yale.edu/people/members',
    school: 'Yale Quantum Institute',
    department: 'Members',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['centers-institutes-index'],
    approxFacultyCount: 33,
  },
  {
    url: 'https://isps.yale.edu/team/directory/faculty-fellows',
    school: 'Institution for Social and Policy Studies',
    department: 'Faculty fellows',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['centers-institutes-index'],
  },
  {
    url: 'https://macmillan.yale.edu/people',
    school: 'MacMillan Center for International and Area Studies',
    department: 'Affiliated people',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['centers-institutes-index'],
    paginated: true,
  },
  {
    url: 'https://medicine.yale.edu/genetics/research/ycga/people/',
    school: 'Yale Center for Genome Analysis',
    department: 'Staff',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['centers-institutes-index'],
    approxFacultyCount: 22,
  },
  {
    url: 'https://medicine.yale.edu/stemcell/people/listing/',
    school: 'Yale Stem Cell Center',
    department: 'Faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    approxFacultyCount: 95,
    notes:
      'Members overlap heavily with YSM/FAS department faculty; expect dedup against existing entities.',
  },
  {
    url: 'https://medicine.yale.edu/yigh/faculty-support-initiative/affiliated-faculty/',
    school: 'Yale Institute for Global Health',
    department: 'Affiliated faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    approxFacultyCount: 210,
    notes: 'Affiliate overlap with Medicine/Public Health/Nursing; low net-new headcount.',
  },
  {
    url: 'https://yibs.yale.edu/people/faculty-affiliates',
    school: 'Yale Institute for Biospheric Studies',
    department: 'Faculty affiliates',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    approxFacultyCount: 65,
    notes: 'Affiliate overlap; may also surface via yale-research-official discovery.',
  },

  // ---- Tier 4: health schools and research-active social sciences -----------------
  {
    url: 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/',
    school: 'Yale School of Public Health',
    department: 'All departments (A-Z)',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 686,
    notes:
      'Covered via the dept-faculty-roster "ysph" config row (#641): the school-wide "Faculty Directory by Name" A-Z index renders all ~686 entries server-side on one page (no pagination), each linking to an official ysph.yale.edu/profile/<slug>/ page cited as the per-faculty source.',
  },
  {
    url: 'https://nursing.yale.edu/faculty-research/faculty-directory',
    school: 'Yale School of Nursing',
    department: 'Faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    approxFacultyCount: 70,
  },
  {
    url: 'https://environment.yale.edu/directory/faculty',
    school: 'Yale School of the Environment',
    department: 'Faculty',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredBy: ['yse-centers-index', 'yse-faculty-directory'],
    approxFacultyCount: 150,
    paginated: true,
    notes:
      'The YSE faculty roster is covered by the bespoke yse-faculty-directory scraper (#550, merged). yse-centers-index separately covers YSE centers and programs, not the roster.',
  },
  {
    url: 'https://economics.yale.edu/people',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Economics',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredBy: ['dept-faculty-roster'],
    paginated: true,
  },
  {
    url: 'https://politicalscience.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Political Science',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 40,
    paginated: true,
  },
  {
    url: 'https://anthropology.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Anthropology',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 25,
  },
  {
    url: 'https://sociology.yale.edu/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Sociology',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    approxFacultyCount: 20,
    notes: 'Canonical path is /faculty; /people/faculty 404s.',
  },
  {
    url: 'https://medicine.yale.edu/pa/profession/meet-the-team/',
    school: 'Yale School of Medicine',
    department: 'Physician Associate Program',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    approxFacultyCount: 10,
  },

  // ---- Tier 5: humanities departments ---------------------------------------------
  {
    url: 'https://history.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'History',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 70,
    paginated: true,
  },
  {
    url: 'https://arthistory.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'History of Art',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 18,
  },
  {
    url: 'https://americanstudies.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'American Studies',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 30,
    paginated: true,
  },
  {
    url: 'https://wgss.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: "Women's, Gender, and Sexuality Studies",
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 38,
    notes: 'Heavily cross-listed; expect dedup against home departments.',
  },
  {
    url: 'https://erm.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Ethnicity, Race, and Migration',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
  },
  {
    url: 'https://yalemusic.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Music (FAS department)',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 18,
    notes:
      'FAS Music department (yalemusic.yale.edu); distinct from the School of Music (music.yale.edu).',
  },
  {
    url: 'https://eall.yale.edu/people/professors',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'East Asian Languages & Literatures',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 9,
  },
  {
    url: 'https://tdps.yale.edu/people',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Theater, Dance, and Performance Studies',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
  },
  {
    url: 'https://english.yale.edu/people/ladder-faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'English',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 39,
  },
  {
    url: 'https://philosophy.yale.edu/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Philosophy',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 23,
  },
  {
    url: 'https://blackstudies.yale.edu/people',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Black Studies (formerly African American Studies)',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 30,
    notes: 'Renamed from afamstudies; /people/faculty is empty, use /people.',
  },
  {
    url: 'https://classics.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Classics',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 19,
  },
  {
    url: 'https://religiousstudies.yale.edu/people/core-faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Religious Studies',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 18,
  },
  {
    url: 'https://ling.yale.edu/people/linguistics-faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Linguistics',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 11,
  },
  {
    url: 'https://complit.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Comparative Literature',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 15,
  },
  {
    url: 'https://filmstudies.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Film & Media Studies',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 24,
  },
  {
    url: 'https://nelc.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Near Eastern Languages & Civilizations',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 27,
  },
  {
    url: 'https://french.yale.edu/people/professors',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'French',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 12,
  },
  {
    url: 'https://german.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Germanic Languages & Literatures',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 11,
  },
  {
    url: 'https://span-port.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Spanish & Portuguese',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 30,
    notes: 'Host is span-port.yale.edu (hyphenated).',
  },
  {
    url: 'https://slavic.yale.edu/directory/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Slavic Languages & Literatures',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 11,
    notes: 'Uses /directory/faculty, not /people.',
  },
  {
    url: 'https://italian.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Italian',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 5,
    approxFacultyCount: 11,
  },

  // ---- Tier 6: professional / graduate schools ------------------------------------
  {
    url: 'https://jackson.yale.edu/faculty-research/professors-global-affairs',
    school: 'Yale Jackson School of Global Affairs',
    department: 'Professors of Global Affairs',
    rendering: 'static',
    status: 'partial',
    studentImpactTier: 6,
    coveredBy: ['dept-faculty-roster', 'centers-institutes-index'],
    approxFacultyCount: 18,
    notes:
      'dept-faculty-roster covers the lecturers page and centers-institutes-index covers Jackson centers; the core Professors of Global Affairs list and sibling category pages are not covered.',
  },
  {
    url: 'https://som.yale.edu/faculty-research/faculty-directory',
    school: 'Yale School of Management',
    department: 'Faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 104,
    paginated: true,
  },
  {
    url: 'https://law.yale.edu/faculty?type=faculty',
    school: 'Yale Law School',
    department: 'Faculty',
    rendering: 'js-rendered',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 130,
    paginated: true,
    notes: 'Requires the ?type=faculty filter; Load More is client-side.',
  },
  {
    url: 'https://www.architecture.yale.edu/faculty',
    school: 'Yale School of Architecture',
    department: 'Faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 90,
    paginated: true,
  },
  {
    url: 'https://www.art.yale.edu/about/people/faculty-and-staff',
    school: 'Yale School of Art',
    department: 'Faculty & staff',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 90,
  },
  {
    url: 'https://divinity.yale.edu/about/faculty-directory',
    school: 'Yale Divinity School',
    department: 'Faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 90,
  },
  {
    url: 'https://music.yale.edu/meet-our-faculty',
    school: 'Yale School of Music',
    department: 'Faculty',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 50,
    notes:
      'School of Music (music.yale.edu); distinct from the FAS Music department (yalemusic.yale.edu).',
  },
  {
    url: 'https://www.drama.yale.edu/about-us/who-we-are',
    school: 'David Geffen School of Drama at Yale',
    department: 'Faculty & staff',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxFacultyCount: 60,
    notes: 'Single roster page grouped by program; no dedicated /faculty path.',
  },
];

export function getFacultyDirectoriesByStatus(
  status: FacultyDirectoryCoverageStatus,
): FacultyDirectoryEntry[] {
  return FACULTY_DIRECTORY_REGISTRY.filter((entry) => entry.status === status);
}

/**
 * Uncovered directories (status `gap` or `partial`), ranked by student research
 * ROI: impact tier first, then approximate faculty count.
 */
export function getFacultyDirectoryGaps(): FacultyDirectoryEntry[] {
  return FACULTY_DIRECTORY_REGISTRY.filter((entry) => entry.status !== 'covered').sort((a, b) => {
    if (a.studentImpactTier !== b.studentImpactTier) {
      return a.studentImpactTier - b.studentImpactTier;
    }
    return (b.approxFacultyCount ?? 0) - (a.approxFacultyCount ?? 0);
  });
}
