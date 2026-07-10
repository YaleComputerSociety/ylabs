---
name: product-model
description: Use when changing or evaluating Yale Research product behavior, student-facing research discovery, Ways In, access evidence, entity pages, visibility, research-home modeling, fellowships, course credit, or product vocabulary. This skill captures the product north star and canonical runtime model.
---

# Product Model

Yale Research is a discovery app that makes the hidden undergraduate research ecosystem legible.
It should help students understand where formal openings exist, where credible pathways exist, and how to move from curiosity to a specific, evidence-based next step.

Do not model the product as a simple "find lab openings" job board.
Yale research includes labs, centers, institutes, faculty projects, digital humanities initiatives, collections and archive projects, RA programs, fellowships, senior theses, and exploratory outreach.

## Student-facing surfaces

- **Explore Research**: curiosity-first browsing of labs, centers, faculty projects, institutes, archives, collections projects, and thesis-adviser-like research areas.
- **Planning Context**: practical evidence for plausible homes, including next-step route, methods, timing, compensation or funding possibility, thesis fit, beginner-friendly signals, hours per week when known, and constraints like Python, archival research, wet lab, or social-science data.

Keep Ways In as an internal model embedded in Yale Research rather than spinning it into a separate product surface.
Use warmer student-facing vocabulary such as "Planning Context", "Evidence", and "Best Next Step" where appropriate.
Iterate on canonical product surfaces such as `/research`, or use a non-URL feature flag.
Do not create student-facing versioned routes like `/v1`, `/research-v2`, or similar for ordinary product iteration.

Entity pages should answer:

- what the research structure is;
- what it studies;
- who leads it;
- who might supervise undergrads day to day;
- what methods it uses;
- whether undergrads have participated before;
- what plausible access evidence and source context exist;
- what the student should do next;
- how the relationship might later be formalized;
- which source verifies the information.

## Canonical runtime model

| Concept | Collection | Purpose |
|---------|------------|---------|
| `ResearchEntity` | `research_entities` | What exists: lab, center, institute, faculty project, RA program, fellowship program, etc. |
| `EntryPathway` | `entry_pathways` | How a student might approach a plausible research home. |
| `PostedOpportunity` | `posted_opportunities` | A real active or time-bound posting. |
| `AccessSignal` | `access_signals` | Evidence-backed signal about undergraduate access. |
| `ContactRoute` | `contact_routes` | The best known way to act, such as official application, lab manager, or faculty PI. |

## Modeling rules

- Course credit is a formalization outcome after a student finds a research home.
It is not an entry pathway by itself.
- Fellowship funding usually behaves like formalization or funding, except when the fellowship is itself a structured discovery or mentor-matching program.
- `EntryPathway` is durable.
`PostedOpportunity` is a specific active or time-bound instance of a pathway.
- Scrapers emit append-only `Observation` rows.
Materializers derive first-class access records.
- Avoid binary fields like `acceptingUndergrads`.
Use `AccessSignal` with evidence strength instead.
- Contact routes are fail-closed.
Prefer official and public URLs.
Redact scraped emails from public payloads.
- Prefer first-class collections over embedding pathways, signals, or routes inside `ResearchEntity`.

See `docs/research-model.md` for full schema and migration guidance.
