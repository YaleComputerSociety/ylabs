# Programs And Fellowships Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evidence-first scraper and data pipeline for official Yale programs and fellowships, while only promoting genuinely structured research-entry programs into pathways and posted opportunities.

**Architecture:** Reuse the existing scraper system: source adapters emit append-only `fellowship` Observations, the existing fellowship materializer writes canonical `/programs` rows, and a new guarded access bridge creates `ResearchEntity`, `EntryPathway`, `PostedOpportunity`, `AccessSignal`, and `ContactRoute` only for source-backed structured-entry programs. Most fellowships remain funding/planning records rather than fake research-entry pathways.

**Tech Stack:** TypeScript, Node, Mongoose, Cheerio, Vitest, existing scraper CLI, MongoDB Observations, canonical `Fellowship` storage behind `/api/programs`.

---

## File Structure

- Create `server/src/scrapers/programCandidate.ts`: shared normalization, source-key, deadline, category, fingerprint, and observation conversion helpers for program/fellowship scrapers.
- Create `server/src/scrapers/__tests__/programCandidate.test.ts`: focused tests for reusable candidate helpers.
- Modify `server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts`: keep source-specific HTML discovery there, but delegate shared candidate behavior to `programCandidate.ts`.
- Modify `server/src/scrapers/__tests__/yaleCollegeFellowshipsOfficeScraper.test.ts`: preserve current behavior and add regression coverage that the refactor emits identical observations.
- Create `server/src/scrapers/sources/officialYaleProgramsScraper.ts`: a small multi-source official Yale adapter for selected public program pages that are not in the Yale College Fellowships Office catalog.
- Create `server/src/scrapers/__tests__/officialYaleProgramsScraper.test.ts`: parser tests for structured-entry and funding-only program examples.
- Modify `server/src/scrapers/registry.ts`: register the new source.
- Modify `server/src/scrapers/seedSources.ts` and `server/src/scrapers/sourceCoverageRegistry.ts`: seed source metadata and coverage claims.
- Modify `server/src/models/fellowship.ts`: add conservative metadata fields needed by the access bridge.
- Modify `server/src/services/fellowshipApplicationCycleEvidenceService.ts`: expose the new metadata in cycle/access evidence.
- Modify `server/src/scrapers/entityMaterializer.ts`: materialize the new fields and call a guarded bridge after fellowship materialization.
- Create `server/src/scrapers/programAccessBridge.ts`: convert only structured-entry program rows into first-class research access artifacts.
- Create `server/src/scrapers/__tests__/programAccessBridge.test.ts`: unit tests for funding-only suppression and structured-entry promotion.
- Modify `docs/research-model.md`, `docs/scraper-deployment-runbook.md`, and `docs/tasks/priority-roadmap.md`: document the pipeline, source posture, and task outcome.

---

### Task 1: Shared Program Candidate Helper

**Files:**
- Create: `server/src/scrapers/programCandidate.ts`
- Create: `server/src/scrapers/__tests__/programCandidate.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add `server/src/scrapers/__tests__/programCandidate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildProgramSourceKey,
  candidateToProgramObservations,
  finalizeProgramCandidate,
  inferProgramAccessRole,
  parseProgramDeadlineToUtcEndOfDay,
} from '../programCandidate';

