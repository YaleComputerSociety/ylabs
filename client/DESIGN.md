# y/labs Design System

This is the source of truth for how y/labs looks and feels.
It documents the design tokens that already live in `src/index.css` (the `--yr-*` CSS custom properties) and the rules for using them.

Read this before adding or changing any visual styling.
The single most important rule: never introduce a raw color, font, or shadow value.
Reach for a token instead, either the `--yr-*` variable directly or its Tailwind alias.

## 0. Principles

These govern how to read the rest of this document, and each one exists because the codebase contradicted a rule written below it.

**A rule with no guard is a wish.**
This file claimed a single shadow token and a serif heading stack.
Both were false in `src/`, one of them from the day it was written, while the brand-color rule held because it is the only one with a CI guard.
So every visual rule here either carries an executable guard or gets deleted.
A documented rule with no guard does not describe the product, it describes an intention, and the gap widens silently.
The three guards are `brandColorGuard`, `elevationTokenGuard`, and `displayTypeGuard`, all in `src/__tests__/`.

**Judge a change on rendered pixels, not on computed style or a class count.**
A blanket serif rule on `h1` through `h4` passed every static check and was visibly wrong: it turned a section kicker into a giant serif banner and inflated small sidebar labels.
It was caught by looking at a screenshot.
This already appears below for focus rings, where an `overflow: hidden` ancestor clips an outline that `getComputedStyle` still reports as applied; it generalizes to everything visual.

**Scope a typographic rule to a class, not to an element selector.**
An element selector does not know intent.
`h2` is a page section on one surface and a metric-tile label on another, so a rule keyed on the tag hits both.
`.yr-display` reaches exactly the headings that mean it, which is also why the rule is now enforceable.

**Hierarchy comes from size, not weight.**
If you reach for `font-semibold` to make something read as important, the real defect is a missing size step.
`font-semibold` appears over 300 times here while 735 of 856 size classes are `text-sm` or `text-xs`, which is what "everything is loud so nothing is" looks like measured.
Add the size step instead.

**Tighten large text, loosen small text.**
Display type takes negative tracking and small caps and labels keep positive tracking.

**Pick a value by its distance from the state it replaces, not by whether it is in the palette.**
Stated below for color, and equally true for elevation and motion: the same token can be right on one element and invisible on another.

**Every interactive element has three steps, not two.**
Resting, hover, and pressed.
Hover alone reads as a picture of a control.

## 1. Visual Theme and Atmosphere

y/labs is a calm, editorial, institutional product for undergraduate research discovery.
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
| Strong secondary text | `--yr-ink-soft` | `ink-soft` | `#35404f` |
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
- A near-black resting color has no hover target further than `brand`, which sits 1.45:1 from `text-gray-900`, and 1.45:1 is the accepted ceiling for that pairing rather than a defect to fix with a new token.
Hover distinguishability has no hard accessibility floor, so the bar here is that the change is perceptible; adding a palette entry further from near-black would buy a little contrast at the cost of a color that is not the Yale brand.
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

The exemption is per construct, not per file.
A file that contains a scale is otherwise ordinary brand color, so exempting the whole file permits real drift inside it.

`src/__tests__/brandColorGuard.test.ts` enforces this table and runs in CI.
It fails on a generic blue in any file with no scale, and on a listed scale changing size, so new drift inside an exempt file is caught rather than covered by the exemption.
When a scale legitimately changes, update the guard and this table together.
The guard checks vocabulary only: it cannot tell whether a color is legible, whether it differs enough from the state it replaces, or whether the property does anything on that element.

Every deliberate scale in the client, and nothing else, is listed here.
Each gives its blue member a generic hue; every other `blue-` class in `src/` is brand-color drift.

