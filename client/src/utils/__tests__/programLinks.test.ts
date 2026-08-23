import { describe, expect, it } from 'vitest';

import {
  buildSafeProgramLinks,
  isChromeLinkLabel,
  isGenericAdmissionsApplyLink,
  isSameHostShallowChromeUrl,
  MAX_RENDERED_PROGRAM_LINKS,
} from '../programLinks';

describe('isChromeLinkLabel', () => {
  it('rejects nav and footer boilerplate labels', () => {
    for (const label of [
      'Campus Life',
      "Dean's Message",
      'Accessibility >',
      'Privacy Policy',
      'Give Back >',
      'Contact Us >',
      'Faculty Directory',
      'Faculty Openings',
      'Experience Overview >',
      'Yale Engineering Magazine',
      'Strategic Vision',
      'About Us',
      'Services',
      'Training',
    ]) {
      expect(isChromeLinkLabel(label)).toBe(true);
    }
  });

  it('keeps genuine program and application labels', () => {
    for (const label of [
      'Research Internship Program',
      'Application form',
      'Summer research application',
      'Program guidelines',
    ]) {
      expect(isChromeLinkLabel(label)).toBe(false);
    }
  });
});

describe('isGenericAdmissionsApplyLink', () => {
  it('flags a bare top-level admissions apply link surfaced as an application', () => {
    expect(
      isGenericAdmissionsApplyLink({ label: 'Apply', url: 'https://engineering.yale.edu/apply' }),
    ).toBe(true);
  });

  it('keeps a program-specific application path', () => {
    expect(
      isGenericAdmissionsApplyLink({
        label: 'Apply',
        url: 'https://engineering.yale.edu/undergraduate-study/research-internship-program/apply',
      }),
    ).toBe(false);
  });
});

describe('isSameHostShallowChromeUrl', () => {
  const sourceUrl = 'https://engineering.yale.edu/undergraduate-study/research-internship-program';

  it('rejects same-host nav/footer chrome no deeper than the program source page', () => {
    expect(
      isSameHostShallowChromeUrl(
        'https://engineering.yale.edu/school-experience/whats-next',
        sourceUrl,
      ),
    ).toBe(true);
    expect(isSameHostShallowChromeUrl('https://engineering.yale.edu/apply', sourceUrl)).toBe(true);
    expect(isSameHostShallowChromeUrl('https://engineering.yale.edu/give', sourceUrl)).toBe(true);
    expect(isSameHostShallowChromeUrl('https://engineering.yale.edu/contact-us', sourceUrl)).toBe(
      true,
    );
  });

  it('keeps the source page, off-host links, and program-detail keyword paths', () => {
    expect(isSameHostShallowChromeUrl(sourceUrl, sourceUrl)).toBe(false);
    expect(isSameHostShallowChromeUrl('https://engineering.yale.edu/', sourceUrl)).toBe(false);
    expect(
      isSameHostShallowChromeUrl(
        'https://apply.communityforce.com/Funds/FundDetails.aspx?id=9',
        sourceUrl,
      ),
    ).toBe(false);
    expect(
      isSameHostShallowChromeUrl(
        'https://engineering.yale.edu/summer-research-fellowships',
        sourceUrl,
      ),
    ).toBe(false);
  });

  it('does nothing without a source page context', () => {
    expect(isSameHostShallowChromeUrl('https://engineering.yale.edu/apply', undefined)).toBe(false);
  });
});

describe('buildSafeProgramLinks', () => {
  it('drops a scraped site nav and footer dump down to genuine links', () => {
    const links = [
      { label: 'Experience Overview >', url: 'https://engineering.yale.edu/school-experience' },
      { label: 'Campus Life', url: 'https://engineering.yale.edu/campus-life' },
      { label: 'Faculty Directory', url: 'https://engineering.yale.edu/faculty' },
      { label: 'Faculty Openings', url: 'https://engineering.yale.edu/openings' },
      { label: 'Yale Engineering Magazine', url: 'https://engineering.yale.edu/magazine' },
      { label: "Dean's Message", url: 'https://engineering.yale.edu/dean' },
      { label: 'Accessibility >', url: 'https://usability.yale.edu' },
      { label: 'Privacy Policy >', url: 'https://privacy.yale.edu' },
      { label: 'Give Back >', url: 'https://engineering.yale.edu/give' },
      { label: 'Contact Us >', url: 'https://engineering.yale.edu/contact' },
      { label: 'Apply', url: 'https://engineering.yale.edu/apply' },
      {
        label: 'Research Internship Program',
        url: 'https://engineering.yale.edu/undergraduate-study/research-internship-program',
      },
    ];

    const result = buildSafeProgramLinks(links);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Research Internship Program');
  });

  it('hides the section entirely when the raw set still looks like a page menu', () => {
    const links = Array.from({ length: MAX_RENDERED_PROGRAM_LINKS + 1 }, (_unused, index) => ({
      label: `Program resource ${index}`,
      url: `https://example.edu/resource-${index}`,
    }));

    expect(buildSafeProgramLinks(links)).toEqual([]);
  });

  it('renders a handful of genuine links unchanged', () => {
    const links = [
      { label: 'Application form', url: 'https://studentgrants.yale.edu/apply/form' },
      { label: 'Program details page', url: 'https://example.edu/program' },
    ];

    const result = buildSafeProgramLinks(links);
    expect(result.map((link) => link.href)).toEqual([
      'https://studentgrants.yale.edu/apply/form',
      'https://example.edu/program',
    ]);
  });

  it('drops an unenumerated same-host nav link that the label denylist misses (#871)', () => {
    const sourceUrl =
      'https://engineering.yale.edu/undergraduate-study/research-internship-program';
    const links = [
      {
        label: 'Research Internship Program',
        url: 'https://engineering.yale.edu/undergraduate-study/research-internship-program',
      },
      {
        label: "Our Mantra / What's Next",
        url: 'https://engineering.yale.edu/school-experience/whats-next',
      },
    ];

    const result = buildSafeProgramLinks(links, sourceUrl);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Research Internship Program');
  });

  it('drops links with unsafe urls', () => {
    expect(
      buildSafeProgramLinks([{ label: 'Unsafe', url: 'data:text/html,<script>alert(1)</script>' }]),
    ).toEqual([]);
  });
});
