import { describe, expect, it } from 'vitest';

import {
  isPastTraineeResearchSentence,
  isTeachingPracticeStatement,
} from '../../utils/careerBiographyDescription';
import { stripTrailingRelatedContentBlock } from '../../utils/descriptionHygiene';
import { isNonResearchCardSentence } from '../../utils/nonResearchCardSentence';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  servedBodyIsBiographyWithoutResearch,
} from '../researchEntityPublicDescription';

const row = (overrides: Record<string, any>): Record<string, any> => ({
  slug: 'fixture-teaching-as-research',
  name: 'Synthetic Scholar Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: ['Medical Education'],
  sourceUrls: ['https://example.edu/fixture-teaching-as-research'],
  ...overrides,
});

const represent = (entity: Record<string, any>) =>
  buildResearchEntityPublicDescriptionRepresentation({ entity });

describe('teaching practice presented as research', () => {
  const teachingList =
    'Studies the teaching of medical students, the education of psychiatry residents, and the training and supervision of psychoanalysts.';

  it('reads a list whose every object is a teaching practice as teaching', () => {
    expect(isTeachingPracticeStatement(teachingList)).toBe(true);
  });

  it('reads a course the person runs as teaching', () => {
    expect(
      isTeachingPracticeStatement(
        'Professor Example is involved in an annual urban design studio project abroad, collaborating with students from several universities.',
      ),
    ).toBe(true);
  });

  it('keeps education research that states an inquiry or mixes other research', () => {
    expect(isTeachingPracticeStatement('Studies how residents learn diagnostic reasoning.')).toBe(
      false,
    );
    expect(
      isTeachingPracticeStatement(
        'Studies education of pathology residents and medical students, point-of-care testing, and biosafety.',
      ),
    ).toBe(false);
  });

  it('refuses the teaching list as a card and holds a row that states nothing else', () => {
    expect(isNonResearchCardSentence(teachingList)).toBe(true);
    const representation = represent(
      row({ researchAreas: [], shortDescription: teachingList, fullDescription: teachingList }),
    );
    expect(representation.servedCard).toBe('');
    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(true);
  });
});

describe('past or trainee research presented as current work', () => {
  const thesis =
    'Her master’s thesis focused on predictors of prolonged intubation after cardiac surgery.';
  const assisting =
    'In her other research experience, she conducted interviews and assisted in data entry in studies at two schools.';

  it('reads a thesis and assisting work as past trainee research', () => {
    expect(isPastTraineeResearchSentence(thesis)).toBe(true);
    expect(isPastTraineeResearchSentence(assisting)).toBe(true);
    expect(
      isPastTraineeResearchSentence('Her research focuses on ventilator liberation after surgery.'),
    ).toBe(false);
  });

  it('refuses it as a card and holds a row whose body is only that', () => {
    expect(isNonResearchCardSentence(thesis)).toBe(true);
    const representation = represent(
      row({
        researchAreas: [],
        shortDescription: thesis,
        fullDescription: `${thesis} ${assisting}`,
      }),
    );
    expect(representation.servedCard).toBe('');
    expect(servedBodyIsBiographyWithoutResearch(representation)).toBe(true);
  });
});

describe('a bare journal citation card', () => {
  it('is refused even with no author or year', () => {
    expect(isNonResearchCardSentence('Synthetic Development Studies, 51 (4): 362 - 374.')).toBe(
      true,
    );
  });
});

describe('related news headlines after the prose', () => {
  it('drops an unterminated run of glued headlines after a finished sentence', () => {
    const body =
      'Studies quantum error correction and its intersection with many-body physics. With new grant, Example University leads effort to build practical quantum computers A new vision for quantum computing takes a big step forward';

    expect(stripTrailingRelatedContentBlock(body)).toBe(
      'Studies quantum error correction and its intersection with many-body physics.',
    );
  });

  it('drops a labelled related-content block', () => {
    expect(
      stripTrailingRelatedContentBlock(
        'Studies reef ecology. Related Content Example story one Example story two',
      ),
    ).toBe('Studies reef ecology.');
  });

  it('keeps a body whose last sentence simply lacks a period', () => {
    const body = 'Studies reef ecology. Current projects examine coral settlement in warming seas';
    expect(stripTrailingRelatedContentBlock(body)).toBe(body);
  });
});
