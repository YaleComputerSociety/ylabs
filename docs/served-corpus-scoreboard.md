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
| `serve-path pre-pass divergent` | Rows where an extra sanitize pre-pass would change the served answer. See below. |

`changed`, `unchanged and still served`, `held back at serve time`, and `no longer served` partition the present rows.
A row that is not served has no served copy to compare, so it is listed by slug rather than counted as changed.
A hand count that diffs every present row will therefore report a slightly higher `changed` than this command does.

The rendered projection is the detail page's.
It is `toPublicResearchEntityDto` without `forList`, so `fullDescription` is measured and card-only copy is not: `cardDescription`, which the browse list computes through `resolveResearchHomeCardSummary`, and the "Name (Department)" decoration the list path applies to colliding names never appear here.
A `shortDescription` that reads clean on this scoreboard can still be summarised badly on a card.

## Rolling the baseline forward

The baseline is a JSON array of objects carrying `slug`, `name`, `shortDescription`, `fullDescription`, `websiteUrl`, and `researchAreas`.
The `--output` artifact records `scoreboards[].servedRows` in exactly that shape, so today's served rows are tomorrow's baseline:

```bash
jq '.scoreboards[] | select(.environment == "beta") | .servedRows' \
  ./tmp/served-scoreboard.json > ./tmp/beta-served-baseline.json
```

Re-baselining ends the pairing with the 2026-08-31 hand-read, so do it deliberately and keep the old artifact.
The point of a fixed slug set is that a change in a number is a change in the corpus.

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
`getResearchGroupDetail` also refuses a document whose own stored copy names a deceased lead (#982), computed from the name carrying a lifespan or a description opening with one.
`/api/research/:slug` returns 404 for such a slug even though it is `student_ready` and not archived.

So `still served` means the detail route would actually serve the row, and the holdback gets its own count rather than being absorbed into `still served` (which would report copy for a page nobody can reach) or into `no longer served` (which would read as a tier or archived change that never happened).
This is exactly the defect class the instrument exists to track, so it is counted, not assumed away.

## The pre-pass divergence row

`sanitizeResearchEntityPublicDescriptionFields` is not the serve path.
`toPublicResearchEntityDto` is, and it runs `sanitizeServedResearchEntityCopyFields` internally, which is a superset of that narrower sanitizer.
Rendering through the narrow sanitizer first measures a path no HTTP route takes.

The composition is not equivalent, so the scoreboard reports how often it matters instead of assuming it cannot.
On the 2026-08-31 slug set, one row in all three environments diverges: the extra pre-pass strips a CV biography opening sentence that the real serve path keeps.
The pre-pass therefore reads cleaner than what students see, which means a hand-read built on it under-reports biography-opener defects.

## Reading the raw driver, not the models

The script connects with `MongoClient` and never opens a Mongoose connection.
Importing the serve path already registers the `TaxonomyTerm` model through `researchAreaCanonicalization`, and that registration is inert on its own.
It is a Mongoose connection that builds indexes and so recreates a collection that was deliberately dropped.
Adding one to this script would recreate `taxonomy_terms` on whichever environment the scoreboard reads.