| construct | file | scale |
|---|---|---|
| `colorKeyToTailwind` | `src/providers/ConfigContextProvider.tsx` | ten named category colors |
| `departmentColorKeyToTailwind` | `src/providers/ConfigContextProvider.tsx` | nine department indexes |
| `ROLE_PILL_CLASSES` | `src/components/labs/LabMembersList.tsx` | twelve member roles |
| `FIELD_COLORS` | `src/components/admin/AdminResearchAreas.tsx` | nine research fields |
| `CATEGORY_COLORS` | `src/components/admin/AdminDepartments.tsx` | nine department categories |
| `researchPlanStageMeta` | `src/utils/researchPlanStages.ts` | SAVED through APPLIED |
| fellowship cycle badge | `src/utils/fellowshipCycle.ts` | cycle states |
| browsable kind badge | `src/types/browsable.ts` | entity kinds |
| `toneClass` | `src/components/analytics/analyticsPresentation.tsx` | blue, green, amber, red |
| `ACCESS_BADGE_CLASS` | `src/components/accounts/SavedResearchPlans.tsx` | blue |
| filter-category chips | `src/components/fellowship/FellowshipModal.tsx` | five filter categories |

`src/pages/analytics.tsx`, `src/components/analytics/AnalyticsSupportingDetail.tsx`, and `src/components/admin/AdminOperatorBoard.tsx` were previously listed here and should not have been.
Their blue was metric emphasis, links, badges, and focus borders, not series color.
Charts here draw their series from the scales above rather than from a blue in those files.

Every one of these scales gives its blue member a tokened background and a scale-hue text color, unlike its siblings, which pair a hue background with the matching hue text.
Most were authored that way in one early commit and at least one appeared months later, so this is a recurring habit rather than one historical event: a pass that tokens brand backgrounds reaches scale members as collateral.
Resolve it by changing each scale as a whole, never by tokening the blue member alone.

Every one of those five scales gives its blue member a tokened background and a scale-hue text color, unlike its siblings, which pair a hue background with the matching hue text.
Four were authored that way in one early commit and the fifth appeared three months later, so this is a recurring habit rather than one historical event: a pass that tokens brand backgrounds reaches scale members as collateral.
Resolve it by changing each scale as a whole, never by tokening the blue member alone.

## 3. Typography Rules

Two families, defined as `--yr-font-serif` and `--yr-font-body` and aliased to Tailwind `font-serif` and `font-sans`.

- Display and section headings **at `text-2xl` and above**: `Source Serif 4` serif stack, applied through `.yr-display`.
- Everything else, including a smaller heading: `Inter` sans stack (`font-sans`).
This rule used to read "`h1` to `h4`", with no size floor, and no heading in `src/` ever satisfied it.
The blunt version is why: a `h3` card title in a dense browse grid sits at `text-base`, and a serif at that size loses legibility and reads as decoration rather than as editorial voice.
A rule that cannot be applied to every element it names does not get applied to any of them.
The floor is what makes it both correct and enforceable, and `src/__tests__/displayTypeGuard.test.ts` enforces it.
- Apply the serif through `.yr-display`, never through a tag selector.
A tag selector cannot tell a page heading from a metric-tile label; see §0.
- `.yr-display` deliberately declares no `font-weight`.
It sits in `@layer components`, so a `font-semibold` utility on the same element wins on source order and a weight declared there would be silently dropped, the same trap documented for `focus:outline-none` in §4.
Set the weight with a utility at the element, and prefer `font-semibold` over `font-bold`: Source Serif 4 at 700 is heavier than this palette wants.
- Body, controls, labels, and data: `Inter` sans stack (`font-sans`).
- Text takes one of exactly three neutral steps, and there is no fourth.

| step | token | on `canvas` | use |
|---|---|---|---|
| primary | `ink` | 15.83 | body, headings, anything a student reads first |
| strong secondary | `ink-soft` | 10.07 | supporting prose, a label that still has to be read |
| secondary | `muted` | 5.62 | helper text, hints, metadata, a resting icon |

