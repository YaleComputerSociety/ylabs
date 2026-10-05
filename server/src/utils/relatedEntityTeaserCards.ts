/**
 * Teaser cards for OTHER entities that a page lists beside its own content: a core
 * facility page closing with cards for related cores, a center page listing
 * affiliated centers. Each card is a heading that links to the other entity's own
 * page plus that entity's blurb, so its paragraph is real prose on the page and,
 * without this removal, competes to become the listing page's description. That is
 * how a diagnostics core came to serve another core's metabolomics services (#4809).
 *
 * A card is recognised by shape rather than by one template's class name: an element
 * whose class names a card, teaser or listing item, whose heading is a link, and
 * which sits among siblings of the same class. The listing is what separates a
 * teaser from the page's own content: measured on 668 Development org pages, a
 * linked-heading card alone also matched the page's own single content card on 26
 * of them and removed their real description.
 *
 * Two more shapes describe other things on any page, including a site's own root: a
 * listing whose items link into a news, event or publication collection, and a section
 * opened by a heading such as "Related Centers" or "Upcoming Events" (#4915).
 *
 * A heading link only names another entity when it leaves the page's own path
 * subtree: a lab homepage's cards for its own /research and /people sections are the
 * lab's content, while a core page's cards for sibling cores are not. Without the
 * page's URL that cannot be told apart, so nothing is removed.
 */
import * as cheerio from 'cheerio';

// Whole class tokens naming a card BLOCK ("card", "cores-card", "card--listing",
// "teaser", "listing-item"). A BEM element such as "card__content" is the inside of
// a card, often the page's own hero, so it never counts.
const TEASER_CARD_CLASS_TOKEN =
  /^(?:[a-z0-9]+-)*(?:card|teaser|listing-item|swiper-slide|slick-slide|carousel-item)(?:--[a-z0-9-]+)?$/i;

const LINKED_HEADING_SELECTOR = [
  'h2 a[href]',
  'h3 a[href]',
  'h4 a[href]',
  '[class~="title"] a[href]',
].join(', ');

// A listing item that links into one of these collections is a news, event or
// publication item, which describes itself even on the site's own root (#4915).
const ITEM_COLLECTION_PATH_TOKENS = new Set([
  'news',
  'event',
  'events',
  'journal',
  'essays',
  'articles',
  'stories',
  'blog',
  'posts',
  'press',
  'spotlight',
  'spotlights',
  'features',
  'magazine',
  'podcast',
  'podcasts',
]);

const parseUrl = (value: string, base?: URL): URL | null => {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
};

const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, '');

const linksOutsidePageSubtree = (href: string | undefined, page: URL): boolean => {
  const value = (href || '').trim();
  const target = value ? parseUrl(value, page) : null;
  if (!target || !/^https?:$/.test(target.protocol)) return false;
  if (target.host !== page.host) return true;
  const pagePath = withoutTrailingSlash(page.pathname);
  const targetPath = withoutTrailingSlash(target.pathname);
  return targetPath !== pagePath && !targetPath.startsWith(`${pagePath}/`);
};

const linksToCollectionItem = (href: string | undefined, page: URL): boolean => {
  const value = (href || '').trim();
  const target = value ? parseUrl(value, page) : null;
  if (!target || !/^https?:$/.test(target.protocol)) return false;
  const segments = withoutTrailingSlash(target.pathname).split('/').filter(Boolean);
  return segments.slice(0, -1).some((segment) =>
    segment
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((token) => ITEM_COLLECTION_PATH_TOKENS.has(token)),
  );
};

const linksAwayFromPageSubject = (href: string | undefined, page: URL): boolean =>
  linksOutsidePageSubtree(href, page) || linksToCollectionItem(href, page);

const isTeaserCardBlock = ($: cheerio.CheerioAPI, element: any): boolean =>
  ($(element).attr('class') || '')
    .split(/\s+/)
    .some((token) => TEASER_CARD_CLASS_TOKEN.test(token));

