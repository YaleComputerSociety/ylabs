# UI/UX Direction

Last updated: 2026-05-15

This document captures the current Yale Research interface direction and the next UX moves. It is grounded in Graphify as the navigation layer, then verified against product docs and implementation files.

## Graphify Grounding

Read [`graphify-out/GRAPH_REPORT.md`](../graphify-out/GRAPH_REPORT.md) before changing this document. The current graph highlights these relevant communities and nodes:

- Community 5: app navigation and shared search/filter context, including `Navbar`, `SearchContext`, and quick filters.
- Community 15: access materialization concepts, including derived access signals and contact routes.
- Community 16: pathway search concepts, including `searchPathwayResults`, `EvidenceStrength`, and `BestNextStepSnapshot`.
- Community 19: shared browse UI, including `BrowseCard`, `BrowseGrid`, and related browsable item views.
- Community 46: research detail access UI, including `LabInquireCard`, `LabHeader`, and `computeAcceptanceVerdict`.

Useful Graphify checks:

```sh
graphify explain "BrowseCard"
graphify explain "LabInquireCard"
graphify explain "computeAcceptanceVerdict"
graphify query "Which UI/product files support the current Yale Research UX, including research browse, detail page, cards, pathways, evidence, and best next step?" --budget 2200
```

Graphify is not canonical. Confirm UX claims against source files, tests, and durable docs before editing product behavior.

## Canonical Product Frame

Yale Research is a research navigation product, not a simple lab-opening board. The UX should help a student move from curiosity to a credible, evidence-backed next step.

The student-facing grammar is:

- **Research**: what exists.
- **Ways In**: how a student might participate.
- **Evidence**: why the route is credible.
- **Best Next Step**: what the student should do next.

Use [`docs/product-context.md`](./product-context.md), [`docs/research-model.md`](./research-model.md), and [`docs/decisions.md`](./decisions.md) when this document conflicts with older lab-first implementation details.

## Current Interface Shape

The current app uses a quiet, operational UI: white backgrounds, gray text, Yale-blue accents, compact cards, filter sidebars, small status chips, and grid/list browsing. This is the right general tone. It should feel like a focused student research tool, not a marketing site.

Current implementation anchors:

- [`client/src/App.tsx`](../client/src/App.tsx): routes `/` as a redirect to `/research`, plus `/research`, `/research/:slug`, `/opportunities/:id`, `/fellowships`, and temporary legacy `/listings`.
- [`client/src/components/Navbar.tsx`](../client/src/components/Navbar.tsx): primary navigation, including Research, Find Fellowships, and Dashboard.
- [`client/src/pages/labs.tsx`](../client/src/pages/labs.tsx): `/research` browse page for labs, centers, programs, faculty research, and related groups.
- [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx): `/research/:slug` detail page.
- [`client/src/pages/home.tsx`](../client/src/pages/home.tsx): temporary `/listings` legacy board for posted roles, not the primary app home.
- [`client/src/components/shared/BrowseCard.tsx`](../client/src/components/shared/BrowseCard.tsx): shared card treatment for listings, fellowships, and research groups.
- [`client/src/components/labs/LabHeader.tsx`](../client/src/components/labs/LabHeader.tsx): research detail header and access verdict.
- [`client/src/components/labs/LabInquireCard.tsx`](../client/src/components/labs/LabInquireCard.tsx): right-rail action/evidence card.
- [`client/src/utils/undergradAcceptance.ts`](../client/src/utils/undergradAcceptance.ts): compatibility adapter translating access evidence into current verdict labels.

## Surface Roles

### `/research`

Purpose: curiosity-first exploration of what exists.

The page should answer: "What research structures are out there, and which are worth opening?"

Primary UX ingredients:

- Search by topic, method, entity name, department, and research area.
- Filter by kind, school, department, research area, and access/evidence status.
- Cards that prioritize entity name, kind, discipline, short description, and compact evidence/pathway signals.
- Avoid making active openings the only success state.

Current gap: the shared verdict adapter now prefers access-summary/pathway evidence, but filters and older labels still contain some "acceptance" and "accepting undergrads" language. Move progressively toward "Ways In," "Evidence," and "Best Next Step."

Research page language rule: `/research` should lead with research homes, evidence, and best next steps. Avoid exposing cluster, version, or metadata implementation labels in primary student-facing UI. Borrow Listings-style scanning only for hierarchy and action clarity; do not make `/research` feel like a job board.

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
- What ways in exist?
- What should I do next?
- What source verifies this?

Primary UX ingredients:

- Header with entity type, department/school, short description, website, and credible access summary.
- A Ways In section before or near active opportunities.
- Evidence section with source-backed snippets.
- A deduped Sources section that shows each official source once and explains which pathways/evidence/routes it supports.
- People section that distinguishes PI, program manager, lab manager, mentor, and other roles where possible.
- A right-rail Best Next Step card with guarded CTAs.

Current gap: the detail page now presents pathways, evidence, best next step, and deduped sources before active opportunities. Research detail pages should keep the source-backed research summary above generated Student Decision / Best Next Step guidance, so faculty research pages do not read like posted openings. The next improvement should reduce duplication between the right-rail route CTA and the main Best Next Step CTA without hiding the action on mobile.

## UX Principles

- **Exploration before application**: a student may be curious before they know the right program, faculty member, method, or funding route.
- **Evidence over assertion**: prefer source-backed snippets, evidence strength, observed dates, and confidence labels over binary claims.
- **Ways in are not postings**: use open/application language only for real posted opportunities.
- **Guarded contact**: do not turn scraped contact details into spam infrastructure. Prefer official routes, applications, program managers, department contacts, and lab managers.
- **Discipline-flexible structure**: humanities, social sciences, collections work, course-credit research, thesis advising, and centers should not be forced into a STEM lab hierarchy.
- **Dense but humane**: the UI should stay scannable and efficient while using warmer student-facing labels.

## Near-Term UX Moves

1. Rename remaining student-facing "acceptance" language toward "access," "evidence," "ways in," or "best next step."
2. Keep ways-in evidence embedded inside research cards and detail pages instead of reviving a separate route.
3. Add a Ways In section to research detail pages before treating active opportunities as the whole story.
4. Keep `/research` cards discovery-oriented, but show compact pathway/evidence hints when available.
5. Keep source visibility centralized on detail pages: evidence cards should explain what was observed, while the Sources section should carry deduped official links.
6. Preserve the current quiet visual style: compact filters, restrained cards, clear typography, and Yale-blue accents.

## Open UX Questions

- Should the home route `/` remain a listings board, or become a role-aware dashboard that points students toward Research, Fellowships, and saved plans?
- Should `/fellowships` stay separate long term, or become a funding/formalization view with a dedicated fellowship detail experience?
- What is the right saved-workflow model: favorites, thesis planning list, outreach plan, funding plan, or multiple lists?
- How much source evidence belongs on cards versus detail pages?
- Should "Best Next Step" be shown as a single computed CTA or as a short ranked action list?
