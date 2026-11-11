export type DeceasedLeadRowPresentation = 'hide' | 'label';

/**
 * How a row is presented when every current lead's own official page marks them deceased
 * (#5721). This is an owner decision, so it is read here and nowhere else, and it fails closed
 * to hiding the row until the owner chooses to show it labelled.
 */
export const DECEASED_LEAD_ROW_PRESENTATION: DeceasedLeadRowPresentation = 'hide';
