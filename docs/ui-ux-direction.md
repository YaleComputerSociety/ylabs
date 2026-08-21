# UI/UX Direction

Last updated: 2026-05-15

This document captures the current Yale Research interface direction and the next UX moves. It is grounded in Graphify as the navigation layer, then verified against product docs and implementation files.

## Graphify Grounding

Start with the scoped Graphify checks below before changing this document.
Run `yarn graphify:ensure` first so the ignored local cache matches the checked-out branch.
Use `graphify-out/GRAPH_REPORT.md` only when a broad architecture review is needed.
Do not record generated community numbers here because they change as the source graph changes.

Useful Graphify checks:

```sh
graphify explain "BrowseCard"
graphify explain "LabHeader"
graphify explain "computeAcceptanceVerdict"
graphify query "Which UI/product files support the current Yale Research UX, including research browse, detail page, cards, pathways, evidence, and best next step?" --budget 2200
```

Graphify is not canonical. Confirm UX claims against source files, tests, and durable docs before editing product behavior.

## Canonical Product Frame

Yale Research is a research navigation product, not a simple lab-opening board. The UX should help a student move from curiosity to a credible, evidence-backed next step.

The student-facing grammar is:

- **Research**: what exists.
- **Planning Context**: what source-backed context helps a student evaluate next steps.
- **Evidence**: why the route is credible.
- **Best Next Step**: what the student should do next.

Use [`docs/product-context.md`](./product-context.md), [`docs/research-model.md`](./research-model.md), and [`docs/decisions.md`](./decisions.md) when this document conflicts with older lab-first implementation details.

## Current Interface Shape

The current app uses a quiet, operational UI: white backgrounds, gray text, Yale-blue accents, compact cards, restrained filter disclosures, small status chips, and grid/list browsing.
This is the right general tone.
It should feel like a focused student research tool, not a marketing site.

Current implementation anchors:

- [`client/src/App.tsx`](../client/src/App.tsx): routes `/` to `/research`, exposes `/research`, `/research/:slug`, and `/programs`, and redirects retired `/listings` and `/fellowships` URLs.
- [`client/src/components/Navbar.tsx`](../client/src/components/Navbar.tsx): primary navigation, including Research, Programs & Fellowships, and Dashboard.
- [`client/src/pages/research.tsx`](../client/src/pages/research.tsx): `/research` browse page for labs, centers, programs, faculty research, and related groups.
- [`client/src/components/research/ResearchFilterDisclosure.tsx`](../client/src/components/research/ResearchFilterDisclosure.tsx): Research search filter disclosure hosting the adaptive school and department facets alongside the always-on research-area multi-select and hosts-undergrads control.
- [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx): `/research/:slug` detail page.
- [`client/src/pages/home.tsx`](../client/src/pages/home.tsx): retained implementation module that is no longer reachable from the retired `/listings` route.
- [`client/src/components/shared/BrowseCard.tsx`](../client/src/components/shared/BrowseCard.tsx): shared card treatment for listings, fellowships, and research groups.
- [`client/src/components/labs/LabHeader.tsx`](../client/src/components/labs/LabHeader.tsx): research detail header and primary profile/status actions.
- [`client/src/utils/undergradAcceptance.ts`](../client/src/utils/undergradAcceptance.ts): compatibility adapter translating access evidence into current verdict labels.

## Surface Roles

### `/research`

Purpose: curiosity-first exploration of what exists.

The page should answer: "What research structures are out there, and which are worth opening?"

Primary UX ingredients:

- Search by topic, method, entity name, department, and research area.
- Narrow results by school, department, research area, and prior undergraduate hosting through one compact Filters control.
- Cards that prioritize entity name, kind, discipline, short description, evidence, source routes, and compact planning-context signals.
- Avoid making active openings the only success state.

Research filter behavior:

- School, department, research-area, and hosts-undergrads selections are URL-backed so reload, sharing, and browser navigation preserve them.
- Active selections appear as individually removable chips, with a clear-all action and an active count on the Filters control.
- The control opens as a non-modal desktop disclosure and an accessible, focus-contained mobile sheet.
- School and department facet choices come from positive counts for the current query, while an active value remains available even if a later distribution omits it.
- The research-area multi-select and the hosts-undergrads control are intentionally always-on rather than facet-gated, because their options come from config (`useConfig().researchAreas`) and server acceptance-level semantics rather than Meilisearch facet buckets.
- Missing, loading, or failed facet metadata must not disable base search, invent counts from total results, or expose hidden focusable controls.
- The retired unsupported undergraduate-evidence control and speculative documented-way-in filters are not revived; the current hosts-undergrads filter instead maps to the evidence-backed server `verified-or-likely` acceptance level.

