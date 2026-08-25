# Product Context

## North Star

Yale Research is a simple, high-quality directory of Yale research.
Its two co-equal priorities are good data and good search: comprehensive, accurate discovery of labs, centers, faculty, and projects with the correct lead and official links, made findable through fast, relevant search.
The student job is to find a professor and their work and reach out, so the directory's job is to make that fast and trustworthy.
Signals are restrained, factual, source-backed enrichment that inform a student about a research home (for example that a lab is funded or has mentored undergraduates before); they never gate visibility, act as a trust score, or condition contact.
Source-backed affiliations help students understand how labs relate to centers, institutes, programs, and other research entities.

The product is not a faculty-maintained job board.
Directory coverage comes from official-source discovery and scraping rather than requiring professors to create accounts, upload profiles, or maintain duplicate listings.

In product shorthand, Yale Research is an enriched research-home directory.
It helps students move from a topic, person, method, or question to a credible research home, inspect the PI and official source, and review access context when evidence exists.
The visible directory listing is a REST projection of the research home rather than a reason to maintain a separate legacy listing record.
Posted opportunities are the active or time-bound posting subset.
Course credit, paid RA work, fellowship funding, thesis advising, and volunteer arrangements are usually later formalization options after home and mentor fit unless a structured program itself provides the entry route.

## Product Premise

Undergraduate research at Yale is decentralized.
Students first need a reliable directory of plausible research homes such as labs, faculty projects, centers, archives, collections, digital humanities initiatives, RA programs, institutes, mentor-matching fellowship programs, and adviser-like research areas.
Once a home and supervisor are plausible, the relationship may be formalized through paid roles, course credit, volunteer arrangements, fellowships, senior essays, work-study, center programs, lab-manager coordination, faculty supervision, or posted opportunities.
STEM often looks like faculty-led labs, humanities often looks like faculty projects or collections work, and social science often mixes project teams, centers, thesis advising, and term-specific RA programs.

The app should make this ecosystem navigable without forcing every discipline into a lab-opening model or forcing every directory record to have a pathway.
Organizational service, administrative, instructional-support, and publication or journalism-outlet units (for example a departmental online magazine) should stay out of student discovery unless their public description positively establishes that they conduct or organize research.

## Primary Surfaces

### Explore Research

Curiosity-first browsing of what exists:

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

This surface should support exploration even when no active position is posted.

### Planning Context

