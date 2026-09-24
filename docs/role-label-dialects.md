# Role label dialects

A role exists in more than one spelling here, and the spellings are not interchangeable.
#3204 gave the lead role set one owner in `server/src/models/canonicalRoleMapping.ts` after a filter written in the wrong dialect matched nothing and made every row read as having zero live lead edges.
This page records the rest of the picture: which dialects exist, which label sets carry labels that no dialect defines, and which sets only look like they do.

Symbols are named rather than line numbers, because line numbers rot faster than the hazard does.
`server/src/models/__tests__/roleLabelDialects.test.ts` pins every claim below that is mechanically checkable.

## The dialects

| dialect | where it lives | values |
|---|---|---|
| canonical | `role_assignments.role`, filtered with `LEAD_ROLE_CANONICAL_VALUES` | the 10 keys of `LEGACY_ROLE_BY_CANONICAL`, e.g. `PI`, `CO_PI` |
| served | a member object on the detail route, tested with `LEAD_ROLE_LEGACY_LABELS` | the 10 values of `LEGACY_ROLE_BY_CANONICAL`, e.g. `pi`, `co-pi` |
| write-side alias | scraper and materializer input only | the 12 keys of `CANONICAL_ROLE_BY_LEGACY`, which adds `affiliate` and `alumni`, both collapsing to `AFFILIATED` |
| grant record | the embedded grant record on `ResearchEntity` | `pi` and `copi`, and nothing else |

The canonical and served dialects are disjoint by construction, which is the whole point: comparing a value from one against a set from the other cannot throw, it returns empty.

An alias is not a served label.
`affiliate` and `alumni` are legitimate on a write path and are never emitted to a student, so a set on the write side that accepts them is correct and a set on the serve side that tests for them is dead weight.
Direction is therefore the first question to ask about any of these sets, before membership.

## Labels no dialect defines

Five labels appear in role comparisons and are absent from all four dialects: `principal_investigator`, `principal-investigator`, `lead`, `faculty_lead`, `faculty`.
They carried across two files when this was measured, and the guard fails when a sixth such label appears or a further file acquires one.
It deliberately does not fail when a set is pruned or deleted, because that is how an item here is meant to be closed out.

## Set inventory

Two of these sets carry an undefined label.
The other four were previously recorded as carrying the same defect and do not.

A third, `isLeadRole` in `server/src/services/profileService.ts`, was deleted by #3263 along with the retired public profile shaper, and the entry for it is removed rather than kept as history: this page exists so a reader can go to a named symbol, and naming one that is gone is the hazard it is here to prevent.
The guard's file allowlist no longer names that file either, which matters because leaving it there would have gone on tolerating a NEW undefined label in a file that now holds no role set at all.

### Carries an undefined label

- **`LEAD_PROFESSOR_MEMBER_ROLES`** in `server/src/services/researchEntitySearchIndexService.ts`.
The four served lead labels plus `principal_investigator`, `lead`, `faculty_lead`.
A superset of the owner set, so its behaviour is correct and only the three extra labels are inert.
#3220's guard spares it deliberately, matching only the exact four-element literal, which is why this set is a record rather than a defect.
- **`SEARCHABLE_PROFESSOR_MEMBER_ROLES`** in the same file.
Spreads the set above and adds `core-faculty`, `affiliated`, `affiliate`, `faculty`.
`core-faculty` and `affiliated` are served labels and belong.
`affiliate` is a write-side alias the serve path never emits, and `faculty` is in no dialect at all.

### Does not

- **`MEMBER_ROLES`** and **`SUPERSEDED_BY_DIRECTOR_ROLES`** in `server/src/scrapers/entityMaterializer.ts`.
Every entry of both, including `affiliate` and `alumni`, is a key of `CANONICAL_ROLE_BY_LEGACY`.
Both sit on the write path, where an alias is the input the mapping exists to accept, so pruning them would reject observations the materializer is meant to take.
- **`GENERIC_PROFILE_CATEGORY_SEGMENTS`** in `server/src/services/leadProfileIdentity.ts`.
Not a role set.
It is a list of URL path segments, used only to decide whether a profile URL is a generic category page, alongside entries like `economics`, `emeritus` and `professors`.
`affiliate` appears there as a path segment and carries no role meaning, so there is nothing to prune and nothing to align.
- **`LEAD_ROLES`** in `server/src/scripts/researchQualitySearchReviewCore.ts`.
The four served lead labels plus `core-faculty`, all five served.
Deliberately wider than the owner set because it asks a different question, and folding it in would change behaviour.
- **`LEAD_ROLES`** in `client/src/components/labs/LabMembersList.tsx`.
Exactly the four served lead labels.
The client cannot import the server constant, so the two vocabularies are pinned only by the `LabMemberRole` union, which #3220 narrowed to what the server actually serves.
#3204's owner scan covers `server/src` only, so this copy is outside it.

## Two traps

**`copi` is not `co-pi`.**
The embedded grant record on `ResearchEntity` declares `role` with `enum: ['pi', 'copi']`, written by `server/src/scrapers/sources/federalAwardScraper.ts`.
`canonicalRoleForLegacy('copi')` is undefined, so a value from that record silently matches nothing in either the canonical or the served dialect.
Do not fold it into the role vocabularies without first deciding what a grant record's role means, which is a narrower claim than a membership role.

Both traps are latent rather than live, measured on Development: rows with `grants.role: 'copi'` read **0**, and with the served spelling `'co-pi'` also **0**, so the third dialect is declared and never yet written. Rows carrying `leadVerification` at all read **0**. Neither costs anything today, and each first bites whoever adds the first writer or the first reader.

**`leadVerification[].role` stores canonical values on an enum-less path with no reader.**
`labSiteLeadVerificationScraper` writes canonical values into it and nothing reads them back, so there is no wrong answer to observe today.
A reader written against the served dialect would match nothing and read as "no verifications", the same failure #3204 fixed.
Add the `enum` at the same time as the first reader.
The guard test allows the path to have no enum and requires that any enum it gains equals the canonical values, so adding the enum correctly passes and adding it in the served dialect fails.

## How to close this out

Prune an undefined label when you are already editing the file that holds it, and update the inventory above in the same change.
Not as a sweep: each of the three sets asks a slightly different question, and only one of them is a candidate for deletion rather than repair.
The guard tolerates a pruned or deleted set by design, so closing an item out never requires loosening it.
