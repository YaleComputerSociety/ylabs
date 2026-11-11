export const RESEARCHER_REMOVED_REASON = 'researcher_removed';

export const isSuppressedByRemovalRequest = (doc: any): boolean =>
  Array.isArray(doc?.studentVisibilityReasons) &&
  doc.studentVisibilityReasons.includes(RESEARCHER_REMOVED_REASON);

export const isExcludedFromSearchIndex = (doc: any): boolean =>
  doc?.archived === true || isSuppressedByRemovalRequest(doc);
