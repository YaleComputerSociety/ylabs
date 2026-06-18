# Decisions

Use this file for concise, dated decisions that should outlive an individual chat or implementation session. Do not paste transcripts.

## 2026-06-12: Research Service Synthetic Keys Use Safe ID Serialization

Public research detail and posted-opportunity maintenance paths now derive route fallback keys, derived PI outreach keys, member dedupe keys, contact-route sort keys, and expired-opportunity pathway sets through primitive/ObjectId-only ID serialization before falling back to public text.

Consequences:

- Object-shaped route, member, user, listing, or pathway IDs cannot execute custom `toString` hooks while public research detail payloads or posted-opportunity maintenance updates are assembled.
- Public text fallbacks remain explicit and bounded through existing public-string normalization.
- Static security preflight guards these service sites against returning to raw `String(record._id)`-style coercion.

## 2026-06-12: Maintenance ID Helpers Reject Duck-Typed ObjectIds

Maintenance, scraper, visibility-repair, accepted-input, and beta quality helper paths now derive local string IDs through the shared primitive/ObjectId-only serializer instead of executing arbitrary object-shaped `toHexString` methods or generic `String(value)` fallbacks.

Consequences:

- Object-shaped rows in description scrapers, official-profile repair, profile-bio repair/audit, accepted-input processing, duplicate/pathway repair, stale/cross-source/duplicate review, visibility repair, entity materialization, and beta data-quality reports cannot execute custom `toString` or duck-typed `toHexString` hooks while artifacts are assembled.
- Helpers that need nested `{ _id }` support unwrap only after failing the shared safe serializer, then recurse back through the same safe boundary.
- Static security preflight guards the affected helper set against reintroducing duck-typed ID coercion.

## 2026-06-12: Repair Artifact String IDs Use Safe Serialization

Archived-entity artifact repair and duplicate access-signal repair now derive local string IDs through the shared primitive/ObjectId-only serializer before planning, grouping, or report shaping.

Consequences:

- Object-shaped archived artifact or access-signal rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed repair plans are built.
- Unsafe values fail closed to empty identifiers instead of arbitrary object coercion.
- Static security preflight guards both repair helper boundaries against reintroducing duck-typed ID coercion.

## 2026-06-12: Student Visibility Backfill IDs Use Safe Serialization

Student visibility backfill now derives research/program report ids, aggregate-count keys, PI-dedupe grouping keys, lead-user ids, and profile-area handoff keys through the shared primitive/ObjectId-only serializer before launch visibility artifacts are assembled.

Consequences:

- Object-shaped research entities, programs, aggregate rows, lead memberships, or users cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed visibility backfill planning runs.
- Invalid object-shaped values are skipped from grouping maps or fail closed to empty report identifiers instead of arbitrary object coercion.
- Static security preflight guards the student visibility backfill id boundary.

## 2026-06-12: Member Reference Audit Report IDs Use Safe Serialization

Research-entity member-reference audit rows now derive candidate-user and existing-member match ids through the shared primitive/ObjectId-only serializer before repair artifacts are assembled.

Consequences:

- Object-shaped user/member rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed member-reference repair reports are built.
- Unsafe ids fail closed to empty report identifiers instead of arbitrary object coercion.
- Static security preflight guards the member-reference audit report id boundary.

## 2026-06-12: Paper Authorship Audit User Map IDs Use Safe Serialization

Paper authorship audit backfill now derives user lookup map keys through the shared primitive/ObjectId-only serializer before OpenAlex-derived author links are assembled.

Consequences:

- Object-shaped user rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed authorship backfill maps users to denormalized paper author ids.
- Unsafe ids are skipped instead of being coerced into map keys.
- Static security preflight guards the paper authorship audit user-map id boundary.

## 2026-06-12: User Identity Dedupe Error IDs Use Safe Serialization

User identity dedupe failure messages now derive duplicate membership and scholarly-link ids through the shared primitive/ObjectId-only serializer before privileged apply-mode errors are constructed.

Consequences:

- Object-shaped duplicate member or scholarly-link rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed user-dedupe error paths run.
- Unsafe ids fail closed to empty error identifiers instead of arbitrary object coercion.
- Static security preflight guards the user identity dedupe error-message id boundary.

## 2026-06-12: Publication Pointer Repair Report IDs Use Safe Serialization

Official-profile publication-pointer repair now derives unresolved and repaired report row ids through the shared primitive/ObjectId-only serializer before repair artifacts are assembled.

Consequences:

- Object-shaped scholarly-link rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed publication-pointer repair reports are built.
- Unsafe ids fail closed to empty report identifiers instead of arbitrary object coercion.
- Static security preflight guards the publication-pointer repair report id boundary.

## 2026-06-12: Program Classification Backfill IDs Use Safe Serialization

Program classification backfill update/report rows now derive fellowship/program ids through the shared primitive/ObjectId-only serializer before maintenance artifacts are assembled.

Consequences:

- Object-shaped fellowship/program records cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed classification backfill reports are built.
- Unsafe ids fail closed to empty report identifiers instead of arbitrary object coercion.
- Static security preflight guards the program classification backfill id boundary.

## 2026-06-12: Same-PI Dedupe Report IDs Use Safe Serialization

Same-PI research-entity dedupe now derives profile-area entity ids, duplicate member grouping ids, and archived-artifact row ids through the shared primitive/ObjectId-only serializer before reviewed dedupe artifacts or archive-mode relink calls are assembled.

Consequences:

- Object-shaped dedupe rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed same-PI dedupe planning and archive-mode cleanup run.
- Unsafe ids fail closed to empty report/action identifiers instead of arbitrary object coercion.
- Static security preflight guards the same-PI dedupe report/action id boundary.

## 2026-06-12: Program Research-Relevance Audit IDs Use Safe Serialization

Program research-relevance audit rows now derive program record ids through the shared primitive/ObjectId-only serializer before suppression or archive maintenance artifacts are assembled.

Consequences:

- Object-shaped program records cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed program maintenance artifacts are built.
- Unsafe ids fail closed to empty report identifiers instead of arbitrary object coercion.
- Static security preflight guards the program research-relevance audit id boundary.

## 2026-06-12: Public PI Links Prefer Official Faculty Profiles, Then Internal Profile Fallbacks

Public research detail PI cards, lead-professor links, and compact research cards first link to verified official Yale person-profile URLs from sanitized profile/source fields. When no official person-profile URL is available, the server may expose a sanitized explicit internal `/profile/:netid` path for the faculty member so the professor name is still clickable. Public UI must not synthesize `/profile/:netid` links from raw NetIDs, emails, public keys, role-suffixed member keys, or names.

Consequences:

- Official Yale faculty pages remain the preferred destination because they are source-owned and reduce duplicated biography/research maintenance.
- `/profile/:netid` is the fallback destination only when the API provides a sanitized explicit internal path and no official person-profile URL exists.
- Public research-detail member DTOs may expose sanitized official Yale profile URL maps or sanitized internal profile paths, but must not expose raw faculty NetIDs or raw personal profile data.
- Faculty bio/research prose should be treated as owned by the official Yale faculty profile where it already exists; data cleanup should fill `User.profileUrls.official` or school-specific official keys from source-backed audits/backfills instead of inventing name-only URLs, and should use internal profile fallbacks only for rows without verified official profile destinations.
- Tests for this behavior should use synthetic people and fixture URLs, not real personal data.

## 2026-06-12: Profile Data-Quality Audit IDs Use Safe Serialization

Profile data-quality audit report grouping now derives research-entity, membership research-entity, membership-user, and user ids through the shared primitive/ObjectId-only serializer before profile-home audit rows are assembled.

Consequences:

- Object-shaped profile audit rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed profile QA artifacts are built.
- Unsafe ids fail closed to empty grouping/report identifiers instead of arbitrary object coercion.
- Static security preflight guards the profile data-quality audit id boundary.

## 2026-06-12: Surname-Lab Disambiguation Plan IDs Use Safe Serialization

Surname-lab disambiguation planning now derives entity, member research-entity, member-user, and user ids through the shared primitive/ObjectId-only serializer before reviewed disambiguation artifacts are assembled.

Consequences:

- Object-shaped surname-shell repair rows cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed disambiguation plan generation runs.
- Unsafe ids fail closed to empty or omitted artifact identifiers instead of arbitrary object coercion.
- Static security preflight guards the surname-lab disambiguation id boundary.

## 2026-06-12: Department Lead Repair Plan IDs Use Safe Serialization

Department-lead repair planning now derives entity, observation, user, research-entity-member, and member-user ids through the shared primitive/ObjectId-only serializer before reviewed plan artifacts are assembled.

Consequences:

- Object-shaped repair inputs cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed department-lead plan generation runs.
- Unsafe ids fail closed to empty or omitted artifact identifiers instead of arbitrary object coercion.
- Static security preflight guards the department-lead repair-plan id boundary.

## 2026-06-12: Listing Profile Repair IDs Use Safe Serialization

Listing research-entity profile repair now derives entity map keys and listing report ids through the shared primitive/ObjectId-only serializer before repair rows are assembled.

Consequences:

- Object-shaped listing or research-entity records cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed listing-profile repair artifacts are built.
- Unsafe ids fail closed to empty map/report identifiers instead of arbitrary object coercion.
- Static security preflight guards the listing-profile repair id boundary.

## 2026-06-12: Center Director Backfill IDs Use Safe Serialization

Center-director backfill now derives candidate, existing-lead, and director-membership materializer handoff ids through the shared primitive/ObjectId-only serializer.

Consequences:

- Object-shaped organizational research-home ids cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed center-director backfill work is assembled.
- Unsafe ids fail closed to empty candidate/materializer identifiers instead of arbitrary object coercion.
- Static security preflight guards the center-director backfill id boundary.

## 2026-06-12: Faculty Ways In Backfill Candidate IDs Use Safe Serialization

Faculty Ways In backfill now derives candidate research-entity ids through the shared primitive/ObjectId-only serializer before candidate/report rows are assembled.

Consequences:

- Object-shaped research entities cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed Ways In materialization candidates are built.
- Unsafe ids fail closed to empty candidate identifiers instead of arbitrary object coercion.
- Static security preflight guards the faculty Ways In backfill candidate-id boundary.

## 2026-06-12: Public Research Group Service IDs Use Safe Serialization

Public research group service map keys now derive lead-member grouping ids, quality-summary lookup ids, visible Meili hit ids, and related-entity DTO lookup ids through the shared primitive/ObjectId-only serializer.

Consequences:

- Object-shaped stored research/member ids cannot execute custom `toString` or duck-typed `toHexString` hooks while public research browse/detail payloads are assembled.
- Unsafe ids fail closed to empty lookup keys instead of arbitrary object coercion.
- Static security preflight guards these public research service id boundaries.

## 2026-06-12: NIH Reporter Matched User IDs Use Safe Serialization

NIH Reporter scraping now derives matched user ids through the shared primitive/ObjectId-only serializer before PI match results feed source-acquisition observations and materialization.

Consequences:

- Object-shaped user candidates cannot execute custom `toString` or duck-typed `toHexString` hooks while NIH PI identity matches are assembled.
- Unsafe matched user ids fail closed to empty identifiers instead of arbitrary object coercion.
- Static security preflight guards the NIH Reporter matched-user id boundary.

## 2026-06-12: Official-Profile PI Backfill IDs Use Safe Serialization

Official-profile PI backfill now derives research-entity and lead-member ids through the shared primitive/ObjectId-only serializer before queue candidate mapping, lead-membership checks, and failure log payload shaping.

Consequences:

- Object-shaped official-profile source rows cannot execute custom `toString` or duck-typed `toHexString` hooks while PI backfill candidate state or report metadata is assembled.
- Unsafe ids fail closed to empty map/report identifiers instead of arbitrary object coercion.
- Static security preflight guards the official-profile PI backfill source-acquisition id boundary.

## 2026-06-12: Research Description Backfill Observation IDs Use Safe Serialization

Research-description LLM backfill now derives research-entity ids through the shared primitive/ObjectId-only serializer before writing full-description and short-description observations.

Consequences:

- Object-shaped description backfill entities cannot execute custom `toString` or duck-typed `toHexString` hooks while source-backed rewrite observations are assembled.
- Unsafe entity ids are omitted instead of coerced into observation metadata.
- Static security preflight guards the research-description backfill observation-id boundary.

## 2026-06-12: Lab Microsite Description LLM Observation IDs Use Safe Serialization

Lab microsite description LLM extraction now derives research-entity ids through the shared primitive/ObjectId-only serializer before emitting embedded-description or provider-extracted observations.

Consequences:

- Object-shaped lab candidate records cannot execute custom `toString` or duck-typed `toHexString` hooks while description source-acquisition observations are assembled.
- Unsafe entity ids are omitted instead of coerced into observation metadata.
- Static security preflight guards the lab microsite description LLM observation-id boundary.

## 2026-06-12: Student Visibility Repair Target IDs Use Safe Serialization

Student visibility repair-target artifacts now derive research-entity record ids through the shared primitive/ObjectId-only serializer before emitting repair target rows or label fallbacks.

Consequences:

- Object-shaped repair-target documents cannot execute custom `toString` or duck-typed `toHexString` hooks while operator repair artifacts are assembled.
- Unsafe record ids fail closed to empty identifiers instead of arbitrary object coercion.
- Static security preflight guards the repair-target artifact id boundary.

## 2026-06-12: Entity Materializer Result and Upsert IDs Avoid Generic Coercion

Entity materializer membership, faculty-research-area bridge, relationship, and created-entity result ids now use the shared primitive/ObjectId-only serializer for payload/report values and the strict materializer ObjectId normalizer for DB-facing IDs.

Consequences:

- Object-shaped materialized entity, user, member, source, target, or created-document ids cannot execute custom `toString` or duck-typed `toHexString` hooks while credentialed materialization paths assemble upserts or result payloads.
- DB-facing relationship/member ids fail closed behind the existing 24-hex/ObjectId materializer boundary.
- Static security preflight guards the materializer result/upsert id boundary.

## 2026-06-12: Center LLM Candidate IDs Use Safe Serialization

Center director and center affiliation LLM extractors now derive research-entity candidate ids through the shared primitive/ObjectId-only serializer before prompt and candidate shaping.

Consequences:

- Object-shaped center records cannot execute custom `toString` or duck-typed `toHexString` hooks while organizational research-home LLM acquisition payloads are assembled.
- Unsafe candidate ids are omitted instead of coerced.
- Static security preflight guards both center LLM candidate-id boundaries.

## 2026-06-12: Publication Authorship Observations Use Safe User IDs

Europe PMC/PubMed, ORCID works, and OpenAlex authorship observation emitters now derive faculty/user ids through the shared primitive/ObjectId-only serializer before emitting paper authorship evidence.

Consequences:

- Object-shaped user rows cannot execute custom `toString` or duck-typed `toHexString` hooks while publication-source observations are shaped.
- Unsafe authorship user ids fail closed to empty strings instead of arbitrary object coercion.
- Static security preflight guards the publication authorship user-id boundary across all three scrapers.

## 2026-06-12: Source Acquisition Candidate IDs Avoid Generic Coercion

Student-decision LLM candidate entity ids and grouped evidence ids now use the shared primitive/ObjectId-only serializer before provider prompt construction, and YSM A-to-Z inferred PI user ids now use the same serializer before observation emission.

Consequences:

- Object-shaped source-acquisition rows cannot execute custom `toString` or duck-typed `toHexString` hooks while LLM candidate payloads or PI identity observations are shaped.
- Unsafe candidate/entity IDs fail closed to empty grouping keys; unsafe inferred PI user ids are omitted instead of coerced.
- Static security preflight guards the student-decision LLM candidate and YSM A-to-Z PI-id boundaries.

## 2026-06-12: Access Materializer and Scraper Run IDs Avoid Generic Coercion

Access materialization source-evidence observation ids now use the shared primitive/ObjectId-only serializer, slug-resolved research entity ids stay behind the strict access-materializer ObjectId normalizer, and scraper orchestrator run ids are serialized once through the shared helper before context, append, and return handoff.

Consequences:

- Object-shaped scraper/materializer ids cannot execute custom `toString` or duck-typed `toHexString` hooks while access artifacts or run-context payloads are assembled.
- Evidence ids keep supporting primitive test/source identifiers; Mongo entity ids remain restricted to 24-hex or real `ObjectId` values.
- Static security preflight guards both the access materializer and scraper orchestrator run-id boundaries.

## 2026-06-12: Paper Quality and Profile Activity IDs Avoid Generic Coercion

Paper-quality duplicate sample owner/link ids and profile scholarly-link synthetic ids now derive only from primitive/ObjectId-safe serialized values before report or public payload shaping.

Consequences:

- Object-shaped paper-quality aggregation ids or profile paper identifier fields cannot execute custom `toString` or duck-typed `toHexString` hooks while launch quality artifacts or profile research-activity payloads are assembled.
- Unsafe paper-quality ids fail closed to empty identifiers; profile synthetic scholarly-link ids fall back to the stable `research-activity` slug when no primitive-safe identifier exists.
- Static security preflight guards both payload ID boundaries.

## 2026-06-12: Browse Rank and Repair Queue IDs Avoid Generic Coercion

Research browse-rank recomputation now derives research-entity/member/access-signal map keys through the shared primitive/ObjectId-only serializer, and visibility repair queue matched user ids now pass through the service's strict ObjectId normalizer before member/action repair work.

Consequences:

- Object-shaped service rows cannot execute custom `toString` or duck-typed `toHexString` hooks while browse-rank maintenance or repair-queue user matching builds IDs.
- Browse-rank rows with unsafe ids are skipped before scoring map output; repair-queue matched users fail closed to the existing strict ObjectId boundary.
- Static security preflight guards both service-level ID boundaries.

## 2026-06-12: Observation Store Identifier Fingerprints Use Safe Serialization

Observation-store fingerprint identifiers and source snapshot ids now derive through the shared primitive/ObjectId-only serializer instead of generic `String(...)` conversion.

Consequences:

- Object-shaped observation entity ids, entity keys, and source ids cannot execute custom `toString` or duck-typed `toHexString` hooks while append-only observations compute fingerprints or expose source metadata.
- Unsafe identifiers fail closed before fingerprint entity selection or source snapshot serialization.
- Static security preflight guards the observation-store identifier boundary.

## 2026-06-12: Scrape-Run Report Payload IDs Use Safe Serialization

Scrape-run report payload ids now derive through the shared primitive/ObjectId-only serializer instead of generic `String(...)` conversion.

Consequences:

- Object-shaped run ids, observation entity ids, and entity keys cannot execute custom `toString` or duck-typed `toHexString` hooks while operator QA artifacts are assembled.
- Unsafe report ids fail closed to empty/omitted ids rather than invoking arbitrary conversion behavior.
- Static security preflight guards the scrape-run report lookup and payload id boundary.

## 2026-06-12: Student Visibility Gate Report IDs Use Safe Serialization

Student visibility gate report and queue-planning ids now derive through the shared primitive/ObjectId-only serializer instead of generic `String(...)` conversion.

Consequences:

- Object-shaped visibility rows, research entities, lead memberships, user ids, and program ids cannot execute custom `toString` or duck-typed `toHexString` hooks while launch-critical visibility payloads are built.
- Malformed ids fail closed to empty grouping/report ids instead of invoking arbitrary conversion behavior.
- Static security preflight guards the visibility gate id boundary alongside the existing ObjectId construction guard.

## 2026-06-12: Admin Access Review DTO IDs Use Safe Serialization

Admin access-review count, evidence, and entity-list DTOs now derive ids through the shared primitive/ObjectId-only serializer instead of generic `String(...)` conversion.

Consequences:

- Object-shaped access-review rows, observations, scrape-run ids, and grouped entity ids cannot execute custom `toString` or duck-typed `toHexString` hooks while privileged review payloads are assembled.
- Unsafe ids fail closed to empty/omitted payload ids instead of coercing arbitrary objects.
- Static security preflight guards the admin access-review DTO/report id boundary.

## 2026-06-11: Evidence Coverage Impact IDs Use Safe Serialization

Research entity evidence-coverage impact reports now derive observation/entity ids through the shared primitive/ObjectId-only serializer before grouping dry-run observations or loading research-entity context.

Consequences:

- Object-shaped observation/entity ids cannot execute custom `toString` or duck-typed `toHexString` hooks while coverage impact reports are assembled.
- Unsafe ids are skipped before DB context lookup; string entity keys remain supported through a primitive-only path.
- Focused service coverage and static security preflight guard the evidence-coverage report id boundary.

## 2026-06-11: Source Acquisition Errors Avoid Pre-Sanitizer String Coercion

Source-acquisition scraper/report error fields now pass caught unknown errors directly to `sanitizeLogValue` instead of deriving messages with `String(error)` or `String(err)` first.

Consequences:

- Object-shaped error values cannot execute custom `toString` hooks while acquisition logs or report fields are shaped.
- Official-profile PI backfill, publication pointer repair, Yalies directory fetch, NSF awards fetch, rendered fetch fallback, student-decision LLM, Yale College fellowship catalog parsing, and lab microsite description extraction share the same sanitizer boundary.
- Static security preflight guards this source-acquisition error boundary.

## 2026-06-11: Search Review Error Artifacts Avoid Pre-Sanitizer String Coercion

Pathway relevance and research quality/search review report artifacts now pass caught unknown errors directly to `sanitizeLogValue` instead of deriving messages with `String(error)` first.

Consequences:

- Object-shaped error values cannot execute custom `toString` hooks while operator search/relevance review artifacts are shaped.
- Error redaction stays centralized in the shared log sanitizer.
- Static security preflight guards against reintroducing pre-sanitizer `String(error)` in source-acquisition report error paths.

## 2026-06-11: Launch Acquisition Entity IDs Use Safe Serialization

Launch acquisition report observation-count filters now derive entity ids through the shared primitive/ObjectId-only serializer instead of arbitrary object `toHexString()` or `String(...)` conversion.

Consequences:

- Object-shaped entity records cannot execute custom `toString` or duck-typed `toHexString` hooks while beta launch acquisition reports group blockers.
- Nested `{ _id }` records remain supported when the nested id is a primitive or real ObjectId.
- Static security preflight guards the launch acquisition entity-id boundary.

## 2026-06-11: Legacy Research Public DTO IDs Use Safe Serialization

Legacy research browse/detail public DTOs now derive research-entity hit ids, active-listing grouping ids, access-summary lookup ids, and research-detail listing ids through the shared primitive/ObjectId-only serializer.

Consequences:

- Object-shaped stored research/listing ids cannot execute custom `toString` or duck-typed `toHexString` hooks while public research payloads are shaped.
- Unsafe public detail listing ids fail closed to an empty id instead of exposing raw database objects or coercing them.
- Static security preflight guards the legacy research public DTO id boundary.

## 2026-06-11: Public Profile Research-Home IDs Use Safe Serialization

Public profile research-home loading now derives membership research-entity ids and loaded entity ids through the shared primitive/ObjectId-only serializer before dedupe/profile shaping.

Consequences:

- Malformed stored membership or research-entity ids cannot execute custom `toString` or duck-typed `toHexString` hooks while public profile responses are assembled.
- Unsafe profile research-home ids fail closed before membership role lookup and public profile shaping.
- Static security preflight guards the profile research-home id boundary.

## 2026-06-11: Mongo Pathway Search Result IDs Use Safe Serialization

Mongo-backed public pathway search results now derive pathway hit ids and active posted-opportunity ids through the shared primitive/ObjectId-only serializer instead of generic `String(...)` conversion.

Consequences:

- Object-shaped search records cannot execute custom `toString` or duck-typed `toHexString` hooks while public Ways In payloads are shaped.
- Unsafe pathway/opportunity result ids fail closed to an empty id instead of being coerced.
- Focused service coverage and static security preflight guard the Mongo pathway search result boundary.

## 2026-06-11: Admin Operator Board IDs Use Safe Serialization

Admin operator board DTOs now derive run/sample ids through the shared primitive/ObjectId-only serializer instead of generic `String(record._id)` conversion.

Consequences:

- Object-shaped admin board records cannot execute custom `toString` or duck-typed `toHexString` hooks while beta-readiness payloads are shaped.
- Unsafe research/program/release/repair sample ids fail closed to an empty id and safe fallback label instead of being coerced.
- Focused service coverage and static security preflight guard the operator-board id boundary.

## 2026-06-11: Posted Opportunity Maintenance IDs Use Safe Serialization

Posted opportunity upsert, listing backfill, and backfill reporting ids now use the shared primitive/ObjectId-only serializer instead of generic `String(...)` or arbitrary object stringification. Backfill skips listings whose ids cannot be safely serialized.

Consequences:

- Object-shaped listing, posted-opportunity, or entry-pathway ids cannot execute custom `toString` or duck-typed `toHexString` hooks during maintenance planning/reporting.
- Backfill candidate/materialized id summaries include only safe primitive or real ObjectId-derived strings.
- Focused service coverage and static security preflight guard the posted-opportunity id boundary.

## 2026-06-11: Research Access Write Return IDs Use Safe Serialization

Entry pathway, access signal, and contact route write services now serialize returned document ids and search-index sync ids through the shared primitive/ObjectId-only serializer. They no longer use generic `String(doc._id)` or `String(doc.entryPathwayId)` on Mongoose-returned records.

Consequences:

- Object-shaped returned ids cannot execute custom `toString` or duck-typed `toHexString` hooks while services shape upsert results.
- Pathway search index sync is skipped when a returned pathway/entity id cannot be safely serialized.
- Focused service tests and static security preflight guard the research access write-service return boundary.

## 2026-06-11: Meili Index Document IDs Use Safe Serialization

Shared Meilisearch sync and research-entity index document builders now derive index ids only through the shared primitive/ObjectId-only serializer. Index document construction skips records whose `_id` or fallback `id` cannot be safely serialized.

Consequences:

- Object-shaped stored ids cannot execute custom `toString` or duck-typed `toHexString` hooks while sync services build Meili payloads.
- Listing, paper, and research-entity index documents share the same safe id boundary.
- Static security preflight and Meili sync tests guard against returning to generic `String(doc._id)` or `String(rawId)` conversion.

## 2026-06-11: Pathway Search Index IDs Use Safe Serialization

Pathway search index document construction now uses the shared primitive/ObjectId-only serializer for pathway, research-entity, and active posted-opportunity ids. It no longer accepts arbitrary objects merely because they expose a `toHexString` method.

Consequences:

- Object-shaped pathway index inputs cannot execute custom `toString` or duck-typed `toHexString` hooks while public search documents are built.
- Inputs with unsafe ids are omitted from batch index document output instead of being coerced.
- Static security preflight and pathway index tests guard the search-index id boundary.

## 2026-06-11: Access Summary Entity IDs Use Safe Serialization

Public access summary assembly now derives requested ids, returned signal/pathway/opportunity grouping keys, and single-summary lookups through the shared primitive/ObjectId-only serializer plus the existing 24-hex allowlist. It no longer calls generic `String(...)` on returned `researchEntityId` values.

Consequences:

- Malformed stored access rows cannot execute custom `toString` or duck-typed `toHexString` hooks while public summaries are grouped.
- Rows with unsafe entity ids are skipped instead of being associated with a public summary.
- Static security preflight and access-summary tests guard the public summary id boundary.

## 2026-06-11: Fellowship and Item Mutation IDs Use Safe Serialization

Public fellowship DTOs, fellowship admin reviewer ids, and shared item view/favorite mutations now derive ids through the shared primitive/ObjectId-only serializer. They no longer accept arbitrary objects merely because they expose `toHexString`.

Consequences:

- Object-shaped fellowship or item ids cannot execute custom `toString` or duck-typed `toHexString` hooks during public serialization, admin updates, view increments, or favorite mutations.
- Shared item operations reject unsafe ids before model mutation work.
- Focused service tests and static security preflight guard the fellowship/item id boundary.

## 2026-06-11: Fellowship Matching IDs Use Safe Serialization

Fellowship matching now derives match fellowship ids through the shared primitive/ObjectId-only serializer. It no longer accepts arbitrary fellowship records merely because their id field exposes a `toHexString` method.

Consequences:

- Object-shaped fellowship ids cannot execute custom `toString` or duck-typed `toHexString` hooks while funding matches are scored.
- Unsafe fellowship ids are skipped before match payloads are built.
- Focused matching tests and static security preflight guard the fellowship matching id boundary.

## 2026-06-11: Listing Meili Sync IDs Use Safe Serialization

Listing create/update Meilisearch sync now derives index ids through the shared primitive/ObjectId-only serializer. It no longer calls `doc._id.toString()` while shaping listing index documents.

Consequences:

- Object-shaped listing ids cannot execute custom `toString` or duck-typed `toHexString` hooks during listing index sync.
- Listing index sync is skipped when a saved listing id cannot be safely serialized.
- Focused listing-service tests and static security preflight guard the listing index id boundary.

## 2026-06-11: Admin DTO IDs Avoid Arbitrary Object Coercion

Admin response DTOs now serialize ids only from primitive strings, finite numbers, or real `mongoose.Types.ObjectId` instances. They no longer call arbitrary object `.toString()` methods while shaping admin listings, fellowships, taxonomy rows, or access-review records.

Consequences:

- Stored or mocked object-shaped ids cannot execute custom stringification during admin response serialization.
- Admin DTO tests cover malicious ids that throw on `.toString()`.
- Static security preflight blocks the prior generic `adminPayloadId(...toString...)` sink.

## 2026-06-11: Public API DTO IDs Use Primitive/ObjectId Serialization

Authenticated listing, account listing, and public program DTOs now use a shared id serializer that accepts only primitive strings, finite numbers, or real `mongoose.Types.ObjectId` instances. These normal API response paths no longer call optional `.toString()` or duck-typed `toHexString()` methods on arbitrary document-shaped objects.

Consequences:

- Object-shaped stored ids cannot execute custom stringification hooks while public/account DTOs are being serialized.
- The shared serializer has focused regression coverage for malicious `toString` and `toHexString` hooks.
- Static security preflight guards the listing, account listing, and program DTO call sites.

## 2026-06-11: Seed Summary IDs Use Safe DTO Serialization

Local token-gated seed routes already return minimal user/listing summaries, but those summaries now also use the shared primitive/ObjectId-only id serializer. They no longer call arbitrary `_id.toString()` methods on service-returned objects.

Consequences:

- Malformed service-returned ids cannot execute custom stringification while seed success payloads are shaped.
- Seed route tests cover a malicious id object with a throwing `toString` hook.
- Static security preflight guards both seed user and listing summary id serialization.

## 2026-06-11: Admin Grant Actor NetIDs Require Primitive Strings

Admin grant and revoke handlers now derive the actor NetID only from primitive Yale-style string principals. Even though the admin router middleware already rejects malformed principals before normal route execution, direct handler invocation and future refactors must not call arbitrary object stringification hooks on `req.user`.

Consequences:

- Object-shaped `req.user.netId` or `req.user.netid` values produce an empty actor id instead of invoking `.toString()`.
- Admin grant route tests cover a throwing actor principal.
- Static security preflight guards the primitive actor NetID helper.

## 2026-06-11: Beta Data Quality Artifact Reads Use Safe JSON Roots

Beta data-quality scorecard helpers now resolve saved JSON artifact paths through the shared safe report-path guard before checking existence or reading. Operator-provided duplicate-name decision-validation and same-PI dedupe review artifacts must live under the OS temp directory or project `tmp/` and must be `.json` files.

Consequences:

- Local beta readiness tooling cannot be pointed at arbitrary filesystem paths for status extraction.
- The generated command metadata remains useful, but existing artifact reads fail closed before synchronous JSON parsing.
- Static security preflight and focused beta data-quality tests guard the read boundary.

## 2026-06-11: Local Process Execution Is Explicitly Shell-Free

Release and scraper helper processes use argument-array child process APIs and now explicitly set `shell: false` at the call sites that launch Python, Yarn, or Git. This documents the command-injection boundary and gives static preflight a concrete invariant to guard.

Consequences:

- Rendered fetches, gate refreshes, beta seed orchestration, scheduled gate refreshes, and the local secret scanner do not route operator-controlled arguments through a shell.
- Future edits that add `shell: true` or remove the explicit shell-free marker in these call sites fail static security preflight.

