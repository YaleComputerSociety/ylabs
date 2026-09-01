import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractElementTextWithBlockSeparators, flattenHtmlToText } from '../htmlText';

describe('flattenHtmlToText', () => {
  it('inserts a space between adjacent block paragraphs instead of gluing them', () => {
    const html =
      '<div><p>bending our trajectories toward better recovery.</p>' +
      '<p>In addition to understanding the mechanism</p></div>';
    expect(flattenHtmlToText(html)).toBe(
      'bending our trajectories toward better recovery. In addition to understanding the mechanism',
    );
  });

  it('separates a section heading from the paragraph that follows it', () => {
    const html = '<div><h3>Book Summary</h3><p>Data collected in psychiatry</p></div>';
    expect(flattenHtmlToText(html)).toBe('Book Summary Data collected in psychiatry');
  });

  it('separates run-on education and courses list sections', () => {
    const html =
      '<section>' +
      '<h4>Education</h4>' +
      '<div>Ph.D. Political Science, University of California, Los Angeles, 1999</div>' +
      '<div>B.A. Princeton University, 1991</div>' +
      '<h4>Courses taught</h4>' +
      '<ul><li>Intro to Comparative Politics</li><li>African Politics</li></ul>' +
      '</section>';
    const text = flattenHtmlToText(html);
    expect(text).toContain('Education Ph.D.');
    expect(text).toContain('1999 B.A.');
    expect(text).toContain('1991 Courses taught');
    expect(text).toContain('Intro to Comparative Politics African Politics');
    expect(text).not.toMatch(/1999B\.A\./);
  });

  it('separates a name, title, and department stacked in sibling blocks', () => {
    const html =
      '<div><div>Stanley B. Resor Professor of Economics</div>' +
      '<div>Department of Economics, Yale University</div></div>';
    expect(flattenHtmlToText(html)).toBe(
      'Stanley B. Resor Professor of Economics Department of Economics, Yale University',
    );
  });

  it('treats a <br> as a separator', () => {
    expect(flattenHtmlToText('<p>College of the Holy Cross<br>Download CV</p>')).toBe(
      'College of the Holy Cross Download CV',
    );
  });

  it('separates table cells so a row does not glue into one token', () => {
    expect(flattenHtmlToText('<table><tr><td>Name</td><td>Title</td></tr></table>')).toBe(
      'Name Title',
    );
  });

  it('does not inject whitespace inside inline elements (preserves proper nouns)', () => {
    expect(flattenHtmlToText('<p>we developed <span>SalivaDirect</span> for testing</p>')).toBe(
      'we developed SalivaDirect for testing',
    );
    expect(flattenHtmlToText('<p>partners with <a href="#">AstraZeneca</a> on the trial</p>')).toBe(
      'partners with AstraZeneca on the trial',
    );
    expect(flattenHtmlToText('<p>an <em>Open</em><strong>Yale</strong> course</p>')).toBe(
      'an OpenYale course',
    );
  });

  it('ignores script, style, and noscript content', () => {
    const html =
      '<div><style>.x{color:red}</style><p>Real bio prose here</p>' +
      '<script>var x = 1;</script><noscript>enable js</noscript></div>';
    expect(flattenHtmlToText(html)).toBe('Real bio prose here');
  });

  it('collapses pre-existing whitespace runs to a single space', () => {
    expect(flattenHtmlToText('<p>Zhang   Laboratory\n\tof   Biophysics</p>')).toBe(
      'Zhang Laboratory of Biophysics',
    );
  });

  it('returns empty string for missing or blank input', () => {
    expect(flattenHtmlToText('')).toBe('');
    expect(flattenHtmlToText('   ')).toBe('');
    expect(flattenHtmlToText(null)).toBe('');
    expect(flattenHtmlToText(undefined)).toBe('');
  });

  it('is stable when re-flattening its own output', () => {
    const once = flattenHtmlToText('<div><p>Sentence one.</p><p>Sentence two.</p></div>');
    expect(flattenHtmlToText(once)).toBe(once);
  });
});

describe('extractElementTextWithBlockSeparators', () => {
  it('flattens a single matched element with block separators', () => {
    const $ = cheerio.load(
      '<main><div class="profile-body"><p>First paragraph.</p><p>Second paragraph.</p></div></main>',
    );
    const el = $('[class*="profile-body"]').first()[0];
    expect(extractElementTextWithBlockSeparators(el)).toBe('First paragraph. Second paragraph.');
  });

  it('returns empty string for a missing element', () => {
    expect(extractElementTextWithBlockSeparators(undefined)).toBe('');
    expect(extractElementTextWithBlockSeparators(null)).toBe('');
  });
});
