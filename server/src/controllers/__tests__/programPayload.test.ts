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

  it('drops same-host nav/footer chrome links shallower than the source page (#633 residual)', () => {
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b190',
      title: 'Research Internship Program',
      sourceUrl: specificPage,
      links: [
        { label: 'Apply', url: 'https://engineering.yale.edu/apply' },
        { label: 'Give Back', url: 'https://engineering.yale.edu/give' },
        { label: 'Contact Us', url: 'https://engineering.yale.edu/contact-us' },
        {
          label: 'Undergraduate',
          url: 'https://engineering.yale.edu/academic-study/undergraduate',
        },
        { label: 'Research Internship Program details', url: specificPage },
      ],
    });

    expect(payload.links).toEqual([
      { label: 'Research Internship Program details', url: specificPage },
    ]);
  });

  it('rejects a misleading same-host Apply link even as applicationLink', () => {
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b191',
      title: 'Research Internship Program',
      applicationLink: 'https://engineering.yale.edu/apply',
      sourceUrl: specificPage,
      links: [],
    });

    expect(payload.applicationLink).toBeUndefined();
  });

  it('drops nav/footer chrome links by label and breadcrumb arrow (#633)', () => {
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b192',
      title: 'Research Internship Program',
      links: [
        { label: 'Experience Overview >', url: 'https://engineering.yale.edu/school-experience' },
        { label: 'Faculty Directory', url: 'https://engineering.yale.edu/faculty-directory' },
        { label: 'Accessibility >', url: 'https://www.yale.edu/accessibility' },
        { label: 'Privacy Policy >', url: 'https://www.yale.edu/privacy-policy' },
        { label: 'Give Back >', url: 'https://www.yale.edu/give-back' },
        { label: 'Contact Us >', url: 'https://www.yale.edu/contact-us' },
        { label: 'Research Internship Program', url: specificPage },
      ],
    });

    expect(payload.links).toEqual([{ label: 'Research Internship Program', url: specificPage }]);
  });

  it('caps the links list as a backstop against bloated arrays (#633)', () => {
    const links = Array.from({ length: 40 }, (_, index) => ({
      label: `Program Page ${index}`,
      url: `${specificPage}-${index}`,
    }));
    const payload = publicProgramForReader({
      _id: '6a6f84d074dd496b1d43b193',
      title: 'Tobin Undergraduate Research Assistantships',
      links,
    });

    expect(payload.links).toHaveLength(8);
  });
});

describe('publicProgramForReader redaction placeholder hygiene (#671 residual)', () => {
  it('strips a stray [email redacted] token out of the summary field', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58500',
      title: 'Example Summer Fellowship',
      summary: 'The confirmation should be sent to: [email redacted]',
    });

    expect(payload.summary).toBe('The confirmation should be sent');
  });

  it('strips a stray [email redacted] token out of the eligibility field', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58501',
      title: 'Example Senior Research Grant',
      eligibility:
        'If you are an international student, please contact [email redacted] in the Tax Office.',
    });

    expect(payload.eligibility).toBe(
      'If you are an international student, please in the Tax Office.',
    );
  });

  it('strips a stray [email redacted] token out of the applicationInformation field', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58502',
      title: 'Example Albert Bildner Travel Prize',
      applicationInformation: 'Submit your materials and email [email redacted] with questions.',
    });

    expect(payload.applicationInformation).toBe('Submit your materials and with questions.');
  });
});
