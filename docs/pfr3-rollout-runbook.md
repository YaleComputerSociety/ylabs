# PFR-3 Operational Rollout

This rollout is fail-closed and staged.
The review and monitoring commands are read-only.
The pathway rebuild remains the only write operation and requires a verified restore point.

## 1. Admin contact-route review

Run `yarn --cwd server pfr3:contact-route-review` against Beta.
The queue contains only structurally eligible public HTTP(S) destinations and sources, policy, evidence strength, confidence, priority, and current review state.
It excludes approved, archived, direct-email, unknown-policy, and no-direct-contact routes.
It never changes review status and contains no database identifiers, names, email addresses, or evidence excerpts.

An admin must inspect the source and destination, verify the policy, and approve through the existing access-review workflow.
Re-run the queue until the remaining candidates are understood.
Do not bulk-approve.

## 2. Beta preflight and rebuild

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