describe('programCandidate', () => {
  it('builds stable source keys from source name and title', () => {
    expect(buildProgramSourceKey('official-yale-programs', 'Wu Tsai Undergraduate Fellowship')).toBe(
      'official-yale-programs:wu-tsai-undergraduate-fellowship',
    );
  });

  it('parses exact Month Day Year deadlines and rejects fuzzy cycle text', () => {
    expect(
      parseProgramDeadlineToUtcEndOfDay(
        'Applications are due Monday, February 9, 2026 at 5:00pm.',
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toEqual(new Date('2026-02-09T23:59:59.999Z'));
    expect(
      parseProgramDeadlineToUtcEndOfDay(
        'The deadline is usually in early February.',
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).toBeUndefined();
  });

  it('classifies mentor-matching and internship programs as structured entry', () => {
    expect(
      inferProgramAccessRole(
        'Undergraduate Fellowship',
        'Students are matched with Yale faculty mentors for a summer research project.',
      ),
    ).toBe('MENTOR_MATCHING');
    expect(
      inferProgramAccessRole(
        'Museum Internship Program',
        'Paid summer internships place students in collections research projects.',
      ),
    ).toBe('HOSTED_INTERNSHIP');
  });

  it('keeps general grants as funding-only', () => {
    expect(
      inferProgramAccessRole(
        'Dean’s Research Fellowship',
        'Provides funding for student-designed research with a faculty adviser.',
      ),
    ).toBe('FUNDING_ONLY');
  });

  it('emits fellowship observations with access-role metadata', () => {
    const candidate = finalizeProgramCandidate({
      sourceName: 'official-yale-programs',
      title: 'Wu Tsai Undergraduate Fellowship',
      sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      summary: 'Students work with faculty mentors.',
      description: 'Students are matched with Yale faculty mentors for summer research.',
      applicationLink: 'https://wti.yale.edu/apply',
      links: [{ label: 'Apply', url: 'https://wti.yale.edu/apply' }],
      deadline: new Date('2026-02-09T23:59:59.999Z'),
      applicationOpenDate: undefined,
      contactOffice: 'Wu Tsai Institute',
      contactEmail: undefined,
      yearOfStudy: [],
      termOfAward: ['Summer'],
      purpose: ['Research'],
      globalRegions: [],
      citizenshipStatus: [],
      isAcceptingApplications: true,
      reviewRequired: false,
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programAccessRole: 'MENTOR_MATCHING',
      hostedByResearchEntityName: 'Wu Tsai Institute',
      hostedByResearchEntityUrl: 'https://wti.yale.edu',
    });

    expect(candidate.sourceKey).toBe('official-yale-programs:wu-tsai-undergraduate-fellowship');
    expect(candidate.sourceFingerprint).toHaveLength(64);
    expect(candidateToProgramObservations(candidate)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'fellowship', field: 'programAccessRole', value: 'MENTOR_MATCHING' }),
        expect.objectContaining({ entityType: 'fellowship', field: 'hostedByResearchEntityName', value: 'Wu Tsai Institute' }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run helper tests and confirm failure**

Run:

```bash
yarn --cwd server test -- programCandidate.test.ts
```

Expected: fail because `server/src/scrapers/programCandidate.ts` does not exist.

- [ ] **Step 3: Implement shared helper**

Create `server/src/scrapers/programCandidate.ts` with exported helpers and types. Use the existing `FellowshipCatalogCandidate` shape as the base, plus:

```ts
export type ProgramAccessRole =
  | 'FUNDING_ONLY'
  | 'STRUCTURED_ENTRY'
  | 'HOSTED_INTERNSHIP'
  | 'MENTOR_MATCHING'
  | 'UNKNOWN';
```

The implementation must:

- Use the same slug behavior as the existing Yale fellowship scraper.
- Use SHA-256 for `sourceFingerprint`.
- Emit `ObservationInput[]` with `entityType: 'fellowship'`.
- Include new observations for `programCategory`, `programAccessRole`, `hostedByResearchEntityName`, and `hostedByResearchEntityUrl` when present.
- Parse exact `Month Day, Year` deadlines as UTC end-of-day.
- Return `FUNDING_ONLY` when text says only funding, grant, stipend, award, proposal, adviser, or student-designed project.
- Return `MENTOR_MATCHING` when text includes mentor matching or matched with faculty mentors.
- Return `HOSTED_INTERNSHIP` when text includes internship placement language.
- Return `STRUCTURED_ENTRY` when text says students join a cohort, lab placement, research placement, or hosted research program.

- [ ] **Step 4: Run helper tests and confirm pass**

Run:

```bash
yarn --cwd server test -- programCandidate.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/scrapers/programCandidate.ts server/src/scrapers/__tests__/programCandidate.test.ts
git commit -m "feat: add program candidate scraper helpers"
```

---

### Task 2: Refactor Existing Fellowship Office Scraper Onto Shared Helper

**Files:**
- Modify: `server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts`
- Modify: `server/src/scrapers/__tests__/yaleCollegeFellowshipsOfficeScraper.test.ts`

- [ ] **Step 1: Add regression test for emitted metadata**

In `server/src/scrapers/__tests__/yaleCollegeFellowshipsOfficeScraper.test.ts`, extend the existing observation test with:

```ts
expect(observations).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      entityType: 'fellowship',
      field: 'programCategory',
      value: 'FELLOWSHIP',
    }),
    expect.objectContaining({
      entityType: 'fellowship',
      field: 'programAccessRole',
      value: 'FUNDING_ONLY',
    }),
  ]),
);
```

- [ ] **Step 2: Run scraper tests and confirm failure**

Run:

```bash
yarn --cwd server test -- yaleCollegeFellowshipsOfficeScraper.test.ts
```

Expected: fail because the existing scraper does not emit the new metadata.

- [ ] **Step 3: Refactor imports and candidate shape**

In `server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts`:

- Import `finalizeProgramCandidate`, `candidateToProgramObservations`, and `parseProgramDeadlineToUtcEndOfDay`.
- Keep source-specific URL filtering and HTML parsing in this file.
- Replace local fingerprint/source-key/deadline/observation helpers with the shared helper.
- Ensure each candidate sets:

```ts
programCategory: 'FELLOWSHIP',
programAccessRole: inferProgramAccessRole(title, `${summary || ''} ${description || ''}`),
```

For this scraper, default ambiguous rows to `FUNDING_ONLY` unless source text includes mentor-matching, hosted internship, cohort placement, or structured research placement language.

- [ ] **Step 4: Run scraper tests and confirm pass**

Run:

```bash
yarn --cwd server test -- yaleCollegeFellowshipsOfficeScraper.test.ts programCandidate.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/scrapers/sources/yaleCollegeFellowshipsOfficeScraper.ts server/src/scrapers/__tests__/yaleCollegeFellowshipsOfficeScraper.test.ts
git commit -m "refactor: share program candidate normalization"
```

---

### Task 3: Add Official Yale Programs Source Adapter

**Files:**
- Create: `server/src/scrapers/sources/officialYaleProgramsScraper.ts`
- Create: `server/src/scrapers/__tests__/officialYaleProgramsScraper.test.ts`
- Modify: `server/src/scrapers/registry.ts`
- Modify: `server/src/scrapers/seedSources.ts`
- Modify: `server/src/scrapers/sourceCoverageRegistry.ts`

- [ ] **Step 1: Write parser tests**

Create `server/src/scrapers/__tests__/officialYaleProgramsScraper.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  OfficialYaleProgramsScraper,
  parseOfficialYaleProgramPage,
} from '../sources/officialYaleProgramsScraper';

describe('OfficialYaleProgramsScraper', () => {
  it('extracts a mentor-matching summer research program', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <main>
          <h1>Wu Tsai Undergraduate Fellowship</h1>
          <p>Undergraduates are matched with Yale faculty mentors for an intensive summer research project.</p>
          <p>Applications are due February 9, 2026.</p>
          <a href="/apply">Apply</a>
        </main>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        hostedByResearchEntityName: 'Wu Tsai Institute',
        hostedByResearchEntityUrl: 'https://wti.yale.edu',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        title: 'Wu Tsai Undergraduate Fellowship',
        programAccessRole: 'MENTOR_MATCHING',
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        applicationLink: 'https://wti.yale.edu/apply',
        deadline: new Date('2026-02-09T23:59:59.999Z'),
      }),
    ]);
  });

  it('extracts a hosted center internship', () => {
    const candidates = parseOfficialYaleProgramPage(
      `
        <main>
          <h1>Digital Humanities Lab Summer Internship</h1>
          <p>Students join paid internships supporting digital humanities research projects.</p>
          <a href="https://library.yale.edu/digital-humanities-laboratory/apply">Application</a>
        </main>
      `,
      {
        sourceName: 'official-yale-programs',
        pageUrl: 'https://library.yale.edu/digital-humanities-laboratory/internships',
        programCategory: 'CENTER_INTERNSHIP',
        hostedByResearchEntityName: 'Digital Humanities Lab',
        hostedByResearchEntityUrl: 'https://library.yale.edu/digital-humanities-laboratory',
      },
      new Date('2026-01-01T00:00:00Z'),
    );

    expect(candidates[0]).toMatchObject({
      programAccessRole: 'HOSTED_INTERNSHIP',
      programCategory: 'CENTER_INTERNSHIP',
      reviewRequired: true,
    });
  });

  it('emits observations through the scraper run without fetching application portals', async () => {
    const fetchPage = vi.fn(async () => `
      <main>
        <h1>Research Placement Program</h1>
        <p>Students join a cohort and are placed into research teams.</p>
        <a href="https://example.yale.edu/apply">Apply</a>
      </main>
    `);
    const emitted: any[] = [];
    const scraper = new OfficialYaleProgramsScraper({
      pages: [
        {
          url: 'https://example.yale.edu/program',
          programCategory: 'RECURRING_PROGRAM',
          hostedByResearchEntityName: 'Example Yale Center',
          hostedByResearchEntityUrl: 'https://example.yale.edu',
        },
      ],
      fetchPage,
    });

    const result = await scraper.run({
      scrapeRunId: '665000000000000000000001',
      sourceId: '665000000000000000000002',
      sourceName: 'official-yale-programs',
      sourceWeight: 0.9,
      options: { dryRun: false, useCache: false, release: false },
      emit: async (input) => {
        emitted.push(...(Array.isArray(input) ? input : [input]));
      },
      log: () => {},
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'fellowship', field: 'programAccessRole', value: 'STRUCTURED_ENTRY' }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run source tests and confirm failure**

Run:

```bash
yarn --cwd server test -- officialYaleProgramsScraper.test.ts
```

Expected: fail because the source file does not exist.

- [ ] **Step 3: Implement source adapter**

Create `server/src/scrapers/sources/officialYaleProgramsScraper.ts`:

- Export `OFFICIAL_YALE_PROGRAMS_SOURCE = 'official-yale-programs'`.
- Export `parseOfficialYaleProgramPage(html, config, referenceDate)`.
- Default pages should be a short, explicit array of high-confidence official pages, not a crawler:

```ts
[
  {
    url: 'https://wti.yale.edu/initiatives/undergraduate',
    programCategory: 'SUMMER_RESEARCH_PROGRAM',
    hostedByResearchEntityName: 'Wu Tsai Institute',
    hostedByResearchEntityUrl: 'https://wti.yale.edu',
  },
  {
    url: 'https://library.yale.edu/digital-humanities-laboratory',
    programCategory: 'CENTER_INTERNSHIP',
    hostedByResearchEntityName: 'Digital Humanities Lab',
    hostedByResearchEntityUrl: 'https://library.yale.edu/digital-humanities-laboratory',
  },
]
```

- Use Cheerio to read `h1`, body text, and public links.
- Use `finalizeProgramCandidate` and `candidateToProgramObservations`.
- Do not fetch application links or external portals.
- Respect `ctx.options.limit`.

- [ ] **Step 4: Register and seed source metadata**

Modify `server/src/scrapers/registry.ts`:

```ts
import { OfficialYaleProgramsScraper } from './sources/officialYaleProgramsScraper';
```

and register it in `buildOrchestrator()`:

```ts
o.register(new OfficialYaleProgramsScraper());
```

Modify `server/src/scrapers/seedSources.ts` by adding:

```ts
{
  name: 'official-yale-programs',
  displayName: 'Official Yale Programs',
  description: 'Curated official Yale program pages for structured undergraduate research programs, internships, and fellowships outside the central fellowship catalog.',
  baseUrl: '',
  defaultWeight: 0.9,
  cadence: 'weekly',
}
```

Modify `server/src/scrapers/sourceCoverageRegistry.ts` by adding `official-yale-programs` with artifact types `Fellowship`, `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, `PostedOpportunity`, and `Observation`; evidence categories `ENTITY_IDENTITY`, `APPLICATION_LINK`, `OFFICIAL_CONTACT_ROUTE`, `POSTED_OPENING`, and `FELLOWSHIP_COMPATIBILITY`.

- [ ] **Step 5: Run tests and source list check**

Run:

```bash
yarn --cwd server test -- officialYaleProgramsScraper.test.ts registry.test.ts sourceCoverageRegistry.test.ts
yarn scrape list
```

Expected: tests pass and `official-yale-programs` appears in the scraper list.

- [ ] **Step 6: Commit**

```bash
git add server/src/scrapers/sources/officialYaleProgramsScraper.ts server/src/scrapers/__tests__/officialYaleProgramsScraper.test.ts server/src/scrapers/registry.ts server/src/scrapers/seedSources.ts server/src/scrapers/sourceCoverageRegistry.ts
git commit -m "feat: add official Yale programs scraper"
```

---

### Task 4: Add Program Access Metadata To Materialization

**Files:**
- Modify: `server/src/models/fellowship.ts`
- Modify: `server/src/scrapers/entityMaterializer.ts`
- Modify: `server/src/services/fellowshipApplicationCycleEvidenceService.ts`
- Modify: `server/src/scrapers/__tests__/entityMaterializer.test.ts`
- Modify: `server/src/services/__tests__/fellowshipApplicationCycleEvidenceService.test.ts`

- [ ] **Step 1: Write failing materializer tests**

Add to `server/src/scrapers/__tests__/entityMaterializer.test.ts`:

```ts
it('materializes program access metadata onto fellowship rows', () => {
  const patch = buildFellowshipUpdateFromObservations(
    'official-yale-programs:wu-tsai-undergraduate-fellowship',
    [
      {
        field: 'title',
        value: 'Wu Tsai Undergraduate Fellowship',
        sourceName: 'official-yale-programs',
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      },
      {
        field: 'programAccessRole',
        value: 'MENTOR_MATCHING',
        sourceName: 'official-yale-programs',
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      },
      {
        field: 'hostedByResearchEntityName',
        value: 'Wu Tsai Institute',
        sourceName: 'official-yale-programs',
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      },
    ],
  );

  expect(patch.update.$set).toMatchObject({
    programAccessRole: 'MENTOR_MATCHING',
    hostedByResearchEntityName: 'Wu Tsai Institute',
  });
});
```

- [ ] **Step 2: Write failing cycle-evidence test**

Add to `server/src/services/__tests__/fellowshipApplicationCycleEvidenceService.test.ts`:

```ts
it('marks structured-entry programs as supporting pathway promotion', () => {
  const evidence = buildFellowshipApplicationCycleEvidence(
    {
      title: 'Wu Tsai Undergraduate Fellowship',
      programAccessRole: 'MENTOR_MATCHING',
      applicationLink: 'https://wti.yale.edu/apply',
      links: [{ label: 'Apply', url: 'https://wti.yale.edu/apply' }],
      isAcceptingApplications: true,
      deadline: new Date('2026-02-09T23:59:59.999Z'),
    },
    new Date('2026-01-01T00:00:00Z'),
  );

  expect(evidence.supportsStructuredResearchEntry).toBe(true);
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
yarn --cwd server test -- entityMaterializer.test.ts fellowshipApplicationCycleEvidenceService.test.ts
```

Expected: fail because fields and evidence output do not exist.

- [ ] **Step 4: Add schema fields**

Modify `server/src/models/fellowship.ts`:

```ts
programAccessRole: {
  type: String,
  enum: ['FUNDING_ONLY', 'STRUCTURED_ENTRY', 'HOSTED_INTERNSHIP', 'MENTOR_MATCHING', 'UNKNOWN'],
  default: 'UNKNOWN',
},
hostedByResearchEntityName: {
  type: String,
  default: '',
},
hostedByResearchEntityUrl: {
  type: String,
  default: '',
},
```

Add indexes:

```ts
fellowshipSchema.index({ programAccessRole: 1 });
fellowshipSchema.index({ hostedByResearchEntityName: 1 });
```

- [ ] **Step 5: Materialize new fields**

Modify `FELLOWSHIP_MATERIALIZED_FIELDS` in `server/src/scrapers/entityMaterializer.ts` to include:

```ts
'programAccessRole',
'hostedByResearchEntityName',
'hostedByResearchEntityUrl',
```

- [ ] **Step 6: Extend application cycle evidence**

Modify `server/src/services/fellowshipApplicationCycleEvidenceService.ts`:

- Add `supportsStructuredResearchEntry: boolean` to `FellowshipApplicationCycleEvidence`.
- Compute it as true only when `programAccessRole` is `STRUCTURED_ENTRY`, `HOSTED_INTERNSHIP`, or `MENTOR_MATCHING` and a source URL or application route exists.
- Do not set it true for `FUNDING_ONLY`.

- [ ] **Step 7: Run tests and confirm pass**

Run:

```bash
yarn --cwd server test -- entityMaterializer.test.ts fellowshipApplicationCycleEvidenceService.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/models/fellowship.ts server/src/scrapers/entityMaterializer.ts server/src/services/fellowshipApplicationCycleEvidenceService.ts server/src/scrapers/__tests__/entityMaterializer.test.ts server/src/services/__tests__/fellowshipApplicationCycleEvidenceService.test.ts
git commit -m "feat: track structured program access metadata"
```

---

### Task 5: Guarded Program Access Bridge

**Files:**
- Create: `server/src/scrapers/programAccessBridge.ts`
- Create: `server/src/scrapers/__tests__/programAccessBridge.test.ts`
- Modify: `server/src/scrapers/entityMaterializer.ts`

- [ ] **Step 1: Write bridge tests**

Create `server/src/scrapers/__tests__/programAccessBridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildProgramAccessBridgeInputs, materializeProgramAccessBridge } from '../programAccessBridge';

describe('programAccessBridge', () => {
  it('does not promote funding-only fellowships', () => {
    expect(
      buildProgramAccessBridgeInputs({
        _id: '665000000000000000000001',
        title: 'Dean’s Research Fellowship',
        sourceUrl: 'https://science.yalecollege.yale.edu/fellowship',
        programAccessRole: 'FUNDING_ONLY',
        programCategory: 'FELLOWSHIP',
      } as any),
    ).toEqual({ skipped: 'funding-only' });
  });

  it('builds pathway, signal, contact route, and posted opportunity inputs for mentor matching programs', () => {
    const inputs = buildProgramAccessBridgeInputs({
      _id: '665000000000000000000001',
      title: 'Wu Tsai Undergraduate Fellowship',
      summary: 'Students are matched with faculty mentors.',
      sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
      applicationLink: 'https://wti.yale.edu/apply',
      deadline: new Date('2026-02-09T23:59:59.999Z'),
      isAcceptingApplications: true,
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      programAccessRole: 'MENTOR_MATCHING',
      hostedByResearchEntityName: 'Wu Tsai Institute',
      hostedByResearchEntityUrl: 'https://wti.yale.edu',
    } as any);

    expect(inputs).toMatchObject({
      researchEntity: {
        name: 'Wu Tsai Institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://wti.yale.edu',
      },
      entryPathway: {
        pathwayType: 'RECURRING_PROGRAM',
        status: 'ACTIVE',
        studentFacingLabel: 'Structured research program',
        compensation: 'FELLOWSHIP',
      },
      accessSignal: {
        signalType: 'APPLICATION_FORM_EXISTS',
      },
      contactRoute: {
        routeType: 'OFFICIAL_APPLICATION',
        contactPolicy: 'APPLICATION_ONLY',
      },
      postedOpportunity: {
        title: 'Wu Tsai Undergraduate Fellowship',
        status: 'OPEN',
        applicationUrl: 'https://wti.yale.edu/apply',
      },
    });
  });

  it('upserts bridge artifacts through injected services', async () => {
    const researchEntityModel = {
      findOneAndUpdate: vi.fn().mockResolvedValue({ _id: '665000000000000000000010' }),
    };
    const entryPathwayService = vi.fn().mockResolvedValue({ _id: '665000000000000000000020' });
    const accessSignalService = vi.fn().mockResolvedValue({ _id: '665000000000000000000030' });
    const contactRouteService = vi.fn().mockResolvedValue({ _id: '665000000000000000000040' });
    const postedOpportunityModel = {
      updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
    };

    const result = await materializeProgramAccessBridge(
      {
        _id: '665000000000000000000001',
        title: 'Wu Tsai Undergraduate Fellowship',
        sourceUrl: 'https://wti.yale.edu/initiatives/undergraduate',
        applicationLink: 'https://wti.yale.edu/apply',
        isAcceptingApplications: true,
        programCategory: 'SUMMER_RESEARCH_PROGRAM',
        programAccessRole: 'MENTOR_MATCHING',
        hostedByResearchEntityName: 'Wu Tsai Institute',
        hostedByResearchEntityUrl: 'https://wti.yale.edu',
      } as any,
      {
        researchEntityModel: researchEntityModel as any,
        upsertEntryPathway: entryPathwayService as any,
        upsertAccessSignal: accessSignalService as any,
        upsertContactRoute: contactRouteService as any,
        postedOpportunityModel: postedOpportunityModel as any,
      },
    );

    expect(result).toEqual({
      skipped: undefined,
      researchEntities: 1,
      entryPathways: 1,
      accessSignals: 1,
      contactRoutes: 1,
      postedOpportunities: 1,
    });
    expect(researchEntityModel.findOneAndUpdate).toHaveBeenCalled();
    expect(entryPathwayService).toHaveBeenCalled();
    expect(postedOpportunityModel.updateOne).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run bridge tests and confirm failure**

Run:

```bash
yarn --cwd server test -- programAccessBridge.test.ts
```

Expected: fail because bridge module does not exist.

- [ ] **Step 3: Implement bridge builder**

Create `server/src/scrapers/programAccessBridge.ts`:

- Export `buildProgramAccessBridgeInputs(fellowship)`.
- Return `{ skipped: 'funding-only' }` for `FUNDING_ONLY`.
- Return `{ skipped: 'missing-host' }` when structured programs lack `hostedByResearchEntityName`.
- Use a stable entity slug derived from hosted name.
- Map hosted programs to `ResearchEntity.entityType`:
  - URL/name containing institute -> `INSTITUTE`
  - center -> `CENTER`
  - lab/library/museum/digital humanities -> `CENTER` or `ARCHIVE_OR_MUSEUM_PROJECT` when obvious
  - otherwise `PROGRAM`
- Map pathway type:
  - `HOSTED_INTERNSHIP` -> `CENTER_INTERNSHIP`
  - `MENTOR_MATCHING` or `STRUCTURED_ENTRY` -> `RECURRING_PROGRAM`
- Use derivation keys:
  - `program:<fellowshipId>:pathway`
  - `program:<fellowshipId>:signal:application`
  - `program:<fellowshipId>:route:official-application`
  - `program:<fellowshipId>:opportunity`
- Create posted opportunities only when there is an application URL or a source URL and the program is active, rolling, or source-backed recurring.

- [ ] **Step 4: Implement bridge materializer**

In `programAccessBridge.ts`, export `materializeProgramAccessBridge(fellowship, deps, options)`.

Use injected deps for tests and defaults for runtime:

```ts
ResearchEntity.findOneAndUpdate
upsertEntryPathway
upsertAccessSignal
upsertContactRoute
PostedOpportunity.updateOne
```

Use `$setOnInsert` for entity identity fields and `$set` for source-backed freshness fields. Do not overwrite manually reviewed fields.

- [ ] **Step 5: Call bridge after fellowship materialization**

Modify `materializeFellowshipObservationsFromRun` in `server/src/scrapers/entityMaterializer.ts`:

- After each fellowship create/update, load the materialized fellowship document.
- Call `materializeProgramAccessBridge` only when `patch.update.$set.programAccessRole` is structured-entry-like.
- Respect `options.dryRun`.
- Add bridge counts to returned metrics or `postMaterializationMetrics`.

- [ ] **Step 6: Run bridge and materializer tests**

Run:

```bash
yarn --cwd server test -- programAccessBridge.test.ts entityMaterializer.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/scrapers/programAccessBridge.ts server/src/scrapers/__tests__/programAccessBridge.test.ts server/src/scrapers/entityMaterializer.ts
git commit -m "feat: bridge structured programs into access artifacts"
```

---

### Task 6: CLI Smoke, Data-Quality Gates, And Documentation

**Files:**
- Modify: `docs/research-model.md`
- Modify: `docs/scraper-deployment-runbook.md`
- Modify: `docs/tasks/priority-roadmap.md`

- [ ] **Step 1: Run focused server tests**

Run:

```bash
yarn --cwd server test -- programCandidate.test.ts yaleCollegeFellowshipsOfficeScraper.test.ts officialYaleProgramsScraper.test.ts programAccessBridge.test.ts entityMaterializer.test.ts fellowshipApplicationCycleEvidenceService.test.ts registry.test.ts sourceCoverageRegistry.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc --noEmit -p server/tsconfig.json
```

Expected: pass.

- [ ] **Step 3: Run scraper dry-run smoke**

Run:

```bash
yarn scrape run --source official-yale-programs --dry-run --use-cache --limit 2
```

Expected:

- `entitiesObserved` is greater than 0 when configured pages are reachable or cached.
- No application portal URLs are fetched.
- Run report shows `fellowship` observations only during dry run.

- [ ] **Step 4: Run existing fellowship-office dry-run smoke**

Run:

```bash
yarn scrape run --source yale-college-fellowships-office --dry-run --use-cache --limit 3
```

Expected:

- Existing candidates still parse.
- Observations include `programCategory` and `programAccessRole`.
- CommunityForce links remain stored as application links, not fetch targets.

- [ ] **Step 5: Update durable docs**

In `docs/research-model.md`, add a concise note:

```md
Program and fellowship ingestion uses `Fellowship` storage behind `/programs` for public program records. Most fellowship rows remain funding or planning records. Only rows with source-backed `programAccessRole` values of `STRUCTURED_ENTRY`, `HOSTED_INTERNSHIP`, or `MENTOR_MATCHING` may materialize into first-class `ResearchEntity`, `EntryPathway`, `AccessSignal`, `ContactRoute`, and `PostedOpportunity` artifacts.
```

In `docs/scraper-deployment-runbook.md`, add the dry-run and promotion sequence:

```md
For program/fellowship sources, run dry-run parser checks first, review application/deadline/source metadata, then run non-production writes with auto-materialization. Confirm funding-only rows do not create access artifacts, and structured-entry rows create at most one pathway, one application signal, one official route, and one posted-opportunity instance per source-backed program cycle.
```

In `docs/tasks/priority-roadmap.md`, add a completion note under the scraper/product workstream after implementation:

```md
- [x] Added the official programs/fellowships ingestion lane. Shared program candidate helpers now normalize source-backed rows, `official-yale-programs` covers curated structured-entry pages, and only source-backed structured-entry programs bridge into research access artifacts while funding-only fellowships remain `/programs` planning records.
```

- [ ] **Step 6: Refresh Graphify**

Run:

```bash
graphify update .
```

Expected: graph update completes without errors.

- [ ] **Step 7: Review final diff**

Run:

```bash
git diff --stat
git diff -- server/src/scrapers/programCandidate.ts server/src/scrapers/sources/officialYaleProgramsScraper.ts server/src/scrapers/programAccessBridge.ts server/src/scrapers/entityMaterializer.ts server/src/models/fellowship.ts docs/research-model.md docs/scraper-deployment-runbook.md docs/tasks/priority-roadmap.md
```

Expected:

- No unrelated client changes.
- No secrets or environment values.
- No broad crawler behavior.
- No funding-only fellowship creates access artifacts.

- [ ] **Step 8: Commit**

```bash
git add server/src docs/research-model.md docs/scraper-deployment-runbook.md docs/tasks/priority-roadmap.md graphify-out
git commit -m "feat: add programs and fellowships ingestion pipeline"
```

---

## Self-Review

- Spec coverage: The plan covers shared normalization, the existing Yale College Fellowships Office scraper, additional official Yale program pages, materialization fields, conservative access promotion, tests, docs, and Graphify refresh.
- Scope check: This plan intentionally does not build a broad web crawler, external fellowship LLM scraper, admin review UI, or production Render cron setup. Those should follow after this official-source lane is stable.
- Type consistency: The plan uses one `programAccessRole` vocabulary across scraper candidates, `Fellowship`, application-cycle evidence, and the access bridge.
- Risk control: Funding-only fellowships stay in `/programs`; only source-backed structured-entry records produce access artifacts.
