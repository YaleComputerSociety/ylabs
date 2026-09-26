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
- Disabled controls explain why they are disabled, near the control, rather than looking broken.
- Reflect meaningful state in the URL where it aids sharing and back-button behavior.
- Buttons that trigger async work show pending state and cannot be double-submitted.

## Content, loading, and errors

- Every async surface has an explicit loading state and an explicit error state, not a blank frame.
- Use skeletons or spinners consistently; do not let layout jump when data arrives.
- Empty states say what the surface is for and offer the next action.
- Every route sets a meaningful page title.
- Never render placeholder or half-finished content to real users.

## Layout

- Verify alignment on a consistent grid; watch content width and gutters.
- Test the range from 1280 to 1536px where sticky rails can overflow, plus mobile.
- Sticky sidebars must never hide content below the fold on short viewports.

## Forms

- Every input has a real associated label.
- Validate on submit and on blur, with errors tied to their field.
- Support autofill and password managers; do not block paste.
- Submitting is idempotent and keyboard accessible (Enter submits).

## Animation

- Respect `prefers-reduced-motion`.
- Animate compositor-friendly properties (`transform`, `opacity`); avoid animating layout.
- Keep motion short and interruptible; it should clarify, not delay.

## Performance

- Avoid needless re-renders and unbounded lists; virtualize long lists (this repo uses `react-virtuoso`).
- Keep interaction latency low; defer non-critical work.
- Size and lazy-load images; avoid layout shift from late-loading media.

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