Direction note (see [`decisions.md` 2026-08-25 "Simple Directory First"](decisions.md#2026-08-25-simple-directory-first-signals-are-factual-enrichment-not-an-access-plausibility-tier)): the "Ways in", Planning Context, "Evidence", and "Best Next Step" framing across this and the following sections is retired.
The target is that signals become factual, sourced badges (funded, has mentored undergrads before, paid or credit, hours, modality, methods) shown without confidence stamps or plausibility labels; the circular "reach-out plausible" signal is deleted; topic and method descriptors move to search facets; and reaching out is the universal action, with "Apply" living on the separate programs and fellowships board.
The prose below still describes current behavior and is reframed when the code changes, not before.

Practical context for how a student might evaluate a research home, embedded inside Yale Research rather than split into a separate product surface:

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

This context is optional enrichment.
It should appear only when evidence answers a student question and should not make the directory harder to scan.
"Ways in" may describe real recurring programs, internships, mentor-matching programs, and official application processes, but it must not be manufactured for every lab.
The existence of a PI profile or the generic possibility of email is not an entry pathway.
Course credit is a formalization option after the student has found a research home and mentor.
Fellowship funding is usually also formalization after mentor and home fit, but a fellowship that matches students with mentors or runs a cohort research program can be a pathway in its own right.
Only call something open when there is a real current posting or explicit current source.

## Navigation Shape

Target surfaces:

- `/`: authenticated default redirect to `/research`.
- `/research`: explore research entities, even when no opening exists.
- `/research/:slug`: show what the entity does, who is involved, important affiliations, evidence of undergraduate access, saved research-plan actions, and planning routes when they are supported.
- `/programs`: active authenticated program and fellowship discovery surface.
- `/listings`: retired compatibility URL that redirects to `/research`.
- `/fellowships`: retired compatibility URL that redirects to `/programs`.

The hard-pivot migration removes `/labs` as a runtime compatibility surface; `/research` is the canonical Explore Research route.

Implementation note: the separate practical-routes page has been retired because it degraded the directory experience.
Planning context should appear inside `/research` results and `/research/:slug` only when useful, without exposing a standalone public pathways search.
On research details, Undergraduate logistics belongs within Planning context and appears only when at least one source-backed claim is known or under review; unavailable enrichment and payloads whose claims are all unknown stay hidden.
Research detail should not render research papers.
A deduplicated Sources section may expose the official links that support the page, while source provenance remains available to operators and may also appear as a compact inline evidence link for a specific access claim.

Public CTAs should prefer official application URLs, official profiles, source review, and saved planning over raw emails or yLabs-hosted outreach promises.
Faculty should normally publish openings on official Yale, department, program, or lab pages for ingestion.
A correction flow may accept an official source URL, but Yale Research does not host faculty-authored lab or opportunity submissions.
Official application routes remain outbound source-backed links discovered through ingestion rather than applications submitted to Yale Research.
When a professor or research home is missing, operators should resolve the canonical research entities for that professor and run bounded entity-targeted scraper backfills.

## Entity Page Questions

Each research entity page should answer:

- What is this research structure?
- What does it study?
- Who leads it?
- Who might supervise undergrads day to day?
- What methods does it use?
- What center, institute, program, or other research home is it affiliated with?
- Where can the student find the PI's publications on a maintained external profile?
- Have undergrads participated before?
- What access evidence and practical next steps exist?
- What should the student do next?
- How might the research relationship later be formalized?
- What source verifies this?

Leadership should be presented without redundant cards.
A sole verified principal investigator appears once in the decision summary.
When several principal investigators are attached, keep them together in a pluralized section and identify a separate Lead professor only from a unique match between the entity's official profile evidence and that member's official Yale faculty profile.
If lead identity evidence conflicts, preserve an explicit review state instead of displaying the disputed person.
The PI name should prefer a verified official Yale profile.
When no official Yale profile exists, it may link to a verified person-specific about or biography page on the lab website or a verified personal academic page.
Verified Google Scholar and ORCID links may appear as small secondary links beside the PI.
They should not create a research-paper section, display metrics, or replace the official Yale profile as the primary identity destination.

## CTA Vocabulary

Reaching out is constant and primary: always offer a way to contact the research home, never gating outreach.
Because student-facing PI emails are redacted by design, the primary path is to open the official profile, then an available official page from the entity's own classified sources, and only search the Yale Directory as a last resort when no official link exists, to find contact details and introduce yourself; a prefilled mailto appears only when a non-redacted email is available.
The contact prompt is never conditioned on access evidence, route, or computed confidence, and never gates outreach.
Other CTA options surface alongside it when the supporting evidence exists:

- Reach out (open official profile, open an official page from the entity's sources, search Yale Directory as a last resort, or email when a non-redacted address exists)
- Apply
- View official profile
- View Google Scholar
- View ORCID
- Ask about credit after mentor/home fit
- Find funding
- Apply to structured research program
- Review source route
- Review source context
- Save research plan
- Plan questions to verify next
- Save for thesis planning
- Check back later

Exploratory planning should be specific and evidence-based.
The site never blocks or discourages outreach; richer source-backed signals instead make each student's outreach more specific and targeted, which reduces low-quality mass outreach rather than encouraging it.
yLabs should not imply it has verified an official outreach channel, but it should always make reaching out easy, primarily by opening the official profile or another official source page, with the Yale Directory as a last resort, alongside official applications, official profiles, public source routes, and saved planning.

Student-facing labels should use warmer language than internal model names:

- Planning Context
- Evidence
- Best Next Step

## Saved Planning And Advising

Saved research plans are private student planning space by default.
They may include thesis ideas, planning notes, funding cues, deadlines, and checklist progress, but exports should exclude private notes unless the student explicitly opts in.

Advising-oriented sharing should use source-backed pathway context and explicit visibility choices.
It should help a student discuss options with an advisor, not create mass-email or broad outreach behavior.

## Product Principles

- Directory-first: maximize accurate research-entity, lead, and official-link coverage.
- Search-first: fast, relevant discovery is a co-equal priority with data quality, not an afterthought.
- Source-driven: scale through maintained official-source adapters rather than faculty uploads.
- Factual signals only: signals are sourced, positive facts that inform a student (funded, has mentored undergrads before, paid or credit, methods); they never gate, score trust, or condition contact.
- Affiliation-aware: retain important source-backed relationships among labs, centers, institutes, programs, and other research entities.
- Publication-light: link to verified official, Google Scholar, and ORCID profiles instead of rendering or maintaining research papers and publication-derived activity.
- Discipline-flexible: do not make STEM lab hierarchy the universal model.
- Progressively disclosed: do not expose model complexity that does not improve a student decision.
- Student-actionable: keep official-source navigation useful even when no signals are present, and keep reaching out always available and never gated.

## Student-Ready Visibility

An entity is shown to students (`student_ready`) if, and only if, what we show is CORRECT and COHERENT: a real, coherent, non-boilerplate description that describes THIS entity, the right lead attached, and not a duplicate or suppressed shell.
Because reaching out is the universal next step and is never gated, enrichment signals (source-backing, next step, action evidence, facet signals) make a card more specific but NEVER hide it.
The canonical definition and the hard-vs-soft split live in [student-ready-definition.md](student-ready-definition.md).
