# Directory removal

A person who asks to be removed from y/labs is withheld from everything the site serves (#4160).
The design and the owner's answers to its open questions are recorded on that issue.

## The record

`directory_removals` holds one keyed HMAC digest per identifier of a removed person, and nothing readable (`server/src/models/directoryRemoval.ts`).
A digest is taken over a normalized netid, email, ORCID, profile URL or name, under `DIRECTORY_REMOVAL_KEY` (`server/src/utils/directoryRemovalDigest.ts`).
An identity entry withholds the researcher who carries that identifier.
A name entry withholds that name wherever it appears as a name string, which is how an undergraduate on an embedded roster is removed, and it also withholds every namesake.
Entries are recorded on Development with `yarn --cwd server directory-removal:record` and reach Beta and Production with the corpus they suppress; `docs/release-process.md` owns the copy rules.

## What a removal withholds

The serving layer reads the list through `server/src/services/directoryRemovalServing.ts`, refreshed at most every five minutes.
It finds the removed researchers by matching every live researcher against the identity digests, and keeps their current names in memory only.

- Role edges: every serve path reads its roster through `servedRoster` or `servedRosterByEntityId`, which drop a removed person's edges.
  That covers detail members, card lead names, similar and related cards, saved research, and the search index's `leadProfessorNames`, `professorNames` and `memberNames`.
  The shared roster accessor is left unfiltered on purpose, because the materializer and the dedupe scripts read it and must still see the person.
- Embedded undergraduates: `publicRosterUndergraduates` drops a withheld name.
- Prose: every JSON response under `/api/research`, `/api/programs`, `/api/fellowships`, `/api/users/savedResearchEntities` and `/api/users/watchedPrograms` passes through `redactWithheldNamesInJson`, which replaces a withheld name with `WITHHELD_PERSON_PHRASE`.
  The search index documents and the page shell's share metadata go through the same redaction.
  Ids, slugs and links are never rewritten.

## States

- Inert: the list is empty, and nothing changes.
- Active: entries and a key, and only the removed people are withheld.
- Withholding every name: a deployed runtime holds entries but no usable key, or cannot read the list, so it cannot tell a removed person from anyone else.
  It drops every role edge and every listed undergraduate, and redacts every known researcher and roster name from prose.
- Unfiltered local: a loopback development server holds entries but no key, and serves names unfiltered, because the database it reads already holds every name in the clear.

The server logs its state at startup.

## Known limits

- Prose matching is by the person's current display name and by name digests over two to four word windows, so a spelling with a middle initial or a nickname is missed.
- A row whose slug contains a removed co-lead's name keeps its URL; whether to rename it is with the owner.
- Meilisearch ranks on the documents it holds, so a removed name can still rank a row until the next reindex, even though the served row is re-read from Mongo and redacted.