## 2026-06-11: Scraper Context Logs Sanitize Metadata

The shared scraper `ctx.log` helper now sanitizes both message text and structured metadata before writing to console. Scrapers can still provide operational context, but arbitrary metadata must not bypass the same redaction boundary used for errors and reports.

Consequences:

- Credential-bearing URLs, tokens, cookies, authorization headers, emails, and phones in scraper log messages or metadata are redacted centrally.
- Individual scrapers no longer need to remember to sanitize every `ctx.log(..., meta)` call.
- Static security preflight and orchestrator tests guard the helper boundary.

## 2026-06-11: ScrapeRun Error Artifacts Are Sanitized

Scraper run failures now sanitize error messages before persisting them on `ScrapeRun`, and run reports sanitize both error messages and mixed error context before writing operator artifacts. Run-error stacks are not persisted by the orchestrator failure path.

Consequences:

- Credential-bearing URLs, tokens, emails, phones, cookies, and authorization headers are redacted before report serialization.
- Report error context is serialized through the shared log sanitizer instead of carrying arbitrary mixed objects forward.
- Static security preflight and focused scraper tests guard persistence and report serialization.

## 2026-06-11: Scraper Cron Heartbeat Errors Are Sanitized

Production scraper cron heartbeat failures now log through `sanitizeLogValue` instead of printing raw error messages. Heartbeat errors can originate from MongoDB/driver or lock infrastructure, so logs must not expose connection strings, credentials, source URLs, or request/config objects.

Consequences:

- `cronRunner` keeps its operational heartbeat warning but sanitizes the caught exception object.
- Static security preflight blocks returning to raw `error.message` heartbeat logging.

## 2026-06-11: Log Sanitization Covers Structured Token Fields

Server log sanitization now redacts whole secret-bearing JSON fields and header lines, including semicolon-delimited cookies and common camelCase token names. Error logging already routes through `sanitizeLogValue`; this change makes that boundary safer for real request/config objects.

Consequences:

- `accessToken`, `refreshToken`, `idToken`, `csrfToken`, `clientSecret`, `setCookie`, and seed-token names are explicitly treated as secret fields.
- `Authorization`, `Cookie`, `Set-Cookie`, seed-token, and CSRF-token header lines are redacted as a whole instead of only redacting a prefix.
- Static security preflight and focused sanitizer tests guard the redaction patterns.

## 2026-06-11: Express Query Parsing Is Flat

Express now pins `query parser` to `simple` so URL query strings remain flat strings or arrays before validation and Mongo-shape sanitization. The app does not depend on nested query-object syntax for filters, and bracket-key syntax is already treated as unsafe input.

Consequences:

- Parser-dependent payloads such as `field[$ne]=...` remain literal query keys and fail the existing bracket-key sanitizer instead of being materialized into nested objects.
- Search and filter routes continue to use comma/pipe-delimited flat query values.
- Static security preflight and an app runtime test guard the parser setting.

## 2026-06-11: Legacy Browser XSS Auditor Is Disabled

Modern browsers removed or ignore legacy reflected-XSS auditors, and older auditors can create inconsistent behavior or filter-bypass gadgets. The app already relies on CSP and React text rendering for XSS defense, so legacy auditor behavior should be explicitly disabled.

Consequences:

- Security headers now send `X-XSS-Protection: 0` on every response.
- Existing CSP, `script-src-attr 'none'`, object/frame blocking, and MIME-sniffing protections remain the primary browser-side injection controls.
- Static security preflight and focused security-header tests guard the header.

## 2026-06-11: Global Error Handler Delegates After Headers Are Sent

Late async or stream errors can happen after Express has already started a response. The global error handler should still sanitize logs, but it must not try to write a second JSON error body after headers are sent.

Consequences:

- `errorHandler` now delegates to Express with `next(error)` when `res.headersSent` is already true.
- Normal pre-response errors still receive fixed public error bodies.
- Static security preflight and error-handler tests guard the late-error delegation path.

## 2026-06-11: Auth Private Responses Include Surrogate No-Store

Authentication responses can contain CAS callback state, current-session summaries, logout redirects, or local-dev login redirects. They already set browser no-store headers and are under the global `/api` no-store middleware, but the auth-local helper should also be complete when handlers are invoked directly or middleware order changes.

Consequences:

- CAS, auth-check, logout, and dev-login responses now set `Surrogate-Control: no-store` through the shared auth helper.
- The existing `Cache-Control: no-store, private, max-age=0` and `Pragma: no-cache` behavior is unchanged.
- Static security preflight and Passport auth/logout tests guard the surrogate no-store invariant.

## 2026-06-11: Logout Rejects Implicit HEAD Handling Before Mutation

Express can route `HEAD` requests through a `GET` handler when no explicit HEAD handler exists. `/api/logout` is intentionally a GET route for CAS compatibility, but HEAD must not become an alternate state-changing logout method.

Consequences:

- The logout handler now returns `405 Method not allowed` with `Allow: GET` for non-GET methods before origin checks, analytics, session clearing, or CAS redirect work.
- GET logout retains existing origin checks, private no-store headers, and write-like rate limiting.
- Static security preflight and Passport route tests guard against implicit HEAD logout mutation.

## 2026-06-11: State-Changing Safe-Method Routes Consume Write Limits

Most GET, HEAD, and OPTIONS API requests should not consume the narrower write budget, but `/api/logout` is a state-changing GET route because it clears the local session before redirecting to CAS logout. It already has origin checks; it should also share mutation-rate protection.

Consequences:

- The app now classifies `/api/logout` as write-like for rate limiting even though it uses GET.
- Normal safe-method reads still bypass the write limiter and keep the broader read budget.
- Static security preflight and app runtime tests guard the write-like safe-method route classification.

## 2026-06-11: Analytics Event Types Are Service-Allowlisted

Analytics events are written from many route helpers and auth flows. Runtime event type values should be validated before constructing persistence payloads or applying user-metric side effects, not left for the Mongoose enum to reject after a write attempt.

Consequences:

- `logEvent` now accepts only known `AnalyticsEventType` values before building an analytics document.
- Malformed event types are dropped before analytics persistence and before login/user metric updates.
- Static security preflight and analytics service tests guard the event-type allowlist.

## 2026-06-11: Rate-Limit User Buckets Require Primitive NetIDs

Rate-limit keys are derived from session identity when available, then fall back to IP. Session-shaped values should not trigger object coercion or create unbounded user-bucket cardinality, even when they come from signed cookies or local bypass flows.

Consequences:

- API rate-limit user buckets now accept only bounded Yale-style primitive NetID strings.
- Valid user buckets are lowercased before keying; malformed or object-shaped identities fall back to the IP bucket.
- Static security preflight and app runtime tests guard the no-coercion rate-limit boundary.

## 2026-06-11: Local Saved-Plan Drafts Are Scoped To Current Saved Pathways

Saved research-plan drafts are stored in origin localStorage, which can persist across Yale account switches on shared browsers. Hydration now filters local drafts to pathway IDs currently saved by the authenticated account before merging with server-backed plans or uploading local-only drafts.

Consequences:

- Local drafts for pathways not saved by the current account are ignored during account hydration.
- Local-only draft migration uploads only drafts whose pathway IDs are in the current account's saved list.
- Static security preflight and account helper tests guard the current-account filtering step.

## 2026-06-11: Google OAuth Popup Requests Noopener At Creation

Google Sheets export OAuth already opens a neutral popup, clears `popup.opener`, and uses a state-scoped BroadcastChannel. The popup feature string now also requests `noopener,noreferrer` at `window.open` time so browsers that honor feature flags do not create an opener relationship even briefly.

Consequences:

- The explicit `popup.opener = null` defense remains before provider navigation.
- The feature string includes `noopener,noreferrer` to reduce opener/tabnabbing race exposure.
- Static security preflight guards against regressing to the opener-bearing popup feature string.

## 2026-06-11: Required Body Fields Must Be Own Properties

Generic required-field validation should not accept inherited or prototype-chain properties as satisfying request body requirements. Even though API requests pass through Mongo/prototype-pollution sanitization, `requireFields` is a reusable middleware and should fail closed if reused in a different route stack or with a non-plain request object.

Consequences:

- `requireFields` checks `Object.prototype.hasOwnProperty.call(body, field)` instead of the `in` operator.
- Prototype-chain body properties no longer satisfy required fields.
- Static security preflight and validation middleware tests guard the own-property requirement.

## 2026-06-11: Rendered Scraper Fetches Fail Closed On Seed Redirects

The optional Scrapling renderer runs outside Node's HTTP client stack, so it cannot inherit the shared SSRF-safe lookup agent for redirect hops. Before invoking the Python renderer, Node now performs a no-follow `HEAD` preflight with the SSRF-safe agent and blocks rendered fetching if the seed URL redirects or if the preflight cannot complete.

Consequences:

- DB-stored or scraped URLs still pass through `assertPublicHttpUrl` before rendering.
- Immediate seed redirects are blocked before Python receives the URL.
- Final rendered URLs are still required to be public and same-origin with the seed URL before content is materialized.
- Static security preflight guards the rendered-fetch redirect preflight.

## 2026-06-11: Logout Fails Closed On Present Bad Origin

The logout route redirects through Yale CAS and mutates the local authenticated session, so deployed logout requests must treat a present `Origin` header as authoritative. If that header is malformed, oversized, `null`, or not the configured application origin, logout is rejected rather than falling back to a trusted-looking `Referer`.

Consequences:

- `Referer` remains a fallback only when `Origin` is absent.
- Cross-site logout attempts cannot be rescued by a spoofed or stale referer value.
- Static security preflight and logout route tests guard the origin-precedence rule.

## 2026-06-11: Scraper Tests Must Use Synthetic Profile Fixtures

Scraper tests may use Yale-shaped domains and markup patterns, but they must not embed real Yale profile names, slugs, image paths, or email addresses. The department roster Drupal views-row fixture now uses synthetic profile identities while preserving the obfuscated-email extraction behavior under test.

Consequences:

- The fixture keeps Yale-style HTML and encoded `mailto:` structure without real person identifiers.
- Static preflight blocks the discovered real names, slugs, and email fragment from re-entering test files.
- Future scraper fixtures should prefer names/slugs that include obvious synthetic markers when possible.

## 2026-06-11: Unsafe Requests Fail Closed On Present Bad Origin

For unsafe HTTP methods, a present `Origin` header is authoritative. If that header is malformed, oversized, `null`, or not in the deployment allowlist, the CSRF guard rejects the request instead of falling back to a trusted-looking `Referer`.

Consequences:

- `Referer` remains a fallback only when `Origin` is absent.
- Present untrusted origins cannot be rescued by a spoofed or stale referer value.
- Static security preflight and middleware tests guard the fail-closed origin precedence.

## 2026-06-11: Public Config Cache Headers Are Internally Consistent

The public `/api/config` response is intentionally cacheable because it returns bounded, contact-redacted taxonomy configuration. Since global `/api` middleware defaults JSON responses to private no-store, this route must remove inherited legacy cache blockers and make origin-varying behavior explicit before sending the public payload.

Consequences:

- `/api/config` keeps `Cache-Control: public, max-age=300`.
- The route removes inherited `Pragma` and `Surrogate-Control` headers so browser/proxy/CDN behavior is not contradictory.
- The route explicitly varies by `Origin` to preserve correct CORS cache partitioning for deployment origins.
- Static security preflight guards these header invariants.

## 2026-06-11: Search Pagination Rejects Numeric Coercion Forms

Search pagination inputs should not rely on generic JavaScript numeric coercion because decimal, exponent, signed, zero, and unsafe-integer strings can produce surprising offsets before later caps apply.

Consequences:

- Public research search and pathway search page/page-size inputs now accept only safe positive integer numbers or compact positive-integer strings.
- Program, fellowship, authenticated listing search, and profile-publication page/page-size normalization use the same compact positive-integer boundary before skip/limit calculations.
- Static security preflight blocks regressions to `Number.isFinite(...)` coercion in these search pagination paths.

## 2026-06-11: Authenticated Listing Reader DTOs Redact All Public Text

Legacy listing search/detail/view responses are authenticated but still broadly available to signed-in users. Listing title, status, taxonomy, type, commitment, and compensation fields can contain professor-entered or imported free text, so they should follow the same direct-contact privacy boundary as listing descriptions, account listing DTOs, and profile listing DTOs.

Consequences:

- `publicListingForAuthenticatedReader` now passes title, hiring status, departments, research areas, keywords, type, commitment, and compensation type through the direct-contact redaction boundary.
- Existing owner/collaborator/internal field omissions and HTTP(S)-only website filtering remain in place.
- Static security preflight blocks raw listing text/taxonomy passthrough from returning in authenticated listing reader DTOs.
- Listing skeleton initialization also returns the authenticated-reader DTO instead of echoing the raw skeleton listing document.
- Account owned/favorited listing DTOs also redact `hiringStatus`, closing the remaining status-field bypass in saved/owned listing views.

## 2026-06-11: Research Quality Review Fatal Logs Are Sanitized

The research quality search review script can fail while connected to MongoDB, Meilisearch, or report output paths. Its structured review rows may still record bounded search-error messages for operator review, but the top-level fatal handler now logs through `sanitizeLogValue(error)` so request configs, credentials, URLs, or stack detail are not printed directly to operator consoles.

## 2026-06-11: Programmatic New-Tab Opening Is HTTP(S)-Only

`openSafeUrlInNewTab` now uses `safeHttpUrl` instead of the broader `safeUrl` helper. Explicit email actions still use `safeMailtoHref`, but programmatic popup/new-tab flows such as Google Sheets export should only navigate browser windows to public HTTP(S) destinations with `noopener,noreferrer` and a nulled opener reference.

## 2026-06-11: Malformed Account LocalStorage Fails Closed

Account saved-plan and tracking hydration now removes malformed JSON payloads after parse failure, matching the existing oversized-payload removal behavior. Same-origin localStorage is treated as attacker-controllable state after XSS, extension, or stale-client corruption, so invalid private planning/tracking payloads should be dropped permanently instead of being re-read on every account load.

## 2026-06-11: CSP Form Actions Exclude Google OAuth

Google Sheets OAuth uses a popup navigation plus state-scoped BroadcastChannel callback, not a browser form submission. The global CSP `form-action` directive now permits only self and Yale CAS form targets, removing `https://accounts.google.com` so injected markup cannot submit application page data to Google through an allowed form target.

## 2026-06-11: Student Program/Fellowship DTOs Omit Internal Metadata

Student-facing program and fellowship responses should not expose persistence timestamps, raw search scores, or visibility-computation audit fields. Those values are useful for operator workflows, but they are not required for students to decide whether a program/fellowship is relevant and can reveal internal curation state.

Consequences:

- Public program payloads keep the coarse student visibility tier but omit computed-tier audit reasons and persistence timestamps.
- Public fellowship DTO/search allowlists omit persistence timestamps and raw text-search score metadata.
- Static security preflight blocks these internal metadata fields from re-entering student-facing program/fellowship payloads.

## 2026-06-11: Public Provenance Labels Are Contact-Redacted

Student-facing source/provenance labels are public UI text and can originate from scraped or operator-entered source metadata. They should not bypass the same direct-contact privacy boundary used for descriptions, excerpts, links, and evidence labels.

Consequences:

- Public program and fellowship `sourceName` values now pass through direct-contact redaction before serialization.
- Public scholarly-link `displaySource` and `discoveredVia` labels now use a shared bounded source-label sanitizer.
- Static security preflight blocks raw source-label passthrough on these student-facing payloads.

## 2026-06-11: Seed Routes Return Minimal Summaries

Development seed routes remain local-runtime-only and token-gated, but they should not echo full user or listing documents after writes or reads. Full documents can contain direct contact fields, profile metadata, listing internals, and source-derived content that are not needed to confirm seed-route success.

Consequences:

- Seed user create/update responses return only id, NetID, user type, and confirmation/verification status.
- Seed listing list/update responses return only listing id and departments.
- Seed-route cache headers now also include `Surrogate-Control: no-store`.
- Static security preflight blocks raw seed user/listing document echo from returning.

## 2026-06-11: Public Research Detail Fan-Out Is Query-Bounded

The public research detail endpoint aggregates members, listings, pathways, signals, contact routes, posted opportunities, relationships, and scholarly activity. Because the endpoint is unauthenticated, it should cap collection fan-out at the database query boundary rather than relying only on response shaping after unbounded reads.

Consequences:

- Public detail member, listing, pathway, signal, route, opportunity, and relationship queries use explicit `.limit(...)` caps before serialization.
- Existing public DTO redaction remains the privacy boundary for returned text, URLs, and contact surfaces.
- Static security preflight covers the detail-query fan-out caps so future public-detail expansions do not reintroduce unbounded aggregation.

## 2026-06-11: Public Discovery Reads Have a Narrower Rate Limit

Research discovery and posted-opportunity detail endpoints are intentionally public, but they can perform Meilisearch requests and multi-collection Mongo fan-out. They should not rely only on the broad general API request budget.

Consequences:

- `/api/research` and `/api/opportunities` now share an additional 60-request per 15-minute discovery-read limiter after the general API limiter.
- The limiter keys by authenticated user when present and falls back to IP for anonymous visitors, matching the existing global limiter behavior.
- Static security preflight covers the mounted limiter so public discovery endpoints do not silently regress to the general API budget only.

## 2026-06-11: Operator Board Artifact Reads Are Size-Bounded

The admin operator board reads deployment-gate JSON scorecards from constrained artifact paths. Path confinement prevents traversal, but allowed roots can still contain unexpectedly large files that would be read and parsed synchronously during admin board requests.

Consequences:

- Operator-board gate artifact parsing now rejects non-files and files larger than 2 MiB before `readFileSync` and `JSON.parse`.
- Existing safe JSON artifact root confinement remains required for every configured gate path.
- Static security preflight covers the central artifact parser so new board artifact readers use the size-bounded helper.

## 2026-06-11: Fixed External Directory/Course Calls Bound Caller Inputs

Yale Directory and CourseTable integrations call fixed public hosts with timeouts, but their caller-provided query strings still need local bounds before request construction and cache-key use.

Consequences:

- Directory lookups cap and normalize search strings before JSON or HTML directory requests and fall back to an allowlisted search type.
- CourseTable season fetches require Yale semester-shaped season codes, and professor-name lookups cap normalized names before cache keys or matching.
- Static security preflight covers these boundaries so fixed-host integrations do not regress to unbounded caller strings.

## 2026-06-11: Application CTAs Require HTTP(S) URLs

The shared client URL helper intentionally supports `mailto:` for explicit email actions, but application/source CTAs should not inherit that broader scheme set. Application CTAs are navigational links to official application routes and should be HTTP(S)-only.

Consequences:

- Pathway, opportunity-detail, admin access-review, program-modal, research-detail, fellowship rich-text/generic-link, and research contact-route CTAs use `safeHttpUrl` instead of `safeUrl` for application, official-route, or API-text links.
- Explicit email CTAs continue to use `safeMailtoHref`.
- Static security preflight covers these CTA boundaries so broad URL helpers are not reused for application links.

## 2026-06-11: Non-Email Public Links Use HTTP(S)-Only Client Guards

The shared browser `safeUrl` helper intentionally supports `mailto:` for explicit email actions. Public website, social, profile, ORCID, and open-access publication links are document/navigation surfaces, not email actions, so they should use the narrower HTTP(S)-only helper.

Consequences:

- Developer-card website/social links now use `safeHttpUrl` instead of `safeUrl`.
- Faculty ORCID/profile header and publication open-access links now use `safeHttpUrl` before rendering.
- Static security preflight blocks those surfaces from regressing to the broader `safeUrl` helper.

## 2026-06-11: Auth Session Principals Reject Object Coercion

Session and auth-check principal fields can be influenced by signed cookie/session state and local bypass headers in development. Principal normalization should not call generic `String(...)` on unknown values because object-shaped values can trigger arbitrary coercion before validation.

Consequences:

- Auth NetIDs are accepted only from primitive strings matching the Yale-shaped NetID pattern.
- Session user types are accepted only from primitive strings in the allowlist; malformed values become `unknown`.
- Static security preflight covers the primitive-only auth normalizers.

## 2026-06-11: Publication Pointer Repair Fetches Are SSRF-Guarded

The official-profile publication-pointer repair script crawls profile and faculty-site URLs derived from stored user/profile data. Those repair fetches should use the same SSRF boundary as scraper fetches, not raw axios URL fetching.

Consequences:

- Repair page fetches validate public HTTP(S) URLs before outbound requests.
- Axios uses shared SSRF-safe HTTP(S) agents so redirect/connect-time DNS resolution cannot reach private addresses.
- TLS verification remains enabled; the repair path does not bypass certificate failures.

## 2026-06-11: Official Profile PI Backfill Fetches Are SSRF-Guarded

The official-profile PI backfill fetches Yale profile/person pages from queued entities and stored profile URLs. URL validation must happen before cache lookup and before outbound axios requests so stored or scraped URLs cannot steer the scraper toward private network addresses.

Consequences:

- PI backfill page fetches validate public HTTP(S) URLs before cache-key construction.
- Cache keys are derived from the normalized safe URL, not the raw input string.
- Axios uses shared SSRF-safe HTTP(S) agents for connect-time DNS blocking on initial requests and redirects.

## 2026-06-11: Department Research Page Fetches Are SSRF-Guarded

The department-undergrad-research scraper has Yale defaults, but its page list is configurable. Configured page fetches should still go through the shared outbound URL boundary before cache or network work.

Consequences:

- Configured department research page URLs validate as public HTTP(S) before cache-key construction.
- Cache keys use the normalized safe URL.
- Axios uses shared SSRF-safe HTTP(S) agents for connect-time DNS blocking.

## 2026-06-11: Fellowship Catalog Fetches Are SSRF-Guarded

The Yale College fellowships scraper has official Yale defaults and avoids fetching gated CommunityForce application URLs, but the catalog page list is configurable and detail pages can be discovered from page content. Catalog/detail page fetches should still share the same outbound URL protection as other scraper crawlers.

Consequences:

- Fellowship catalog page fetches validate public HTTP(S) URLs before cache-key construction.
- Cache keys use the normalized safe URL rather than raw input.
- Axios uses shared SSRF-safe HTTP(S) agents and bounded redirects for catalog/detail page fetches.

## 2026-06-11: Yale Research Directory Fetches Are SSRF-Guarded

The Yale Research official scraper has fixed Yale defaults but also supports configured directory lists and pagination. Directory fetches should validate outbound URLs before cache and network work.

Consequences:

- Configured and paginated research-directory URLs validate as public HTTP(S) before cache-key construction.
- Cache keys use the normalized safe URL.
- Axios uses shared SSRF-safe HTTP(S) agents and bounded redirects.

## 2026-06-11: Department Roster Fetches Are SSRF-Guarded

Department roster scraping accepts per-department HTML URLs and optional JSON data endpoints. Those configured endpoints should not be fetched or cached from raw strings.

Consequences:

- Department roster HTML URLs and data endpoints validate as public HTTP(S) before cache-key construction.
- Cache keys use normalized safe URLs for both page and data endpoint fetches.
- Axios GET and POST requests use shared SSRF-safe HTTP(S) agents and bounded redirects.

## 2026-06-11: Centers and Institutes Fetches Are SSRF-Guarded

Centers/institutes scraping accepts per-center configured people and listing pages. Those page fetches should use the shared outbound URL boundary before cache or network work.

Consequences:

- Configured center/institute page URLs validate as public HTTP(S) before cache-key construction.
- Cache keys use normalized safe URLs.
- Axios uses shared SSRF-safe HTTP(S) agents and bounded redirects.

## 2026-06-11: YSE and YSM Index Detail Fetches Are SSRF-Guarded

The YSE centers scraper and YSM A-to-Z lab scraper fetch fixed official indexes, then follow source-discovered detail or lab-homepage URLs. Those followed URLs should be validated before cache or outbound requests.

Consequences:

- Fixed YSE/YSM index fetches use the shared public HTTP(S) guard and SSRF-safe agents.
- Source-discovered YSE access-detail and YSM lab-homepage URLs validate before cache-key construction.
- Detail and lab-homepage cache keys use normalized safe URLs, with bounded redirects and SSRF-safe agents on axios.

## 2026-06-11: Fellowship Recipient Page Fetches Are SSRF-Guarded

The undergraduate fellowship recipient scraper fetches configured public recipient-list URLs and also supports manual local inputs. Network recipient-list fetches should use the shared outbound URL boundary before cache or axios work.

Consequences:

- Configured recipient-list URLs validate as public HTTP(S) before cache-key construction.
- Recipient page cache keys use normalized safe URLs.
- Axios uses shared SSRF-safe HTTP(S) agents and bounded redirects.

## 2026-06-11: LLM and Profile Source Fetches Use Normalized SSRF-Safe URLs

LLM-backed lab/center extractors and profile bio/audit scripts fetch URLs sourced from stored entities or source-discovered pages. These fetches already validate public HTTP(S) URLs and use SSRF-safe agents, but axios should receive the normalized validated URL rather than the original raw string.

Consequences:

- Lab microsite, center director, center affiliation, undergraduate-access, profile-bio, and profile-audit fetches pass `safeUrl.toString()` to axios.
- Raw input URLs are not reused as axios destinations after validation.
- These fetches use bounded redirects and SSRF-safe HTTP(S) agents.

## 2026-06-11: OpenAlex API Fetches Use the Shared SSRF Boundary

The OpenAlex paper scraper normally calls a fixed public API base, but its default fetcher accepts a URL argument internally. Public API integrations should still use the shared outbound boundary so future call-site changes do not bypass SSRF controls.

Consequences:

- OpenAlex fetches validate the destination as public HTTP(S) before axios.
- Axios receives the normalized safe URL, not the raw fetcher argument.
- OpenAlex requests use shared SSRF-safe HTTP(S) agents and bounded redirects.

## 2026-06-11: Test Fixtures Must Not Preserve Real Yale Identifiers

Security and privacy tests can use Yale-shaped fixture domains, but they should not preserve real Yale person names, profile slugs, NetIDs, or ORCID values. Real-looking identifiers in tests are durable repo data and can leak or normalize accidental use of production-derived records.

Consequences:

- High-confidence real Yale profile/person identifiers in tests are replaced with synthetic fixture identifiers.
- Static security preflight denies the known real identifier cluster from reappearing in test files.
- Synthetic `@yale.edu` examples remain allowed only when they are clearly fixture data needed to exercise redaction and parser behavior.

## 2026-06-11: Service Sync Error Logs Are Sanitized

Runtime service-layer sync failures can involve Meilisearch hosts, API keys, Mongo documents, or nested request configuration. These background sync paths should not print raw caught error objects.

Consequences:

- Listing-to-PostedOpportunity, listing-profile, and listing search-sync failures sanitize caught errors before console output.
- Entry pathway, access signal, contact route, posted opportunity, and shared Meilisearch sync failures use `sanitizeLogValue`.
- Static security preflight covers service-layer raw error logging regressions.

## 2026-06-11: Log Sanitization Covers JSON/Header Secret Forms

The central log sanitizer is now the shared boundary for runtime, auth, external API, scraper, and operator-script errors. It must redact both human-readable assignment strings and serialized request/config objects.

Consequences:

- Sanitization redacts bearer and basic authorization tokens, bare OpenAI-style `sk-` keys, credentialed URLs, email addresses, and phone numbers.
- Secret-like `key=value` fields and JSON/header-style `key: value` fields redact API keys, access/refresh tokens, CAS tickets, passwords, authorization headers, cookies, and set-cookie values.
- Static preflight asserts these sanitizer patterns stay present as more error paths adopt `sanitizeLogValue`.

## 2026-06-11: Public Research Detail Listings Redact Direct Contact Text

Research detail pages are public and include active listing summaries. Listing prose and taxonomy arrays can contain direct contact emails or phone numbers, so the active-listing detail payload must use the same public redaction boundary as pathways, signals, opportunities, and public research entity fields.

Consequences:

- Active listing titles, descriptions, applicant descriptions, status/type/commitment text, departments, research areas, and keywords are redacted before public research detail responses.
- Public listing text and arrays are bounded before serialization.
- Static security preflight covers the research-detail active listing redaction path.

## 2026-06-11: Operator Error Logs Avoid Raw Messages and User Identifiers

Credentialed operator scripts often run with MongoDB URLs, API tokens, or production-derived identity data available in process state. Top-level and per-record failures should not print raw exception messages or user identifiers such as NetIDs.

Consequences:

- Remaining operator-script fatal handlers use `sanitizeLogValue(error)` instead of raw `error.message` fallbacks.
- Profile-bio backfill per-candidate failures no longer include candidate NetIDs in console output.
- Admin access-review validation responses return fixed public error copy rather than raw exception messages.

## 2026-06-11: External Directory Fetch Errors Do Not Log Lookup Identities

The Yale Directory integration is used during auth/profile bootstrap, where lookup values can be NetIDs or names. Network/API failures should not print lookup identities or raw client errors into server logs.

Consequences:

- Directory lookup failures log a fixed message with `sanitizeLogValue(error)`, not the queried NetID/name.
- CourseTable fetch failures also sanitize caught errors before logging.
- Static security preflight covers these external integration error-log boundaries.

## 2026-06-11: Rendered Fetch Bridge Uses SSRF-Normalized URLs

The optional Python rendered-fetch bridge receives URLs derived from stored or scraped source data. The Node wrapper must not validate one URL string and then pass a different raw string into the subprocess.

Consequences:

- Rendered fetch requests validate the seed URL through the shared public HTTP(S) SSRF guard before subprocess execution.
- The Python bridge receives `seedUrl.toString()` as its `--url` argument, not the raw request URL.
- Redirect-result fallback also uses the normalized safe URL before same-origin/public checks.

## 2026-06-11: Auth Redirect Targets Are URL-Normalized

CAS login/error/dev-login redirects should not return caller-supplied relative paths verbatim. Even when redirects are same-origin bounded, raw path handling can depend on browser-specific normalization of encoded slashes, backslashes, and control characters.

Consequences:

- Relative auth redirect targets are parsed through `URL` against an internal sentinel origin and returned as normalized path/search/hash values.
- Encoded protocol-relative/backslash prefixes and encoded CR/LF are rejected before `res.redirect`.
- Same-origin absolute redirects with URL credentials are rejected.

## 2026-06-11: Yalies API Errors Are Credential-Free and Bounded

The Yalies integration sends a bearer token to a fixed external API during auth/profile bootstrap and directory scraping. Axios errors can carry request configuration, including headers, if they are propagated or logged directly.

Consequences:

- Yalies API calls use an explicit request timeout.
- Shared Yalies list calls wrap Axios failures in status-only errors before propagation.
- Single-NetID Yalies fetch logging sanitizes the wrapped error rather than logging raw Axios objects or config.

## 2026-06-11: OpenAI Operator Script Fatal Errors Are Sanitized

Operator scripts that call OpenAI can receive Axios errors containing request configuration. Top-level fatal handlers should never print those raw objects because request headers include bearer tokens.

Consequences:

- Research-description, profile-bio, and center-director backfill fatal handlers use `sanitizeLogValue`.
- Unexpected OpenAI/Axios failures are redacted before console output.
- Per-entity failure handling still records concise error messages for operators.

## 2026-06-11: Mongo Gate, Import, Audit, and Repair Fatal Errors Are Sanitized

Beta/promotion gates, import scripts, search-index rebuilders, review/audit utilities, and data backfills often run with credentialed Mongo URLs, Meilisearch hosts, or API tokens in the environment. Mongoose, Meilisearch, Axios, or nested tool failures can include credential-bearing connection strings or request configuration if raw errors are printed.

Consequences:

- High-use gate, import, migration, audit, repair, review, search-index, dedupe, and backfill scripts sanitize fatal errors before console output.
- Beta seed, claim/integrity gate, visibility/review, index rebuild, and acquisition-report failures keep operator-facing context while redacting credentials.
- Static preflight covers this expanded script cluster against raw fatal-error logging regressions.

## 2026-06-11: Scrape Run Report IDs Are Strict

