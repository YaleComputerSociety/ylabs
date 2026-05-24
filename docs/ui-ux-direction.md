# UI/UX Direction

Last updated: 2026-05-23

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

- **Yale Labs**: what exists and who is close to a student's interest.
- **Ways in**: compact action signals on research-home results.
- **Saved research plans**: the account/advising layer for saved ways into research homes.
- **Evidence**: why the route is credible.
- **Best Next Step**: what the student should do next.

Use [`docs/product-context.md`](./product-context.md), [`docs/research-model.md`](./research-model.md), and [`docs/decisions.md`](./decisions.md) when this document conflicts with older lab-first implementation details.

The older Research/Pathways split spec has been folded into the roadmap as historical context. The current durable decision is that `/research` is the unified Yale Labs student front door, `/programs` is the Programs & Fellowships surface, and `/pathways` is retired publicly while `EntryPathway` remains the internal action model.

## Current Interface Shape

The current app uses a quiet, operational UI: white backgrounds, gray text, Yale-blue accents, compact cards, filter sidebars, small status chips, and grid/list browsing. This is the right general tone. It should feel like a focused student research tool, not a marketing site.

Current implementation anchors:

- [`client/src/App.tsx`](../client/src/App.tsx): routes `/` as a redirect to `/research`, plus `/research`, `/research/:slug`, `/programs`, `/opportunities/:id`, and account/admin routes. `/pathways` redirects to `/research`; `/fellowships` redirects to `/programs`.
- [`client/src/components/Navbar.tsx`](../client/src/components/Navbar.tsx): primary navigation, including Yale Labs, Programs & Fellowships, and Dashboard.
- [`client/src/pages/research.tsx`](../client/src/pages/research.tsx): unified Yale Labs page for research homes, semantic search, action filters, and pathway-derived ways-in badges.
- [`client/src/pages/fellowships.tsx`](../client/src/pages/fellowships.tsx): Programs & Fellowships page backed by the canonical `/api/programs` API.
- [`client/src/pages/labDetail.tsx`](../client/src/pages/labDetail.tsx): `/research/:slug` detail page.
- [`client/src/components/shared/BrowseCard.tsx`](../client/src/components/shared/BrowseCard.tsx): shared card treatment for listings, fellowships, and research groups.
- [`client/src/components/labs/LabHeader.tsx`](../client/src/components/labs/LabHeader.tsx): research detail header and access verdict.
- [`client/src/components/labs/LabInquireCard.tsx`](../client/src/components/labs/LabInquireCard.tsx): right-rail action/evidence card.
- [`client/src/utils/undergradAcceptance.ts`](../client/src/utils/undergradAcceptance.ts): compatibility adapter translating access evidence into current verdict labels.

## Playwright Current-State Check: 2026-05-23

A local Playwright pass used `http://localhost:4000/api/dev-login` and exercised the current product in desktop and 390px mobile widths.

Observed current state:

- `/research` is the authenticated front door. It renders the Yale Labs title, the `Find a Yale lab that fits you.` H1, search placeholder `Type a topic, professor, lab, method, or research question`, quick-start prompt chips, and a browse baseline of about 2,720 indexed profiles in the current development data.
- Searching `machine learning` returns one research-home stream rather than a Research/Pathways split. Cards show entity name, school/department, topic/method tags such as Machine Learning and Computational Modeling, a concise description, compact ways-in evidence when available, and `View profile` as the main card action.
- Opening the first search result showed a sparse but coherent detail page: entity type, evidence level, `Student decision`, `What this lab studies`, reach-out status, recommended next step, principal-investigator status, source-backed details, missing-profile notes, and source links.
- `/programs` presents Programs & Fellowships as a status-based planner with Open Now, Closing Soon, Likely Next Cycle, and Planning Archive counts, plus official Yale fellowship links.
- `/account` presents Dashboard as the student saved-planning workspace with saved research-plan empty state, program watchlist, and next-up cue.
- Compatibility routes behave as intended: `/pathways` and `/listings` redirect to `/research`; `/fellowships` redirects to `/programs`.
- Mobile checks on `/research`, `/programs`, and `/account` showed the compact header/menu and no horizontal overflow at 390px width.

Docs and future audits should treat this as the current product baseline. Do not add new historical screenshot/report artifacts to the durable docs tree; rerun Playwright when visual evidence is needed instead of relying on stale committed snapshots.

## Playwright UX Findings: 2026-05-15 To 2026-05-17

