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

Reference: the Vercel Web Interface Guidelines (`vercel.com/design/guidelines`) are the upstream source for this bar.
