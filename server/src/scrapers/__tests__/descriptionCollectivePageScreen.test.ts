import { describe, expect, it } from 'vitest';
import { isLlmDescriptionFromDepartmentCollectivePage } from '../descriptionSourceOwnership';
import { planCollectivePageStoredDescriptionClears } from '../refusedStoredDescription';
import { isRejectedDescriptionSourceUrl } from '../sources/labMicrositeDescriptionLLMExtractor';

const jobsBoard = 'https://economics.yale.edu/undergraduate/employment-opportunities';
const hiringPage = 'https://medicine.yale.edu/childstudy/about/jobs/';
const trainingPage =
  'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/';

describe('a model-written description citing a department page', () => {
  it.each([jobsBoard, hiringPage, trainingPage])('is dropped from resolution: %s', (sourceUrl) => {
    expect(
      isLlmDescriptionFromDepartmentCollectivePage({
        field: 'fullDescription',
        sourceName: 'lab-microsite-undergrad-llm',
        sourceUrl,
      }),
    ).toBe(true);
  });

  it('is refused at emit', () => {
    expect(isRejectedDescriptionSourceUrl(jobsBoard)).toBe(true);
  });

  it('keeps a roster lane description read off a department page', () => {
    expect(
      isLlmDescriptionFromDepartmentCollectivePage({
        field: 'fullDescription',
        sourceName: 'dept-faculty-roster',
        sourceUrl: jobsBoard,
      }),
    ).toBe(false);
  });

  it('keeps a research group writing about its own openings', () => {
    const ownOpenings = 'https://example-lab.yale.edu/job-opportunities/research-opportunities';
    expect(
      isLlmDescriptionFromDepartmentCollectivePage({
        field: 'fullDescription',
        sourceName: 'lab-microsite-undergrad-llm',
        sourceUrl: ownOpenings,
      }),
    ).toBe(false);
    expect(isRejectedDescriptionSourceUrl(ownOpenings)).toBe(false);
  });

  it('leaves non-description fields alone', () => {
    expect(
      isLlmDescriptionFromDepartmentCollectivePage({
        field: 'joinPageUrl',
        sourceName: 'lab-microsite-undergrad-llm',
        sourceUrl: jobsBoard,
      }),
    ).toBe(false);
  });
});

describe('a model-written description that names the row it describes', () => {
  it('is kept even when it cites a department page', () => {
    expect(
      isLlmDescriptionFromDepartmentCollectivePage(
        {
          field: 'fullDescription',
          sourceName: 'lab-microsite-undergrad-llm',
          sourceUrl: jobsBoard,
          value: 'Professor Example studies labor markets and schooling.',
        },
        'Alex Example Faculty Research',
      ),
    ).toBe(false);
  });

  it('is dropped when it narrates the department instead', () => {
    expect(
      isLlmDescriptionFromDepartmentCollectivePage(
        {
          field: 'fullDescription',
          sourceName: 'lab-microsite-undergrad-llm',
          sourceUrl: jobsBoard,
          value: 'The department researches questions in macroeconomics.',
        },
        'Alex Example Faculty Research',
      ),
    ).toBe(true);
  });
});

describe('clearing a stored description narrated from a department page', () => {
  const provenance = { sourceName: 'lab-microsite-undergrad-llm', sourceUrl: jobsBoard };

  it('clears both fields when neither names the row', () => {
    const clears = planCollectivePageStoredDescriptionClears({
      stored: {
        name: 'Alex Example Faculty Research',
        fullDescription: 'The department researches questions in macroeconomics.',
        shortDescription: 'Focuses on macroeconomics.',
        fieldProvenance: { fullDescription: provenance, shortDescription: provenance },
      },
      lockedFields: [],
    });
    expect(clears.map((clear) => clear.field).sort()).toEqual([
      'fullDescription',
      'shortDescription',
    ]);
  });

  it('keeps the card while a same-page body that names the row survives', () => {
    const clears = planCollectivePageStoredDescriptionClears({
      stored: {
        name: 'Alex Example Faculty Research',
        fullDescription: "Alex Example's research studies child health.",
        shortDescription: 'Research focuses on child health.',
        fieldProvenance: { fullDescription: provenance, shortDescription: provenance },
      },
      lockedFields: [],
    });
    expect(clears).toEqual([]);
  });

  it('leaves a field this pass staged anew', () => {
    const clears = planCollectivePageStoredDescriptionClears({
      stored: {
        name: 'Alex Example Faculty Research',
        fullDescription: 'The department researches questions in macroeconomics.',
        fieldProvenance: { fullDescription: provenance },
      },
      staged: { fullDescription: 'A different body from another lane.' },
      lockedFields: [],
    });
    expect(clears).toEqual([]);
  });

  it('reports rather than clears a locked field', () => {
    const [clear] = planCollectivePageStoredDescriptionClears({
      stored: {
        name: 'Alex Example Faculty Research',
        fullDescription: 'The department researches questions in macroeconomics.',
        fieldProvenance: { fullDescription: provenance },
      },
      lockedFields: ['fullDescription'],
    });
    expect(clear).toEqual({ field: 'fullDescription', skipped: 'field-is-locked' });
  });
});