Earlier desktop Playwright walkthroughs showed that the Research/Pathways split made users choose an implementation concept before searching. The 2026-05-17 unified-search audit covered the replacement loop; the later retirement pass removed `/pathways` as a public client route and moved ways-in summaries directly onto `/research` results.

Findings that should guide the next redesign pass:

- Research's landing page says exploration, but behaves like a department directory. The first major content is a department-based suggested-search strip plus a 105-card department grid, so a student can reasonably ask why this exists if Pathways already has the useful route cards.
- For `machine learning`, Pathways currently gives more complete card-level context than Research because Pathways cards include long research-home descriptions and best-next-step copy. Research needs stronger research-profile previews, not more action cards.
- Department suggested searches are risky as the primary starting affordance. `AMTH - Applied Mathematics` produced an honest coverage-gap state, but as a first click it makes Research feel empty or unreliable.
- `Explore home` in the department grid currently scrolls the wrong container. The app layout uses an inner `[data-scroll-container]`, while the click handler calls `window.scrollTo`, so the user can remain stranded in the department grid after triggering results above.
- `/research/:slug` is the strongest proof of Research's purpose. The detail page explains the research home, people, evidence, ways in, best next step, and sources. Research search and landing should frame profile-opening as the main payoff.

Immediate UX direction from this evidence: make `/research` a research-profile discovery surface, remove department-grid dominance, keep department selection inside the normal filter bar, and make each Research result answer "what does this home study?" before showing any Pathways handoff.

Implemented follow-up: `/research` now starts with curated curiosity prompts such as `machine learning`, `archival research`, and `wet lab`; department filtering lives in the single filter-bar select and still uses exact department filters; Research search cards prefer `Open research profile` when a linked entity exists; action-oriented filters live inside Research; and pathway data appears as ways-in badges rather than a Pathway Preview rail.

2026-05-17 first-time clarity pass: `/research` now states the product promise as finding a Yale research home and deciding the next step, compact research-home cards expose a visible `Open research profile` action, `/account` has a planning-oriented dashboard header, saved empty states point users back to Yale Labs or Programs & Fellowships instead of ending the flow, and `/unknown` setup uses calmer one-minute onboarding copy. The temporary advanced `/pathways` public framing from this pass was superseded later the same day by public Pathways retirement.

Search follow-up: `/research/search` should behave as semantic profile discovery, not a literal department or keyword index. Student-language queries such as `wet lab`, `archival research`, `digital humanities`, `climate policy`, and `social science data` are interpreted into concepts, methods, and expansion queries; ResearchEntity index documents carry semantic text and inferred method/concept signals; and result cards can show a concise "Why this matches" explanation before summarizing available ways in.

2026-05-17 search-first card pass: `/research` now leads with the headline "Find a Yale lab that fits you," a concrete example-driven search placeholder, and a short list of student-intent chips. Research result cards expose department/school context, topic/method tags, a plain-English description when available, and a direct `View profile ->` action. The result stream stays single-column without a separate top-profile preview rail, so students choose from the visible cards instead of being steered to an arbitrary preview.

2026-05-22 compact discovery pass: primary `/research` card streams should prioritize fast comparison over internal provenance labels. Hide raw match reasons and internal data-quality states such as `Summary limited` and `Official Yale source found` from compact result cards; keep evidence/source detail available on `/research/:slug`. On mobile, a student should see more than one research home in the first result viewport when data permits.

2026-05-22 research-backed UI/UX pass: apply recognition-over-recall, clear page location, action hierarchy, and accessible target/focus principles across Yale Research. `/research` now includes visible quick-start prompts under search so students can recognize useful starting points without memorizing terms; document titles now identify the current surface; Programs controls and research-detail/contact CTAs meet the 44px action target used by the app; profile tabs expose tab semantics and selected state; icon-only team/social links carry explicit accessible names. Playwright desktop and mobile audits should continue checking one H1 per page, no horizontal overflow, page-specific titles, and whether flagged small controls are true controls versus inline/equivalent text links.

2026-05-22 route-wide accessibility follow-up: treat 44px as the default minimum rendered size for actionable buttons, icon buttons, links styled as controls, form inputs, and admin edit/pagination controls. Detail overlays that block the page, such as program detail, should expose modal semantics with a dialog role, `aria-modal`, and a title association. Research list cards should avoid nested-interactive semantics: keep real links/buttons as keyboard targets and use body-click only as a pointer convenience.

