# Yale Research Official Full Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the full official `research.yale.edu` directory surface into Beta, then prepare it for guarded production rollout without creating duplicate research homes or unsupported undergraduate-access artifacts.

**Architecture:** Keep `yale-research-official` as an official-index, discovery-first scraper. Expand ingestion in layers: complete listing coverage, detail-page enrichment, explicit undergraduate pathway extraction only where source text directly supports it, and final search/index rollout. Each layer must pass dry-run, materialization, source-health, and integrity gates before broadening.

**Tech Stack:** TypeScript, Express scraper CLI, Mongoose/MongoDB Atlas Beta, Vitest, Graphify, Meilisearch.

---

## File Structure

- Modify: `server/src/scrapers/sources/yaleResearchOfficialScraper.ts`
  - Add pagination, detail-page fetch/parsing, and explicit pathway/opportunity extraction only for reviewed URL patterns.
- Modify: `server/src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts`
  - Add regression coverage for pagination, detail-page enrichment, and access-artifact boundaries.
- Modify: `server/src/scrapers/entityMaterializer.ts`
  - Only if detail-page observations expose a new safe identity/reuse case not already handled by exact-name or slug matching.
- Modify: `server/src/scrapers/__tests__/entityMaterializer.test.ts`
  - Only if materializer identity behavior changes.
- Modify: `server/src/scrapers/sourceCoverageRegistry.ts`
  - Update source coverage metadata if explicit access/pathway extraction is added.
- Modify: `server/src/scrapers/seedSources.ts`
  - Update seeded source notes if the source graduates beyond discovery-only.
- Modify: `docs/research-model.md`
  - Record stable modeling decisions for official Yale research directories, core facilities, and explicit undergraduate pathway pages.
- Modify: `docs/scraper-audit-guide.md`
  - Record audit procedure and accepted non-write/write expectations.
- Modify: `docs/tasks/priority-roadmap.md`
  - Track accepted run IDs, gate results, and production readiness.

---

### Task 1: Establish Current Full-Directory Baseline

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Run read-only preflight gates**

```bash
yarn --cwd server scraper:integrity-gate --include-samples --limit=50
yarn --cwd server source:health --strict
```

Expected:
- `scraper:integrity-gate` exits `0` with all hard counts `0`.
- `source:health --strict` exits `0`; the known `research-entity-cache-backfill` recency warning is acceptable.

- [ ] **Step 2: Run full no-limit dry-runs for each listing directory**

```bash
SCRAPER_ENV=development yarn scrape run --source yale-research-official --only centers --use-cache --dry-run
SCRAPER_ENV=development yarn scrape run --source yale-research-official --only cores --use-cache --dry-run
SCRAPER_ENV=development yarn scrape run --source yale-research-official --only resources --use-cache --dry-run
SCRAPER_ENV=development yarn scrape run --source yale-research-official --use-cache --dry-run
```

Expected:
- All runs exit `0`.
- `warnings: []`.
- `errors: []`.
- Observation entity types are only `researchEntity`.
- Materialization writes are `0`.

- [ ] **Step 3: Record baseline counts**

Update `docs/tasks/priority-roadmap.md` under the `yale-research-official` note with:

```markdown
Full-directory dry-run baseline:
- centers: <run-id>, <observation-count> observations / <entity-count> entities
- cores: <run-id>, <observation-count> observations / <entity-count> entities
- resources: <run-id>, <observation-count> observations / <entity-count> entities
- all directories: <run-id>, <observation-count> observations / <entity-count> entities
```

- [ ] **Step 4: Stop condition**

Stop before writes if any dry-run emits:
- `entryPathway`, `accessSignal`, `contactRoute`, or `postedOpportunity`.
- `warnings` or `errors`.
- duplicate/collision candidates in the run report.

---

### Task 2: Add Listing Pagination If The Site Exposes More Pages

**Files:**
- Modify: `server/src/scrapers/sources/yaleResearchOfficialScraper.ts`
- Modify: `server/src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts`

- [ ] **Step 1: Write failing pagination test**

Add a test that proves the scraper follows a next-page link and deduplicates rows:

