# Directory removal

A person who asks to be removed from y/labs is withheld from everything the site serves (#4160).
The design and the owner's answers to its open questions are recorded on that issue.

## The record

`directory_removals` holds one keyed HMAC digest per identifier of a removed person, and nothing readable (`server/src/models/directoryRemoval.ts`).
A digest is taken over a normalized netid, email, ORCID, profile URL or name, under `DIRECTORY_REMOVAL_KEY` (`server/src/utils/directoryRemovalDigest.ts`).
An identity entry withholds the researcher who carries that identifier.
A name entry withholds that name wherever it appears as a name string, which is how an undergraduate on an embedded roster is removed.
It also withholds a namesake's name on an embedded roster and in prose, except in the prose of a row that serves that namesake as a lead or member, which is their own context; only an identity entry withholds a live researcher.
Entries are recorded on Development with `yarn --cwd server directory-removal:record` and reach Beta and Production with the corpus they suppress; `docs/release-process.md` owns the copy rules.

## What a removal withholds

The serving layer reads the list through `server/src/services/directoryRemovalServing.ts`, refreshed at most every five minutes.
It finds the removed researchers by matching every live researcher's identifiers against the identity digests, and keeps their current names in memory only.
A name entry never matches a researcher, so it never ends a namesake researcher's role edges or suppresses their row.
It applies to embedded roster names and to prose, and in prose it skips a name only inside a payload object that itself serves that name as a lead or member (`withServedPeopleOf` in `directoryRemovalServing.ts`), so a faculty namesake's own detail page and share metadata keep their text while every other row is redacted.
A card names only its first lead, so a namesake who is a later co-lead has that name redacted from the card's prose.
A stale snapshot keeps serving while a background reload replaces it, so only the first load blocks a request.
Until that first load completes, a deployed runtime withholds every role edge and listed undergraduate rather than serve unfiltered.

- Role edges: every serve path reads its roster through `servedRoster` or `servedRosterByEntityId`, which drop a removed person's edges.
  That covers detail members, card lead names, similar and related cards, saved research, and the search index's `leadProfessorNames`, `professorNames` and `memberNames`.
  The shared roster accessor is left unfiltered on purpose, because the materializer and the dedupe scripts read it and must still see the person.
- Embedded undergraduates: `publicRosterUndergraduates` drops a withheld name.
- Prose: every JSON response under `/api/research`, `/api/programs`, `/api/fellowships`, `/api/users/savedResearchEntities` and `/api/users/watchedPrograms` passes through `redactWithheldNamesInJson`, which drops every sentence of prose that names a withheld person, by the owner's decision of 2026-11-10.
  A title field (`name`, `displayName`, `title` and the other `TITLE_KEYS`) cannot lose a sentence, so there the name is replaced with `WITHHELD_PERSON_PHRASE` instead.
  The search index documents and the page shell's share metadata go through the same redaction.
  Ids, slugs and links are never rewritten.

## States

- Inert: the list is empty, and nothing changes.
- Active: entries and a key, and only the removed people are withheld.
- Withholding every name: a deployed runtime holds entries but no usable key, or cannot read the list, so it cannot tell a removed person from anyone else.
  It drops every role edge and every listed undergraduate, and redacts every known researcher and roster name from prose.
- Unfiltered local: a loopback development server holds entries but no key, and serves names unfiltered, because the database it reads already holds every name in the clear.

The server logs its state at startup.

## The gate

The student visibility gate reads the same served roster, so a row whose every lead is removed is held at `suppressed` with the reason `researcher_removed`, which outranks an operator override (`server/src/services/studentVisibilityTier.ts`).
A removed co-lead or member leaves the row to the ordinary tests, which decide it on the people who remain.
Nothing is locked: withdrawing the entry restores the row on the next gate pass.
A row carrying `researcher_removed` is kept out of the search index altogether, like an archived row, so its name and slug never sit in Meilisearch (`isExcludedFromSearchIndex` in `server/src/services/directoryRemovalReason.ts`); a sync or reconcile after the gate pass deletes a document it already had.
The gate refuses to run while entries exist and the process has no usable key, in every environment including a loopback development worktree, because a pass that cannot match would publish removed rows again.

## Mint and ingest

Lanes never store new evidence about a removed person, so a purge stays done after the next sweep (`server/src/scrapers/directoryRemovalObservationGuard.ts`).
At `appendObservations`, an observation whose person subject matches an identity entry is dropped, as are the four row fields that point at the person (`inferredPiUserKey`, `inferredPiUserId`, `inferredDirectorProfileUrl`, `contactEmail`), and a faculty research profile whose lead pointer names the person is dropped whole, because it is their own row.
No mint or attach path creates a researcher, role edge or faculty research profile for them (`server/src/services/directoryRemovalMintGuard.ts`).
Each refusal is counted as `removed_by_request`, and none writes a lock or an override.
Researchers are refused by identifier only: a name entry never refuses a researcher or a person subject, keyed or keyless.
A `--dry-run --explain` preview lists only the observations ingest would keep, and it writes only to the `--output` file the operator names, never to stdout.

## Before the first entry

Every process that runs the gate must hold the key before the first entry is recorded, or it stops at the gate.

1. Give Development's operators the key through `DIRECTORY_REMOVAL_KEY_FILE`, a file outside the repository, because `scripts/new-agent-worktree.sh` copies `server/.env` into every agent worktree.
2. Set `DIRECTORY_REMOVAL_KEY` on the Beta and Production web services, whose remote promotion phase runs the gate after every copy.
3. Set `DIRECTORY_REMOVAL_KEY` on the `ylabs-scraper` sweep cron before it is re-enabled, because its gate stage refuses otherwise (`docs/deployment-inventory.md`).
4. Then record the entry on Development and run the gate.
5. Tell ylabs-manager before the `development:search:sync` that removes the suppressed rows' documents, then read the served detail page and search route.

## Purging observations

A removed person's stored observations are deleted with `yarn --cwd server directory-removal:purge-observations`, one environment per run.
Promotion copies `observations` only with `--include-observations`, so a Development purge does not remove older copies already on Beta or Production, and the purge is a per-environment operation.
Run it on Development first; the Beta and Production runs are approved by the owner at promotion time.
It is a dry run unless given `--apply --confirm-directory-removal-observation-purge`, takes no identifier, matches every active entry in that environment's `directory_removals`, and refuses when the list is empty or no key is configured.
`--environment=beta` and `--environment=production` read `BETA_MONGODBURL` and `PRODUCTION_MONGODBURL`, the database name must match the named environment, and a Production apply also needs `SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true`.
It reports counts only: person subjects to delete by `entityType`, and observations to delete by `entityType`, identity form and field.

It matches through the ingest guard's own rules (`server/src/scrapers/directoryRemovalObservationGuard.ts`), so it deletes exactly what a lane would now refuse to observe.
A `user` or `researchGroupMember` subject is deleted in both identity forms when a stable identifier matches, and a research row's `inferredPiUserKey`, `inferredPiUserId`, `inferredDirectorProfileUrl` or `contactEmail` observation is deleted when its value points at the person.
A name entry never matches a researcher or a person subject, so a name-only match is never deleted.
Values that list several people, such as `rosterEnrichment`, `fellowshipRecipients` and roster identity evidence, are neither deleted nor rewritten.
It also deletes every stored observation of the removed person's own faculty research profile row, identified the way ingest refuses the whole row: the row declares `entityType: FACULTY_RESEARCH_AREA` and its stored lead pointer names the person, read across both identity forms of the row and never by name.
Those deletions are reported apart, as `facultyResearchProfileRowsToDelete`, `facultyResearchProfileRowObservationsToDelete` and, on an apply, `facultyResearchProfileRowObservationsDeleted`.
An apply deletes the row's other observations before the pointers that identify it, so a rerun after an interrupted apply still finds the row, and a second run after a complete apply deletes nothing.
The removal entry has to stay after a purge, or the next sweep has nothing refusing the person.

## Known limits

- Prose matching is by the person's current display name and by name digests over two to four word windows, so a spelling with a middle initial or a nickname is missed.
- A row whose slug contains a removed co-lead's name keeps its URL until the slug migration lands; the owner decided it gets a new slug with no redirect.
- Meilisearch ranks on the documents it holds, so a removed name can still rank a row until the next reindex, even though the served row is re-read from Mongo and redacted.
