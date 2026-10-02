---
name: frontend-polish
description: Read before building or changing any client UI in this repo. A polish and quality bar for interactions, accessibility, layout, forms, performance, and visual design, distilled from the Vercel Web Interface Guidelines and grounded in this repo's design tokens. Pairs with client/DESIGN.md, which owns the visual token system.
---

# Frontend polish and quality bar

Apply this bar to any client UI work.
`client/DESIGN.md` owns the visual system (colors, type, tokens); this skill owns behavior and polish.
When something clearly looks or feels off, fix it, do not ship around it.

## Visual system

- Use a design token for every color, font, border, and shadow. See `client/DESIGN.md`.
- Never use Tailwind generic `blue-*` classes or raw hex for brand color. Use `bg-brand` / `text-ink` / `--yr-*`.
- Reuse a shared primitive from `client/src/components/shared/` before writing new markup.

## Which skill owns what

This file owns **how a surface behaves and renders**: interaction states, accessibility, layout, forms, performance.
`skills/interaction-design/SKILL.md` owns **what the surface should carry and in what order**, which is a different question and is not enforceable by a guard.
`client/DESIGN.md` owns the tokens and scales.

A surface can clear every bar in this file and still fail to answer the question the student arrived with.
Read the interaction-design skill first when the change is about content or ordering rather than rendering.

## Does not look machine-generated

The rest of this skill is a correctness bar, and a surface can pass all of it and still read as generically AI-generated.
That is a separate axis and it needs its own checks.
These are the tells that have actually been measured in this client, so check each one against your diff rather than trusting that the tokens cover it.