```ts
it('follows listing pagination and deduplicates entities by slug', async () => {
  const pageOne = `
    <ol class="listing-items">
      <li class="item">
        <h3><a href="https://example.yale.edu/one">Yale Example Center</a></h3>
        <p class="item__summary">First page summary.</p>
      </li>
    </ol>
    <nav class="pager"><a rel="next" href="/centers-institutes?page=1">Next</a></nav>
  `;
  const pageTwo = `
    <ol class="listing-items">
      <li class="item">
        <h3><a href="https://example.yale.edu/one">Yale Example Center</a></h3>
        <p class="item__summary">Duplicate page summary.</p>
      </li>
      <li class="item">
        <h3><a href="https://example.yale.edu/two">Yale Second Institute</a></h3>
        <p class="item__summary">Second page summary.</p>
      </li>
    </ol>
  `;
  const emitted: ObservationInput[] = [];
  const fetchHtml = vi.fn(async (url: string) =>
    url.includes('page=1') ? pageTwo : pageOne,
  );
  const scraper = new YaleResearchOfficialScraper({ fetchHtml });

  const result = await scraper.run(buildContext(scraper, emitted, { only: ['centers'] }));

  expect(result.entitiesObserved).toBe(2);
  expect(fetchHtml).toHaveBeenCalledWith(CENTERS_LISTING_URL, false);
  expect(fetchHtml).toHaveBeenCalledWith(
    'https://research.yale.edu/centers-institutes?page=1',
    false,
  );
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
yarn --cwd server test src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts
```

Expected before implementation:
- The new pagination test fails because only the first page is fetched.

- [ ] **Step 3: Implement pagination helper**

Add this helper to `server/src/scrapers/sources/yaleResearchOfficialScraper.ts`:

```ts
function nextPageUrl(html: string, currentUrl: string): string | null {
  const $ = cheerio.load(html);
  const href =
    $('a[rel="next"]').first().attr('href') ||
    $('.pager a[aria-label*="Next" i]').first().attr('href') ||
    $('.pager a:contains("Next")').first().attr('href') ||
    '';
  return href ? absoluteUrl(href, currentUrl) : null;
}

async function fetchPaginatedHtml(
  startUrl: string,
  context: ScraperContext,
  fetchHtml: YaleResearchOfficialFetchHtml,
): Promise<Array<{ url: string; html: string }>> {
  const pages: Array<{ url: string; html: string }> = [];
  const seen = new Set<string>();
  let next: string | null = startUrl;

  while (next && !seen.has(next)) {
    seen.add(next);
    context.log(`Fetching ${next}`);
    const html = await fetchHtml(next, context.options.useCache);
    pages.push({ url: next, html });
    next = nextPageUrl(html, next);
  }

  return pages;
}
```

- [ ] **Step 4: Use pagination for centers, cores, and resources**

Replace single-page fetches in `YaleResearchOfficialScraper.run()` with `fetchPaginatedHtml()`, and parse each page with its own page URL as `sourceUrl`.

- [ ] **Step 5: Run focused tests**

```bash
yarn --cwd server test src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts
```

Expected:
- All scraper tests pass.

---

### Task 3: Materialize Complete Listing Directories In Beta

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Run final pre-write gates**

```bash
yarn --cwd server scraper:integrity-gate --include-samples --limit=50
yarn --cwd server source:health --strict
```

Expected:
- Integrity gate exits `0`.
- Source health exits `0`, with only the known cache-backfill warning if still present.

- [ ] **Step 2: Materialize no-limit listing directories**

```bash
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn scrape run --source yale-research-official --only centers --use-cache --auto-materialize

SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn scrape run --source yale-research-official --only cores --use-cache --auto-materialize

SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn scrape run --source yale-research-official --only resources --use-cache --auto-materialize
```

Expected for each run:
- `materialization.errors = 0`.
- `materialization.conflicts = 0`.
- `postMaterializationIntegrity.status = "pass"`.
- `postMaterializationMetrics.entryPathways = 0`.
- `postMaterializationMetrics.accessSignals = 0`.
- `postMaterializationMetrics.contactRoutes = 0`.
- `postMaterializationMetrics.postedOpportunities = 0`.

- [ ] **Step 3: Run post-write gates**

