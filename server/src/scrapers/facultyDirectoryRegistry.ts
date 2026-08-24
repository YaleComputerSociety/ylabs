/**
 * Faculty-directory source registry for scraper coverage planning.
 *
 * This is a declarative map of every known Yale faculty/people directory that a
 * roster scraper could ingest, annotated with which existing scraper (if any)
 * already covers it. It drives the coverage program: entries with status `gap`
 * are candidates for a new per-directory scraper config; `partial` entries are
 * only fractionally covered (e.g. one department of a multi-department index);
 * `evaluated-skipped` entries were audited and deliberately left un-crawled
 * (their `notes` record why), so they are neither a to-do gap nor a live source.
 *
 * `directoryCategory` marks the acquisition lane a directory belongs to. Most
 * entries are Yale school/department/center directories (the default when the
 * field is absent). `affiliated-institute` is the explicitly-modeled lane for
 * freestanding, Yale-partnered research organizations that host their own
 * people/lab directories outside any Yale school faculty directory (issue
 * #1300); each such entry is evaluated for genuinely-independent, extractable,
 * Yale-scoped, net-new research homes before it is promoted from
 * `evaluated-skipped` to a crawled `coveredBy` source.
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

export type FacultyDirectoryCoverageStatus = 'covered' | 'partial' | 'gap' | 'evaluated-skipped';

/**
 * Acquisition lane a directory belongs to. Absent means a Yale school,
 * department, or center directory (the original registry scope);
 * `affiliated-institute` is the Yale-affiliated independent-institute lane
 * added in #1300.
 */
