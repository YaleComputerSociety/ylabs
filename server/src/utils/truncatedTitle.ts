const DANGLING_TITLE_END = /(?:^|\s)(?:of|for|in|and|&|the|at|to)\s*[,;:–-]?\s*$/i;

/**
 * A title that ends on a connective ("Professor of") lost the field it names, most often
 * because an extractor kept only the text before a linked department (#6426).
 */
export function titleIsTruncated(title: unknown): boolean {
  return typeof title === 'string' && title.trim() !== '' && DANGLING_TITLE_END.test(title);
}
