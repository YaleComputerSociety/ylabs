import type * as cheerio from 'cheerio';

const MIN_BIOGRAPHY_CHARS = 40;
const RESEARCH_STATEMENT_HEADINGS: readonly RegExp[] = [/^what do you do with data science\??$/i];
const PROFILE_EDIT_LINK = /\/wp-login\.php/i;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function wordpressAuthorProfileBiography($: cheerio.CheerioAPI): string | undefined {
  const description = $('.author-description').first();
  if (!description.length) return undefined;
  const biography: string[] = [];
  let pastHeading = false;
  description.children('p').each((_i, el) => {
    if (pastHeading) return;
    const paragraph = $(el);
    const text = collapseWhitespace(paragraph.text());
    if (!text) return;
    if (RESEARCH_STATEMENT_HEADINGS.some((heading) => heading.test(text))) {
      pastHeading = true;
      return;
    }
    const editsTheProfile =
      paragraph.find('a').filter((_j, a) => PROFILE_EDIT_LINK.test($(a).attr('href') || ''))
        .length > 0;
    if (editsTheProfile) return;
    biography.push(text);
  });
  const text = collapseWhitespace(biography.join(' '));
  return text.length >= MIN_BIOGRAPHY_CHARS ? text : undefined;
}
