# PFR-3 Operational Rollout

The pathway search rollout this runbook once staged was removed in issue #363.
Access evidence is now materialized as typed `Signal` rows, browse/discovery runs on the `researchentities` Meilisearch index, and contact is a derived official-profile link-out rather than a stored `ContactRoute`.
See [`docs/research-model.md`](./research-model.md) for the current model.
For Meilisearch rebuilds and the Beta-to-Production promotion, use [`docs/data-refresh-runbook.md`](./data-refresh-runbook.md).

The remaining PFR-3 responsibility is consented outreach monitoring.

## Outreach monitoring

Run `yarn --cwd server pfr3:outreach-report` after each staged rollout interval.
The report includes consented aggregate counts only.
`officialRouteAttempts` means a student opened an official route, not that an application was submitted.
`confirmedOutcomes` includes only rows with `outcomeReportedAt`; `selfReportedOutcomes` is its external-self-reported subset.
The report never emits student, entity, tracking, or event identifiers and never lists recent events.
