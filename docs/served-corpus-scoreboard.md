# Served Corpus Scoreboard

The scoreboard answers one question: is the copy students actually see getting better?

It renders a fixed set of slugs through the real serve path against a named environment and diffs the result against a stored baseline.
Read this before claiming a data fix improved anything.

## Why it exists

The only served-corpus quality measurement this repository had ever made was #2299, a hand-read of 100 random `student_ready` Beta cards on 2026-08-31: 46% clean, 26% seriously defective, 11% carrying a name that is not theirs.
It was never repeated, so for twelve days and roughly 200 merged fixes "are we making progress" was unfalsifiable in both directions.
#2575 turned that hand-read into a command.

## The command

```bash
yarn --cwd server research-entity:served-scoreboard \
  --baseline ~/ylabs-backups/handoffs/beta-served-hand-read-n100-20260831.json \
  --output ./tmp/served-scoreboard.json
```

It reads and never writes to any environment.

- `--baseline <path.json>` is required.
The 2026-08-31 artifact is the baseline slug set.
- `--environment development|beta|production` may be repeated.
With none given it reads all three.
Environment URLs come from `MONGODBURL`, `BETA_MONGODBURL`, and `PRODUCTION_MONGODBURL` in `server/.env`, and each connection is checked against the database name it claims to be.
- `--output <path.json>` writes the full served text.
It must land under the OS temp directory or `./tmp`, both ignored by git, because the artifact carries served copy about real people.
The path is validated before the first database read, so a bad path fails immediately rather than after three Atlas reads.
- `--text-limit <chars>` bounds console text only, default 600.
`--text-limit 0` prints everything.

A git worktree has no `server/.env` of its own, so copy one in before running there.

## How to read it

The slug set is fixed rather than re-sampled.
That makes the comparison paired: a change in a number is a change in the corpus, not a change in the draw.

| Row | Meaning |
|---|---|
| `research_entities` | Every document in the collection. |
| `student_ready` | Tier `student_ready` and not archived. This is the served population. |
| `baseline slugs present` | Baseline slugs that still exist as documents. |
| `still served` | Present, `student_ready`, not archived, and not held back at serve time. |
| `held back at serve time` | Present and `student_ready`, but the detail route refuses it anyway. Each is listed by slug. See below. |
| `no longer served` | Present but held back by tier or archived. Each is listed with its tier and archived flag. |
| `changed` | Still-served rows whose served copy differs from the baseline. |
| `unchanged and still served` | The "nothing happened here" count. |
| `changed, cosmetic only` | Rows whose every change is whitespace, or a reordered research-area list. |
| `<field> changed` | Per-field breakdown across `name`, `shortDescription`, `fullDescription`, `websiteUrl`, `researchAreas`. |

`changed`, `unchanged and still served`, `held back at serve time`, and `no longer served` partition the present rows.
A row that is not served has no served copy to compare, so it is listed by slug rather than counted as changed.
A hand count that diffs every present row will therefore report a slightly higher `changed` than this command does.

## Which surface this measures

**The detail route, roster-resolved.** Not "served copy" in general, because there is no single served-copy projection.

The scoreboard calls `getResearchGroupDetail(slug)` and reads the `researchEntity` it returns.
That is the only faithful way to get it: the route resolves the roster, derives `leadMemberNames` from the public lead roles, and only then builds `buildResearchEntityPublicDescriptionRepresentation`, whose entity the DTO is built from.
Every shortcut past that step measures something else, and the gap is not small.
Measured across all 7,002 Development entities on 2026-09-12:

| Projection | Rows differing from the detail route | Of those, served |
|---|---|---|
| `toPublicResearchEntityDto(doc)` | 373 | 160 |
| `toPublicResearchEntityDto(sanitizeResearchEntityPublicDescriptionFields(doc, []))` | 335 | 146 |