The scrape-run report helper turns a run id into ScrapeRun and Observation lookups for operator QA artifacts. Report lookups should not rely on permissive Mongoose ObjectId validation or pass raw string ids into model filters.

Consequences:

- Scrape-run report ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- ScrapeRun and Observation lookups use the normalized ObjectId value.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: Research Quality Search Review IDs Are Strict

The research quality search review script fans out from Meilisearch research/pathway hits into ResearchEntity, member, pathway, route, signal, and opportunity Mongo queries. Search-result ids should not rely on permissive Mongoose ObjectId validation before Mongo query construction.

Consequences:

- Research quality search review ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Malformed search-result entity ids are skipped before Mongo `$in` queries.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: Pathway Quality Audit Entity IDs Are Strict

The pathway quality audit builds entity context by fanning out from pathway and contact-route research entity ids into ResearchEntity, member, signal, and route queries. That fan-out should not rely on permissive Mongoose ObjectId validation.

Consequences:

- Pathway quality audit entity-context ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Malformed entity ids are skipped before Mongo `$in` query construction.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: Legacy Cleanup ObjectId Lookups Are Strict

The legacy Mongo cleanup script migrates old application records and can write migrated student-application documents or drop legacy collections. Its lookup helper should not stringify arbitrary legacy payload values before ObjectId validation.

Consequences:

- Legacy cleanup ObjectId lookups accept only 24-hex strings or real `ObjectId` instances.
- Object-shaped legacy payload ids are ignored before listing, user, or student-profile lookups.
- Migration output still preserves legacy string fields separately, but lookup queries do not invoke attacker-controlled coercion.

## 2026-06-11: Duplicate Name Review IDs Are Strict

The duplicate-entity-name review script computes cross-collection reference impact and can feed accepted merge decisions into guarded dedupe apply paths. Reference-impact fan-out should not use permissive Mongoose ObjectId validation on arbitrary entity id values.

Consequences:

- Duplicate-name review entity ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Malformed entity ids are skipped before reference-impact Mongo aggregation.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: Center Director Backfill IDs Are Strict

The center-director backfill script accepts `--only` filters that can include research-entity ids, slugs, or names before LLM extraction and materialized director membership writes. The id branch should not use permissive Mongoose validation on arbitrary values.

Consequences:

- Center-director backfill id filters accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Object-shaped `--only` values are treated only as non-id slug/name tokens and are never passed to Mongoose ObjectId construction.
- Targeted reruns no longer invoke attacker-controlled coercion while building research-entity id filters.

## 2026-06-11: Listing Profile Repair IDs Are Strict

The listing-profile repair script derives ResearchEntity profile patches from listings that store research entity references. Stored listing IDs should not be stringified or passed through permissive Mongoose validation before repair planning or apply updates.

Consequences:

- Listing profile repair entity ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Object-shaped stored listing references are skipped before ResearchEntity lookup or update work.
- Apply mode revalidates repair target ids before mutation.

## 2026-06-11: Surname Lab Disambiguation IDs Are Strict

The surname-lab disambiguation script can apply reviewed research-entity rename plans. Apply mode should not construct Mongo ObjectIds from arbitrary plan-shaped values before the guarded update.

Consequences:

- Surname-lab disambiguation apply ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Malformed plan entity ids are skipped before research-entity update filters.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: Paper Authorship Audit IDs Are Strict

The paper authorship audit can delete invalid paper-author rows and backfill OpenAlex-derived `PaperAuthor` links from denormalized paper author arrays. Those mutation paths should not stringify arbitrary stored values or rely on permissive Mongoose ObjectId validation before model work.

Consequences:

- Paper authorship audit ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Invalid paper-author delete ids and denormalized Yale author ids are normalized before Mongo delete/upsert filters.
- Object-shaped stored author ids are skipped without invoking attacker-controlled `toString`.

## 2026-06-11: Stale Observation Supersession IDs Are Strict

The stale-observation conflict review script can apply reviewed supersession decisions that mark old source observations as superseded by a kept observation. Supersession IDs should not rely on permissive Mongoose ObjectId validation or construct ObjectIds from arbitrary object-shaped values.

Consequences:

- Stale-observation keep and supersede ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Malformed accepted-decision observation ids fail before count/update mutation work.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: User Identity Dedupe Apply IDs Are Strict

The user identity dedupe script rewrites user references across research, review, listing, paper, fellowship, faculty, and student-profile collections before archiving duplicate users. Its apply path should not rely on permissive Mongoose ObjectId validation or construct ObjectIds from arbitrary object-shaped values.

Consequences:

- User identity dedupe canonical and duplicate ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Invalid ids fail before cross-collection reference rewrites or duplicate-user archival.
- Object-shaped ids are rejected without invoking attacker-controlled coercion.

## 2026-06-11: Same-PI Dedupe Apply IDs Are Strict

The same-PI research-entity dedupe script can archive, relink, merge, retire members, and delete duplicate research entities when accepted review decisions are applied. Its apply paths should not rely on permissive Mongoose ObjectId validation or construct ObjectIds from untrusted object-shaped values.

Consequences:

- Same-PI dedupe apply paths accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Malformed canonical, duplicate, artifact, or member ids are skipped before mutation.
- Object-shaped ids fail closed before archival, relink, merge, member-retirement, or delete-mode operations.

## 2026-06-11: Admin Mutation Route IDs Are Normalized

Admin listing, research-area, and department mutation routes are protected by auth/admin and ObjectId middleware, but route handlers should still use normalized path ids for downstream model calls instead of raw `req.params.id`.

Consequences:

- Admin route ObjectId values accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Listing reset-created-at, research-area update/delete, and department update/delete use normalized ids for model work.
- Object-shaped ids fail closed before privileged admin mutation code paths.

## 2026-06-11: Public Research Entity IDs Are Strict

Public research search/detail helpers join research entities, relationships, members, and scholarly attribution rows. They should not stringify arbitrary object-shaped IDs before Mongo fan-out.

Consequences:

- Research group/entity ID helpers accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Public Meili hit filtering, relationship payloads, member listing, and member-attribution fan-out skip object-shaped IDs.
- Owner-created research entity lookup skips corrupted member pointers before falling back to the normal create/upsert path.

## 2026-06-11: Public Opportunity Detail IDs Are Strict

Posted-opportunity detail is unauthenticated and joins opportunity, pathway, research entity, and observation records. It should not invoke object-shaped id helpers while validating the path id or evidence ids.

Consequences:

- Opportunity detail path ids use strict 24-hex matching before Mongo ObjectId construction.
- Evidence ids accept only strings or real Mongoose `ObjectId` instances before observation fan-out.
- Public DTO id stringification no longer invokes arbitrary object `toHexString`.

## 2026-06-11: Public Pathway and Access Summary ID Fan-Out Is Strict

Public pathway search and access-summary derivation build Mongo `$in` filters from request-derived or stored entity/pathway ids. These fan-out helpers should not rely on permissive Mongoose validation for arbitrary values.

Consequences:

- Pathway search converts pathway/entity id filters only after string-only trimming and strict 24-hex matching.
- Access-summary entity ids accept only strings or real Mongoose `ObjectId` instances, then strict 24-hex matching.
- Object-shaped id values are ignored before Mongo ObjectId construction or query fan-out.

## 2026-06-11: Listing Service IDs Are Normalized Before Model Work

Listing read, update, delete, bulk read, profile-sync, and entity-authority checks are reachable through student/faculty/admin listing workflows. They should not pass arbitrary request-shaped or stored values directly to Mongoose ObjectId validation or model methods.

Consequences:

- Listing ObjectId boundaries accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Listing model calls, Meilisearch delete calls, and ResearchEntity profile sync use the normalized id value.
- Bulk listing reads cap requested ids and ignore non-array or object-shaped inputs before per-id work.

## 2026-06-11: Research Discovery Write IDs Avoid Arbitrary Coercion

The first-class research-discovery write services materialize entry pathways, access signals, contact routes, and posted opportunities from scraper and listing inputs. Their ID helpers should not pass arbitrary object-shaped values to Mongoose validation or constructors.

Consequences:

- These write services accept strings or real Mongoose `ObjectId` instances for stored id fields.
- Required parent ids no-op before model upserts when malformed instead of reaching Mongo filters with polluted values.
- Source evidence id arrays skip object-shaped values and convert only strict 24-hex strings.

## 2026-06-11: Admin Review IDs Avoid Arbitrary Coercion

Admin access-review writes and evidence fan-out operate on privileged review metadata. They should not convert arbitrary request-shaped or stored values with generic `String(...)` before ObjectId validation.

Consequences:

- Admin review record and reviewer ids accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Access-review evidence ids are capped before fan-out and skip polluted object-shaped values.
- Reviewer attribution is omitted when the reviewer id is malformed instead of coercing arbitrary objects.

## 2026-06-11: Account Lookup IDs Avoid Arbitrary Coercion

User account lookup supports either Mongo ObjectId lookup or exact NetID lookup. That dispatch must not rely on permissive Mongoose validation or generic `String(id)` conversion for request-shaped values.

Consequences:

- Account lookup ObjectIds accept only 24-hex strings or real Mongoose `ObjectId` instances.
- NetID lookup accepts strings only and still validates against the compact Yale-style NetID pattern before regex construction.
- User read, validate, exists, update, and delete paths use normalized lookup values for model calls and not-found messages.

## 2026-06-11: Account Mutation IDs Avoid Arbitrary Coercion

Account favorite, owned-listing, saved-pathway, and saved research-plan mutations rewrite arrays that can combine request-supplied ids with legacy stored account ids. Neither side should be trusted to support safe generic string coercion.

Consequences:

- Account mutation id inputs accept only 24-hex strings or real Mongoose `ObjectId` instances.
- Stored account id arrays are normalized through a capped safe reader before dedupe, removal, fan-out, or saved-plan export.
- Arbitrary object-shaped ids fail or are discarded before Mongoose model work without invoking attacker-controlled `toString`.

## 2026-06-11: Public View and Favorite Mutations Normalize IDs First

Shared view/favorite mutations are reachable from public listing and program/fellowship endpoints. They should not pass arbitrary objects to Mongoose id validation or interpolate raw ids into not-found messages.

Consequences:

- Shared item operations accept 24-hex strings or ObjectId-like `toHexString` values only.
- View/favorite model updates use normalized ids for `findByIdAndUpdate`, `findOneAndUpdate`, and fallback lookup.
- Invalid object-shaped ids fail before model work without invoking arbitrary `toString`.

## 2026-06-11: Program and Fellowship ID Reads Are Bounded

Program APIs are backed by the fellowship collection. Detail and bulk reads should not hand arbitrary objects to Mongoose ObjectId validation or build unbounded `$in` queries from caller-provided id arrays.

Consequences:

- Program/fellowship id reads accept 24-hex strings or ObjectId-like `toHexString` values only.
- Bulk program/fellowship reads cap requested ids before validation and Mongo fan-out.
- Invalid object-shaped ids fail before model lookup without invoking arbitrary `toString`.

## 2026-06-11: Public Fellowship Serialization Is Bounded

Public fellowship payloads are unauthenticated student-facing DTOs built from imported program records. Polluted records should not produce unbounded redaction work, unbounded link rendering, or arbitrary object coercion.

Consequences:

- Public fellowship text fields are capped before direct-contact redaction.
- Public fellowship links, prep steps, and list fields are capped before rendering.
- Public fellowship fields return only allowlisted primitive, date, or bounded string-list values; polluted objects are omitted.

## 2026-06-11: Public Opportunity Detail DTO Shaping Is Bounded

Posted-opportunity detail is unauthenticated and builds a public payload from stored opportunity, pathway, entity, and observation records. Polluted stored values should not trigger arbitrary object stringification, unbounded URL parsing, or unbounded evidence traversal.

Consequences:

- Public opportunity detail caps source URL lists, taxonomy arrays, text fields, and evidence recursion before normalization.
- Public opportunity detail ids accept strings, numbers, and ObjectId-like `toHexString` values without arbitrary object `toString`.
- Public URL and evidence text shaping skips non-string polluted values.

## 2026-06-11: Source Health Commands Quote Stored Identifiers

Source-health rows surface operator commands derived from stored source metadata and scraper run ids. Those commands should not interpolate arbitrary stored strings or object coercions into shell snippets.

Consequences:

- Source-health run ids accept primitive strings/numbers or real Mongoose ObjectIds through the shared serializer; arbitrary object `toString` and duck-typed `toHexString` hooks are ignored.
- Source-health timestamps parse only bounded string values or `Date` instances.
- Source-health generated command arguments are bounded and shell-quoted unless they match a safe bare-token pattern.

## 2026-06-11: Public Access Summaries Are Bounded Response Derivations

Access summaries are public derived payloads built from access signals, pathways, and posted opportunities. Polluted stored records should not trigger arbitrary object stringification, full-string normalization, or unbounded entity fan-out.

Consequences:

- Access summary requests cap entity ids before Mongo fan-out.
- Public evidence text, URLs, signal types, and pathway types accept only bounded strings before redaction or URL parsing.
- Exploratory next-step copy falls back when stored values are non-string or unsafe.

## 2026-06-11: Fellowship Evidence and Matching Ignore Polluted Values

Fellowship application-cycle evidence and saved-pathway funding matches are public-facing derived payloads. They should not stringify arbitrary objects, parse attacker-shaped dates, or tokenize unbounded record arrays.

Consequences:

- Fellowship evidence accepts only string values for public text/URL/date normalization unless the value is already a `Date`.
- Fellowship evidence caps text, URL rows, and array fields before normalization.
- Fellowship matching caps record/pathway text arrays before tokenization and avoids arbitrary object-id stringification.

## 2026-06-11: Public ResearchEntity DTO Normalization Is Bounded

Public ResearchEntity response shaping redacts contact details from scraped and curated text. That redaction boundary should not traverse unbounded arrays, maps, URLs, or text from polluted records.

Consequences:

- Public ResearchEntity text is capped before direct-contact redaction.
- Public ResearchEntity arrays, source URLs, and nested object keys are capped before traversal.
- Nested object values are read only after key caps are applied.

## 2026-06-11: Profile and Listing Writes Cap Before Item Normalization

User-editable profile and self-service listing payloads should not normalize every supplied array or URL-map item before enforcing storage caps.

Consequences:

- Profile self-edit arrays are sliced to the storage cap before string normalization.
- Profile URL maps enumerate bounded keys first and only read/normalize values inside the cap.
- Self-service listing arrays and website lists are sliced before text or URL normalization.

## 2026-06-11: Listing Search Pagination Avoids Object Coercion

Listing search pagination is request-controlled and feeds Meilisearch `limit` and `offset`. It should not call numeric coercion on arbitrary query objects.

Consequences:

- Listing search pagination accepts only string or number values before parsing.
- Pagination parameter text is capped at 16 characters before parsing.
- Existing listing search page and page-size caps remain in force.

## 2026-06-11: Program and Fellowship Search Avoid Object Coercion

Program and fellowship search routes accept request-controlled pagination, sort direction, and filter values. These boundaries should not call numeric or string coercion on arbitrary objects.

Consequences:

- Program and fellowship search controllers parse only compact string or number pagination/sort values.
- Direct program/fellowship search service calls use the same compact numeric parsing before skip/limit calculation.
- Program/fellowship service filter sanitization skips non-string filter items before trim/cap/dedupe.

## 2026-06-11: Search Services Drop Non-String Filter Items

Controller validation is not enough for exported search services. Direct service callers should not be able to trigger object coercion or type errors through filter arrays.

Consequences:

- Pathway Mongo search filter sanitization now accepts only string items before trimming.
- Pathway Meilisearch and research Meilisearch filter sanitization now skip non-string values before capping/deduping.
- Research group filter-string construction drops non-string values without invoking `toString`.

## 2026-06-11: Public Search Filters Reject Object Coercion

Public research and pathway search filters are request-controlled arrays. Controllers should not call `String()` or `Number()` on arbitrary objects while deciding whether input is oversized.

Consequences:

- Research and pathway filter arrays now accept only string items before trimming.
- Non-string filter items fail the oversized/invalid request guard before service work.
- Pathway search pagination parses only compact string or number values before page/page-size normalization.

## 2026-06-11: Profile Publication Query Parameters Are Compact

Profile publication reads expose request-controlled pagination over embedded publication rows. Query parsing should not coerce arbitrary objects or oversized strings before slicing.

Consequences:

- Publication pagination accepts only string or number query values.
- Publication pagination text is capped at 16 characters before parsing.
- Public profile listing URLs are capped before per-URL public HTTP(S) parsing.

## 2026-06-11: Admin Pagination Parses Only Compact Primitive Values

Admin list routes use query parameters to build Mongo `skip` and `limit` values. Pagination helpers should not stringify arbitrary objects or arrays from query parsing.

Consequences:

- Admin pagination now accepts only strings or numbers before integer parsing.
- Pagination parameter text is capped at 16 characters before parsing.
- Admin search query length is checked before trimming so oversized whitespace cannot force full-string normalization work.
- Existing page and page-size maximums remain the effective Mongo `skip`/`limit` caps.

## 2026-06-11: Analytics Entity IDs Are ObjectId-Validated Before Persistence

Analytics events store listing and fellowship identifiers in ObjectId fields. Route-derived strings should not be handed directly to Mongoose casting or persisted without a service boundary.

Consequences:

- Analytics `listingId` and `fellowshipId` values are trimmed and accepted only when they are canonical 24-hex ObjectId strings.
- Malformed entity ids are dropped from analytics events instead of reaching schema casting.
- Actor, text, metadata, and user metric update boundaries remain layered around the event write.

## 2026-06-11: Analytics Event Actor Fields Are Sanitized Before Persistence

Analytics events are produced from authenticated session state and route activity, but session-shaped actor fields still need a service-level persistence boundary.

Consequences:

- Analytics event NetIDs are trimmed and validated before event storage.
- Explicit non-user buckets `anonymous` and `unknown` are allowed for analytics storage but skipped for user metric updates.
- Analytics `userType` values are capped and identifier-validated before persistence.

## 2026-06-11: Analytics Drilldown NetIDs Are Service-Validated

Admin analytics drilldown routes are route-validated, but the exported analytics service also builds anchored regex filters. Service callers must not be able to bypass NetID shape checks.

Consequences:

- `getUserAnalyticsDrilldown` now trims and validates Yale-style NetIDs before aggregation or event lookup.
- Malformed or oversized NetIDs fail before regex filter construction.
- The route-level `validateNetid('netid')` middleware remains the first boundary for HTTP requests.

## 2026-06-11: Client LocalStorage Writes Are Bounded

Browser localStorage is attacker-controllable on a compromised same-origin context and can also be filled by stale or malformed client state. Write paths should apply the same size boundaries as hydration paths.

Consequences:

- Account tracking persistence now serializes through a shared helper that removes oversized values instead of writing them.
- Fellowship stage and note persistence use the same 100KB account tracking storage cap as hydration.
- The generic debounced localStorage hook caps keys and serialized values before scheduling/writing.

## 2026-06-11: Local Admin Dev-Login Redirects Are Bounded

The client-side admin route can auto-open the local development admin session helper on localhost. Development-only auth helpers should still avoid propagating unbounded redirect URLs.

Consequences:

- The local admin dev-login redirect target is capped at 2,048 characters before encoding.
- The redirect target is normalized to the current same-origin URL or falls back to the local origin.
- The route remains gated to Vite development mode on `localhost` or `127.0.0.1`.

## 2026-06-11: Client URL Lists Are Bounded Before Normalization

Source URL arrays can come from API payloads, scraper-derived records, or browser state. URL sanitizers must bound list work before normalizing each item.

Consequences:

- Shared client URL list helpers reject non-array inputs instead of assuming caller shape.
- URL list normalization stops after 50 items before parsing/deduping.
- Existing per-URL scheme, credential, mailto, and length checks remain the item-level boundary.

## 2026-06-11: Google OAuth Token Channels Are State-Scoped

OAuth popup callbacks carry short-lived Google access tokens back to the opener. Same-origin browser contexts should not share a fixed token broadcast channel for all OAuth attempts.

Consequences:

- The Google Sheets OAuth opener now listens on a BroadcastChannel name derived from the generated OAuth `state`.
- The static OAuth callback page validates token and state shape before posting to the state-scoped channel.
- The message type and state equality check remain defense-in-depth boundaries for the opener.

## 2026-06-11: Dev Login Responses Follow Auth Privacy Headers

Local-only auth routes should not normalize unsafe response patterns. Even disabled-in-production development routes can train regressions into shared auth code.

Consequences:

- `/api/dev-login` now sets the same private `no-store` auth response headers as CAS, auth check, and logout routes.
- Dev-login session creation failures return fixed public copy instead of echoing raw Passport/session error messages.
- The route remains limited to local development runtimes.

## 2026-06-11: Faculty Import JSON Inputs Are Constrained

The legacy faculty import script reads a local JSON file and then connects to MongoDB. Operator-provided input paths must not allow arbitrary local file reads while database credentials are active.

Consequences:

- Faculty import input paths must resolve to `.json` files under the repo root, system temp, or project `tmp/`.
- Inputs must exist as regular files and stay under 25MB before the script reads them.
- The existing default `yale-faculty-enricher/enriched_faculty.json` workflow remains valid.

## 2026-06-11: Saved Pathway-Plan Checklists Are Capped Before Iteration

Saved pathway-plan details are stored under a `Mixed` user-document map. Sanitization must avoid materializing attacker-sized checklist objects before applying the storage cap.

Consequences:

- Server-side saved-plan checklist sanitization now iterates own keys and stops once 50 accepted checklist items are reached.
- Array checklists are ignored instead of treated as object-like maps.
- Private saved-plan notes use a named 5,000-character storage cap before persistence/export.

## 2026-06-11: Account LocalStorage Hydration Is Bounded Before Parse

Account-page localStorage values are browser-controlled and can be corrupted or attacker-seeded on the same origin. Normalizing parsed objects is not enough if the raw string can force large JSON parse work on every account-page load.

Consequences:

- Saved pathway-plan storage drops and removes payloads over 100KB before `JSON.parse`.
- Account tracking storage drops and removes oversized current or legacy values before `JSON.parse`.
- Existing map/item/note normalization remains the post-parse boundary for valid-size payloads.

## 2026-06-11: Admin Taxonomy Writes Are Bounded Before Persistence

Admin-managed research areas and departments feed global filters and configuration payloads. Admin-only routes should still normalize and bound taxonomy labels before writing to Mongo.

Consequences:

- Admin research-area name updates reuse bounded label normalization before persistence.
- Admin department create/update bounds abbreviations, names, display names, and category arrays.
- Department categories and primary categories are enum-validated before color-key derivation, and taxonomy labels cannot include direct contact information.

## 2026-06-11: Manual Fellowship Recipient Inputs Stay Under Safe Roots

Manual recipient CSV/PDF inputs are local operator files consumed by scrapers that can run with database credentials. Those paths must be constrained like other accepted-input artifacts.

Consequences:

- The undergrad fellowship recipient scraper resolves manual CSV/PDF paths through a safe local input resolver before reading.
- Manual recipient roots must be under the system temp directory or project `tmp/`.
- Program keys are validated as safe path segments and only `.csv` / `.pdf` manual input extensions are accepted.

## 2026-06-11: Admin Grant Notes Are Bounded Before Persistence

Admin grant and revoke notes are operator-entered metadata. They should not be able to persist arbitrary-size strings into the admin authority audit trail.

Consequences:

- Grant and revoke notes now share a service-level sanitizer.
- Notes are trimmed and capped at 512 characters before Mongo persistence.
- NetID validation and active-grant authority checks remain the primary admin access boundaries.

## 2026-06-11: Admin Access-Review Lock Fields Are Bounded Identifiers

Admin access-review lock fields are operator-controlled metadata, but they are still persisted into launch-critical records. They should be treated as compact field identifiers, not arbitrary text blobs.

Consequences:

- Manual research-entity locks and per-record review locks now share `normalizeAccessReviewLockedFields`.
- Lock field names are deduped, capped to 100 entries, capped to 120 characters each, and limited to identifier-safe characters.
- Invalid or oversized lock names are dropped before Mongo persistence while route-level admin authority remains the outer access boundary.

## 2026-06-11: Scraper Cache Invalidation Escapes Regex Prefixes

Scraper cache invalidation can delete by request-key prefix. Prefixes should be treated as literal cache-key text, not Mongo regex syntax.

Consequences:

- `invalidateCache` escapes request-key prefixes before constructing the anchored `$regex`.
- Request-key prefixes are capped at 512 characters before `deleteMany` work.
- Omitted prefixes still intentionally invalidate all cache rows for the exact source name.

## 2026-06-11: Visibility Release-Queue Filters Are Bounded Before Mongo

Admin release-queue filters come from query strings and are used directly as Mongo filter values. Even admin-only diagnostic filters should be normalized before query construction.

Consequences:

- `listVisibilityReleaseQueue` trims and caps `reason` and `sourceName` filters at 120 characters.
- Unknown or oversized `status` values fall back to `open` instead of becoming arbitrary filter values.
- Route-level admin auth remains the outer boundary; service-level normalization protects internal callers and future route changes.

## 2026-06-11: User Lookup Regex Filters Require Valid NetIDs

User-service fallback lookups use case-insensitive regex filters for NetID matching. Escaping metacharacters is not enough; the service boundary should also reject malformed or oversized NetID strings before constructing Mongo regex filters.

Consequences:

- `buildCaseInsensitiveNetidFilter` accepts only 2-12 character alphanumeric NetIDs.
- Malformed or oversized service-level NetID inputs fail before user lookup, update, validation, or delete query construction.
- Route-level `validateNetid` remains the first boundary for public/profile routes, with service-level validation as defense in depth.

## 2026-06-11: Saved Pathway-Plan Route IDs Are Validated Before Controller Work

Saved pathway-plan detail routes store data under nested user document keys. Service-level ObjectId normalization is required, and route-level validation should reject malformed path ids before controller dispatch.

Consequences:

- `/api/users/savedResearchPlanDetails/:pathwayId` and `/api/users/favPathwayPlans/:pathwayId` validate `pathwayId` with the shared ObjectId middleware for update and delete routes.
- Malformed pathway ids fail before saved-plan service calls or nested `$set` / `$unset` key construction.
- Service-level ObjectId normalization remains the defense-in-depth boundary for internal callers.

## 2026-06-11: Nonpublic Research Search Requires Active Admin Authority

Research search is a public route with optional authenticated context. It must not expose operator-review or suppressed research entities based only on a legacy session-shaped `userType: admin` value.

Consequences:

- Research search calls `hasAdminAuthorityForUser` before honoring nonpublic visibility tiers, suppressed-row requests, low-quality review ordering, or quality filters.
- Legacy admin-shaped sessions without an active grant receive the same `student_ready` search boundary as public readers.
- Program, fellowship, and research search now share the active admin-grant authority boundary for nonpublic payloads.

## 2026-06-11: Admin Access-Review Record Types Are Route-Allowlisted

Admin access-review record updates operate across several collections. The path `:type` segment must be treated as untrusted route input and allowlisted before service dispatch.

Consequences:

- `/api/admin/access-review/records/:type/:recordId/review` accepts only `entryPathway`, `accessSignal`, `contactRoute`, and `postedOpportunity`.
- Unknown record types return a fixed `400` response before review update service work.
- The service-level model switch remains a defense-in-depth boundary for internal callers.

## 2026-06-11: Seed Listing Updates Validate ObjectIds

Seed routes are local-runtime and token-gated, but they still touch write services. Route parameters should be validated before update services see attacker-controlled strings.

Consequences:

- `PUT /api/seed/listings/:id` uses the shared `validateObjectId('id')` middleware before listing update work.
- Malformed listing ids fail with a fixed `400` response before service dispatch.
- The existing seed token length and constant-time comparison guard remains the outer boundary.

## 2026-06-11: Public Research Detail Slugs Are Bounded Before Lookup

Research detail pages are unauthenticated and query `ResearchEntity` by slug. Route and service code must reject malformed or oversized slugs before dispatching lookup work.

Consequences:

- `/api/research/:slug` accepts compact slug characters only and caps public detail slugs at 160 characters.
- Malformed and oversized slugs return fixed `400` responses without echoing the submitted value.
- `getResearchGroupDetail` repeats the same normalization before Mongo lookup so internal callers cannot bypass the boundary.

## 2026-06-11: Public Opportunity Detail IDs Are Bounded At The HTTP Boundary

Posted-opportunity detail is an unauthenticated public route. It should not pass arbitrary path strings to service code even though the service also rejects invalid Mongo ObjectIds.

Consequences:

- `/api/opportunities/:id` accepts only 24-character hex ObjectId strings before calling opportunity detail service code.
- Malformed and oversized ids return fixed `400` responses without echoing the submitted value.
- The service-level ObjectId check remains a defense-in-depth boundary for internal callers.

## 2026-06-11: Nonpublic Program Payloads Require Active Admin Authority

Program and fellowship controllers must not expose nonpublic review/suppression payloads based only on a session-shaped `userType: admin` value. The same active admin grant boundary used by admin middleware is the source of truth.

Consequences:

- Program search and detail endpoints call `hasAdminAuthorityForUser` before setting `includeNonPublic` or returning raw operator-review payloads.
- Fellowship detail endpoints use the same active authority check before returning raw records.
- Legacy `userType: admin` sessions without an active grant receive public-shaped program/fellowship payloads.

## 2026-06-11: Auth Debug Logs Must Not Include NetIDs

Authentication debug logs are still logs. `AUTH_DEBUG=true` can be useful locally, but it must not print NetIDs, emails, CAS tickets, or other direct user identifiers.

Consequences:

- The shared `authDebug` helper sanitizes every argument before printing.
- `findOrCreateUser` debug messages describe lookup stages without interpolating the requested NetID.
- Auth error logs remain routed through `sanitizeLogValue`.
- Security preflight checks prevent NetID interpolation from returning to auth debug or direct console log calls.

## 2026-06-11: Saved Research-Plan Exports Redact System-Derived Contact Text

Saved research-plan exports are private account artifacts, but their system-derived pathway labels and research-entity names can originate from scraped/materialized text. The export privacy contract says contact routes and non-public contact emails are not included, so those fields must not carry embedded direct contact details.

Consequences:

- Exported pathway titles and research-entity names pass through `redactDirectContactInfo`.
- Explicit `contactRoute` payloads remain excluded from the export.
- User private notes remain an explicit opt-in export field; the system-derived fields keep the non-contact privacy boundary.

## 2026-06-11: Public Opportunity Detail Text Is Contact-Redacted

Public posted-opportunity detail pages include host research-entity department/research-area arrays and observation-derived evidence metadata. Those fields are student-facing text, but they can still be materialized from scraper or legacy data and must not carry embedded emails or phone numbers.

Consequences:

- Opportunity detail keeps projecting only public host-entity fields.
- Department and research-area arrays are compacted and passed through `redactDirectContactInfo` before response serialization.
- Evidence `sourceName` and `field` labels are passed through the same bounded `publicText` redaction boundary as excerpts.
- Opportunity detail tests and security preflight prevent raw taxonomy or evidence-label passthrough from returning.

## 2026-06-11: Account Profile URL Map Keys Are Storage-Safe

Authenticated account self-edit endpoints can persist profile URL maps. URL values and map keys both need sanitization because keys are later stored as nested object labels and returned to clients.

Consequences:

- `/api/users/me` profile URL maps trim and bound keys before persistence and response serialization.
- `__proto__`, `constructor`, and `prototype` profile URL keys are dropped; leading `$` and dots are normalized to safe labels.
- `/api/users/me` self-edit text, array, and unknown-user bootstrap identity fields are trimmed and bounded before account persistence.
- Faculty self-edit and admin profile update services keep using the same public URL value boundary for persisted website, image, and profile URL fields.

## 2026-06-11: Pathway Search Bounds Inputs At The Service Boundary

Pathway search can run through controllers, authenticated saved-plan hydration, or internal service callers. The Mongo aggregation service and optional Meilisearch backend must not rely only on controller validation for query and filter size limits.

Consequences:

