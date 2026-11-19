import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { pageStatesNoEmailAddress } from '../pageStatesNoEmailAddress';

const page = (main: string, chrome = '') =>
  cheerio.load(
    `<html><head><title>Rowan Quillfeather</title></head><body>${chrome}<main><h1>Rowan Quillfeather</h1>${main}</main></body></html>`,
  );

describe('pageStatesNoEmailAddress (#5711)', () => {
  it('holds for a person page that states no address anywhere', () => {
    expect(pageStatesNoEmailAddress(page('<p>Professor of Fixture Studies</p>'))).toBe(true);
  });

  it('ignores an office address in the site footer and navigation outside the content', () => {
    const chrome = `<nav><a href="mailto:office.fixture@yale.edu">Contact</a></nav>`;
    const footer = `<footer class="site-footer">office.fixture@yale.edu</footer>`;
    const $ = cheerio.load(
      `<html><body>${chrome}<main><h1>Rowan Quillfeather</h1></main>${footer}</body></html>`,
    );
    expect(pageStatesNoEmailAddress($)).toBe(true);
  });

  it('reads a footer nested inside the article, where a template can put the person contact', () => {
    expect(
      pageStatesNoEmailAddress(
        page('<article><footer>rowan.quillfeather@yale.edu</footer></article>'),
      ),
    ).toBe(false);
  });

  it.each([
    ['a mailto link', '<a href="mailto:rq1@yale.edu">Email</a>'],
    ['a plain address in text', '<p>Write to rowan.quillfeather@yale.edu</p>'],
    ['an address of another domain', '<p>rowan@fixture.example.org</p>'],
    ['a bracketed at', '<p>rowan.quillfeather [at] yale [dot] edu</p>'],
    ['a spelled-out address', '<p>rq1 at yale dot edu</p>'],
    ['a Cloudflare-protected address', '<a class="__cf_email__" data-cfemail="0a1b2c">[email]</a>'],
    ['a protection link', '<a href="/cdn-cgi/l/email-protection#0a1b">[email]</a>'],
    ['an address in an attribute', '<span data-contact="rq1@yale.edu"></span>'],
    [
      'an address in structured data',
      '<script type="application/ld+json">{"@type":"Person","email":"rq1@yale.edu"}</script>',
    ],
  ])('does not hold when the content carries %s', (_label, html) => {
    expect(pageStatesNoEmailAddress(page(html))).toBe(false);
  });

  it('does not read an image density suffix as an address', () => {
    expect(
      pageStatesNoEmailAddress(page('<img src="/portrait@2x.png" srcset="/portrait@3x.png 3x">')),
    ).toBe(true);
  });
});
