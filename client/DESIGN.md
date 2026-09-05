# Yale Research Design System

This is the source of truth for how Yale Research looks and feels.
It documents the design tokens that already live in `src/index.css` (the `--yr-*` CSS custom properties) and the rules for using them.

Read this before adding or changing any visual styling.
The single most important rule: never introduce a raw color, font, or shadow value.
Reach for a token instead, either the `--yr-*` variable directly or its Tailwind alias.

## 1. Visual Theme and Atmosphere

Yale Research is a calm, editorial, institutional product for undergraduate research discovery.
It should feel like a trustworthy university publication, not a consumer SaaS dashboard.

- Warm paper canvas, not stark white.
- Yale navy as the single brand accent, used sparingly and with intent.
- Serif display type for headings, clean sans for body, generous whitespace.
- Restraint over decoration: few colors, soft borders, one gentle elevation.

## 2. Color Palette and Roles

All colors are defined once as CSS variables in `src/index.css` and aliased into Tailwind in `tailwind.config.js`.
Use the Tailwind alias in `className`, or the raw variable in MUI `sx` and inline styles.

| Role | Token | Tailwind alias | Value |
|------|-------|----------------|-------|
| Brand / primary | `--yr-blue` | `brand` | `#00356b` |
| Brand deep (hover, headers) | `--yr-navy` | `brand-navy`, `ink` | `#0b1f3a` |
| Brand tint (rings, chips, soft fills) | `--yr-blue-soft` | `brand-soft` | `#e6edf5` |
| Secondary / accent | `--yr-gold` | `gold` | `#b89b5e` |
| Secondary tint | `--yr-gold-soft` | `gold-soft` | `#fff7e6` |
| Page canvas | `--yr-page` | `canvas` | `#fbfaf7` |
| Panel surface | `--yr-panel` | `panel` | `#ffffff` |
| Muted panel surface | `--yr-panel-muted` | `panel-muted` | `#f7f3ec` |
| Parchment accent surface | `--yr-parchment` | `parchment` | `#f6f2ea` |
| Body ink | `--yr-ink` | `ink` | `#0b1f3a` |
| Muted text | `--yr-muted` | `muted` | `#5f6570` |
| Hairline border | `--yr-line` | `line` | `#e2e8f0` |
| Strong border | `--yr-line-strong` | `line-strong` | `#cbd5e1` |
| Warm border | `--yr-border-warm` | `line-warm` | `#e7dfd2` |
| Success | `--yr-green` | `success` | `#23705b` |
| Success tint | `--yr-green-soft` | `success-soft` | `#e5f4ee` |

Rules:

- Primary actions are `brand` fill with white text and `brand-navy` on hover.
- Do not use Tailwind's generic `blue-500`, `blue-600`, or `blue-700` palette.
- Those render a Material blue that is not the Yale brand color and is the source of the color drift this system exists to prevent.
- Links and active navigation use `brand`; inactive navigation uses `ink`.
- `brand-navy` is a hover only for something already colored `brand`.
When the resting color is a gray or near-black, hover to `brand`, not to `brand-navy`: `brand-navy` sits 1.07:1 from `text-gray-900`, so that hover is invisible.
- Choose a hover or active color by its distance from that element's own resting color, not by whether it is in the palette.
The same mapping can be right on one element and invisible on another: `line-strong` reads as a hover against a neutral border and sits 1.02:1 from a `line-brand` one.
- A native checkbox or radio takes its checked fill from `accent-*`, not from `text-*`.
This project has no Tailwind forms plugin, so `text-brand` on an `input[type=checkbox]` sets a `color` the control never paints.
Use `accent-brand`.
- Gold is a sparing accent for secondary emphasis, never a second primary.
- A brand-tinted border uses `line-brand` (`--yr-blue-border`), the same tint `.yr-pill-blue` draws.

### Categorical, state, and chart-series colors

The rule above is scoped to **brand color**.
Three cases are not brand color, and for them Tailwind's generic hues are the sanctioned choice:

