# Glossary

The vocabulary in this repository is dense and mostly undefined in place.
"Lane" alone appears 219 times across `docs/` without a definition anywhere.
This file is the definition list, for humans and agents alike.

Each entry names the file that owns the concept, because the code is canonical and this page is a pointer.
Entries are grouped by the layer they belong to, and the evidence pipeline comes first because most of the vocabulary lives there.

## The evidence pipeline

**Observation.**
An append-only assertion: "at time T, source S claimed that entity E's field F has value V."
Nothing in the product reads an observation directly.
Owner: `server/src/models/observation.ts`.

**Source.**
A registered scraper, carrying a trust weight the resolver multiplies by.
Registered in `server/src/scrapers/registry.ts`, with each scraper under `server/src/scrapers/sources/`.

**Lane.**
One emit path: a single source scraper, or one branch inside it, that asserts a particular field.
The word is used constantly in issues and commit messages because the standing rule is "fix the lane, not the row": a defect with a shape belongs to whatever emits it, not to the rows it landed on.
A lane is not a model and not a collection, so do not go looking for a `Lane` type.
Some lane labels name retired models (`user`, `researchGroupMember` in `observedEntityTypes`) and are still live paths; they are opaque labels rather than model lookups.

**Confidence resolver.**
A pure function that takes every observation for one `(entity, field)` pair and picks a winner.
It groups by serialized value, weights each group by `sum(source.weight x recencyDecay(observedAt))`, adds an agreement bonus when more than one source backs a group, returns the highest-weighted value, and flags a conflict when the runner-up is close.
A locked field short-circuits the whole thing and returns the locked value.
Owner: `server/src/scrapers/confidenceResolver.ts`.

**Materializer.**
The step that turns resolved observations into first-class records: `ResearchEntity`, `RoleAssignment`, `Signal`.
This is the only legitimate writer of a scraped field.
Owner: `server/src/scrapers/entityMaterializer.ts`.

**Sweep.**
The batch run, `scrape:sweep`.
It spawns one fault-isolated subprocess per source in ordered phases (`identity`, `discovery`, `funding`, `relationships`, `content-access`), then runs a chain of post-run stages.
Owner: `server/src/scripts/runScraperSweep.ts`.

**fieldProvenance.**
Per-field record of who produced the *value*: source id and name, source URL, observation id, `observedAt`, confidence.
Read it to answer "where did this come from".
Note that it records the URL that was *fetched*, not a URL cited on the page.
Owner: `fieldProvenanceSchema` in `server/src/models/modelPrimitives.ts`.

**manuallyLockedFields.**
A list of field names the resolver must not overwrite.
A lock is how a hand-written value survives the next resolve, which is also why a repair that writes a field directly needs one.
Owner: `server/src/models/researchEntity.ts`, consulted first by the resolver.

**fieldLockProvenance.**
Why a given lock exists, and the load-bearing part is `reason`.
`operator_decision` is a human judgement no engine improvement may override.
`engine_gap_workaround` stands in for a capability the engine lacks and must be revisited once that capability lands.
`unknown` covers every lock applied before the field existed and is read as the conservative case, never as revisitable.
Owner: `fieldLockProvenanceSchema` in `server/src/models/modelPrimitives.ts`.

**Refusal (`fieldValueRefusals`).**
A recorded statement that one specific value is inadmissible for a field, keyed by `valueKey` with a `rule` and optional evidence URL.
A refusal blocks the write, so unlike a repair it survives a re-scrape without needing a lock, and it can be withdrawn.
Owner: `fieldValueRefusalSchema` in `server/src/models/modelPrimitives.ts`.

**Suppression.**
A tombstone on a record, not on a field.
An absent `reason` is the resting state; a present one stops materializers resurrecting a record they would otherwise rewrite.
Owner: `recordSuppressionSchema` in `server/src/models/modelPrimitives.ts`.

**Derivation versus repair.**
Both are post-processing and both are legitimate, but they differ in durability.
A derivation runs on every resolve, reads evidence, writes no field, and needs no lock.
A repair writes a field directly and needs a lock to stick.
The test is to run it twice: if the second run re-derives the same answer it is a derivation, and if the second run is a no-op because the first wrote a field it is a repair.
`AGENTS.md` states the contract and `docs/decisions.md` holds the reasoning.

## The product model

**ResearchEntity.**
The unit of the directory: a lab, center, institute, faculty research profile, RA program.
Collection `research_entities`.

**Researcher.**
A public research identity, surfaced through the entities they lead rather than a standalone person page.
Collection `researchers`.

**RoleAssignment.**
The roster edge joining a `Researcher` to a `ResearchEntity` in a role such as `PI` or `DIRECTOR`.
Never embedded on the entity.
Collection `role_assignments`.
Be aware that stored edge roles and the labels served to students are two different vocabularies.

**Signal.**
A typed, source-attributed fact about an entity or an `OrgUnit`.
Signals enrich; they never gate visibility, score trust, or condition contact.
Collection `signals`.

**ResearchEntityRelationship.**
A source-backed affiliation, hosting, membership, or umbrella link between two entities.
Collection `research_entity_relationships`.

