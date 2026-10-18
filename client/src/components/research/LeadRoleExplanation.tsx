import { Link } from 'react-router-dom';

import { GETTING_STARTED_PATH, WHAT_IS_A_PI_SECTION_ID } from '../../utils/gettingStartedGuide';

const LeadRoleExplanation = ({ plural = false }: { plural?: boolean }) => (
  <p className="-mt-2 mb-3 text-xs leading-relaxed text-muted">
    {plural
      ? 'The faculty members who lead this research.'
      : 'The faculty member who leads this research.'}{' '}
    <Link
      to={`${GETTING_STARTED_PATH}#${WHAT_IS_A_PI_SECTION_ID}`}
      className="yr-link yr-focus-ring rounded-control underline"
    >
      What a PI does
    </Link>
  </p>
);

export default LeadRoleExplanation;
