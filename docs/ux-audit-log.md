# UX/UI Audit Log

Last updated: 2026-07-04

Screenshot artifacts from earlier audits were retired on 2026-07-04.
This log keeps the durable findings and fixes; new ad hoc screenshots should live outside `docs/` unless they are explicitly part of a durable product record.

## Session Notes

### 1) `/research` search request ordering and cancellation
- **Observed behavior**
  - Multiple rapid searches (typeahead/query submit/suggestion clicks) could start concurrent research and practical-route requests.
  - A slower earlier request could overwrite a newer result.
- **User impact**
  - Visible result set could jump to an unrelated query, reducing trust and making searches feel unreliable.
- **Root cause**
- Frontend did not gate concurrent in-flight search requests and did not pass request cancellation signals.
- **Severity**
  - High (core discovery flow trust and consistency).
- **Fix implemented**
  - Added request-id tracking and `AbortController` cancellation in `client/src/pages/research.tsx`.
  - Shared helpers now accept optional `AbortSignal`.
  - Home-row metadata fetches now cancel on unmount via per-row controllers.
  - Search now uses request guards so stale responses do not update state.
- **Status**
  - Fixed.

### 2) Retired practical-route search could update from stale payload
- **Observed behavior**
  - Debounced query/filter/search request started without cancellation/ordering guard.
  - In-flight request could resolve after a newer filter/input change and overwrite state.
  - Partial failures could clear visible data with no guard.
- **User impact**
  - Users can see filter state and cards that do not reflect current query/filters.
- **Root cause**
  - No request identity check and no cancellation hook for Axios calls.
- **Severity**
  - Medium to High (high-frequency user action path).
- **Fix implemented**
  - Added request-id tracking + abort controller to the then-active practical-route page. That page has since been retired.
  - Debounced handler now cancels prior in-flight request and ignores stale completions.
  - Loading/error state updates only apply for the active request.
- **Status**
  - Fixed.

### 3) `/research/:slug` detail fetch on slug changes
- **Observed behavior**
  - Fast navigation between slugs could allow prior fetches to complete after slug changes.
- **User impact**
  - Briefly rendered stale details for the wrong profile or transient console warnings during unmount.
- **Root cause**
  - Detail fetch lacked request ordering + cancelation.
- **Severity**
  - Medium (misleading content and stale profile risk).
- **Fix implemented**
  - Added request-id + abort controller guard in `client/src/pages/labDetail.tsx`.
  - Requests are ignored if stale/cancelled; only active slug result updates state.
- **Status**
  - Fixed.

### 4) `/opportunities/:id` detail fetch on id changes
- **Observed behavior**
  - Fast navigation between opportunity IDs could race and show stale opportunity payload.
- **User impact**
  - Content can briefly mismatch route; failure states can also overwrite current id.
- **Root cause**
  - No request guard on single-record fetch.
- **Severity**
  - Medium.
- **Fix implemented**
  - Added request-id + abort controller guard in `client/src/pages/opportunityDetail.tsx`.
  - Cancelled/stale requests no longer update component state.
- **Status**
  - Fixed.

### 5) `/opportunities/:id` detail crash on malformed evidence payload
- **Observed behavior**
  - Some payloads return `evidence` as missing/undefined (or transiently malformed).
  - The detail page attempted to map/filter evidence before the payload was fully guarded.
- **User impact**
  - Page could throw during render after a successful fetch, producing a hard blank page instead of a degraded detail view.
- **Root cause**
  - Frontend assumed `opportunity.evidence` and `opportunity.sourceUrls` were always present arrays.
- **Severity**
  - Medium (single-page failure in a core entry point path).
- **Fix implemented**
  - Normalized evidence and source URL collections with explicit `Array.isArray` checks before render.
  - Rendered evidence sections now use the normalized arrays and show a graceful “no observation records” fallback.
  - Added fallback labels/paths when related research metadata is partially missing.
  - Extended `opportunityDetail` tests for missing evidence payload.
