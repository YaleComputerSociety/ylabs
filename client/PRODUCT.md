# Yale Research Product Context

## Product Thesis

Yale Research helps Yale undergraduates move from curiosity to a credible research home and next step. The product should stop behaving like a professor directory and start behaving like an intellectual map of research at Yale.

The domain remains yalelabs.io, but the product brand and information architecture shift from YaleLabs to Yale Research.

## Target User

Primary user: Yale undergraduate students exploring research before they know the right professor, lab, center, topic, or pathway.

Secondary stakeholders: faculty, lab managers, program managers, advisors, YCS maintainers, and student researchers who need the system to preserve credibility.

## Primary User Jobs

- Start with an idea, method, paper, or phrase and discover where that work happens at Yale.
- Understand the papers, people, labs, centers, institutes, and programs behind a topic.
- Verify whether an author or professor is the correct person.
- Find credible evidence that undergraduates can participate.
- Decide the safest next step: apply, contact a program, contact a lab manager, plan outreach, save for thesis planning, or check back later.

## Core Flows

1. Topic exploration: query -> cluster -> papers -> people/entities -> pathway -> next step.
2. Person lookup: search name -> compare identity candidates -> verify affiliation/source -> review research context -> act cautiously.
3. Serendipitous discovery: cluster -> adjacent clusters -> under-discovered entities -> evidence and pathways.

## Trust Constraints

The interface must show sources, evidence strength, observed dates, and confidence labels wherever it makes claims. Avoid unsupported summaries, binary "accepting undergrads" claims, and premature outreach CTAs.

## Author-Disambiguation Rules

Same name does not mean same person. Never silently collapse author records, faculty records, paper authorship, ORCID identities, Google Scholar profiles, or Yale profiles. When confidence is incomplete, show separate candidates with affiliation, department, profile links, source count, and match status.

ORCID can support disambiguation after a Yale identity is established, but it is not itself an undergraduate-access signal.

## Data-Quality Caveats

Embedding clusters may be noisy. Cluster summaries, related topics, and paper/person links must show confidence or caveats when derived. Durable cluster pages require reliable topic clustering and paper/entity linking. Manual review or stronger backend tooling may be needed for high-confidence identity resolution.

## Not Optimizing For

Yale Research is not a marketing site, a complete public faculty directory, a social network, a mass-email tool, or a decorative network graph.

## V1 Scope

V1 should rebrand the shell, replace the homepage with topic-first search, refactor search results into clusters plus people/papers/entities/pathways, add identity-confidence cards, and reuse existing Research, Pathways, Evidence, and Best Next Step infrastructure.
