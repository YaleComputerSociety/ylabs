export type EndedAppointmentLeadMode = 'observe' | 'hide';

/**
 * Whether a lead whose own official page states only an appointment that has ended is treated
 * as departed (#5721). It hides for a reason other than death, so it observes until a blind
 * check of sampled cases clears the bar: the evidence is recorded and reported, and the row,
 * its leads and their email stay as they are. Read here and nowhere else; a deceased lead is
 * not governed by it.
 */
export const ENDED_APPOINTMENT_LEAD_MODE: EndedAppointmentLeadMode = 'observe';
