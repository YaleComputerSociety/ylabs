import * as cheerio from 'cheerio';

/**
 * Whether a fetched person page states no email address of any kind outside its site
 * chrome (#5711).
 *
 * This is the only ground on which a lane may attest `assertsNoValueFor: ['email']`.
 * A lane's own extractor keeps only a person-specific address, so "the extractor found
 * none" also covers an address it refused, and inferring absence from a refusal is what
 * #2647 measured retracting values the page still carries. So the question asked here is
 * the strict one: does the page show any address at all, in a link, in text, in a script
 * or structured-data block, in an attribute, or in an obfuscated or protected form. Any
 * trace keeps the claim unmade.
 *
 * The one exclusion is page-level chrome, a site footer or navigation outside the page's
 * `main` and `article`: nearly every Yale department page prints its office address
 * there, so counting it would leave the claim unmakeable on the pages it exists for.
 * Chrome nested inside the content is still read, because a profile template can put the
 * person's own contact line in an article footer.
 */
const EMAIL_ADDRESS_SHAPE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const OBFUSCATED_AT_SHAPE = /[a-z0-9._%+-]+\s*(?:\[|\(|\{|<)\s*at\s*(?:\]|\)|\}|>)\s*[a-z0-9-]+/i;
const SPELLED_OUT_YALE_ADDRESS_SHAPE =
  /\b[a-z0-9._-]+\s+(?:at|@)\s+yale\s*(?:\.|dot|\[dot\]|\(dot\)|\{dot\})\s*edu\b/i;
const SPELLED_OUT_DOT_EDU_SHAPE = /\byale\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*edu\b/i;
const TEXT_ADDRESS_SHAPES = [
  EMAIL_ADDRESS_SHAPE,
  OBFUSCATED_AT_SHAPE,
  SPELLED_OUT_YALE_ADDRESS_SHAPE,
  SPELLED_OUT_DOT_EDU_SHAPE,
];
const PROTECTED_ADDRESS_SELECTOR = [
  'a[href*="mailto:" i]',
  '[data-cfemail]',
  '.__cf_email__',
  '[href*="email-protection"]',
].join(', ');
const PAGE_CHROME_SELECTOR = [
  'footer',
  'nav',
  '[role="contentinfo"]',
  '[role="navigation"]',
  '[class*="site-footer"]',
  '[id*="site-footer"]',
].join(', ');
const IMAGE_SOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'data-src', 'data-srcset']);

function withoutPageChrome($: cheerio.CheerioAPI): cheerio.CheerioAPI {
  const content = cheerio.load($.html());
  content(PAGE_CHROME_SELECTOR)
    .filter((_index, element) => content(element).closest('main, article').length === 0)
    .remove();
  return content;
}

function someAttributeStatesAnAddress($: cheerio.CheerioAPI): boolean {
  let found = false;
  $('*').each((_index, element) => {
    const attributes = (element as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attributes)) {
      if (IMAGE_SOURCE_ATTRIBUTES.has(name.toLowerCase())) continue;
      if (EMAIL_ADDRESS_SHAPE.test(value)) {
        found = true;
        return false;
      }
    }
    return undefined;
  });
  return found;
}

export function pageStatesNoEmailAddress(page: cheerio.CheerioAPI): boolean {
  const $ = withoutPageChrome(page);
  if ($(PROTECTED_ADDRESS_SELECTOR).length > 0) return false;
  if (someAttributeStatesAnAddress($)) return false;
  const text = $.root().text();
  return !TEXT_ADDRESS_SHAPES.some((shape) => shape.test(text));
}
