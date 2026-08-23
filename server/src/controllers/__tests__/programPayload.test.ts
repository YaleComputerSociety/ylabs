import { describe, expect, it } from 'vitest';
import { publicProgramForReader } from '../programPayload';

const specificPage =
  'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program';

describe('publicProgramForReader link hygiene (#692)', () => {
  it('drops a bare-root application link and keeps provenance', () => {
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b18d',
      title: 'Research Internship Program',
      applicationLink: 'https://engineering.yale.edu/',
      sourceName: 'yale-college-fellowships-office',
      sourceUrl: specificPage,
      links: [],
    });

    expect(payload.applicationLink).toBeUndefined();
    expect(payload.sourceName).toBe('yale-college-fellowships-office');
    expect(payload.sourceUrl).toBe(specificPage);
  });

  it('keeps a specific application page', () => {
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b18e',
      title: 'Research Internship Program',
      applicationLink: specificPage,
      links: [],
    });

    expect(payload.applicationLink).toBe(specificPage);
  });

  it('filters bare-root and listing links out of the links list', () => {
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b18f',
      title: 'Research Internship Program',
      links: [
        { label: 'Link', url: 'https://engineering.yale.edu/' },
        { label: 'Faculty Directory', url: 'https://engineering.yale.edu/people' },
        { label: 'Research Internship Program', url: specificPage },
      ],
    });

    expect(payload.links).toEqual([{ label: 'Research Internship Program', url: specificPage }]);
  });
});