- Do not use Tailwind's generic `gray-*`, `slate-*`, `zinc-*`, or `neutral-*` for text.
`gray-*` is a cool neutral and `slate-*` is blue-tinted, and the canvas is warm, so both are the wrong temperature on it.
Thirteen of them were in use across 692 sites before the scale existed, for the same reason the elevation scale was needed: this table offered two steps and the product has more than two roles, so authors reached outside the palette.
- There is deliberately no step below `muted`.
A fourth step would have to sit between `muted` at 5.62 and the WCAG AA floor of 4.5 for normal text, a band too narrow to be distinguishable from the step above it.
If text seems to need to recede further than `muted`, change its size or its position, not its color.
- `text-gray-400` measured 2.43 on the canvas and was in use at 12 sites, so it failed AA outright.
The axe harness cannot catch that: it runs in JSDOM, which does not evaluate color contrast.
Contrast stays a measured check, so when you add or change a neutral, compute the ratio rather than eyeballing it.
- Choose a hover or state color one step darker than the element's resting step.
A mechanical sweep onto this scale collapsed 9 hover states into their resting value, because `gray-400` and `gray-600` both map to `muted`, and a hover that paints the resting color is a hover nobody can see.
- `src/__tests__/neutralTextScaleGuard.test.ts` enforces all of this in CI: three distinct declared values, no generic neutral text class in a swept path, and no element carrying the same step at rest and on a state.
- The sweep so far covers the student-facing surfaces.
`components/admin`, `components/analytics`, and `pages/analytics.tsx` still hold about 396 generic neutral text classes and are listed in the guard as pending rather than exempt, so widening `SWEPT_PATHS` is how the rest lands.
Generic neutral *background* and *border* classes are likewise still present and are not yet in scope.
- Keep line length comfortable for reading; prefer measured column widths over full-bleed paragraphs.
- Display headings carry `.yr-display`, which tightens tracking to `-0.02em`.
Type set at a display size with default tracking reads as browser default rather than as set type, and it is the highest-signal way a page looks unconsidered.
The unit is `em`, so one value scales with every font size; do not add a second tracking value per size.
Never pair `.yr-display` with `tracking-normal`, which is a utility and therefore wins on source order and zeroes the tracking out.
- Small caps labels and kickers are the opposite case and keep positive tracking (`tracking-wide`, `tracking-wider`).
Tighten large text, loosen small text.
- Figures in a column take tabular widths, so digits do not change width between rows.
Every `<table>` gets this from a base rule; a standalone metric value outside a table needs `.yr-num`.
- Headings get `text-wrap: balance` and paragraphs get `text-wrap: pretty` from base rules, so a heading does not orphan its last word.
Do not re-declare either per component.
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
- A card whose whole surface is clickable does not also get a filled primary button.
The browse card carried three affordances for one destination: a clickable wrapper, a linked title, and a filled navy CTA, so a single viewport showed six filled primary buttons for six cards.
A filled fill means "this is the one action on this surface"; six of them means none of them.
Demote the CTA to a text link in `brand` with the shared arrow, which is what the sibling browse card already did, and anchor it on a `border-t border-line` hairline so the CTA row aligns across a row of cards.
- A forward affordance is an icon, never a typed character.
A literal `→` inherits the font's weight and metrics, so the same affordance rendered at a different size and stroke depending on which card you were looking at.
`components/shared/ArrowRightIcon.tsx` is the only place the arrow path exists, and `src/__tests__/sharedGlyphGuard.test.ts` keeps it that way.
- There is no icon set here: 42 inline `<svg>` elements are hand-rolled across 21 files, so a new glyph has nothing to match and stroke weights cannot be consistent by construction.
Reuse an existing glyph, or extract one to `components/shared/` as `ArrowRightIcon` was, rather than drawing another.
- Every control also has a pressed state, which comes from a base rule on `button` rather than from a component class.
This client has no button component: all of its buttons are styled ad hoc with utilities, and `bg-brand` alone is repeated 30 times, so there is no primitive to put the rule in.
Keying it on the element reaches every button at once, and a call site that wants its own press behaviour still wins, because a utility beats `@layer base`.
Do not add `active:scale-*` at a call site; it duplicates the base rule.
- A `Link` or `a` styled as a control takes `.yr-pressable`, which carries the same rule.
An element selector cannot tell a button-shaped link from a prose link, so this half is opt-in.
A prose link inside a sentence takes `.yr-link` and no press state, even when it carries a 44px touch target.
- The press cue is a 2% scale plus `brightness(0.94)`, and the brightness is the half that matters.
A colour change works against any resting colour, which the scale rule in §2 asks for, and it survives `prefers-reduced-motion`, where the scale is dropped and the brightness is kept.
Removing the press state entirely under reduced motion would leave those users with two steps instead of three.
- `src/__tests__/pressedStateGuard.test.ts` enforces all three: the base rule exists, the reduced-motion block drops the transform without dropping the filter, and no link styled as a control lacks `.yr-pressable`.
Before this, 2 of 135 buttons had a pressed state.
- Keyboard focus: `.yr-focus-ring` (defined in `src/index.css`) is the canonical focus indicator for interactive controls - a `:focus-visible`-only, brand-tinted outset outline. Use it instead of ad hoc `focus-visible:ring-2 focus-visible:ring-blue-*` clusters.
- Never pair `.yr-focus-ring` with a `focus:outline-none` or `focus-visible:outline-none` utility.
`.yr-focus-ring` lives in `@layer components`, Tailwind utilities come after it, and the two selectors have equal specificity, so the utility wins on source order and silently removes the focus ring.
`.yr-focus-ring` already suppresses the resting outline itself.
- Peer-driven focus: a visually hidden `peer` input whose focus must show on a styled proxy element uses `.yr-focus-ring-peer` on the proxy.
The proxy never receives focus, so `.yr-focus-ring` cannot fire on it.
- Clipped focus: a control whose ancestor clips overflow uses `.yr-focus-ring-inset`, which draws the same outline just inside the border box via a negative `outline-offset`.
`.yr-focus-ring` is invisible there - an `overflow: hidden` parent clips an outset outline away completely, while `getComputedStyle` still reports the outline as applied.
Verify a focus ring by comparing rendered pixels, not by reading computed style.
- The clipped-focus rule is about the clipping box *hugging* the control, not about having a scrolling ancestor at all.
A scroll container clips at its padding box, so a control with more intervening ancestor padding than the ring's 4px extent still paints all four edges and keeps the outset token.
Choose inset only when the control sits flush against the clipping edge.
- Inset is the wrong choice on a saturated fill even when the ancestor does clip.
The ring color is `color-mix(in srgb, var(--yr-blue) 72%, white)`, which lands near 2:1 when drawn inside `bg-brand` - painted but invisible, the very defect the token exists to prevent.
An unpadded text or glyph button is the other exclusion: a negative offset strikes the outline through its own glyphs.
- MUI controls cannot take the CSS classes, so they use `navFocusRingSx` from `src/utils/focusRing.ts`, with `menuItemFocusRingSx` for popover menu items whose scroll container would clip an outset ring.
Both share one outline constant with `.yr-focus-ring`; do not hand-roll a `&:focus-visible` block with its own color.
- `focus:ring-inset` has no effect alongside either class.
It shapes a ring box-shadow, and the canonical indicators are outlines.

