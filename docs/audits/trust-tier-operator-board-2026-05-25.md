# Trust Tier Operator Board - 2026-05-25

This is the first Phase 0 operator board for the applied Trust Tier backfill in Beta. It started as a read-only markdown control plane snapshot and is now represented by the live admin operator board at `GET /api/admin/operator-board`, surfaced in the Analytics admin panel.

Note: Beta Research counts moved during this audit because the local development environment was connected to live Beta data. Treat the counts below as a point-in-time operator sample, and rerun the board/gates before any production promotion.

## Surface QA

| Surface | Check | Result |
| --- | --- | --- |
| `/research` student API | Default browse/search hides review and suppressed rows. | Pass. Unauthenticated API returned only `student_ready` and `limited_but_safe` rows. Latest post-rebuild smoke returned 1,401 default Research results; query smoke for `machine learning` returned 121 results and only public tiers. |
| `/programs` student API | Default browse/search hides review and suppressed rows. | Pass. API/UI smoke returned 127 total public Programs results after the reviewed STARS, Bouchet, DEC, Goldwater, Beinecke, LEAP, WGSS/LGBT, French grants, Baron, WFF, Blue Center, Charles Kao, Fields, NIST SURF, Schmidt, Yale Office summer research fellowship, Saybrook/Branford/Ezra Stiles, Davenport, Silliman, Harvey Geiger, James Helzer, and NSF REU repair passes: 31 `student_ready` and 96 `limited_but_safe`. |
| `/programs` admin filters | Admin can expose review and suppressed queues. | Pass. The live operator board shows 13 `operator_review` Programs and 47 `suppressed` Programs. |
| `/research` admin filters | Admin can expose review queue. | Pass. Browser admin filter showed 1,312 `operator_review` Research records. |
| `/research` suppressed-only admin filter | Empty suppressed Research queue should render empty. | Fixed during this pass. Explicit admin trust-tier filters now win over `includeSuppressed`; browser retest shows the empty suppressed queue instead of the full index. |
| Live Research count parity | Search/API counts should be stable enough for promotion decisions. | Pass for this quiet baseline. Research Meili rebuilt 2,419 active documents; public API count is 1,401, matching active Mongo public-tier count. |

## Current Tier Counts

| Collection | `student_ready` | `limited_but_safe` | `operator_review` | `suppressed` |
| --- | ---: | ---: | ---: | ---: |
| ResearchEntity, active Mongo | 534 | 867 | 1,018 | 0 |
| Fellowship/Programs, active Mongo | 31 | 96 | 13 | 47 |

## Reason Counts

Research reasons:

| Reason | Count | Operator meaning |
| --- | ---: | --- |
| `concrete_next_step` | 1,304 | Has enough route/contact/action copy to avoid an empty student card. |
| `source_backed_description` | 1,213 | Has source-backed research description. |
| `missing_action_evidence` | 1,174 | Add or verify access signals, entry pathways, contact routes, or posted opportunities before promotion. |
| `missing_description` | 796 | Needs official-source description repair before normal promotion. |
| `missing_lead` | 294 | Needs PI/director/member linking or an intentional non-person research-home exception. |
| `profile_fallback_only` | 282 | Description appears to come from faculty profile context, not verified entity/lab context. |
| `missing_source_url` | 197 | Needs official source URL before student trust can rise. |
| `thin_description` | 187 | Needs fuller source-backed student-facing description. |

Program reasons:

| Reason | Count | Operator meaning |
| --- | ---: | --- |
| `application_route` | 187 | Has an application/planning route, but not necessarily student-safe. |
| `official_source` | 187 | Has official source metadata, including restrained application-portal-only sources. |
| `undergraduate_relevant` | 129 | Evidence suggests undergraduate relevance. |
| `application_source_only` | 127 | Official source is only a CommunityForce application detail page; keep restrained unless a richer source is attached. |
| `archive_review` | 48 | Retained as planning/archive or cleanup records, not prominent public options. |
| `not_undergraduate_relevant` | 43 | Correctly suppressed or should stay hidden unless explicitly reviewed. |
| `operator_override` | 33 | Manual override or exact-title repair outcome should stay visible to operators. |

## Queue Samples And Next Repair Action

### `student_ready`

Research false-positive candidates:

- `Adam de Havenon Lab`, `Alan Dardik Lab`, `Allore Lab`, `Ambrose Wong Lab`: marked `student_ready` with source-backed descriptions, but no `websiteUrl`. Next action: require an official home/profile URL for prominent cards, or demote to `limited_but_safe` when only grant/profile source URLs exist.
- Long-description records such as `ACCELERATE Lab`, `Benjamin Turk Research`, and `Brian Scassellati Lab` are source-backed but should be checked for copied page chrome or biography-like copy. Next action: run description cleanup before broad promotion.

