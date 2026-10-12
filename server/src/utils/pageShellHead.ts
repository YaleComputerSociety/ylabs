export const PAGE_SHELL_CANONICAL_ORIGIN = 'https://yalelabs.io';
export const PAGE_SHELL_SITE_TITLE = 'y/labs';
export const PAGE_SHELL_DESCRIPTION_MAX_LENGTH = 200;

export interface PageShellHead {
  title?: string;
  description?: string;
  canonicalPath?: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const formatPageShellTitle = (pageTitle: string): string => {
  const trimmed = collapseWhitespace(pageTitle);
  if (!trimmed || trimmed.toLowerCase() === PAGE_SHELL_SITE_TITLE) return PAGE_SHELL_SITE_TITLE;
  return `${trimmed} | ${PAGE_SHELL_SITE_TITLE}`;
};

export const truncatePageShellDescription = (
  description: string,
  maxLength = PAGE_SHELL_DESCRIPTION_MAX_LENGTH,
): string => {
  const text = collapseWhitespace(description);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const wordBoundaryCut = lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut;
  return `${wordBoundaryCut.replace(/[\s,;:.-]+$/, '')}…`;
};

export const canonicalPageUrl = (canonicalPath: string): string =>
  new URL(canonicalPath, PAGE_SHELL_CANONICAL_ORIGIN).toString();

const replaceMetaContent = (
  html: string,
  attribute: 'name' | 'property',
  key: string,
  content: string,
): string => {
  const pattern = new RegExp(`(<meta\\s+${attribute}="${key}"\\s+content=")[^"]*(")`, 'i');
  return html.replace(
    pattern,
    (_match, opening: string, closing: string) => `${opening}${escapeHtml(content)}${closing}`,
  );
};

const replaceTitle = (html: string, title: string): string =>
  html.replace(/<title>[^<]*<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);

const insertBeforeHeadClose = (html: string, markup: string): string =>
  html.replace(/<\/head>/i, () => `${markup}\n  </head>`);

export const renderPageShell = (template: string, head: PageShellHead): string => {
  let html = template;

  if (head.title !== undefined) {
    const pageTitle = formatPageShellTitle(head.title);
    const shareTitle = collapseWhitespace(head.title) || PAGE_SHELL_SITE_TITLE;
    html = replaceTitle(html, pageTitle);
    html = replaceMetaContent(html, 'property', 'og:title', shareTitle);
    html = replaceMetaContent(html, 'name', 'twitter:title', shareTitle);
  }

  if (head.description !== undefined) {
    const description = truncatePageShellDescription(head.description);
    if (description) {
      html = replaceMetaContent(html, 'name', 'description', description);
      html = replaceMetaContent(html, 'property', 'og:description', description);
      html = replaceMetaContent(html, 'name', 'twitter:description', description);
    }
  }

  if (head.canonicalPath !== undefined) {
    const href = escapeHtml(canonicalPageUrl(head.canonicalPath));
    html = insertBeforeHeadClose(
      html,
      `    <meta property="og:url" content="${href}" />\n    <link rel="canonical" href="${href}" />`,
    );
  }

  return html;
};