- A **categorical identity** in a multi-hue palette, where the hue distinguishes one category from its siblings.
- A **position in an ordered state scale**, where the sequence of hues carries the meaning.
- A **chart series color**, where adjacent series must be distinguishable from each other.

Do not convert a single hue out of one of these scales to a brand token.
The scale reads as a set only because its members are siblings, so replacing one member with the brand accent breaks the progression and collides with the brand meaning elsewhere on the page.
Change such a scale as a whole or not at all.

These files hold deliberate scales rather than brand-color drift:
`src/providers/ConfigContextProvider.tsx` (ten-hue category palette and a department-index map), `src/utils/researchPlanStages.ts` (SAVED through APPLIED), `src/utils/fellowshipCycle.ts`, `src/types/browsable.ts`, `src/pages/analytics.tsx`, `src/components/analytics/AnalyticsSupportingDetail.tsx`, `src/components/analytics/analyticsPresentation.tsx`, and `src/components/admin/AdminOperatorBoard.tsx`.

`ROLE_PILL_CLASSES` in `src/components/labs/LabMembersList.tsx` is one of these scales too: twelve member roles across blue, indigo, purple, teal, emerald, amber, and slate, so the blue on `pi` and `co-pi` is a category identity.
Only that map is exempt; the rest of the file is ordinary brand color.
`FIELD_COLORS` in `src/components/admin/AdminResearchAreas.tsx` and `CATEGORY_COLORS` in `src/components/admin/AdminDepartments.tsx` are the same shape: nine research fields across blue, green, yellow, red, purple, pink, teal, orange, and indigo.

The filter-category chips in `src/components/fellowship/FellowshipModal.tsx` are a scale as well: five filter categories across blue, yellow, purple, green, and orange.
Only that one chip is exempt; the rest of the file is ordinary brand color.
So is `accessBadgeClass` in `src/components/accounts/SavedResearchPlans.tsx`, whose three access tones run emerald, blue, and neutral.

Every one of those five scales gives its blue member a tokened background and a scale-hue text color, unlike its siblings, which pair a hue background with the matching hue text.
Four were authored that way in one early commit and the fifth appeared three months later, so this is a recurring habit rather than one historical event: a pass that tokens brand backgrounds reaches scale members as collateral.
Resolve it by changing each scale as a whole, never by tokening the blue member alone.

## 3. Typography Rules

Two families, defined as `--yr-font-serif` and `--yr-font-body` and aliased to Tailwind `font-serif` and `font-sans`.

- Display and section headings (`h1` to `h4`): `Source Serif 4` serif stack (`font-serif`).
- Body, controls, labels, and data: `Inter` sans stack (`font-sans`).
- Body text color is `ink`; secondary and helper text is `muted`.
- Keep line length comfortable for reading; prefer measured column widths over full-bleed paragraphs.
- The `y/labs` wordmark is the one exception to the heading rule: it is set in the `Inter` sans stack at weight 700 with `-0.03em` tracking, matching the `y/cs` mark it derives from.
Always render it through `src/components/Wordmark.tsx` rather than as literal text, so the slash keeps its taller scale.

## 4. Component Stylings

Reusable component classes are defined in `src/index.css` (the `.yr-*` classes) and shared React primitives live in `src/components/shared/`.
Prefer these over ad hoc styling.

