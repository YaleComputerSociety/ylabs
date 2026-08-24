/**
 * Fellowship / program / undergraduate-research-pathway source registry for
 * scraper coverage planning.
 *
 * This is the fellowship/program analogue of `facultyDirectoryRegistry.ts`,
 * `centersInstitutesRegistry.ts`, and `humanitiesCollectionsSourceRegistry.ts`:
 * a declarative map of Yale's public undergraduate research fellowship /
 * funding / structured-program catalogs, each annotated with which existing
 * scraper source (if any) already ingests it. It drives the coverage program -
 * entries with status `gap` are candidates for a new per-catalog extractor,
 * `partial` entries are only fractionally covered (e.g. a hub whose landing page
 * is ingested but whose child catalog is not), `covered` entries are wired, and
 * `evaluated-skipped` entries were audited and deliberately left un-crawled
 * (their `notes` record why), so they are neither a to-do gap nor a live source.
 *
 * These `url` values are crawl ENTRY POINTS (catalog landing / index / hub
 * pages). They must never be persisted as an Observation/Source citation: every
 * emitted fellowship cites the individual program's own page, not the catalog
 * root, per the self-referential / index-page source guards (see #516 and #549).
 * The registry exists for planning and reporting; it does not itself change
 * scraper behavior (same contract as the other three registries).
 *
 * The bare `communityforce.com` portal root is recorded as `evaluated-skipped`:
 * it is treated as an application link and never a fetch target, per
 * `isProgramApplicationPortalUrl`, and is kept so it is never silently
 * re-proposed as a coverage gap. The Yale Student Grants Database
 * (`studentgrants.yale.edu` -> the CommunityForce fund catalog) is now `covered`
 * by the `student-grants-database` source, which enumerates individual funds from
 * the rendered fund search and cites each fund's own FundDetails page (#1630).
 *
 * `coveredBy` names are `Source.name` keys from `sourceCoverageRegistry`.
 */
import type { SourceCoverageName } from './sourceCoverageRegistry';

export type FellowshipProgramCoverageStatus = 'covered' | 'partial' | 'gap' | 'evaluated-skipped';

/**
 * ROI ranking for a student seeking research funding/pathways, highest first:
 *   1 university-wide funding/fellowship database (broadest breadth per crawl)
 *   2 school-wide or college-wide fellowship hub / awards index
 *   3 center / institute / department program catalog
 *   4 single named program, award, or fellowship page
 *   5 low-ROI / niche catalog
 */
export type FellowshipProgramImpactTier = 1 | 2 | 3 | 4 | 5;

export interface FellowshipProgramEntry {
  /** Catalog landing / hub entry point. Never cited as a source; see module doc. */
  url: string;
  catalogName: string;
  owningOffice: string;
  status: FellowshipProgramCoverageStatus;
  impactTier: FellowshipProgramImpactTier;
  /** Existing scraper source(s) that already cover this catalog. */
  coveredBy?: SourceCoverageName[];
  /**
   * Concrete crawl seeds when a catalog's coverage comes from directly seeding
   * several per-child pages rather than fetching the `url` planning identifier
   * itself (e.g. an aggregate listing root that is not a live page). When
   * present, these - not `url` - are the pages seeded into the scraper.
   */
  seedUrls?: string[];
  /** Approximate discoverable program count observed on the live page (rounded). */
  approxProgramCount?: number;
  notes?: string;
}

