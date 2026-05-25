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

The release queue is written by `yarn --cwd server student-visibility:gate`. Scraper `--auto-materialize`, manual materialize, and production cron paths run the gate after clean write materialization. Scheduled or manual global reconciliation should run the same command with `--collection=all --mode=apply` under the existing environment write guards.

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