```bash
yarn --cwd server scraper:integrity-gate --include-samples --limit=50
yarn --cwd server source:health --strict
```

Expected:
- Integrity gate exits `0`.
- `yale-research-official` has latest successful runs.

- [ ] **Step 4: Record accepted run IDs**

Update `docs/tasks/priority-roadmap.md` with:

```markdown
No-limit listing acceptance:
- centers: <run-id>, created <n>, updated <n>, conflicts 0, errors 0, access artifacts 0
- cores: <run-id>, created <n>, updated <n>, conflicts 0, errors 0, access artifacts 0
- resources: <run-id>, created <n>, updated <n>, conflicts 0, errors 0, access artifacts 0
```

---

### Task 4: Add Detail-Page Discovery Enrichment

**Files:**
- Modify: `server/src/scrapers/sources/yaleResearchOfficialScraper.ts`
- Modify: `server/src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts`
- Modify: `docs/research-model.md`
- Modify: `docs/scraper-audit-guide.md`

- [ ] **Step 1: Write failing detail parser test**

Add a parser test that extracts stable, discovery-only fields:

```ts
it('enriches detail pages with source-backed description and topic text only', () => {
  const html = `
    <main>
      <h1>Yale Example Center</h1>
      <p class="intro">The center supports research in imaging, computation, and data science.</p>
      <section>
        <h2>Services</h2>
        <ul><li>Advanced imaging consultation</li><li>Data analysis support</li></ul>
      </section>
      <a href="mailto:direct@example.yale.edu">Email us</a>
    </main>
  `;

  expect(parseDetailPage(html, 'https://research.yale.edu/example')).toEqual({
    description: 'The center supports research in imaging, computation, and data science.',
    researchAreas: ['Advanced imaging consultation', 'Data analysis support'],
    sourceUrls: ['https://research.yale.edu/example'],
  });
});
```

- [ ] **Step 2: Run test and verify failure**

```bash
yarn --cwd server test src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts
```

Expected:
- Fails because `parseDetailPage` is not implemented/exported.

- [ ] **Step 3: Implement detail parser**

Add:

```ts
export interface YaleResearchOfficialDetail {
  description: string;
  researchAreas: string[];
  sourceUrls: string[];
}

export function parseDetailPage(html: string, sourceUrl: string): YaleResearchOfficialDetail {
  const $ = cheerio.load(html);
  const description = normalizeText(
    $('main .intro, main .lede, main article p, main p').first().text(),
  );
  const researchAreas = uniqueValues(
    $('main section li, main .field--name-field-tags a, main .tags a')
      .toArray()
      .map((node) => $(node).text())
      .filter((text) => text.length <= 120),
  );
  return {
    description,
    researchAreas,
    sourceUrls: [sourceUrl],
  };
}
```

- [ ] **Step 4: Merge detail enrichment into entity observations**

In the scraper run flow, fetch detail pages for accepted listing entities and merge:
- detail `description` only when listing description is blank or materially shorter.
- detail `researchAreas` into existing entity `researchAreas`.
- detail URL into `sourceUrls`.

Do not emit:
- contact emails.
- application routes.
- access signals.
- posted opportunities.

- [ ] **Step 5: Add non-write assertion test**

Add:

```ts
it('does not convert detail page contact or application-like text into access artifacts', async () => {
  const emitted: ObservationInput[] = [];
  const fetchHtml = vi.fn(async (url: string) => {
    if (url === CENTERS_LISTING_URL) return CENTERS_HTML;
    return '<main><p>Contact us to learn more.</p><a href="/apply">Apply</a></main>';
  });
  const scraper = new YaleResearchOfficialScraper({ fetchHtml });

  await scraper.run(buildContext(scraper, emitted, { only: ['centers'] }));

  expect(emitted.map((obs) => obs.entityType)).not.toEqual(
    expect.arrayContaining(['entryPathway', 'accessSignal', 'contactRoute', 'postedOpportunity']),
  );
  expect(emitted.map((obs) => obs.field)).not.toEqual(
    expect.arrayContaining(['contactEmail', 'joinPageUrl', 'undergradAccessEvidence']),
  );
});
```

- [ ] **Step 6: Verify**

