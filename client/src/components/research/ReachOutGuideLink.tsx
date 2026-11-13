import { Link } from 'react-router-dom';

import { GETTING_STARTED_LINK_LABEL, GETTING_STARTED_PATH } from '../../utils/gettingStartedGuide';

const ReachOutGuideLink = ({ label = GETTING_STARTED_LINK_LABEL }: { label?: string }) => (
  <Link
    to={GETTING_STARTED_PATH}
    className="yr-link yr-focus-ring mt-2 flex min-h-11 w-fit items-center rounded-control text-sm font-semibold underline"
  >
    {label}
  </Link>
);

export default ReachOutGuideLink;
