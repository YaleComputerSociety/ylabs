import { describe, expect, it } from 'vitest';
import { visibleTextFromHtml } from '../../scrapers/yaleProfileDepartureEvidence';
import { headingNameFromHtml } from '../attachDirectoryNamedLeadsCore';
import { extractVisibleText } from '../findLabWebsitesCore';

describe('HTML text extraction decodes each entity once (#5527)', () => {
  it('keeps an escaped entity literal in profile text', () => {
    expect(visibleTextFromHtml('<p>Ada &amp;quot;Lab&amp;quot;</p>')).toBe('Ada &quot;Lab&quot;');
  });

  it('keeps an escaped entity literal in a heading name', () => {
    expect(headingNameFromHtml('<h1>Ada &amp;#39;Lee</h1>')).toBe('Ada &#39;Lee');
  });
});

describe('HTML text extraction drops script blocks with a spaced end tag (#5527)', () => {
  it('removes a script whose end tag carries whitespace', () => {
    const text = extractVisibleText('<body>Ada<script>leak()</script >Lee</body>');
    expect(text).not.toContain('leak');
    expect(text).toContain('Ada');
    expect(text).toContain('Lee');
  });

  it('removes the same block from profile text', () => {
    expect(visibleTextFromHtml('<p>Ada</p><script>leak()</script >')).toBe('Ada');
  });
});