```bash
yarn --cwd server test src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts
npx tsc --noEmit -p server/tsconfig.json
```

Expected:
- Tests pass.
- Server typecheck exits `0`.

---

### Task 5: Add Explicit Undergraduate Pathway Extraction For Reviewed Pages Only

**Files:**
- Modify: `server/src/scrapers/sources/yaleResearchOfficialScraper.ts`
- Modify: `server/src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts`
- Modify: `server/src/scrapers/sourceCoverageRegistry.ts`
- Modify: `server/src/scrapers/seedSources.ts`
- Modify: `docs/research-model.md`
- Modify: `docs/scraper-audit-guide.md`

- [ ] **Step 1: Identify reviewed URL patterns**

Use browser/manual review and record only URLs whose page text explicitly targets undergraduates, such as:

```text
https://research.yale.edu/cores/ycmd/summer-internships-undergraduates
```

Do not include generic `apply`, `contact`, `services`, or `resources` pages unless they mention undergraduate eligibility or a student-facing program.

- [ ] **Step 2: Write failing explicit pathway test**

Add:

```ts
it('emits access artifacts only for explicit undergraduate internship pages', () => {
  const entity = {
    name: 'Yale Center for Molecular Discovery',
    url: 'https://research.yale.edu/cores/ycmd',
    slug: 'yale-research-core-yale-center-for-molecular-discovery',
    kind: 'center' as const,
    entityType: 'CORE_FACILITY' as const,
    description: '',
    researchAreas: [],
    sourceUrl: CORE_LISTING_URL,
    sourceUrls: [CORE_LISTING_URL, 'https://research.yale.edu/cores/ycmd'],
  };
  const observations = explicitUndergraduatePageToObservations(entity, {
    url: 'https://research.yale.edu/cores/ycmd/summer-internships-undergraduates',
    title: 'Summer Internships for Undergraduates',
    excerpt: 'Summer internships for undergraduates provide research experience in drug discovery.',
  });

  expect(observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entityType: 'researchEntity',
        entityKey: entity.slug,
        field: 'undergradAccessEvidence',
      }),
      expect.objectContaining({
        entityType: 'researchEntity',
        entityKey: entity.slug,
        field: 'joinPageUrl',
        value: 'https://research.yale.edu/cores/ycmd/summer-internships-undergraduates',
      }),
    ]),
  );
});
```

- [ ] **Step 3: Implement explicit page extractor**

Add:

```ts
interface ExplicitUndergraduatePage {
  url: string;
  title: string;
  excerpt: string;
}

export function explicitUndergraduatePageToObservations(
  entity: YaleResearchOfficialEntity,
  page: ExplicitUndergraduatePage,
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: entity.slug,
    sourceUrl: page.url,
  };
  return [
    {
      ...base,
      field: 'undergradAccessEvidence',
      value: page.excerpt,
    },
    {
      ...base,
      field: 'undergradEvidenceQuote',
      value: page.excerpt,
    },
    {
      ...base,
      field: 'joinPageUrl',
      value: page.url,
    },
  ];
}
```

- [ ] **Step 4: Keep source coverage accurate**

If this extractor is enabled, update `server/src/scrapers/sourceCoverageRegistry.ts` for `yale-research-official` to include `EntryPathway`, `AccessSignal`, or `ContactRoute` only if materialization actually derives those artifacts from these fields. Keep `PostedOpportunity` out unless deadline/title/application-instance fields are emitted.

- [ ] **Step 5: Verify explicit access materialization in a tiny target run**

```bash
SCRAPER_ENV=development yarn scrape run --source yale-research-official --only cores --limit 1 --dry-run
SCRAPER_ENV=development ALLOW_NON_PROD_SCRAPER_WRITES=true \
  yarn scrape run --source yale-research-official --only cores --limit 1 --use-cache --auto-materialize
yarn --cwd server scraper:integrity-gate --include-samples --limit=50
```

Expected:
- Access artifacts are created only for the reviewed undergraduate page.
- Integrity gate passes.

---

### Task 6: Search Sync And Student-Facing Spot Checks

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Rebuild or sync ResearchEntity search**

For local/Beta validation:

