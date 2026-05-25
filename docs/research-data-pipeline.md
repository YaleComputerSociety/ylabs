# Research Data Pipeline

Status: active operator reference

Last updated: 2026-05-25

Yale Research data moves through an evidence-first pipeline. Use this document for the stable shape of the pipeline, [`docs/scraper-audit-guide.md`](./scraper-audit-guide.md) for source-level audit expectations, and [`docs/scraper-deployment-runbook.md`](./scraper-deployment-runbook.md) for Beta and production promotion steps.

## Pipeline Shape

```txt
Source metadata
  -> ScrapeRun
  -> append-only Observation rows
  -> entity/materializer resolution
  -> ResearchEntity / User / Paper / Grant / Fellowship records
  -> EntryPathway / AccessSignal / ContactRoute / PostedOpportunity when evidence supports it
  -> Meilisearch rebuild or sync
  -> Research, Pathways, Programs, Opportunity detail, and admin/operator surfaces
```

Scrapers collect evidence. They should not create unsupported student-facing conclusions such as "accepting undergrads." Materializers derive product records from observed evidence, source confidence, stable keys, and manual locks.

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
- The operator must choose exactly one promotion lane: accepted Beta copy or guarded production delta.
- Meilisearch must be rebuilt or synced after accepted Mongo writes, with `PATHWAY_SEARCH_BACKEND=mongo` kept as the rollback posture for Pathways.
- Recurring scraper jobs stay disabled until the manual production gate and smoke checks pass.

## Retention Posture

OpenAlex-scale publication enrichment may use compact retention after reports are saved because durable publication data lives in `papers` and authorship proof lives in `paper_authors`. Do not apply that pruning posture to access-evidence sources without a separate decision; observations are the audit backbone for student-facing pathway and evidence claims.
