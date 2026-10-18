import { Link } from 'react-router-dom';

import { GETTING_STARTED_LINK_LABEL, GETTING_STARTED_PATH } from '../../utils/gettingStartedGuide';

const ReachOutGuideLink = () => (
  <Link
    to={GETTING_STARTED_PATH}
    className="yr-link yr-focus-ring mt-2 flex min-h-11 w-fit items-center rounded-control text-sm font-semibold underline"
  >
    {GETTING_STARTED_LINK_LABEL}
  </Link>
);

export default ReachOutGuideLink;