## 5. Layout Principles

- Content sits on the warm `canvas`; interactive regions sit on `panel` surfaces.
- Use a consistent max content width and generous gutters rather than edge to edge layouts.
- Group related controls; separate distinct actions with whitespace, not dividers, where possible.
- Sidebars and filter rails are sticky but must never trap content below the fold on short viewports.

## 5b. Shape and Radius

Radius is assigned by role, and the roles form an ordering rather than a set of three values.

| role | token | Tailwind alias | value | use |
|---|---|---|---|---|
| control | `--yr-radius-control` | `rounded-control` | `0.375rem` | button, input, select, chip, badge, icon button |
| card | `--yr-radius-card` | `rounded-card` | `0.625rem` | card, panel, callout, any bordered container |
| overlay | `--yr-radius-overlay` | `rounded-overlay` | `0.875rem` | modal, dropdown, popover, menu |

Rules:

- **An inner element is tighter than the box holding it.**
That ordering is the rule; the three numbers are only how it is currently expressed.
A control inside a card reads as sitting in it, and a control as round as its card reads as floating on it.
- Do not use Tailwind's generic `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, or `rounded-2xl`, and do not use a bare `rounded`.
A bare `rounded` is 0.25rem and means "no radius was chosen"; it was at 28 sites in the swept paths.
`rounded-full` is still correct for a capsule or an avatar, and `.yr-pill` already sets it.
- The defect this replaced was not too many values, it was no role assignment.
The identical card construct, a hairline border over the panel surface, was written with `rounded-md` 37 times and `rounded-lg` 34 times, so one component rendered at two radii essentially at random.
Separately the operator surfaces put inputs at `rounded-lg`, the container radius, which is the inversion the ordering exists to prevent.
- Never put a radius utility on a `.yr-pill`, including a bare `rounded`.
`.yr-pill` sets its capsule radius in `@layer components`, so the utility wins on source order and squares the pill off, the same layer-order trap recorded for `focus:outline-none` in §4.
13 elements were doing this and they were two different things, which is why the count mattered more than the symptom.
- 11 were dense chips carrying `min-h-0 rounded`, overriding both the capsule and the pill's min-height.
That is a real variant and it meant it, so it is now `.yr-pill-compact`, which states the intent and takes its radius from the control step rather than an arbitrary 4px.
An ad hoc override cannot be told apart from a bug; a named variant can.
- The other 2 were full-size pills carrying `rounded-md`, inconsistent with every other full-size pill, and were simply wrong.
- If a pill needs to be shorter, use `.yr-pill-compact`; never reach for `min-h-0`.
- Radius cannot be centralised into `.yr-card` or `.yr-panel`, because call sites also pass a `rounded-*` utility and the utility wins.
The alias at the call site is the mechanism; the component class is not.
- A native checkbox ignores `border-radius` entirely, because the browser paints the control.
`rounded-control` on one is inert rather than wrong, which is consistent with §2 on `accent-*` owning its appearance.
- `src/__tests__/radiusScaleGuard.test.ts` enforces this section, and its first assertion is the ordering rather than the values, so changing a number is allowed and inverting the scale is not.
The card and pill assertions run over the whole tree, because both are recognisable by structure rather than by path.

