# Scrapling Rendered Fetch Pilot

## Goal

Keep scraper domain logic independent from Scrapling while piloting rendered-page fetching on hard pages.

## Pilot Targets

1. `dept-faculty-roster` / Yale CS faculty page
   - Current pain: client-rendered page is skipped by the plain HTTP scraper.
   - Success signal: rendered HTML produces faculty observations without changing existing Econ/MCDB/Psych extraction.

2. `lab-microsite-undergrad-llm`
   - Current pain: lab home pages may be empty, script-heavy, or hydrated client-side.
   - Success signal: rendered fallback improves usable page text before the LLM call.

3. Future candidate: `centers-institutes-index`
   - Current pain: some center/member pages can be JS-rendered or structurally inconsistent.
   - Success signal: rendered HTML feeds existing center extractors without moving center/member parsing into the adapter.

## Measurements

Track rendered fetch attempts per scrape run:

- success rate
- latency
- memory delta
- block rate and blocked reason
- selector breakage rate
- fetch mode (`http`, `rendered`, `scrapling`, `apify`, `api`)

## Promotion Criteria

Promote Scrapling from pilot to normal hard-page fallback only if it beats the current plain HTTP path on target coverage or reliability without unacceptable latency, memory, or block-rate cost.