2026-05-18 browse ordering follow-up: the unfiltered `/research` browse now ranks research homes by source-backed evidence before recency. The default stream should show homes with posted opportunities, access signals, actionable pathways, official Yale sources, and useful profile context before sparse shells; submitted searches and explicit sorts continue through the normal search relevance flow.

## Surface Roles

### `/research`

Purpose: curiosity-first search of what exists.

The page should answer: "I am interested in this topic, method, professor, or department. Which Yale research homes are close, and what evidence-backed ways in exist?"

Primary UX ingredients:

- Search by topic, method, entity name, department, and research area.
- The first landing browse should invite topic, method, professor, and research-question exploration through curated prompts rather than department labels.
- Department selection should live in the filter bar rather than a second browse/grid feature; selecting a department should use exact department filters in the normal `/research/search` flow, not broad free text.
- If a configured department has no indexed research homes yet, show that as a data coverage gap rather than a blank or generic zero-results state.
- Avoid broad filter panels unless the indexed data supports the claim; prefer search, department selection, method/topic matching, and compact ways-in badges over fake precision.
- Cards that prioritize entity name, kind, discipline, short description, why it matches, and compact ways-in signals.
- Research card streams should stay single-column on mobile but use a restrained two-column grid on large screens so the browse and search surfaces use available desktop space without becoming a dense job-board layout. Let grid rows stretch by default so left and right cards in the same row have matching heights.
- Avoid making active openings the only success state.

Current gap: the shared verdict adapter now prefers access-summary/pathway evidence, but filters and older labels still contain some "acceptance" and "accepting undergrads" language. Move progressively toward "Pathways," "Evidence," and "Best Next Step."

Research page language rule: `/research` should lead with research homes, evidence, and ways in. Avoid exposing cluster, version, pathway-preview, or metadata implementation labels in primary student-facing UI. Borrow Listings-style scanning only for hierarchy and action clarity; do not make `/research` feel like a job board.

Research detail layout rule: `/research/:slug` should use the wide desktop canvas for evidence, decision summary, and planning content. Keep mobile single-column, but on large screens use a wide main column with a fixed planning rail when action-oriented routes or planning evidence exist; do not constrain rich detail pages to a narrow centered article.

Mobile detail action rule: on `/research/:slug`, save/open-profile/next-step actions should appear before the long study summary on small screens. The source-backed explanation remains on the page, but the first screen should let a student save the plan, open the official profile, or jump to a linked lead professor without scrolling past all research description content.

### `/pathways`

Purpose: retired public route.

`/pathways` redirects to `/research` for compatibility. Do not restore it as a public student search page. The underlying `EntryPathway` model and pathway search services remain useful internally for ways-in enrichment, research detail, saved research plans, admin review, and data quality workflows.

Current posture: pathway-derived information should appear to students as compact "Ways in," "Evidence," and "Best Next Step" content inside `/research`, `/research/:slug`, and `/account`.

### `/programs`

Purpose: structured application planning, including fellowships, center internships, recurring programs, and summer research programs.

The page should answer: "Which programs and fellowship cycles are open now, which are urgent, and which official past cycles should I track for next year?"

Primary UX ingredients:

- Lead with structured program and fellowship cycle status, not a generic browse board.
- Separate open, closing-soon, likely-next-cycle, and planning-archive records.
- Make next-cycle rows useful without labeling them as currently open applications.
- Keep official Yale links visible for broader program and fellowship discovery.
- `/fellowships` redirects to `/programs` as a temporary compatibility alias.

### `/account`

Purpose: role-aware private workspace.

For students, `/account` remains the saved planning dashboard for research plans, program candidates, notes, deadlines, and checklist progress.

Student account rules:

- The student dashboard should start as one command-center panel, not a hero plus a second summary card.
- The top planning cue should reflect the earliest known saved research-plan or saved-program deadline, not only research-plan reminders.
- Research profiles with indexed `EntryPathway` records should let students save a research plan directly from the decision summary and route the first-save moment back to Dashboard.
- Saved research plans should be compact by default, with notes, checklist, funding matches, and source links shown only after an explicit details action.
- Saved programs should read as a secondary `Program watchlist`, not as a second full planning board on the default student dashboard.
- Saved research-plan and saved-program controls must remain usable on mobile without squeezing titles, notes, or export actions.

For professor/faculty users, `/account` is the faculty profile center. It should answer: "What will students see about my work, and what profile fields should I keep current so outreach is better targeted?"

Professor account rules:

