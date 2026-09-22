/**
 * Whether a title names an administrative, financial, technical or courtesy staff
 * appointment rather than a research appointment at all.
 *
 * A programme manager, a data analyst, a lab technician or a research affiliate can
 * be indispensable to a research home without owning one, so a row whose only lead
 * holds such a title does not describe an access route a student can take (#1897).
 *
 * Deliberately excludes the Yale research-scientist and research-scholar ladder.
 * That ladder runs from Associate Research Scientist to Senior Research Scientist and
 * independence is not readable from the string, so a title regex cannot decide it; the
 * measurement behind that exclusion is recorded on #1897. A supervisory title exempts
 * the person for the same reason it does in `traineeLevelTitle`.
 *
 * Duplicated in `client/src/utils/leadRoleDisplay.ts` because client and server are
 * separate packages; parity is pinned by behaviour in a test, per #2433.
 */
const NON_RESEARCH_STAFF_TITLE_PATTERN =
  /\b(programmer|analyst|biostatistician|statistician|coordinator|manager|administrator|technician|specialist|research affiliates?)\b/i;
const SUPERVISORY_TITLE_PATTERN = /\b(professor|lecturer|director|dean|chair)\b/i;
const RESEARCH_APPOINTMENT_TITLE_PATTERN = /\bresearch (?:scientist|scholar|associate)\b/i;

export const isNonResearchStaffTitle = (title?: string): boolean => {
  const normalized = (title || '').trim();
  if (!normalized) return false;
  if (SUPERVISORY_TITLE_PATTERN.test(normalized)) return false;
  if (RESEARCH_APPOINTMENT_TITLE_PATTERN.test(normalized)) return false;
  return NON_RESEARCH_STAFF_TITLE_PATTERN.test(normalized);
};
