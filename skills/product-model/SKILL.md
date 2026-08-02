---
name: product-model
description: Use when changing or evaluating Yale Research product behavior, student-facing research discovery, Ways In, access evidence, entity pages, visibility, research-home modeling, fellowships, course credit, or product vocabulary. This skill captures the product north star and canonical runtime model.
---

# Product Model

Yale Research is a source-driven directory that makes research homes and undergraduate-access context legible.
Its first responsibility is broad, accurate research-home coverage with the correct PI and official links.
Access evidence, pathways, opportunities, and research-entity affiliations are optional enrichments.

Do not model the product as a faculty-maintained job board or require faculty uploads for coverage.
Yale research includes labs, centers, institutes, faculty projects, digital humanities initiatives, collections and archive projects, RA programs, fellowships, senior theses, and exploratory outreach.

## Student-facing surfaces

- **Explore Research**: directory-first browsing of labs, centers, faculty projects, institutes, archives, collections projects, and thesis-adviser-like research areas.
- **Planning Context**: optional practical evidence for plausible homes, including access, timing, formalization possibilities, and explicit constraints when sources support them.

Keep Ways In as an internal model embedded in Yale Research rather than spinning it into a separate product surface.
Use warmer student-facing vocabulary such as "Planning Context", "Evidence", and "Best Next Step" where appropriate.
Do not manufacture an `EntryPathway` for every lab or expose model complexity that does not improve a student decision.
Iterate on canonical product surfaces such as `/research`, or use a non-URL feature flag.
Do not create student-facing versioned routes like `/v1`, `/research-v2`, or similar for ordinary product iteration.

Entity pages should answer:

- what the research structure is;
- what it studies;
- who leads it;
- who might supervise undergrads day to day;
- which important centers, institutes, programs, or research homes it is affiliated with;
- what methods it uses;
- where verified Google Scholar or ORCID profiles make the PI's publications discoverable;
- whether undergrads have participated before;
- what plausible access evidence exists;
- what the student should do next;
- how the relationship might later be formalized;
- where the official lab and PI pages lead.

## Canonical runtime model

| Concept                       | Collection                       | Purpose                                                                                                                         |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ResearchEntity`              | `research_entities`              | What exists: lab, center, institute, faculty project, RA program, fellowship program, etc.                                      |
| `EntryPathway`                | `entry_pathways`                 | How a student might approach a plausible research home.                                                                         |
| `PostedOpportunity`           | `posted_opportunities`           | A real active or time-bound posting.                                                                                            |
| `AccessSignal`                | `access_signals`                 | Evidence-backed signal about undergraduate access.                                                                              |
| `UndergraduateLogisticsClaim` | `undergraduate_logistics_claims` | Independent source-backed evidence about student level, compensation or credit, weekly time, modality, or current availability. |
| `ContactRoute`                | `contact_routes`                 | The best known way to act, such as official application, lab manager, or faculty PI.                                            |
| `ResearchEntityRelationship`  | `research_entity_relationships`  | A source-backed affiliation, hosting, membership, or umbrella relationship between research entities.                           |

## Modeling rules

- Course credit is a formalization outcome after a student finds a research home.
  It is not an entry pathway by itself.
- Fellowship funding usually behaves like formalization or funding, except when the fellowship is itself a structured discovery or mentor-matching program.
- `EntryPathway` is durable.
  `PostedOpportunity` is a specific active or time-bound posting and may be an instance of a recurring pathway.
- Directory inclusion does not require an `AccessSignal`, `EntryPathway`, `ContactRoute`, or `PostedOpportunity`.
- Scrapers emit append-only `Observation` rows.
  Materializers derive first-class access records.
- Avoid binary fields like `acceptingUndergrads`.
  Use `AccessSignal` with evidence strength instead.
- Keep undergraduate logistics claims independent and neutral when unknown.
  Do not infer one logistics claim from another or from generic undergraduate-access evidence.
- Contact routes are fail-closed.
  Prefer official and public URLs.
  Redact scraped emails from public payloads.
- The normal PI action is a link to the official Yale profile and does not imply permission to contact.
- When no official Yale profile exists, the primary PI link may use a verified person-specific lab about page or personal academic page.
- Do not show research papers or publication-derived activity in the public directory or detail experience.
- A research detail page may deduplicate official links in a Sources section, but it must not turn provenance into a paper or publication surface.
- Show verified Google Scholar and ORCID profiles only as secondary outbound links near the PI.
- Do not guess researcher-profile links from names or scrape their works, citations, or metrics for the directory.
- Preserve source provenance for review and compact inline attribution of material access or opportunity claims.
- Keep "Affiliated with" as a bounded detail-page section backed by first-class research-entity relationships.
- Prefer official-source scraping and source-submission hints over faculty-maintained duplicate profiles or listings.
- Treat the visible directory listing as a REST projection of `ResearchEntity`, not a reason to preserve the legacy `Listing` model.
- Migrate legacy models vertically and remove each old reader and writer before deleting its storage.
- Prefer first-class collections over embedding pathways, signals, or routes inside `ResearchEntity`.

See `docs/research-model.md` for the current runtime model and `docs/research-model-refactor.md` for the accepted target and phased migration.