**ResearchPlan.**
Private saved planning keyed on an account, and the only surface a student writes to.
Collection `research_plans`.

**kind versus entityType.**
`kind` is the older stored field; `entityType` defaults from it through `mapResearchGroupKindToEntityType`.
Neither is the student-facing noun: the pill a student reads has exactly one owner, `entityKindLabel` in `client/src/utils/researchEntityCopy.ts`.

**Observation subject type versus product entityType.**
Two disjoint vocabularies that look alike and are a known trap.
`observedEntityTypes` (`user`, `researchEntity`, `orgUnit`, and so on) names what an observation is *about*.
A product `entityType` (`LAB`, `CENTER`, `FACULTY_RESEARCH_AREA`) is carried as a *value* under `field: 'entityType'`.
They overlap in zero values, and a product-typed parameter handed a subject value takes its default branch silently rather than failing.

## Visibility and serving

**The gate.**
The computation that assigns `studentVisibilityTier`.
It is correctness-only: it asks whether what we would show is wrong or confusing, never whether it is rich.
Owner: `server/src/services/studentVisibilityTier.ts`.

**studentVisibilityTier.**
One of `student_ready`, `limited_but_safe`, `operator_review`, `suppressed`.
Only `student_ready` is public (`publicStudentVisibilityTiers`).
Owner: `server/src/models/studentVisibility.ts`.

**student_ready.**
Correct and coherent: a real non-boilerplate description of *this* entity, the right currently-active lead attached, not a duplicate or suppressed shell, and a name that identifies something.
Missing enrichment never changes the tier.
`docs/student-ready-definition.md` is the human source of truth and must stay in sync with the code.

**Hard blocker versus soft signal.**
A hard blocker gates `student_ready` because the row as shown would mislead a student.
A soft signal is merely less enriched and does not gate.
The litmus test is "would showing this mislead or confuse a student".

**Served.**
What the public route actually returns, as against what is stored.
The distinction is load-bearing and is the single most repeated source of wrong measurements here: stored topics outnumber served topics, a fixed field can still be served from a stale index, and a count taken off the model rather than the route will disagree with what a student sees.
When verifying, re-read the served surface.
The detail DTO is an allowlist builder, so a new field is absent until it is added there.

**Scoreboard.**
The instrument for reading served state and cross-environment drift: `yarn --cwd server research-entity:served-scoreboard`, documented in `docs/served-corpus-scoreboard.md`.
Prefer it to a throwaway script.

## Environments and operations

**Development, Beta, Production.**
Three separate MongoDB Atlas databases.
Development is the only environment where scrapers run, so a data fix is applied there and reaches the others through promotion.
`MONGODBURL` names the database the current process talks to.

**Promotion.**
`promoteAcceptedBetaCopy` replaces fifteen whole collections at once, so one promotion delivers every pending fix together.
Promotion is not per-fix work and never gets its own issue.
It is also not monotonic: Production can hold the better value.

**Serve-time versus stored-data fix.**
A serve-time fix changes a DTO, a gate, a sanitizer, or client rendering, and reaching students on deploy means merging it is done.
A stored-data fix changes a scraper, materializer, repair script, or index shape, and merging it changes nothing a student sees until the data operation has run against Development and been verified by re-reading the served output.
`AGENTS.md` owns the definition of done.

**Dry run and `--apply`.**
Operator scripts default to dry run and write only when passed `--apply`, usually with an additional named confirmation flag.
A dry run applies no patch, so a promotion count from a dry run is `null` rather than `0`.

**`*Core.ts`.**
A library, not a CLI.
Sixteen such files live in `server/src/scripts/` because the repository has no shared home for them yet; the suffix is the tell that a file is imported rather than run.
They are misplaced, not dead.

**Predicate (identifying by predicate).**
The convention that a row is named by a property rather than by a person-bearing identifier, in issues, pull requests, and commit messages.
Write "the 12 rows where `manuallyLockedFields` contains `activeAtYaleCache`" rather than listing slugs.
This repository is public and GitHub serves every prior revision of an edited body, so the first draft is the only draft.
Check a draft with `yarn security:identifiers:body <file>`.
Owner: `docs/person-identifier-convention.md`.

## Deprecated vocabulary

These appear in older code and docs and must not be introduced in new copy, labels, comments, or identifiers.

| Do not use | Use instead |
| --- | --- |
| research home, `researchHome` | "research", or the entity's own kind noun (lab, center, faculty research profile) |
| research area (as prose) | topics (the stored field keeps the name `researchAreas`) |
| Ways In, access-plausibility tier, "Best Next Step" framing | retired by the 2026-08-25 "Simple Directory First" decision |
| `ResearchGroup`, `lab` as a model name, `researchGroupId` | `ResearchEntity`, `researchEntityId` |
| `ResearchGroupMember` | `RoleAssignment` |
| `AccessSignal`, `UndergraduateLogisticsClaim` | `Signal` with a type |
| `Listing`, Pathways | `/research`, backed by `ResearchEntity` |

A client guard test enforces the copy half: `client/src/__tests__/deprecatedVocabularyGuard.test.ts`.
`docs/decisions.md` holds the decisions behind each retirement.