- `searchPathways` trims and caps query text before building regex search stages.
- `searchPathways` deduplicates, trims, length-bounds, and count-bounds filter arrays before building `$in` stages.
- `searchPathwaysViaMeili` applies the same query/filter bounds before building Meili filters or sending search text to the index.
- Controller-level rejection remains useful for clear client errors, but the services are the durable backend pressure boundaries.

## 2026-06-11: Public Research Search Bounds Inputs At The Service Boundary

Public research search can be reached through unauthenticated controllers, admin-quality review scripts, and internal service callers. The Meilisearch service must not rely only on controller rejection for query and filter size limits.

Consequences:

- `searchResearchGroupsViaMeili` trims and caps query text before enabling hybrid search.
- `searchResearchGroupsViaMeili` deduplicates, trims, length-bounds, and count-bounds filter arrays before building Meili filters or Mongo fallback filters.
- Admin-only quality review options are normalized at the service boundary before low-quality browse fallback work.

## 2026-06-11: Legacy Listing Search Bounds Query And Filter Inputs

Authenticated legacy listing search remains a compatibility surface while posted opportunities and Ways In become the primary product model. It still accepts user-controlled query params and must bound them before Meilisearch or fallback search work.

Consequences:

- `/api/listings/search` trims and caps query text before enabling hybrid search or sending text to Meilisearch.
- Listing search deduplicates, trims, length-bounds, and count-bounds department, discipline, and research-area filters before constructing Meili filter expressions.
- The Mongo fallback path uses the same bounded query and filter values when the listing index is unavailable.

## 2026-06-11: Program And Fellowship Search Bounds Inputs Before Mongo Work

Authenticated program and fellowship searches accept user-controlled query params and ultimately build Mongo `$text` and `$in` filters. Controller validation improves client behavior, but the fellowship service is the durable backend pressure boundary because canonical program search delegates to it.

Consequences:

- Program and fellowship controllers normalize repeated query params, trim and cap query text, and count/length-bound filter values before calling search services.
- `searchFellowships` independently applies the same query and filter bounds before constructing Mongo `$text` and `$in` filters.
- Program search inherits the service boundary through `searchPrograms`, which delegates to fellowship search.

## 2026-06-11: Rendered Scraper Fetches Must Not Materialize Redirected Cross-Origin Content

Renderer-backed scraping starts from stored or scraped URLs and then delegates network work to an optional Python browser fetcher. The TypeScript boundary must treat the renderer's final URL as untrusted because redirects can change the fetched origin.

Consequences:

- `createScraplingRenderedFetcher` validates the seed URL with the shared SSRF guard before invoking the renderer.
- The rendered result is accepted only if the final browser URL is still public HTTP(S) and same-origin with the seed URL.
- Cross-origin or blocked final URLs return an empty blocked result and cannot feed scraper materialization.

## 2026-06-11: Deployed Runtime Always Emits HSTS

Browser transport hardening should not depend on each proxy hop preserving request scheme headers perfectly. In deployed runtimes, HSTS is part of the runtime security posture, not a per-request best-effort header.

Consequences:

- `securityHeaders` emits `Strict-Transport-Security` whenever deployed runtime security is required.
- Direct HTTPS and proxied HTTPS requests still emit HSTS.
- True local development over plain HTTP remains exempt so localhost testing does not poison browser HSTS state.

## 2026-06-11: CAS Public Error Responses Use Fixed Copy

Passport/CAS failures can carry provider-controlled diagnostic messages. Browser-facing auth responses should not echo those messages because they may include tickets, user identifiers, callback URLs, or internal auth state.

Consequences:

- CAS exceptions are logged through `sanitizeLogValue`.
- CAS "no user" responses return fixed `CAS auth but no user` copy instead of `info.message`.
- Detailed auth diagnostics stay in sanitized server logs, not response JSON.

## 2026-06-11: Seed Route Tokens Are Bounded Before Comparison

Development seed routes are local-runtime only and token-gated, but the token check should still reject malformed input cheaply before cryptographic comparison work.

Consequences:

- `SEED_TOKEN` must be between 16 and 256 characters or seed routes return disabled.
- Provided `x-seed-token` values outside the same bounds are rejected before hashing.
- Valid-length tokens still use fixed-length SHA-256 digests with `timingSafeEqual`.

## 2026-06-11: Public Direct-Contact Emails Are Institution-Scoped

Public student-facing APIs may expose direct-contact email fields only when the address is syntactically safe and belongs to Yale-managed domains. Scraped or stored third-party personal addresses should stay out of public direct-contact fields unless a future policy explicitly allows that source and route type.

Consequences:

- `server/src/utils/contactEmail.ts` is the shared public email gate for research entities, research-detail derived PI routes, programs, fellowships, and public access artifacts.
- Unsafe mailto/header-injection values, malformed addresses, and non-Yale domains are omitted from public contact fields.
- Public service serializers that can be returned directly must apply the same contact and URL policy as controller payload mappers.
- Public research-detail faculty fallback identities must apply the same Yale-managed public email gate before any derived outreach route or member payload can consume them.
- Public evidence excerpts still use direct-contact redaction even when an institutional route exists elsewhere in the payload.
- Public program/fellowship text fields, including summaries, descriptions, application instructions, eligibility, `prepSteps`, contact phone, and contact office, must redact embedded email addresses and phone numbers before reaching unauthenticated readers.

## 2026-06-11: Application Logs Must Not Emit User Identifiers

Authentication, directory lookup, and onboarding logs should describe the event class without writing NetIDs, email addresses, full user objects, or submitted profile payloads to server or browser consoles.

Consequences:

- Yalies and CAS lookup logs may report success, miss, and fallback classes, but not the requested NetID or returned person identity.
- Development login logs must not print the seeded user object.
- Unknown-user onboarding must not log submitted names, email addresses, or role selections in the browser console.
- Global error handling plus API controller and mounted route catch logs must sanitize credentials, bearer tokens, secret assignments, email addresses, and phone numbers before writing to server logs.
- Debug endpoints must return shaped diagnostic payloads, not raw database documents with user identifiers or free-form metadata.
- Analytics persistence must redact user-entered direct contact details in search text, search department strings, and nested metadata before writing events.
- Spreadsheet exports must neutralize formula-like user-entered cell values before sending them to Google Sheets or other spreadsheet targets.

## 2026-05-25: Beta Operator Review Is An Automatic Repair State

Beta is the launch-candidate dataset. `operator_review` records should not become a manual audit backlog or leak into student-facing surfaces; they should enter typed repair lanes, receive deterministic trusted-source repairs where safe, and then be re-gated.

Consequences:

- Student-visible Beta surfaces should continue to show only public visibility tiers.
- The automatic repair order is source/description first, PI identity second, and action/access evidence third.
- Deterministic source-backed repairs may run automatically in Beta; PI identity conflicts, same-name risks, suppression decisions, and uncertain action evidence stay queued as exceptions.
- Production promotion should copy or promote the accepted Beta dataset only after open must-fix repair jobs are cleared or explicitly accepted.

## 2026-05-25: Launch Trust Contract Includes Research Activity

Customer trust is a precondition for launch. The launch gate must verify student-visible profile, pathway, contact, and research-activity claims before production promotion.

Consequences:

- `yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict` is the launch-grade read-only audit.
- Strict launch mode requires `student_ready` visibility; `limited_but_safe` can be used only when explicitly running the weaker `--mode=public-safe` audit.
- Default student-facing APIs expose only `student_ready` records. `limited_but_safe` remains available for operator review and the explicit `--mode=public-safe` audit, but it is not part of the launch-grade public surface.
- The audit groups held records into repair lanes with concrete commands for source/description, PI identity, action evidence, or exception handling. Explicitly `suppressed` records are a valid non-exposure outcome, not a repair lane.
- Suppression-stage queue records require an explicit `--suppress-unsafe` operator command; the default repair queue still refuses to suppress them automatically.
- Research activity attached to faculty/PI records should read from the populated `research_scholarly_links` plus `research_scholarly_attributions` proof surface. Empty legacy paper collections are not launch evidence.
- Research activity provenance is audited with `yarn --cwd server scholarly-links:provenance-audit`; active person attributions must have target users, links must have an owner, and orphan attribution rows are suppressed before launch.
- Student surfaces may restore research activity when it is explicit entity-linked work or member-attributed scholarly work backed by attribution rows; browse cards should expose this as a compact currentness/trust signal, not as undergraduate access evidence.
- Scholarly links shown as research activity must also pass display-quality gates: meaningful title, inspectable source link or stable identifier, usable year/date, source label, no duplicate identifier groups, and no dataset-repository records presented as papers.
- If the paper-authorship audit fails, run the dry-run first, review the planned mutation count, then apply only with `SCRAPER_ENV=beta yarn --cwd server papers:authorship-audit --apply --no-backfill-openalex --sample-limit=0 --confirm-paper-authorship-apply --max-apply=<plannedChanges>` after confirming the target database.
- If the scholarly-link quality audit fails, run `yarn --cwd server scholarly-links:quality-audit --sample-limit=20` and follow the returned repair commands before promotion.

## 2026-05-07: North Star Is Research Navigation, Not Lab Openings

Yale Research should make the hidden undergraduate research ecosystem legible: where formal openings exist, where credible pathways exist, and how students can move from curiosity to a specific, evidence-based next step.

Consequences:

- Do not frame the product as a simple job board.
- Support exploratory discovery even when no active posting exists.
- Model labs, centers, institutes, faculty projects, fellowships, RA programs, thesis planning, and credit/funding/pay formalization after home fit.

## 2026-05-07: Separate EntryPathway From PostedOpportunity

An `EntryPathway` is a durable way a student might enter research. A `PostedOpportunity` is a specific active or time-bound instance. Older planning text may use `ResearchOpportunity`; prefer `PostedOpportunity` going forward.

Consequences:

- Not every pathway is an active opportunity.
- Tobin RA as a recurring route and Spring 2026 Tobin roles as specific posted opportunities can both be represented cleanly.
- Exploratory outreach should be modeled as a pathway, not as a fake open role.

Updated 2026-05-13: research for credit is not an entry pathway. Credit, paid RA work, fellowship funding, thesis advising, and similar arrangements are formalization outcomes after a student identifies a plausible research home and mentor unless they are attached to a real hosted program, mentor-matching program, or posted opportunity.

## 2026-05-07: Replace Binary Acceptance With Access Signals

Avoid binary fields such as `acceptingUndergrads`.

Consequences:

- Scrapers should produce evidence and observations that resolver/materializer logic can derive into access signals.
- Product language should say things like posted opening, recurring pathway, credit formalization possible, reach-out plausible, application-only, or no evidence yet.
- Evidence strength and source links matter more than overconfident yes/no claims.
- Absence of evidence should usually be computed, not stored as many negative records.

## 2026-05-07: Evolve Current ResearchGroup Conservatively

The existing code has `ResearchGroup` and `/labs` surfaces. The target concept is broader: `ResearchEntity`.

Consequences:

- Keep current behavior working while adding broader entity/pathway/signal concepts.
- Do not embed every pathway, signal, posted opportunity, and contact route directly inside `ResearchGroup` long term; filtering needs first-class collections.
- Rename collections/routes only after the product model is stable.
- Relevant current files include [`server/src/models/researchGroup.ts`](../server/src/models/researchGroup.ts), [`client/src/pages/labs.tsx`](../client/src/pages/labs.tsx), and [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx).

Superseded on 2026-05-13 by the hard-pivot ResearchEntity migration decision below.

## 2026-05-07: Use Two Main Product Surfaces

The app should support both exploration and practical entry.

Consequences:

- Explore Research: curiosity-first browsing of research structures.
- Pathways: practical filtering by participation mode, timing, methods, eligibility, and next step.
- Explicit posted opportunities should be highlighted when real, but the app should remain useful without active postings.

## 2026-05-07: Compute Recommended Next Steps First

Recommended next steps should be computed from pathway status, contact routes, deadlines, application URLs, and evidence strength unless admins need hand-editable CTAs.

Consequences:

- `POSTED_ROLE` plus open application URL maps to Apply.
- credit formalization evidence maps to Ask about credit after mentor/home fit.
- Plausible pathways with lab-manager routes map to Contact lab manager.
- Plausible pathways with only faculty routes map to Plan outreach.
- No evidence maps to Save or check back later.

## 2026-05-07: Add First-Class Access Model Collections

The first model-layer foundation keeps `ResearchGroup` as the physical research entity while adding `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` collections.

Consequences:

- `ResearchGroup.kind` remains intact; `entityType` is added as a compatibility field for the broader product model.
- `PostedOpportunity` belongs to an `EntryPathway` and can link to an existing `Listing` with optional `listingId`.
- Derived access records can use stable derivation keys for idempotent materialization without changing scraper/controller behavior in this slice.

## 2026-05-07: Add Access Materializer Beside Legacy Materializer

The first access materializer derives `EntryPathway`, `AccessSignal`, and `ContactRoute` records from active `Observation`s after legacy `ResearchGroup` materialization.

Consequences:

- Legacy `/labs` fields such as `acceptingUndergrads`, `offersIndependentStudy`, and `currentUndergradCount` remain available during migration.
- Access-signal confidence uses original observation/source confidence, not only resolved scalar-field confidence.
- YSM/YSE index-only `acceptingUndergrads=true` observations are treated as entity-discovery evidence, not undergraduate-access evidence.

## 2026-05-07: Add Access Summary Compatibility Payload

Research-group search/detail payloads can include a computed `accessSummary` while preserving existing response fields.

Consequences:

- Future UI work can prefer `accessSummary`, `entryPathways`, `accessSignals`, `contactRoutes`, and `postedOpportunities`.
- Existing `/labs` components can continue using old fields until the acceptance-verdict utility is migrated.

## 2026-05-11: Use Pathways As The Student-Facing Surface

Superseded on 2026-05-26 by the unified Yale Research route decision. This older decision started from the idea that `Pathways` should be a separate student-facing surface and navigation label.

Consequences:

- The standalone practical-routes page is retired.
- `/opportunities` is reserved for real active/time-bound posted opportunities.
- `EntryPathway` appears to students as Pathways, but course credit should appear as a later formalization option, not as the route itself.
- `PostedOpportunity` remains the internal name for real active/time-bound postings.
- `AccessSignal` appears to students as Evidence.
- Computed CTA logic appears to students as Best Next Step.

## 2026-05-11: Adopt Graphify As Shared Repo Memory

Use Graphify as an optional shared knowledge graph for Codex context on architecture, schema, scraper, product-model, and cross-surface tasks.

Consequences:

- `AGENTS.md` and `docs/*.md` remain canonical for rules and durable decisions.
- Graphify output is a navigation layer; verify claims against source files and tests before editing or summarizing.
- Keep `.graphifyignore` strict so secrets, dependencies, generated output, and noisy raw data do not enter the graph.
- Refresh Graphify after durable schema, scraper, architecture, or product-doc changes.

## 2026-05-11: Start Pathways With A Mongo-Backed Read API

Superseded on 2026-05-26 by the unified Yale Research route decision. The original implementation started a student-facing Pathways loop with a Mongo aggregation over `EntryPathway` and related access collections.

Consequences:

- Do not switch live pathway traffic to Meilisearch until the response shape, filters, and card UI prove stable.
- Pathway search returns denormalized research entity, evidence, active posted opportunity, and guarded contact-route summaries.
- Search results should expose public/official route summaries, not raw non-public scraped contact data.
- The standalone route is now removed while `/opportunities` remains reserved for real posted instances.

## 2026-05-11: Bridge Listings Into PostedOpportunity

Legacy `Listing` rows are the first source of real posted opportunities.

Consequences:

- Listing create/update/archive/delete flows sync a linked `POSTED_ROLE` pathway, `POSTED_OPENING` signal, and `PostedOpportunity` when `researchGroupId` is present.
- New listings attempt to attach to the owner research group so they can participate in the pathway model.
- Existing listing rows can be backfilled with [`data-migration/BackfillPostedOpportunitiesFromListings.ts`](../data-migration/BackfillPostedOpportunitiesFromListings.ts).
- Legacy listing APIs and Meilisearch behavior remain intact during migration.

## 2026-05-15: Deprecate Listings As The Primary UI Surface

The app should default authenticated users to `/research`, not to a listings board. Legacy listings remain useful as professor-created posted-role records and as source material for `PostedOpportunity`, but they are no longer the center of student navigation.

Consequences:

- `/` redirects to `/research`.
- `/listings` is a temporary compatibility route for the old browse board and `?listing=` deep links.
- Primary navigation should show Research, Pathways, Find Fellowships, and Dashboard, not Listings.
- Student-facing copy should prefer Posted Roles or Posted Opportunities over Listings.
- Backend listing APIs, admin listing tools, analytics, favorites, and professor posting workflows remain in place until a later posted-opportunity workflow fully replaces them.

## 2026-05-11: Make Lab Microsite Evidence More Granular

The lab-microsite LLM scraper should emit evidence-shaped observations before product conclusions.

Consequences:

- It may emit join page URLs, undergrad role quotes, contact-instruction quotes, explicit constraint quotes, and an `undergradAccessEvidence` object.
- `accessMaterializer.ts` derives signals and guarded routes from those observations.
- Legacy `acceptingUndergrads` remains as a compatibility observation for now, but new product surfaces should prefer AccessSignals and Pathways.

## 2026-05-11: Tighten Contact Route Guardrails

Public Pathways and research-detail surfaces should not expose non-public scraped emails.

Consequences:

- Public APIs return only public route summaries for contact routes.
- Route selection prefers official application, program, department, fellowship, course, and lab-manager routes before direct faculty routes.
- Client CTAs use route URLs where available and avoid falling back to member emails.

## 2026-05-11: Start Admin Access Review With API Foundation

Admin review for derived pathways/signals/routes/opportunities starts as a read-focused API plus manual-lock update endpoint.

Consequences:

- Admins can list entities with counts of derived access records through `/api/admin/access-review`.
- Admins can inspect one entity's derived access bundle through `/api/admin/access-review/:id`.
- Admins can update `ResearchGroup.manuallyLockedFields` through `/api/admin/access-review/:id/manual-locks`.
- A full admin UI/editor remains a later P3 task.

## 2026-05-12: Keep A Graphify-Grounded UI/UX Direction Doc

Use [`docs/ui-ux-direction.md`](./ui-ux-direction.md) as the durable home for student-facing UX direction.

Consequences:

- UI/UX ideas should be grounded first in `graphify-out/GRAPH_REPORT.md` and relevant `graphify explain` or `graphify query` output.
- Graphify remains a navigation layer; verify claims against source files and product docs before treating them as product direction.
- The UX grammar should stay centered on Research, Pathways, Evidence, and Best Next Step.

## 2026-05-12: Add Source Coverage Metadata Before Expanding Scrapers

Scraper sources should declare what they can discover or materialize before broad crawler expansion.

Consequences:

- `Source.coverage` stores priority, tier, artifact types, evidence categories, confidence stance, and planning notes.
- The runtime scraper registry remains separate from product/source coverage semantics.
- Coverage metadata helps admin review and future run reports distinguish raw observations from valid access evidence.
- Discovery-only sources should not be interpreted as undergraduate-access evidence without explicit materialized signals.

## 2026-05-13: Deploy Scrapers As Source-Specific Jobs

Initial scraper backfills should move from development testing to Beta seeding before production writes. Recurring refresh should use source-specific, staggered jobs rather than a single all-scraper cron or a permanently running scraper worker.

Consequences:

