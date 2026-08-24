/**
 * Centers / institutes source registry for scraper coverage planning.
 *
 * This is the centers/institutes analogue of `facultyDirectoryRegistry.ts`: a
 * declarative map of Yale's cross-cutting research centers and institutes, each
 * annotated with which `DEFAULT_CENTER_CONFIGS` entry (if any) already ingests
 * its roster. It drives the coverage program - entries with status `gap` are
 * candidates for a new per-center config, `partial` entries are only
 * fractionally covered (e.g. their faculty are captured via a shared roster or
 * enrichment path but the center has no standalone member roster of its own),
 * `covered` entries are wired, and `evaluated-skipped` entries were assessed and
 * deliberately kept out of the burn-down (teaching/admin centers, or pages that
 * cannot yield a per-entity faculty roster). Every `gap` row carries an explicit
 * next-step blocker in its `notes`.
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
 * institutes (`research.yale.edu/centers-institutes`), every wired center, the
 * highest-ROI evaluated gaps from Yale's broader comprehensive list
 * (`yale.edu/about-yale/centers-institutes`), and the highest-ROI named research
 * centers of the Yale School of Medicine / Yale School of Public Health
 * biomedical layer (starting with the Yale Child Study Center, #1474). The long
 * tail of single-department clinical and area-studies micro-centers is
 * intentionally not yet enumerated and is the remaining burn-down surface; only
 * flagship, broad-roster, undergrad-relevant biomedical centers are pulled
 * forward, not every clinical service unit.
 *
 * `coveredByCenterKey` is a `centerKey` from `DEFAULT_CENTER_CONFIGS`.
 */

export type CentersInstitutesRendering = 'static' | 'js-rendered';

