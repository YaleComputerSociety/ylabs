# Yale Research V1 Redesign Proposal

## 0. Critique

The current design assumes students already know which professor they want. That is backwards for undergraduates, who often begin with an intellectual hunch, a paper title, a method, or a phrase from class. Yale Research should stop behaving like a professor directory and start behaving like an intellectual map of research at Yale.

## 1. Current-State Diagnosis

The logged-out homepage uses the YaleLabs paperclip/logo mark, centered copy, and a CAS sign-in CTA. Its promise is still directory-shaped: "Search through 1400+ Yale faculty listings."

Inside the app, the root surface is still effectively "Find Labs": a compact navbar search, filter dropdowns, sort controls, active filter chips, card/list/compact views, and grid cards. The newer `/research` page already points toward Yale Research with labs, centers, institutes, programs, initiatives, and faculty research, but it still behaves like a filtered card database.

Person pages are useful but conventional: image/initials, title, departments, email/location, ORCID link, and tabs for Bio, Research, Listings, and Courses. Research detail pages are stronger: they already include Ways In, Evidence, Best Next Step, Active Opportunities, People, and Recent Papers.

What works: density, fast scanning, restrained cards, filters, evidence labels, and guarded contact routes. What no longer fits: "YaleLabs," "Find Labs," professor-first navigation, and visual language that treats research discovery as a directory search.

## 2. Rebrand Stakes

What dies: the old "Labs" mental model as the primary frame. The product should stop implying that Yale research equals STEM labs, open positions, or professor lookup. "Find Labs" becomes too narrow for centers, archives, thesis advising, fellowships, digital humanities, and exploratory research.

What stays: the yalelabs.io domain, Yale CAS access, existing search/filter mechanics, faculty credibility, research entity pages, pathway/evidence modeling, saved workflows, and the quiet operational UI. Professor and lab pages do not disappear.

What is new: Yale Research becomes topic-first. Students begin with ideas like "mechanism design" or "BCIs for ALS," then resolve into clusters, papers, people, labs, pathways, evidence, and next steps. The organizing metaphor shifts from "who is listed?" to "where is this work happening, and how could I enter it responsibly?"

## 3. Design Principles

1. **Resolve, do not collapse.** Same name is not same person. Search results show separate identity candidates with affiliation, source, ORCID/Profile links, and confidence.
2. **Clusters are reading rooms, not magic answers.** Embeddings can overconnect weakly related work. Every cluster shows representative papers, terms, departments, and "why grouped" evidence.
3. **People are proof, not the starting point.** Students begin with ideas; faculty validate and anchor those ideas. Homepage and search privilege topics/clusters before author cards.
4. **Action follows evidence.** Students should not spam faculty from weak signals. CTAs appear only after evidence and route context: apply, contact program, plan outreach, or check back later.
5. **Editorial density beats visual spectacle.** Research credibility comes from legibility, not graph decoration. Use compact cards, typographic hierarchy, source rows, and precise metadata.

## 4. IA And Key Flows

**Flow A: Topic Exploration**

Entry: homepage search or topic prompt. Intent: "I'm curious about an idea." Screens: homepage -> search results -> topic cluster -> paper list -> people/labs -> pathway or outreach. Decision points: Is this the right meaning of the topic? Which papers anchor it? Which people are confidently linked? Is there a credible pathway? End action: save cluster, open entity, view paper, or follow best next step. Trust failure to avoid: presenting an embedding cluster as authoritative without sources.

**Flow B: Person Lookup**

Entry: global search. Intent: "Is this the professor I heard about?" Screens: search results -> identity candidates -> author/lab page -> papers/clusters/pathways. Decision points: same-name split, Yale affiliation, department, ORCID/Profile, paper match confidence. End action: verify identity, review research context, then decide whether to act. Trust failure to avoid: silently merging two scholars.

**Flow C: Serendipitous Discovery**

Entry: cluster page adjacency or related topics. Intent: "What else is near this idea?" Screens: cluster -> adjacent clusters -> under-discovered entity cards -> evidence/pathway detail. Decision points: topical proximity, department distance, activity signal, undergrad evidence. End action: save, compare, or open a less obvious lab/center. Trust failure to avoid: burying smaller labs because metadata is sparse.

