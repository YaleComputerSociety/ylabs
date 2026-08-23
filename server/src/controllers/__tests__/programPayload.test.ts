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

describe('publicProgramForReader read-time redaction ordering (#774)', () => {
  it('does not leave a token when a raw email is redacted at read time in the summary', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58510',
      title: 'Example Richter Summer Fellowship',
      summary: 'Questions about the fellowship can be directed to grants@example.edu.',
    }) as { summary: string };

    expect(payload.summary).not.toMatch(/redacted/i);
    expect(payload.summary).not.toContain('grants@example.edu');
  });

  it('does not leave a token when a raw email is redacted at read time in the eligibility', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58511',
      title: 'Example Mellon Senior Research Grant',
      eligibility: 'International students should contact taxoffice@example.edu before applying.',
    }) as { eligibility: string };

    expect(payload.eligibility).not.toMatch(/redacted/i);
    expect(payload.eligibility).not.toContain('taxoffice@example.edu');
  });

  it('does not leave a token when a raw email is redacted at read time in applicationInformation', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58512',
      title: 'Example Travel Prize',
      applicationInformation: 'Submit your materials and contact office@example.edu with questions.',
    }) as { applicationInformation: string };

    expect(payload.applicationInformation).not.toMatch(/redacted/i);
    expect(payload.applicationInformation).not.toContain('office@example.edu');
  });
});

const SYNTHETIC_MENTOR_ROSTER_DUMP = [
  'Casey Parker ‘28 Mentor: Dr. Riley Sawyer',
  'Jordan Taylor ‘27 Mentor: Dr. Harper Lee',
  'Dana Robin ’26 Mentor: Dr. Sloan Wren',
  'Rowan Sage ‘25 Mentor: Dr. Skylar Drew',
].join(' ');

const SYNTHETIC_APPLICATION_PARAGRAPH =
  'Applicants should submit a personal statement, an unofficial transcript, and a letter of recommendation from a faculty mentor by the March deadline.';

describe('publicProgramForReader dump/duplicate prose hygiene (#904)', () => {
  it('fails closed on a mentor-roster dump in applicationInformation instead of rendering it verbatim', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58503',
      title: 'Example Mentored Summer Research Program',
      applicationInformation: SYNTHETIC_MENTOR_ROSTER_DUMP,
    });

    expect(payload.applicationInformation).toBe('');
  });

  it('collapses a duplicated applicationInformation paragraph and drops trailing social chrome', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58504',
      title: 'Example Duplicated Instructions Program',
      applicationInformation: `${SYNTHETIC_APPLICATION_PARAGRAPH} ${SYNTHETIC_APPLICATION_PARAGRAPH} Follow us on Instagram @example and Facebook!`,
    });

    expect(payload.applicationInformation).toBe(SYNTHETIC_APPLICATION_PARAGRAPH);
  });

  it('routes eligibility, additionalInformation, restrictionsToUseOfAward, compensationSummary, and bestNextStep through the same dump hygiene', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58505',
      title: 'Example Roster-Dump Program',
      eligibility: SYNTHETIC_MENTOR_ROSTER_DUMP,
      additionalInformation: SYNTHETIC_MENTOR_ROSTER_DUMP,
      restrictionsToUseOfAward: SYNTHETIC_MENTOR_ROSTER_DUMP,
      compensationSummary: SYNTHETIC_MENTOR_ROSTER_DUMP,
      bestNextStep: SYNTHETIC_MENTOR_ROSTER_DUMP,
    });

    expect(payload.eligibility).toBe('');
    expect(payload.additionalInformation).toBe('');
    expect(payload.restrictionsToUseOfAward).toBe('');
    expect(payload.compensationSummary).toBe('');
    expect(payload.bestNextStep).toBe('');
  });

  it('keeps clean prose in these fields unchanged', () => {
    const payload = publicProgramForReader({
      _id: '6982c1cf781efc3253d58506',
      title: 'Example Clean Program',
      eligibility: 'Currently enrolled sophomores and juniors are eligible to apply.',
      compensationSummary: 'Fellows receive a $5,000 stipend for the ten-week program.',
    });

    expect(payload.eligibility).toBe('Currently enrolled sophomores and juniors are eligible to apply.');
    expect(payload.compensationSummary).toBe(
      'Fellows receive a $5,000 stipend for the ten-week program.',
    );
  });
});