Current gap: the shared verdict adapter now prefers access-summary/pathway evidence, but filters and older labels still contain some "acceptance" and "accepting undergrads" language. Move progressively toward "Planning Context," "Evidence," and "Best Next Step."

Research page language rule: `/research` should lead with research homes, profiles, evidence, source context, and best next steps. Avoid exposing cluster, version, ways-in counts, or metadata implementation labels in primary student-facing UI. Borrow Listings-style scanning only for hierarchy and action clarity; do not make `/research` feel like a job board.

### `/listings`

Purpose: temporary compatibility surface for professor-created posted roles and old direct listing links.

The page should answer: "Which specific posted roles exist right now?" It should not be the default student home or primary navigation item. Keep it available at `/listings` while professor workflows and saved listing behavior still depend on legacy APIs, but frame it as Posted Roles and point students back to Yale Research.

### `/research/:slug`

Purpose: detailed evaluation and action planning.

The page should answer:

- What is this research entity?
- What does it study?
- Who leads it?
- Who might supervise undergrads day to day?
- What methods does it use?
- Have undergrads participated before?
- What planning context and source evidence exist?
- What should I do next?
- What source verifies this?

Primary UX ingredients:

- Header with entity type, department/school, short description, website, and credible access summary.
- A Ways to approach or planning-context section before or near active opportunities.
- Evidence section with source-backed snippets.
- A deduped Sources section that shows each official source once and explains which pathways/evidence/routes it supports.
- People section that distinguishes PI, program manager, lab manager, mentor, and other roles where possible.
- A constant contact prompt that always offers to email the PI (a prefilled mailto) when an email exists, shown alongside "Open official profile" and source-backed signals, rather than a computed verdict or ranked next-step CTA.

Current gap: the detail page presents the source-backed research summary, evidence, source-verified team context, deduped sources, and saved-plan actions before active opportunities.
The sidebar surfaces evidence as a flat additive signal list and a constant prompt to email the PI, not a computed verdict, evidence-level tier, or ranked next-step CTA, so faculty research pages never gate outreach and do not read like posted openings.

## UX Principles

- **Exploration before application**: a student may be curious before they know the right program, faculty member, method, or funding route.
- **Evidence over assertion**: prefer source-backed snippets, evidence strength, observed dates, and confidence labels over binary claims.
- **Planning context is not a posting**: use open/application language only for real posted opportunities.
- **Contact is constant**: always make emailing the PI easy and never block or discourage outreach; richer source-backed signals make each student's email more specific and targeted, which reduces low-quality mass outreach rather than encouraging it. yLabs should not imply it provides an official outreach channel.
- **Discipline-flexible structure**: humanities, social sciences, collections work, course-credit research, thesis advising, and centers should not be forced into a STEM lab hierarchy.
- **Dense but humane**: the UI should stay scannable and efficient while using warmer student-facing labels.

## Near-Term UX Moves

1. Rename remaining student-facing "acceptance" language toward "access," "evidence," "planning context," or "best next step."
2. Keep ways-in evidence projected as planning context inside research cards and detail pages instead of reviving a separate route.
3. Keep a Ways to approach section on research detail pages before treating active opportunities as the whole story.
4. Keep `/research` cards discovery-oriented, but show compact pathway/evidence hints when available.
5. Keep source visibility centralized on detail pages: evidence cards should explain what was observed, while the Sources section should carry deduped official links.
6. Preserve the current quiet visual style: compact filters, restrained cards, clear typography, and Yale-blue accents.

## Open UX Questions

- Should the home route `/` remain a listings board, or become a role-aware dashboard that points students toward Research, Fellowships, and saved plans?
- Should `/fellowships` stay separate long term, or become a funding/formalization view with a dedicated fellowship detail experience?
- What is the right saved-workflow model: favorites, thesis planning list, research plan, funding plan, or multiple lists?
- How much source evidence belongs on cards versus detail pages?
