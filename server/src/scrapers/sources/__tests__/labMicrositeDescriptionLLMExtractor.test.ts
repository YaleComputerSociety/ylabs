import { describe, it, expect } from 'vitest';
import { htmlToText, isRejectedDescriptionSourceUrl } from '../labMicrositeDescriptionLLMExtractor';

describe('isRejectedDescriptionSourceUrl', () => {
  it('rejects the YSM A–Z index landing page so its boilerplate is never a lab description', () => {
    expect(
      isRejectedDescriptionSourceUrl('https://medicine.yale.edu/about/a-to-z-index/lab-websites/'),
    ).toBe(true);
    expect(
      isRejectedDescriptionSourceUrl(
        'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
      ),
    ).toBe(true);
  });

  it('accepts a genuine per-lab microsite page', () => {
    expect(isRejectedDescriptionSourceUrl('https://medicine.yale.edu/lab/chupp/')).toBe(false);
    expect(isRejectedDescriptionSourceUrl('https://zimmermanlab.yale.edu/')).toBe(false);
  });

  it('still rejects directory and non-descriptive source pages', () => {
    expect(isRejectedDescriptionSourceUrl('https://medicine.yale.edu/people/')).toBe(true);
    expect(isRejectedDescriptionSourceUrl('https://reporter.nih.gov/project-details/123')).toBe(true);
    expect(isRejectedDescriptionSourceUrl('not-a-url')).toBe(true);
  });

  it('rejects a department-wide undergrad research opportunities hub page (#1716)', () => {
    expect(
      isRejectedDescriptionSourceUrl(
        'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      ),
    ).toBe(true);
    expect(
      isRejectedDescriptionSourceUrl('https://mcdb.yale.edu/undergraduate/undergrad-degree-programs'),
    ).toBe(true);
  });
});

describe('htmlToText block-boundary spacing for the LLM prompt (#1776)', () => {
  it('inserts a space between adjacent paragraphs instead of gluing them', () => {
    expect(
      htmlToText('<body><p>About David Simon.</p><p>His research focuses on genocide.</p></body>'),
    ).toBe('About David Simon. His research focuses on genocide.');
  });

  it('separates a section heading from the paragraph that follows it', () => {
    expect(htmlToText('<body><h2>About</h2><p>David Simon studies genocide.</p></body>')).toBe(
      'About David Simon studies genocide.',
    );
  });

  it('still strips script, style, nav, and footer chrome before flattening', () => {
    expect(
      htmlToText(
        '<body><nav>Menu</nav><script>var x = 1;</script><p>Real bio prose here.</p><footer>Contact</footer></body>',
      ),
    ).toBe('Real bio prose here.');
  });
});
