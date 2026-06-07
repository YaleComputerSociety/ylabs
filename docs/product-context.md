# Product Context

## North Star

Yale Research makes the hidden undergraduate research ecosystem legible: where formal openings exist, where credible pathways exist, and how students can move from curiosity to a specific, evidence-based next step.

The product is not a simple "find lab openings" job board. It should help Yale students discover and navigate real paths into research, including paths that are not formally posted.

In product shorthand: Yale Research helps students move from curiosity to a credible research home and next step. That relationship may later be formalized as course credit, paid RA work, fellowship-funded research, thesis advising, or an active posted opportunity. Some structured fellowships are exceptions because they match or place students with mentors and therefore also function as discovery programs.

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

### Ways In

Practical evidence for how a student might participate:

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

This context should emphasize concrete next steps toward a plausible research home. "Ways In" is the student-facing umbrella for practical routes to approach or enter research, including durable routes such as exploratory outreach, recurring programs, internships, faculty/lab-manager contact, structured mentor-matching fellowships, and real posted openings. Internally, `EntryPathway` and the pathway search index can still model this evidence. Course credit is not itself an entry pathway; it is a formalization option after the student has found a research home and mentor. Fellowship funding is usually also formalization after mentor/home fit, but a fellowship that matches students with mentors or runs a cohort research program can be a pathway in its own right. Only call something an open or posted opportunity when there is a real active or time-bound posting.

## Navigation Shape

Target surfaces:

- `/`: authenticated default redirect to `/research`.
- `/research`: explore research entities, even when no opening exists.
- `/programs`: browse structured application and planning programs, including fellowships, recurring research programs, center internships, open cycles, likely next cycles, and closing-soon deadlines.
- `/research/:slug`: show what the entity does, who is involved, evidence of undergraduate access, Ways In context, and contact routes.
- `/opportunities/:id`: show real active/time-bound postings only. These must be backed by `PostedOpportunity`.
- `/account`: private saved-planning workspace for saved research homes, programs, notes, checklist context, and next deadlines.

Retired public client routes:

- `/pathways`: retired client redirect to `/research`. Ways In context belongs inside `/research` and `/research/:slug`.
- `/listings`: retired client redirect to `/research`. Legacy listing data may still bridge into `PostedOpportunity`, but students should not see Listings as a primary surface.
- `/fellowships`: retired client redirect to `/programs`.

The hard-pivot migration removes `/labs` as a runtime compatibility surface; `/research` is the canonical Explore Research route.

Implementation note: `POST /api/pathways/search` remains backend Ways In infrastructure. It can power embedded evidence and future filters, but it does not imply a standalone public `/pathways` client page. `/opportunities/:id` renders specific posted instances and should not render generic exploratory pathways.

Implementation note: `/api/fellowships` remains a deprecated compatibility API with `/api/programs` as its successor. Legacy listings can still bridge into `PostedOpportunity` records for Ways In context. Public contact CTAs should prefer guarded route URLs and official channels over raw emails. Student-facing navigation should not present Listings or Pathways as primary public route labels; use Research, Ways In, Programs & Fellowships, and Posted Opportunities language instead.

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

Research activity belongs on the research-home page as context, not as the primary funnel. A strong lab/entity detail page should show the PI or lead, verified members when known, and relevant papers or scholarly activity tied through identity-backed authorship or explicit entity links. Student workflow should stay research-home-first: use papers to understand the lab's work and prepare better outreach, then let the PI profile be a secondary deep-dive for reading more by that professor.

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

- Ways In
- Evidence
- Best Next Step

## Saved Planning And Advising

Saved research plans and Ways In notes are private student planning space by default. They may include thesis ideas, outreach notes, funding cues, deadlines, and checklist progress, but exports should exclude private notes unless the student explicitly opts in.

Advising-oriented sharing should use source-backed pathway context and explicit visibility choices. It should help a student discuss options with an advisor, not create mass-email or broad outreach behavior.

## Product Principles

- Exploration-first: support discovery before a student knows the exact structure they need.
- Evidence-scored: show why a pathway is credible and where the information came from.
- Ways In-aware: distinguish finding a research home from later formalization and from active postings.
- Discipline-flexible: do not make STEM lab hierarchy the universal model.
- Student-actionable: every page should help a student decide a plausible next step.