## 5. Page-Level Wireframes

**Homepage - Migration: Replace**

5 seconds: Yale Research maps ideas to papers, people, labs, and pathways. Above fold: Yale Research wordmark, single large search input, example topic chips, three live "research clusters" rows, and compact counts. Hierarchy: search -> clusters -> under-discovered areas -> recent pathways. Primary CTA: search an idea. Secondary: browse clusters, browse pathways. Metadata: cluster size, papers, departments, strongest evidence. Deliberately absent: oversized marketing hero, "1400+ faculty" directory framing. Mobile: search first, horizontal cluster cards.

**Topic Cluster Page - Migration: New**

5 seconds: this is a coherent area of work, with evidence. Above fold: cluster title, summary, representative terms, confidence/data caveat, papers, people, labs. Hierarchy: overview -> anchor papers -> Yale people/entities -> pathways -> adjacent clusters. Primary CTA: explore people and labs. Secondary: save, open paper, inspect sources. Metadata: paper count, year range, departments, match confidence. Deliberately absent: decorative network graph. Mobile: stacked sections; adjacency becomes a scroll row. Dependency: durable cluster pages require cluster generation and paper/entity linking.

**Author/Lab Page - Migration: Refactor**

5 seconds: who/what this is, what work it belongs to, and how safe the identity match is. Above fold: identity header, confidence card, topical clusters, best next step. Hierarchy: identity/evidence -> clusters -> papers -> pathways -> contact route. Primary CTA: best next step. Secondary: official profile, ORCID, save. Metadata: affiliation, department, source links, paper-match confidence. Deliberately absent: direct outreach before evidence. Mobile: identity card first, CTA sticky only after scrolling past evidence.

**Search Results Page - Migration: Refactor**

5 seconds: results are grouped by topic, not mixed directory hits. Above fold: query, interpretation chips, cluster results, then people/papers/entities. Hierarchy: clusters -> papers -> people/labs -> pathways. Primary CTA: open top cluster. Secondary: filter by department, evidence, entity type. Metadata: why matched, source count, identity confidence. Deliberately absent: one undifferentiated list. Mobile: tabs for Clusters, Papers, People, Pathways.

## 6. Component Design

**Topic Cluster Card - Migration: New**

Purpose: preview an area of work. Required fields: title, summary, terms, paper count, departments, representative papers, confidence/caveat. Visual: white card, 6px radius, left Yale-blue accent rule, dense metadata. Interaction: opens cluster; terms filter. Empty: "cluster needs more evidence." Trust: shows why the grouping exists.

**Author / Identity-Confidence Card - Migration: New**

Purpose: prevent name conflation. Fields: name, title, affiliations, departments, ORCID/Profile links, source count, match confidence, ambiguity flag. Visual: compact bordered panel with confidence label, not badge theater. Interaction: compare candidates. Empty: "identity not resolved." Trust: separates identity from paper authorship.

**Evidence / Source Row - Migration: Refactor**

Purpose: make claims auditable. Fields: claim, source type, URL, excerpt, observed date, confidence. Visual: small metadata row, muted text, source link in Yale blue. Interaction: expand excerpt. Empty: "no source attached." Trust: prevents unsupported summaries.

**Best Next Step Panel - Migration: Refactor**

Purpose: convert evidence into responsible action. Fields: recommended action, rationale, route type, URL, caveat, freshness. Visual: right rail on desktop, inline on mobile. Interaction: apply/contact/save. Empty: "review sources first." Trust: avoids premature outreach.

Secondary inventory: search bar, paper card, citation row, related topics module, filters, saved item control, loading state, empty state, outreach CTA, and cluster confidence tooltip.

## 7. Visual Direction

Typography: keep Inter for interface; use Georgia or Source Serif-style fallback for abstracts and cluster summaries. Scale: 12 metadata, 14 body, 16 card titles, 20 section heads, 28 page titles, 36 only for homepage brand/search framing.

Colors: background `#F7F8FA`, surface white, text `#111827`, muted `#6B7280`, border `#E5E7EB`, soft fill `#F3F4F6`. Yale blue `#00356B` is used for wordmark, active nav underline, links, focus rings, left card rules, and primary CTAs. Never use Yale blue as a page wash.

