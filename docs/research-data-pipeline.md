# Research Data Pipeline

Status: active operator reference

Last updated: 2026-05-25

Yale Research data moves through an evidence-first pipeline. Use this document for the stable shape of the pipeline, [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md) for source-level audit expectations, and [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) for Beta and production promotion steps.

## Pipeline Shape

```txt
Source metadata
  -> ScrapeRun
  -> append-only Observation rows
  -> evidence coverage review for research listing/entity claim gaps
  -> entity/materializer resolution
  -> ResearchEntity / User / Paper / Grant / Fellowship records
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity when evidence supports it
  -> student visibility gate promotes public-safe records or opens release queue items
  -> Meilisearch rebuild or sync
  -> Research, Pathways, Programs, Opportunity detail, and admin/operator surfaces
```

Scrapers collect evidence. They should not create unsupported student-facing conclusions such as "accepting undergrads." Materializers derive product records from observed evidence, source confidence, stable keys, and manual locks. Evidence coverage review is the pre-write/pre-visibility diagnostic layer for research listings: it classifies whether identity, description, lead/contact, access, action route, and freshness claims are missing, weak, or supported. The student visibility gate remains the public-release boundary: it promotes records that satisfy the visibility rules and holds the rest in the release queue with root repair reasons.

## Student Trust Contract

The student-facing contract is: public research, pathway, program, and opportunity surfaces may show only records that are source-backed enough for a student to act on without being misled. `student_ready` means the record has enough identity, description, context, and next-step evidence to be broadly public. `limited_but_safe` means the record is honest and useful but visibly incomplete. `operator_review` and `suppressed` are not public product states; they are repair states that should appear in admin/operator workflows and release queues only.

The contract has five practical rules:

- Public surfaces use only `student_ready` and `limited_but_safe` tiers unless an admin route explicitly requests review/suppressed records.
- Research entities need source-backed identity, a non-misleading description, and enough context to explain what the research home studies; publication or listing blurbs alone do not satisfy entity-description quality.
- Access, pathway, contact, and posted-opportunity claims must come from explicit evidence, not inference from a lab existing or a faculty member publishing.
- Private scraped contact data, raw observations, internal queue notes, and non-public visibility reasons stay out of public payloads.
- Held rows are repaired at the source/materializer/evidence layer, then released by the student visibility gate; operators should not manually promote by weakening the rules.

Use DB-backed dry-run review before broad source expansion:

```bash
yarn scrape run --source <source-name> --dry-run --db-review
```

The dry-run report includes `evidenceCoverageImpact` for affected `ResearchEntity` rows, including resolved blockers, remaining blockers, and rejected fields. This makes "more data" operationally useful only when the new source repairs a specific public claim. Publication/book blurbs may support research-topic context, but they should not satisfy entity-description coverage; listings can support access/action evidence, but they should not by themselves make a research home student-ready.

## Read-Only Control Plane

The first control-plane slice is the admin Operator Board. It remains read-only and does not replace CLI or cron execution. It should show:

- source readiness from seeded `Source` rows, recent `ScrapeRun` posture, expected artifacts, and next actions
- latest dry-run and write-run posture so operators can see whether Mongo writes need a follow-up Meili rebuild
- review queues split into repair blockers, review signals, and positive evidence signals
- release queue pressure from held visibility records, grouped by blocker and source
- discovery candidates from high-signal evidence queues that may be promotable after review
- WorkPlanner freshness policies for broad, paid, API-limited, or stale-sensitive sources
- manual gate commands for data quality, scraper integrity, and search sync posture

Pending Meili sync is an operator warning, not a worker. Local or VPN jobs may make Mongo current while Render-owned Meili remains stale; production promotion must explicitly rebuild or verify the prefixed production indexes before smoke checks.

The repeatable gstack data-quality loop is:

```txt
source health -> data quality -> dry-run repair yield -> Playwright UX verification -> controlled apply
```