```bash
yarn --cwd server meili:rebuild-research-entities --clear
```

Expected:
- Command exits `0`.
- Indexed document count includes newly accepted official Yale research entities.

- [ ] **Step 2: API smoke searches**

```bash
node -e "fetch('http://localhost:4000/api/research/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q:'molecular discovery',page:1,pageSize:5,filters:{},sortBy:'relevance',sortOrder:'desc'})}).then(r=>r.json()).then(j=>console.log(JSON.stringify((j.hits||[]).map(h=>h.name||h.displayName),null,2)))"
```

Expected:
- Results include relevant official research entities when the local server is running.

- [ ] **Step 3: Record search status**

Update `docs/tasks/priority-roadmap.md` with:

```markdown
Search sync: `researchentities` rebuilt after Yale Research official ingestion; spot queries checked for molecular discovery/core facility/biomedical innovation.
```

---

### Task 7: Production Rollout Preparation

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Confirm production backup posture**

Record the production backup or restore point in operator notes outside Git if it contains sensitive details. In the roadmap, record only:

```markdown
Production backup confirmed before `yale-research-official` rollout on <date>.
```

- [ ] **Step 2: Run production dry-run**

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape run --source yale-research-official --use-cache --dry-run
```

Expected:
- Dry-run exits `0`.
- Counts match Beta within expected date/site drift.
- No materialization writes.

- [ ] **Step 3: Run guarded production materialization**

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true \
  yarn scrape run --source yale-research-official --use-cache --auto-materialize --release
```

Expected:
- Materialization errors `0`.
- Conflicts `0`.
- Post-materialization integrity `pass`.

- [ ] **Step 4: Production post-checks**

```bash
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true yarn --cwd server scraper:integrity-gate --include-samples --limit=50
SCRAPER_ENV=production CONFIRM_PROD_SCRAPE=true yarn --cwd server source:health --strict
```

Expected:
- Both commands exit `0`, aside from any pre-accepted warning documented before rollout.

---

### Task 8: Final Documentation And Graph Memory

**Files:**
- Modify: `docs/tasks/priority-roadmap.md`
- Modify: `docs/research-model.md`
- Modify: `docs/scraper-audit-guide.md`
- Modify: `graphify-out/GRAPH_REPORT.md`
- Modify: `graphify-out/graph.json`

- [ ] **Step 1: Final roadmap update**

Record:
- Beta run IDs.
- Production run ID if performed.
- Created/updated counts.
- Integrity gate result.
- Source-health result.
- Whether access artifacts remain zero or which reviewed explicit pages produced them.

- [ ] **Step 2: Refresh Graphify**

```bash
graphify update .
```

Expected:
- `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` are updated.
- `graphify-out/graph.html` may remain deleted/skipped if the graph exceeds the HTML visualization node limit.

- [ ] **Step 3: Final verification**

```bash
yarn --cwd server test src/scrapers/__tests__/yaleResearchOfficialScraper.test.ts src/scrapers/__tests__/entityMaterializer.test.ts
npx tsc --noEmit -p server/tsconfig.json
yarn --cwd server scraper:integrity-gate --include-samples --limit=50
yarn --cwd server source:health --strict
```

Expected:
- Focused tests pass.
- Server typecheck exits `0`.
- Integrity gate passes.
- Source health exits `0` with only documented accepted warnings.

---

## Stop Conditions

Stop and investigate before any write if:

- A dry-run emits access/contact/opportunity artifacts from generic directory text.
- Materialization reports conflicts or errors.
- Integrity gate fails.
- Exact-name reuse finds more than one active candidate.
- A detail page parser captures navigation, policy chrome, unrelated contact text, or source-news snippets as entity descriptions.
- A production dry-run count differs materially from Beta without a clear site-content explanation.

## Completion Definition

The ingestion is complete when:

- All listing pages and reviewed detail pages are covered.
- Beta accepted runs have zero materialization errors/conflicts.
- Integrity gate passes after all writes.
- Source health is green except documented unrelated warnings.
- Meili is rebuilt or synced.
- Durable docs record run IDs and modeling boundaries.
- Production rollout is either completed with the same gates or explicitly left as the next tracked roadmap step.