- Keep scraper execution outside the Render web service process.
- Use local or one-off CLI runs for long initial Beta backfills when practical.
- Production writes require the existing scraper guardrails: `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.
- Use [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) as the operational reference.
- Complete WorkPlanner integration for paid or broad recurring sources before unattended weekly cron.

## 2026-05-13: Use Source Heartbeats For Expensive Scraper Freshness

WorkPlanner-enabled expensive scrapers can use source-level heartbeat observations such as `lastObservedAt` as the freshness marker when optional evidence fields may be absent.

Consequences:

- A valid "no undergraduate evidence found" or partial-evidence run can still make a fresh rerun skip fetches, paid APIs, and LLM calls.
- Optional fields such as join URLs or quote snippets should not be required for freshness when their absence is a legitimate scrape result.
- Run reports should treat all-planned WorkPlanner skips as intentional zero-observation runs rather than scraper failures.

## 2026-05-13: Accepted Researcher Inputs Are ORCID-First

Local accepted-input files should use ORCID as the operator-facing external researcher identifier instead of Yale netid. Netid remains an internal account key and scraper compatibility target, not the durable identifier that reviewers should curate.

Consequences:

- ORCID can enrich or disambiguate an existing Yale-confirmed `User`, but it must not create a Yale user by itself.
- Accepted rows are writable only when ORCID is already attached to one Yale user or can be unambiguously crosswalked to a Yale-confirmed person from Yale email, Yale Directory/profile evidence, Yalies, OpenAlex, or another official source-backed signal.
- Scholar accepted rows write `googleScholarId` by ORCID and manually lock that field on the matched `User`.
- arXiv accepted rows use ORCID lists first, then tooling converts validated rows to current internal scraper targets.
- Netid may appear in diagnostics or internal `--only` conversion output, but should not be the reviewer-facing accepted identifier.

## 2026-05-13: Hard-Pivot To Physical ResearchEntity

Use `research_entities` as the canonical runtime collection before development data population and Beta seeding. Copy existing `research_groups` documents into `research_entities` with stable `_id`s, backfill `researchEntityId` references, and remove `/labs` plus `/api/research-groups` runtime compatibility.

Consequences:

- `ResearchEntity` lives in `server/src/models/researchEntity.ts`; `server/src/models/researchGroup.ts` retains the shared legacy-shaped schema but should not register a runtime `ResearchGroup` model on `research_groups`.
- The migration command is `yarn --cwd server research-entity:migrate`.
- After verified copy parity, `research_groups` can be dropped in that environment; no app runtime path should require it.
- Dependent legacy membership should be copied before deletion: `research_group_members` to `research_entity_members`. The initially planned stats and paper-entity-link target collections were later removed from runtime because they stayed empty and created audit confusion.
- Leftover legacy `applications` rows should be copied into `student_applications` with raw legacy payload retained before dropping `applications`; use `yarn --cwd server legacy:cleanup`.
- Runtime services should use `ResearchEntity` and `researchEntityId`.
- Legacy `researchGroupId` fields may stay in Mongo as inert residue until post-Beta cleanup.
- Data population should run only after development migration verification passes.

## 2026-05-12: Use ORCID To Resolve And Enrich Yale Researchers

ORCID helps resolve and enrich Yale researchers. It should not create Yale users by itself.

Consequences:

- Treat ORCID as a high-confidence external researcher identifier for disambiguating publications, grants, Scholar profiles, rosters, and faculty pages.
- Create or promote `User` records only from Yale-controlled or Yale-corroborated identity evidence such as netid, Yale email, Yalies/Directory records, or official Yale profiles.
- External researcher systems can add identifiers, confidence, provenance, and research-activity enrichment after a Yale identity is established.
- Scrapers should emit ORCID as evidence-backed observations, then let resolver/materializer logic persist and use it.
- Student-facing UI may show ORCID as a plain researcher profile link, but not as a verification badge or undergraduate-access signal.

## 2026-05-14: Accept Local Beta Meili After Product Review

Beta development validation can use the Beta MongoDB with local development Meili while production still uses the shared remote Meili prefix setup.

Consequences:

- `PATHWAY_SEARCH_BACKEND=meili` is accepted for the local Beta validation posture after reviewing real student-style query divergences.
- Rollback remains setting `PATHWAY_SEARCH_BACKEND=mongo`.
- `beta:readiness --strict` should block a Meili runtime unless the operator passes `--accept-pathway-meili` after product review.
- Local Meili may lack the semantic `default` embedder; ResearchEntity search retries keyword search when that embedder is missing so local Beta smoke tests remain usable.

## 2026-05-12: Start Student Workflow Depth With Saved Pathways

The first P3 student workflow slice is saved Pathways, not a full thesis/outreach planning system.

Consequences:

- User accounts store `favPathways` as references to `EntryPathway` records.
- Saved pathway records can still reference evidence-backed routes toward research homes.
- `/account` hydrates saved pathways with guarded public pathway card data and links students back to `/research/:slug`.
- Planning notes, stages, outreach helpers, and fellowship matching should be modeled as later pathway-specific workflow fields instead of being folded into the existing listing/fellowship favorites board.

## 2026-05-12: Keep First Pathway Planning State Local

Saved Pathways can carry local intent, stage, and note state before the app adds durable planning schema.

Superseded by the later 2026-05-12 decision to store saved-pathway planning state as user-owned account data after the workflow proved useful enough for cross-device persistence.

Consequences:

- Students can triage saved pathways as thesis ideas, outreach routes, credit formalization candidates, funding paths, applications, or later items.
- Local notes and stages improve repeat use without creating cross-device or advising-share promises yet.
- Backend schema should wait until route-specific planning requirements are clearer.

## 2026-05-12: Add Route-Specific Checklists Locally First

Saved Pathways can show checklist templates based on planning intent before checklist state becomes durable backend data.

Superseded by the later 2026-05-12 saved-pathway planning persistence decision. Checklist state now persists with saved pathway plans.

## 2026-05-12: Promote Saved Pathway Planning To User-Owned State

Saved Pathway planning state is useful enough to persist beyond browser-local storage.

Consequences:

- User accounts can store saved pathway plans keyed by `EntryPathway` id, including intent, stage, notes, and checklist state.
- `/account` should opportunistically migrate earlier local browser plans into the authenticated user-owned plan store.
- Planning notes remain private account data unless a future advising-share workflow adds explicit visibility rules.
- Saved pathway planning stays separate from legacy listing and fellowship favorites.

## 2026-05-12: Normalize Fellowship Application-Cycle Evidence Before Materialization

Official fellowship rows are strong funding/application-cycle evidence, but they do not by themselves prove that a specific research entity or student pathway is eligible.

Consequences:

- Normalize fellowship `applicationLink`, official link rows, accepting status, open date, deadline, contact office, and contact email into a reusable backend evidence contract before using them in matching or materialization.
- Source-backed support flags require at least one valid official source URL.
- Saved-pathway fellowship matches may expose public application-cycle evidence such as source URLs, active-cycle status, official application route support, deadline status, and contact office.
- Do not expose direct contact email through saved-pathway match payloads; preserve it only for future guarded `ContactRoute` materialization.
- Do not create first-class `EntryPathway`, `AccessSignal`, `ContactRoute`, or `PostedOpportunity` records from standalone fellowship rows until they are tied to a research entity, program, saved pathway context, or structured mentor-matching application.

## 2026-05-12: Retire CourseTable As A Core Discovery Scraper

Yale Research should not use the Yale course catalog as a core "find me a lab" scraper. Students usually arrive before they know enrollment mechanics; they need to discover who does research they care about and how to enter that work.

Consequences:

- Retire the CourseTable-backed course catalog scraper from active scraper registration and source coverage.
- Keep course-credit and senior-thesis evidence as formalization/planning support for stronger future evidence sources such as department pages, program instructions, advisor guidance, posted roles, or admin review. Do not create new `COURSE_CREDIT` entry pathways.
- Source seeding may disable historical `yale-course-catalog` rows instead of deleting production history.
- Scraper audits should prioritize entity discovery, lab/faculty evidence, fellowship-compatible participation, and real posted roles before enrollment mechanics.

## 2026-05-12: Standardize Mongo/Mongoose Naming

Mongoose model registry names and `ref` values should be PascalCase singular. Mongo collection names should be lowercase plural, using `snake_case` for multi-word names. Mongoose document fields remain `camelCase` and should avoid literal `.` or `$` characters.

Consequences:

- New multi-word collections should pass an explicit third `mongoose.model` collection argument such as `mongoose.model('EntryPathway', schema, 'entry_pathways')`.
- New refs should point at PascalCase model names such as `ref: 'ResearchGroup'`, not physical collection names.
- Legacy compact names such as `researchgroups`, `entrypathways`, and `postedopportunities` should be inspected with dry-run-first [`server/src/scripts/migrateMongoNaming.ts`](../server/src/scripts/migrateMongoNaming.ts); any apply against `SCRAPER_ENV=production` requires `CONFIRM_PROD_SCRAPE=true`.
- Do not rename product-facing routes or model concepts just because the physical Mongo collection is renamed.

## 2026-05-13: Keep Discovery Indexes Separate From Access Evidence

Official indexes are strong evidence that an entity exists, but they are not by themselves evidence that undergraduates can join.

Consequences:

- `ysm-atoz-index` and `yse-centers-index` should not emit new `acceptingUndergrads` observations.
- Legacy YSM/YSE discovery-only acceptance observations are ignored by entity/access materialization unless explicit undergraduate evidence exists from another source.
- Public evidence excerpts from scraper-derived access records should redact direct emails and phone numbers while preserving raw structured evidence for audit.
- Source coverage should only list `ContactRoute` when a source intentionally emits guarded official route evidence.

## 2026-05-13: Normalize Public Research Payloads Before Physical Rename

Superseded on 2026-05-13 by the hard-pivot ResearchEntity migration decision above.

The app should expose ResearchEntity vocabulary before renaming the backing collection or compatibility routes.

Consequences:

- `ResearchGroup` remains the physical Mongoose model and Mongo collection for now.
- A `ResearchEntity` Mongoose alias can point at the existing `research_groups` collection while compatibility paths remain active.
- Public research search/detail payloads include `researchEntities` and `researchEntity` aliases while preserving legacy `hits` and `group`.
- New client code can type against `ResearchEntity` without forcing immediate file, route, or collection renames.
- `/api/research-groups` remains a compatibility alias mounted to the same router as canonical `/api/research`.

## 2026-05-13: Reserve Opportunity Detail Pages For PostedOpportunity

The `/opportunities/:id` route may exist, but it must represent a real `PostedOpportunity`, not a generic pathway or exploratory contact route.

Consequences:

- `GET /api/opportunities/:id` should return guarded posted-opportunity detail with host research entity, linked pathway, deadline/application context, and public source evidence.
- Missing, archived, or invalid opportunities should fail closed with a not-found response.
- Posted pathway cards may link to `/opportunities/:id` only when a real posted opportunity id exists.
- Exploratory routes and structured mentor-matching fellowship programs remain Pathways unless there is a specific posted instance. Course credit, ordinary fellowship funding, and thesis advising should be represented as formalization/planning outcomes after a plausible research home is identified.

## 2026-05-13: Course Credit Is Formalization, Not Entry

Research for credit is a formalization pathway after a student finds a research home, mentor, and project. Yale Research should help students discover plausible homes, understand evidence for undergraduate access, and choose the right next step; that next step may later become course credit, paid RA work, fellowship-funded research, thesis advising, or an active posted opportunity.

Consequences:

- Do not materialize course-credit evidence into a standalone `EntryPathway`.
- Show credit eligibility or instructions as a formalization option, evidence note, or best-next-step detail after home/mentor fit.
- Reclassify existing `COURSE_CREDIT`, `SENIOR_THESIS`, and `FELLOWSHIP_FUNDED_PROJECT` usage toward formalization metadata, thesis/advising fit, fellowship compatibility, or real posted opportunities.
- `accessMaterializer.ts` should emit `CREDIT_FORMALIZATION_POSSIBLE` for independent-study/course-credit evidence and should turn past-undergrad fellowship evidence into exploratory outreach plus `FELLOWSHIP_COMPATIBLE`, not a `FELLOWSHIP_FUNDED_PROJECT` entry pathway.
- Student-facing copy should emphasize finding the research home first, then formalizing the relationship through the appropriate Yale mechanism.

## 2026-05-13: Fellowships Default To Formalization, With Program Exceptions

Most fellowship records are funding or application-cycle mechanisms after a student has identified a mentor, lab, project, or research direction. They should support formalization metadata, funding matches, deadlines, and best-next-step guidance rather than automatically becoming entry pathways.

Some fellowships are different: structured programs that match students with mentors, run a cohort research experience, or invite students to apply into a hosted research program can be represented as discovery pathways, program entities, and posted opportunities when source evidence supports that treatment.

Consequences:

- Standalone fellowship rows should not create `EntryPathway` records just because funding exists.
- A fellowship can become a `ResearchEntity` when it is a durable program with its own profile, staff, cohorts, or program page.
- A fellowship can become an `EntryPathway` when it is a practical route into a mentor-matched or hosted research experience.
- A fellowship can become a `PostedOpportunity` when there is a concrete application cycle, deadline, eligibility, and application route.
- Examples: Women’s Health Research at Yale Undergraduate Fellowship and Wu Tsai Undergraduate Fellowships are structured discovery/program pathways; general fellowship databases are usually funding/formalization evidence.

## 2026-05-26: Retire The Standalone Practical-Routes Surface

Yale Research should stay research-home-first. The standalone practical-routes route and public search endpoint are retired because they split the experience and made the product feel less like one interface for finding credible research homes.

Consequences:

- `/research` remains the canonical discovery surface for research homes, evidence, ways in, and best next steps.
- `EntryPathway` remains an internal model for source-backed ways-in evidence, saved planning, and detail-page enrichment.
- Public navigation should not expose a separate Pathways product surface.
- Posted opportunities remain specific active or time-bound instances under `/opportunities/:id`.

## 2026-05-13: Prepare Pathway Meilisearch Before Switching Traffic

Pathways can have a Meilisearch document mapper and settings metadata before the live search API uses Meilisearch.

Consequences:

- Keep pathway Meili work behind internal services until backfill, sync, relevance, parity tests, and rollback checks are ready.
- Index only public pathway/search fields; do not index raw non-public contact data.
- Use the mapper as the shared contract for future backfill and sync work so query switching does not reimplement projection logic.
- `yarn --cwd server meili:rebuild-pathways --confirm-meili-rebuild` is the repeatable rebuild command for parity testing and future cutover prep.

## 2026-05-13: Complete Pre-Beta Development Before Beta Seed

Beta seeding should wait until the Development ResearchEntity, scraper, admin-review, and search gates pass together.

Consequences:

- Course credit and thesis should stay out of standalone Pathway discovery and remain formalization/planning details after research-home fit.
- Development scraper blockers that affect core Research and Pathways quality must be fixed or explicitly deferred before Beta. CS/Psych roster coverage and canonical LLM website selection are now fixed in Development; fellowship CSVs, manual Scholar accepted inputs, and broader arXiv candidate coverage remain input-gated.
- `researchentities` and `pathways` Meilisearch indexes have repeatable rebuild commands; Pathways traffic remains on Mongo until real relevance review passes.
- Production scraper rollout remains per-source approval only; Development validation does not authorize Beta or production writes.

## 2026-05-13: Add WorkPlanner Policies Before Recurring Paid Scraper Runs

Broad and paid scrapers should share a WorkPlanner policy and metrics contract before any unattended cron relies on them.

Consequences:

- Source-level freshness windows and target fields live in one WorkPlanner policy registry.
- Scrapers should report WorkPlanner decisions through `ScraperResult.metrics.workPlanner` so run reports can show fetched versus skipped entities.
- `lab-microsite-undergrad-llm` and `openalex` now have initial policies.
- `lab-microsite-undergrad-llm` uses its source-level `lastObservedAt` heartbeat before external work and skips fresh entities before fetch/LLM calls.
- OpenAlex integration remains required before fresh observations skip those external API calls.

## 2026-05-14: Retire Broken Google Scholar Bootstrap Source

The `apify-google-scholar-bootstrap` source is retired from active scraping because repeated dry runs produced no reviewable Scholar IDs and the current actor output lacks author IDs. Scholar ID discovery stays manual-review only.

Consequences:

- `apify-google-scholar-bootstrap` is removed from the active scraper registry, seed metadata, readiness gates, source coverage, and WorkPlanner policies.
- Existing `Source` rows are marked retired by reviewing `yarn --cwd server scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json`, then applying with `--apply --confirm-seed-apply`.
- Accepted-input/manual review is the supported path for Scholar ID discovery.

## 2026-05-14: Hard-Retire Apify Scholar Enrichment

The active `apify-google-scholar` source is also retired. Official Yale department rosters and profile pages are the identity backbone for faculty enrichment; Google Scholar links scraped from official pages are review candidates only, and accepted Scholar IDs remain a manual `scholar:apply --apply --confirm-accepted-inputs-apply` workflow.

Consequences:

- `apify-google-scholar` is removed from active scraper code, seed metadata, source coverage, WorkPlanner policies, readiness gates, and operator docs.
- Existing `apify-google-scholar` `Source` rows are marked retired by reviewing `yarn --cwd server scrape:seed-sources --dry-run --output /tmp/ylabs-seed-sources-dry-run.json`, then applying with `--apply --confirm-seed-apply`.
- `dept-faculty-roster` expands first to Math, Physics, Statistics & Data Science, and Astronomy, and official profile enrichment may emit ORCID, research interests, lab URLs, and review-only Scholar candidate URLs.

## 2026-05-13: Retire Legacy Python Web Scrapers

The tracked `web-scraper/` Python prototypes are retired. Active and future scraping should live in the evidence-first TypeScript pipeline under [`server/src/scrapers`](../server/src/scrapers).

Consequences:

- Use the registered scraper CLI (`yarn scrape ...`) for maintained source work.
- Keep YSM lab discovery in `ysm-atoz-index`; it replaces the old Medicine prototype.
- Add future Physics or History roster coverage as `DepartmentRosterScraper` configs or dedicated TypeScript sources, not as standalone JSON-writing scripts.

## 2026-05-13: Source Department Taxonomy From Official Yale Pages

The `departments` collection is an app taxonomy for research discovery filters, colors, smart titles, scraper cohorts, and department resolution. It should be generated from a curated overlay checked against official Yale sources, not from loose root text files.

Consequences:

- Yale College subject codes are checked against the 2026-2027 Yale College Subject Abbreviations page.
- Yale School of Medicine department names are checked against YSM Departments & Centers.
- Medical-school acronyms, including `YSPH` and `EPH`, are checked against YSM Common Abbreviations & Acronyms.
- Alternate official codes and historical/local labels live in `Department.aliases`; source evidence lives in `Department.sourceRecords`.
- `data-migration/seedDepartments.ts` is dry-run by default and only writes with `--apply`; stale active rows are marked inactive rather than deleted.
- The dry run fails if any official source parser returns zero rows, prints local-only app taxonomy rows, and audits unresolved department strings in `research_entities`, `listings`, current user profile fields, and legacy user profile field names.
- Legacy root files `departments.txt`, `abbreviations.txt`, and `valid_departments.txt` are removed so they cannot compete with the source-backed seed.

## 2026-05-14: Treat Full Beta Scraper Soak As Separate From Baseline Seed

The baseline Beta seed can prove schema, materialization, Meili indexing, accepted inputs, and smoke-test posture, but it is not the same as the requested full scraper test. A full Beta soak should not rely on arbitrary `--limit` caps unless a source has an explicit safety policy.

Consequences:

- Production promotion waits for an accepted full Beta soak, not merely a bounded baseline seed.
- Beta audits should use canonical collections such as `research_entities`; the absence of legacy `research_groups` is expected after the hard migration.
- `lab-microsite-undergrad-llm` may use an explicit `--ignore-work-planner` operator flag for deliberate full-audit Beta runs.
- OpenAlex no-discovery mode targets only identifier-backed users by default. Broad name discovery is high-risk and should remain deliberate, reviewed, and separate from normal full-safe Beta execution.
- Full OpenAlex execution needs chunking, resume/checkpoints, or another explicit source-specific safety policy before it can be accepted for production promotion.

Updated after the 2026-05-14 Beta soak: OpenAlex full execution is accepted for Beta using deterministic offset chunks, no name-only discovery, and no per-author page cap. The current production decision is no longer "can it run?" but "how much raw OpenAlex evidence should production retain?"

## 2026-05-14: Use Compact Retention For Full OpenAlex On Small Atlas Tiers

Full OpenAlex emits millions of per-field observations. On the current 5GB Beta Atlas tier, retaining every raw OpenAlex observation blocks writes before the full source can complete. For Beta, durable publication data is the materialized `papers` collection; run logs preserve per-chunk reports, and raw OpenAlex observations may be pruned after successful materialization.

Consequences:

- OpenAlex production rollout must choose between provisioning enough Atlas storage for raw observations or using the same compact-retention policy.
- The scraper supports resumable offsets so full runs can be retried without one long fragile process.
- Paper materialization uses a fast bulk path for OpenAlex-scale runs; it still records materialization conflicts and errors on `ScrapeRun`.
- Do not apply this pruning pattern casually to access-evidence sources. For student-facing access claims, raw observations remain the audit backbone unless a separate retention decision is made.

## 2026-05-14: Require Identity-Backed Authorship For Faculty Paper Links

Yale Research uses papers and preprints to help students understand what professors and labs work on, but automatic faculty-paper links must be trustworthy. Name-only arXiv/OpenAlex-style matching is not enough to attach a paper to a Yale professor.

Consequences:

- Yale-controlled sources prove the person; accepted external identifiers prove scholarly identity; identity-backed work feeds prove authorship.
- `paper_authors` is the durable proof layer. `Paper.yaleAuthorIds` and `Paper.yaleAuthorNetIds` remain denormalized runtime fields for fast student surfaces, but new writes derive them from `paperAuthorshipEvidence`.
- arXiv is metadata-only: it can upsert preprint metadata by `arxivId`, but it must not emit Yale author IDs or faculty authorship evidence from name search.
- OpenAlex can attach authorship only through accepted ORCID or accepted OpenAlex author ID. Name-only OpenAlex discovery is review-only and no longer writes `User.openAlexId`.
- ORCID public works and Europe PMC ORCID queries are accepted authorship sources for users with accepted `User.orcid`; Crossref hydrates DOI metadata without creating Yale author links by itself.
- Beta cleanup backfilled legacy OpenAlex links into `paper_authors`, superseded active arXiv author observations, and cleared arXiv-only faculty links while preserving arXiv paper metadata.

## 2026-05-25: Promote Program And Student Visibility Model On New Foundation

The newer fellowship work contains two separable ideas: URL hygiene for official Yale fellowship pages, and a broader program/student-visibility model. `new-foundation` now promotes both pieces, while keeping legacy `/api/fellowships` and `/fellowships` compatibility aliases during the transition.

Consequences:

- `yale-college-fellowships-office` canonicalizes moved Yale College financial-awards URLs, including Mellon Mays, to the current `college.yale.edu/life-at-yale/student-faculty-awards/...` page.
- CommunityForce URLs are preserved as official application links but are not fetched as scraper targets.
- `/api/programs` is the canonical public program contract backed by the existing Fellowship collection while storage is migrated incrementally.
- The Fellowship schema now carries program classification fields, source metadata, and shared student visibility fields.
- Student-facing program and research search should default to public visibility tiers only; admin/operator flows can include `operator_review` and `suppressed` when explicitly requested.
- Updated 2026-06-06: non-admin program/fellowship service reads and interaction responses return allowlisted student-facing fields only. Public payloads preserve application, eligibility, official contact, source label, and deadline fields while omitting source keys/fingerprints, visibility review internals, archive/audit state, and engagement counters; admin/operator reads with `includeNonPublic` retain the full review payload.
- The Operator Board is read-only and summarizes Trust Tier queues, source health, and gate commands. It does not execute writes or automatic approvals.
- Before relying on the public program surface after a data import, run dry-run classification and visibility backfills, inspect the report, then apply intentionally.

## 2026-05-25: Make Production Promotion A Single Explicit Gate

Production promotion must use one explicit lane: copy the accepted Beta research-discovery dataset after fresh parity and backup checks, or run guarded production deltas source by source. Mixing the two in one promotion makes rollback and smoke interpretation ambiguous.

Consequences:

- Production promotion requires a fresh Atlas backup or restore point before copy or writes.
- Accepted Beta copy is allowed only when fresh parity confirms Beta contains the production base records that must be preserved.
- Guarded production delta runs must be one source at a time with `SCRAPER_ENV=production`, `CONFIRM_PROD_SCRAPE=true`, and `--release`.
- Meilisearch rebuild or sync is a required post-Mongo step; Pathways rollback remains `PATHWAY_SEARCH_BACKEND=mongo`.
- Render cron is for accepted source-specific recurrence, not initial backfill, VPN-dependent sources, local accepted-input files, or interactive browser checks.
- `docs/tasks/priority-roadmap.md` records the lane, backup identifier, run IDs, Meili outcome, smoke outcome, rollback posture, and accepted warnings after the gate.

## 2026-05-25: Make Student Visibility Promotion A Release Queue Gate

Public research and program visibility is now controlled by a reusable student visibility gate rather than ad hoc operator review. The gate applies the existing public-safety rules, promotes `student_ready` and `limited_but_safe` records automatically, and writes held records to `visibility_release_queue_items` with blocker reasons, source pressure, and next repair actions.

Consequences:

- `operator_review` remains the compatibility tier, but admin workflow language should treat those rows as held release queue items.
- Scraper auto-materialize, manual materialize, and production cron paths run the gate after clean write materialization. Standalone manual materialize writes require `--confirm-materialize`; dry-run materialization remains the artifact-first review path.
- `yarn --cwd server student-visibility:gate --collection=all --mode=dry-run|apply` is the global reconciliation command.
- The admin Operator Board exposes release queue pressure; `/api/admin/release-queue` provides paginated queue details.
- Held rows should be repaired at the scraper/materializer/source-evidence layer, not manually promoted by weakening visibility rules.

## 2026-06-05: Fail Closed On Production Auth Config And Audit Every Package Tree

Yale CAS authentication must not derive production service URLs from request host headers. Production startup now requires explicit HTTPS `SSOBASEURL` and `SERVER_BASE_URL` values, and rejects localhost callback origins.

Consequences:

- Deploy configuration must set `SERVER_BASE_URL` to the public HTTPS app origin and `SSOBASEURL` to the Yale CAS HTTPS origin before production boot.
- `server/src/passport.ts` normalizes quoted env values and fails fast in production rather than allowing `passport-cas` to fall back to `Host` or `X-Forwarded-Host`.
- CI runs moderate-and-higher production dependency audits for the root, server, and client package trees separately because this repo has independent lockfiles and dependency surfaces.
- Yarn resolutions pin vulnerable transitive CAS dependencies (`axios`, `underscore`) and Express route parsing (`path-to-regexp`) until upstream package ranges make those pins unnecessary.

## 2026-06-05: Guard Unsafe Browser Mutations By Origin

Yale Research uses session cookies for authenticated API calls, so production unsafe methods must not rely on CORS alone for cross-site request protection. Production API `POST`, `PUT`, `PATCH`, and `DELETE` requests now require a trusted `Origin` or `Referer` from the configured app origins.

Consequences:

- `server/src/middleware/csrfOriginGuard.ts` blocks production unsafe `/api` requests with missing or untrusted browser origins before JSON body parsing.
- Local development, test, and CI keep permissive behavior so scripts and focused tests do not need browser-origin headers.
- Cache refresh is POST-only at `/api/config/refresh`; the public cacheable `/api/config` GET remains unchanged.
- Cache refresh is admin-only because it invalidates shared server state and forces fresh database reads.
- Shared research-area creation is limited to professor/faculty/admin users, matching the profile/listing editor flows and preventing ordinary student accounts from polluting global taxonomy data.
- Shared research-area creation normalizes label whitespace/control characters and rejects names that embed direct emails or phone numbers before the label enters global filters/config.
- Explicitly untrusted CORS origins should fail as intentional `403` client errors, while missing origins from health checks or server-side tools continue without production CORS headers.
- Production promotion smoke requests derive the browser origin from `--app-base` and send it on unsafe API methods so smoke behavior matches deployed browser requests under the origin guard.
- `/api/logout` is a state-changing GET because it clears the local session before redirecting to CAS logout, so deployed logout requests require a same-origin `Origin` or `Referer` even though the general CSRF guard treats GET as safe.
- Admin URL reachability checks reject oversized batches and malformed URL values before doing DNS or outbound fetch work.
- Admin URL reachability checks resolve hosts before and during connect, block private/special-use IPv4 and IPv6 ranges including metadata, loopback, IPv4-mapped IPv6, and NAT64 forms, reject credentialed URLs and non-web ports, and use no-redirect HEAD requests through guarded HTTP agents.
- Case-insensitive netid lookups must escape regex metacharacters before building exact-match Mongo filters so user-controlled ids cannot become regex queries or match the wrong account.
- Runtime admin authority is grant-backed: outside local localhost development, `isAdmin` and Passport session user state must treat active `admin_grants` records as the source of truth and downgrade legacy `User.userType = "admin"` rows without a grant.
- Third-party identity lookups that require bearer keys must read the current environment at call time and fail closed before outbound requests when the key is absent, avoiding stale imported secrets or `Bearer undefined` authorization headers.
- `NODE_ENV=prod` is treated as production for auth config and secure cookies, while the package script now sets canonical `NODE_ENV=production`.
- Deployed runtimes use the `__Host-session` cookie name with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` so browsers enforce host-only session scope. The legacy `session` cookie name is reserved for true localhost development.
- Development-labelled remote runtimes must not inherit local security bypasses. CORS bypasses, CSRF origin bypasses, rate-limit skips, weak/missing session-secret tolerance, non-secure session cookies, local CSP connect origins, non-HTTPS CAS/base URL tolerance, internal 500 error-message disclosure, seed routes, dev-login, local auth bypass, and legacy admin fallback are allowed only in CI/test or when `SERVER_BASE_URL` is a localhost development origin.
- Controller-owned and global API error responses should use generic user-facing messages for unexpected failures and fixed public copy for client-error status codes. Raw internal `error.message` belongs in server logs or local-only middleware diagnostics, not authenticated/public API responses; not-found/object-id failures should not echo ids, slugs, netids, database URLs, or service exception text.
- CI actions are pinned to immutable commits for `actions/checkout` and `actions/setup-node` to reduce workflow supply-chain drift.

## 2026-06-05: Keep Deploy Dependency Audits Clean At Moderate Severity

Deploy readiness should track moderate-and-higher dependency advisories across all independently locked package trees, not only high severity production findings.

Consequences:

- Root, server, and client dependency audits should run separately because each has its own lockfile and deployment surface.
- Production audits remain the runtime gate, but all-environment audits should also stay clean because compromised dev/test tooling can affect CI, local verification, and built artifacts.
- CI should enforce both moderate-and-higher production audits and moderate-and-higher all-environment audits for the root, server, and client package trees.
- CI should run the repo-local committed-secret scanner before build. The scanner reports only path, line, and rule identifiers for high-confidence tokens/credentialed URIs/private-key blocks, never matched secret text.
- The server runtime floor is Node `>=20.19.0`, matching the current Cheerio/encoding stack and local deploy build behavior.
- Passport is on `0.7.0`; logout routes must use the async `req.logOut(callback)` API and forward callback errors through Express error handling.
- Yarn resolutions pin patched `passport-cas` transitives (`uuid`, `xml2js`), client/server parser transitives (`postcss`, `yaml`, `encoding-sniffer`), and lagging dev-tooling transitives (`glob`, `minimatch`, `brace-expansion`, `picomatch`, `tar`, `ip-address`) until upstream package ranges no longer pull vulnerable or deprecated versions.
- Operator repair scripts must not bypass Yale TLS verification; certificate failures should fail the bounded repair rather than retry with `rejectUnauthorized: false`.

## 2026-06-05: Enforce Browser Link And Script Execution Guardrails

Student and admin surfaces render many source, application, profile, and evidence links from API data, so browser-link safety must be centralized rather than handled ad hoc in each component. Static HTML should also be compatible with a strict script CSP instead of relying on inline scripts.

Consequences:

- API-sourced external links should pass through `safeUrl` or `safeUrlList` before reaching `href`; invalid or scriptable schemes should suppress the link.
- New-tab links should use `rel="noopener noreferrer"` or the shared `EXTERNAL_LINK_REL` constant.
- Programmatic new-tab opening should use `openSafeUrlInNewTab`; OAuth popups that require `window.opener` are the exception and must verify same-origin callback messages, the exact popup window source, and a request-bound OAuth `state`.
- Express responses set CSP and Permissions-Policy in `server/src/middleware/securityHeaders.ts`; inline scripts are not allowed by `script-src`.
- Production CSP must not include local development origins such as `http://localhost:4000` in `connect-src`; local origins belong only in non-production policy generation.
- Production CSP must not use a broad `connect-src https:` wildcard. Browser fetch/beacon destinations should be explicit: Yale Research app/API origins, Google Sheets export API, and the configured Google Analytics endpoints. True local development may add `http://localhost:4000` only when the runtime is local.
- Production CSP must not use a broad `img-src https:` wildcard. Public profile image DTOs should expose only trusted Yale/Yalies/YSM image hosts, and browser image sources should match that allowlist plus local `self`, `data:`, and `blob:` needs.
- Analytics and OAuth callback bootstraps live in static files under `client/public/` so production `client/dist` HTML remains CSP-compatible after build.

## 2026-06-05: Allowlist Public Embedded Listing Summaries

Public research detail responses may retain a small `activeListings` bridge for backwards compatibility, but that bridge must not serialize full `Listing` documents. Legacy listing rows contain owner and collaborator contact fields plus internal counters and audit state.

Consequences:

- `server/src/services/researchGroupService.ts` maps active listings through a public field allowlist before returning `/api/research/:slug`.
- Public research detail payloads can include listing title, description, application websites, departments, research areas, timing, and public role metadata.
- Public research detail payloads must omit listing owner ids, creator ids, owner emails, collaborator emails, view/favorite counts, confirmation/audit flags, and other authenticated/admin-only fields.
- Authenticated profile listing payloads follow the same public field boundary; `/api/profiles/:netid/listings` must not return full legacy `Listing` documents.
- Legacy authenticated reader surfaces such as `/api/listings/search`, `/api/listings/:id`, and favorited listing hydration also use the same reader-safe projection. Owner management and admin routes remain the places where owner/collaborator fields can be returned.

## 2026-06-06: Allowlist Current-User Mutation Responses

Authenticated favorite, saved-program, saved-research-plan, and profile-update mutations should not echo the full `User` document. Those rows include private saved-planning notes, login/activity metadata, scholarly identifiers, scrape confidence maps, manual locks, archive/dedupe state, and other fields unrelated to mutation success.

Consequences:

- `server/src/controllers/userController.ts` maps current-user mutation responses through a small allowlist before returning `{ user }`.
- Favorite and saved-item mutation responses can include current account identity, public profile fields, and saved id arrays, but must omit `savedPathwayPlans` and internal account/profile maintenance metadata.
- Explicit saved-plan detail endpoints remain the place where private planning notes are returned to the authenticated account holder.

## 2026-06-06: Allowlist Public Faculty Profile DTOs

Public faculty profile reads and profile self-edit responses should be generated from an explicit DTO, not by spreading full `User` documents. User rows carry saved planning state, login/activity timestamps, scrape confidence maps, manual locks, scholarly candidate ids, archive/dedupe state, and other maintenance metadata that is not part of the profile contract.

Consequences:

- `normalizePublicProfile` starts from an allowlist of intentional profile fields before adding client aliases such as `image_url`, `profile_urls`, `research_interests`, and `scholarlyLinks`.
- `/api/profiles/:netid`, `/api/profiles/me`, and profile verification responses are defensively projected even when a service or test double returns a broader user-shaped object.
- Separate profile publication, listing, and saved-plan endpoints remain responsible for their own narrower payloads.

## 2026-06-06: Sanitize Public Opportunity Detail URLs Server-Side

Public opportunity detail responses are an unauthenticated trust boundary. Client-side link guards are still required, but the API should not return scriptable or non-web URL schemes in application routes, source links, evidence links, or host research-home links.

Consequences:

- `server/src/services/opportunityDetailService.ts` normalizes public opportunity URLs through an HTTP(S)-only allowlist before returning `GET /api/opportunities/:id`.
- Application state is derived from the sanitized application URL, so `javascript:`, `data:`, `mailto:`, and malformed values behave as no public application route.
- Public opportunity source URLs, pathway source URLs, evidence `sourceUrl`, and research-entity website fallbacks omit non-HTTP(S) schemes even if raw scraper or listing data contains them.

## 2026-06-11: Canonicalize Faculty UserType To Professor

The `User.userType` and `AnalyticsEvent.userType` schemas use `professor` as the single stored academic account type. `faculty` remains a legacy input value only and is normalized to `professor` at model/materialization boundaries. Admin analytics should display the canonical `professor` bucket as "Faculty & Professors" when the audience needs broader Yale wording.

Consequences:

- New `User` and `AnalyticsEvent` writes normalize `userType: "faculty"` to `userType: "professor"`.
- User materialization normalizes legacy `userType` observations before writing to the `users` collection.
- `server/src/scripts/normalizeFacultyUserTypes.ts --apply` rewrites existing `users`, `analytics_events`, and user-type `observations` rows from `faculty` to `professor`.
- Legacy query code may continue reading both `professor` and `faculty` during transition, but new stored records should not introduce a separate `faculty` bucket.

## 2026-06-06: Mark Private Authenticated Payloads No-Store

User account endpoints return private saved ids, favorites, profile mutation results, saved research-plan details, advising notes, checklist state, and planning intent. The auth check endpoint returns the current cookie-derived user summary. Authenticated profile endpoints return profile-bound identity, publication, course, listing, self-update, and verification payloads. Authenticated program, fellowship, pathway, and research-area endpoints can include saved/favorite state, authenticated search context, route evidence, and user-created taxonomy mutations. Authenticated listing endpoints include owner-management and reader-specific listing responses. Admin and analytics endpoints expose operational queues, user behavior aggregates, grants, review records, and internal operator state. These authenticated payloads should not be stored by shared caches, browser history caches, or intermediaries.

Consequences:

- `server/src/routes/users.ts` sets `Cache-Control: no-store, private, max-age=0` and `Pragma: no-cache` on all `/api/users/*` responses.
- `server/src/passport.ts` sets the same private no-store headers on `/api/check` because it reflects the current session user state.
- `server/src/routes/profiles.ts` sets the same private no-store headers on all `/api/profiles/*` responses because those routes are authenticated and can include profile-bound course, publication, listing, update, or verification state.
- `server/src/routes/programs.ts`, `server/src/routes/fellowships.ts`, `server/src/routes/pathways.ts`, and `server/src/routes/researchAreas.ts` set the same private no-store headers on authenticated discovery/search/taxonomy responses.
- `server/src/routes/listings.ts` sets the same private no-store headers on all `/api/listings/*` responses.
- `server/src/routes/admin.ts` and `server/src/routes/analytics.ts` set the same private no-store headers on admin/operator and analytics responses.
- `server/src/controllers/userController.ts` sets `Cache-Control: no-store, private, max-age=0` and `Pragma: no-cache` on saved-plan detail, export, update, and delete responses.
- Export endpoints keep their explicit private-notes opt-in, but all exports are treated as private account payloads because even note-free exports reveal saved planning state.
- Public cache headers remain limited to genuinely public config responses.

## 2026-06-05: Constrain Self-Service Listing Identity Claims

Professor-created legacy listings still feed posted-role and `PostedOpportunity` workflows, but self-service listing writes must not let one account claim another research entity or place roles on another professor's profile without a trusted membership relationship.

Consequences:

- New listings may bind to a submitted `researchEntityId`/`researchGroupId` only when the authenticated owner is a current PI, co-PI, director, co-director, or core-faculty member of that entity.
- If the submitted entity id is missing or unauthorized, listing creation falls back to the owner's own PI research entity through `findOrCreateForOwner`.
- Self-service listing creation and update strip collaborator identity fields (`professorIds`, `professorNames`, `emails`); collaborator/profile placement remains an admin-owned or future consented-collaboration workflow.
- Self-service listing creation and update trim and bound public text fields, taxonomy arrays, and listing websites before storage, Meili sync, and posted-opportunity materialization.
- Listing websites accepted from self-service writes must be public HTTP(S) URLs without embedded credentials.
- Client-supplied owner, creator, confirmation, audit, counter, archive, and embedding fields are not part of the self-service listing creation contract.

## 2026-06-05: Allowlist Public ResearchEntity DTOs And Relationships

Public research search/detail payloads should not spread full Mongo `ResearchEntity` documents. Those documents include operator review state, ownership/claim fields, field provenance, and runtime notification/inquiry caches that are not part of the student-facing contract.

Consequences:

- `server/src/services/researchEntityDto.ts` is the public ResearchEntity boundary and must stay allowlist-based.
- Public ResearchEntity DTOs may include compatibility fields needed by the research UI, but must omit claim ownership, reviewer ids, visibility override/suppression notes, provenance maps, embeddings, and notification/inquiry caches.
- Related and affiliated entities on public research detail pages must pass the same `publicStudentVisibilityTiers` allowlist as direct public research search/detail results.
- Relationship rows on public research detail pages must also be allowlisted; structural metadata and source URL/confidence are allowed, but raw evidence quotes and audit timestamps are not serialized.
- Public research detail access artifacts (`EntryPathway`, `AccessSignal`, and `PostedOpportunity`) must also be mapped through explicit DTO allowlists rather than returned as raw derived records. Operator review status, derivation keys, source-evidence ids, archive state, and materialization timestamps stay internal.
- Public ResearchEntity DTO text fields, including entity display labels, public arrays such as `departments` and `researchAreas`, and nested compatibility objects such as `accessSummary`, `waysIn`, `searchMatch`, and `studentDecisionExplanation`, should pass through direct-contact redaction before reaching clients.
- Public evidence-style text in research detail and opportunity detail payloads should pass through direct-contact redaction before reaching clients.
- `/api/pathways/search` is mounted as an authenticated Ways In endpoint and defaults to Mongo search unless `PATHWAY_SEARCH_BACKEND=meili` is explicitly set.

## 2026-06-05: Require Deploy Fingerprints In Production Smoke

Production promotion should prove that the host is serving the expected backend revision, not merely that a host is reachable. Public `/api/config` now exposes a narrow deployment fingerprint from provider metadata, and promotion smoke can compare it with an expected commit prefix.

Consequences:

- `/api/config` may expose only safe deployment metadata: provider, git commit SHA, and git branch. It must not expose service ids, instance ids, secrets, or arbitrary environment values.
- Render deployments use `RENDER_GIT_COMMIT` and `RENDER_GIT_BRANCH`, which are documented default runtime variables; local or unknown environments may return empty strings.
- `yarn --cwd client smoke:production-promotion --expect-commit <sha>` is the release-grade smoke command for deploy drift. Missing or mismatched fingerprints fail the smoke report before production promotion.
- The `Production Security Smoke` workflow defaults `SMOKE_EXPECT_COMMIT` to `github.sha` so scheduled and manual runs fail stale deployments by default rather than treating a missing comparison as an operator warning.
- Production promotion smoke also checks core browser hardening headers on `/api/config`, including CSP, Permissions-Policy, frame denial, MIME-sniffing protection, referrer policy, COOP, and HSTS. Missing CSP or Permissions-Policy is a deploy blocker even if the endpoint returns `200`.
- A passing `/api/config` status alone is not evidence that the current backend bundle is deployed.

## 2026-06-11: CI Installs Must Be Lockfile-Immutable

Security and release checks are only meaningful if the runner installs the exact dependency graph represented by committed lockfiles. CI must not silently resolve new dependency versions while validating a beta or production candidate.

Consequences:

- GitHub CI uses `yarn install:all:immutable`, which runs immutable installs for the root, server, and client lockfiles.
- Render production scraper cron builds use the same immutable install script.
- Local developer install commands can stay ergonomic, but deploy/security CI must fail when `package.json` and lockfiles drift.
- The security preflight policy test asserts both the immutable install script and the CI wiring.

## 2026-06-11: GitHub Workflow Tokens Are Read-Only

CI, keep-alive, and production smoke workflows should not inherit broad default `GITHUB_TOKEN` permissions. Security gates that only read source or ping production need repository read access only.

Consequences:

- GitHub workflows declare top-level `permissions: contents: read`.
- The security preflight policy test rejects write-capable workflow permissions.

## 2026-06-11: Server Startup Fails Closed

Deployment health checks and smoke tests are only meaningful when backend startup failures terminate the process. Startup errors can also contain database URLs, credentials, or provider diagnostics, so they must pass through the shared log sanitizer.

Consequences:

- `server/src/index.ts` logs sanitized startup errors.
- Startup failure exits with status `1` instead of allowing deploy tooling to treat a broken runtime as clean.
- The security preflight policy test asserts sanitized fail-closed startup behavior.

## 2026-06-11: Profile Read Routes Validate NetID Path Parameters

Authenticated profile read endpoints perform user and listing lookups from `:netid` path parameters. Those parameters should be bounded at the routing layer before controller or database work.

Consequences:

- `/api/profiles/:netid` and its publications, listings, and courses subroutes use the shared `validateNetid('netid')` middleware.
- Invalid or oversized profile identifiers are rejected with a generic `400` before profile services run.
- Route tests and the security preflight policy test cover the middleware ordering.

## 2026-06-11: Bound Recursive Mongo-Key Sanitization

The API-wide Mongo sanitizer is a request-boundary defense, so it must not perform unbounded recursive traversal over attacker-controlled JSON before controllers and service-level validators run.

Consequences:

- `sanitizeMongo` removes Mongo operator, dotted, and prototype-pollution keys while capping recursive traversal depth.
- `sanitizeMongo` caps array items and object keys before recursively reading nested values.
- Over-depth nested values are dropped instead of being walked indefinitely.
- Focused middleware tests and the security preflight policy test cover the traversal caps.

## 2026-06-11: Client API Base URLs Must Be Safe Origins

Client-side login, logout, and API helpers must not build destinations from arbitrary build-time strings. A malformed `VITE_APP_SERVER` can otherwise turn navigation or API calls toward a credential-bearing, scriptable, or unintended backend URL.

Consequences:

- Production host detection is exact for `yalelabs.io` and `www.yalelabs.io`, not substring-based.
- Non-production `VITE_APP_SERVER` values are accepted only when they parse as credential-free HTTP(S) URLs.
- A trailing `/api` suffix is normalized away before appending API paths.
- Logout navigation uses the same safe API URL builder instead of reading from a mutable Axios instance.
- Client unit tests and the security preflight policy test cover this URL boundary.

## 2026-06-11: Treat Spreadsheet Exports As Formula-Injection Boundaries

Spreadsheet export destinations can execute formula-like cell values that originate from saved programs, notes, scraper-derived text, or accepted-input review rows. All local CSV and Google Sheets writers should neutralize formula-like cells before serialization.

Consequences:

- Browser CSV downloads and Google Sheets exports share a client-side spreadsheet cell neutralizer.
- Server-side accepted-input review/export CSV writers neutralize formula-like values before CSV escaping.
- The security preflight statically checks that spreadsheet export paths keep using the neutralizer.

## 2026-06-11: Legacy Admin UserType Is Not Runtime Authority

The `userType: "admin"` field is legacy account metadata, not production authorization. Runtime admin authority must come from an active admin grant, with the existing legacy-admin bypass limited to local development.

Consequences:

- `isAdmin`, `isProfessor`, `isTrustworthy`, and listing creation guards all require active admin-grant authority before treating an `admin`-typed account as privileged.
- Professor/faculty users still use the normal confirmed/profile-verified path for professor-only and listing-creation actions.
- The security preflight checks that `admin` is not included in listing-creation role allowlists and that professor/trustworthy guards call the active-grant authority helper.

## 2026-06-11: Faculty Profile Media And Profile Links Are HTTP(S)-Only

Faculty profile image, website, and generic profile URL fields are scraped or account-derived data. They should not render scriptable, `data:`, `blob:`, or `mailto:` values in profile media/link slots.

Consequences:

- Profile email rendering remains the only mailto path and must use `safeMailtoHref`.
- Profile website links, profile URL chips, account/profile previews, lab-member cards, and profile image `src` values use `safeHttpUrl`.
- Unsafe profile images fall back to initials instead of rendering attacker-controlled media URLs.
- Public PI contact-route derivation also treats attached official profile URLs as public URL boundaries. Credential-bearing `https://user:pass@...` URLs are rejected even when the parsed host is Yale-owned.
- Research discovery source labels and official-Yale evidence status also use `safeHttpUrl` before parsing hostnames, so credential-bearing URLs cannot receive trusted Yale-source UI treatment.
- Publication DOI links use the shared `safeDoiUrl` helper instead of interpolating raw DOI strings into outbound `doi.org` anchors.

## 2026-06-11: Admin Config Refresh Responses Are No-Store

Public `GET /api/config` remains cacheable because it serves public client configuration. Authenticated admin refresh mutations should not be cacheable even when their response body mostly mirrors public config.

Consequences:

- `POST /api/config/refresh` sets `Cache-Control: no-store, private, max-age=0` and `Pragma: no-cache` before auth/admin handlers.
- The security preflight checks that the public config read remains explicitly public-cacheable while refresh remains admin-only and no-store.

## 2026-06-11: Profile URL Storage Uses The Same Sanitizer For Self And Admin Edits

Profile image, website, and profile URL fields are public-browser URL surfaces. Admin edits should not be able to persist URL values that faculty self-edit would reject.

Consequences:

- `updateOwnProfile` and `adminUpdateProfile` both pass `website`, `imageUrl`, and `profileUrls` through the bounded public HTTP(S) URL sanitizer before persistence.
- Unsafe schemes, credential-bearing URLs, `mailto:` profile URLs, oversized URL values, and oversized profile URL maps are dropped before storage.
- The security preflight checks both update paths call the shared sanitizer.

## 2026-06-11: Analytics Metadata Is Bounded Before Persistence

Analytics metadata can include user-entered search/context fields. It should not become an unbounded storage sink or a way to persist direct-contact details.

Consequences:

- Analytics text, search-department arrays, metadata arrays, object width, object depth, and metadata key length are bounded before `AnalyticsEvent.create`.
- Metadata keys that could trigger prototype pollution or Mongo key ambiguity (`__proto__`, `constructor`, `prototype`, leading `$`, and dots) are dropped or normalized.
- The security preflight checks that analytics persistence keeps both direct-contact redaction and bounded metadata sanitization.

## 2026-06-11: Saved Pathway Checklist Keys Are Normalized Before Storage

Saved pathway plans are private student data stored under nested Mongo paths. Checklist keys should stay user-facing labels and must not introduce prototype or Mongo operator/path ambiguity.

Consequences:

- Saved pathway checklist keys are trimmed, length-bounded, and normalized before persistence.
- `__proto__`, `constructor`, and `prototype` checklist keys are dropped; leading `$` and dots are normalized to safe labels.
- The pathway id itself still goes through ObjectId normalization before it becomes the `savedPathwayPlans.<id>` update path.

## 2026-06-11: Authentication Errors Must Be Sanitized Before Logging

CAS and Passport errors can include service URLs, CAS tickets, bearer tokens, credential-bearing URLs, emails, or stack traces with sensitive callback context. Authentication logs should keep diagnostic value without writing raw error objects.

Consequences:

- `server/src/passport.ts` logs auth errors through `sanitizeLogValue`.
- The shared log sanitizer redacts CAS `ticket=` and `cas_ticket=` assignments in addition to credentials, tokens, emails, and phones.
- Security preflight blocks regressions that serialize raw Passport auth errors or log raw stacks.

## 2026-06-11: Route ObjectId Validation Uses 24-Hex Boundaries

Shared route ObjectId validation now requires canonical 24-character hexadecimal ids in `server/src/middleware/validation.ts` instead of relying on Mongoose coercion. This rejects 12-byte non-hex strings at the route boundary before controller or service work.

## 2026-06-11: Local Auth Bypass Fails Toward Student Privilege

Local-only auth bypass user-type normalization in `server/src/passport.ts` now falls back to `student` for malformed values instead of `admin`. Explicit `admin` remains available for deliberate local development, but typos or hostile dev headers no longer create accidental admin sessions.

## 2026-06-11: Local Auth Bypass NetIDs Are Bounded

Local-only auth bypass identity construction in `server/src/passport.ts` now accepts only Yale-style 2-12 character alphanumeric NetIDs from headers or environment defaults. Malformed values fall back to a safe local default before session creation, authorization checks, or analytics logging.

## 2026-06-11: Scraper Integrity Reports Use Safe Artifact Output Paths

Scraper integrity report writers now resolve `--output` through `resolveSafeJsonReportOutputPath` in `server/src/scripts/scriptWriteGuards.ts`. Integrity artifacts must be `.json` files under the system temp directory or project `tmp/`, which prevents operator tooling from accidentally overwriting arbitrary files while running with scraper or database credentials.

## 2026-06-11: Generic Scraper CLI Outputs Use Safe Artifact Paths

The generic scraper CLI JSON output helper in `server/src/scrapers/scraperCliOutput.ts` now uses the shared `resolveSafeJsonReportOutputPath` guard. Scraper run, cron, materialization, report, and prune artifacts must be `.json` files under the system temp directory or project `tmp/`, reducing accidental arbitrary-file overwrite risk while operator tooling runs with scraper or database credentials.

## 2026-06-11: Client Image Sources Use Safe URL Boundaries

Developer profile cards now route image paths through `safeImageSrc` in `client/src/utils/url.ts`. The helper allows HTTP(S) image URLs and root-relative app asset paths, but rejects scriptable, data, protocol-relative, control-character, and backslash-containing values before rendering `src` attributes.

## 2026-06-11: Deployed CSP Upgrades Insecure Requests

The server security header middleware now adds `upgrade-insecure-requests` to the Content Security Policy whenever local-development connection bypasses are not active. True local development keeps the directive out to avoid disrupting localhost workflows, while production and remote development-labelled runtimes get mixed-content upgrade protection.

## 2026-06-11: Google Sheets OAuth Export Boundary Validation

Client-side Google Sheets exports treat OAuth popup messages and Sheets API responses as untrusted boundaries. Matching OAuth state remains required, and the received access token must also match a bounded bearer-token shape before caching or use. Created spreadsheet URLs returned by Google must be HTTPS `docs.google.com/spreadsheets/...` URLs before the app opens them.

## 2026-06-11: Saved Research Plan LocalStorage Boundary

Saved research-plan localStorage is treated as untrusted input. Client hydration and persistence now normalize plan ids, cap plan counts, cap private note length, and retain only bounded boolean checklist keys before local drafts are merged with server-backed plan state or uploaded during migration.

## 2026-06-11: Account Tracking LocalStorage Boundary

Account dashboard tracking localStorage is treated as untrusted input. Hydration, legacy migration, reducer `HYDRATE`, and note mutation actions now normalize tracking ids, allow only known lab/fellowship stages, cap tracked item counts, and cap private note length before state can be rendered, persisted, exported, or used by dashboard flows.

## 2026-06-11: Admin Access Review Source Evidence URL Trust

Admin access-review evidence-completeness filters treat source URLs as usable evidence only after the same safe HTTP(S) URL normalization used by rendered source links. Unsafe, credentialed, non-HTTP(S), or malformed source URL strings no longer satisfy the `missing-evidence` filter, so operator queues cannot be hidden by unusable scraped URL values.

## 2026-06-11: Explicit API Body Parser Limits

Express API request parsing now declares a small shared body limit for JSON and URL-encoded requests, plus a URL-encoded parameter cap. The app no longer relies on framework defaults for request-size abuse resistance, and oversized API bodies fail before route/controller work.

## 2026-06-11: Seed Router Defense-in-Depth Runtime Gate

Seed routes remain local-development-only at the route aggregator, and the seed router now independently fails closed unless the runtime is true local development. A valid `SEED_TOKEN` is no longer sufficient if the router is accidentally mounted in a deployed runtime.

## 2026-06-11: Auth Flow No-Store Cache Control

CAS callback responses, auth-check payloads, and logout redirects are all private no-store responses. Authentication redirects and CAS-ticket/error flows should not be retained by browser history caches, shared intermediaries, or replayed from stale cached redirects.

## 2026-06-11: Operator Report Outputs Stay Under Artifact Roots

Repair and backfill scripts that accept `--output` must route JSON report paths through `resolveSafeJsonReportOutputPath`. Student-visibility backfills, listing-profile repairs, and official-profile publication-pointer repairs now follow the same `.json` under system temp or project `tmp/` boundary used by scraper report tooling, reducing accidental arbitrary-file overwrite risk while operator processes run with database credentials.

## 2026-06-11: Research Activity Title Decoding Avoids HTML Parsers

Client research-activity title normalization no longer uses `innerHTML` to decode scraped paper-title entities. The component uses a small explicit entity decoder and still strips embedded tags before rendering through React text nodes, keeping malformed scraped title strings from becoming parser input.

## 2026-06-11: Browser Hardening Includes Legacy Download and Cross-Domain Denials

The global security-header middleware now sends `X-Download-Options: noopen` and `X-Permitted-Cross-Domain-Policies: none` on every response. These headers reduce legacy browser file-opening risk and deny Flash/Acrobat-style cross-domain policy discovery without changing modern app behavior.

## 2026-06-11: Operator Board Artifact Reads Stay Under Artifact Roots

Admin operator-board gate artifact readers now resolve configured report paths through the shared safe JSON artifact guard before checking existence or reading file contents. Environment-configured scorecard paths outside system temp or project `tmp/` are reported as unreadable instead of being opened, preventing accidental arbitrary local file reads from operator-board configuration.

## 2026-06-11: Beta Launch Gate Artifacts Stay Under Safe JSON Roots

Beta readiness, beta repair queue, launch acquisition, and claim gate scripts now resolve report outputs through the shared safe JSON artifact guard before writing. Beta repair queue apply also resolves reviewed `--apply-from` artifacts through the same `.json` under system temp or project `tmp/` boundary before reading, preventing operator promotion tooling from opening or overwriting arbitrary local paths while connected with database credentials.

## 2026-06-11: Beta Seed and Launch Review Artifacts Stay Under Safe JSON Roots

Launch trust, launch review exceptions, beta seed environment, and beta data-quality scripts now resolve JSON report outputs through the shared safe artifact path guard. Beta seed artifact directories are validated by resolving derived JSON child artifacts under the same system temp or project `tmp/` boundary, and launch review accepted-decision reads are constrained before file access.

## 2026-06-11: Duplicate Review Decisions Stay Under Safe JSON Roots

Same-PI research-entity dedupe and duplicate-entity-name review scripts now resolve report outputs, reviewer decision templates, and accepted decision inputs through the shared safe JSON artifact guard. Decision-driven apply tooling must read and write `.json` artifacts only under the system temp directory or project `tmp/`, reducing arbitrary local file read/write risk while scripts run with database credentials.

## 2026-06-11: Identity Cleanup Reports Stay Under Safe JSON Roots

User identity dedupe, mismatched person-email repair, suspicious user-email hygiene, and beta student-analytics cleanup scripts now resolve report outputs through the shared safe JSON artifact guard. These reports can contain account identifiers or telemetry summaries, so operator tooling must write them only as `.json` artifacts under the system temp directory or project `tmp/`.

## 2026-06-11: Observation Conflict Decisions Stay Under Safe JSON Roots

Stale-observation and cross-source observation conflict review scripts now resolve report outputs, reviewer decision templates, and accepted decision inputs through the shared safe JSON artifact guard. Even missing-file validation probes must first resolve under the system temp directory or project `tmp/`, preventing arbitrary local file reads or writes from observation review tooling.

## 2026-06-11: Source Health Artifacts Stay Under Safe JSON Roots

Source health now resolves its report output path through the shared safe JSON artifact guard, and its saved report readers return unavailable for unsafe paths instead of opening them. This prevents source-health gate evaluation from reading or writing arbitrary local files when report paths come from operator artifacts or stored scraper metadata.

## 2026-06-11: Posted Opportunity Maintenance Artifacts Stay Under Safe JSON Roots

Posted-opportunity backfill, posted-opportunity status reaper, and application-route pathway backfill CLIs now resolve JSON report outputs through `resolveSafeJsonReportOutputPath` during flag parsing and immediately before writing. These database maintenance tools must write operator artifacts only as `.json` files under the system temp directory or project `tmp/`, reducing arbitrary local file overwrite risk while connected with database credentials.

## 2026-06-11: Program Maintenance Artifacts Stay Under Safe JSON Roots

Program research-relevance audits, program classification backfills, and program official-source backfills now route report outputs through `resolveSafeJsonReportOutputPath` during parsing and before writing. Program official-source backfill also constrains non-default review inputs to `.json` files under the system temp directory or project `tmp/`, while preserving the checked-in default change-set, preventing arbitrary local file reads or writes from program maintenance tooling.

## 2026-06-11: Meilisearch Rebuild Artifacts Stay Under Safe JSON Roots

Pathway and research-entity Meilisearch rebuild CLIs now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and immediately before writing. Rebuild tooling runs with database and search credentials, so operator artifacts must remain `.json` files under the system temp directory or project `tmp/` instead of arbitrary filesystem locations.

## 2026-06-11: Quality and Coverage Audit Artifacts Stay Under Safe JSON Roots

Professor bio coverage, research-entity coverage, profile-image quality, pathway quality, research-quality search review, and pathway relevance review scripts now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and again before writing. These read-only audit tools can summarize production-like records, so operator artifacts must remain `.json` files under the system temp directory or project `tmp/` instead of arbitrary filesystem locations.

## 2026-06-11: Publication and Scholarly Audit Artifacts Stay Under Safe JSON Roots

Scholarly-link provenance, scholarly-link suppression, paper-quality, and paper-authorship audit scripts now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and immediately before writing. These scripts inspect and sometimes repair publication attribution data, so their operator artifacts must remain `.json` files under the system temp directory or project `tmp/` instead of arbitrary filesystem locations.

## 2026-06-11: Migration and Cleanup Artifacts Stay Under Safe JSON Roots

Mongo naming migration, research-entity migration, dependent collection migration, and legacy Mongo cleanup scripts now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and immediately before writing. Migration tooling can run with high-impact database credentials, so review artifacts must remain `.json` files under the system temp directory or project `tmp/` instead of arbitrary filesystem locations.

## 2026-06-11: Research and Profile Backfill Artifacts Stay Under Safe JSON Roots

Research-home URL, research-description, profile-bio, center-director, faculty Ways In, and browse-rank backfill scripts now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and immediately before writing. These source-acquisition and materialization repair tools can run with scraper/database credentials, so operator artifacts must remain `.json` files under the system temp directory or project `tmp/` instead of arbitrary filesystem locations.

## 2026-06-11: Repair and Dedupe Artifacts Stay Under Safe JSON Roots

Archived-entity artifact repair, exploratory-contact pathway dedupe, duplicate access-signal repair, and profile-description conflict repair scripts now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and immediately before writing. These repair tools can run with database credentials and mutate launch-critical records, so their review artifacts must remain `.json` files under the system temp directory or project `tmp/` instead of arbitrary filesystem locations.

## 2026-06-11: Launch and Visibility Promotion Artifacts Stay Under Safe JSON Roots

Formalization review exception acceptance, accepted Beta copy promotion, student visibility gate, and student visibility repair-target scripts now resolve report outputs through `resolveSafeJsonReportOutputPath` during CLI parsing and immediately before writing. Launch and visibility promotion tooling can run with database credentials and produce release-critical artifacts, so report paths must remain `.json` files under the system temp directory or project `tmp/`.

## 2026-06-11: Audit Planning and Source Seed Artifacts Stay Under Safe JSON Roots

Research-entity rename audits, accepted-input JSON reports, department-lead repair plans, source registry seed reports, surname-lab disambiguation plans, profile data-quality audits, and member-reference audits now resolve report outputs through `resolveSafeJsonReportOutputPath` before artifact writes. Department-lead apply also resolves the reviewed `--expect-plan` JSON path through the same guard before reading. These tools can run with database credentials, so local report reads and writes must stay under system temp or project `tmp/`.

## 2026-06-11: Nested Operator Board Artifact Reads Stay Under Safe JSON Roots

Operator-board duplicate-name preflight summaries can point at a secondary accepted-decision validation artifact. That nested `outputPath` is now resolved through the same safe JSON artifact root guard before existence checks or reads, so saved operator artifacts cannot cause the board service to open arbitrary local files.

## 2026-06-11: Rendered Scraper Fetch Timeouts Are Bounded

The Scrapling rendered-fetch wrapper now clamps default and per-request child-process timeouts to a sane range before passing them to Python and `execFile`. Scraped or DB-derived fetch requests cannot extend renderer subprocess lifetimes beyond the local cap, while existing 10s and 30s scraper callers keep their intended behavior.

## 2026-06-11: Stored Account Object IDs Are Revalidated on Read

Account listing, program/fellowship, pathway, and saved-research-plan readers now revalidate and cap stored account ObjectId arrays before returning them or using them for listing, program, pathway, or funding-match fan-out. This keeps corrupted or legacy user documents from turning account reads into oversized service/database work.

## 2026-06-11: Shared URL Sanitizers Bound Inputs Before Parsing

Client and server shared URL helpers now reject oversized URL, email, and DOI-like values before browser/server URL parsing or outbound-link normalization. This limits parsing and rendering work from user-controlled profile, listing, source, contact, and scholarly-link fields while preserving existing scheme, credential, and direct-contact protections.

## 2026-06-11: Auth Redirect Targets Are Bounded Before Parsing

CAS and local-dev login redirect targets now reject oversized caller-supplied redirect values before URL parsing or same-origin comparison. Redirects still require relative same-origin paths or configured same-origin absolute URLs, and malformed, cross-origin, downgrade, backslash, control-character, or oversized values fall back to the safe auth response path.

## 2026-06-11: Unsafe Request Origin Headers Are Bounded Before Parsing

CSRF and logout origin checks now reject oversized `Origin` and `Referer` header values before URL parsing or allowlist comparison. Unsafe methods and deployed logout requests still require a configured trusted browser origin, and oversized or malformed header values fail closed.

## 2026-06-11: Client CAS Return URLs Are Bounded Before Parsing

The client sign-in button now rejects oversized saved/logout or router-provided return paths before browser URL parsing and CAS redirect-query construction. Return targets remain same-origin normalized, while oversized stored values are cleared without being forwarded to the server.

## 2026-06-11: CORS Origin Headers Are Bounded Before Allowlist Checks

The CORS origin handler now rejects oversized `Origin` header values before allowlist comparison. Missing origins keep their existing server-to-server/local behavior, while oversized supplied origins fail closed even when local CORS bypass mode would otherwise allow arbitrary browser origins.

## 2026-06-11: Client API Backend Origins Are Bounded Before Parsing

The client API base URL helper now rejects oversized configured backend origins before browser URL parsing. API, CAS, and logout URL construction still require credential-free HTTP(S) backend origins and fall back to the local default when configuration is malformed, unsafe, or oversized.

## 2026-06-11: Admin URL Reachability Helpers Are Self-Bounded

The admin URL reachability checker now rejects empty or oversized direct helper inputs before URL parsing, DNS lookup, or outbound `HEAD` work. The admin route already bounded submitted batches; the exported helper now carries the same guard if reused outside the route.

## 2026-06-11: Accepted-Input CSV and TXT Artifacts Stay Under Safe Roots

Accepted-input CLI root directories and command-specific CSV/TXT reads and writes now resolve under the system temp directory or project `tmp/` before filesystem access. Fellowship accepted-input program keys are segment-validated before constructing review or accepted CSV paths, preventing traversal through injected program keys.

## 2026-06-11: Auth Check Responses Use an Explicit Session DTO

The `/api/check` auth status route now returns an allowlisted session DTO instead of echoing `req.user` directly. Auth status responses remain private no-store and expose only `netId`, `userType`, `userConfirmed`, and `profileVerified`, preventing future middleware or session fields from leaking through the auth check payload.

## 2026-06-11: Mailto Links Bound Optional Query Text

Client `mailto:` link construction now bounds optional subject and body text before adding query parameters. The email address sanitizer remains strict, and oversized stored copy is dropped instead of becoming a very large browser navigation href.

## 2026-06-11: OAuth Callback Broadcasts Only Bounded Token Payloads

The Google OAuth popup callback now validates access-token and state shape before posting to the same-origin broadcast channel. The callback still strips the URL hash and closes, but malformed or oversized hash payloads are dropped locally instead of being broadcast into the app context.

## 2026-06-11: Logout Return Paths Are Bounded Before Local Persistence

Client logout buttons now bound the same-origin return path before writing `logoutReturnPath` to localStorage. The CAS sign-in button already bounds and normalizes the value before redirect construction; the write side now also avoids persisting oversized browser path values.

## 2026-06-11: Google Sheets Export Payloads Are Bounded

Client Google Sheets export now caps spreadsheet title length, column count, row count, and cell text length before constructing the API request body. Spreadsheet formula neutralization still applies after truncation, limiting browser memory and outbound request growth from oversized saved or fetched data.

## 2026-06-11: Visibility Repair Queue IDs Are Strictly Normalized

Visibility repair queue model work now accepts only primitive 24-hex strings or real Mongoose `ObjectId` instances before constructing Mongo ids for queue items, research entities, programs, reusable pathways, members, and evidence observations. Object-shaped values no longer reach repair queue ObjectId validation/construction or model lookups through arbitrary coercion.

## 2026-06-11: Student Visibility Gate IDs Are Strictly Normalized

Student visibility gate archived-queue resolution now routes record ids through a primitive/ObjectId-only normalizer before Mongo ObjectId construction. Object-shaped queue values are ignored instead of being coerced while resolving archived research queue items during launch and repair maintenance.

## 2026-06-11: Account Pathway Refresh Uses Shared Mutation ID Normalization

Account favorite-pathway and saved-plan refresh endpoints now rebuild persisted pathway id arrays through the shared account mutation ObjectId normalizer instead of constructing Mongoose ObjectIds directly from pathway search results. This keeps read-refresh cleanup on the same strict primitive/ObjectId-only boundary used by account add/remove mutations.

## 2026-06-11: Launch Acquisition Report Record IDs Are Strictly Normalized

Launch acquisition report entity, member, and access-record lookups now require primitive 24-hex research entity ids before model fan-out. Malformed queue record ids return empty report data instead of relying on Mongoose casting while generating promotion-adjacent repair guidance.

## 2026-06-11: Entity Materializer Object IDs Are Strictly Normalized

The entity materializer now routes scraper-derived user, research entity, listing, and scrape-run ids through a shared primitive/ObjectId-only normalizer before ObjectId construction or model lookups. Object-shaped values and legacy 12-byte strings no longer reach materialization joins through permissive Mongoose casting.

## 2026-06-11: Access Materializer Object IDs Are Strictly Normalized

The access materializer now validates research entity ids through a primitive/ObjectId-only 24-hex boundary before entity lookups, lead-member lookups, observation fan-out, or access artifact derivation. Malformed scraper-derived ids fail closed instead of being cast by Mongoose during access/pathway/contact materialization.

## 2026-06-11: LLM Source-Acquisition ID Filters Are Strictly Normalized

Lab microsite description, center director, and center affiliation LLM extractors now route operator `only` filters through strict primitive/ObjectId-only 24-hex normalizers before adding `_id` clauses. Slug filtering remains available, while object-shaped or legacy 12-byte values no longer reach credentialed source-acquisition Mongo queries through permissive Mongoose validation.

## 2026-06-11: Exploratory Pathway Dedupe Plan IDs Are Strictly Normalized

Exploratory-contact pathway dedupe apply mode now normalizes reviewed plan canonical and duplicate pathway ids through a primitive/ObjectId-only 24-hex boundary before relinking access signals, contact routes, or archiving duplicate pathways. Malformed artifact ids are skipped instead of being cast directly into Mongo ObjectIds.

## 2026-06-11: Profile Description Conflict Plan IDs Are Strictly Normalized

Profile-description conflict repair apply mode now normalizes reviewed keep/supersede observation ids through a primitive/ObjectId-only 24-hex boundary before superseding stale profile-description observations. Malformed artifact ids are skipped instead of being cast directly into Mongo ObjectIds.

## 2026-06-11: Archived Artifact Repair IDs Are Strictly Normalized

Archived-entity artifact repair now normalizes archived, canonical, duplicate, and child-reference ids through a primitive/ObjectId-only 24-hex boundary before relinking or archiving launch-critical artifacts. Malformed artifact ids are skipped instead of being cast through permissive Mongoose validation or direct ObjectId construction.

## 2026-06-11: Duplicate Access-Signal Repair IDs Are Strictly Normalized

Duplicate access-signal repair now normalizes duplicate signal and archive-pathway ids through a primitive/ObjectId-only 24-hex boundary before loading records or applying archive writes. Malformed integrity-review ids are skipped instead of reaching permissive Mongoose validation.

## 2026-06-11: Member Reference Repair IDs Are Strictly Normalized

Research entity member-reference repair now normalizes candidate user ids, canonical entity ids, and reviewed replacement ids through a primitive/ObjectId-only 24-hex boundary before existing-member matching or repair writes. Object-shaped and legacy 12-byte ids no longer reach member relink updates through permissive Mongoose validation.

## 2026-06-11: Public Research Detail Contact Routes Do Not Expose Direct Faculty Emails

Unauthenticated research detail payloads now omit direct faculty email fields from fallback member DTOs, project contact routes through an explicit public allowlist instead of object spread, and derive lead PI contact routes only when an official profile URL exists. This keeps scraped or directory-derived direct emails out of public entity detail responses unless a future authenticated contact-policy flow intentionally permits them.

## 2026-06-11: Public Research Detail Members Do Not Expose NetIDs

Unauthenticated research detail member DTOs no longer expose faculty NetIDs, and the public lab-detail UI no longer creates `/profile/:netid` links from public member cards or lead-professor fallbacks. Public navigation should prefer official profile URLs and source-backed routes; authenticated profile pages can continue to use NetIDs after login.

## 2026-06-11: Public Research Detail Group Payload Omits Direct Contact Fields

The public research detail group object now strips legacy direct contact fields such as `contactEmail`, `contactName`, `contactRole`, contact phone, generic email, and generic phone before serialization. Student-facing unauthenticated detail pages should rely on official URLs, source-backed contact routes, or future authenticated contact-policy flows rather than embedding direct scraped contact data in the base group payload.

## 2026-06-11: Public Research Entity DTO Omits Direct Contact Fields

The shared public `ResearchEntity` DTO no longer includes `contactEmail`, `contactName`, or `contactRole`. This applies the direct-contact privacy boundary to public search results, related-entity cards, and the `researchEntity` alias, not just the detail-page `group` payload.

## 2026-06-11: Research Entity Search Index Omits Direct Contact Fields

Research entity Meilisearch documents now delete direct contact fields before indexing, including contact email/name/role/phone and generic email/phone aliases. Live research-entity sync uses the same search-index document builder as full index rebuilds, preventing broad document sync from reintroducing direct contact fields into search infrastructure.

## 2026-06-11: Auth Principal NetIDs Are Normalized Before Lookup

CAS and session-derived authentication principals now pass through a bounded NetID normalizer before user lookup/create, external directory/Yalies calls, admin grant checks, or session hydration. Malformed session principals fail closed by clearing authentication rather than reaching downstream services.

## 2026-06-11: Public Faculty Profiles Omit Direct Contact and Office Location

Authenticated public faculty profile payloads no longer expose direct email, phone, physical location, building desk, or mailing address fields. Profile pages retain public research identity, departments, official websites/profile URLs, scholarly links, and research homes; direct contact should move through official source routes or explicit authenticated contact-policy flows.

## 2026-06-11: Public Profile Listings Redact Direct Contact Text

Faculty profile listing payloads now redact direct contact text from listing titles, descriptions, applicant descriptions, taxonomy arrays, and listing metadata before returning `/api/profiles/:netid/listings`. This keeps profile-adjacent listing cards useful while preventing embedded emails or phone numbers from becoming a broad authenticated-user disclosure surface.

## 2026-06-11: Student-Facing Program Payloads Omit Direct Contact Email and Phone

Non-admin program and fellowship payloads no longer include direct `contactName`, `contactEmail`, or `contactPhone` fields. Program descriptions, application information, contact office text, and links still pass through direct-contact redaction, while official application/source URLs remain available.

## 2026-06-11 - Enforce Visibility on Public Counter Mutations

Authenticated view/favorite mutations for listings and programs/fellowships must apply the same public visibility constraints as read/search routes before incrementing counters or returning the updated record. Listing mutations now require `archived=false` and `confirmed=true`; program/fellowship mutations require `archived=false` plus public student visibility tiers. Hidden, archived, suppressed, or operator-review records should behave like not-found for normal reader counter actions.