- **Status**
  - Fixed.

### 6) Research search resilience to partial API failures
- **Observed behavior**
  - A failure in either the research endpoint or the practical-route endpoint could still clear the whole search state or hide available results.
- **User impact**
  - Users might see no results even when one endpoint still returns useful data.
- **Root cause**
  - Prior orchestration treated search calls as an all-or-nothing flow; partial success was not preserved.
- **Severity**
  - Medium-High (discovery trust + wasted user action).
- **Fix implemented**
  - Switched `/research` `runSearch` to `Promise.allSettled`.
  - Updated search orchestration to display the successful branch and surface a specific partial-failure message.
  - Added normalization fallback for legacy `hits`-style responses and for legacy `group` detail payloads in `researchEntity.ts`.
  - Added regression tests for partial failure and endpoint fallback behavior.
- **Status**
  - Fixed.

### 7) Pathway card/profile link robustness for partial pathway cards
- **Observed behavior**
  - A malformed pathway hit (missing `researchEntity.slug` / metadata) could cause null access in browse lists.
- **User impact**
  - Rare malformed records could crash cards or render broken links for users.
- **Root cause**
  - UI assumed `researchEntity` existed on every pathway hit object.
- **Severity**
  - Low-Medium (malformed-data resilience).
- **Fix implemented**
  - Added defensive fallbacks in practical-route and `/research` pathway rendering paths for display label and destination URL.
  - Kept missing metadata visible as “Research profile” fallback instead of crashing.
- **Status**
  - Fixed.

### 8) `/research` metadata clustering by mixed department/topic fields
- **Observed behavior**
  - Topic cluster cards sometimes split what users perceive as the same home area into multiple clusters, e.g. both `Neuroscience` and `NEUROSCIENCES` appearing as separate clusters.
- **User impact**
  - Discovery appears noisy and repetitive, especially on `/research`, reducing trust in the category taxonomy and increasing click friction.
- **Root cause**
  - Cluster grouping selected `researchAreas` first and used raw label keys, so mixed data (department + research area on different rows, or case-only duplicates) formed separate buckets.
- **Severity**
  - Medium (core discovery browse clarity; not functional correctness failure).
- **Fix implemented**
  - Updated `buildMetadataClusters` to prefer meaningful `departments` over research areas, then school, then entity-kind fallback.
  - Normalized cluster keys with case/spacing normalization so case-only duplicates do not split clusters.
  - Added cluster source-aware copy (`Shared department:` / `Shared research area:`) in `matchReason`.
  - Added regression tests for department-first grouping and case-normalized department merges.
- **Status**
  - Fixed.

### 9) `/research` clusters should merge near-identical department spellings
- **Observed behavior**
  - Department metadata values like `NEUROSCIENCES` and `Neuroscience` could still produce separate clusters even after department-first grouping.
- **User impact**
  - Users saw duplicated cards that seemed to represent the same discipline and were more likely to question whether the surface was trustworthy.
- **Root cause**
  - Cluster keys were normalized only by casing/whitespace, so a singular/plural variant or trailing-character mismatch still created a new bucket.
- **Severity**
  - Medium (discovery clarity and first-time learnability).
- **Fix implemented**
  - In `client/src/utils/researchDiscoveryAdapters.ts`, `buildMetadataClusters` now uses a department-aware matching fallback:
    - exact department key match first,
    - then fallback to nearby one-character variants (e.g., trailing-singular/plural forms) when a department cluster already exists.
  - Added regression coverage in `client/src/utils/__tests__/researchDiscoveryAdapters.test.ts` for `NEUROSCIENCES` + `Neuroscience`.
  - Status updated to `cluster-first`-resilient for department metadata variants.
- **Status**
  - Fixed.

### 10) `/research` cluster profile links should avoid broken routes on malformed data
- **Observed behavior**
  - Some cluster members render without a `slug`, which previously still attempted `/research/${slug}` and could produce a broken route.