Search/UX review should connect golden-query warnings to live research-home pages before broad writes. The quality-search review row must keep enough fields to pick a route and diagnose student-visible gaps: `slug`, source domains, lead count, pathway/contact/access/posting counts, duplicate candidates, matched query names, and warning codes. When research entities have source URLs but no captured page title, the review derives an inspectable research entity source title from the first valid source URL so `WEAK_SOURCE_TITLE` remains a real missing-source signal instead of a default warning. Playwright checks are read-only and should verify that the lab page is visible, research-home-first, source-backed, and honest about missing access or activity evidence.

The release queue is written by `yarn --cwd server student-visibility:gate`. Scraper `--auto-materialize`, manual materialize, and production cron paths run the gate after clean write materialization. Scheduled or manual global reconciliation should run the same command with `--collection=all --mode=apply` under the existing environment write guards.

Research activity enriches the lab/detail experience but is not itself undergraduate access evidence. Papers and scholarly links should appear when they are tied through `paper_authors` identity proof or explicit entity-paper links, helping students understand what the PI or lab studies before clicking through to a professor profile. Do not let name-only publication matches create PI/member links, access signals, contact routes, or public visibility.

`yarn --cwd server papers:quality-audit --sample-limit=0` is the read-only paper activity sanity gate. A result with zero active papers is a coverage warning, not a clean pass, because it usually means the materialization target DB or active-paper filter needs inspection before research activity can be trusted. On 2026-05-25 the current Beta target had `papers=0`, `paper_authors=0`, and no research entity paper caches, so the next paper/activity lane must restore or rerun identity-backed paper materialization before frontend research-activity polish can be meaningful.

## Canonical Collections

Runtime research discovery is centered on:

- `research_entities`
- `entry_pathways`
- `access_signals`
- `contact_routes`
- `posted_opportunities`
- `users`
- `papers`
- `paper_authors`
- `fellowships`
- `sources`
- `scrape_runs`
- `observations`

The legacy `research_groups` collection is intentionally absent after the hard `ResearchEntity` migration and should not be used as a data-health signal.

## Promotion Invariants

Before production promotion:

- The accepted Beta dataset must have zero blocking referential errors across canonical collections.
- Source reports must show `materialization.errors = 0`, or any nonzero count must block promotion for that source.
- Known warnings must be documented in [`docs/tasks/priority-roadmap.md`](./tasks/priority-roadmap.md) before promotion.
- Production must have a fresh Atlas backup or restore point before any copy or write.
- The current promotion strategy is Lane A: accepted Beta copy. Guarded production deltas are out of scope unless fresh parity cannot be re-established and the operator packet is reopened.
- Meilisearch must be rebuilt or synced after accepted Mongo writes, with `PATHWAY_SEARCH_BACKEND=mongo` kept as the rollback posture for Pathways.
- Recurring scraper jobs stay disabled until the manual production gate and smoke checks pass.

The operator decision packet in [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) is the promotion record for lane, backup/restore point, rollback owner, smoke owner, Meili backend posture, accepted warnings, run IDs, and rollback drill status. Lane A is the default for the accepted Beta candidate, but the packet must still be completed before production writes or copy operations.

## Rollback Drill Expectations

Rollback drills are dry-run-only until an operator approves production action:

- Lane A accepted Beta copy: identify the Production backup or point-in-time restore timestamp, the copied collection set, the Atlas restore owner, and the Meilisearch rebuild/relevance-review sequence.
- Lane B guarded production delta: identify the source to disable, the plan to stop additional source runs, the pre-run backup or restore point, the threshold for restoring broad bad materialization, and the Mongo-backed Pathways rollback posture.
- Both lanes keep `PATHWAY_SEARCH_BACKEND=mongo` as the default rollback posture until production Meilisearch relevance review is accepted.

## Retention Posture

OpenAlex-scale publication enrichment may use compact retention after reports are saved because durable publication data lives in `papers` and authorship proof lives in `paper_authors`. Do not apply that pruning posture to access-evidence sources without a separate decision; observations are the audit backbone for student-facing pathway and evidence claims.
