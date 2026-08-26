# Research Model Refactor (Historical Decision Record)

Status: historical.
Ratified 2026-08-18; superseded as the current-state document by [`research-model.md`](./research-model.md) once the ratified model landed.
This file now records why the model was shaped the way it was, for readers who need the rationale rather than the current schema.
For current collection shapes, canonicalization rules, and migration state, read `research-model.md`.

## What We Were Solving

The main problem was making Yale labs discoverable and improving the scraped data and the scraper.
The product is an evidence-driven research database, read-only scraped data plus private student planning, with no professor or student write or marketplace surfaces.
The student job-to-be-done is: discover a lab, then cold-email the professor via the official profile or lab page.
The model refactor was a means to that end, not a goal in itself: every change was judged by whether it improved discoverability or data quality.

## Why These Shapes, Not Others

`Researcher` over `Person`: renamed early and in isolation (see Sequencing) so a grad or PhD student or researcher is findable in their own right, even with no lab, without re-touching the rename later during the larger schema and write-path work.

`RoleAssignment` as a first-class collection over embedding `members[]` on `ResearchEntity`: an earlier design considered embedding the roster directly on the entity.
The fork resolved to a separate `RoleAssignment` collection because the write path (the entity materializer) and the readers being built (`getResearchEntityRoster`, the visibility gate, the detail page) were already built against a joined collection, and a roster that changes per source snapshot benefits from independent indexing, state (`CURRENT`/`HISTORICAL`/`UNKNOWN`), and provenance rather than living inside the entity document.

`Account` split from `User`: the login principal (`Account`, keyed on netid) was separated from the public research identity (`Researcher`) so authentication does not depend on the same document that carries scraped profile data. `Account` wiring was sequenced with `User` retirement as the long pole (see Sequencing) rather than attempted as one atomic cutover, because most runtime code still reads and writes `User` directly.

`TaxonomyTerm` kept, but ingest-time only, never a stored reference: the original plan considered removing `TaxonomyTerm` entirely and normalizing research areas to free strings with no registry.
The owner-approved "option A" resolution of #208 kept `TaxonomyTerm` as a governed canonicalization registry (`TOPIC`/`METHOD`) that ingest matches against, while `ResearchEntity.researchAreas[]` stays plain canonical strings, never a foreign key.
This gets canonicalization's dedupe benefit without letting a guessed grouping collapse two distinct topics, and without making every reader join through a taxonomy collection.

`OrgUnit` kept ingest-time-only for the same reason: a school-to-department-to-program tree-browse feature would justify full ID-normalization, but the current product only needs canonicalized `school`/`departments[]` strings, so `OrgUnit` stays a lookup and seed rather than a stored reference.

`EntryPathway`/`ContactRoute`/`PostedOpportunity` removed rather than kept as a second product surface (#362/#363): these modeled a separate "ways in" product distinct from the entity itself.
In practice every reader wanted the entity plus its access evidence, not a separate pathway record, so ways-in and posted-opening evidence collapsed into typed `Signal` rows on the entity, and contact became a derived read-time projection instead of a stored route.

`Fellowship`/`Listing` deliberately left outside the lab model: they power the programs and funding page, a distinct product surface with its own search.
The "program" split-brain (a program appearing both as a `Fellowship` and as a projected `ResearchEntity`) was initially a known, accepted seam rather than something worth forcing into one model.
It was later resolved by removing the projection so programs and fellowships live only on `/programs`; see the current state in [`research-model.md`](./research-model.md).

The heavy evidence claim-graph (`EvidenceClaim`, `SourceDocument`, `ReviewDecision`) was deliberately frozen rather than built out: the lightweight `Observation` to `Signal` pipeline covered the product's actual needs, and the governed claim-graph's cost (predicate registry, source-document machinery, review workflow) was not justified by any current reader.

## Sequencing Rationale

Model or read cutover first, fix the write path after: introduce the canonical model and cut runtime reads over, then cut the scraper and materializer write path to canonical.
Reads cut over ahead of the write path serve stale data until a batch runs, so more reads should not cut over ahead of the write path.

When the write path becomes canonical, remove the destructive batch identity apply in the same change, or it will clobber continuously written canonical rows.
This is why the identity-migration batch apply (`phase2IdentityMigrationApply`/`replaceCanonicalIdentityCollections`) was retired in the same change that made the materializer write path canonical (#353): a batch that wipes and rebuilds canonical identity collections from legacy sources would destroy continuously-written rows that legacy no longer explains.

Rename `Person` to `Researcher` first, as a small isolated change, before the larger write-path and schema work, to avoid a double edit.

`Account` wiring is sequenced with `User` retirement (the long pole): login-time classification is derived per login rather than persisted, so `Account` could ship without waiting for every `User` reader to move.

Prefer a hard cutover: fully replace the legacy reader or path and remove the legacy code, with no fallback, flag, or parity-shadow layer.
Keep destructive storage drops, production writes, and one-way product decisions human-gated.

## Out Of Scope (At Ratification)

The heavy evidence claim-graph (frozen `EvidenceClaim`, `SourceDocument`, `ReviewDecision`, deleted `MaterializedProvenance`).
Strict-validator flips and compatibility-storage removal until every prior step lands.
A public people directory; a person-search surface, though `Researcher` supports it.
The programs, fellowships, grants, and funding page (a separate adjacent domain).

## Landed, By Issue

- Clean `ResearchEntity` schema, not the legacy `researchGroupSchema` (#208).
- Legacy `ResearchGroupMember` write path retired; canonical continuous write path plus destructive batch-apply retirement (#353, #361).
- `FacultyMember` retired, folded into `Researcher`/`RoleAssignment` identity resolution (#366, professor-mirror half of #207).
- `Paper`/`PaperAuthor` models and their readers retired, no rollback opt-in (publication-mirror half of #207).
- Legacy `ResearchEntity.description` field retired; `shortDescription`/`fullDescription` standardized (#351).
- `EntryPathway`/`ContactRoute`/`PostedOpportunity` removed, along with the separate pathway search index and surfaces (#362, #363).
- Legacy access booleans (`acceptingUndergrads`/`openness`/`acceptanceConfidence`/`opennessSignals`) retired; access derives solely from `Signal`-backed evidence (#463, closing #208 and #420). The `accessAcceptanceLevel` grade that #463 introduced was itself retired by the 2026-08-25 "Simple Directory First" pivot; see [`research-model.md`](./research-model.md).
- Research-area canonicalization option A: governed `TaxonomyTerm` registry, free-string `researchAreas[]`, never a foreign key (#457, closing the remainder of #208 alongside #354's `OrgUnit` seed).
- Saved research planning cut over to canonical `ResearchPlan` (#484, commit `34b9fd7e`).
- Model refactor Phase 4 (#208) closed 2026-08-23; remaining stale-field-value cleanup in existing documents is tracked separately in #725, decoupled from the schema work.

PR #344 (an early `RoleAssignment` read cutover) was superseded by #375 and closed.

## Verification Gates Used For Cutovers

Source and target counts with explained differences, no orphan references, no dual identities in public DTOs, no public contact leakage, source attribution for material claims, deterministic conflict handling, official-link validity with graceful failure, search relevance parity, correct visibility filtering, bounded detail payloads, private-plan isolation, no paper dependency, and rollback readiness before any collection drop.
