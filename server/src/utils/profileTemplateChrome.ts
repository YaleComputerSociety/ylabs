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

/**
 * The template's interface widgets, as opposed to its MeSH chip run: the co-author panel,
 * the publications timeline chart, an empty research-topics panel, a project card's link
 * label and a bare ORCID iD. A
 * MeSH run lists the topics the profile's publications are indexed under, so it is thin
 * but real evidence of what the person studies; the widgets describe no one.
 */
const PROFILE_TEMPLATE_WIDGET_LABELS = [
  /\bresearch\s+at\s+a\s+glance\b/gi,
  /\byale\s+co-authors\b/gi,
  /\b[Ff]requent\s+collaborators\s+of\s+.{1,80}?\bpublished\s+research\b\.?(?=\s+[A-Z]|\s*$)/g,
  /\bpublications\s+timeline\b/gi,
  /\b[Aa]\s+big-picture\s+view\s+of\s+.{1,80}?\bresearch\s+output(?:\s+by\s+year)?\b\.?(?=\s+[A-Z]|\s*$)/g,
  /\bView Project(?=\s+(?:ORCID|[A-Z])|\s*$)/g,
  /\b[Rr]esearch\s+topics\s+.{1,80}?\bis\s+interested\s+in\s+exploring\b\.?(?=\s+[A-Z]|\s*$)/g,
  /\borcid\s+\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/gi,
];

const PROFILE_SECTION_HEADING =
  /^(?:(?:research\s+)?overview\s+)?(?:(?:medical\s+)?research\s+interests|public\s+health\s+interests)?\s*$/i;

/**
 * The value with the template's widget labels removed, or '' when nothing but widgets and
 * section headings is left. A MeSH chip run under its heading is kept.
 */
export function withoutProfileTemplateWidgets(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value;
  for (const label of PROFILE_TEMPLATE_WIDGET_LABELS) text = text.replace(label, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return PROFILE_SECTION_HEADING.test(text) ? '' : text;
}
