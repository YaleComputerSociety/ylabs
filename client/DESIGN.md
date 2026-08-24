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
- Gold is a sparing accent for secondary emphasis, never a second primary.

## 3. Typography Rules

Two families, defined as `--yr-font-serif` and `--yr-font-body` and aliased to Tailwind `font-serif` and `font-sans`.

- Display and section headings (`h1` to `h4`): `Source Serif 4` serif stack (`font-serif`).
- Body, controls, labels, and data: `Inter` sans stack (`font-sans`).
- Body text color is `ink`; secondary and helper text is `muted`.
- Keep line length comfortable for reading; prefer measured column widths over full-bleed paragraphs.

## 4. Component Stylings

Reusable component classes are defined in `src/index.css` (the `.yr-*` classes) and shared React primitives live in `src/components/shared/`.
Prefer these over ad hoc styling.

- Primary button: `bg-brand text-white hover:bg-brand-navy`, with `focus-visible:ring-2 focus-visible:ring-brand-soft`.
- Secondary button: `brand` text on `brand-soft` or panel fill with a `line` border.
- Cards and panels: `panel` surface, `line` border, `shadow-yr` elevation, rounded corners.
- Chips and badges: soft tints (`brand-soft`, `gold-soft`, `success-soft`) with the matching strong text color.
- Focus ring: the canonical keyboard focus indicator is the `.yr-focus-ring` class (a brand-tinted `:focus-visible` outline with offset, defined in `src/index.css`). Use it on interactive controls rather than ad hoc `ring-blue-*` utilities.
- All interactive controls have a minimum 44px touch target and a visible focus ring.
- Keyboard focus: `.yr-focus-ring` (defined in `src/index.css`) is the canonical focus indicator for interactive controls - a `:focus-visible`-only, brand-tinted outset outline. Use it instead of ad hoc `focus-visible:ring-2 focus-visible:ring-blue-*` clusters.

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
