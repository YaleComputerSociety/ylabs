---
name: interaction-design
description: Read before deciding what goes on a surface, in what order, and how a student gets from not knowing what they want to a lab they could join. The decision layer above client/DESIGN.md and skills/frontend-polish/SKILL.md, which own how things render rather than what to put there. Grounded in information foraging theory, Nielsen's heuristics, and Shneiderman's rules, and calibrated against this product's own surfaces.
---

# Interaction design

`client/DESIGN.md` owns the visual system and `skills/frontend-polish/SKILL.md` owns the polish bar.
Both are about rendering.
Neither says anything about whether a surface answers the question the student arrived with, and a surface can pass every guard in this repo and still fail that.

This skill is the decision layer.
Read it before adding a surface, changing what a card carries, changing the order of anything a student scans, or adding a filter.

## 1. The student's question is the specification

The product's job is to move an undergraduate from "I am interested in something like neuroscience" to "here is a lab I could plausibly join, and here is how I would ask".
Every surface either advances that or does not.

The single most useful test on any change: **after this change, is the student closer to knowing whether they could join this specific group?**
A change that improves consistency, contrast, or polish without moving that needle is maintenance, which is fine, but do not mistake it for product work.

## 2. Information scent is the thing a card is for

Information foraging theory (Pirolli and Card; NN/g's summary at `nngroup.com/articles/information-scent/`) says a user estimates, before clicking, how likely a result is to answer their question and how much effort the click will cost.
That estimate is **information scent**, and it is built from the label, the summary, and the surrounding context.

This is the frame for every complaint that a card "looks thin".
A thin card is not a styling problem.
It is a card whose content does not let the student predict what is behind it.

Consequences for this product:

- **Scent is relative to the forager, not absolute.**
A department name has strong scent for someone who knows Yale's departments and weak scent for a first-year who does not.
Design for the person who does not yet know the vocabulary, because the person who does can already navigate.
- **A summary must add to the title, never restate it.**
A card reading "Wu Lab" over "Studies single cell pattern formation" carries scent.
A card reading "Wu Lab" over "A research lab at Yale" carries none and costs the same space.
- **Never rely on context the mobile view drops.**
NN/g's example is a link labelled "Christmas" that only works beside a heading the phone does not show.
Here the equivalent is a chip or a subtitle that only disambiguates when the filter rail is visible.
- **Vague labels are the classic scent killer**: "More", "Learn more", "View details".
Prefer a label naming the destination.
- **Clickbait spends trust to buy a click.**
A card that promises undergraduate access and leads to a page with no such evidence costs the next click too.
This is the interaction-design reason the visibility gate exists, not just a data-quality reason.

## 3. Match the student's vocabulary, not the corpus's

Nielsen's second heuristic is the match between the system and the real world: use the audience's words and order information the way they expect.

This repo has an unusually strong version of this hazard, because its internal vocabulary is precise and public-facing at the same time.
`student_ready`, `limited_but_safe`, `operator_review`, `suppressed`, `materializer`, `observation`, `lane` are all load-bearing internally and meaningless to a sophomore.
`docs/glossary.md` holds the internal definitions; the point here is the opposite direction.

- Operator vocabulary stays behind an operator gate.
The trust-tier chips and "Show weakest profiles first" on `/research` are correctly behind `{isAdmin && ...}`; keep new operator affordances there.
- When a student-facing word has to carry an internal concept, pick the student's word.
"Has hosted undergrads" is the student's phrasing of an access signal; `CURRENT_UNDERGRADS` is not.
- `AGENTS.md` already retires "research home" and "research area" for plain directory language.
That rule is this principle applied once; apply it again whenever a new label is invented.

## 4. Recognition over recall, and the cost of choosing

Nielsen's sixth heuristic and Shneiderman's eighth rule both say the same thing: do not make the student carry information between screens.
Working memory holds roughly four to seven chunks (Miller's Law, and the more modern estimate is lower).

- Anything a student needs in order to compare two labs must be visible on both cards at once.
If they have to open both and remember the first, the comparison surface is the fix, not a better card.
- **Hick's Law**: decision time grows with the number and complexity of options.
Every filter added to the rail costs every student a little, and pays back only the students who use it.
- Before adding a facet, check NN/g's test (`nngroup.com/articles/filters-vs-facets/`): faceted navigation costs interface work *and* metadata on every row forever, so confirm the dimension is one students actually sort by.
A facet that matches a dimension the corpus can populate but students do not care about is pure cost.
- **Serial position effect**: first and last items in a list are remembered best.
This is an argument for ranking, and an argument against burying the access signal in the middle of a card.

## 5. Closure, reversibility, and dead ends

Shneiderman's fourth rule asks for dialogs that yield closure: a beginning, a middle, and an end, with the end acknowledged.

- A student who saves a research plan should be told the plan is saved and shown what happens next.
Saving that silently succeeds leaves the task open, and the Zeigarnik effect means an unresolved task keeps costing attention.
- Shneiderman's sixth rule and Nielsen's third: give an obvious way back.
Every filter is reversible, and the reversal has to be as reachable as the application.
- **No dead ends.**
Every surface, including an empty result set and an error, offers a next step.
`ResearchZeroResultRecovery` is this principle implemented; treat it as the pattern rather than the exception.

A caution specific to this product.
That component tells the student "This is a data coverage gap, not proof that the department has no undergraduate research."
That is honest, and honesty is usually right, but it is an unverified bet that admitting incompleteness builds more trust than it costs.
It is exactly the kind of claim only user testing settles, so do not treat the current copy as proven.

## 6. Jakob's Law: be boring where it does not matter

Users spend nearly all their time in other products and expect yours to work the same way.
Novelty in a directory's core mechanics is a cost with no upside.

- A search box searches on Enter.
A result card opens on click, and on modifier-click opens in a new tab, which means navigation is an `<a>` or a `<Link>` and never a `<button>`.
- A clickable card whose real affordance is a link inside it is acceptable and common; a clickable card with no link inside it is not, because keyboard and modifier-click both lose.
- Spend novelty budget on the thing only this product can do, which is connecting a topic to an actual person who has supervised undergraduates before.

## 7. Latency is part of the design

The Doherty Threshold puts the productive ceiling for a response at about 400ms.
Below that a student stays in flow; above it they start context-switching.

- A skeleton mirrors the shape of what is loading, so nothing jumps when data arrives.
- A spinner needs a show-delay of roughly 150 to 300ms and a minimum display of 300 to 500ms, or a fast response makes it flash.
- The **peak-end rule** says an experience is judged by its best moment and its last one, not its average.
The last moment in this product is usually the contact step, so that is the moment worth over-investing in.

## 8. Questions this product has not answered

These are open, and they are open because only a student can close them.
Do not invent an answer and encode it.

- **Does search lead, or does browse?**
`/research` currently asserts both: a serif "Find a Yale lab that fits you." over a search box that is disabled until you type ("Enter a topic or name to enable Search"), above a grid that is already populated.
The page tells the student to search and simultaneously demonstrates that browsing works.
One of those should lead.
- **What does a student scan first on a card?**
Name, or department, or topic chips, or the description?
The current order is an assumption, not a finding.
- ~~**Does the undergraduate access signal ever appear?**~~ **Answered, and the guess recorded here was wrong.**
It appeared on 0 of 24 browse cards, and the cause was neither coverage nor layout.
`ResearchHomeCard` derived its badges only from `pathways`, and the browse response from `/api/research/search` carries no `pathways` and no `wayInBadges` field, so the signals were always empty and the block that renders them was never entered.
The same response does carry the evidence, in the entity shape, so the card could not see data that had already reached it.
Fixed in #3555 by deriving from the entity fields as a fallback: 13 of 24 cards now show it, matching the payload exactly.
The lesson for this file is that "the design exists and nothing renders" has a third explanation besides coverage and layout, which is a shape mismatch between the DTO and the component, and it is invisible to every test because the component is correct for its inputs and the inputs never arrive.
- **Is admitting coverage gaps a trust gain or a trust cost?**
See §5.

## 9. How to use this with the other skills

Order of operations for a change to a student-facing surface:

1. This skill, to decide what the surface should carry and in what order.
2. `skills/product-model/SKILL.md`, for the vocabulary and the visibility rules the content has to respect.
3. `client/DESIGN.md`, for the tokens and scales it renders with.
4. `skills/frontend-polish/SKILL.md`, for the behaviour and accessibility bar it has to clear.

The guards in `client/src/__tests__/` enforce step 3 and parts of step 4.
Nothing enforces steps 1 and 2, which is why they need reading rather than running.

## Sources

- Nielsen, *10 Usability Heuristics for User Interface Design*, `nngroup.com/articles/ten-usability-heuristics/`.
- Nielsen Norman Group, *Information Scent*, `nngroup.com/articles/information-scent/`, and *Filters vs. Facets*, `nngroup.com/articles/filters-vs-facets/`.
- Shneiderman et al., *Designing the User Interface*, the Eight Golden Rules.
- Yablonski, *Laws of UX*, `lawsofux.com`, for Hick, Miller, Jakob, Doherty, serial position, peak-end, and Zeigarnik.
- Vercel *Web Interface Guidelines*, which `skills/frontend-polish/SKILL.md` tracks for the rendering and behaviour bar.