## 2026-06-11 - Enforce Visibility on Listing Detail Reads

The normal authenticated listing detail route must use a visibility-scoped reader, not the internal owner/admin reader. `GET /api/listings/:id` now requires `archived=false` and `confirmed=true` before returning the public listing DTO, while internal listing reads remain available for owner checks and admin/account workflows.

## 2026-06-11 - Scope Account Favorite Listing Hydration to Public Records

Account listing hydration distinguishes owned listings from favorite listings. Owned listings can use the internal reader so authors can manage drafts and archived records, but favorite listings now use a public-visible bulk reader requiring `archived=false` and `confirmed=true`. Legacy favorite ids for hidden records are pruned instead of returned to the account page.

## 2026-06-11 - Derive Account Favorite IDs from Visible Records

Account id-only endpoints must not return raw stored favorite/saved id arrays. Favorite listing, program/fellowship, saved program, favorite pathway, and saved research-plan id responses now hydrate through the same public-visible readers used by payload endpoints and return ids only for records that still pass those visibility filters.

## 2026-06-11 - Validate Favorite Saves Before Account Persistence

Favorite/save mutation services must filter requested listing, program/fellowship, and pathway ids through public-visible readers before merging them into account arrays. Counter updates for listings and programs/fellowships run only for ids that survived those visibility checks, preventing known hidden ids from being persisted first and pruned only later.

## 2026-06-11 - Scope Saved Pathway Plan Details to Visible Pathways

Saved research-plan detail reads and writes are private account operations, but their keys still refer to public pathway records. Detail reads now return only plan entries whose pathway ids still resolve through public pathway search, and detail writes reject hidden or missing pathway ids before storing notes or checklist state.

## 2026-06-11 - Require POST Opt-In for Private Note Export

Saved research-plan exports without private notes can remain a normal authenticated GET attachment. Exports that include private notes now require a POST body opt-in (`includePrivateNotes: true`) instead of a GET query flag, reducing accidental navigation/prefetch/query-string exposure for private account notes.

## 2026-06-11: Yalies NetID Lookups Fail Closed Before External Requests

Yalies lookup calls now normalize NetIDs through the same bounded alphanumeric shape used by auth before validating cached users or calling the external API. Malformed IDs return `null` without outbound requests, and lookup failures use sanitized logging instead of raw error messages.

## 2026-06-11: Public Config Omits Source Revision Fingerprints

The public `/api/config` payload now reports only the coarse deployment provider and no longer exposes git commit hashes or branch names. Client code did not consume source revision fields, and removing them reduces unauthenticated reconnaissance detail.

## 2026-06-11: Public Opportunity Detail Omits Internal Join IDs

Public opportunity detail payloads no longer expose internal `PostedOpportunity`, `EntryPathway`, `ResearchEntity`, `Listing`, or observation ObjectIds. Search cards still use posted-opportunity ids as route handles, but the detail response now relies on slugs, labels, source URLs, and redacted evidence instead of leaking join metadata.

## 2026-06-11: Served Google OAuth Callback Uses State-Bound Token Channel

The checked-in served `client/dist/oauth-callback.js` now matches the hardened public callback: access tokens and OAuth state are shape-validated, URL fragments are cleared, and tokens are posted only to the state-specific `google-oauth-token:<state>` BroadcastChannel. Static preflight now checks both source and served callback assets so stale builds cannot silently reintroduce the generic token channel.

## 2026-06-11: Search Query Analytics Uses Validated Date Ranges

The admin search-query analytics aggregation now builds its timestamp filter through the shared validated date-range helper instead of hand-assembling `$gte`/`$lte` bounds. This keeps invalid dates and reversed ranges rejected consistently across analytics quality, query, funnel, and action-needed reports before aggregation work reaches MongoDB.

## 2026-06-11: Analytics Listing Enrichment Uses Strict ObjectId Normalization

Admin analytics trending-listing enrichment now normalizes stored listing ids through a string-or-ObjectId-only boundary before listing lookup and comparison. Corrupted legacy analytics rows can no longer feed object-shaped ids into the enrichment query or invoke arbitrary `.toString()` coercion while matching listing metadata.

## 2026-06-11: Admin Grant NetIDs Normalize String Inputs Only

Admin grant lookup, grant, and revoke helpers now normalize NetIDs only from primitive strings instead of generic `String(...)` coercion. Object-shaped admin-grant request values fail closed before validation or persistence, while valid Yale-style string NetIDs keep the same active-grant authority behavior.

## 2026-06-11: Local Dev Login User-Type Inputs Avoid Generic Coercion

Local-only dev-login and auth-bypass user-type normalization now accepts primitive strings only before selecting admin/student behavior. Object-shaped query values fall back to student instead of passing through generic `String(...)` coercion, keeping local authentication helpers aligned with the production auth input boundary.

## 2026-06-11: Session Secret Validation Trims Before Length Checks

Server startup now trims `SESSION_SECRET` before enforcing the deployed-runtime minimum length and uses the trimmed value for cookie signing. Whitespace-only or whitespace-padded secrets no longer satisfy the production session-secret guard.

## 2026-06-11: Credentialed Backfill Logs Sanitize Caught Errors

Mongo-connected research-home URL backfill, research-description backfill, profile-bio backfill, and entity materialization now sanitize caught errors before logging. These paths may handle request configs, source URLs, OpenAI/Axios failures, or Yale identity context, so logs should preserve concise failure context without dumping raw exception messages or nested credential-bearing objects.

## 2026-06-11: Publication and Grant Scraper Fetch Logs Sanitize Errors

arXiv, Europe PMC/PubMed, Crossref, ORCID, OpenAlex, and NIH RePORTER scrapers now sanitize caught fetch/lookup errors before writing scraper logs. Operator logs retain source-level context while avoiding raw Axios/parser exceptions next to NetIDs, ORCIDs, DOI values, PI names, or source-query strings.

## 2026-06-11: Fellowship and Center Scraper Logs Sanitize Source Failures

Undergraduate fellowship-recipient and centers/institutes scrapers now sanitize manual-file, fetch, extractor, and user-lookup errors before logging. These logs no longer include raw filesystem paths, source URLs, recipient advisor names, or raw exception messages when source acquisition fails.

## 2026-06-11: Department Roster Scraper Logs Sanitize Fetch Failures

Department roster scraping now sanitizes official-profile, data-endpoint, rendered-page, page-fetch, and extractor errors before logging. Failure logs avoid raw profile/page URLs and raw exception messages while preserving department-level operator context.

## 2026-06-11: Center LLM Scraper Logs Sanitize Source Failures

Center director and center affiliation LLM extractors now sanitize caught fetch, leadership-page, LLM, and extraction errors before writing scraper logs. Failure logs avoid raw source URLs and exception messages, and director extraction success logs no longer echo extracted names or source URLs.

## 2026-06-11: LLM Parser and Call Failures Sanitize Error Detail

Student-decision and lab-microsite LLM extractors now sanitize JSON parser and LLM-call failures before rethrowing or logging. This keeps provider/parser exception detail bounded and redacted before upstream scraper logging can persist it.

## 2026-06-11: Publication Scraper Failure Logs Avoid Direct Identifiers

Europe PMC, Crossref, ORCID, and OpenAlex scraper failure logs no longer echo NetIDs, ORCID values, DOI strings, or Yale author identifiers next to sanitized errors. Logs retain coarse operator context while avoiding direct research/person/source identifiers in failure paths.

## 2026-06-11: Lab Microsite WorkPlanner Logs Avoid Name Fallbacks

Lab microsite description and undergrad-signal LLM scrapers no longer fall back to lab names in WorkPlanner skip logs when stable entity identifiers are missing. Missing-identifier cases now use generic candidate labels to avoid emitting faculty-name-derived lab labels into operator logs.

## 2026-06-11: Audit and Index ID Stringifiers Avoid Arbitrary Object Coercion

Visibility repair, pathway search indexing, stale-observation review, beta data quality, duplicate-name review, and accepted-input helpers now avoid generic object `.toString()` when deriving IDs. These paths accept primitive strings/numbers or ObjectId-like `toHexString()` values and otherwise fail closed.

## 2026-06-11: Saved Pathway Client Logs Avoid Raw Error Objects

Saved-pathway account flows now log fixed browser-console messages for localStorage hydration, plan loading, funding-match loading, save, remove, and export failures. This avoids exposing raw Axios/localStorage exception objects in client consoles while preserving user-facing fallback errors.

## 2026-06-11: Public Client Providers Avoid Raw Auth and Config Logs

The auth and config context providers now log fixed browser-console messages for auth-check and config-fetch failures instead of raw Axios errors. Incomplete-config warnings retain only coarse counts and no longer dump the raw config response.

## 2026-06-11: Public Favorite and Save Flows Avoid Raw Axios Console Logs

Public listing favorites, fellowship/program saves, shared favorite hooks, account saved-program management, direct-link fetches, and Google Sheets fallback export now use fixed browser-console messages on failure. This avoids exposing raw Axios request/response objects in client consoles while preserving optimistic rollback and user-facing warnings.

## 2026-06-11: Public Search Loaders Avoid Raw Axios Console Logs

Legacy listing search, fellowship filter/search loading, and shared search-core loaders now use fixed browser-console messages on request failures. Status-based user behavior is preserved where needed, but raw Axios request/response objects are no longer logged from common browse surfaces.

## 2026-06-11: Account and Profile Client Surfaces Avoid Raw Error Logs

Profile publications, profile-editor loading, unknown-user account completion, and self-service research-area creation now use fixed browser-console messages on failures. User alerts and fallback state transitions are preserved without exposing raw Axios or thrown error objects.

## 2026-06-11: Admin Client Surfaces Avoid Raw Error Logs

Admin analytics, operator board, access review, profile edit, research-area, listing, fellowship, faculty-profile, and department panels now use fixed browser-console messages for request failures. Analytics and operator-board error state also use fixed public copy instead of thrown error messages, reducing leakage of privileged request/response details in admin browsers.

## 2026-06-11: Analytics Error Responses Use Typed Request Errors

Analytics routes now classify client validation failures through a local `AnalyticsRequestError` instead of trusting arbitrary thrown message prefixes. Client responses still use fixed copy, and service/internal failures no longer influence status or response text through `Error.message`.

## 2026-06-11: Admin Grant Error Responses Use Typed Validation Errors

Admin grant service validation now throws `AdminGrantValidationError`, and the admin route uses that type to choose fixed 400 validation copy. The route no longer trusts arbitrary thrown message prefixes when deciding admin-grant response status.

## 2026-06-11: Access Review Search Errors Use Typed Request Errors

Admin access-review search validation now throws `AccessReviewRequestError`, and the admin route uses that type for the fixed search-length 400 response. The route no longer keys response status off a caught `Error.message` string.

## 2026-06-11: Admin List Search Errors Use Coded Validation Results

Admin listing, profile, and fellowship list search validation now returns compact error codes from the shared normalizer. Routes map those codes to fixed public response copy instead of copying a generic `error` string returned by the helper.

## 2026-06-11: Current-User Mutation Responses Omit Internal Join Fields

Current-user profile mutation responses continue to return account identity, public profile fields, and saved/favorite id arrays, but no longer include internal account join ids or account-maintenance timestamps such as `facultyMemberId`, `studentProfileId`, `createdAt`, or `updatedAt`.

## 2026-06-11: Profile Publication Text Is Redacted and Bounded

Authenticated profile publication responses now bound and direct-contact-redact publication `title`, `doi`, `venue`, and `source` fields before serialization. Publication URLs keep the existing public HTTP(S)-only handling, while source evidence ids, owner metadata, confidence, raw payloads, and unsafe URLs remain omitted.

## 2026-06-11: Admin Profile Publication Writes Are Bounded

Admin profile updates now normalize embedded `publications` before persistence. The write path keeps only the publication schema fields, caps row count and text size, redacts direct contact text, drops unsafe publication URLs, and skips rows without a usable title instead of storing arbitrary nested admin-browser payloads.

## 2026-06-11: Admin Listing Updates Use a Bounded Allowlist

Admin listing updates now pass through an admin-specific allowlist before `Listing.findByIdAndUpdate`. The normalizer bounds text, arrays, collaborator NetIDs, object ids, dates, counters, and public URLs, drops hidden embeddings and arbitrary nested keys, and prevents oversized collaborator arrays from driving user-linking fan-out.

## 2026-06-11: Admin Fellowship Updates Are Bounded Before Persistence

Admin fellowship/program updates now bound and shape the allowlisted payload before `Fellowship.findByIdAndUpdate`. The write path caps text, arrays, links, dates, numbers, visibility fields, and reviewer ids; validates program enum fields; redacts direct-contact text; drops unsafe URLs; and rejects arbitrary nested keys before persistence.

## 2026-06-11: Admin Profile Updates Are Bounded Before Persistence

Admin profile updates now normalize the full allowlisted payload before `User.findOneAndUpdate`. The write path rejects non-object payloads, caps self-editable text and array fields, redacts direct-contact text, validates public URLs, bounds admin scalar fields, restricts account-type values, and keeps publication normalization on the same bounded source object.

## 2026-06-11: Posted Opportunity URLs Are Bounded Before Persistence

Posted opportunity upserts now filter `applicationUrl` and `sourceUrls` through the shared public HTTP(S)-only URL guard before Mongo persistence. Source URL fan-out is capped at the service boundary, unsafe schemes and object-shaped values are dropped, and the stored record no longer relies only on downstream DTO cleanup for URL safety.

## 2026-06-11: Listing-Derived Research Entity URLs Are Bounded

Listing-to-research-entity profile sync now caps listing-derived public URLs before copying them into `ResearchEntity.sourceUrls` or `websiteUrl`. The helper continues to drop unsafe schemes and object-shaped values, and now also prevents oversized listing URL arrays from expanding into research-entity persistence patches.

## 2026-06-11: Beta Data Quality Live-Link Checks Are SSRF-Guarded

The Beta data-quality audit samples stored public URLs from MongoDB and optionally checks whether they resolve. Those stored URLs are untrusted input, so live-link checks now validate through the shared public HTTP(S) SSRF guard before requests, use SSRF-safe Axios agents across redirects, avoid downloading GET fallback bodies, and sanitize failure detail in the report.

## 2026-06-11: Research Detail Professor Audit Env Inputs Are Constrained

The Playwright research-detail professor audit now treats `CLIENT_BASE`, `SERVER_BASE`, `OUT_DIR`, and numeric limits as operator-controlled inputs that still need bounds. URL bases must be localhost or known Yale Research deployment origins, deployed origins require HTTPS, credentialed/query/fragment URLs are rejected, output stays under `tmp/` or `/tmp`, and numeric limits use safe positive-integer parsing.

## 2026-06-11: Unified Research Search Audit Env Inputs Are Constrained

The Playwright unified-search audit now applies the same operator-input boundary as the professor-detail audit. `CLIENT_BASE` and `SERVER_BASE` are restricted to localhost or known Yale Research deployments with HTTPS required remotely, and `OUT_DIR` is constrained to safe temporary roots before screenshots or JSON artifacts are written.

## 2026-06-11: Analytics Query Controls Are Route-Validated

Admin analytics endpoints now reject malformed query controls before they reach Mongo aggregation services. User analytics sort and direction values are allowlisted, limit values must be finite positive integers within endpoint-specific caps, user-type filters are bounded identifiers, and active-since filters must be parseable bounded dates.

## 2026-06-11: Research Description LLM Backfills Redact Prompt Contact Data

The research-description backfill script now redacts direct-contact strings from the research-home name and source text before sending prompts to the external LLM provider. Prompt fields are also explicitly bounded, preserving grounded rewrite behavior while reducing third-party exposure of scraped or stored contact data.

## 2026-06-11: Rendered Fetch Process Inputs Are Constrained

The optional Scrapling rendered-fetch bridge now constrains process-boundary inputs before invoking `execFile`. Python commands must be bare Python executable names, not filesystem paths, bridge paths must resolve to the scraper bridge script under the scraper directory, fetch mode is allowlisted, and wait selectors are length-bounded.

## 2026-06-11: API Responses Default to Private No-Store Caching

Express now applies private no-store cache headers to all `/api` responses before routing. Sensitive account, profile, analytics, admin, and discovery JSON cannot be retained by browser or intermediary caches by default; static client assets remain unaffected.

## 2026-06-11: Listing Mutation Responses Use Public DTOs

Current-user listing create, update, archive, unarchive, and delete responses now pass saved listing documents through the authenticated-reader listing DTO before returning JSON. This preserves normal listing display fields while omitting raw owner email, collaborator identifiers, audit flags, confirmation state, and other internal persistence fields from mutation responses.

## 2026-06-11: Saved Pathway Plan Reads Are Sanitized

Private saved-pathway-plan read, update, and delete responses now sanitize stored plan maps before returning them. Legacy or manually edited rows must use valid pathway ObjectId keys, response maps are capped, checklist keys are re-normalized, and notes/stage/intent fields are bounded through the same sanitizer used for writes.

## 2026-06-11: Account Listing Payloads Redact Direct Contact Text

Owned and favorited listing payloads returned from account endpoints now direct-contact-redact listing title, description, applicant text, taxonomy arrays, and display fields before serialization. This aligns account listing responses with public listing/profile DTO behavior and prevents saved/favorite account views from bypassing contact redaction.

## 2026-06-11: Listing DTO URL Arrays Are Capped

Public listing and account-listing DTOs now cap stored website arrays before URL normalization and serialization. This prevents oversized stored listing URL arrays from amplifying response size or parser work while preserving normal display links.

## 2026-06-11: Google OAuth Popups Use State-Scoped Names

Google Sheets export OAuth now opens a state-scoped popup target instead of a reusable fixed `google-auth` window name. The client centralizes popup creation, keeps a bounded feature string, and clears `window.opener` before navigating the popup to Google's OAuth provider while continuing to use the state-scoped BroadcastChannel for token delivery.

## 2026-06-11: Scraper Materializer Exception Logs Are Sanitized

The scraper entity materializer now passes browse-rank recomputation and paper materialization exceptions through the shared log sanitizer before console output. This keeps untrusted source/provider/network error content and materialization identifiers out of raw logs while preserving enough context for operator debugging.

## 2026-06-11: Scraper Entrypoint Fatal Logs Are Sanitized

The scraper CLI and source-registry seed entrypoint now sanitize fatal caught exceptions before console output. Operator commands can still fail visibly, but raw exception objects from external fetches, database drivers, or source payload handling no longer bypass the shared log-redaction boundary.

## 2026-06-11: Self-Profile Update Payloads and URL Keys Are Validated

Self-service profile updates now reject non-object payloads before field selection and require profile URL map keys to use a small display-key character set. This keeps malformed JSON from turning into server errors and prevents unsafe nested object keys from reaching the persisted `profileUrls` mixed field even when callers bypass Express-level Mongo key scrubbing.

## 2026-06-11: Seed User Mutations Use an Allowlisted Payload

Development seed user routes remain local-runtime and token-gated, but they now shape request bodies through a seed-specific user-field allowlist before calling user write services. POST creation validates a bounded NetID, PUT updates cannot mutate `netid`, non-object bodies are rejected, and raw request bodies no longer flow into `createUser` or `updateUser`.

## 2026-06-11: Listing Create Entity Attachments Return Normalized IDs

Self-service listing creation can attach to a supplied research entity only after the owner has an authoritative role on that entity. The supplied `researchEntityId` or `researchGroupId` is now normalized before the authority check and only the normalized ObjectId string can flow into listing persistence.

## 2026-06-11: Account Mutation ID Arrays Are Deduplicated

Account favorite, save, and owned-listing mutations already cap and normalize ObjectId arrays before model work. The shared normalizer now also deduplicates request ids before side-effect loops run, preventing a single authenticated request with repeated ids from incrementing or decrementing listing/fellowship favorite counters multiple times.

## 2026-06-11: Current-User Profile URL Keys Are Allowlisted

Current-user account profile updates now reject unsafe `profileUrls` map keys instead of rewriting `$` and `.` characters. Persisted profile URL labels must use a bounded display-key character set, matching the stricter self-profile service policy and avoiding ambiguous nested-key transformations in the flexible user profile URL field.

## 2026-06-11: Account Mutation Analytics Inputs Are Bounded

Account favorite/save analytics now logs only bounded, deduplicated ObjectId strings from successful request payloads, matching the mutation-side ID policy and preventing duplicate request IDs from amplifying analytics writes. Profile-update analytics metadata now records only bounded safe field names instead of raw request-body keys.

## 2026-06-11: Stored Profile Images Do Not Send Page Referrers

Client renderers for stored profile/developer images now use a shared `no-referrer` image policy in addition to existing URL scheme normalization. This prevents external image hosts from receiving Yale Research page URLs when public faculty cards, account profile previews, or developer cards load remote image assets.

## 2026-06-11: Browser Responses Use No-Referrer Policy

The global security-header middleware now sends `Referrer-Policy: no-referrer` instead of a cross-origin origin-sharing policy. This prevents external links, redirects, image loads, and third-party requests from receiving Yale Research page URLs or origins by default.

## 2026-06-11: Account Tracking Notes Redact Direct Contact Details Locally

Client account tracking notes now redact email addresses and phone-like strings before reducer storage, hydration, or localStorage persistence. This preserves lightweight stage/note tracking while reducing sensitive contact residue on shared browsers or compromised client storage.

## 2026-06-11: Browser Static Serving Blocks Source Maps

Express now rejects `.map` asset requests before serving the SPA and uses explicit static-file options that ignore dotfiles and directory indexes. The server bundle also disables source-map generation in `tsup`, reducing source disclosure if build artifacts are accidentally published during beta deploys.

## 2026-06-11: Public URLs Reject Local-Network Browser Targets

Shared client and server public-URL normalization now rejects localhost, single-label intranet hosts, private/reserved IPv4 literals, and IPv6 literals before rendering or persisting public links and profile images. This reduces stored browser-side SSRF/CSRF risk where a malicious public URL could make visitors request local services or private-network addresses.

## 2026-06-11: Public Opportunity Details Omit Persistence Timestamps

Public posted-opportunity detail responses now omit `createdAt` and `updatedAt` persistence timestamps. Opportunity pages still expose student-facing status, deadline, provenance label, source links, and evidence snippets, but internal record timing stays out of the unauthenticated API contract.

## 2026-06-11: Public Research Detail Subdocuments Omit Persistence Metadata

Public research detail responses now omit `createdAt`, `updatedAt`, and internal relationship ids such as `researchEntityId`, `researchGroupId`, `entryPathwayId`, and `listingId` from embedded listings, entry pathways, access signals, and posted opportunities. The public research page still exposes primary ids needed for stable client rendering or posted-opportunity links, plus student-facing deadlines, observed evidence dates, source links, and pathway status.

## 2026-06-11: Client Internal Route Segments Are Encoded

Client links that interpolate server-provided slugs, NetIDs, object ids, or program ids into internal route paths now pass those values through `safeRouteSegment`. This rejects raw and percent-encoded dot segments, encodes other accepted values, and prevents malformed stored values from changing route structure through slash, dot-segment, control-character, query, or fragment injection while preserving normal encoded profile, research, opportunity, and program navigation.

Programmatic card-click navigation uses the same route-segment encoding as rendered `<Link>` targets, so a malformed research slug cannot change route structure through the clickable card path.

## 2026-06-11: Analytics Metadata Keys Are Strictly Allowlisted

Analytics event persistence now drops unsafe metadata keys instead of rewriting `$` prefixes or dotted paths into alternate field names. Stored analytics metadata accepts only compact alphanumeric, underscore, and hyphen keys, while values remain bounded and direct-contact-redacted before persistence.

## 2026-06-11: Public URLs Reject Private-Name Host Suffixes

Public URL normalization now rejects private-use hostname suffixes such as `.local`, `.internal`, `.lan`, `.home.arpa`, and `.localdomain` in both client rendering and server persistence. This extends the browser-side local-network request guard beyond IP literals and localhost to common mDNS, router, and intranet name patterns.

## 2026-06-11: CSP Blocks Inline Script Attributes and External Frames

The global Content Security Policy now includes `script-src-attr 'none'` and `frame-src 'none'` in addition to the existing `script-src`, `object-src`, `frame-ancestors`, `base-uri`, and `form-action` controls. This prevents injected inline event handlers from executing even if an HTML injection bug reaches rendered markup, and prevents the app from embedding external auth/payment/content frames when the intended Google OAuth flow uses a popup plus static callback instead of an iframe.

## 2026-06-11: Google Sheets OAuth Tokens Are Single-Use In Memory

Google Sheets export still receives OAuth access tokens through a state-scoped popup BroadcastChannel, but the client now clears the cached access token immediately after the Sheets API request finishes. Tokens are not written to browser storage and no longer remain reusable in module memory after export success or failure.

## 2026-06-11: Public URLs Use Default HTTP(S) Ports Only

Shared public URL normalization now rejects explicit non-default ports. Public links, profile images, application URLs, and source URLs can use normal HTTP/HTTPS defaults, including explicit `:80` for HTTP and `:443` for HTTPS, but cannot steer browsers toward arbitrary service ports on otherwise public-looking hosts.

## 2026-06-11 - Redact direct contact data before profile-bio LLM backfill prompts

The profile-bio backfill now applies `redactDirectContactInfo` to faculty name, title, source URL, and page text before constructing OpenAI prompts. This aligns profile-bio extraction with the research-description backfill privacy boundary: fetched profile pages may still ground local acceptance checks, but direct emails/phones are removed before provider calls.

## 2026-06-11 - Redact raw scraper page text before LLM extractor calls

Raw fetched page text passed to scraper LLM extractors is now redacted with `redactDirectContactInfo` before OpenAI calls. The local scraper pipeline can still use the original source text for grounding and quote/source-url validation, but provider-bound prompts no longer include direct emails or phone numbers from Yale pages.

## 2026-06-11 - Redact student-decision LLM evidence prompts

Student-decision LLM prompt construction now redacts direct contact information and bounds every dynamic field before provider calls. Even though the prompt is assembled from materialized public evidence, the provider egress boundary now enforces the same direct-contact privacy invariant used by raw page-text LLM extractors.

## 2026-06-11 - Keep scraper bio tests synthetic

Scraper bio fixtures must use synthetic people, locations, institutions, and lab names. Real Yale profile names or copied biography details are not acceptable test data, even when the source is public. The security preflight denylist now includes the sanitized identifiers from this cleanup to prevent reintroduction.

## 2026-06-11 - Serve OAuth callback assets with no-store headers

The Google OAuth callback HTML and JS are now explicitly served with `Cache-Control: no-store`, `Pragma: no-cache`, and `Surrogate-Control: no-store` before static asset handling. The callback uses URL fragments and clears history, but the token-handling surface should still avoid browser or proxy caching as a deployment invariant.

## 2026-06-11 - Narrow Yarn git dependency and package freshness gates

Yarn supply-chain settings now approve only the repository-backed dependency the app actually uses (`https://github.com/coursetable/passport-cas`) instead of wildcarding all git repositories. `npmMinimalAgeGate` is also set to `1d` so brand-new npm publishes are not immediately eligible for installation. This preserves current dependency intent while reducing exposure to malicious git dependency swaps and freshly published compromised packages.

## 2026-06-11 - Disable persisted GitHub checkout credentials in CI

GitHub workflow checkout steps now set `persist-credentials: false`. Workflows already use read-only `contents: read` permissions, but disabling checkout credential persistence prevents the `GITHUB_TOKEN` from remaining in local git config for later dependency install, test, audit, or build commands.

## 2026-06-11 - Suppress stack trace logging in deployed runtimes

The global Express error handler now logs sanitized error messages in all runtimes but only logs sanitized stack traces outside deployed-runtime security mode. Public error responses were already fixed-copy; this change reduces production log exposure of internal file paths and call chains while keeping local debugging intact.

## 2026-06-11 - Reject Mongo Operator-Shaped API Requests

The global API Mongo sanitizer now rejects request bodies or query strings containing `$` operator keys, dotted keys, prototype-pollution keys, excessive nesting, or oversized nested containers instead of silently stripping them. This keeps hostile NoSQL/request-shaping payloads from being transformed into ambiguous downstream query or update objects.

The same API shape boundary also rejects square-bracket key syntax. This prevents parser-dependent forms such as `field[$ne]` or `profileUrls[__proto__]` from surviving as literal keys in URL-encoded bodies or query strings if a parser does not materialize them into nested objects before sanitization.

## 2026-06-11 - Validate User Service Mongo Update Documents

The shared `updateUser` service now validates update documents before calling Mongoose. Plain replacement-style updates may only use safe top-level fields, while operator-style updates are limited to `$set`, `$unset`, and `$addToSet` with safe dotted paths and nested values that do not contain Mongo operator, dotted, prototype-pollution, or oversized shapes. This preserves legitimate operator-script updates while preventing internal callers from bypassing the API sanitizer with unsafe Mongo update documents.

## 2026-06-11 - Bound Accepted-Input Source Fetch and PDF Work

Accepted fellowship source acquisition already validates URLs through the shared SSRF guard and uses connect-time DNS-blocking agents. The default accepted-input fetcher now also caps downloaded response and body size at 20 MB before buffering page/PDF content, reducing memory pressure from hostile or misconfigured public source URLs during credentialed operator runs.

Accepted-input PDF text extraction also fails closed above 200 pages or 1 MB of extracted text. This prevents small-but-pathological PDFs from amplifying parser work or generating oversized review text while avoiding silent truncation of operator review artifacts.

## 2026-06-11 - Bound Saved Research-Plan LocalStorage Writes

Saved research-plan browser storage now applies the same 100 KB payload cap on writes that hydration already enforced on reads. The client normalizes and serializes saved pathway plans through a shared write helper, removes the local key when the serialized payload is oversized, and avoids persisting private-note state that the next load would reject.

## 2026-06-11 - Scope Account Tracking LocalStorage by User

Saved-program tracking stages and notes now use NetID-scoped localStorage keys instead of global browser-profile keys. Legacy unscoped tracking keys are removed during hydration rather than migrated, because private planning notes must not transfer to whichever Yale user next opens the dashboard on a shared browser.

The dashboard only writes account-tracking storage after state has been hydrated for the same NetID. This prevents a user-switch race where the previous user's in-memory notes could be written into the next user's scoped key before localStorage hydration completes.

## 2026-06-11 - Sanitize Client-Displayed API Error Text

Client UI code should not display raw Axios `response.data.error`, `response.data.message`, or network `message` text directly. A shared `clientErrorMessage` helper now allows only short printable server messages that do not look like URLs, emails, tokens, cookies, connection strings, stack traces, or Mongo ids; otherwise it falls back to fixed UI copy.

## 2026-06-11 - Restrict SSRF-Guarded Fetch URL Shape

The shared server-side SSRF guard now applies the same 2 KB URL length cap and default HTTP(S) port policy used by public URL normalization before resolving or fetching outbound URLs. Scraper/operator fetches may still use normal HTTP/HTTPS default ports, but source-discovered or stored URLs with arbitrary explicit ports fail closed before DNS lookup and connect-time SSRF-safe agents run.

## 2026-06-11 - Bound Gate Refresh Scheduler Cadence

The in-process gate refresh scheduler now clamps `GATE_REFRESH_INTERVAL_MINUTES` to a 5-minute minimum and a 24-hour maximum. Invalid or non-positive values still disable the scheduler. This prevents deployment misconfiguration from creating a rapid `yarn gates:refresh` spawn loop inside the API process while preserving normal beta/staging refresh behavior.

## 2026-06-11 - Keep Listing Permission Failures Identifier-Free

Listing update and delete authorization failures now use fixed public/server error copy instead of interpolating the acting NetID or listing id into thrown errors. Controllers and services should not rely on log sanitization to remove Yale NetIDs or Mongo ids from permission-denied diagnostics.

## 2026-06-11 - Keep User Lookup Misses Identifier-Free

User-service not-found errors now use fixed `User not found` copy for both ObjectId and NetID lookups. Lookup misses should not echo queried NetIDs or database ids into thrown errors because those exceptions are commonly logged by authenticated account/profile flows.

