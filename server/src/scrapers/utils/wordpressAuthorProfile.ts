import type * as cheerio from 'cheerio';

export interface WordpressAuthorProfileSections {
  biography?: string;
  researchStatement?: string;
}

const MIN_SECTION_CHARS = 40;
const RESEARCH_STATEMENT_HEADINGS: readonly RegExp[] = [/^what do you do with data science\??$/i];
const PROFILE_EDIT_LINK = /\/wp-login\.php/i;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const keptText = (paragraphs: readonly string[]): string | undefined => {
  const text = collapseWhitespace(paragraphs.join(' '));
  return text.length >= MIN_SECTION_CHARS ? text : undefined;
};

export function wordpressAuthorProfileSections(
  $: cheerio.CheerioAPI,
): WordpressAuthorProfileSections | undefined {
  const description = $('.author-description').first();
  if (!description.length) return undefined;
  const biography: string[] = [];
  const statement: string[] = [];
  let pastHeading = false;
  description.children('p').each((_i, el) => {
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
    (pastHeading ? statement : biography).push(text);
  });
  return { biography: keptText(biography), researchStatement: keptText(statement) };
}

export function wordpressAuthorProfileBiography($: cheerio.CheerioAPI): string | undefined {
  return wordpressAuthorProfileSections($)?.biography;
}
