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
  A prefix partway through a hyphenated token counts too, so `screenshot-nih-pi-<name>.png` is still a slug.
  The exception is a registered source or server script name that contains a prefix, such as `repair-nih-nsf-pi-center-lab-conflation`, which the scan allows by exact match on the whole token.
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

**Blocking before posting.** `scripts/gh-identifier-guard.mjs`, installed as a `gh` shim ahead of the real binary on PATH, on issue, pull request, comment, review, merge, and API bodies.
For a `YaleComputerSociety` repository it scans the title and body before `gh` runs, and when a rule fires it prints the rule names and counts, never the matched text, and exits without calling GitHub.
It also refuses when the scanner itself is missing, so a broken install fails closed rather than posting unchecked.
`scripts/new-agent-worktree.sh` installs it through `scripts/install-gh-identifier-guard.sh`, and `scripts/gh-identifier-guard.test.mjs` pins that a flagged body never reaches the real `gh` and a clean one reaches it unchanged.
There is no after-the-fact bot: a comment on text GitHub already serves cannot unpublish it, so the workflow that posted one was removed (#3682).

The body arm separates a finding from a note.

- A **finding** is a sentence that pairs a person with a status or judgement claim.
  The person may be an identifier or a prose name.
  The claim vocabulary is grounded in the stored enums, `yaleStatusCache`, `yaleStatusReasonCache` and `studentVisibilityTier`, plus their prose forms, so the detector tracks the claims the product actually makes rather than a list somebody invented.
- A **note** is a bare profile URL with no claim in its sentence, most often cited as evidence that a link resolves.
  A note is reported and does not fail.
  A run of profile URLs reaching the dump threshold is a finding whatever the prose says, because a list is dump shape on its own.

A slug, a personal address and a netid remain findings unconditionally.
Unlike a URL, none of them has a legitimate evidentiary use in a body.

The one allowance is the synthetic fixture roster, `SYNTHETIC_FIXTURE_SURNAMES` in `scripts/check-no-person-identifiers-core.mjs`, which holds the invented surnames the detector's own tests use.
The body scan lets an identifier or prose name built from one of them through, because a pull request about the detector has to quote its fixtures and the no-mistakes gate pastes its adversarial inputs into the body.
The allowance tests only the identifier itself, meaning the slug from its prefix onward or a two-word prose name ending in a roster surname, so a fixture surname sitting next to another name does not let that other name through.
The tests scan in strict mode, which ignores the roster, so they still prove every shape is flagged.
Write a new test fixture from the roster rather than inventing another name, and widening the roster is a reviewed change that its pin test makes deliberate.
The same allowance covers one netid shape, `SYNTHETIC_NETID_RE`: `zz`, an optional third letter, then digits beginning with `99`, such as `zz9993` or `zzq9999`.
It is the only netid form a fixture may use.
A real netid would need both `zz` initials and a `99` digit prefix to pass the body scan, and that is the accepted limit of the allowance.

Check a draft before posting it, which is the only moment the fix is free:

```
yarn security:identifiers:body /tmp/pr-body.md
```

The prose-name rule is fuzzy on purpose and lives only on the body arm.
Measured against the repository's own documentation, roughly nine in ten of its early matches were Title Case technical phrases rather than people; excluding headings, table rows, code fences, indented blocks, acronyms (including plural ones such as `IDs` and `POSTs`, meaning any token that opens with two capitals), quoted titles, and segments that do not read as prose cut that to eleven matches across all of `docs/` and `skills/`, two of which are real names.
A pull request body is shorter and far less dense in Title Case than those files, so treat that as an upper bound.
The blocking file arm never calls this rule, so a false positive cannot fail a required check.
It does stop the guard from posting, so a Title Case product phrase matched as a name is fixed in the detector, with a regression test, rather than worked around.
It is never an `identifier-exempt:` line, which suppresses the whole body including a real name elsewhere in it, and a detector switched off to discuss ordinary work stays off.
Never call the real `gh` directly to get past a refusal either.

The guard protects only a host it is installed on.
A body posted from anywhere else is not scanned at all, and commit messages are not guarded anywhere, because another tool owns `core.hooksPath` on the maintainer machine, so scan them by hand before a push.

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