- Lead with public-profile management, not student planning.
- Show profile readiness across department, research interests, bio, and photo without implying every faculty profile must be complete before it is useful.
- Treat saved programs as optional funding/program references, not an application tracker.
- Keep direct routes to both edit view and public profile in desktop and mobile navigation.
- Admin professor mode is a preview of the signed-in admin account; editing a specific professor belongs in Analytics > Faculty Profiles.

### `/profile/:netid`

Purpose: public professor or user profile reached from research detail, account navigation, or direct links.

Profile research-interest rule: public profiles should render source-backed topics as readable deduped chips, not raw scraped taxonomy strings. Split obvious concatenated title-case source fragments before deduping, strip known profile-widget chrome, and keep full research activity as separate cards instead of mixing publications into the interest chips.

Profile navigation rule: profile tabs are part of the user's travel path, not disposable local state. Clicking Research or Courses should write the tab into the URL query so browser back/forward restores the same profile section; Bio can remain the clean default URL.

### `/listings`

Purpose: retired compatibility surface. Direct visits redirect to `/research`, and listing APIs return `410 Gone`. Do not restore Listings to regain simple search UX.

### `/research/:slug`

Purpose: detailed evaluation and action planning.

The page should answer:

- What is this research entity?
- What does it study?
- Who leads it?
- Who might supervise undergrads day to day?
- What methods does it use?
- Have undergrads participated before?
- What pathways exist?
- What should I do next?
- What source verifies this?

Primary UX ingredients:

- Header with entity type, department/school, short description, website, and credible access summary.
- Top-of-page status sections for active opportunities, people, recent papers, and recent research.
- A Pathways section that explains broader ways in after concrete current status is visible.
- Evidence section with source-backed snippets.
- A deduped Sources section that shows each official source once and explains which pathways/evidence/routes it supports.
- People section that distinguishes PI, program manager, lab manager, mentor, and other roles where possible.
- A right-rail Best Next Step card with guarded CTAs.

Current posture: the detail page is organized around student action under uncertainty without repeating the same topic taxonomy in multiple sections. It leads with a decision summary that answers what the research home studies, relevant topics, evidence level, reach-out status, and the recommended next step. Scraped or inferred research profiles must not show "Student fit," "Likely preparation," or topic-derived preparation requirements; those belong only in first-party posted opportunity or verified program requirement contexts. Outreach guidance references the Best fit topics without printing them again. The sparse-profile warning is quieter and framed as source quality rather than the emotional center of the page. Ways-in language is phrased as ways to approach the lab, and sources remain compact supporting evidence.

## UX Principles

- **Exploration before application**: a student may be curious before they know the right program, faculty member, method, or funding route.
- **Evidence over assertion**: prefer source-backed snippets, evidence strength, observed dates, and confidence labels over binary claims.
- **Pathways are not postings**: use open/application language only for real posted opportunities.
- **Guarded contact**: do not turn scraped contact details into spam infrastructure. Prefer official routes, applications, program managers, department contacts, and lab managers.
- **Discipline-flexible structure**: humanities, social sciences, collections work, course-credit research, thesis advising, and centers should not be forced into a STEM lab hierarchy.
- **Dense but humane**: the UI should stay scannable and efficient while using warmer student-facing labels.

## Near-Term UX Moves

1. Rename remaining student-facing "acceptance" language toward "access," "evidence," "ways in," or "best next step."
2. Improve backend-fed ways-in quality on `/research` and `/research/:slug`: add source titles/domains, descriptions, profile links, canonical posted-opportunity dedupe, and paper-level matches so the UI does not have to rely on generic metadata.
3. Keep source visibility centralized on detail pages: evidence cards should explain what was observed, while the Sources section should carry deduped official links.
4. Continue polishing saved planning into one obvious workflow: the Dashboard now has one command-center overview fed by saved research plans and saved programs, direct research-profile saves, compact saved-plan cards with expandable details, and a secondary program watchlist; remaining work should focus on richer advising/export context rather than adding another saved-list model.
5. Preserve first-success feedback on meaningful actions: the first saved research plan or program should point students to the Dashboard plan without turning every save into a noisy notification.
6. Preserve the current quiet visual style: compact filters, restrained cards, clear typography, and Yale-blue accents.

## Open UX Questions

- What is the right saved-workflow model: favorites, thesis planning list, outreach plan, funding plan, or multiple lists?
- How much source evidence belongs on cards versus detail pages?
- Should "Best Next Step" be shown as a single computed CTA or as a short ranked action list?
