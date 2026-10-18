const POSTING_HEAD_RE =
  /\b(?:fellowships?|scholarships?|awards?|prizes?|jobs?|vacanc(?:y|ies)|(?:open|post-?doc(?:toral)?|faculty|staff|research)\s+(?:positions?|openings?)|job\s+(?:openings?|postings?)|positions?\s+available)$/i;

const HEAD_COMPLEMENT_RE = /\s+(?:in|for|on|at|with|to)\s+.*$/i;

const headPhrase = (name: string): string =>
  name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/i, '')
    .replace(HEAD_COMPLEMENT_RE, '')
    .replace(/[\s,.;:!-]+$/, '');

/**
 * Whether a name names a fellowship, scholarship, award or job opening rather than a
 * research entity. Only the head phrase is read, the part before an "in", "for" or
 * similar complement, so "<Donor> Postdoctoral Fellowship in <Field>" is a posting while
 * a "Center for Fellowships" or a "Society of Fellows" is an organization.
 */
export function namesAPostingRatherThanResearch(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const head = headPhrase(value);
  return head.length > 0 && POSTING_HEAD_RE.test(head);
}