- Primary button: `bg-brand text-white hover:bg-brand-navy`, with `.yr-focus-ring` for keyboard focus.
Do not use a `ring-brand-soft` ring for focus.
A Tailwind ring sits at offset 0, so its outer edge is adjacent to the page, where `brand-soft` measures 1.13:1 against the canvas and reads as no focus indicator at all.
- Secondary button: `brand` text on `brand-soft` or panel fill with a `line` border.
- Cards and panels: `panel` surface, `line` border, `shadow-yr` elevation, rounded corners.
- Chips and badges: soft tints (`brand-soft`, `gold-soft`, `success-soft`) with the matching strong text color.
- All interactive controls have a minimum 44px touch target and a visible focus ring.
- Keyboard focus: `.yr-focus-ring` (defined in `src/index.css`) is the canonical focus indicator for interactive controls - a `:focus-visible`-only, brand-tinted outset outline. Use it instead of ad hoc `focus-visible:ring-2 focus-visible:ring-blue-*` clusters.
- Never pair `.yr-focus-ring` with a `focus:outline-none` or `focus-visible:outline-none` utility.
`.yr-focus-ring` lives in `@layer components`, Tailwind utilities come after it, and the two selectors have equal specificity, so the utility wins on source order and silently removes the focus ring.
`.yr-focus-ring` already suppresses the resting outline itself.
- Peer-driven focus: a visually hidden `peer` input whose focus must show on a styled proxy element uses `.yr-focus-ring-peer` on the proxy.
The proxy never receives focus, so `.yr-focus-ring` cannot fire on it.
- Clipped focus: a control whose ancestor clips overflow uses `.yr-focus-ring-inset`, which draws the same outline just inside the border box via a negative `outline-offset`.
`.yr-focus-ring` is invisible there - an `overflow: hidden` parent clips an outset outline away completely, while `getComputedStyle` still reports the outline as applied.
Verify a focus ring by comparing rendered pixels, not by reading computed style.
- `focus:ring-inset` has no effect alongside either class.
It shapes a ring box-shadow, and the canonical indicators are outlines.

## 5. Layout Principles

- Content sits on the warm `canvas`; interactive regions sit on `panel` surfaces.
- Use a consistent max content width and generous gutters rather than edge to edge layouts.
- Group related controls; separate distinct actions with whitespace, not dividers, where possible.
- Sidebars and filter rails are sticky but must never trap content below the fold on short viewports.

## 6. Depth and Elevation

Elevation is deliberately minimal.

- One primary shadow token: `--yr-shadow` (`shadow-yr` in Tailwind), a soft navy-tinted lift.
- Reserve elevation for cards, popovers, and modals; flat surfaces are the default.
- Do not stack multiple heavy shadows or invent new shadow values.

## 7. Do's and Don'ts

Do:

- Use tokens for every color, font, border, and shadow.
- Keep the palette tight: navy brand, gold accent, warm neutrals.
- Match new components to the shared primitives in `src/components/shared/`.

Don't:

- Add raw hex values or Tailwind generic `blue-*` classes for brand color.
- Introduce a third type family or a competing accent color.
- Ship an interactive control without a visible focus state and a 44px target.

## 8. Responsive Behavior

Breakpoints follow the MUI theme values: `sm` 640, `md` 768, `lg` 1024, `xl` 1280.

- Design mobile first; the single-column layout is the baseline.
- Filter rails collapse into disclosures on small viewports.
- Verify layouts at 1280 to 1536px where sticky rails are most likely to overflow.

## 9. Agent Prompt Guide

When an agent builds or changes UI in this repo:

1. Use a token for every color, font, border, and shadow.
Never write a raw hex value or a Tailwind generic `blue-*` class for brand color.
2. Reuse a shared primitive from `src/components/shared/` before writing new markup.
3. Primary action is `bg-brand` with `hover:bg-brand-navy`; navigation active state is `brand`, inactive is `ink`.
4. Every interactive element needs a visible `focus-visible` ring and a 44px minimum target.
5. When a needed value has no token, add the token to `src/index.css` and this document rather than hardcoding it.
6. The accessibility bar is enforced automatically: `expectNoAxeViolations` from `src/testUtils/axe.ts` asserts zero serious or critical WCAG 2.1 AA violations, and canonical student surfaces have rendered-surface a11y suites (`*.a11y.test.tsx`).
Add a surface to that harness when you build a new student-facing surface.
Layout-only checks that JSDOM cannot evaluate (color contrast, rendered target size, and 320/375px overflow) still need a manual visual pass.