Program false-positive candidates were repaired in the first source-metadata pass:

- `Yale College Dean's Research Fellowship` was corrected to `Yale College Dean’s Research Fellowship` and summarized as Yale College senior research funding.
- `AAMC Summer Undergraduate Research Programs` was classified as a Yale-facing external research directory, not a Yale-run fellowship, and is kept `limited_but_safe`.
- `Augusta HAZARD Fellowship` has an official Yale source but is graduate/professional-only, so it is explicitly `suppressed`.
- Six high-signal undergraduate Programs were promoted from CommunityForce-only source metadata to richer verified official Yale pages: `STARS Summer Research Program`, `Wu Tsai Undergraduate Fellowships`, `Yale College First-Year Summer Research Fellowship in the Sciences and Engineering`, `Yale College Dean's Research Fellowship in the Sciences AND Rosenfeld Science Scholars Program`, `Yale College Dean's Research Fellowship in the Humanities and Social Sciences`, and `Yale-Weizmann Israel Science Collaboration Program`.
- The classifier now suppresses obvious graduate/professional/postgraduate records before source repair, including graduate fellowship, dissertation, law-school, and Rhodes/postgraduate-study patterns. This moved 11 Programs from review into suppressed without changing the public 88-row student surface.
- The damaged Yale-UC Louvain extraction was repaired into one restrained public `Yale-UC Louvain Summer Research Program` row, while the duplicate `70 (...) research internships subjects` fragment was suppressed as an extraction duplicate. This increased the public Program surface to 89 rows without exposing the broken title.
- STARS I and STARS II were repaired from the `missing_official_source` queue using exact official Yale College source pages. STARS I is capped at `limited_but_safe` because the source supports STEM preparation/mentoring rather than direct research placement; STARS II is `student_ready` with mentor-first research-program framing. This increased the public Program surface to 91 rows.
- Edward A. Bouchet Undergraduate Fellowship and Digital Ethics Center Director's Fellows Program were repaired from the `missing_official_source` queue using official source pages and conservative summaries. Bouchet is `student_ready`; DEC is `student_ready` for the undergraduate Junior Director's Fellow track while still noting that the program also has a senior graduate/professional track. This increased the public Program surface to 93 rows.
- Barry M. Goldwater Scholarship, Beinecke Scholarship Program, and Law, Environment and Animals Program (LEAP) Student Grant were repaired from the `missing_official_source` queue. Goldwater and Beinecke use Yale Office of Fellowships external-awards guidance and are capped at `limited_but_safe`; LEAP uses the official Yale Law grant page and is `student_ready`. This increased the public Program surface to 96 rows.
- Four more source-repair loops moved the Programs surface to 102 public rows: graduate/professional-only travel/research grants were suppressed; Shana Alexander and Solomon LGBT Studies were repaired from official Yale source pages; French major research grants, Baron student research grants, and Yale Women Faculty Forum Seed Grant gained source-backed restrained copy; and the duplicate Kenneth Cornell French grant row was suppressed as a duplicate public record. The public Program surface now has zero duplicate titles.
- Five parallel-agent-informed source-repair loops moved the Programs surface to 114 public rows: Blue Center, Charles Kao, Fields, NIST SURF, and Schmidt were kept `limited_but_safe` because they are mixed-audience, external, or preparation-oriented; seven Yale Office summer research fellowships gained source-backed Yale College funding copy. The remaining `missing_official_source` queue moved to 24 rows.
- A follow-up trust-focused repair loop moved the Programs surface to 124 public rows and reduced `missing_official_source` to 3. Saybrook, Branford, Ezra Stiles, Davenport, and Silliman residential-college research/travel funding rows gained restrained source-backed copy; Fox, Fulbright, Mellon/Kings, Projects for Peace Alumni, SQR Phase 2, STEM Summer Fellowships, Stanley Burns, and graduate/professional travel-grant rows were suppressed or kept hidden as archive/container/postgraduate records.
- The remaining three Programs provenance rows were resolved through parallel source verification. Harvey Geiger and James Helzer were repaired as `limited_but_safe` restrained funding rows; the NSF REU row was retitled to `NSF Research Experience for Undergraduates (REU) Computational Analysis of Infectious Diseases`, sourced to the official Yale College page, and promoted to `student_ready` as a structured summer research program. The Programs `missing_official_source` queue is now zero.

### `limited_but_safe`

Promotion candidates:

- `A. Stephen Morse - Research`, `Aaron M. Dollar Lab`, `Aarti Bhatia Research`, `Abhijit Patel Research`, `Abujarad's Digital Health Lab`.
- These have source-backed descriptions and official URLs but lack action evidence. Next action: add or verify contact route, access signal, or explicit "how to get involved" evidence. If no access evidence exists, keep restrained copy.

