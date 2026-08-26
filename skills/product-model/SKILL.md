---
name: product-model
description: Use when changing or evaluating Yale Research product behavior, student-facing research discovery, Ways In, access evidence, entity pages, visibility, research-home modeling, fellowships, course credit, or product vocabulary. This skill captures the product north star and canonical runtime model.
---

# Product Model

Yale Research is a simple, source-driven directory of Yale research whose two co-equal priorities are good data and good search.
Its first responsibility is broad, accurate coverage of research entities and researchers with the correct lead and official links, made findable through fast, relevant search.
Signals and research-entity affiliations are factual enrichments that inform a student; they never gate visibility, score trust, or condition contact.
Per the 2026-08-25 "Simple Directory First" decision, the access-plausibility tier (the `Signal`-driven browse trust filter, `REACH_OUT_PLAUSIBLE` plausibility signals, the "Evidence" and "Best Next Step" framing, and "Ways in") is retired, and "research home" and "research area" are deprecated framings; see `docs/decisions.md`.

Do not model the product as a faculty-maintained job board or require faculty uploads for coverage.
Yale research includes labs, centers, institutes, faculty projects, digital humanities initiatives, collections and archive projects, RA programs, fellowships, senior theses, and exploratory outreach.

## Student-facing surfaces

- **Explore Research**: directory-first browsing of labs, centers, faculty projects, institutes, archives, collections projects, and thesis-adviser-like research areas.
- **Planning Context**: optional practical evidence for plausible homes, including access, timing, formalization possibilities, and explicit constraints when sources support them.

Keep Ways In as an internal model embedded in Yale Research rather than spinning it into a separate product surface.
Use warmer student-facing vocabulary such as "Planning Context", "Evidence", and "Best Next Step" where appropriate.
Do not manufacture a `Signal` for every lab or expose model complexity that does not improve a student decision.
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

| Concept                      | Collection                      | Purpose                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResearchEntity`             | `research_entities`             | What exists: lab, center, institute, faculty project, RA program, fellowship program, etc.                                                                                                                                                                                                                                             |
| `Researcher`                 | `researchers`                   | Public research identity (a PI, grad student, or researcher), surfaced through the research entities they lead rather than a standalone person page (the person page and researcher search are retired). Roster membership joins here, not an embedded person record.                                                                 |
| `RoleAssignment`             | `role_assignments`              | The canonical roster edge: a `Researcher` in a role (`PI`, `CO_PI`, `DIRECTOR`, and similar) on a `ResearchEntity`. Replaces the retired `ResearchGroupMember`; never embedded on `ResearchEntity`.                                                                                                                                   |
| `Signal`                     | `signals`                       | Source-attributed, typed fact about a research entity. Consolidates the former `AccessSignal` (each access type is its own `Signal.type`, keeping the per-type confidence gradient) and `UndergraduateLogisticsClaim` (student level, compensation or credit, weekly time, modality, current availability). |
| `ResearchEntityRelationship` | `research_entity_relationships` | A source-backed affiliation, hosting, membership, or umbrella relationship between research entities.                                                                                                                                                                                                                                  |
| `ResearchPlan`               | `research_plans`                | Private, account-owned saved planning, keyed on `accountId` plus a `ResearchEntity` or program target. The only student write surface.                                                                                                                                                                                                |

## Modeling rules

- Course credit is a formalization outcome after a student finds a research home.
  It is not access evidence by itself.
- Fellowship funding usually behaves like formalization or funding, except when the fellowship is itself a structured discovery or mentor-matching program.
- Programs and fellowships live only on `/programs` (backed by the `Fellowship` collection), never in the `/research` corpus.
  A program is not a `ResearchEntity`: there is no `PROGRAM` `entityType`, and department "undergraduate research" pages materialize as `Fellowship` records, not research homes (see `docs/decisions.md` 2026-08-26).
  A program is lead-optional and surfaces an "Apply to this program" next step rather than the generic email-a-PI default.
  The distinct `researchPlanTargetKinds` `'PROGRAM'` is a saved-plan target for a program and is unrelated to any research-entity type.
- Directory inclusion does not require a `Signal` or other access evidence.
- Scrapers emit append-only `Observation` rows.
  Materializers derive first-class access records.
- Avoid binary fields like `acceptingUndergrads`.
  Use a `Signal` row (the former `AccessSignal` model is folded into `Signal`) with evidence strength instead.
- Keep undergraduate logistics claims independent and neutral when unknown.
  Do not infer one logistics claim from another or from generic undergraduate-access evidence.
- Contact is fail-closed and purely derived, never a stored `ContactRoute` or surfaced scraped email.
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
- Prefer first-class collections over embedding signals or access evidence inside `ResearchEntity`.

See `docs/research-model.md` for the current runtime model and `docs/research-model-refactor.md` for the historical rationale behind it.