Spacing: 8px grid, 24px page gutters, 1300px max width, 260-280px sidebars, dense cards with 16-20px padding. Cards use 6-8px radius, 1px borders, subtle hover border change, minimal shadow.

Citation metadata: authors, venue, year, citations, DOI, arXiv, and source labels appear in 12px muted text. Dates use "Apr 2026" or "2021-2025," not verbose timestamps. Confidence labels are literal: "Identity: Yale-confirmed," "Paper match: high," "Cluster: experimental."

Motion: 120-160ms hover/focus transitions only. No animated graph, glow, parallax, or fake AI flourish. The interface feels editorial because summaries are readable, sources are visible, and metadata is composed with care; it feels alive because clusters create adjacency and discovery without visual noise.

## 8. Client Narrative

Today YaleLabs helps students find faculty and listings, but it still assumes the student already knows the right professor or lab. That is not how undergraduate research usually starts. A student starts with a phrase from class, a paper they half-understand, or a question like "who at Yale works on brain-computer interfaces for ALS?"

Yale Research keeps the credibility of faculty and lab pages, but changes the first object in the experience. The first object becomes a cluster of work: papers, topics, departments, people, and pathways connected by evidence. From there, students can resolve the idea into actual Yale structures and responsible next steps.

This matters for engagement because curiosity is a lower barrier than name recognition. It matters for under-discovered labs because smaller centers and faculty projects can surface through adjacent topics, not only popularity or polished web pages. It matters for faculty because the product does not flatten credibility; it shows sources, affiliations, and confidence.

Most importantly, we do not silently merge identities. Same name does not mean same person. Yale Research should show when an author match is confident, when it is uncertain, and when two people need to remain separate.

## 9. Steelman The Objection

Objection: "This sounds like turning serious research into an AI-generated map that may misclassify faculty, overstate relationships, and encourage undergraduates to contact people based on weak machine inference. A directory may be less exciting, but at least it is legible and accountable. Faculty credibility is damaged if the product groups their work incorrectly or merges them with another scholar."

Response: that objection is correct unless trust is designed into the core UI. The redesign does not replace faculty pages with AI summaries; it adds a topic layer above them and makes every resolution step visible. Clusters show source papers and confidence caveats. Identity cards separate people with the same name. CTAs require pathway evidence. Faculty pages remain the credibility anchor; they are no longer the only doorway.

## 10. Trade-Offs And Risks

This redesign is not optimizing for marketing spectacle, a complete public faculty directory, social personalization, instant outreach, or a single canonical "best lab."

Risks and mitigations:

- Over-abstracting research into vague clusters: require representative papers and terms.
- Search feeling magical but untrustworthy: show "why matched."
- Faculty pages feeling demoted: make them the verified resolution layer.
- Noisy embedding clusters: label cluster confidence and keep V1 query-led.
- Mobile complexity: use tabs and stacked sections.
- Author identity mistakes: never merge without Yale-backed or ORCID-backed evidence.
- Students over-trusting AI summaries: attach caveats and sources.
- Under-discovered labs staying buried: add "adjacent but low-visibility" modules.
- Small-team implementation drag: ship by refactoring existing search/cards before building true clusters.

## 11. Implementation Priorities And Migration

**V1 must-have:** rename/brand to Yale Research; replace homepage with topic-first search; refactor search results into grouped clusters, people, papers, entities, pathways; add identity-confidence card; add source rows to claims; preserve existing `/research`, `/pathways`, and entity pages.

**V1.5 nice-to-have:** richer cluster summaries, adjacent topic browsing, paper-first cards, better mobile tabs, under-discovered cluster module, more explicit "why matched."

**Later / experimental:** durable `TopicCluster` collection, cluster quality scores, citation graph browsing, real-time embedding refresh, faculty-verified cluster claims, manual moderation UI, advanced ranking, and mature disambiguation review tools.

| Page / Component | Tag |
|---|---|
| Homepage | Replace |
| Topic cluster page | New |
| Author/lab page | Refactor |
| Search results page | Refactor |
| Topic cluster card | New |
| Author / identity-confidence card | New |
| Evidence / source row | Refactor |
| Best Next Step panel | Refactor |