const hasSameShapeSibling = ($: cheerio.CheerioAPI, element: any): boolean => {
  const tag = element.tagName;
  const className = ($(element).attr('class') || '').trim();
  return $(element)
    .siblings()
    .toArray()
    .some(
      (sibling: any) =>
        sibling.tagName === tag && ($(sibling).attr('class') || '').trim() === className,
    );
};

// The repeating unit of a listing is the card itself, or the list item, article or
// row wrapping it when each card is its wrapper's only child.
const isInListingOfCards = ($: cheerio.CheerioAPI, element: any): boolean => {
  if (hasSameShapeSibling($, element)) return true;
  const parent = $(element).parent()[0] as any;
  return Boolean(
    parent &&
    ['li', 'article', 'div'].includes(parent.tagName) &&
    $(parent).children().length === 1 &&
    hasSameShapeSibling($, parent),
  );
};

const relatedEntityTeaserCardElements = ($: cheerio.CheerioAPI, page: URL): any[] =>
  $('[class]')
    .toArray()
    .filter((element) => isTeaserCardBlock($, element))
    .filter((element) => isInListingOfCards($, element))
    .filter((element) =>
      $(element)
        .find(LINKED_HEADING_SELECTOR)
        .toArray()
        .some((anchor) => linksAwayFromPageSubject($(anchor).attr('href'), page)),
    );

const OTHER_SUBJECT_REGION_HEADING =
  /^(?:related (?:centers|programs|units|labs|groups|cores|initiatives|institutes|departments|organizations|content|stories|news|links)|keep exploring|explore more|you may also like|more (?:stories|news)|featured (?:news|stories|events|articles)|in the spotlight|(?:latest |recent |in the )?news|(?:upcoming |recent |past )?events|news (?:and|&) events|from the blog|announcements)$/;

const comparableHeading = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();

const REGION_HEADINGS = 'h1, h2, h3, h4';

/**
 * A page region headed as being about other things: related units, featured news, events.
 * The region is the section or aside that heading opens, never one holding the page's
 * title or opened by another heading, so the page's own content is never removed.
 */
const otherSubjectRegionElements = ($: cheerio.CheerioAPI): any[] =>
  $('h2, h3, h4')
    .toArray()
    .filter((heading) => OTHER_SUBJECT_REGION_HEADING.test(comparableHeading($(heading).text())))
    .map((heading) => ({ heading, region: $(heading).closest('section, aside')[0] }))
    .filter(
      ({ heading, region }) =>
        region &&
        $(region).find('h1').length === 0 &&
        $(region).find(REGION_HEADINGS).first()[0] === heading,
    )
    .map(({ region }) => region);

const otherSubjectElements = ($: cheerio.CheerioAPI, page: URL): any[] => [
  ...otherSubjectRegionElements($),
  ...relatedEntityTeaserCardElements($, page),
];

export function removeRelatedEntityTeaserCards($: cheerio.CheerioAPI, pageUrl?: string): void {
  const page = pageUrl ? parseUrl(pageUrl) : null;
  if (!page) return;
  otherSubjectElements($, page).forEach((element) => {
    $(element).remove();
  });
}

const comparableText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const OPENING_WORDS = 12;

/**
 * Whether a description is another unit's teaser blurb on this page: its opening
 * appears inside one of the page's related-unit teaser cards and nowhere in the
 * page's own text. A lane that stored such a description before teaser cards were
 * removed (#4823) can then retract it, because re-reading the page shows the text
 * was never this page's own.
 */
export function isRelatedEntityTeaserTextOnPage(
  html: string,
  pageUrl: string,
  description: string,
): boolean {
  const page = parseUrl(pageUrl);
  const opening = comparableText(description).split(' ').slice(0, OPENING_WORDS).join(' ');
  if (!page || opening.split(' ').length < OPENING_WORDS) return false;
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const teasers = otherSubjectElements($, page);
  if (!teasers.some((element) => comparableText($(element).text()).includes(opening))) return false;
  teasers.forEach((element) => {
    $(element).remove();
  });
  return !comparableText($('body').text()).includes(opening);
}