export type CentersInstitutesCoverageStatus = 'covered' | 'partial' | 'gap' | 'evaluated-skipped';

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
      "Wired in #1297 via the shared YaleSites directory-listing-card extractor. Each card links to the member's own lab/profile site; members span MB&B, MCDB, EEB, Physics, Psychiatry, Medicine - a strong cross-department discovery surface.",
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
    status: 'evaluated-skipped',
    studentImpactTier: 1,
    approxMemberCount: 55,
    notes:
      'Evaluated in #1295 (COMPLETED). One shared faculty directory spans the six West Campus science institutes. The static HTML does not partition faculty by institute (only directors are labeled), so this shared page cannot yield per-institute rosters and stays skipped to avoid minting a single campus-wide umbrella entity that misrepresents six distinct institutes. The per-institute split #1295/#1376 deferred is now delivered in #1448: each institute exposes its own member-labs subpage that DOES partition membership, so the six institutes are wired as first-class covered rows below (wc-nanobiology, wc-biomolecular-design, wc-energy-sciences, wc-systems-biology, wc-microbial-sciences, wc-cancer-biology) rather than off this shared directory.',
  },
  {
    url: 'https://westcampus.yale.edu/institutes/yale-nanobiology-institute/yale-nanobiology-institute-research-labs',
    centerName: 'Yale Nanobiology Institute',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wc-nanobiology',
    approxMemberCount: 9,
    notes:
      "Wired in #1448 via the shared YaleSites directory-listing-card extractor pointed at the institute's own member-labs subpage (crawl entry point); the entity websiteUrl is the /institutes/yale-nanobiology-institute landing page via the config homeUrl override. Each card links to the member lab's own home (medicine.yale.edu/lab/..., campuspress.yale.edu/...), never the westcampus institutes index. Members span Cell Biology, MB&B, and Biomedical Engineering; heavy home-department overlap is expected and deduped by the materializer resolve-or-skip gate.",
  },
  {
    url: 'https://westcampus.yale.edu/institutes/yale-institute-of-biomolecular-design-and-discovery/yale-institute-of-biomolecular',
    centerName: 'Yale Institute of Biomolecular Design & Discovery',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wc-biomolecular-design',
    approxMemberCount: 7,
    notes:
      'Wired in #1448 via the directory-listing-card extractor on the institute member-labs subpage; entity websiteUrl is the /institutes/yale-institute-of-biomolecular-design-and-discovery landing page via homeUrl. Members span Chemistry and MB&B (Strobel, Crawford, Slavoff, Simon); each card cites the lab/faculty profile home.',
  },
  {
    url: 'https://westcampus.yale.edu/institutes/yale-energy-sciences-institute/yale-energy-sciences-institute-labs',
    centerName: 'Yale Energy Sciences Institute',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wc-energy-sciences',
    approxMemberCount: 15,
    notes:
      'Wired in #1448 via the directory-listing-card extractor on the institute member-labs subpage; entity websiteUrl is the /institutes/yale-energy-sciences-institute landing page via homeUrl. Members span Chemistry, Applied Physics, and Engineering (Batista, Brudvig, Ozolins, Qiu); each card cites the lab/faculty profile home.',
  },
  {
    url: 'https://westcampus.yale.edu/institutes/yale-systems-biology-institute/yale-systems-biology-institute-labs',
    centerName: 'Yale Systems Biology Institute',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wc-systems-biology',
    approxMemberCount: 11,
    notes:
      'Wired in #1448 via the directory-listing-card extractor on the institute member-labs subpage (Faculty & Researchers plus Affiliated Faculty sections); entity websiteUrl is the /institutes/yale-systems-biology-institute landing page via homeUrl. Members span MCDB, Cell Biology, Biomedical Engineering, and MB&B (Levchenko, Isaacs, MacMicking, Gerstein); each card cites the lab/faculty profile home.',
  },
  {
    url: 'https://microbialsciences.yale.edu/faculty-research',
    centerName: 'Yale Microbial Sciences Institute',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wc-microbial-sciences',
    approxMemberCount: 7,
    notes:
      "Wired in #1448 via the contentSpotlightFacultyExtractor: the institute has its own subdomain and its faculty-research page renders one content-spotlight-portrait block per faculty, whose first CTA is the PI profile (the second is the lab). Entity websiteUrl is the microbialsciences.yale.edu home via homeUrl. Members span Microbial Pathogenesis, MCDB, and EEB (Goodman, Mougous, Hatzios, Dal Bello); the /labmembers page (trainees, not PI-led labs) is deliberately not crawled.",
  },
  {
    url: 'https://westcampus.yale.edu/institutes/yale-cancer-biology-institute',
    centerName: 'Yale Cancer Biology Institute',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 1,
    coveredByCenterKey: 'wc-cancer-biology',
    approxMemberCount: 9,
    notes:
      'Wired in #1448 via the customCardLabsExtractor, section-scoped to the "Meet the labs of the Yale Cancer Biology Institute" custom-card collection on the institute landing page (which doubles as its identity website and member roster). Unlike the other five institutes this page lists membership by lab name (Alarcón Lab, Muzumdar Lab, Schlessinger Lab) rather than PI name, so member observations cite each lab home and enrich via the resolve-or-skip gate; the institute entity itself is the primary net-new research home. Sibling news/event custom-card collections are dropped by the heading gate.',
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
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'fds',
    approxMemberCount: 121,
    notes:
      'Wired via the fdsUsersGridExtractor. Contrary to the earlier gap note, the WordPress ACF "ordered users grid" roster is server-rendered in the static HTML (a ~5-card leadership/admin grid plus a ~116-card cross-department member grid), so no headless render is needed; the client-side "member filtering" block only re-sorts the already-present cards. Each card links to the member\'s own fds.yale.edu/people/<netid>/ profile; members span Statistics & Data Science, Computer Science, Mathematics, Economics, Astronomy, and Medicine. Admin/staff rows (Executive/Senior Administrative) do not resolve to a research User and are dropped by the materializer resolve-or-skip gate. The `fds` config carries an entityKey override onto `research-yale-yale-institute-for-foundations-of-data-science` so the roster enriches the umbrella entity minted by yale-research-official discovery instead of minting a duplicate `center-fds`, matching the NCC entityKey-override pattern (#1376).',
  },
  {
    url: 'https://naturalcarboncapture.yale.edu/people',
    centerName: 'Yale Center for Natural Carbon Capture',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 2,
    coveredByCenterKey: 'natural-carbon-capture',
    approxMemberCount: 40,
    notes:
      "Wired via naturalCarbonCaptureExtractor, a section-scoped variant of the YaleSites reference-card extractor (#1376, tightening the initial #1402 wiring). The people page groups faculty sections (Directors, Scientific Leadership Team, Faculty Affiliates - 40 cross-department climate/energy faculty spanning Earth & Planetary Sciences, Environment, Engineering, Chemistry, EEB, Economics) alongside non-faculty sections (Managing Director, Research Scientists, Postdoctoral Associates, administrative staff); the section-heading gate keeps only the faculty/leadership cards and drops the staff/trainee sections at extraction rather than relying solely on the materializer resolve-or-skip gate. The roster enriches the existing yse-natural-carbon-capture entity (minted earlier by yse-centers-index with 0 members) via the config entityKey override rather than minting a duplicate center-* entity. Each card links to the member's home-department profile - a strong cross-department discovery surface.",
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
    url: 'https://medicine.yale.edu/yigh/faculty-support-initiative/affiliated-faculty/',
    centerName: 'Yale Institute for Global Health (YIGH)',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredByCenterKey: 'yigh',
    notes:
      'Wired in #1334 (Tier B) via yighAffiliatedFacultyExtractor. The affiliated-faculty directory is fully static: it groups faculty into Medicine/Nursing/Public Health/University sections, each rendering a flat list of `<a href="/yigh/profile/<slug>/" class="hyperlink">Last, First</a>` links (names flipped to First Last downstream), so no rendered fetch is needed. Each row links to the member\'s YIGH profile; the roster spans the health schools and enriches cross-department discovery.',
  },
  {
    url: 'https://medicine.yale.edu/childstudy/faculty/',
    centerName: 'Yale Child Study Center (YCSC)',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 3,
    coveredByCenterKey: 'child-study-center',
    approxMemberCount: 540,
    notes:
      "Wired in #1474 as the first tranche of the YSM/YSPH named research-center layer. The faculty A-Z page is fully static: a flat `link-items-list` of `<a href=\"/childstudy/profile/<slug>/\" class=\"hyperlink\">Last, First</a>` rows (names flipped to First Last downstream), the same medicine.yale.edu directory theme as Yale Cancer Center and YIGH, so it reuses the shared profileHyperlinkDirectoryExtractor and needs no rendered fetch. The entity websiteUrl is the /childstudy/ landing page via the config homeUrl override (the roster subpage is the crawl entry point and provenance source, never persisted as the website). The broad developmental-neuroscience / child-psychiatry roster overlaps heavily with Psychiatry/Psychology/YSM home departments; the materializer resolve-or-skip gate resolves each member to their existing canonical Yale researcher and attaches the center affiliation rather than minting duplicate person entities, and non-research clinical/adjunct rows that do not resolve are dropped.",
  },
  {
    url: 'https://yibs.yale.edu/people/faculty-affiliates',
    centerName: 'Yale Institute for Biospheric Studies (YIBS)',
    school: '',
    rendering: 'static',
    status: 'partial',
    studentImpactTier: 3,
    approxMemberCount: 65,
    notes:
      'Faculty affiliates are enriched onto their existing home-department entities via the departmentRosterScraper fieldCollectionPersonExtractor (officialProfileOnly), wired in #1396 through facultyDirectoryRegistry - the affiliate-enrichment path the #1376 scoping called for, chosen because affiliates are cross-listed with FAS/YSE and a standalone center roster would mint duplicate entities. Partial rather than covered: the ~78 affiliates enrich existing entities, so YIBS has no standalone member roster of its own here.',
  },
  {
    url: 'https://cie.research.yale.edu/people',
    centerName: 'Center for Industrial Ecology',
    school: 'Yale School of the Environment',
    rendering: 'static',
    status: 'partial',
    studentImpactTier: 3,
    approxMemberCount: 7,
    notes:
      'Evaluated in #1376, not wired. yse-centers-index already mints the CIE entity (yse-industrial-ecology, linked from environment.yale.edu/research/centers), so a center-* config would duplicate it. The roster is a 7-person Drupal views-field list (Chertow, Graedel, Higgins, Lifset, Reck, Wheeler, Yao) that uses a linkless <strong class="field-content"> name variant carrying no profile URLs - not the a.username shape viewsFieldNameExtractor reads - and several are already reachable via other YSE/FAS rosters (Yuan Yao is a Natural Carbon Capture faculty affiliate). Net-new faculty a student could not otherwise reach: ~0-2. Low ROI plus the duplicate-entity risk means it stays partial (entity covered via yse-centers-index, roster not ingested) pending a dedupe-safe roster path.',
  },
  {
    url: 'https://geospatial.yale.edu/people',
    centerName: 'Yale Center for Geospatial Solutions',
    school: '',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    notes:
      'Evaluated in #1376. Reference-card theme but the people page shows only a few leadership highlights, not a full affiliated-faculty roster; low net-new headcount. Next step: defer until a full-roster path is found (the leadership shown, e.g. Jennifer Marlon, already surfaces via other rosters such as Natural Carbon Capture) - not worth a config for leadership-only.',
  },
  {
    url: 'https://medicine.yale.edu/kavli/',
    centerName: 'Kavli Institute for Neuroscience',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 3,
    notes:
      'Evaluated in #1376. No dedicated public people page found (/people, /people/ 404); the homepage is the only entry point. Next step: directory-path discovery. Members overlap heavily with Neuroscience/YSM faculty, so ROI is modest once a roster path is found.',
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
    url: 'https://macmillan.yale.edu/middleeast/people',
    centerName: 'Council on Middle East Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-middle-east',
    paginated: true,
    notes:
      'Wired in #1517. A MacMillan constituent council with its own node-teaser--person affiliate roster (shared Economics/MacMillan Drupal theme, same extractor as the top-level macmillan/people). Kept distinct from center-macmillan so its cross-department area-studies affiliates surface as a browsable Middle East home.',
  },
  {
    url: 'https://macmillan.yale.edu/eastasia/people',
    centerName: 'Council on East Asian Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-east-asian',
    paginated: true,
    notes: 'Wired in #1517. MacMillan constituent council; per-council node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/latam/people',
    centerName: 'Council on Latin American & Iberian Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-latin-american',
    paginated: true,
    notes: 'Wired in #1517. MacMillan constituent council; per-council node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/africa/people',
    centerName: 'Council on African Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-african',
    paginated: true,
    notes: 'Wired in #1517. MacMillan constituent council; per-council node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/europe/people',
    centerName: 'European Studies Council',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-european',
    paginated: true,
    notes: 'Wired in #1517. MacMillan constituent council; per-council node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/southasia/people',
    centerName: 'South Asian Studies Council',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-south-asian',
    paginated: true,
    notes: 'Wired in #1517. MacMillan constituent council; per-council node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/southeast-asia/seas-people',
    centerName: 'Council on Southeast Asia Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-southeast-asia',
    approxMemberCount: 51,
    paginated: true,
    notes:
      'Wired in #1517. MacMillan constituent council; roster lives at the /seas-people subpath rather than bare /people.',
  },
  {
    url: 'https://macmillan.yale.edu/reees/people',
    centerName: 'Council on Russian, East European, and Eurasian Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-reees',
    approxMemberCount: 24,
    paginated: true,
    notes: 'Wired in #1517. MacMillan constituent council; per-council node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/gsp/steering-committee',
    centerName: 'Genocide Studies Program',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-genocide-studies',
    approxMemberCount: 18,
    paginated: true,
    notes:
      'Wired in #1517. MacMillan program; the citable affiliate roster is the /gsp/steering-committee node-teaser--person grid (bare /gsp/people redirects).',
  },
  {
    url: 'https://macmillan.yale.edu/iranian-studies/people',
    centerName: 'Program in Iranian Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-iranian-studies',
    paginated: true,
    notes: 'Wired in #1517. MacMillan program; per-program node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/hellenic/people',
    centerName: 'Hellenic Studies Program',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-hellenic-studies',
    approxMemberCount: 21,
    paginated: true,
    notes: 'Wired in #1517. MacMillan program; per-program node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/korean-studies/korean-studies-faculty-librarians',
    centerName: 'Korean Studies at Yale',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-korean-studies',
    approxMemberCount: 12,
    paginated: true,
    notes:
      'Wired in #1517. MacMillan program; the citable roster is the /korean-studies-faculty-librarians node-teaser--person grid (bare /korean-studies/people redirects).',
  },
  {
    url: 'https://macmillan.yale.edu/eustudies/european-union-studies-people',
    centerName: 'European Union Studies Program',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-eu-studies',
    approxMemberCount: 17,
    paginated: true,
    notes:
      'Wired in #1517. MacMillan program, distinct from the broader European Studies Council; roster at /european-union-studies-people.',
  },
  {
    url: 'https://macmillan.yale.edu/baltic/people',
    centerName: 'Baltic Studies Program',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-baltic-studies',
    approxMemberCount: 18,
    paginated: true,
    notes: 'Wired in #1517. MacMillan program; per-program node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/canada/people',
    centerName: 'Committee on Canadian Studies',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-canadian-studies',
    approxMemberCount: 7,
    paginated: true,
    notes: 'Wired in #1517. MacMillan committee; small per-committee node-teaser--person affiliate roster.',
  },
  {
    url: 'https://macmillan.yale.edu/central-asia/people',
    centerName: 'Central Asia Initiative',
    school: '',
    rendering: 'static',
    status: 'covered',
    studentImpactTier: 4,
    coveredByCenterKey: 'macmillan-central-asia',
    approxMemberCount: 26,
    paginated: true,
    notes: 'Wired in #1517. MacMillan initiative; per-initiative node-teaser--person affiliate roster.',
  },
  {
    url: 'https://envirocenter.yale.edu/',
    centerName: 'Yale Center for Environmental Law & Policy',
    school: 'Yale Law School',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    notes:
      'Evaluated in #1376. People page path not found under /people or /about/people; the homepage is the only verified entry point. Next step: directory-path discovery before wiring.',
  },
  {
    url: 'https://medicine.yale.edu/center-clinical-investigation/about/leadership/',
    centerName: 'Yale Center for Clinical Investigation (YCCI)',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'evaluated-skipped',
    studentImpactTier: 4,
    notes:
      'Evaluated in #1474 and skipped. YCCI is Yale\'s CTSA clinical/translational research support infrastructure; medicine.yale.edu/ycci redirects to /center-clinical-investigation/. It exposes no A-Z research-faculty roster (/people and /faculty 404); the only public people surface is /about/leadership/, a prose leadership page of administrative/service directors (regulatory, biostatistics, research-services staff), not a broad research-faculty roster a student would browse for a lab. Per the fail-closed principle for service/administrative units it stays out of student discovery until a genuine research-faculty roster page is found.',
  },
  {
    url: 'https://medicine.yale.edu/cardiovascular-research-center/',
    centerName: 'Yale Cardiovascular Research Center (YCVRC)',
    school: 'Yale School of Medicine',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    notes:
      'Evaluated in #1474. A genuine flagship biomedical center, but no citable public people-page path was verified: /cvrc, /cardiology, and the internal-medicine/cardiology/research paths 404 on medicine.yale.edu. Next step: discover the current landing/roster path (the center moved under a YSM Section of Cardiovascular Medicine reorg) before wiring; the members overlap heavily with Internal Medicine (Cardiology), so a resolve-or-skip roster path is the target.',
  },
  {
    url: 'https://cira.yale.edu/',
    centerName: 'Center for Interdisciplinary Research on AIDS (CIRA)',
    school: 'Yale School of Public Health',
    rendering: 'static',
    status: 'gap',
    studentImpactTier: 4,
    notes:
      'Evaluated in #1474. A real HIV/AIDS interdisciplinary research center, but no clean public roster path was verified: cira.yale.edu is a small standalone site whose /people path 404s, and the ysph.yale.edu/cira mirror blocks non-browser fetches (403). Next step: discover the affiliates/investigators listing (likely a rendered directory) before wiring; scope is narrower than YCSC so it is a lower-ROI follow-up.',
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
    status: 'evaluated-skipped',
    studentImpactTier: 6,
    approxMemberCount: 16,
    notes:
      'Evaluated in #1376 and skipped. On the Provost-purview list and exposes a clean directory-listing-card roster, but its people are predominantly preservation/conservation and administrative staff (Program Managers, Postgraduate Associates, Lab Assistants), not research faculty a student would seek; low research-discovery ROI, kept out of the burn-down.',
  },
  {
    url: 'https://poorvucenter.yale.edu/',
    centerName: 'Poorvu Center for Teaching and Learning',
    school: '',
    rendering: 'static',
    status: 'evaluated-skipped',
    studentImpactTier: 6,
    notes:
      'Evaluated in #1376 and skipped. Teaching-and-learning support center; on the Provost list but not a research-faculty home.',
  },
];

export function getCentersInstitutesByStatus(
  status: CentersInstitutesCoverageStatus,
): CentersInstitutesEntry[] {
  return CENTERS_INSTITUTES_REGISTRY.filter((entry) => entry.status === status);
}

/**
 * Live coverage gaps (status `gap` or `partial`), ranked by student research
 * ROI: impact tier first, then approximate member count. `covered` and
 * `evaluated-skipped` rows are excluded - the latter were assessed and
 * deliberately kept out of the burn-down.
 */
export function getCenterCoverageGaps(): CentersInstitutesEntry[] {
  return CENTERS_INSTITUTES_REGISTRY.filter(
    (entry) => entry.status === 'gap' || entry.status === 'partial',
  ).sort((a, b) => {
    if (a.studentImpactTier !== b.studentImpactTier) {
      return a.studentImpactTier - b.studentImpactTier;
    }
    return (b.approxMemberCount ?? 0) - (a.approxMemberCount ?? 0);
  });
}