- **Tighten display type.** A heading at `text-3xl` or larger takes `.yr-display`. Default tracking at display size is the single strongest tell. Small labels go the other way and keep `tracking-wide`.
- **Let size carry hierarchy, not weight.** Reaching for `font-semibold` to make something look important, on a surface where everything is already `text-sm`, produces a page of uniformly loud small text. Change the size.
- **Use the elevation scale, never a generic Tailwind shadow.** `shadow-md` is untinted black and reads as grey haze on the warm canvas. See `client/DESIGN.md` §6.
- **Vary radius by nesting.** A control inside a card should be tighter than the card. Uniform `rounded-md` on every box is a tell.
- **Figures align.** Numbers in a column are tabular. Tables get this from a base rule; a standalone metric needs `.yr-num`.
- **Pressed state, not just hover.** An interactive card or button needs an `:active` that moves, or it feels like a picture of a button.
- **Sentence case in headings and labels**, not Title Case On Every Header.
The `/programs` quick filters, board section titles, cycle badges, and program modal headings are held to it by `fellowships.test.tsx` and `FellowshipModal.test.tsx` (#4273).
- **No em dash anywhere**, per `AGENTS.md`. Plain hyphens.
- **Real copy and real data.** No Lorem Ipsum, no "Acme", no `99.99%`, no `Jane Doe`. No "Elevate", "Seamless", "Unleash", "Next-Gen". No `Oops!` and no exclamation mark in a success message: "Connection failed. Please try again."
- **No three equal cards** as a feature row, and no equal-height cards forced by flex when the content length varies.
- **Icons come from the set.** `client/src/components/shared/icons.tsx` owns every glyph, at one viewBox and one stroke weight. Reuse one; if you need a new glyph, add it there. Never draw an SVG inline, which is how the same affordance ended up with two drawings at three stroke widths.
- **Align shared elements across siblings.** Titles, values, and buttons in a row of cards should land on the same baseline, and a card's action pins to the bottom.

Two upstream collections are the source for this section: the AI-tells list in `leonxlnx/taste-skill` and the audit checklist in its `redesign-skill`.
Both are written for marketing pages, so their aesthetic prescriptions do not apply here.
Where one contradicts `client/DESIGN.md`, `DESIGN.md` wins: it bans Inter as a body font and bans serif outside editorial work, and this product deliberately uses both.
Take the tells, not the taste.

## Interactions

- Every interactive element has a visible `focus-visible` state and a minimum 44px touch target.
- Full keyboard access: nothing is reachable only by mouse or hover.
- Pages scroll inside `[data-scroll-container]`, not the document, so PageDown and Space only work while focus is inside it.
`ScrollToTop` moves focus to `#main-content` (with `preventScroll`) on every client-side push or replace navigation, and on back navigation when nothing holds focus.
A page that wants focus somewhere else after a route change sets it in its own mount effect, which runs after that and wins.
- `[data-scroll-container]` is `relative` so it is the containing block for every absolutely positioned descendant, `sr-only` text included.
Without it, such an element resolves against the viewport, escapes the scroller's clip, and grows the document past the window, so a wheel at the end of the page scrolls the whole shell out of view (#4136).
The student-journey smoke asserts the document never outgrows the window.
- Never move focus on the initial document load, so the first Tab reaches the skip link and a screen reader starts where the browser puts it.
Instead, `ScrollToTop` moves focus to `#main-content` at the moment a page-scroll key (PageDown, PageUp, Space, the vertical arrows, Home, End) is pressed while nothing holds focus, so the browser's own scroll for that key lands in `[data-scroll-container]`.
It stops at the first pointer press, because a click gives the browser its own scroll origin and the keys then belong to whichever inner panel was clicked.
- Disabled controls explain why they are disabled, near the control, rather than looking broken.
- Reflect meaningful state in the URL where it aids sharing and back-button behavior.
- Buttons that trigger async work show pending state and cannot be double-submitted.
- A control that switches between panels is a tablist, not a row of plain buttons.
Use `client/src/hooks/useRovingTabs.ts` for the selected tab and arrow, Home, and End roving focus, and give each tab `role="tab"`, `aria-selected`, `aria-controls`, and a matching `role="tabpanel"`.
`client/src/pages/dashboard.tsx` and `client/src/components/admin/AdminPanel.tsx` are the reference uses.
A strip that can outgrow a 320px viewport scrolls in its own `overflow-x-auto` region so the page never scrolls sideways.
A tab strip inside a fixed-width popover wraps instead, because a scrolled strip there cuts a tab at the edge: the `/programs` filter tabs were clipped at 340px until they wrapped, and the student-journey smoke fails when a tab runs past the popover.

## Content, loading, and errors

- Every async surface has an explicit loading state and an explicit error state, not a blank frame.
- Use skeletons or spinners consistently; do not let layout jump when data arrives.
A summary row's shape is fixed before data arrives, never derived from it: the `/programs` status tiles once added a tile per non-empty optional section, so a loaded board grew a row at 375 and 768px and widened every column at 1440px (#4356).
They are now the four timing tiles at every load state, and the other sections keep their counts in their own headers.
The student-journey smoke holds the first programs search until the loading tiles paint, then fails when the page shifts by 0.01 or more once the data arrives at 375, 768, or 1440px.
- A fetch keyed on a selection, filter, or search must never let an older response overwrite a newer one.
Take a ticket from `client/src/hooks/useLatestRequest.ts`, pass its `signal`, and gate every state write, including the one in `finally`, on `isCurrent()`.
Clear state that belongs to the previous selection in the same handler that changes it, and reset the page or offset in the same state update as the filter change, never in a later effect.
Debounce free-text search inputs with `client/src/hooks/useDebouncedCallback.ts`.
- A search effect never lists a "has loaded" flag that it also sets, because the flag change re-runs the effect and sends the same request again.
`/programs` sent three identical first-page searches per visit that way, and the third cleared a load error mid-flight so the error panel flipped to "0 results" and back (#4265).
Key a search on its request identity instead: `FellowshipSearchContextProvider` compares the built URL with the last one it sent, so only a real change in query, filter, or sort searches again.
- A failed load stays an error until the student acts or a retry succeeds, and a count or tile with no data behind it shows a placeholder rather than a zero.
The student-journey smoke counts first-page program searches per visit and fails when the load error disappears for a frame with no input.
- Empty states say what the surface is for and offer the next action.
- Every route sets a meaningful page title.
- Never render placeholder or half-finished content to real users.

## Layout

- Verify alignment on a consistent grid; watch content width and gutters.
- Test the range from 1280 to 1536px where sticky rails can overflow, plus mobile.
- Sticky sidebars must never hide content below the fold on short viewports.
- Public pages paint before the session check answers, so UI that mounts only for a resolved session must not land above content that is already painted.
Reserve its slot when every viewer needs it, or place it where nothing follows it.
The `/research` operator controls sit at the bottom of the wide-layout sidebar, and inside the closed "Filters" panel on narrower layouts, for this reason.
On narrower layouts the "Filters" trigger badge counts the active operator controls too, so a reordered or filtered list is never silent.
Copy that differs by persona shares one slot: the `/research` guest notice and its signed-in counterpart are stacked in the same grid cell with the inactive one `invisible`, so the slot is as tall as the longer copy for every viewer and the session answer never resizes it (#4222).
On the wide layout that slot is the last thing in the sticky sidebar and shows only to a known guest, because the sidebar must fit a 1280x720 viewport without its own scrollbar and nothing sits below the slot for a late answer to move.
The student-journey smoke holds the session check until browse has painted, counts only the layout shifts after it answers for an admin and for a signed-in student at 1280, 768, and 375px, and fails at a CLS of 0.1; first-paint shifts are excluded because their size depends on frame timing, which once doubled the total (#4169).
- `main` is at least as tall as `[data-scroll-container]` (`min-h-full`), so the footer starts below the fold on every route and a lazy route's chunk and data arriving never push it out of view.
The footer shift this removed scored 0.094 on `/about` at 1440px and 0.159 at 375px; the smoke fails when a lazy route paints the footer inside the viewport while it loads.
- A bar pinned with `sticky top-0` inside `[data-scroll-container]` must reserve its height as the scroller's `scroll-padding-top`, or a keyboard focus scrolled into view lands under it (WCAG 2.4.11).
`ResearchStickyFilterBar` does this by writing its measured height to `--yr-sticky-filter-bar-height`, which `index.css` reads; reuse that pattern for any new sticky bar.

## Forms

- Every input has a real associated label.
- Validate on submit and on blur, with errors tied to their field.
- Support autofill and password managers; do not block paste.
- Submitting is idempotent and keyboard accessible (Enter submits).

## Animation

- Respect `prefers-reduced-motion`.
- Take a scripted scroll's `behavior` from `scrollBehavior()` in `client/src/utils/scrollBehavior.ts`, never a literal `'smooth'`, because a scripted value overrides the stylesheet's reduced-motion rule; `client/src/__tests__/scrollBehaviorGuard.test.ts` enforces it.
- Animate compositor-friendly properties (`transform`, `opacity`); avoid animating layout.
- Keep motion short and interruptible; it should clarify, not delay.
- A wrapper that holds other content, a route or a list, animates `opacity` only, never `transform`, `filter`, or `perspective`.
Any of those makes the wrapper the containing block for every `position: fixed` descendant, so a modal opened during the animation is centred in the whole page and then jumps to the viewport when the animation ends.
The route fade's `translateY(6px)` did exactly that to a deep-linked program modal, which scored a dialog layout shift near 1.0 at every width until the fade became opacity-only (#4264).
`client/src/__tests__/routeFadeGuard.test.ts` holds the route fade to it, and the student-journey smoke fails when a deep-linked program dialog shifts by 0.01 or more at 375, 768, or 1440px.

## Performance

- Avoid needless re-renders and unbounded lists; virtualize long lists (this repo uses `react-virtuoso`).
- Keep interaction latency low; defer non-critical work.
- Size and lazy-load images; avoid layout shift from late-loading media.
- Keep the entry chunk to code the default first load runs.
`/research` is the only eager content page (the tiny root redirect and not-found page stay eager too); every other page in `client/src/App.tsx` is a `React.lazy` behind the shared `Suspense` fallback, and a library that only runs on a failure path or behind a lazy route is fetched at its call site (`utils/warningDialog.ts`, which loads the shared `utils/appDialogs.tsx` dialog on first use, and the deferred SDK load in `utils/errorTracking.ts`).
`client/src/__tests__/entryChunkGuard.test.ts` runs a real Vite build and fails when one of those returns to the emitted entry chunk, because a reviewer cannot see a chunk boundary in a diff.
Take a number from the build (`yarn --cwd client build` prints per-chunk raw and gzip sizes) rather than from the module count.

## Accessibility harness

- The accessibility bar is enforced in the test suite, not just by review: `expectNoAxeViolations` from `client/src/testUtils/axe.ts` (backed by `axe-core`) asserts zero serious or critical WCAG 2.1 AA violations.
- Canonical student surfaces have rendered-surface a11y suites named `*.a11y.test.tsx` that assert conformance in loaded, empty, and error states. Add your new student-facing surface to that harness.
- The harness runs in JSDOM, so it catches DOM and ARIA defects (missing names, unassociated errors, invalid ARIA, bad landmark or heading semantics) but cannot evaluate color contrast, rendered 44px target size, or 320/375px overflow. Those stay a manual visual pass.

## Verify before finishing

- Render the change in the running app and check it at desktop and mobile widths.
- Check the console for errors and warnings.
- Confirm keyboard navigation and focus order.
- Add or extend a `*.a11y.test.tsx` suite for any new or changed student surface, and run it.
- Re-read `client/DESIGN.md` do's and don'ts against the diff.

## Upstream drift, measured 2026-09-26

This file tracks the Vercel Web Interface Guidelines (`vercel.com/design/guidelines`).
Upstream has grown since this was written, and the items below are in the current guidelines, absent from this file, and measured against `client/src` on the date above.
Each is a real gap rather than a copy of the upstream list.

- **A spinner needs an anti-flicker delay**: show after roughly 150 to 300ms, then stay for 300 to 500ms.
Neither `LoadingSpinner` nor `InfiniteScrollLoadingDots` has one, so a fast response makes the spinner flash.
- **In-progress and follow-up labels end in a real ellipsis character**, not three periods.
29 user-visible strings use `...`, including `Searching...`, `Submitting...`, and `Saving...`, against 2 uses of `…` in the whole client.
- **`touch-action: manipulation`** suppresses the double-tap zoom delay on mobile, and **`webkit-tap-highlight-color`** controls the tap flash.
Neither appears anywhere.
- **`scroll-margin-top`** on any heading an anchor targets, or the heading lands under a sticky header.
There are 5 `href="#..."` anchors and no `scroll-margin`.
- **`translate="no"`** on brand names, code tokens, and identifiers, or browser translation mangles them.
The `y/labs` wordmark and the slug and netid strings carry none.
- **`color-scheme`** so scrollbars and native controls render correctly.
Not set. This product is light-only, so the value is small but not zero.
- **Bind units and short names with `&nbsp;`** so they do not break across lines. No uses.
- **Upstream now prefers APCA over WCAG 2 for contrast judgements.**
The contrast work in this repo used WCAG 2 ratios throughout, which is the stricter and more conservative choice, so this is a note rather than a defect.
- **A hover, active, or focus state should exceed the resting state's contrast.**
`client/DESIGN.md` §2 argues this for colour and `neutralTextScaleGuard` enforces it for the neutral scale; upstream states it as a general rule.

Five things were checked and are **not** gaps, recorded so nobody re-audits them:

- Student-facing text inputs are already 16px or larger, so iOS Safari does not zoom on focus.
The 32 controls at `text-sm` are all on operator surfaces.
- Navigation is not implemented on a `<button>`.
The card buttons in `BrowseCard` and `BrowseListItem` open a modal, which is correct for a button, and `ResearchHomeCard`'s clickable wrapper is backed by a real `<Link>` on the title.
- Trust-tier chips and "Show weakest profiles first" are behind `{isAdmin && ...}`, so operator vocabulary is not exposed to students.
- The undergraduate access signal is designed and implemented on the card, with label mapping, priority ordering, and elevated styling.
Whether it ever renders is a corpus-coverage question, tracked in `skills/interaction-design/SKILL.md` §8.
- 44px targets and `:focus-visible` rings are enforced repo-wide by `focusRingGuard` and `client/DESIGN.md` §4.

Reference: the Vercel Web Interface Guidelines (`vercel.com/design/guidelines`) are the upstream source for this bar.
Re-check them when this file is next substantially edited, and record the date, because the drift above accumulated silently.