Demotion candidates:

- The sampled query found no `limited_but_safe` rows with `thin_description` or `missing_source_url`. This suggests the current limited tier is mostly doing what it should: safe but not prominent.

### `operator_review`

By reason:

- `missing_lead`: `3D Tumor Lab`, `Ahmed Mobarak Lab`, `Alfred Lee Research`. Next action: link PI/director/member evidence or mark non-person owner exceptions.
- `missing_source_url`: `AZ A. Zayaruznaya - Research`, `Aaron Gerow - Research`, `Abbas Amanat - Research`. Next action: source URL repair before any public browse promotion.
- `thin_description`: `Aakash Basu Lab`, `Aaron Gerow - Research`, `Aaron Wolfe Lab`. Next action: official description enrichment or stay review-only.
- `missing_action_evidence`: `Aakash Basu Lab`, `Aaron Kuan Research`, `Aaron Lazorwitz Lab`. Next action: add access/pathway/contact artifacts only when the source explicitly supports them.

Programs review queue:

- The previous `missing_official_source` queue is now empty. Remaining `operator_review` Programs are no longer source-metadata blockers by default; next action is to sample them by `archive_review`, current title quality, and whether they are real student-facing programs or administrative pages.
- `archive_review` has extraction/page-title issues such as `0 (engineering, computer science /computer engineering) research internships subjects`, `70 (engineering...) research internships subjects`, and an advising-page title. Next action: fix page extraction and classify archive/planning pages separately from true programs.
- 2026-05-25 parallel-agent review classified the 13 remaining `operator_review` Programs, then the DB-backed repair was applied after the exact-title dry run matched the reviewed plan. Promoted `Herbert Scarf Summer Research Opportunities in Economics`, `REEESNe Student Internship and Research Grant`, and `Summer Fellowship in Japan` to `student_ready`; kept George J. Schulz, Henry Hart Rice, John E. Linck, Grand Strategy, South Asian language study, Shana Alexander, Horowitz/Fischer Judaica funds, and YSE Supplementary Fund as `limited_but_safe` with narrow eligibility/funding copy; suppressed the advising-page promo as an admin/advising resource rather than a Program; suppressed `Gruber Fellowships in Global Justice and Women's Rights` because the official Yale source audience is graduate/professional students and recent alumni, not undergraduates.
- Recovery note: the local untracked `server/.env` remains missing, but the Beta Mongo target was recovered for command injection from old local session logs without writing the secret back into the repo. Long-term fix is still to restore the real ignored `server/.env` from the password manager/deployment source.

### `suppressed`

Programs suppressed examples:

- `Law School Fellowships Common Application`, `Beinecke Library Research Fellowships for Yale Graduate and Professional Students`, `MacMillan Center Pre-Dissertation Research Fellowships`, `MacMillan International Dissertation Research Fellowships (IDRF)`, `Council on East Asian Studies Field Research Grants`.
- Suppression reason is generally graduate/professional or non-undergraduate relevance. Next action: keep suppressed by default; only add undergraduate-specific child records when the source clearly supports them.

## Gate Results

| Command | Result |
| --- | --- |
| `yarn --cwd server beta:data-quality --include-samples` | Warn, zero errors. Warnings: 6 duplicate normalized Research names, 1,164 missing short descriptions, 36 weak short descriptions, 1,267 entities without pathways, 1,117 without access signals, 1,930 without contact routes, and 5 synthetic dev emails. |
| `yarn --cwd server scraper:integrity-gate --include-samples` | Pass. No duplicate/current-member/access-signal/current-state integrity failures. |
| Research API smoke | Pass for student gating and post-rebuild count parity. Mongo public-tier Research count is 1,401 and `/api/research/search` returned total 1,401. |
| Programs API/UI smoke | Pass for student gating. Public API/UI returned 138 rows; operator board reports Programs at `student_ready=34`, `limited_but_safe=104`, `operator_review=0`, `suppressed=49`. |

## Next Repair Order

1. Restore the real ignored `server/.env` from the password manager/deployment source so future gstack loops do not depend on session-log recovery.
2. Use the live operator board as the Phase 0 control plane for Trust Tier queues, gate status, source freshness, samples, and next repair actions.
3. Treat the remaining `application_source_only` Programs as useful planning rows, not prominent student-ready rows. Promote them only after attaching a richer non-portal official source page.
4. Promote high-confidence `limited_but_safe` Research rows only after adding explicit source-backed access/contact evidence.
5. Keep broad description repair source-backed and reviewed. Do not synthesize missing descriptions or next steps just to reduce queue size.
6. Design worker/pipeline architecture around the observed queues once the board has been used for a few repair cycles.
