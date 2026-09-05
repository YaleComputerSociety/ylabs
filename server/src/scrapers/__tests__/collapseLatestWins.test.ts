import { describe, expect, it } from 'vitest';
import { collapseLatestWins, isMateriallyThinnerProseRefresh } from '../observationStore';

interface TestObs {
  field: string;
  sourceName: string;
  observedAt: Date;
  value: string;
}

const obs = (field: string, sourceName: string, day: number, value: string): TestObs => ({
  field,
  sourceName,
  observedAt: new Date(Date.UTC(2026, 0, day)),
  value,
});

describe('collapseLatestWins', () => {
  it('keeps only the newest row per source for a latest-wins field', () => {
    const log: TestObs[] = [
      obs('fullDescription', 'lab-microsite', 1, 'oldest paraphrase'),
      obs('fullDescription', 'lab-microsite', 5, 'newest paraphrase'),
      obs('fullDescription', 'lab-microsite', 3, 'middle paraphrase'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('newest paraphrase');
  });

  it('keeps every row for a non-latest-wins field', () => {
    const log: TestObs[] = [
      obs('name', 'source-a', 1, 'Alpha Lab'),
      obs('name', 'source-b', 2, 'Alpha Laboratory'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result).toHaveLength(2);
  });

  it('keeps one newest row per distinct source for a latest-wins field', () => {
    const log: TestObs[] = [
      obs('shortDescription', 'source-a', 1, 'a-old'),
      obs('shortDescription', 'source-a', 4, 'a-new'),
      obs('shortDescription', 'source-b', 2, 'b-old'),
      obs('shortDescription', 'source-b', 6, 'b-new'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result.map((r) => r.value).sort()).toEqual(['a-new', 'b-new']);
  });

  it('is idempotent', () => {
    const log: TestObs[] = [
      obs('methods', 'source-a', 1, 'old'),
      obs('methods', 'source-a', 3, 'new'),
      obs('name', 'source-a', 1, 'Name One'),
    ];
    const once = collapseLatestWins(log, 'researchEntity');
    const twice = collapseLatestWins(once, 'researchEntity');
    expect(twice).toEqual(once);
  });

  it('treats every fellowship field as latest-wins', () => {
    const log: TestObs[] = [
      obs('title', 'fellowship-source', 1, 'old title'),
      obs('title', 'fellowship-source', 2, 'new title'),
    ];
    const result = collapseLatestWins(log, 'fellowship');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('new title');
  });

  it('preserves original order of surviving rows', () => {
    const log: TestObs[] = [
      obs('name', 'source-a', 1, 'first'),
      obs('fullDescription', 'source-a', 2, 'desc-old'),
      obs('name', 'source-b', 3, 'second'),
      obs('fullDescription', 'source-a', 5, 'desc-new'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result.map((r) => r.value)).toEqual(['first', 'second', 'desc-new']);
  });

  it('is a no-op on an active-only read that holds one row per source-field', () => {
    const activeOnly: TestObs[] = [
      obs('name', 'source-a', 3, 'Alpha Lab'),
      obs('fullDescription', 'source-a', 3, 'a-active'),
      obs('fullDescription', 'source-b', 4, 'b-active'),
      obs('shortDescription', 'source-a', 3, 'a-short'),
    ];
    const result = collapseLatestWins(activeOnly, 'researchEntity');
    expect(result).toEqual(activeOnly);
  });

  it('collapses a lossless full log to the same projection an active-only read yields', () => {
    const activeOnly: TestObs[] = [
      obs('name', 'source-a', 3, 'Alpha Lab'),
      obs('fullDescription', 'source-a', 5, 'a-newest'),
      obs('fullDescription', 'source-b', 6, 'b-newest'),
    ];
    const supersededParaphrases: TestObs[] = [
      obs('fullDescription', 'source-a', 1, 'a-old-paraphrase'),
      obs('fullDescription', 'source-a', 2, 'a-mid-paraphrase'),
      obs('fullDescription', 'source-b', 4, 'b-old-paraphrase'),
    ];
    const fullLog = [...supersededParaphrases, ...activeOnly];
    const collapsedFullLog = collapseLatestWins(fullLog, 'researchEntity');
    const collapsedActiveOnly = collapseLatestWins(activeOnly, 'researchEntity');
    expect(collapsedFullLog.map((r) => [r.field, r.sourceName, r.value]).sort()).toEqual(
      collapsedActiveOnly.map((r) => [r.field, r.sourceName, r.value]).sort(),
    );
  });
});

describe('materially thinner same-source prose refresh (#2423)', () => {
  // Shapes from the Development rows this was measured on (`dept-eeb-eric-sargis`,
  // `dept-econ-francesco-agostinelli`): the same extractor re-read the same page
  // and returned far less of it.
  const RICH =
    'The laboratory studies how chromatin architecture constrains transcriptional responses in differentiating cells, combining single-molecule imaging with targeted degradation of architectural proteins. Current projects map enhancer-promoter contacts during lineage commitment, test whether condensate formation is required for coordinated gene activation, and develop optogenetic tools to perturb these contacts on physiological timescales.';
  const THIN =
    'The laboratory studies chromatin architecture and transcription in differentiating cells.';

  it('keeps the richer earlier capture when the same source later returned much less', () => {
    const log = [
      obs('fullDescription', 'lab-microsite-description-llm', 1, RICH),
      obs('fullDescription', 'lab-microsite-description-llm', 9, THIN),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(RICH);
  });

  it('still lets a same-length refresh win on recency, so the corpus cannot freeze', () => {
    const REWRITTEN = `${RICH.slice(0, RICH.length - 40)} and extend them to primary tissue.`;
    const log = [
      obs('fullDescription', 'lab-microsite-description-llm', 1, RICH),
      obs('fullDescription', 'lab-microsite-description-llm', 9, REWRITTEN),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result[0].value).toBe(REWRITTEN);
  });

  it('lets a richer refresh win, since only a thinner one is held off', () => {
    const RICHER = `${RICH} A fourth project develops computational models of contact dynamics across cell cycles and perturbation regimes.`;
    const log = [
      obs('fullDescription', 'lab-microsite-description-llm', 1, RICH),
      obs('fullDescription', 'lab-microsite-description-llm', 9, RICHER),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result[0].value).toBe(RICHER);
  });

  it('does not reach across sources', () => {
    const log = [
      obs('fullDescription', 'lab-microsite-description-llm', 1, RICH),
      obs('fullDescription', 'yale-research-official', 9, THIN),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result).toHaveLength(2);
  });

  describe('isMateriallyThinnerProseRefresh', () => {
    const compare = (existingValue: string, incomingValue: string) =>
      isMateriallyThinnerProseRefresh({ field: 'fullDescription', existingValue, incomingValue });

    it('fires when the incoming value is materially thinner', () => {
      expect(compare(RICH, THIN)).toBe(true);
    });

    it('does not fire within the material-thinness margin', () => {
      expect(compare(RICH, RICH.slice(0, RICH.length - 100))).toBe(false);
    });

    it('does not retain a career biography just because it is longer', () => {
      const RICH_BIO =
        'Avery Lin received her Ph.D. in molecular biophysics from Stanford University and completed postdoctoral training at the Whitehead Institute before joining the Yale faculty in 2014. She was appointed to an endowed chair in 2021 and is the recipient of several early-career awards for her work on chromatin architecture and transcriptional control.';
      expect(compare(RICH_BIO, THIN)).toBe(false);
    });

    it('does not retain an escaped-HTML citation dump just because it is longer', () => {
      const CITATION_DUMP =
        '<span data-id="165184">Djebra Y</span>, <span data-id="165327">Liu X</span>, <span data-id="165133">Marin T</span>, <span data-id="168637">Dhaynaut M</span>, <span data-id="165201">Petibon Y</span>. Joint reconstruction and motion estimation in respiratory-gated positron emission tomography using a matrix-free approach.';
      expect(compare(CITATION_DUMP, THIN)).toBe(false);
    });

    it('leaves fields outside the quality-guarded set alone', () => {
      expect(
        isMateriallyThinnerProseRefresh({
          field: 'name',
          existingValue: RICH,
          incomingValue: THIN,
        }),
      ).toBe(false);
    });
  });
});
