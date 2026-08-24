/**
 * Centers / institutes source registry for scraper coverage planning.
 *
 * This is the centers/institutes analogue of `facultyDirectoryRegistry.ts`: a
 * declarative map of Yale's cross-cutting research centers and institutes, each
 * annotated with which `DEFAULT_CENTER_CONFIGS` entry (if any) already ingests
 * its roster. It drives the coverage program - entries with status `gap` are
 * candidates for a new per-center config, `partial` entries are only
 * fractionally covered (e.g. their faculty are captured via a shared roster but
 * the center has no standalone entity), and `covered` entries are wired.
 *
 * These `url` values are crawl ENTRY POINTS (a center's own people/members page,
 * or its homepage when no people page exists). A center's OWN people page is a
 * legitimate provenance source for that center, but the university-wide
 * directory ROOT (`research.yale.edu/centers-institutes`) and faceted index
 * roots are never persisted as a Source/Observation citation, per the
 * self-referential / listing-index source guards (see #516 / #549 / #560). The
 * registry exists for planning and reporting; it does not itself change scraper
 * behavior.
 *
 * Scope: this enumerates Yale's Provost-purview university-wide centers and
 * institutes (`research.yale.edu/centers-institutes`), every wired center, and
 * the highest-ROI evaluated gaps from Yale's broader comprehensive list
 * (`yale.edu/about-yale/centers-institutes`). The long tail of clinical,
 * area-studies, and single-department micro-centers on the comprehensive list is
 * intentionally not yet enumerated and is the remaining burn-down surface.
 *
 * `coveredByCenterKey` is a `centerKey` from `DEFAULT_CENTER_CONFIGS`.
 */

export type CentersInstitutesRendering = 'static' | 'js-rendered';

export type CentersInstitutesCoverageStatus = 'covered' | 'partial' | 'gap';

/**
 * ROI ranking for a student seeking research, highest first:
 *   1 university-wide flagship STEM / life-science institute (broad interdisciplinary faculty)
 *   2 university-wide cross-cutting institute / center (data, social science, environment, quantum)
 *   3 school-anchored research center / institute with a broad faculty roster
 *   4 specialized / clinical / area-studies research center
 *   5 humanities / arts research center
 *   6 teaching / administrative-adjacent center (low research-discovery ROI)
 */
export type CentersInstitutesImpactTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface CentersInstitutesEntry {
  /** People/members entry point, or the homepage when no people page exists. See module doc. */
  url: string;
  centerName: string;
  /** Empty string when the center is cross-school (most institutes). */
  school: string;
  rendering: CentersInstitutesRendering;
  status: CentersInstitutesCoverageStatus;
  studentImpactTier: CentersInstitutesImpactTier;
  /** `centerKey` in `DEFAULT_CENTER_CONFIGS` that ingests this roster, when wired. */
  coveredByCenterKey?: string;
  /** Approximate member/faculty count observed on the live page (rounded). */
  approxMemberCount?: number;
  /** True when the listing spans multiple pages (`?page=N`, Load More, etc.). */
  paginated?: boolean;
  notes?: string;
}

