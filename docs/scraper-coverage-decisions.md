# Scraper Coverage Decisions

Status: canonical record of what is deliberately not scraped, and why

Last updated: 2026-09-22

## What this file is for

A source that was evaluated and rejected leaves no trace in the code, because the outcome of the evaluation was that no config was written.
Nothing in `registry.ts` or `seedSources.ts` records that `ipch.yale.edu/people` was read and judged to be a conservation-staff directory rather than a research-faculty roster, so the next session that scans the Provost's list of centers finds it looking exactly like an unevaluated gap.

These decisions were held in five in-code coverage registries (`facultyDirectoryRegistry`, `centersInstitutesRegistry`, `departmentUndergradResearchSourceRegistry`, `fellowshipProgramSourceRegistry`, `humanitiesCollectionsSourceRegistry`), which were deleted as dead code because nothing but their own tests read them.
They then lived in issue #2040 alone, and an issue body is not where the task loop in `AGENTS.md` sends an agent looking.
Two of the rows below carry two evaluation numbers rather than one (#1376 then #1474) because that is exactly what happened.

So this file is the durable home.
It records decisions, not coverage.
**The registered scrapers remain the only source of truth for what is covered**; `registry.ts`, the per-lane configs, and `seedSources.ts` answer "is this scraped", and this file answers only "was this considered and set aside".

## Do not re-investigate without new information

Each row below was read against its live site and rejected on the merits.
Re-opening one needs a new fact about the source, not a fresh look at the same page.

### Yale-affiliated independent institutes with no Yale-hosted research roster

- **Haskins Laboratories**, `haskinslabs.org/people` (`haskins.yale.edu` 302-redirects there).
  The directory is client-rendered and links each scientist to their home institution's profile rather than a Haskins-hosted one.
  Three people resolve to Yale profiles and all three are existing YSM faculty already covered by `ysm-faculty-directory`; the rest route to profiles outside the Yale product scope.
  No net-new Yale research homes, and no Haskins-hosted profile URL to cite.
- **John B. Pierce Laboratory**, `jbpierce.org/directory/`.
  The directory lists administrative, business-office and board staff only.
  It exposes no research scientists, no per-person profile links and no lab pages, so there is no research people or lab content to ingest.
  Pierce research faculty are dual-appointed at Yale and surface through their Yale departmental appointments.

### Service and support units that are not research homes

- **Yale Center for Clinical Investigation**, `medicine.yale.edu/center-clinical-investigation/`.
  Yale's CTSA clinical and translational research support infrastructure.
  It publishes no A-Z research-faculty roster (`/people` and `/faculty` 404); the only public people surface is `/about/leadership/`, a prose page of regulatory, biostatistics and research-services directors.
  The fail-closed principle for service and administrative units keeps it out of student discovery until a genuine research-faculty roster appears.
- **Institute for the Preservation of Cultural Heritage**, `ipch.yale.edu/people`.
  On the Provost's purview list and publishes a clean directory-listing-card roster, so it looks wireable.
  Its people are predominantly preservation and conservation staff, program managers, postgraduate associates and lab assistants rather than research faculty a student would seek out.
- **Poorvu Center for Teaching and Learning**, `poorvucenter.yale.edu`.
  A teaching-and-learning support center.
  On the Provost's list, not a research-faculty home.

### A shared directory that cannot partition its own membership

- **Yale West Campus science institutes**, `westcampus.yale.edu/about-us/faculty`.
  One shared faculty directory spans six science institutes and the static HTML labels only directors, so it cannot yield per-institute rosters.
  Scraping it would mint a single campus-wide umbrella entity that misrepresents six distinct institutes.
  The six institutes are covered instead through their own member-labs subpages, which do partition membership: `wc-nanobiology`, `wc-biomolecular-design`, `wc-energy-sciences`, `wc-systems-biology`, `wc-microbial-sciences`, `wc-cancer-biology`.

### A gated application portal, which is a link and never a fetch target

- **`yale.communityforce.com`**.
  `isProgramApplicationPortalUrl` classifies CommunityForce URLs as `applicationLink` evidence carried on the fellowship they belong to.
  The portal itself is gated and exposes no crawlable catalog.

## Covered indirectly, standalone roster deferred

These two have a covered entity and an un-ingested roster.
The deferral is about duplicate risk, not about difficulty.

- **Yale Institute for Biospheric Studies**, `yibs.yale.edu/people/faculty-affiliates`.
  Its roughly 78 faculty affiliates are enriched onto their existing home-department entities through the `departmentRosterScraper` field-collection person extractor in `officialProfileOnly` mode.
  Affiliates are cross-listed with FAS and YSE, so a standalone center roster would mint duplicates beside the entities the enrichment already reaches.
  YIBS therefore has no member roster of its own here, by choice.
- **Center for Industrial Ecology**, `cie.research.yale.edu/people`.
  `yse-centers-index` already mints the CIE entity, so a `center-*` config would duplicate it.
  The roster is a seven-person Drupal views-field list whose names use a linkless `<strong class="field-content">` variant carrying no profile URLs, which is not the `a.username` shape `viewsFieldNameExtractor` reads, and several of the seven are already reachable through other YSE and FAS rosters.
  Net-new faculty a student could not otherwise reach is roughly zero to two, against a real duplicate-entity risk.

## Open gaps, and what each is actually blocked on

Most of these are blocked on discovering a viable public roster path, not on writing an extractor.
A 404, a client-rendered page or a post-reorg URL is the blocker; treat "find the roster path" as the task.

- **Yale Center for Geospatial Solutions**, `geospatial.yale.edu/people`.
  The people page shows a few leadership highlights rather than a full affiliated-faculty roster, and the leadership shown already surfaces through other rosters.
  Deferred until a full-roster path is found; a leadership-only config is not worth writing.
- **Kavli Institute for Neuroscience**, `medicine.yale.edu/kavli/`.
  No dedicated public people page (`/people` 404s); the homepage is the only entry point.
  Members overlap heavily with Neuroscience and YSM faculty, so the return is modest even once a path is found.
- **Yale Center for Environmental Law and Policy**, `envirocenter.yale.edu`.
  No people page under `/people` or `/about/people`; the homepage is the only verified entry point.
- **Yale Cardiovascular Research Center**, `medicine.yale.edu/cardiovascular-research-center/`.
  A flagship biomedical center with no citable public people-page path: `/cvrc`, `/cardiology` and the internal-medicine cardiology research paths all 404 after a YSM Section of Cardiovascular Medicine reorganization.
  Members overlap heavily with Internal Medicine (Cardiology), so a resolve-or-skip roster path is the target rather than a fresh entity set.
- **Center for Interdisciplinary Research on AIDS**, `cira.yale.edu`.
  A small standalone site whose `/people` path 404s, and the `ysph.yale.edu/cira` mirror answers non-browser fetches with 403.
  The investigators listing is likely a rendered directory.
- **Ethnicity, Race, and Migration senior requirement**, `erm.yale.edu/undergraduate/senior-requirement`.
  Verified live but client-rendered: the senior-requirement content, the independent-study request form and the senior-essay adviser form are all loaded by JavaScript, so the static HTML the `department-undergrad-research` lane fetches carries only navigation and footer chrome.
  Blocked on that lane gaining `renderedFetch` support.
  Wiring it into the static config beforehand would fail closed to a bare subject line.
  The department's faculty roster is separately covered at `erm.yale.edu/people/faculty`.

## Delivered since the migration

- **David Geffen School of Drama**, `drama.yale.edu/about-us/who-we-are/`.
  Listed as a gap at migration and delivered by #3013 as the `drama` lane in `departmentRosterScraper.ts`, with `dramaWhoWeAreExtractor` reading the 163 faculty rows the page publishes.
  The A-Z catalog's `/faculty/` path is the dead end that made this look unreachable: it serves an empty `#main-content` and stays empty after full hydration, so the "who we are" page is the school's only roster.
