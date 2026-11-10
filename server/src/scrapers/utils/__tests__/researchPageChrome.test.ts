import { describe, expect, it } from 'vitest';
import { gatherCoverageSnippets } from '../../coverageSynthesis';
import { withoutResearchPageChrome } from '../researchPageChrome';

const PROSE = 'The lab studies how coral reefs recover after marine heatwaves.';
const kept = (lines: string[]) => withoutResearchPageChrome(lines.join('\n')).split('\n');

describe('withoutResearchPageChrome (#5577)', () => {
  it('removes skip links, alone or ahead of prose', () => {
    expect(
      kept(['Skip to Main Content', 'Skip to main site navigation Skip to main content', PROSE]),
    ).toEqual([PROSE]);
    expect(kept([`Skip to primary content ${PROSE}`])).toEqual([PROSE]);
  });

  it('removes navigation and menu lines', () => {
    expect(
      kept([
        'Main Menu',
        'Search this site',
        'All news',
        'See All News On Example Medicine',
        'Staff Tools (Login Required)',
        'Terms, Privacy & Notices',
        'Sign up for our newsletter',
        'Careers at Example School',
        'Faculty Open Positions',
        PROSE,
      ]),
    ).toEqual([PROSE]);
  });

  it('removes job advertisement lines and hiring sentences', () => {
    expect(
      kept([
        'Postdoctoral Associate - Coastal Ecology',
        'Postdoctoral Associate in Reef Genomics',
        'Research Associate (Rolling), Field Based - Example Reef Centre',
        'We are hiring a Tenure-Track Assistant Professor in Marine Biology.',
        PROSE,
      ]),
    ).toEqual([PROSE]);
  });

  it('removes donation appeals', () => {
    expect(
      kept([
        'Give Now',
        'Make a Gift',
        'Support Our Students',
        'Donate to Reef Research',
        'Help support the research they do? Make a tax deductible donation today.',
        PROSE,
      ]),
    ).toEqual([PROSE]);
  });

  it('removes cookie and sign-on notices', () => {
    expect(
      kept([
        'Cookies Disabled',
        "Your browser does not support cookies. The browser's ability to store or read cookies is essential for single sign-on to work.",
        'To protect your privacy, quit your web browser when you are finished with your session',
        PROSE,
      ]),
    ).toEqual([PROSE]);
  });

  it('keeps research prose that mentions applying or donating inside a sentence', () => {
    const lines = [
      'Undergraduates may apply now for summer field positions on the reef survey team.',
      'We study why people donate to environmental causes and how donations shape conservation.',
      'Reef Recovery After Heatwaves',
      'NSF CAREER Award (2021)',
      'Research Scientist in Dermatology',
      PROSE,
    ];
    expect(kept(lines)).toEqual(lines);
  });

  it('is what the writer reads from research page text', () => {
    const snippets = gatherCoverageSnippets([
      {
        field: 'researchPageText',
        sourceName: 'research-page-text',
        value: [
          {
            url: 'https://reef.example.edu/research',
            text: ['Skip to main content', 'Give Now', 'Coral Reef Recovery', PROSE].join('\n'),
          },
        ],
      },
    ]);
    expect(snippets.map((snippet) => snippet.text)).toEqual([`Coral Reef Recovery\n${PROSE}`]);
  });
});
