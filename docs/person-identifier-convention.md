# Person identifier convention

This repository is public.
Issues, pull requests, and commit messages are served to anyone, indexed by crawlers, and mirrored by third parties.
This document is the rule for naming rows in a trackable artifact, and the reason the rule is preventive rather than corrective.

## The rule

Identify rows by predicate, never by identifier.

Write this:

> The 12 rows where `manuallyLockedFields` contains `activeAtYaleCache` serve a stale description.
> 5 of them are also missing `sourceLinkHealth`.

Not this:

> `nih-pi-<given>-<family>`, `ysm-faculty-<given>-<family>`, ... serve a stale description.

A count plus a predicate is reproducible by anyone with database access, survives a slug migration, and names nobody.
A list of slugs is a snapshot that names people and rots.

Never publish a mapping from an identifier to a redaction token.
A table pairing `nih-pi-<given>-<family>` with `PERSON_A` defeats the redaction it appears to perform.

## What counts as a person-bearing identifier

- An entity slug carrying a person-bearing prefix: `nih-pi-`, `nsf-pi-`, `ysm-faculty-`, `faculty-research-area-`.
- A directory profile path: `<host>.yale.edu/profile/<name>`, and the `people` and `faculty` variants.
- A personal `@yale.edu` address.
  A role address such as `physics@yale.edu` is not person-bearing.
- A Yale netid, including one embedded in the local part of an address.

Department and school keys are **not** people.
Redacting a `ysm-<department>` key destroys the artifact for zero privacy gain.
The rule is about identifiers that resolve to one person.

## What the harm actually is

A faculty name and department are already published in Yale's own directories, so a bare identifier is close to harmless on its own.
The harm is what this repository attaches to it: `departed`, `inactive_at_yale`, `suppressed`, `permanently_closed`, or a defect judgement, next to someone identifiable.
Several such claims are wrong, which is usually why the issue is open in the first place.
A closed issue is not safer.
It reads as settled fact and nobody will revisit it.

So the thing to avoid is not the name.
It is the pairing of a name with a claim about that person.

## Why this is preventive and not corrective

Editing published text does not remove it.
GitHub retains every prior revision and serves it without an account:

- `GET https://github.com/user_content_edits/edit_history/<node id>` returns 200 unauthenticated and lists every revision with its editor and timestamp.
- `GET https://github.com/issues/edit-history-dialog?id=<UserContentEdit id>` returns the pre-edit text verbatim, for issue bodies as well as for comments.
- A logged-out visitor reaches both by clicking the "Edited" badge.

Renaming is worse.
The old title persists as a `renamed` timeline event with no edit history to prune, and cannot be removed at all short of deleting the issue.

Deleting a comment does remove it, and its revisions with it, but allow a few seconds of propagation before verifying: an immediate re-read still serves the old revision.
Deleting an issue body means deleting the whole issue, which destroys the thread and the closing links from merged pull requests.

That asymmetry is the whole argument for this convention.
Getting the first draft right costs a sentence.
Fixing it afterwards costs either the tracking context or nothing at all.

## How it is enforced

Two arms, with different strengths, because a single mechanism cannot cover both.

**Blocking.** `yarn security:identifiers`, inside `yarn security:preflight`, inside the required `test-and-build` check.
It fails on a committed data file that holds many distinct personal addresses or profile URLs, which is the shape of a scraped directory dump.
It deliberately ignores anything under a test or fixture path, because synthetic identifiers there are intentional, and it ignores source files.

**Advisory.** `.github/workflows/person-identifier-scan.yml`, on issue and pull request bodies.
When a body trips a rule the workflow comments with the rule names and counts, never the matched text.

The body arm cannot block, and this is a real limit rather than an oversight.
A workflow cannot prevent an issue from being created, and adding `edited` to the `ci.yml` trigger would rerun the entire test-and-build job on every body tweak.
The advisory comment tells the author while the context is fresh, which is the moment the fix is still free.

## Escape hatch

Sometimes a literal identifier is genuinely required, most often in a rollback runbook that has to stay greppable.
Add a line reading `identifier-exempt: <reason>`.
Both arms then skip the artifact.
Stating a reason is the point: the hatch exists so the gate is consciously overridden rather than deleted.

## Known gap

A personal-site hostname is a surname, so `<surname>.yale.edu` survives a slug sweep.
This is not enforced.
`machtagroup.yale.edu` and `<surname>.yale.edu` are not separable without an allowlist of institutional subdomains that would be permanently incomplete, and a gate with false positives gets removed rather than obeyed.
Watch for it in review instead, especially in a table of source URLs.

## Already-published text

The two arms above stop new exposure.
They do nothing about text already in the tracker.
Remediating that means deleting comments, which is surgical, or deleting whole issues, which is not.
Treat it as a judgement call per artifact, weigh it against the tracking context that deletion destroys, and prefer a correction comment where the attached claim turned out to be wrong.
