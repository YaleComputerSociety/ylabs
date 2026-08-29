/**
 * Source coverage registry for scraper planning and admin review.
 *
 * This is a declarative map from Source.name to the artifacts/evidence each
 * source can support. It does not change scraper behavior by itself; seeded
 * Source rows persist the metadata for reporting and future coverage metrics.
 */
import type { SourceCoverageMetadata } from '../models/sourceCoverageTypes';

export const sourceCoverageRegistry = {
  'official-research-home-roster': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['ResearchEntity', 'ResearchEntityMember', 'Observation'],
    evidenceCategories: ['ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE'],
    defaultConfidence: 'HIGH',
    notes:
      'Reviewed official current-roster sections for allowlisted research homes. Disabled by default until the roster coverage/precision audit is reviewed; refresh owner is Yale Research data operations on a weekly cadence.',
  },
  'manual-admin-edit': {
    priority: 0,
    tier: 'MANUAL_OVERRIDE',
    artifactTypes: [
      'ResearchEntity',
      'EntryPathway',
      'AccessSignal',
      'ContactRoute',
      'PostedOpportunity',
      'Observation',
    ],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'JOIN_INSTRUCTIONS',
      'OFFICIAL_CONTACT_ROUTE',
      'POSTED_OPENING',
    ],
    defaultConfidence: 'HIGH',
    notes: 'Admin override channel; treated as intentionally curated, not scraper evidence.',
  },
  'manual-pi-edit': {
    priority: 0,
    tier: 'MANUAL_OVERRIDE',
    artifactTypes: ['ResearchEntity', 'EntryPathway', 'ContactRoute', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'JOIN_INSTRUCTIONS', 'OFFICIAL_CONTACT_ROUTE'],
    defaultConfidence: 'HIGH',
    notes: 'PI edits should remain protected by manual locks where appropriate.',
  },
  'research-entity-cache-backfill': {
    priority: 1,
    tier: 'DERIVED_OFFICIAL',
    artifactTypes: ['Observation', 'EntryPathway', 'AccessSignal'],
    evidenceCategories: ['UNDERGRAD_ROLE_LANGUAGE', 'PAST_UNDERGRADS', 'JOIN_INSTRUCTIONS'],
    defaultConfidence: 'LOW',
    notes:
      'One-time provenance recovery from legacy ResearchEntity undergraduate-access cache fields; use only to bridge old scalar cache data into first-class access artifacts.',
  },
  'lab-microsite-description-llm': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['LAB_WEBSITE', 'TOPICS', 'METHODS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Official microsite description extraction for research focus, questions, methods, and conservative areas only; must not create access, route, or opportunity evidence.',
  },
  'research-area-source-extractor': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Observation'],
    evidenceCategories: ['LAB_WEBSITE', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Deterministic research-area recovery for empty-area research entities from their official lab/department/profile pages. Emits only approved TaxonomyTerm areas (fail-closed); never creates access, route, description, or identity evidence.',
  },
  'center-affiliation-llm': {
    priority: 2,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'LAB_WEBSITE'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Reads an official center/institute page and emits umbrella → faculty relationship observations for faculty explicitly named on the page. Relationship-only; the materializer resolves each name to an existing lab/faculty entity or skips it (never mints entities or member rows).',
  },
  'center-director-llm': {
    priority: 2,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'ENTITY_MEMBERSHIP'],
    defaultConfidence: 'MEDIUM',
    notes:
      "Reads an organizational home's official site + leadership pages and emits an entity-level inferred-director observation. The materializer resolves the named director to a unique Yale User before promoting them to a `director` member (skips unresolved/ambiguous names; never mints a lead).",
  },
  'lab-microsite-undergrad-llm': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: [
      'EntryPathway',
      'AccessSignal',
      'ContactRoute',
      'UndergraduateLogisticsClaim',
      'Observation',
    ],
    evidenceCategories: [
      'LAB_WEBSITE',
      'JOIN_INSTRUCTIONS',
      'UNDERGRAD_ROLE_LANGUAGE',
      'OFFICIAL_CONTACT_ROUTE',
      'APPLICATION_LINK',
      'CONSTRAINTS',
      'PAST_UNDERGRADS',
      'UNDERGRAD_STUDENT_LEVEL',
      'UNDERGRAD_COMPENSATION',
      'UNDERGRAD_TIME_COMMITMENT',
      'UNDERGRAD_MODALITY',
      'UNDERGRAD_CURRENT_AVAILABILITY',
    ],
    defaultConfidence: 'MEDIUM',
    notes:
      'Bounded lab/faculty microsite extraction from canonical ResearchEntity websites; evidence remains public-page quotes and source URLs.',
  },
  'lab-microsite-llm': {
    priority: 1,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['ResearchEntity', 'AccessSignal', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'LAB_WEBSITE',
      'TOPICS',
      'METHODS',
      'JOIN_INSTRUCTIONS',
      'OFFICIAL_CONTACT_ROUTE',
    ],
    defaultConfidence: 'MEDIUM',
    notes: 'General lab microsite extraction used for entity context and access hints.',
  },
  'dept-faculty-roster': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'EntryPathway', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'ENTITY_MEMBERSHIP',
      'OFFICIAL_PROFILE',
      'LAB_WEBSITE',
      'TOPICS',
      'METHODS',
      'OFFICIAL_CONTACT_ROUTE',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official department profile/roster joins and lab URL discovery; can also materialize guarded PI-profile fallback pathways/routes when no stronger public route exists.',
  },
  'department-undergrad-research': {
    priority: 2,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Fellowship', 'EntryPathway', 'AccessSignal', 'ContactRoute', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'TOPICS',
      'JOIN_INSTRUCTIONS',
      'UNDERGRAD_ROLE_LANGUAGE',
      'OFFICIAL_CONTACT_ROUTE',
      'APPLICATION_LINK',
      'COURSE_CREDIT',
      'SENIOR_THESIS',
      'RESEARCH_SEMINAR',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official department undergraduate research pages; every configured page materializes program records onto /programs as Fellowship records plus access/action evidence, and generic guidance must not create posted opportunities.',
  },
  'undergrad-research-posting': {
    priority: 2,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['AccessSignal', 'Observation'],
    evidenceCategories: ['POSTED_OPENING', 'APPLICATION_LINK'],
    defaultConfidence: 'HIGH',
    notes:
      'Curated, public Yale undergraduate research posting/opportunity index pages. Emits a POSTED_OPENING access signal only for a fully-specified, apply-now posting: a title, a hiring research home resolvable to an existing ResearchEntity, an apply route, and a future-dated deadline (fail-closed on any missing field). Each signal carries the deadline as an expiry so it degrades out of the top-tier "Apply" state once the window closes. Must not ingest auth-gated aggregators or infer an opening from a generic lab website (#1303/#1332/#1568). Disabled by default until an operator confirms each page is reliably public on Development.',
  },
  'official-profile-enrichment': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['OFFICIAL_PROFILE', 'TOPICS', 'METHODS'],
    defaultConfidence: 'HIGH',
    notes:
      'Known official Yale profile URLs for existing faculty users; fills profile biography, research-interest, image, ORCID, and profile URL observations without creating research entities or access claims.',
  },
  'official-profile-pi-backfill': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'OFFICIAL_PROFILE', 'LAB_WEBSITE'],
    defaultConfidence: 'HIGH',
    notes:
      'Targeted official Yale profile backfill for PI/user identity, visible professor bio repair, profile-derived source descriptions, and leadership-backed research-home websites without creating access claims.',
  },
  'yale-directory': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE'],
    defaultConfidence: 'HIGH',
    notes: 'Authoritative Yale appointment metadata, not access evidence by itself.',
  },
  'yale-directory-csv': {
    priority: 3,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['ENTITY_MEMBERSHIP'],
    defaultConfidence: 'LOW',
    notes:
      'Static Yale directory CSV for coverage denominator and identity/affiliation observations only. Must not create public research entities, pathways, access signals, contact routes, or opportunities by itself.',
  },
  'ysm-atoz-index': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'LAB_WEBSITE'],
    defaultConfidence: 'HIGH',
    notes: 'YSM lab index for discovery; should not imply undergraduate access alone.',
  },
  'ysm-mesh-keyword': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['OFFICIAL_PROFILE', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale School of Medicine research-by-keyword (MeSH) directory and department index as crawl seeds for YSM faculty individual profiles. Each faculty individual profile is the cited source of governed MeSH research areas; the keyword index, department index, and every /research-profiles/?...&meshId= results page are faceted listings and are never recorded as a source. Emits research-area observations only (fail-closed on contact); never creates entities, access, routes, or opportunities.',
  },
  'ysm-faculty-directory': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale School of Medicine school-wide A-Z faculty directory and individual profile pages for researcher identity, lab-website discovery, governed research areas, and official profile prose. Each faculty individual profile is the cited source; the directory root is a crawl seed only (~14k entries, most non-research staff/trainees) and is never recorded as a source. Discovery-only; must not imply undergraduate access without a more explicit source.',
  },
  'bbs-research-track': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'OFFICIAL_PROFILE', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale Combined Program in Biological and Biomedical Sciences (BBS) nine research-track directories (medicine.yale.edu/bbs/people/<track>) as curated topical evidence for biomedical PIs. Each track slug maps to a concise research-area label grafted onto the PI existing canonical research home; each PI own /bbs/profile/<slug> individual page is the cited source (its canonical YSM profile and lab links resolve the home), and the track listing roots are crawl seeds only, never recorded as a source. Grafts research-area topics onto existing homes and mints a conservative FACULTY_RESEARCH_AREA home only when none resolves (converging on the ysm-faculty-<slug> namespace, never a duplicate shell). Fail-closed on contact; must not imply undergraduate access without a more explicit source.',
  },
  'department-research-areas': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['Observation'],
    evidenceCategories: ['TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale FAS science and quantitative department research-overview pages (physics.yale.edu/research, chem.yale.edu/research, mcdb.yale.edu/research, ...) as curated topical evidence for their faculty (the FAS analogue of bbs-research-track, #1703). Each curated research theme heading maps to a concise research-area label grafted onto the existing faculty/lab home of every faculty member listed under it, cited to that faculty member own profile URL; the research-overview page and the bare /people index are crawl seeds only, never recorded as a source. Grafts research-area topics only onto homes that uniquely resolve (fail-closed on ambiguous/unresolved names); never mints an entity, never emits contact, and must not imply undergraduate access without a more explicit source.',
  },
  'yse-centers-index': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'LAB_WEBSITE'],
    defaultConfidence: 'HIGH',
    notes: 'YSE center/program index for discovery; should not imply undergraduate access alone.',
  },
  'yse-faculty-directory': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale School of the Environment faculty directory and individual profile pages for faculty identity, research homes, research areas, and official profile prose. Each faculty individual profile is the cited source; the directory root is a crawl seed only and is never recorded as a source. Discovery-only; must not imply undergraduate access without a more explicit source.',
  },
  'centers-institutes-index': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['ENTITY_IDENTITY', 'ENTITY_MEMBERSHIP', 'OFFICIAL_PROFILE', 'TOPICS'],
    defaultConfidence: 'HIGH',
    notes:
      'Center/institute discovery and membership context; contact routes require explicit guarded route evidence.',
  },
  'yale-research-official': {
    priority: 2,
    tier: 'OFFICIAL_INDEX',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: [
      'ENTITY_IDENTITY',
      'RESEARCH_INFRASTRUCTURE',
      'TOPICS',
      'METHODS',
      'OFFICIAL_RESOURCE',
    ],
    defaultConfidence: 'HIGH',
    notes:
      'Official research.yale.edu directories for centers, institutes, cores, and infrastructure resources. Discovery-only; must not imply undergraduate access, contact routes, or posted openings without a more explicit source.',
  },
  'undergrad-fellowships-recipients': {
    priority: 4,
    tier: 'DERIVED_OFFICIAL',
    artifactTypes: ['EntryPathway', 'AccessSignal', 'Observation'],
    evidenceCategories: ['FELLOWSHIP_COMPATIBILITY', 'PAST_UNDERGRADS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Past recipient/advisor evidence supports historical participation and fellowship routes.',
  },
  'yale-college-fellowships-office': {
    priority: 4,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: [
      'Fellowship',
      'EntryPathway',
      'AccessSignal',
      'ContactRoute',
      'PostedOpportunity',
      'Observation',
    ],
    evidenceCategories: [
      'FELLOWSHIP_COMPATIBILITY',
      'APPLICATION_LINK',
      'OFFICIAL_CONTACT_ROUTE',
      'POSTED_OPENING',
    ],
    defaultConfidence: 'HIGH',
    notes: 'Authoritative fellowship program, application-cycle, and official office route source.',
  },
  'yale-reu-programs': {
    priority: 4,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Fellowship', 'Observation'],
    evidenceCategories: ['FELLOWSHIP_COMPATIBILITY', 'APPLICATION_LINK'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale-hosted NSF REU / summer research programs (e.g. the Dorrit Hoffleit Astronomy program, SUMRY). Each program\'s own official Yale page is the cited source; the NSF REU Sites directory is a non-Yale crawl seed used only to discover Yale-hosted site URLs and is never recorded as a source. Emits SUMMER_RESEARCH_PROGRAM fellowship observations (source-backed offer/eligibility/deadline and application link) that surface on the /programs catalog. Fails closed on contact data (no scraped emails; contact derived at read time) and on any non-Yale source URL.',
  },
  'yale-health-sciences-summer-programs': {
    priority: 4,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Fellowship', 'ResearchEntity', 'Observation'],
    evidenceCategories: ['FELLOWSHIP_COMPATIBILITY', 'APPLICATION_LINK'],
    defaultConfidence: 'HIGH',
    notes:
      'Yale health-sciences undergraduate summer research programs hosted across Yale School of Medicine (medicine.yale.edu), Public Health (ysph.yale.edu), Nursing (nursing.yale.edu), and their institutes/centers - the biomedical analogue of the NSF-REU lane (yale-reu-programs), on distinct non-overlapping host domains. Each program\'s own official Yale page is the cited source; Yale-owned health-sciences listing pages are crawl seeds only, used to discover individual program pages and never recorded as a source (#516/#549). The two already-covered health-sciences seed URLs owned by yale-college-fellowships-office (medicine.yale.edu/whr/training, ycmd.yale.edu summer undergraduate internships) are explicitly excluded so a program is never minted twice (#1712). Emits SUMMER_RESEARCH_PROGRAM fellowship observations (source-backed offer/eligibility/deadline and application link) that project to research entities. Fails closed on contact data (no scraped emails; contact derived at read time) and on any non-Yale source URL.',
  },
  'student-grants-database': {
    priority: 4,
    tier: 'PRIMARY_OFFICIAL',
    artifactTypes: ['Fellowship', 'ContactRoute', 'Observation'],
    evidenceCategories: ['FELLOWSHIP_COMPATIBILITY', 'APPLICATION_LINK', 'OFFICIAL_CONTACT_ROUTE'],
    defaultConfidence: 'HIGH',
    notes:
      "Yale's comprehensive officially-curated student funding catalog (studentgrants.yale.edu -> yale.communityforce.com). Browsing/detail is public; only applying requires login. Enumerates each fund from the rendered (headless) fund search and cites the fund's own /Funds/FundDetails.aspx page - never the search/index root (#516/#549). Fails closed when the rendered fetcher is disabled or the catalog degrades to a login/auth shell; contact is fail-closed (sponsoring org only, no scraped emails). Funds already linked from public fellowship pages merge via the record-specific application-link dedupe rather than duplicating. Disabled by default until an operator confirms the rendered catalog is reliably public on Development.",
  },
  'ylabs-listing': {
    priority: 5,
    tier: 'MANUAL_OVERRIDE',
    artifactTypes: ['EntryPathway', 'AccessSignal', 'PostedOpportunity'],
    evidenceCategories: ['POSTED_OPENING', 'APPLICATION_LINK'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Legacy YLabs listing rows bridged into opportunity-like records. Treat as audit seeds for scraper coverage, not proof that official scraper coverage is complete.',
  },
  'nih-reporter': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Funding activity enriches entity context but is not undergraduate-access evidence alone.',
  },
  'nsf-award-search': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Funding activity enriches entity context but is not undergraduate-access evidence alone.',
  },
  'neh-funded-projects': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'Humanities/social-science funding analogue of the NIH/NSF lanes; enriches entity context but is not undergraduate-access evidence alone.',
  },
  'federal-award-usaspending': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY'],
    defaultConfidence: 'MEDIUM',
    notes:
      'DOE/NASA/DoD Yale awards from USAspending.gov, covering physical-science and mission-agency PIs the NSF/NIH fallbacks miss. USAspending exposes no structured PI field, so a PI is only harvested when the award description embeds one inline and resolves to a single existing Yale User; awards with no extractable/resolvable PI are skipped (fail-closed, never minting a person or lab from a free-text name). Emits additive grant activity (recentGrants, recentGrantCount, fundingAgencies, lastObservedAt) only; not undergraduate-access evidence alone.',
  },
  'doe-osti': {
    priority: 6,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['ResearchEntity', 'Observation'],
    evidenceCategories: ['FUNDING_ACTIVITY', 'TOPICS'],
    defaultConfidence: 'MEDIUM',
    notes:
      'DOE physical-sciences funding activity via OSTI technical reports; enriches entity context but is not undergraduate-access evidence alone.',
  },
  'grant-corpus-synthesis-llm': {
    priority: 7,
    tier: 'THIRD_PARTY_ENRICHMENT',
    artifactTypes: ['Observation'],
    evidenceCategories: ['TOPICS', 'METHODS', 'FUNDING_ACTIVITY'],
    defaultConfidence: 'LOW',
    notes:
      'Grounded PI-level research description synthesized from the aggregated grant corpus already recorded on the entity (NIH/NSF/NEH/USASpending/DOE titles and abstracts). Derived from the funding lanes rather than an official page, so it ranks above the single-abstract grant fallback and below every official-profile source; fails closed when the output is not grounded in the grant text. Never creates access, route, opportunity, or contact evidence.',
  },
} satisfies Record<string, SourceCoverageMetadata>;

export type SourceCoverageName = keyof typeof sourceCoverageRegistry;

export function getSourceCoverage(name: string): SourceCoverageMetadata | undefined {
  return sourceCoverageRegistry[name as SourceCoverageName];
}