The dominant shape is `sanitizeResearchHomeSelfReferenceCopyFields`, which runs only inside the representation: the shortcut projections print "This research profile studies X" where the route serves "This research studies X".
The first version of this command used the first of those two projections, and for its first hour it reported copy that 160 served rows do not have (#2575).

The browse card is a different surface again, and the two are **not nested in either direction**.
Browse gates with the name-agnostic `researchEntityServesPublicDetail` and resolves its own card copy, so a row can pass one surface and fail the other: stripping a lead name can create a failure ("Dr. Cohen's research aims to..." becomes "This research aims to..."), and `shortDescriptionQuality` scores the short relative to the full.
Card-only copy is therefore out of scope here: `cardDescription` via `resolveResearchHomeCardSummary`, and the "Name (Department)" decoration the list path applies to colliding names.
A `shortDescription` that reads clean on this scoreboard can still be summarised badly on a card.

## Cutting a second baseline

**The 2026-08-31 hand-read is the pinned baseline and does not get updated.** Decided 2026-09-12.
Never overwrite it with a fresh render: the whole value of a fixed slug set is that a change in a number is a change in the corpus, and rolling served rows into it silently ends the pairing to the only human-classified sample this product has.

When you want a fresh sample, cut a **second, separately named** baseline and keep both.
The baseline is a JSON array of objects carrying `slug`, `name`, `shortDescription`, `fullDescription`, `websiteUrl`, and `researchAreas`, and the `--output` artifact records `scoreboards[].servedRows` in exactly that shape:

```bash
jq '.scoreboards[] | select(.environment == "beta") | .servedRows' \
  ./tmp/served-scoreboard.json > ~/ylabs-backups/handoffs/beta-served-n100-<YYYYMMDD>.json
```

Report both baselines when you use the new one, so a reader can see which pairing a number belongs to.

## Two properties that are not decoration

**Every figure is checked against its own population before anything prints.**
A subset that exceeds its population, or a partition whose parts do not sum to the whole, throws.
Three separate measurement errors in this area in one hour all failed toward a confident wrong number rather than toward an error, so the command fails loudly instead.
Two documents sharing one slug also fails, because counting by slug would silently report a subset larger than its population.

**"Changed" is not "fixed".**
On the 2026-08-31 sample, 19 of the 29 hand-classified serious defects had changed, and several were still just as defective in different words.
So the report prints the baseline and served text of every changed field and a human classifies it.
A diff count alone cannot tell you whether a defect was repaired or reworded.

## The serve-time holdback row

Tier and archived are not the last gate.
`getResearchGroupDetail` returns null, and `/api/research/:slug` therefore 404s, when the public-description invariant fails or when the stored copy names a deceased lead (#982), even for a row that is `student_ready` and not archived.
The scoreboard calls `researchEntityServesPublicDetail`, the same entity-only predicate the browse list filters on, so it covers both halves from one place instead of reimplementing either.

So `still served` means the detail route would actually serve the row, and the holdback gets its own count rather than being absorbed into `still served` (which would report copy for a page nobody can reach) or into `no longer served` (which would read as a tier or archived change that never happened).
This is exactly the defect class the instrument exists to track, so it is counted, not assumed away.

One limit worth knowing: the detail route evaluates the invariant with lead-member names joined in, and this predicate does not have them, so a row whose invariant turns on a lead name can still be classified differently from the live route.
On the 2026-08-31 slug set the count is 0 in all three environments, which is what you would expect from a sample drawn entirely from served cards. It means the unit tests, not this sample, are what prove the detector fires.

## Why it opens a Mongoose connection, and why that is safe

Calling the real route needs the models, so this command connects Mongoose.
That is the one thing a read-only command must not let change the environment it reads: connecting builds indexes for every registered model, which recreates a collection somebody deliberately dropped.

Two things make it safe, and the second is a check rather than an assumption:

- `autoIndex` is disabled before `mongoose.connect`, and a test pins that ordering rather than merely pinning that both calls exist.
- The collection set is listed with the raw driver before and after, and the run fails naming any collection that appeared or disappeared.

Corpus counts come from the raw driver, not the models.
