import { describe, expect, it } from 'vitest';
import {
  assessDirectoryIndexDescription,
  cleanResearchAreaChrome,
  planDirectoryIndexCleanup,
} from '../clearDirectoryIndexDescriptionsCore';

const AZ_BOILERPLATE =
  'This A–Z index lists Yale School of Medicine lab websites in one place, making it easy to find a specific lab, research group, or program site.';

describe('assessDirectoryIndexDescription', () => {
  it('detects A-Z boilerplate in full and short descriptions', () => {
    const assessment = assessDirectoryIndexDescription({
      id: '1',
      fullDescription: AZ_BOILERPLATE,
      shortDescription: AZ_BOILERPLATE,
    });
    expect(assessment.fullIsChrome).toBe(true);
    expect(assessment.shortIsChrome).toBe(true);
    expect(assessment.hasChromeDescription).toBe(true);
  });

  it('ignores a genuine research description', () => {
    const assessment = assessDirectoryIndexDescription({
      id: '1',
      fullDescription: 'Studies chromatin dynamics and nuclear envelope assembly.',
    });
    expect(assessment.hasChromeDescription).toBe(false);
  });
});

describe('cleanResearchAreaChrome', () => {
  it('recovers glued topics and drops the page chrome (#487)', () => {
    const result = cleanResearchAreaChrome([
      'Nuclear Envelope2 YSM ResearchersView 11 Related PublicationsCell Nucleus6 YSM ResearchersView 7 Related PublicationsChromatin7 YSM ResearchersView 6 Related PublicationsMechanotransduction',
      'Cell Biology',
    ]);
    expect(result.removedChrome).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.cleaned).toEqual([
      'Nuclear Envelope',
      'Cell Nucleus',
      'Chromatin',
      'Mechanotransduction',
      'Cell Biology',
    ]);
  });

  it('dedupes recovered topics against existing clean areas', () => {
    const result = cleanResearchAreaChrome([
      'Endometriosis4 YSM ResearchersView 123 Related Publications',
      'Endometriosis',
    ]);
    expect(result.cleaned).toEqual(['Endometriosis']);
  });

  it('leaves clean areas unchanged', () => {
    const result = cleanResearchAreaChrome(['Immunology', 'Cell Biology']);
    expect(result.changed).toBe(false);
    expect(result.removedChrome).toBe(false);
    expect(result.cleaned).toEqual(['Immunology', 'Cell Biology']);
  });
});

describe('planDirectoryIndexCleanup', () => {
  it('re-derives when a grounded official description is available', () => {
    const plan = planDirectoryIndexCleanup(
      { id: '1', fullDescription: AZ_BOILERPLATE, shortDescription: AZ_BOILERPLATE },
      { fullDescription: 'Studies airway inflammation in asthma.', shortDescription: 'Studies asthma.' },
    );
    expect(plan.descriptionAction).toBe('re-derived');
    expect(plan.reDerivedDescription).toBe(true);
    expect(plan.clearedDescription).toBe(false);
    expect(plan.set.fullDescription).toBe('Studies airway inflammation in asthma.');
    expect(plan.set.shortDescription).toBe('Studies asthma.');
  });

  it('clears the boilerplate when no re-derived description exists', () => {
    const plan = planDirectoryIndexCleanup(
      { id: '1', fullDescription: AZ_BOILERPLATE, shortDescription: AZ_BOILERPLATE },
      null,
    );
    expect(plan.descriptionAction).toBe('cleared');
    expect(plan.clearedDescription).toBe(true);
    expect(plan.set.fullDescription).toBe('');
    expect(plan.set.shortDescription).toBe('');
  });

  it('strips research-area chrome alongside description cleanup', () => {
    const plan = planDirectoryIndexCleanup(
      {
        id: '1',
        fullDescription: AZ_BOILERPLATE,
        researchAreas: ['Natural Language Processing9 YSM ResearchersView 121 Related Publications'],
      },
      null,
    );
    expect(plan.strippedResearchAreas).toBe(true);
    expect(plan.set.researchAreas).toEqual(['Natural Language Processing']);
  });

  it('does nothing for a clean entity', () => {
    const plan = planDirectoryIndexCleanup(
      { id: '1', fullDescription: 'Studies asthma.', researchAreas: ['Immunology'] },
      null,
    );
    expect(plan.descriptionAction).toBe('unchanged');
    expect(Object.keys(plan.set)).toHaveLength(0);
  });
});