## 6. Depth and Elevation

Elevation is a four-step scale, and the step is chosen by what the surface *is*, not by how much lift looks nice.

| Step | Token | Tailwind alias | Use |
|------|-------|----------------|-----|
| Raised | `--yr-shadow-raised` | `shadow-yr-raised` | A resting card or content panel with a border. The default. |
| Lifted | `--yr-shadow-lifted` | `shadow-yr-lifted` | A panel that floats above the canvas, and the hover state of an interactive card. |
| Overlay | `--yr-shadow-overlay` | `shadow-yr-overlay` | A dropdown, popover, menu, or the skip link. |
| Modal | `--yr-shadow-modal` | `shadow-yr-modal` | A dialog or full-screen overlay. |

Rules:

- Reserve elevation for cards, popovers, and modals; flat surfaces are the default.
- Do not use Tailwind's generic `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`, or `shadow-2xl`.
Those are untinted black at low opacity, which reads as grey haze over the warm `canvas` rather than as lift.
Every step above is tinted with `--yr-navy` so the shadow belongs to this palette.
- Each step is two layers, a tight contact shadow plus a diffuse one.
A single blurred layer is what makes a shadow read as a generic drop shadow rather than as light.
Do not collapse a step to one layer, and do not stack two steps on one element.
- Prefer the `.yr-card`, `.yr-card-interactive`, `.yr-panel`, and `.yr-menu` component classes, which already carry the right step, over applying the alias directly.
- `src/__tests__/elevationTokenGuard.test.ts` enforces this section and runs in CI.
It fails on a generic Tailwind shadow class anywhere in `src/`, on an elevation token that is not two navy-tinted layers, and on a `box-shadow` in `index.css` that does not route through a token.
Like the brand-color guard, it checks vocabulary only: it cannot tell whether a given surface picked the right step.
- `--yr-shadow` and `shadow-yr` were a single token that `src/` never used, while five hand-rolled shadow values and 49 generic Tailwind shadows accumulated around it.
A one-token rule cannot survive four genuinely different surface kinds, so the scale is the fix and adding a fifth step is not.

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