export const FELLOWSHIP_PROGRAM_SOURCE_REGISTRY: FellowshipProgramEntry[] = [
  // ---- Tier 1: university-wide funding / fellowship databases ----------------------
  {
    url: 'https://funding.yale.edu/find-funding/yale-fellowships-offered-through',
    catalogName: 'Yale Fellowships & Funding - fellowships offered through Yale (landing)',
    owningOffice: 'Yale Office of Fellowship Programs (funding.yale.edu)',
    status: 'covered',
    impactTier: 1,
    coveredBy: ['yale-college-fellowships-office'],
    notes:
      'Seeded in yaleCollegeFellowshipsOfficeScraper DEFAULT_PAGE_URLS. The full funding.yale.edu find-funding database is now also wired via the sitemap-driven individual-program-page crawl - see the funding.yale.edu/find-funding covered entry.',
  },
  {
    url: 'https://funding.yale.edu/find-funding',
    catalogName: 'Yale Fellowships & Funding - full find-funding database',
    owningOffice: 'Yale Office of Fellowship Programs (funding.yale.edu)',
    status: 'covered',
    impactTier: 1,
    coveredBy: ['yale-college-fellowships-office'],
    approxProgramCount: 200,
    notes:
      'The complete find-funding database is the broadest single fellowship acquisition surface at Yale. Its faceted search listing is JS-rendered with no crawlable static rows, so yaleCollegeFellowshipsOfficeScraper enumerates the individual program pages behind it via the funding.yale.edu sitemap (parseFundingYaleSitemapProgramUrls) and crawls each as a citable per-program source. The sitemap and every find-funding index/hub root are crawl seeds only, never cited (isFundingYaleIndexOrHubUrl; #516/#549). The crawl is bounded by a page cap.',
  },

  // ---- Tier 2: school-wide / college-wide fellowship hubs and awards indexes -------
  {
    url: 'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale',
    catalogName: 'Yale College STEM Fellowships - funding STEM opportunities at Yale (hub)',
    owningOffice: 'Yale College Office of Science & Quantitative Reasoning',
    status: 'covered',
    impactTier: 2,
    coveredBy: ['yale-college-fellowships-office'],
    approxProgramCount: 15,
    notes:
      'Seeded in DEFAULT_PAGE_URLS as a crawl-seed-only index (isIndexSeedOnlyUrl): the hub root is fetched only to discover its individual STEM program child pages via extractIndexSeedChildDetailUrls, and is never parsed into a candidate nor cited as a source (#516/#549). Each discovered child (STARS I/II, Yale College Deans Research Fellowship sciences track, Tetelman/Bates, BioMed SURF, CRISP REU, SUMRY, GSAS SURF, Herb Scarf SRO, YSEA research grants, and the two first-year/STARS pages still explicitly seeded) cites its own page. Gated communityforce.com application portals linked from the hub (Hixon, Bouchet, Humanities & Social Sciences, Global Health) stay applicationLink evidence and are never fetch targets.',
  },
  {
    url: 'https://college.yale.edu/life-at-yale/student-faculty-awards',
    catalogName: 'Yale College student-faculty awards index',
    owningOffice: "Yale College Dean's Office",
    status: 'covered',
    impactTier: 2,
    coveredBy: ['yale-college-fellowships-office'],
    approxProgramCount: 40,
    notes:
      'Wired as a crawl seed in yaleCollegeFellowshipsOfficeScraper DEFAULT_PAGE_URLS via STUDENT_FACULTY_AWARDS_INDEX_URL. The index root is fetched only to discover the individual award/prize pages linked from its primary content (extractIndexSeedChildDetailUrls); the root itself is never parsed into a candidate and never cited as a source. Each discovered child page (e.g. the Yale College Deans Research Fellowship humanities/social-sciences track, Edward A. Bouchet Undergraduate Fellows Program, Nakanishi Prize, Tetelman and Robert C. Bates fellowships) is fetched separately and cites its own page as the per-program source; a child that fails to fetch is dropped rather than cited via the index (fail closed). The Mellon Mays Undergraduate Fellowship child remains individually seeded as a Tier-4 detail page. CommunityForce and studentgrants.yale.edu links surfaced by any child stay applicationLink evidence and are never fetch targets.',
  },

  // ---- Tier 3: center / institute / department program catalogs --------------------
  {
    url: 'https://macmillan.yale.edu/fellowships-and-grants',
    catalogName: 'MacMillan Center fellowships and grants',
    owningOffice: 'MacMillan Center for International and Area Studies',
    status: 'covered',
    impactTier: 3,
    coveredBy: ['yale-college-fellowships-office'],
    notes:
      'Covered via the dedicated MacMillan opportunity-row extractor (candidatesFromMacmillanOpportunityPage), seeded with ?page=1..3 pagination in DEFAULT_PAGE_URLS. Council-level undergraduate research / senior-essay grant pages hosted by individual MacMillan area-studies councils are a separate gap.',
  },
  {
    url: 'https://macmillan.yale.edu/undergraduate-research-grants',
    catalogName: 'MacMillan council-level undergraduate research / senior-essay grants',
    owningOffice: 'MacMillan Center area-studies councils',
    status: 'covered',
    impactTier: 3,
    coveredBy: ['yale-college-fellowships-office'],
    approxProgramCount: 20,
    seedUrls: [
      'https://macmillan.yale.edu/latam/student-grants-and-prizes',
      'https://macmillan.yale.edu/southasia/undergraduate-grants',
      'https://macmillan.yale.edu/europe/student-grants-and-fellowships',
      'https://macmillan.yale.edu/reees/grants-and-fellowships-undergraduate-students',
      'https://macmillan.yale.edu/southeast-asia/grants-students',
      'https://macmillan.yale.edu/eastasia/fellowships-grants',
    ],
    notes:
      'Individual MacMillan councils (Latin American & Iberian Studies, South Asian Studies, European Studies, Russian/East European/Eurasian Studies, Southeast Asia Studies, East Asian Studies) publish their own undergraduate research / senior-essay grant pages beyond the central fellowships-and-grants catalog. The aggregate undergraduate-research-grants slug is not a live listing page (it redirects to site search), so it is registered as a never-cite index root (isIndexSeedOnlyUrl) and coverage comes from directly seeding each council grant page in yaleCollegeFellowshipsOfficeScraper via MACMILLAN_COUNCIL_GRANT_PAGE_URLS (see seedUrls). Each council grant page is parsed by the generic public-page detail extractor and cites its own canonical page as the per-program source (#516/#549). CommunityForce and studentgrants.yale.edu links surfaced by any council page stay applicationLink evidence and are never fetch targets. The African Studies and Middle East councils are deferred: their grant landing H1s are too generic (bare "Fellowships") to mint a specific program and are correctly dropped by the generic-title guard.',
  },
  {
    url: 'https://cbey.yale.edu/funding-opportunities',
    catalogName: 'Center for Business and the Environment at Yale - funding opportunities',
    owningOffice: 'Yale Center for Business and the Environment (CBEY)',
    status: 'covered',
    impactTier: 3,
    coveredBy: ['yale-college-fellowships-office'],
    notes:
      'Covered via the dedicated CBEY program-row extractor (candidatesFromCbeyFundingPage) seeded in DEFAULT_PAGE_URLS.',
  },
  {
    url: 'https://wti.yale.edu/initiatives/undergraduate',
    catalogName: 'Wu Tsai Institute undergraduate initiatives',
    owningOffice: 'Wu Tsai Institute',
    status: 'covered',
    impactTier: 3,
    coveredBy: ['yale-college-fellowships-office'],
    notes: 'Seeded in DEFAULT_PAGE_URLS; parsed by the generic public-page detail/catalog extractor.',
  },

  // ---- Tier 4: single named programs / awards / department pathways ----------------
  {
    url: 'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
    catalogName: 'Mellon Mays Undergraduate Fellowship Program',
    owningOffice: "Yale College Dean's Office",
    status: 'covered',
    impactTier: 4,
    coveredBy: ['yale-college-fellowships-office'],
    notes:
      'Seeded in DEFAULT_PAGE_URLS. yaleCollegeFellowshipsOfficeScraper carries MOVED_YALE_COLLEGE_FINANCIAL_AWARD_URLS remapping the retired yalecollege.yale.edu financial-awards path to this canonical college.yale.edu URL.',
  },
  {
    url: 'https://medicine.yale.edu/whr/training/',
    catalogName: "Women's Health Research at Yale - training and fellowships",
    owningOffice: "Yale School of Medicine - Women's Health Research",
    status: 'covered',
    impactTier: 4,
    coveredBy: ['yale-college-fellowships-office'],
    notes: 'Seeded in DEFAULT_PAGE_URLS; parsed by the generic public-page detail extractor.',
  },
  {
    url: 'https://ycmd.yale.edu/education/summer-undergraduate-internships',
    catalogName: 'Yale Center for Molecular Discovery - summer undergraduate internships',
    owningOffice: 'Yale Center for Molecular Discovery',
    status: 'covered',
    impactTier: 4,
    coveredBy: ['yale-college-fellowships-office'],
    notes: 'Seeded in DEFAULT_PAGE_URLS; parsed by the generic public-page detail extractor.',
  },
  {
    url: 'https://economics.yale.edu/undergraduate/tobin-ra',
    catalogName: 'Tobin Research Assistant Program (Economics)',
    owningOffice: 'Yale Department of Economics / Tobin Center for Economic Policy',
    status: 'covered',
    impactTier: 4,
    coveredBy: ['yale-college-fellowships-office'],
    notes: 'Seeded in DEFAULT_PAGE_URLS; parsed by the generic public-page detail extractor.',
  },
  {
    url: 'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
    catalogName: 'Computer Science Research Internship Program',
    owningOffice: 'Yale School of Engineering & Applied Science - Computer Science',
    status: 'covered',
    impactTier: 4,
    coveredBy: ['yale-college-fellowships-office'],
    notes: 'Seeded in DEFAULT_PAGE_URLS; parsed by the generic public-page detail extractor.',
  },

  // ---- Evaluated and skipped: gated application portals (never fetch targets) ------
  {
    url: 'https://yale.communityforce.com/',
    catalogName: 'CommunityForce application portal',
    owningOffice: 'Yale (third-party CommunityForce application platform)',
    status: 'evaluated-skipped',
    impactTier: 5,
    notes:
      'Gated application portal. Treated as an application link, never a fetch target, per isProgramApplicationPortalUrl. CommunityForce URLs are carried as applicationLink evidence on the fellowships they belong to; the portal itself exposes no crawlable catalog. Recorded as evaluated-and-skipped rather than a coverage gap.',
  },
  {
    url: 'https://studentgrants.yale.edu/',
    catalogName: 'Yale Student Grants Database',
    owningOffice: 'Yale (studentgrants.yale.edu / CommunityForce catalog)',
    status: 'covered',
    impactTier: 1,
    coveredBy: ['student-grants-database'],
    notes:
      "Yale's most comprehensive officially-curated student funding catalog. studentgrants.yale.edu 301-redirects to yale.communityforce.com, whose fund search is public and browseable (only applying requires login). Covered by the student-grants-database source, which enumerates each fund from the rendered (headless) fund search and cites the fund's own /Funds/FundDetails.aspx detail page - never the search/index root (#516/#549). The bare CommunityForce portal root stays evaluated-skipped as an application-only host.",
  },
];

