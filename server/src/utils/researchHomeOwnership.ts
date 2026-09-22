import { isNonResearchStaffTitle } from './nonResearchStaffTitle';
import { isTraineeLevelTitle } from './traineeLevelTitle';

/**
 * The one server-side composite refusal: a title that cannot own the research home a
 * student would be joining, whether because the person is a trainee (#2876) or holds
 * no research appointment at all (#1897).
 *
 * Exported so the serve-time gate and the retirement lane that acts on the gate's
 * verdict read the same predicate. A future refusal class added here reaches both.
 * `client/src/utils/leadRoleDisplay.ts` mirrors it because client and server are
 * separate packages; parity is pinned by behaviour in a test, per #2433.
 */
export const cannotOwnResearchHome = (title?: string): boolean =>
  isTraineeLevelTitle(title) || isNonResearchStaffTitle(title);
