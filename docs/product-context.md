# Product Context

## North Star

Yale Research makes the hidden undergraduate research ecosystem legible: where formal openings exist, where credible pathways exist, and how students can move from curiosity to a specific, evidence-based next step.

The product is not a simple "find lab openings" job board. It should help Yale students discover and navigate real paths into research, including paths that are not formally posted.

In product shorthand: Yale Research is research-home-first navigation. It helps students move from a topic, person, method, or question to a credible research home, inspect source-backed evidence, review source and planning context, and choose the safest next step. Posted opportunities are only the active or time-bound posting subset. Course credit, paid RA work, fellowship funding, thesis advising, and volunteer arrangements are usually later formalization options after home/mentor fit, unless a structured program itself provides the entry route.

## Product Premise

Undergraduate research at Yale is decentralized. Students first need to identify plausible research homes: labs, faculty projects, centers, archives, collections, digital humanities initiatives, RA programs, institutes, mentor-matching fellowship programs, and adviser-like research areas. Once a home and supervisor are plausible, the relationship may be formalized through paid roles, course credit, volunteer arrangements, fellowships, senior essays, work-study, center programs, lab-manager coordination, faculty supervision, or posted opportunities. STEM often looks like faculty-led labs; humanities often looks like faculty projects, collections work, digital humanities, or fellowship-supported independent work; social science and economics often mix project teams, centers, thesis advising, and term-specific RA programs.

The app should make this ecosystem navigable without forcing every discipline into a lab-opening model.

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

This context should emphasize concrete source review and next-step planning toward a plausible research home. "Ways in" remains the internal and model-level umbrella for practical approaches such as official lab or faculty pages, recurring programs, internships, structured mentor-matching fellowships, and real posted openings, but beta student-facing browse and detail copy should not imply yLabs provides a reachable official outreach or inquiry channel. Course credit is not itself an entry pathway; it is a formalization option after the student has found a research home and mentor. Fellowship funding is usually also formalization after mentor/home fit, but a fellowship that matches students with mentors or runs a cohort research program can be a pathway in its own right. Only call something an open or posted opportunity when there is a real active or time-bound posting.

## Navigation Shape

Target surfaces:

- `/`: authenticated default redirect to `/research`.
- `/research`: explore research entities, even when no opening exists.
- `/research/:slug`: show what the entity does, who is involved, evidence of undergraduate access, source context, saved research-plan actions, and planning routes when they are supported.
- `/opportunities/:id`: show real active/time-bound postings only. These must be backed by `PostedOpportunity`.
- `/programs`: active authenticated program and fellowship discovery surface.
- `/listings`: retired compatibility URL that redirects to `/research`.
- `/fellowships`: retired compatibility URL that redirects to `/programs`.

The hard-pivot migration removes `/labs` as a runtime compatibility surface; `/research` is the canonical Explore Research route.

Implementation note: the separate practical-routes page has been retired because it degraded the unified research-home experience. Planning context derived from ways-in evidence should now appear inside `/research` results and `/research/:slug` detail pages without exposing a standalone public pathways search. `/opportunities/:id` has a first implementation for specific posted instances and should not render generic exploratory pathways.

Implementation note: legacy listings now bridge into `PostedOpportunity` records. Public CTAs should prefer official application URLs, source review, saved planning, and public source routes over raw emails or yLabs-hosted outreach promises. Student-facing navigation should not present Listings as the primary product surface; use Research, Evidence, Best Next Step, and Posted Roles/Posted Opportunities language instead.

## Entity Page Questions

Each research entity page should answer:

- What is this research structure?
- What does it study?
- Who leads it?
- Who might supervise undergrads day to day?
- What methods does it use?
- Have undergrads participated before?
- What access evidence and practical next steps exist?
- What should the student do next?
- How might the research relationship later be formalized?
- What source verifies this?

## CTA Vocabulary

CTA options should depend on the access evidence, route, and current next step:

- Apply
- Ask about credit after mentor/home fit
- Find funding
- Apply to structured research program
- Review source route
- Review source context
- Save research plan
- Plan questions to verify next
- Save for thesis planning
- Check back later

Exploratory planning should be specific and evidence-based. The product should not encourage students to spam faculty or imply that yLabs has verified an official outreach channel. Prefer official applications, public source routes, source review, saved planning, or check-back guidance when those are the supported actions.

Student-facing labels should use warmer language than internal model names:

- Planning Context
- Evidence
- Best Next Step

## Saved Planning And Advising

Saved research plans are private student planning space by default. They may include thesis ideas, planning notes, funding cues, deadlines, and checklist progress, but exports should exclude private notes unless the student explicitly opts in.

Advising-oriented sharing should use source-backed pathway context and explicit visibility choices. It should help a student discuss options with an advisor, not create mass-email or broad outreach behavior.

## Product Principles

- Exploration-first: support discovery before a student knows the exact structure they need.
- Evidence-scored: show why a pathway is credible and where the information came from.
- Pathway-aware: distinguish finding a research home from later formalization and from active postings.
- Discipline-flexible: do not make STEM lab hierarchy the universal model.
- Student-actionable: every page should help a student decide a plausible next step.