- **User impact**
  - A malformed or partially ingested record could create a misleading click target and reduce trust in results.
- **Root cause**
  - The cluster profile list assumed every entity had a valid `slug` when creating links.
- **Severity**
  - Low to Medium (bad-data resilience in a discovery surface with partial data).
- **Fix implemented**
  - In `client/src/components/research/TopicClusterCard.tsx`, profile rows now guard for missing slugs:
    - no slug: render the name as non-link text with a “Profile link is not available yet.” hint.
    - slug present: keep navigable link behavior as before.
  - Updated test in `client/src/components/research/__tests__/TopicClusterCard.test.tsx` to cover no-slug rows.
- **Status**
  - Fixed.

### 11) Playwright interaction pass for research flows could not run in this environment
- **Observed behavior**
  - We attempted a headless interaction pass against the local frontend for organic-flow validation.
- **User impact**
  - We could not validate click-level behavior, focus order, and real-state flicker with a browser loop from this container.
- **Root cause**
  - Playwright launch in this environment lacks required host libraries (`libnspr4.so` in particular), and `install-deps` is blocked by non-interactive sudo.
  - Exact launch error observed:
    - `/chrome-headless-shell: error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory`
  - Exact dependency install error observed:
    - `sudo: a terminal is required to read the password; either use the -S option to read from standard input or configure an askpass helper`
- **Severity**
  - Process-only risk (verification gap), not product risk.
- **Fix implemented**
  - Added a local, non-admin helper: `scripts/with-playwright-libs.sh`.
  - Updated project scripts:
    - `yarn playwright:run ...` (executes `npx playwright` with locally provisioned shared libraries)
  - Added docs so local verification can run as:
    - `yarn playwright:run screenshot https://example.com /tmp/pw-example.png`
  - Wrapper auto-downloads and caches:
    - `libnspr4`
    - `libnss3`
    - `libasound2t64`
    into `./.playwright-libs` and sets `LD_LIBRARY_PATH` for Playwright launches.
- **Status**
  - Blocker workaround implemented; verification is now possible without interactive root access.

### 12) `/research` was blocked by an unrelated Listings error modal
- **Observed behavior**
  - Using mock auth and opening `/research` triggered a background `/listings/search` request.
  - When that request failed locally, SweetAlert covered the Research page with “Unable to load listings. Please try again later.”
- **User impact**
  - A user trying to explore research gets interrupted by an unrelated Listings failure and has no way to know Research itself loaded correctly.
- **Root cause**
  - `SearchContextProvider` was mounted globally and eagerly fetched listing results on every authenticated route.
- **Severity**
  - High (cross-route modal blocks the primary Research flow and damages trust).
- **Fix implemented**
  - Scoped listing search side effects in `client/src/providers/SearchContextProvider.tsx` to the actual Listings route (`/`) using `useLocation`.
  - `/research` no longer performs the hidden listing request or shows the unrelated modal.
- **Status**
  - Fixed and verified with Playwright.

### 13) `/research/:slug` repeated the same official source link across pathways, evidence, and CTAs
- **Observed behavior**
  - On `/research/center-wu-tsai`, the same Wu Tsai undergraduate initiatives URL appeared repeatedly as `Source 1`, per-evidence `Source`, and official-route CTAs.
- **User impact**
  - The repetition made evidence feel noisy and less trustworthy; users could reasonably wonder whether multiple independent sources existed when the page was really citing one official page.
- **Root cause**
  - Detail sections rendered source links locally without a page-level dedupe pass.
- **Severity**
  - Medium (trust and clarity issue on a core detail page).
- **Fix implemented**
  - Added `client/src/utils/researchDetailSources.ts` to normalize, label, dedupe, and context-tag detail sources.
  - Replaced inline pathway/evidence source links with concise evidence metadata.
  - Added a single Sources section on `/research/:slug` that shows each official source once with the contexts it supports.
