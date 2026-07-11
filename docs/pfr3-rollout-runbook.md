# PFR-3 Operational Rollout

This rollout is fail-closed and staged.
The review and monitoring commands are read-only.
The pathway rebuild remains the only write operation and requires a verified restore point.

## Source acquisition queue

Generate the read-only remediation queue before assigning source work:

```bash
PFR3_QUEUE_HANDLE_SALT='<environment-specific secret, at least 16 characters>' \
  yarn --cwd server pfr3:pathway-source-queue
```

The default report is aggregate-only. Its mutually exclusive buckets are worked in order:

1. `status_recency_review`: evidence, confidence, and a safe public source already qualify; a human must verify whether the pathway is currently active or recurring.
2. `source_repair`: the pathway lacks a safe public HTTP(S) source; an operator must locate and validate an authoritative public source.
3. `new_source_acquisition`: weak evidence is also below the `0.70` confidence threshold; acquire new authoritative evidence through the normal scraper/observation workflow.

For bounded assignment samples, add `--sample-limit=N` where `N` is at most 100. Samples contain only salted, non-reversible handles and coarse quality labels. Keep the environment-specific salt stable for one review cycle, store it outside reports, and rotate it between cycles. The command never prints URLs, evidence IDs, database IDs, excerpts, names, or contact details.

The queue is triage only. Operators must not directly upgrade pathway status, evidence strength, or confidence. Re-scrape or add source-backed observations, run the normal materializer and review flow, then regenerate this report to confirm the pathway moved buckets.

## 1. Admin contact-route review

Run `yarn --cwd server pfr3:contact-route-review` against Beta.
The queue contains only structurally eligible public HTTP(S) destinations and sources, policy, evidence-reference count, priority, and current review state.
It excludes approved, archived, direct-email, unknown-policy, and no-direct-contact routes.
It never changes review status and contains no database identifiers, names, email addresses, or evidence excerpts.

An admin must inspect the source and destination, verify the policy, and approve through the existing access-review workflow.
Re-run the queue until the remaining candidates are understood.
Do not bulk-approve.

## 2. Beta preflight and rebuild

Before rebuilding, generate an aggregate-only readiness artifact:

```bash
yarn --cwd server pathway:quality-audit --sample-limit=0 --output=/tmp/ylabs-pfr3-pathway-quality.json
```

Review `studentPublishablePathways`, `publicationBlockers`, and
`publicationBlockerCombinations`. These counts apply the same status, evidence,
confidence, and source URL gates as publication. A status or evidence blocker is
not permission to promote records: resolve it only from authoritative source
evidence through the normal materialization and review workflows.

Confirm the deployed Beta service has all of the following values from the deployment control plane:

- `SCRAPER_ENV=beta`
- `MONGODBURL` targeting the Beta database
- `MEILISEARCH_HOST` targeting the remote Beta search service, never localhost
- `MEILISEARCH_INDEX_PREFIX` beginning with `beta_`
- `PFR3_MEILI_RESTORE_POINT` naming a verified pre-rebuild snapshot or export

Record the current Pathways index document count and the restore procedure.
Then run:

```bash
yarn --cwd server meili:rebuild-pathways --clear --confirm-meili-rebuild --output=/tmp/ylabs-pfr3-beta-pathways.json
```

The JSON report's `fetchedHitCount` is the qualifying pathway count under the student publication policy, including the `>= 0.70` confidence threshold.
Compare it with the preflight expectation and sample student-visible results before proceeding.
Stop if the count is unexpectedly low or the index prefix in the output is wrong.

## 3. Production rollout

Create and verify a production Pathways index snapshot or export first.
Set `SCRAPER_ENV=production`, an explicit production database, a remote production Meilisearch host, a prefix beginning with `production_`, `CONFIRM_PROD_SCRAPE=true`, and the verified `PFR3_MEILI_RESTORE_POINT` value.
Run the same rebuild command during the approved change window.

Verify index count, settings, representative searches, and application health before closing the change.
If verification fails, stop traffic to the new index, restore the recorded snapshot/export under the production prefix, and repeat the representative searches before restoring normal traffic.

## 4. Outreach monitoring

Run `yarn --cwd server pfr3:outreach-report` after each staged rollout interval.
The report includes consented aggregate counts only.
`officialRouteAttempts` means a student opened an official route, not that an application was submitted.
`confirmedOutcomes` includes only rows with `outcomeReportedAt`; `selfReportedOutcomes` is its external-self-reported subset.
The report never emits student, entity, tracking, or event identifiers and never lists recent events.