export function getFellowshipProgramCatalogsByStatus(
  status: FellowshipProgramCoverageStatus,
): FellowshipProgramEntry[] {
  return FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.filter((entry) => entry.status === status);
}

/**
 * Actionable uncovered catalogs (status `gap` or `partial`), ranked by student
 * research ROI: impact tier first, then approximate discoverable program count.
 * `evaluated-skipped` catalogs are intentionally excluded because they were
 * audited and deliberately left un-crawled, so they are not a coverage to-do.
 */
export function getFellowshipProgramCatalogGaps(): FellowshipProgramEntry[] {
  return FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.filter(
    (entry) => entry.status === 'gap' || entry.status === 'partial',
  ).sort((a, b) => {
    if (a.impactTier !== b.impactTier) {
      return a.impactTier - b.impactTier;
    }
    return (b.approxProgramCount ?? 0) - (a.approxProgramCount ?? 0);
  });
}

/**
 * Catalogs audited and deliberately left un-crawled (their `notes` record the
 * rationale). Kept distinct from gaps so evaluated portals are never silently
 * dropped nor re-proposed as coverage work.
 */
export function getEvaluatedSkippedFellowshipCatalogs(): FellowshipProgramEntry[] {
  return FELLOWSHIP_PROGRAM_SOURCE_REGISTRY.filter((entry) => entry.status === 'evaluated-skipped');
}