export const CENTERS_INSTITUTES_REGISTRY: CentersInstitutesEntry[] = [
  // ---- Tier 1: university-wide flagship STEM / life-science institutes -------------
  {
    url: 'https://qbio.yale.edu/members',
    centerName: 'Quantitative Biology Institute (QBio)',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'qbio',
    approxMemberCount: 37,
    notes:
      'Wired in #1297 via the shared YaleSites directory-listing-card extractor. Each card links to the member\'s own lab/profile site; members span MB&B, MCDB, EEB, Physics, Psychiatry, Medicine - a strong cross-department discovery surface.',
  },
  {
    url: 'https://wti.yale.edu/humans/faculty',
    centerName: 'Wu Tsai Institute',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wu-tsai',
    approxMemberCount: 100,
    paginated: true,
  },
  {
    url: 'https://medicine.yale.edu/cancer/research/membership/directory',
    centerName: 'Yale Cancer Center',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'yale-cancer-center',
    approxMemberCount: 400,
  },
  {
    url: 'https://westcampus.yale.edu/about-us/faculty',
    centerName: 'Yale West Campus science institutes (shared faculty directory)',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 1,
    approxMemberCount: 55,
    notes:
      'One shared faculty directory spans the West Campus science institutes named on the Provost list - Institute of Biomolecular Design & Discovery (IBDD), Cancer Biology Institute (YCBI), Microbial Sciences Institute, Energy Sciences Institute, Nanobiology Institute, Systems Biology Institute. The static HTML does not partition faculty by institute (only directors are labeled), so it cannot yield per-institute rosters; not wired to avoid minting a single campus-wide umbrella entity that misrepresents six distinct institutes. Reference-card theme - a bespoke per-institute crawl (or an LLM affiliation split) is the burn-down path.',
  },

  // ---- Tier 2: university-wide cross-cutting institutes / centers ------------------
  {
    url: 'https://dissc.yale.edu/about/dissc-faculty-and-staff',
    centerName: 'Data-Intensive Social Science Center (DISSC)',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'dissc',
    approxMemberCount: 25,
    notes:
      'Wired in #1297 via the shared YaleSites reference-card extractor. ~12 cross-department faculty directors/affiliates (Environment, Anthropology, Linguistics, Political Science, SOM, Public Health, Psychology, Law, Economics, Sociology) plus data-team/admin staff; the staff rows do not resolve to a research User and are dropped by the materializer resolve-or-skip gate.',
  },
  {
    url: 'https://quantuminstitute.yale.edu/people/members',
    centerName: 'Yale Quantum Institute (YQI)',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'yale-quantum-institute',
    approxMemberCount: 33,
  },
  {
    url: 'https://egc.yale.edu/people/faculty',
    centerName: 'Cowles Foundation for Research in Economics',
    school: 'Yale Faculty of Arts and Sciences',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'cowles',
    paginated: true,
    notes:
      'The wired `cowles` config crawls the shared FAS Economics node-teaser roster hosted on egc.yale.edu; the Economic Growth Center (EGC) faculty are ingested from the same page and do not get a standalone EGC entity.',
  },
  {
    url: 'https://tobin.yale.edu/people',
    centerName: 'Tobin Center for Economic Policy',
    school: 'Yale Faculty of Arts and Sciences',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'tobin',
    paginated: true,
  },
  {
    url: 'https://isps.yale.edu/team/directory/faculty-fellows',
    centerName: 'Institution for Social and Policy Studies (ISPS)',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'isps',
    paginated: true,
  },
  {
    url: 'https://macmillan.yale.edu/people',
    centerName: 'MacMillan Center for International and Area Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'macmillan',
    paginated: true,
  },
  {
    url: 'https://fds.yale.edu/people/',
    centerName: 'Yale Institute for Foundations of Data Science (FDS)',
    school: '',
    rendering: 'js-rendered',
    status: 'gap',
    studentImpactTier: 2,
    notes:
      'The people page is a WordPress "member filtering" block hydrated client-side; the static HTML carries no member cards. Needs a headless render (renderedFetch) before an extractor can read it.',
  },
  {
    url: 'https://naturalcarboncapture.yale.edu/people',
    centerName: 'Yale Center for Natural Carbon Capture',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 2,
    approxMemberCount: 40,
    notes:
      'Reference-card people page, but it mixes leadership + affiliated-faculty cards with non-person content cards; needs person-card scoping (subheading/role gate) before the shared reference-card extractor can be pointed at it safely.',
  },

  // ---- Tier 3: school-anchored research centers / institutes ----------------------
  {
    url: 'https://medicine.yale.edu/genetics/research/ycga/people/',
    centerName: 'Yale Center for Genome Analysis (YCGA)',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredByCenterKey: 'ycga',
    approxMemberCount: 22,
  },
  {
    url: 'https://yibs.yale.edu/people/faculty-affiliates',
    centerName: 'Yale Institute for Biospheric Studies (YIBS)',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    approxMemberCount: 65,
    notes:
      'Affiliate overlap with FAS/YSE departments; also tracked in facultyDirectoryRegistry. May surface via yale-research-official discovery.',
  },
  {
    url: 'https://cie.research.yale.edu/people',
    centerName: 'Center for Industrial Ecology',
    school: 'Yale School of the Environment',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    approxMemberCount: 7,
    notes:
      'Drupal views-field roster (the existing viewsFieldNameExtractor may fit). Likely overlaps yse-centers-index coverage; verify net-new headcount before wiring.',
  },
  {
    url: 'https://geospatial.yale.edu/people',
    centerName: 'Yale Center for Geospatial Solutions',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    notes:
      'Reference-card theme but the people page shows only a few leadership highlights, not a full affiliated-faculty roster; low net-new headcount.',
  },
  {
    url: 'https://medicine.yale.edu/kavli/',
    centerName: 'Kavli Institute for Neuroscience',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    notes:
      'No dedicated public people page found (/people, /people/ 404); the homepage is the only entry point. Members overlap heavily with Neuroscience/YSM faculty.',
  },

  // ---- Tier 4: specialized / clinical / area-studies research centers --------------
  {
    url: 'https://jackson.yale.edu/centers-initiatives/',
    centerName: 'Jackson School of Global Affairs (centers index)',
    school: 'Jackson School of Global Affairs',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'jackson-centers',
    notes:
      'A meta-index page: each child center becomes its own ResearchGroup, not a member roster.',
  },
  {
    url: 'https://envirocenter.yale.edu/',
    centerName: 'Yale Center for Environmental Law & Policy',
    school: 'Yale Law School',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    notes:
      'People page path not found under /people or /about/people; the homepage is the only verified entry point. Needs directory-path discovery before wiring.',
  },

  // ---- Tier 5: humanities / arts research centers ---------------------------------
  {
    url: 'https://whc.yale.edu/people/our-people',
    centerName: 'Whitney Humanities Center',
    school: 'Yale Faculty of Arts and Sciences',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 5,
    coveredByCenterKey: 'whitney-humanities',
  },

  // ---- Tier 6: teaching / administrative-adjacent centers -------------------------
  {
    url: 'https://ipch.yale.edu/people',
    centerName: 'Institute for the Preservation of Cultural Heritage (IPCH)',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    approxMemberCount: 16,
    notes:
      'On the Provost-purview list and exposes a clean directory-listing-card roster, but its people are predominantly preservation/conservation and administrative staff (Program Managers, Postgraduate Associates, Lab Assistants), not research faculty a student would seek; low research-discovery ROI, deferred rather than dropped.',
  },
  {
    url: 'https://poorvucenter.yale.edu/',
    centerName: 'Poorvu Center for Teaching and Learning',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 6,
    notes:
      'Teaching-and-learning support center; on the Provost list but not a research-faculty home. Recorded as evaluated-and-skipped.',
  },
];

export function getCentersInstitutesByStatus(
  status: CentersInstitutesCoverageStatus,
): CentersInstitutesEntry[] {
  return CENTERS_INSTITUTES_REGISTRY.filter((entry) => entry.status === status);
}

/**
 * Uncovered centers (status `gap` or `partial`), ranked by student research ROI:
 * impact tier first, then approximate member count.
 */
export function getCenterCoverageGaps(): CentersInstitutesEntry[] {
  return CENTERS_INSTITUTES_REGISTRY.filter((entry) => entry.status !== 'covered').sort((a, b) => {
    if (a.studentImpactTier !== b.studentImpactTier) {
      return a.studentImpactTier - b.studentImpactTier;
    }
    return (b.approxMemberCount ?? 0) - (a.approxMemberCount ?? 0);
  });
}
