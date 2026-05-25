# Product Context

## North Star

Yale Research makes the hidden undergraduate research ecosystem legible: where formal openings exist, where credible pathways exist, and how students can move from curiosity to a specific, evidence-based next step.

The product is not a simple "find lab openings" job board. It should help Yale students discover and navigate real paths into research, including paths that are not formally posted.

In product shorthand: Yale Research helps students move from curiosity to a credible research home and next step. That relationship may later be formalized as course credit, paid RA work, fellowship-funded research, thesis advising, or an active posted opportunity. Some structured fellowships are exceptions because they match or place students with mentors and therefore also function as discovery programs.

## Product Premise

Undergraduate research at Yale is decentralized. Students first need to identify plausible research homes: labs, faculty projects, centers, archives, collections, digital humanities initiatives, RA programs, institutes, mentor-matching fellowship programs, and adviser-like research areas. Once a home and supervisor are plausible, the relationship may be formalized through paid roles, course credit, volunteer arrangements, fellowships, senior essays, work-study, center programs, lab-manager coordination, faculty supervision, or posted opportunities. STEM often looks like faculty-led labs; humanities often looks like faculty projects, collections work, digital humanities, or fellowship-supported independent work; social science and economics often mix project teams, centers, thesis advising, and term-specific RA programs.

The app should make this ecosystem navigable without forcing every discipline into a lab-opening model.

## Primary Surfaces

### Yale Research

Curiosity-first search and browsing of what exists:

- labs
- centers
- institutes
- faculty research areas
- faculty projects
- digital humanities initiatives
- collections/archive projects
- RA programs
- fellowship programs
- course sequences
- thesis-adviser-like research areas

This is the primary authenticated student front door at `/research`. It should support search by topic, method, professor, department, or question and return a single ranked stream of research homes, even when no active position is posted. Pathway data should enrich these cards as "Ways in", evidence, and next-step badges rather than become a competing top-level search choice.

### Programs & Fellowships

Structured applications and recurring programs live at `/programs`:

- fellowship cycles
- center internships
- recurring programs
- summer research programs
- mentor-matching or cohort research programs

Most fellowships fund or formalize a project after a student has a plausible research home. Some programs directly organize mentor matching, cohorts, internships, or hosted summer research and can be an entry route in their own right. Student-facing copy should call this surface "Programs & Fellowships"; `/fellowships` is a temporary redirect/compatibility alias.

The Programs & Fellowships planner should group records by what a student can do next: apply now, join a structured research program, use funding after mentor/home fit, plan a likely next cycle, or review archived/low-fit records. Journey labels should make mentor-first funding distinct from mentor-matching programs so students do not mistake a grant for a research placement.

### Ways In

Practical filtering by how a student might participate:

- paid
- credit-eligible after mentor/home fit
- summer
- fellowship funding or structured fellowship program
- volunteer
- thesis
- beginner-friendly
- hours per week
- work-study
- Python/coding
- archival research
- wet lab
- social science data
- digital humanities
- policy research

This route data should emphasize concrete next steps toward a plausible research home without becoming a separate student search destination. "Pathways" remains valid internal, saved, advising, and route-comparison vocabulary, but the student-facing search loop should surface it inside Yale Research as ways-in badges, evidence, best-next-step hints, and posted-opportunity CTAs. Generic official-profile fallbacks, faculty-profile-only routes, and thin "maybe outreach" records belong on Research detail pages as evidence or possible outreach signals, not as standalone results. Course credit is not itself an entry pathway; it is a formalization option after the student has found a research home and mentor. Fellowship funding is usually also formalization after mentor/home fit, but a fellowship that matches students with mentors or runs a cohort research program can be a pathway in its own right. Only call something an open or posted opportunity when there is a real active or time-bound posting.

## Navigation Shape

Current student-facing surfaces:

- `/`: authenticated default redirect to `/research`.
- `/research`: Yale Research, the primary experience for research entities, enriched with pathway evidence and ways-in badges even when no opening exists.
- `/programs`: Programs & Fellowships, the canonical structured application and recurring-program surface.
- `/research/:slug`: show what the entity does, who is involved, evidence of undergraduate access, pathways, contact routes, and related labs/groups when the entity is an umbrella institute or center.
- `/opportunities/:id`: show real active/time-bound postings only. These must be backed by `PostedOpportunity`.
- `/account`: saved research plans, saved programs, notes, checklist progress, and planning context.

The hard-pivot migration removes `/labs` as a runtime compatibility surface; `/research` is the canonical Yale Research route. `/pathways` is retired as a public client route and redirects to `/research`. `/fellowships` redirects to `/programs` while compatibility callers migrate.

Implementation note: route search remains an internal service capability through `EntryPathway` and pathway search services, but `POST /api/pathways/search` is no longer part of the public/client contract. Research cards get ways-in enrichment from `POST /api/research/search`, research detail still uses internal pathway data, and saved planning hydrates via user saved-research-plan APIs. Listing-derived rows, official-profile-only fallbacks, and weak generic exploratory outreach are not standalone student results, while real active openings remain posted opportunities. `/opportunities/:id` should not render generic exploratory pathways.

Implementation note: `/listings` is retired as a public UI route and direct visits redirect to `/research`; `/api/listings` returns `410 Gone`. The Beta `listings` collection has been dropped, and legacy listing-derived artifacts are archived or deleted rather than used as runtime evidence. Public contact CTAs should prefer guarded route URLs and official channels over raw emails. Student-facing primary navigation should use Yale Research, Programs & Fellowships, and Dashboard; active openings are discovered as pathway enrichments on Research cards and through `/opportunities/:id`.

Implementation note: umbrella entities such as Yale Quantum Institute, Wu Tsai Institute, and Yale Cancer Center should behave as hubs. Their detail pages may show related labs, research groups, hosted programs, or faculty research areas through `ResearchEntityRelationship`, but affiliation alone is not undergraduate-access evidence and must not create an Apply CTA or posted opportunity.

## Current Product Snapshot

Playwright verification on 2026-05-24 matched this shape:

- `/research` is titled `Yale Research`, leads with topic-first Yale Research discovery copy, shows quick-start prompts such as `Machine learning`, `Neuroscience`, `Climate change`, `Ancient DNA`, `Digital archives`, and `Quantum materials`, and opens with roughly 2,720 indexed profiles in the current development dataset.
- A `machine learning` search returns a single research-home stream with profile cards, topic/method badges, descriptions, a count such as `24 research homes, 5 ways in`, and `View profile` as the primary action.
- `/research/:slug` pages lead with the research-home type, evidence level, the `Student decision` summary, `What this lab studies`, reach-out status, recommended next step, lead/PI context when known, profile status, and source links.
- `/programs` is titled `Programs & Fellowships | Yale Research` and behaves as a cycle planner: open now, closing soon, likely next cycle, and planning archive.
- `/account` is titled `Dashboard | Yale Research` and behaves as the saved planning workspace for research plans and a program watchlist.
- `/pathways` and `/listings` redirect to `/research`; `/fellowships` redirects to `/programs`.
- Desktop navigation is Yale Research, Programs & Fellowships, Dashboard. Mobile uses the compact menu and had no horizontal overflow on `/research`, `/programs`, or `/account` in the 390px Playwright pass.
- Planning implication from the 2026-05-24 consolidation pass: the product focus is no longer route shape or IA. The next leverage is data trust, semantic result quality, Programs classification/visibility, and the production gate.

## Entity Page Questions

Each research entity page should answer:

- What is this research structure?
- What does it study?
- Who leads it?
- Who might supervise undergrads day to day?
- What methods does it use?
- Have undergrads participated before?
- What related scholarly work helps a student understand the research area?
- What access evidence and practical next steps exist?
- What should the student do next?
- How might the research relationship later be formalized?
- What source verifies this?

Public person sections should stay lead-focused. Research detail pages should label the section
"Principal Investigator" and show PI/director/co-PI style leads, not broad lab rosters. Lab member
pages can still provide source evidence for access, undergrad participation, and official contact
routes, but non-lead roster names should not become student-facing people inventory by default.