## 2026-06-11 - Keep Scraper Tests Synthetic

Scraper tests must use synthetic people, names, emails, and profile slugs even when exercising Yale URL shapes. Real profile identifiers in fixtures create avoidable privacy leakage through repository history, CI logs, generated reports, and model context.

## 2026-06-11 - Sanitize Source-Acquisition Report Errors

Scraper and operator reports should not persist raw caught exception messages from credentialed or source-acquisition fetches. Official profile backfills, publication-pointer repair, Yalies directory pagination, NSF award pagination, and rendered fetch blocked reasons now pass exception text through `sanitizeLogValue` before logging or report serialization.

The same boundary applies to LLM/source-review helpers that write structured report errors. Lab-microsite description failures should use stable candidate labels and sanitized exception text rather than logging raw lab names or source URLs beside failure details.

## 2026-06-11 - Bound and Redact Public Config Taxonomy

The public `/api/config` serializer now treats stored department and research-area taxonomy as untrusted output. Research area labels, department names, display names, abbreviations, aliases, categories, and color keys are bounded and contact-redacted before returning to clients, so legacy seed/import rows cannot leak direct contact text or inflate the public config payload.

## 2026-06-11 - Restrict SPA HTML Fallback to App Routes

The server-side SPA fallback now serves `index.html` only for extensionless app routes. Missing source maps, hidden-looking paths, and asset-like paths with file extensions return a plain no-store 404 instead of the app shell, avoiding MIME-confusion, cache pollution, and misleading 200 responses for nonexistent static files.

## 2026-06-11 - Reject Non-Primitive Pagination Query Controls

The shared `validatePagination` middleware now accepts only compact positive-integer strings before route handlers run. Object-shaped, array-shaped, blank, zero, negative, decimal, or oversized numeric query values fail closed instead of being passed through JavaScript numeric coercion. The existing page-size cap remains 500.

Admin release-queue and access-review routes now pass raw pagination query values to their existing service normalizers instead of calling `Number(req.query...)` in the route. This keeps object/array rejection and defaulting in one bounded service path.

## 2026-06-11 - Omit Contact-Route IDs from Public Research Detail

Public research-detail contact routes now omit persistent Mongo `_id` values. The payload keeps student-facing route type, label, policy, rationale, and public/source URLs, but internal contact-route record identifiers stay on admin-only review surfaces.

## 2026-06-11 - Scope Saved Research-Plan LocalStorage by User

Saved research-plan browser drafts now use NetID-scoped localStorage keys and remove the legacy unscoped key instead of migrating it. This prevents private notes/checklists from bleeding between Yale accounts that share a browser profile, including the case where two users saved the same pathway id.

Saved research-plan writes are also gated until state has been hydrated for the same NetID. Older async loads from a previous account switch are ignored before they can populate the current render path or persist under the wrong scoped key.

## 2026-06-11 - Strengthen Private Account Response Headers

Authenticated `/api/users` account routes now set full private no-store headers, including `Surrogate-Control: no-store`, `Expires: 0`, and `X-Content-Type-Options: nosniff`, in addition to `Cache-Control` and `Pragma`. Controller-level private account helpers use the same header set for saved-plan JSON and attachment responses.

## 2026-06-11 - Harden Deployed Auth Base URL Configuration

Deployed CAS auth configuration now rejects `SSOBASEURL` and `SERVER_BASE_URL` values that use private/local hostnames, embedded credentials, query strings, or fragments. HTTPS remains required. This prevents compromised or mistaken deploy configuration from steering CAS login/logout flows toward localhost, internal networks, credential-bearing URLs, or URL-smuggling forms.

Auth callback, `/api/check`, logout, and dev-login private response helpers now also send `Expires: 0` and `X-Content-Type-Options: nosniff` alongside existing no-store headers.

## 2026-06-11 - Keep Listing and Fellowship Lookup Misses Identifier-Free

Listing, fellowship, and shared item view/favorite service not-found errors now use fixed messages instead of interpolating normalized Mongo ObjectIds. Controllers often map these to fixed public copy, but service exceptions are also logged or reused by authenticated account/admin flows, so thrown error text should not carry queried ids.

## 2026-06-11 - Align Private Operator and API Response Headers

Private API defaults, admin routes, local seed routes, OAuth callback assets, source-map 404s, and static asset-like 404s now include full no-store headers plus `Expires: 0` and `X-Content-Type-Options: nosniff`. This aligns operator/admin surfaces with account/auth response hardening and reduces browser/proxy retention and MIME-sniffing risk for sensitive or misleading responses.

## 2026-06-11 - Sanitize Analytics Drilldown Responses

Admin analytics drilldown responses now re-sanitize stored event fields before returning them to the browser. Legacy analytics rows may predate current write-side sanitizers, so event type, user type, listing/fellowship ids, search query, search departments, and metadata pass through the same bounded contact-redacting serializers used during event creation.

## 2026-06-11 - Minimize Public Research Detail Identifiers

Unauthenticated research search/detail payloads should not expose Mongo ObjectIds or Yale user identifiers as client join keys. Public ResearchEntity DTO ids now use slug/name-derived public keys, research relationship payloads expose related public slugs instead of relationship/source/target ids, and member research-activity joins use visible-name public member keys instead of internal user ids.

## 2026-06-11 - Keep Research Workflow Metadata Admin-Only

Anonymous research search/detail DTOs now omit persistence timestamps and operator workflow fields such as quality summaries and student-visibility tiers. Active admins can still receive quality/trust metadata through the existing authorized search path, but public callers cannot sort by `createdAt` or `updatedAt` or infer operator review state from public payloads.

## 2026-06-11 - Minimize Public Faculty Profile Identifiers

Authenticated public faculty profile payloads should not expose internal user/profile ids, persistence timestamps, or scholarly-link relationship ids. Public profile base fields now omit `_id`, `id`, `userConfirmed`, `createdAt`, and `updatedAt`; profile research-home cards use slug/name-derived public keys; and scholarly-link DTOs expose only public link keys plus allowlisted external identifiers.

## 2026-06-11 - Align Authenticated Browse Route Cache Headers

Authenticated profile and research-area routes now set the same full private response header set as account, admin, seed, and global API surfaces: private no-store cache control, `Pragma: no-cache`, `Surrogate-Control: no-store`, `Expires: 0`, and `X-Content-Type-Options: nosniff`. Authenticated browse payloads can include profile details, publications, course proxies, and user-created taxonomy labels, so route-level helpers should not rely only on the global API middleware for cache/privacy semantics.

## 2026-06-11 - Keep Public Program Sorting Student-Facing

Public program and fellowship search routes no longer accept `createdAt` or `updatedAt` as anonymous sort fields, and their fallback sort is now the student-facing `deadline` field. Admin/operator paths can still request persistence timestamp sorting through explicit operator allowlists, but public response order must not reveal hidden workflow timestamps that are omitted from the payload.

Public program payloads also omit `studentVisibilityTier`. The tier remains available to filtering/admin logic, but unauthenticated program search/detail responses should not expose operator review workflow state.

## 2026-06-11 - Keep Public Pathway Search Free of Persistence Timestamps

Public pathway search hits no longer return `createdAt` and no longer accept or internally tie-break public ordering by `createdAt`. Relevance, evidence freshness, deadlines, confidence, and labels remain student-facing ordering inputs; persistence timestamps stay out of both Mongo fallback results and Meilisearch-backed public pathway search.

## 2026-06-11 - Keep Public Listing Search Free of Persistence Timestamps

Public listing browse/search responses no longer return `createdAt` or `updatedAt`, and public listing search no longer accepts or defaults to persistence timestamp ordering. Public browse ordering should use student-facing fields such as `expiresAt` and `title`; public listing navigation controls should not expose recent/date-added filters. Operator/admin listing tables may continue to use creation timestamps on private review surfaces.

Listing browse/detail responses also omit internal `researchEntityId` and `researchGroupId` join keys. Public clients should route through visible listing ids, research slugs, and source URLs rather than persistent Mongo relationship ids.

## 2026-06-11 - Use Public Entity Keys in Pathway Search Hits

Public pathway search hits no longer expose the nested research entity's Mongo ObjectId as `researchEntity._id`. The response keeps the field for client grouping compatibility, but it now contains a slug/name-derived public key from Mongo fallback and Meilisearch-backed searches. Internal `entityId` values remain available only inside server filtering/indexing paths.

The public pathway response boundary also strips nested research-entity workflow metadata such as `studentVisibilityTier`. Visibility tiers may remain in server/index filtering paths to suppress non-public entities, but anonymous clients should not receive operator review state.

## 2026-06-11 - Scope Funding Matches to Visible Saved Pathways

Saved pathway funding-match responses now hydrate favorite pathway ids through the same visible pathway reader used by saved-plan account surfaces before matching fellowships. Stale or hidden favorite pathway ids and their saved-plan notes are pruned from account state first, so funding-match output is derived only from currently visible saved pathways.

## 2026-06-11 - Keep Favorite Analytics from Persisting Hidden IDs

Favorite/save analytics now treat request object ids as untrusted after account mutation services apply visibility filtering. Add/save events persist item ids only when those ids are present in the returned public account favorite arrays, and remove/unfavorite events redact item ids because the response no longer proves the removed id is currently visible.

## 2026-06-11 - Minimize Account Listing Payload Metadata

Authenticated account listing cards now follow the same minimization boundary as public listing browse/detail responses. Favorite and owned listing account payloads omit internal `researchEntityId`/`researchGroupId` join keys and `createdAt`/`updatedAt` persistence timestamps while retaining student-facing listing content, safe URLs, and expiration status.

## 2026-06-11 - Scope Favorite Removal Counters to Visible Records

Favorite removal services still remove requested ids from a user's account arrays so stale entries can be cleaned up, but listing and program/fellowship counter decrements now run only for ids rehydrated through public-visible readers. Hidden or stale requested ids can no longer throw from the counter path after account state has already been updated.

## 2026-06-11 - Make Favorite Counter Adds Idempotent

Favorite/save add services now increment public favorite counters only for visible ids that were not already present in the user's stored favorites. Account favorite arrays remain idempotent through the existing merge path, and repeated add/save requests for the same listing or program/fellowship can no longer inflate public popularity counters.

## 2026-06-11 - Require Prior Favorite Ownership for Counter Removals

Favorite/remove services now decrement public listing and program/fellowship counters only when a requested id is both currently public-visible and already present in that user's stored favorite array. Requests for visible ids the user never favorited still clean stale account state if needed, but they can no longer deflate public popularity counters.

## 2026-06-11 - Keep Favorite Counter Side Effects After Account Persistence

Favorite/save and remove/unfavorite services now persist account favorite arrays before updating derived public favorite counters. Counter updates are best-effort side effects with fixed-label sanitized logging, so an account update failure cannot leave public counters incremented without a stored favorite and a counter race cannot turn a completed account mutation into a partial API failure.

## 2026-06-11 - Make Favorite Adds Atomic Under Concurrency

Listing and program/fellowship add/save services now use an atomic user-level `$addToSet` guarded by a missing-id filter before incrementing public favorite counters. Concurrent duplicate add/save requests for the same visible id can no longer race through a stale pre-read and inflate public counters more than once for a single account favorite.

## 2026-06-11 - Make Favorite Removals Atomic Under Concurrency

Listing and program/fellowship remove/unfavorite services now use an atomic user-level `$pull` guarded by prior id membership before decrementing public favorite counters. Concurrent duplicate remove/unfavorite requests for the same visible id can no longer race through a stale pre-read and deflate public counters more than once for a single stored favorite; a separate no-counter cleanup still removes hidden or stale requested ids from account arrays.

## 2026-06-11 - Make Saved Pathway Mutations Atomic

Saved research-plan pathway add/remove mutations now use atomic user-level updates instead of read-modify-write array replacement. Adds use the same `$addToSet` helper as listing/program saves, while removals use `$pull` plus saved-plan-detail `$unset` in one account update so concurrent saves/removes cannot drop unrelated pathway ids or leave private plan details attached to removed pathways.

## 2026-06-11 - Fully Sanitize Self-Service Listing Scalars

Self-service listing create/update payloads now normalize all allowlisted scalar and date fields before persistence. `hiringStatus` is bounded as text, `established` is bounded as a number, and `expiresAt` must parse to a valid date or it is dropped, matching the existing URL, description, and array bounds on authenticated listing writes.

## 2026-06-11 - Remove Account Linkage Arrays from Public Profiles

Public faculty profile DTOs no longer include raw account relationship arrays such as `ownListings`. Listing cards for a profile should be loaded through the dedicated sanitized listings endpoint, not by exposing internal account-owned listing ObjectIds in the profile base payload.

## 2026-06-11 - Sanitize Public Profile Base Fields

Public faculty profile base fields now pass through contact redaction and size bounds before response serialization. Compatibility camel-case fields such as `title`, `departments`, `primaryDepartment`, `secondaryDepartments`, and `researchInterests` are no longer copied raw from stored user records; booleans, numeric metrics, and image URLs are also normalized at the public DTO boundary.

## 2026-06-11 - Sanitize Public Profile Research Summaries

Public faculty profile `research_interest_summary` values now pass through the same contact-redacting, bounded text serializer as other public profile fields. Stored user-provided summaries and generated fallback summaries keep their display role but cannot expose direct contact text through the derived summary field.

## 2026-06-11 - Sanitize Public Scholarly-Link Metadata

Public profile scholarly-link DTOs now sanitize display metadata that was previously copied from stored link rows. Free-full-text labels, venues, relationship basis, and evidence labels pass through contact redaction and length bounds, while year and confidence are range-normalized before exposure.

## 2026-06-11 - Allowlist Public Scholarly-Link Status Fields

Public profile scholarly-link DTOs now expose only allowlisted `destinationKind` and `openAccessStatus` values. Unknown destination kinds fall back to `OTHER`, and unknown open-access statuses are omitted, preventing arbitrary stored workflow/status text from crossing the public profile boundary.

## 2026-06-11 - Require Confirmed Listings on Profile Listing Cards

Authenticated profile listing cards now use the same public visibility boundary as listing browse/detail surfaces. `/profiles/:netid/listings` returns only non-archived, confirmed listings for the profile owner or professor id, preventing unconfirmed drafts from leaking through profile subroutes.

## 2026-06-11 - Minimize Admin Profile Management Payloads

Admin faculty-profile list/detail routes now serialize through an explicit profile-management DTO instead of returning raw `User` documents. The DTO keeps fields needed by the admin edit workflow and publication review, but omits unrelated private account state such as favorite ids, saved pathway plan notes, workflow confidence maps, manual lock fields, dedupe maintenance fields, and raw owned-listing ObjectIds. The admin table now receives `ownListingCount` instead of `ownListings`.

Admin faculty-profile update responses now use the same profile-management DTO instead of returning the raw updated `User` document. The admin edit modal does not consume the update body, so the safer response boundary preserves workflow behavior while avoiding accidental exposure of private account arrays or workflow metadata after writes.

## 2026-06-11 - Minimize Authenticated Research-Area Taxonomy Reads

Authenticated `/api/research-areas` list/search responses now explicitly exclude Mongo `_id` values. These endpoints only support label selection and shared taxonomy creation, so normal authenticated clients should receive `name` and `field` without persistent internal taxonomy identifiers.

## 2026-06-11 - Use Full Private Headers on Config Refresh

Admin-only `POST /api/config/refresh` now uses the full private response header set: private no-store cache control, `Pragma`, `Surrogate-Control`, `Expires`, and `X-Content-Type-Options: nosniff`. Public `GET /api/config` remains intentionally public-cacheable because it returns the sanitized public configuration DTO.

## 2026-06-11 - Remove Raw Account ObjectId Arrays from User Mutation DTOs

Generic current-user mutation responses no longer include `ownListings`, `favListings`, `favFellowships`, or `favPathways`. Those arrays are internal account join state and can include stale or hidden ids during mutation workflows; clients should use the dedicated visible/id-filtered account endpoints for favorites, saved programs, saved research plans, and owned listing cards.

## 2026-06-11 - Minimize Admin Taxonomy Management Payloads

Admin research-area and department management routes now serialize list/create/update responses through explicit DTOs. The DTOs keep ids and display/edit fields needed by the admin UI, but omit raw model metadata such as research-area `addedBy`, department `sourceRecords` and `codeSystem`, timestamps, aliases not used by the UI, and schema version fields.

## 2026-06-11 - Minimize Public Research Detail Paper Payloads

Public research detail responses now serialize `recentPapers` and `recentArxivPreprints` through a dedicated paper DTO. The DTO keeps bibliographic display fields, public-safe URLs, dates, DOI/arXiv identifiers, and citation counts, while omitting internal author/user/entity/source ids, provenance maps, confidence/manual-lock metadata, external-id blobs, archived state, and persistence timestamps.

## 2026-06-11 - Minimize Admin Listing Management Payloads

Admin legacy listing management routes now serialize list and update responses through an explicit listing-management DTO instead of returning raw `Listing` documents. The DTO keeps fields needed by the admin table/edit modal, including admin-only contact arrays, while omitting internal research join ids, creator ids, archived workflow timestamps, embeddings, schema internals, and arbitrary raw document fields.

## 2026-06-11 - Minimize Admin Fellowship Management Payloads

Admin fellowship management routes now serialize list, update, archive, and unarchive responses through an explicit fellowship-management DTO instead of returning raw `Fellowship` documents. The DTO keeps fields needed by the admin table/edit workflow, including admin-only contact fields, while omitting source fingerprints, source verification timestamps, student-visibility workflow metadata, schema internals, and arbitrary raw document fields.

## 2026-06-11 - Minimize Admin Access-Review Write Responses

Admin access-review record update responses now return only the reviewed record id, archived flag, and bounded review state needed by the review UI. The write response no longer echoes the full derived record after review updates, avoiding unnecessary exposure of source evidence ids, observation ids, evidence excerpts, source URLs, direct contact fields, reviewer ObjectIds, and other raw record fields.

## 2026-06-11 - Keep Pathway Search Workflow Tiers Server-Only

Public/authenticated pathway search responses must not expose nested research-entity `studentVisibilityTier` workflow metadata. Mongo and Meilisearch pathway search serializers now omit the tier from `researchEntity` hits directly; the Meilisearch document may still retain `entityStudentVisibilityTier` as an internal filter field for enforcing public visibility, but it must not be copied into the normalized response.

## 2026-06-11 - Omit Access-Signal IDs from Public Research Detail

Public research detail responses now omit `_id` from access-signal cards. Access signals are supporting evidence records, not student action targets, so their persistent Mongo ids should remain server-side. Entry pathway ids remain in detail payloads because saved research-plan actions use those pathway ids, and posted opportunity ids remain because they route to opportunity detail pages.

## 2026-06-11: CAS Return State Is Path-Only On The Client

Client logout and sign-in return state now stores and forwards only normalized same-origin path/search/hash values. Absolute same-origin values from old localStorage entries are downgraded to paths, while external, ambiguous, control-character, encoded protocol-relative, or oversized values are dropped before constructing the `/api/cas?redirect=...` link.

Consequences:

- Browser-controlled `logoutReturnPath` state no longer carries full origins into the CAS redirect query.
- The server-side same-origin redirect validator remains the final backstop for CAS, error, and dev-login redirect handling.
- Static security preflight guards the path-only client boundary.

## 2026-06-11: OAuth Callback HTML Carries Static Token-Page Policy

The Google OAuth callback receives an access-token URL fragment before `oauth-callback.js` clears history and broadcasts the bounded token over a state-scoped channel. Server headers remain the primary boundary, but the checked-in callback HTML now also carries no-referrer and a restrictive meta CSP in both `client/public` and checked-in `client/dist`.

Consequences:

- The callback page is constrained if served by a plain static asset path without Express security headers.
- The page permits only the same-origin callback script and blocks connect, image, style, form, and object destinations.
- Static security preflight guards both the source and served callback HTML copies.

## 2026-06-11: Deployed Session Secrets Require Basic Entropy

The app uses signed stateless session cookies, so a production `SESSION_SECRET` must be more than merely long. Deployed runtimes now reject trimmed secrets shorter than 32 characters, secrets with too little character diversity, and obvious default/development/password/session-secret marker values.

Consequences:

- Misconfigured low-entropy secrets such as repeated characters fail startup in production-like runtimes.
- Local development, test, and CI can still bypass with a warning so local imports remain usable.
- Static security preflight and runtime tests guard the stronger startup boundary.

## 2026-06-11: Session Cookie Principals Are Normalized Before Serialization

Passport writes only the authenticated NetID into the signed stateless session cookie, then rehydrates user type and admin authority from storage on each request. The serializer now applies the same Yale-shaped NetID normalization used by deserialization before writing the principal.

Consequences:

- Malformed, object-shaped, oversized, or non-Yale-shaped principals fail closed before cookie serialization.
- The cookie payload remains a primitive NetID rather than a hydrated user/account object.
- Runtime Passport tests and static security preflight guard both serialize-time and deserialize-time principal boundaries.

## 2026-06-11: Origin Trust Rejects Credentialed And Smuggled Header Values

Unsafe API requests and deployed logout both derive browser trust from `Origin` or, when absent, `Referer`. Those headers are now rejected before origin comparison when they contain control/space/backslash characters or URL username/password credentials.

Consequences:

- Crafted values such as `https://user:pass@yalelabs.io` cannot normalize to an allowed origin.
- Present malformed `Origin` headers continue to fail closed instead of falling back to `Referer`.
- CSRF middleware, logout tests, and static security preflight guard the stricter parser boundary.

## 2026-06-11: Auth Middleware Requires Bounded Session Principals

Route authentication and role guards now require `req.user` to contain a primitive Yale-shaped NetID before treating the request as authenticated. Truthy object-shaped, missing, oversized, or malformed NetID principals fail closed before admin grant lookup or route/controller work.

Consequences:

- `isAuthenticated` no longer accepts arbitrary truthy session-shaped objects.
- Admin, professor/faculty, listing-create, trustworthy, and confirmed-account guards all share the same primitive NetID boundary.
- Runtime middleware tests and static security preflight guard against regressions that would reintroduce object-shaped or missing principals.

## 2026-06-11: Rendered Fetch Redirect Preflight Uses GET Semantics

The optional Scrapling renderer runs outside Node's connect-time SSRF-safe lookup, so rendered fetches must fail closed before handing URLs to Python. The seed redirect preflight now uses a bounded `GET` with a one-byte range request and destroys the response after headers instead of relying on `HEAD`, which can differ from browser navigation behavior.

Consequences:

- Public seed URLs that redirect only on `GET` are blocked before the Python renderer executes.
- Final browser URLs that fail the shared SSRF guard are classified as `rendered-final-url-blocked` security blocks rather than generic empty-render failures.
- Static security preflight and rendered-fetch tests guard the GET preflight and final-URL block classification.

## 2026-06-11: Shared CSRF Guard Covers Write-Like Safe-Method Routes

The application has a small class of safe-method API paths that still change authentication state, currently `/api/logout`. The shared CSRF origin guard now accepts the same write-like safe-method path set used by the write rate limiter, so those routes require trusted `Origin` or `Referer` headers even when the HTTP method is `GET`.

Consequences:

- Cross-site GET requests to `/api/logout` are blocked by the shared API CSRF middleware before Passport route handling.
- The logout handler's own trusted-origin check remains as a route-local backstop.
- Runtime CSRF tests and static security preflight guard alignment between write-like safe-method classification and shared CSRF enforcement.

## 2026-06-11: Admin URL Check Results Bound Reflected Display URLs

The admin URL checker already bounds batch size and uses SSRF-safe host/connection checks before outbound requests. Rejected URL results now also strip control characters and cap the reflected display URL before returning it to the admin UI.

Consequences:

- Oversized or control-character URL inputs are not echoed back verbatim in JSON responses.
- Credential-bearing valid URLs still have username/password removed before display.
- Runtime admin-route tests and static security preflight guard the bounded display reflection behavior.

## 2026-06-11: Auth Status Fails Closed On Malformed Session Principals

The `/api/check` auth status route now requires the same primitive bounded NetID shape used by session serialization before returning `auth: true`. If a malformed truthy `req.user` object reaches the route, the response is `auth: false` instead of an authenticated user with an `unknown` NetID.

Consequences:

- Auth status serialization no longer has a fallback authenticated identity.
- Passport session deserialization remains the primary boundary, while `/api/check` has its own fail-closed DTO boundary.
- Runtime Passport tests and static security preflight guard the malformed-principal behavior.

## 2026-06-11: Saved Plan Exports Neutralize Spreadsheet Formula Strings

Saved research-plan exports are JSON attachments, but their fields are likely to be copied into Google Sheets or CSV workflows. Exported labels, research-home names, checklist keys, and explicitly opted-in private notes now pass through the shared spreadsheet-cell neutralizer before leaving the server.

Consequences:

- Formula-like values beginning with `=`, `+`, `-`, or `@` are apostrophe-prefixed in export payloads.
- System-derived labels and research-home names still redact direct contact details before spreadsheet neutralization.
- Runtime user-service tests and static security preflight guard server-side saved-plan export neutralization.

## 2026-06-11: Account Department Joins Are Derived-Only For Self-Edits

Current-user account updates no longer accept `departments` as a direct self-service field. When a student updates `primaryDepartment` or `secondaryDepartments`, the controller recomputes `departments` from those sanitized canonical fields and existing stored values.

Consequences:

- Self-service clients cannot forge the aggregate department join field independently of the canonical profile fields.
- Existing profile-update behavior for faculty remains aligned: aggregate departments are derived after primary/secondary edits.
- Runtime user-controller tests and static security preflight guard the derived-only department update boundary.

## 2026-06-11: Shared Search Regex Helper Normalizes Mongo Options

Search routes already bound request search length and escape regex metacharacters before Mongo queries. The shared search regex helper now also trims terms and allowlists Mongo regex flags before returning `$options`, and public posted-opportunity detail routes use shared ObjectId middleware before controller handling.

Consequences:

- Future callers cannot accidentally forward unsupported or caller-controlled regex flags through `buildSafeSearchRegex`.
- Search terms are capped after trimming, avoiding whitespace padding around the shared 100-character helper cap.
- Public opportunity detail routes now fail fast at middleware with the same ObjectId boundary as listing, program, and fellowship detail routes.

## 2026-06-11: Public URL Sanitizers Reject Raw Control And Whitespace Characters

Client and server public URL helpers now reject raw control characters, whitespace, and backslashes before URL parsing or normalization. The client API-base environment parser uses the same boundary for `VITE_APP_SERVER`. This keeps browser-rendered links, profile/listing URL persistence, public DTO URL fields, and configured API origins aligned on the same fail-closed URL policy.

Consequences:

- Parser-normalized values such as newline-smuggled URLs, backslash host confusion, and raw-space URLs are rejected instead of normalized into outbound links or API origins.
- Existing scheme, credential, private-host, and port restrictions remain unchanged.
- Runtime URL utility tests and static security preflight guard both the client and server URL sanitizer boundaries.

## 2026-06-11: Browser Storage Excludes Private Planning Notes

Saved research-plan notes and account tracking notes are private user-authored planning data. The client no longer writes those note/checklist fields to `localStorage`; saved research-plan local storage keeps only non-sensitive intent/stage state, and account tracking note storage keys are removed on hydration/persistence.

Consequences:

- Existing saved-plan local drafts can still be read once and migrated to server-backed details, but new local writes strip private note and checklist text.
- Program/lab tracking notes remain in memory during the active session, but durable browser storage only keeps stage-like tracking state.
- Runtime reducer/component tests and static security preflight guard against reintroducing private note persistence in localStorage.

## 2026-06-11: Google Sheets OAuth Tokens Have Bounded Client Lifetime

Google Sheets export still uses a popup OAuth flow, but bearer-token retention is now tighter. The client clears the module-level cached token immediately after acquisition, sends Sheets API writes with an `AbortController`, and aborts long-running requests after a bounded timeout before final cleanup.

Consequences:

- A stalled Sheets API request no longer keeps the module-level OAuth token available until the browser network stack eventually settles.
- The local request token remains scoped to a single export request and is bounded by the abort timeout.
- Runtime Google Sheets tests and static security preflight guard the timeout, abort signal, and token cleanup behavior.

## 2026-06-11: CORS Origin Headers Must Be Canonical Browser Origins

The CORS middleware now validates the `Origin` header shape before allowlist or local-bypass decisions. Accepted browser origins must be canonical `http:` or `https:` origins with no credentials, path/query/fragment suffix, raw whitespace/control characters, or backslashes.

Consequences:

- Credentialed, whitespace-padded, path-bearing, `null`, and backslash-confused origins are rejected before any CORS allow decision.
- Local development/test CORS bypasses no longer allow malformed origins through the callback path.
- Runtime CORS middleware tests and static security preflight guard the canonical-origin boundary.

## 2026-06-11: CSP Disallows Runtime Base URL Rewrites

The global browser CSP now uses `base-uri 'none'` instead of allowing same-origin `<base>` tags. The app does not depend on runtime base elements, and disallowing them reduces the impact of any future markup injection that attempts to rewrite relative URL resolution.

Consequences:

- Injected or accidental `<base>` elements cannot change how relative links, scripts, forms, or asset URLs resolve.
- Existing script, object, frame-ancestor, form-action, and referrer restrictions remain unchanged.
- Runtime security-header tests and static security preflight guard the stricter CSP base policy.

## 2026-06-11: Logout Return Paths Are Session-Scoped

Logout return paths can include private in-app route and query context. The client now stores them in `sessionStorage` instead of durable `localStorage`, and sign-in/logout paths remove the legacy `localStorage` key.

Consequences:

- Logout return state no longer survives browser restarts as durable local storage.
- Existing same-origin, path-only, length, control-character, and ambiguous-path checks remain in place before CAS redirect construction.
- Component tests and static security preflight guard the session-scoped storage boundary and legacy-key cleanup.

## 2026-06-11: Sanitized Logs Are Bounded After Redaction

The shared server log sanitizer now redacts known secret, contact, credential, and header forms before applying a maximum sanitized-output length. Oversized values keep an explicit truncation marker so operators can distinguish bounded output from complete messages.

Consequences:

- Attacker-controlled error text or structured log values cannot produce unbounded sanitized log output.
- Secret redaction still runs over the full raw value before truncation, avoiding truncation that merely hides whether redaction happened.
- Focused sanitizer tests and static security preflight guard the redaction-before-bounding behavior.

## 2026-06-11: arXiv Retry Failures Reuse Sanitized Error Text

The arXiv preprint scraper now sanitizes rate-limit retry failures before writing either fetch metrics or scraper logs. The retry path matches the initial failure path instead of reading `retryErr.message` directly.

Consequences:

- Provider or network errors that include bearer tokens, API keys, URLs, cookies, or contact data are redacted before scraper reporting.
- Retry-failure logs and returned fetch metrics share the same sanitized value.
- Focused scraper tests and static security preflight block the raw retry-message pattern from returning.

## 2026-06-11: Outbound SSRF URLs Must Be Canonical Text Before Parsing

The shared SSRF guard and admin URL checker now reject raw control characters, whitespace, and backslashes after trimming and before URL parsing or DNS work. This aligns outbound fetch inputs with the stricter public URL/CORS canonicalization policy.

Consequences:

- Parser-normalized whitespace/control payloads and backslash host-confusion payloads cannot reach outbound URL parsing.
- Admin URL checker batches reject ambiguous URL text before fan-out, and direct reachability checks return a local invalid result before DNS.
- Focused SSRF/admin tests and static security preflight guard the canonical outbound URL boundary.

## 2026-06-11: Server Start Refuses Stale Or Source-Mapped Build Artifacts

The server production start script now runs a local freshness guard before `node build/index.js`. The guard refuses to start when `server/build/index.js` is missing, older than server source/package/TypeScript/tsup build configuration, or accompanied by leftover server source-map artifacts.

Consequences:

- Beta/production starts cannot silently run stale checked-in or locally cached server bundles after source security fixes.
- Beta/production starts also fail closed if `server/build/index.js.map` is present, preserving the no-server-sourcemap release boundary.
- Normal deploys that run `yarn build:server` before `yarn --cwd server start` continue to use the built bundle.
- Static security preflight guards the start command and freshness-check script.
