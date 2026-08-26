# Legacy `User` Retirement Plan

Tracking issue: #2014.
This plan finishes the identity split by retiring the legacy `User` model and collection.
All work is Development-only until a separately reviewed production step.

## Why this is not a rename

`User` is one fat legacy document doing four jobs at once.
Two are already split out; this plan finishes the other two and drops the collection.

| Job | Status | Destination |
|-----|--------|-------------|
| Login / auth | Done (#367) | `Account` (`netid`, `email`, `status`, `lastLoginAt`) |
| Private saves (labs + programs) | Done (#484) | `ResearchPlan` (`accountId` + `target`) |
| Public scholar identity | Partial | `Researcher` |
| Scraped / edited profile data | This plan | mostly dropped ("pointer, not copy") |

`Researcher` is already the thin pointer model, so the retirement is mostly deletion plus repointing readers, not schema growth.

## Target model

`Account` is the only record required on login.
`Researcher` and `StudentProfile` are optional facets hanging off it.

```
Account       { netid, email, status, userType (DERIVED at login, non-blocking),
                studentProfileId?, login-state }                       // required on login
  Researcher     { displayName, profileLinks[] (pointers), identifiers.orcid,
                   profile{title, primaryDepartment, imageUrl, websiteUrl},
                   accountId?, status, archived }                      // optional scholar facet, no new fields
  StudentProfile { netid, graduationYear, majorDepartmentIds[],
                   researchAreaIds[], researchInterests[], lookingFor } // optional, lazy, future personalization
  ResearchPlan[] { accountId, target{kind,id} }                        // saves, any account, immediately
```

`User` is deleted entirely.

## Design principle: pointer, not copy

A `Researcher` links out to the person's official Yale profile, which already holds their bio, research areas, and topics.
The research entity (lab or faculty home) already carries its own description and research areas, sourced independently at the entity level from the same official page.
So the person model does not copy or hoard that content.
It stores identity and pointers only.

Entity content does not depend on the persisted person fields.
When a scraper reads a faculty profile it emits two parallel observation sets from one scrape: a `user`-typed set for the person surface and a `researchEntity`-typed set for the home's own description and areas.
Dropping the person-level content fields is therefore safe for the ingestion and materialization pipeline.

## Field decisions

### Keep on `Researcher` (already present, no new fields)

`displayName`, `profileLinks[]` (the pointers), `identifiers.orcid`, `profile{title, primaryDepartment, imageUrl, websiteUrl}`, `accountId`, `status`, `archived`.

### Move to `Account`

`netid`, `email`, `userConfirmed`, login-state (`lastLogin`, `lastLoginAt`, `loginCount`, `lastActive`), `studentProfileId`, and `userType` (derived at login, not a forced gate).

### Move to `StudentProfile`

`college`, `year`, `major` (map onto `graduationYear` and `majorDepartmentIds[]`).

### Kill

- `bio`, `researchInterests`, `topics`, `departments`, `secondaryDepartments`: entity content and the official-profile pointer already cover these.
- `dataSources`, `confidenceByField`, `manuallyLockedFields`, `profileVerified`, `profileVerificationRequestedAt`: person-editor and per-person-field provenance machinery, unneeded once the person fields are gone.
- `googleScholarId`, `hIndex`, `googleScholarMetricsUpdatedAt`, `openAlexId`, `semanticScholarId`, `publications`, `openAlexWorksSyncedAt`, `orcidWorksSyncedAt`, `europePmcWorksSyncedAt`, `pubmedWorksSyncedAt`: bibliographic residue from the retired paper pipeline.
- `phone`, `unit`, `upi`, `physicalLocation`, `buildingDesk`, `mailingAddress`: contact chrome, not surfaced since the person page was retired (#1938).
- `facultyMemberId`, `ownListings`: target collections are empty.
- `favListings`, `favFellowships`, `favPathways`, `savedResearchEntities`, `savedProgramTracking`, `savedResearchEntityMigrationCompleted`: dead or migrated to `ResearchPlan`.
- `dedupedIntoUserId`, `dedupedAt`, `dedupeReason`, `dedupedIdentityField`, `dedupedIdentityValue`: `users`-collection dedupe bookkeeping.
- `scholarCandidateProfileUrls`: unconfirmed candidates; the self-published ones are promoted to verified `profileLinks[GOOGLE_SCHOLAR]` first, then the field is dropped.

## Google Scholar

Automated Scholar discovery is not viable: there is no official API, scraping violates the terms of service and is IP-blocked, and name-to-Scholar matching cannot fail closed.
Coverage today is 5 of 19,231 users, so a discovery scraper would stay near zero.
The only trustworthy Scholar links are the ones a person published on their own official or roster page; there are about 234 such candidates.

Decision:

- Keep `GOOGLE_SCHOLAR` as a supported `profileLinks` kind (opportunistic capture and the accepted-input crosswalk).
- Promote the existing self-published candidates to verified `profileLinks[GOOGLE_SCHOLAR]`.
- Drop the `googleScholarId` scalar and Scholar metrics.
- Do not build a Scholar-discovery scraper.
- Lean on ORCID (32% coverage, API-backed, deterministic) as the primary scholarly identifier.

## Onboarding and personalization

The core loop is already usable on login: any `Account` can search, browse, and save (`ResearchPlan`) immediately, and discovery works logged out (#1657).
`StudentProfile` interest capture is optional and non-blocking; it only feeds future personalization ranking (#1468/#1512).
The one blocking step today is the unknown-user identity-confirmation form driven by `userType === UNKNOWN`.

Decision: derive `userType` at login where possible and remove the forced identity gate, so login goes straight to search and save.
Keep `StudentProfile` in the model but optional and lazy; personalization is a future opt-in, not a login tax.

## Duplicate-person handling

`researchers` (about 20,475) exceeds distinct person keys (about 19,437), and there are about 1,523 duplicate-`displayName` groups.
The backfill must merge, never fan out.

- Resolve via the existing `resolveResearcherIdForLegacyUser` chain (`netid` to `Account` to `accountId`, then `identifiers.orcid`, then a single name-only match), failing closed on ambiguity.
- Same-email-different-name is a review queue, not an automatic merge.
- Run source-side dedupe on `users` before the backfill so collisions are resolved on the source side.

## PR sequence

1. Backfill and dedupe (this PR): source-side dedupe `users`; backfill `Researcher` display and pointer fields, including promoting Scholar candidates. No reader changes, reversible.
2. Account and Student split: move `college`/`year`/`major` to `StudentProfile`; move `userType`, login-state, and `studentProfileId` to `Account`; derive `userType` at login and remove the onboarding gate.
3. Scraper reads: repoint the six name-lookup scrapers and `integrityGate` to a `Researcher` name and status index.
4. Runtime reads: repoint `profileController`, `admin.ts`, `adminGrantService`, `launchAcquisitionReportService`, and `fellowshipInputs`; reconcile the `visibilityRepairQueueService` person-bio to entity-description path to the entity-level observation; drop the residual reads in `researchGroupService` and the bridge read in `researchEntityMembershipAccessor`.
5. The writer: `entityMaterializer` writes `Researcher` and `Account` instead of `User`; retire `profileService.adminUpdateProfile` and the admin person editor.
6. Drop: delete `models/user.ts` and the ten User-maintenance scripts; gate the `users` collection drop; rebuild Meilisearch.

## Test and rebuild checklist

- Unit and integration coverage for the profile read and write paths as they move.
- `resolveResearcherIdForLegacyUser` fail-closed cases (ambiguous name, same-email-different-name).
- Scraper name-lookup parity before and after the repoint, with `ALLOW_NON_PROD_SCRAPER_WRITES=true` on Development.
- Rebuild the `researchentities` Meilisearch index after the writer flip.
- `integrityGate` clean after dedupe.
- Note the pre-existing `scriptWriteGuards` macOS-environment failures are unrelated baseline noise.
