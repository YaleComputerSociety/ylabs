/**
 * A medical school profile template's own widgets, which a title-only profile flattens
 * into its only text: a MeSH chip run under "Medical Research Interests", an ORCID, the
 * "Research at a Glance" co-author panel, the "Publications Timeline" output chart, and a
 * project card's "View Project" link.
 * Never a description of anyone (#4048). An ORCID iD written out as a number is the
 * template's identifier widget: a person's own prose links an ORCID rather than
 * printing the bare iD after its label.
 */
const PROFILE_TEMPLATE_CHROME =
  /^(?:(?:research\s+)?overview\s+)?medical\s+research\s+interests\b|\b(?:research\s+at\s+a\s+glance|yale\s+co-authors|frequent\s+collaborators\s+of|publications\s+timeline)\b|\ba\s+big-picture\s+view\s+of\s+.{1,80}?\bresearch\s+output\b|\borcid\s+\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i;

const PROJECT_CARD_LINK_LABEL = /\bView Project(?=\s+(?:ORCID|[A-Z])|\s*$)/;

export function isProfileTemplateChrome(value: unknown): boolean {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return (
    Boolean(text) && (PROFILE_TEMPLATE_CHROME.test(text) || PROJECT_CARD_LINK_LABEL.test(text))
  );
}