export type FacultyDirectoryCategory = 'affiliated-institute';

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
  /** Acquisition lane; absent for Yale school/department/center directories. */
  directoryCategory?: FacultyDirectoryCategory;
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
    status: 'covered',
    studentImpactTier: 1,
    coveredBy: ['ysm-atoz-index', 'ysm-faculty-directory'],
    approxFacultyCount: 4000,
    notes:
      'Covered via the A-Z lab index (ysm-atoz-index), which ingests YSM lab research homes, and ysm-faculty-directory (#639), which walks the school-wide A-Z faculty directory per-faculty: each profile with a lab website or governed research areas seeds/enriches a research home, keyed to the profile-page-derived PI identity. The directory itself lists ~14k entries (faculty, staff, and trainees); only profiles carrying real research content are enriched.',
  },
  {
    url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory',
    school: 'Yale School of Engineering & Applied Science',
    department: 'All departments (school-wide)',
    rendering: 'js-rendered',
    status: 'covered',
    studentImpactTier: 1,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 124,
    notes:
      'All SEAS departments configured (#640): Computer Science, Applied Physics, Biomedical Engineering, Electrical & Computer Engineering, and Mechanical Engineering/Materials Science via their shared client-side load_faculty JSON endpoint; Chemical & Environmental Engineering via a dedicated static-HTML card extractor since that department page renders server-side instead of hydrating the load_faculty widget.',
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 2,
    approxFacultyCount: 39,
    notes:
      'Covered via dept-faculty-roster (#1319): the /people/faculty roster renders server-side with the shared directory-listing-card Drupal theme, so it reuses directoryListingCardExtractor. Each card links the faculty member\'s own chem.yale.edu/profile/<slug> page, which is cited as the source; the roster root is only a crawl seed. The undergraduate-research page is separately covered by department-undergrad-research.',
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
      "Wright Laboratory is a physics research center whose primary-faculty page lists members with directory-listing cards linking wlab.yale.edu/profile/<slug> official-profile pages. Ingested official-profile-only (officialProfileOnly) so it captures each faculty member's Wright Lab profile URL as an official-profile source without minting duplicate lab entities; the faculty already own physics lab entities elsewhere.",
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
  {
    url: 'https://westcampus.yale.edu/about-us/faculty',
    school: 'Yale West Campus',
    department: 'West Campus Institutes (7 research institutes)',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredBy: ['dept-faculty-roster'],
    approxFacultyCount: 55,
    notes:
      'School-wide West Campus faculty directory covered by the dept-faculty-roster "west-campus" config row (#1295) via the reference-card static-HTML extractor. ~55 STEM/life-science PIs across seven institutes (Biomolecular Design & Discovery, Cancer Biology, Energy Sciences, Microbial Sciences, Nanobiology, Systems Biology, Preservation of Cultural Heritage); each card cites the faculty member own /profile/<slug> or off-site lab home, never the directory root. The Microbial Sciences Institute subdomain roster (microbialsciences.yale.edu/faculty-research) was evaluated and is a strict subset of these PIs, so it is not separately wired. Expect meaningful dedup against YSM / FAS Chemistry / MB&B home-department appointments.',
  },

  // ---- Affiliated independent institutes (#1300) ----------------------------------
  {
    url: 'https://haskinslabs.org/people',
    school: 'Haskins Laboratories (Yale-affiliated independent institute)',
    department: 'Scientists and affiliates',
    rendering: 'js-rendered',
    status: 'evaluated-skipped',
    directoryCategory: 'affiliated-institute',
    studentImpactTier: 3,
    coveredBy: ['ysm-faculty-directory'],
    notes:
      'Evaluated 2026-08-23. haskins.yale.edu 302-redirects to the institute\'s own Squarespace site (haskinslabs.org); its /people directory is client-rendered and links each scientist to their home-institution official profile rather than a Haskins-hosted profile. Only three people resolve to Yale profiles (medicine.yale.edu/profile/linda-mayes, /mary-young, /vincent-gracco) and all three are existing YSM faculty already covered by ysm-faculty-directory; the remaining scientists route to UConn profiles outside the Yale product scope. No net-new Yale research homes and no Haskins-hosted profile URLs to cite, so no bespoke crawler is added and the Yale-affiliated faculty already surface via their YSM profiles.',
  },
  {
    url: 'https://jbpierce.org/directory/',
    school: 'John B. Pierce Laboratory (Yale-affiliated independent institute)',
    department: 'Directory',
    rendering: 'static',
    status: 'evaluated-skipped',
    directoryCategory: 'affiliated-institute',
    studentImpactTier: 3,
    notes:
      'Evaluated 2026-08-23. jbpierce.org/directory lists only administrative, business-office, and board-of-directors staff (CPAs, JDs, an MBA); it exposes no research scientists, no per-person profile links, and no lab pages, so there is no extractable research people/lab content to ingest. Pierce research faculty are dual-appointed at Yale and surface through their Yale departmental appointments (e.g. YSM cellular and molecular physiology), not this site. Recorded as evaluated-and-skipped rather than a coverage gap.',
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 4,
    approxFacultyCount: 20,
    notes: 'Canonical path is /faculty; /people/faculty 404s.',
  },
  {
    url: 'https://medicine.yale.edu/pa/profession/meet-the-team/',
    school: 'Yale School of Medicine',
    department: 'Physician Associate Program',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 39,
  },
  {
    url: 'https://philosophy.yale.edu/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Philosophy',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 18,
  },
  {
    url: 'https://ling.yale.edu/people/linguistics-faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Linguistics',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 11,
  },
  {
    url: 'https://complit.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Comparative Literature',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 15,
  },
  {
    url: 'https://filmstudies.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Film & Media Studies',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 30,
    notes: 'Host is span-port.yale.edu (hyphenated).',
  },
  {
    url: 'https://slavic.yale.edu/directory/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Slavic Languages & Literatures',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 11,
    notes: 'Uses /directory/faculty, not /people.',
  },
  {
    url: 'https://italian.yale.edu/people/faculty',
    school: 'Yale Faculty of Arts and Sciences',
    department: 'Italian',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 5,
    approxFacultyCount: 11,
  },

  // ---- Tier 6: professional / graduate schools ------------------------------------
  {
    url: 'https://jackson.yale.edu/faculty-research/professors-global-affairs',
    school: 'Yale Jackson School of Global Affairs',
    department: 'Professors of Global Affairs',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 6,
    coveredBy: ['dept-faculty-roster', 'centers-institutes-index'],
    approxFacultyCount: 18,
    notes:
      'dept-faculty-roster now covers the core Professors of Global Affairs list via the jackson-global-affairs DeptConfig; centers-institutes-index covers Jackson centers.',
  },
  {
    url: 'https://som.yale.edu/faculty-research/faculty-directory',
    school: 'Yale School of Management',
    department: 'Faculty',
    rendering: 'static',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 6,
    approxFacultyCount: 241,
    paginated: true,
    notes:
      'Covered via the dept-faculty-roster "som" config row (#1293): the school-wide faculty-directory root renders server-side with the Drupal node-teaser--faculty theme and paginates via ?page=N, so it reuses nodeTeaserFacultyExtractor. Paginating the root captures all faculty across the six research disciplines (accounting, economics, finance, marketing, operations, organizational behavior) that the discipline sub-pages partition, so no per-discipline crawl is needed. Each card links the faculty member\'s own som.yale.edu/faculty-research/faculty-directory/<slug> page, which is cited as the per-faculty source; the directory root is only a crawl seed. Expect small dedup against existing economics/joint-appointment entities.',
  },
  {
    url: 'https://law.yale.edu/faculty?type=faculty',
    school: 'Yale Law School',
    department: 'Faculty',
    rendering: 'js-rendered',
    status: 'partial',
    coveredBy: ['dept-faculty-roster'],
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
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
    studentImpactTier: 6,
    approxFacultyCount: 90,
  },
  {
    url: 'https://music.yale.edu/meet-our-faculty',
    school: 'Yale School of Music',
    department: 'Faculty',
    rendering: 'js-rendered',
    status: 'covered',
    coveredBy: ['dept-faculty-roster'],
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
 * Actionable uncovered directories (status `gap` or `partial`), ranked by
 * student research ROI: impact tier first, then approximate faculty count.
 * `evaluated-skipped` directories are intentionally excluded because they were
 * audited and deliberately left un-crawled, so they are not a coverage to-do.
 */
export function getFacultyDirectoryGaps(): FacultyDirectoryEntry[] {
  return FACULTY_DIRECTORY_REGISTRY.filter(
    (entry) => entry.status === 'gap' || entry.status === 'partial',
  ).sort((a, b) => {
    if (a.studentImpactTier !== b.studentImpactTier) {
      return a.studentImpactTier - b.studentImpactTier;
    }
    return (b.approxFacultyCount ?? 0) - (a.approxFacultyCount ?? 0);
  });
}

/**
 * Directories audited and deliberately left un-crawled (their `notes` record
 * the rationale). Kept distinct from gaps so evaluated institutes are never
 * silently dropped nor re-proposed as coverage work.
 */
export function getEvaluatedSkippedDirectories(): FacultyDirectoryEntry[] {
  return FACULTY_DIRECTORY_REGISTRY.filter((entry) => entry.status === 'evaluated-skipped');
}

/**
 * Directories in a given acquisition lane (e.g. `affiliated-institute`).
 */
export function getFacultyDirectoriesByCategory(
  category: FacultyDirectoryCategory,
): FacultyDirectoryEntry[] {
  return FACULTY_DIRECTORY_REGISTRY.filter((entry) => entry.directoryCategory === category);
}