Related scholarly work is a research-activity signal, not an opening or access claim. Person profiles and research-entity pages should show compact "Research Activity" or "Related Research" cards that keep DOI/publisher links as the primary scholarly record because Yale students often have library subscription access, while also showing a readable open-access full text/PDF backup when one is known. PubMed/PMC, arXiv, ORCID, or official publication pages can remain primary when no DOI/publisher page is available. Errata, table-of-contents rows, retractions, and similar publication metadata chrome should not appear as research-activity cards. OpenAlex is useful as the internal search/index layer, but should appear to students only as a fallback pointer when no better paper destination exists. Research-detail pages should distinguish the relationship evidence: direct entity-linked work can be labeled "Related Research", while PI/member-authored work should be contextual "Recent work by <professor>" unless there is separate evidence that the paper is lab-specific.

## Description Quality Bar

Use `/research/dept-psych-yarrow-dunham` as a strong example for lab description quality. Good `fullDescription` copy is the canonical source of truth: it should give students a specific sense of what the lab studies, the kinds of questions or methods involved, and why the research home is legible as a possible fit. `shortDescription` should be derived from that accepted full explanation in one or two clear sentences for quick card browsing; do not preserve generic lead sentences such as "My lab focuses on..." when later source text gives clearer questions, populations, or methods. Avoid generic one-line labels, scraped title fragments, duplicated page fragments, recruitment boilerplate, source-news snippets, or overconfident claims about access. When scraper or LLM enrichment fills descriptions, prefer evidence-backed synthesis that reads like this example: concrete enough to orient a student, restrained enough to avoid inventing openings or participation routes. LLM-generated full descriptions must be backed by an `evidenceQuote` found in the fetched official source text; never synthesize from lab name, departments, current metadata, or topic labels alone.

Description audits should be full-first: a short description is not useful when the full description is blank, synthetic, profile chrome, appointment-only copy, a role/title fragment, an incomplete sentence, duplicated page text, recruitment boilerplate, or source-news/page chrome. Short-description audits should additionally treat synthetic placeholders (`Research home connected to...`), broken templates, first-person generic leads, copied first sentences, and short text equal to the full description as browsing-quality failures. Prefer source-backed scraper repair from official lab/profile pages over deterministic profile-topic replacement when profile topics may contain publication or profile-page chrome.

When there is no real lab/entity description but there is a PI-profile fallback route, the page may show a separate PI-profile synthesis generated from official PI research interests/topics and recent scholarly-work titles. Student-facing copy should label that state as a faculty research area, not a verified lab description, and should explicitly avoid undergraduate-availability claims unless separate access evidence supports them.

## CTA Vocabulary

CTA options should depend on the access evidence, route, and current next step:

- Apply
- Ask about credit after mentor/home fit
- Find funding
- Apply to structured research program
- Contact lab manager
- Contact faculty mentor
- Contact program manager
- Plan exploratory outreach
- Save for thesis planning
- Check back later

Exploratory outreach should be specific and evidence-based. The product should not encourage students to spam faculty. Prefer official applications, program contacts, lab managers, or department routes when those exist.

Student-facing labels should use warmer language than internal model names:

- Pathways
- Ways in
- Evidence
- Best Next Step

## Saved Planning And Advising

Saved research plans are private student planning space by default. They may include thesis ideas, outreach notes, funding cues, deadlines, and checklist progress, but exports should exclude private notes unless the student explicitly opts in.

Advising-oriented sharing should use source-backed pathway context and explicit visibility choices. It should help a student discuss options with an advisor, not create mass-email or broad outreach behavior.

## Product Principles

- Exploration-first: support discovery before a student knows the exact structure they need.
- Evidence-scored: show why a pathway is credible and where the information came from.
- Pathway-aware: distinguish finding a research home from later formalization and from active postings.
- Discipline-flexible: do not make STEM lab hierarchy the universal model.
- Student-actionable: every page should help a student decide a plausible next step.
