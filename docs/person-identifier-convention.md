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
  The exception is a registered source or server script name that contains a prefix, such as `ysm-faculty-directory`, which the scan allows by exact match on the whole token.
  The allowance is pinned by test against three registries: the seed list in `seedSources.ts`, `RETIRED_SOURCE_NAMES` in `sourceDispatch.ts`, and the `server/package.json` script names.
  A retired source name keeps its allowance, because retiring a source does not stop it being discussed and stored `fieldProvenance` still cites it; a name that leaves all three loses it, which is what stops the set drifting into a stoplist.
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

**Blocking before posting.** `scripts/gh-identifier-guard.mjs`, installed as a `gh` shim ahead of the real binary on PATH, on issue, pull request, comment, review, merge, close and reopen comment, and API bodies, GraphQL mutations included.
For a call that targets a `YaleComputerSociety` repository, whether through `-R`, `GH_REPO`, the checkout remote, an API endpoint, or a URL argument, it scans the title and body before `gh` runs, and when a rule fires it prints the rule names and counts, never the matched text, and exits without calling GitHub.
It also refuses when the scanner itself is missing, so a broken install fails closed rather than posting unchecked.
A refused draft is kept at `$TMPDIR/gh-guard-<random>/body.md`, readable only by its owner, and the refusal prints that path, so the author can read exactly what to rewrite.
`scripts/new-agent-worktree.sh` installs it through `scripts/install-gh-identifier-guard.sh`, which refuses to overwrite a `gh` there that is not a guard shim, and `scripts/gh-identifier-guard.test.mjs` pins that a flagged body never reaches the real `gh` and a clean one reaches it unchanged.
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

A roster of surnames does not scale to a driver that invents its own people, which is what the `no-mistakes` gate's live-validation drivers do, so two consecutive pull requests failed the body scan on entirely synthetic data (#3540).
The second allowance is therefore a marker convention rather than a name list: `SYNTHETIC_FIXTURE_MARKERS` holds `fixture`, `sample`, `synthetic`, `placeholder` and `example`, and the body scan clears a slug, an address local part or a directory profile URL's leaf whose **final** segment is one of them.
So `ysm-faculty-<given>-fixture`, `<given>.sample@yale.edu` and `.../profile/<given>-fixture/` are read as invented, while `nih-pi-fixture-<surname>`, `fixture.<surname>@yale.edu` and `.../profile/fixture-<surname>/` still flag, because the marker is not last and the thing in the surname position is a name.
Prefer a marker over the surname roster when writing a fixture, because it needs no change here to add one.

The set was chosen against the live corpus rather than by taste: 0 of 9,119 research-entity slugs end in any marker, 0 carry one as a segment at all, and 0 of 11,155 researcher addresses have a local part ending in one.
`sample` and `example` are the only two attested as surnames anywhere, so if either ever appears in the corpus the answer is to drop that word from the set rather than to special-case the row.
The allowance is a body-scan allowance only, and a test asserts every marker form is still flagged in strict mode, so it cannot quietly become a stoplist.
The same allowance covers one netid shape, `SYNTHETIC_NETID_RE`: `zz`, an optional third letter, then digits beginning with `99`, such as `zz9993` or `zzq9999`.
It is the only netid form a fixture may use, and the marker convention deliberately does not extend to netids: a netid is opaque, so no marker can be read out of one without also clearing real netids, and a test pins that this arm was not widened.
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

The gate writes its pull request body from the diff, so it quotes test fixtures, and the guard cannot tell a synthetic fixture from a real person.
When the gate's `pr` step fails on a guard refusal, run `no-mistakes sync --yes` to take the gate's pushed head, then re-run `no-mistakes axi run` with an `--intent` that carries this rule: describe the regression tests by behaviour only and never quote a test fixture string, slug, or name from the diff.
The rule lowers the odds rather than guaranteeing a clean body, so read the kept draft before re-running.

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