- **Status**
  - Fixed and verified with headed Playwright. After verification: no `Source 1` labels, two source-ledger rows, no mobile horizontal overflow.

### 14) Listings load failure used a blocking modal instead of inline recovery
- **Observed behavior**
  - A `/listings/search` failure could trigger SweetAlert with “Unable to load listings. Please try again later.”
- **User impact**
  - The modal interrupted the session and offered no next action beyond dismissal.
- **Root cause**
  - Listing search failures were handled only as side effects in `SearchContextProvider`, not as UI state.
- **Severity**
  - Medium for Listings; High when it appeared during unrelated exploration.
- **Fix implemented**
  - Added `error` to listing search reducer/context state.
  - Removed the blocking SweetAlert for listing search failures.
  - Added an inline recovery banner on `/` with `Retry listings` and `Explore research homes`.
- **Status**
  - Fixed and verified with Playwright by forcing `/api/listings/search` to return 500. No SweetAlert modal appeared; inline recovery rendered.

### 15) `/research` showed duplicate Neuroscience concepts and undersized touch targets
- **Observed behavior**
  - The Suggested searches row showed both `NEUROSCIENCES` and `Neuroscience`.
  - After searching `Neuroscience`, the cluster label was `Neuroscience` but the same concept appeared again as a `NEUROSCIENCES` metadata tag.
  - Mobile chip/button targets were 34px tall, below the common 44px touch target guideline.
- **User impact**
  - The taxonomy looked inconsistent and less trustworthy, especially for the neuroscience department/topic distinction the user flagged.
  - Mobile users had smaller, less forgiving tap targets for the main suggested-search actions.
- **Root cause**
  - Search suggestions and cluster metadata tags deduped raw labels, while cluster grouping used department-aware normalization.
  - Suggested-search and cluster action buttons used compact desktop-style padding on mobile.
- **Severity**
  - Medium (core discovery clarity and mobile ergonomics).
- **Fix implemented**
  - Added normalized suggestion/tag compaction in `client/src/utils/researchDiscoveryAdapters.ts`.
  - Preserved readable casing when merging all-caps and title-case variants.
  - Increased suggested-search chips, cluster profile links, source links, and cluster action buttons to 44px minimum target height.
  - Added regression tests in `client/src/utils/__tests__/researchDiscoveryAdapters.test.ts`.
- **Status**
  - Fixed and verified with Playwright on desktop and 375px mobile.

### 16) `/research` hierarchy exposed clusters before student decisions
- **Observed behavior**
  - The first viewport and searched results used terms like `Clusters`, `Cluster: experimental`, `Cluster: metadata-grouped`, `Profiles in this cluster`, and raw pathway signal labels such as `POSTED_OPENING`.
- **User impact**
  - First-time students had to translate internal grouping mechanics before deciding what to click or trust.
  - The page looked closer to a debug/search prototype than a Yale research discovery surface.
- **Root cause**
  - `/research` mirrored the internal cluster/pathway model instead of the student decision model: research homes first, then best next steps, then evidence.
- **Severity**
  - Medium (core understanding and trust; the search flow still functioned).
- **Fix implemented**
  - Reframed clusters as `Matching Research Homes` and browse rows as `Browse Research Areas` / `Keep Exploring`.
  - Added `ResearchHomeCard` and `PathwayActionCard` so cards lead with research-home context and `Best next step`.
  - Centralized pathway/evidence label mapping in `client/src/utils/researchDiscoveryAdapters.ts`.
  - Made `EvidenceSourceRow` defensive against enum-like source labels.
  - Verified with Playwright across desktop, tablet, and 375px mobile.
- **Residual notes**
  - Shared navbar/footer chrome still has a few sub-44px targets outside the redesigned `/research` content area.
- **Status**
  - Fixed for the `/research` content surface.

## Pending follow-up
- Continue auditing other route/detail flows for similar stale request patterns and malformed-data guard gaps, especially favorites sync and modal deep links.
