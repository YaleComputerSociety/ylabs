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

The rule is about a claim, not about a string.
A body may name a person with no identifier in it at all, in ordinary prose, and that is the worst version of the mistake rather than an exception to it.

## What counts as a person-bearing identifier

- An entity slug carrying a person-bearing prefix: `nih-pi-`, `nsf-pi-`, `ysm-faculty-`, `faculty-research-area-`.
- A directory profile path: `<host>.yale.edu/profile/<name>`, and the `people` and `faculty` variants.
- A personal `@yale.edu` address.
  A role address such as `physics@yale.edu` is not person-bearing.
- A Yale netid, including one embedded in the local part of an address.
- A person's name in prose, which no identifier pattern can match.

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

This is also what the detector is aimed at, and it was not always.
An earlier version matched identifier shape alone, which reported three public directory URLs cited as evidence that a link resolved, and stayed silent in the same body on a sentence naming four people as departures.
It flagged the citation and missed the accusation.
A profile URL offered as proof that a page loads is the harmless case this section describes.
A name next to `departed` is the harm.

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

**Loud, and not required.** `.github/workflows/person-identifier-scan.yml`, on issue and pull request bodies.
When a body trips a rule the workflow comments with the rule names and counts, never the matched text, and then fails its own check run so a green check cannot read as a clean body.
Because the check is not required, that failure informs a merge path rather than stopping one.
`scripts/person-identifier-scan-workflow.test.mjs` pins both halves: a flagged body turns the run red and still posts a report that never echoes the match, and a body written by predicate leaves the run green and posts nothing.

The body arm separates a finding from a note.

- A **finding** is a sentence that pairs a person with a status or judgement claim.
  The person may be an identifier or a prose name.
  The claim vocabulary is grounded in the stored enums, `yaleStatusCache`, `yaleStatusReasonCache` and `studentVisibilityTier`, plus their prose forms, so the detector tracks the claims the product actually makes rather than a list somebody invented.
- A **note** is a bare profile URL with no claim in its sentence, most often cited as evidence that a link resolves.
  A note is reported and does not fail.
  A run of profile URLs reaching the dump threshold is a finding whatever the prose says, because a list is dump shape on its own.

A slug, a personal address and a netid remain findings unconditionally.
Unlike a URL, none of them has a legitimate evidentiary use in a body.

Check a draft before posting it, which is the only moment the fix is free:

```
yarn security:identifiers:body /tmp/pr-body.md
```

The prose-name rule is fuzzy on purpose and lives only on the body arm.
Measured against the repository's own documentation, roughly nine in ten of its early matches were Title Case technical phrases rather than people; excluding headings, table rows, code fences, indented blocks, acronyms, quoted titles, and segments that do not read as prose cut that to eleven matches across all of `docs/` and `skills/`, two of which are real names.
A pull request body is shorter and far less dense in Title Case than those files, so treat that as an upper bound.
The blocking arm never calls this rule, so a false positive cannot fail a required check.
It can fail the body arm's own run, which is why `AGENTS.md` excepts `Person identifier scan` from "merge only when checks are green": the remedy for a Title Case product phrase matched as a name is a comment saying so, then a merge on the red.
It is never an `identifier-exempt:` line, which suppresses the whole body including a real name elsewhere in it, and a detector switched off to discuss ordinary work stays off.

The body arm cannot prevent the text from being published, and this is a real limit rather than an oversight.
A workflow cannot prevent an issue from being created, and adding `edited` to the `ci.yml` trigger would rerun the entire test-and-build job on every body tweak.
The comment tells the author while the context is fresh, which is the moment the fix is still free.

The body arm does, however, fail its own check run on a finding, and that is not a contradiction.
It succeeded either way until #2953, which made a green `gh pr checks` read as "the body is clean" to every automated merge path: two pull request bodies naming a person reached `beta` that way, each with the scan check green beside the comment that flagged it.
The failure cannot unpublish anything.
It exists so that a merge path reading `gh pr checks` sees the finding rather than a green row, and it is safe to make loud precisely because the check is not required, so a false positive delays nobody.
It is not a guarantee that the finding is seen: the run is queued by the `opened` event after `gh pr create` returns, so a path that polls and merges promptly can finish before the check exists.
Closing that would mean requiring the check, which the paragraph above rules out.

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
