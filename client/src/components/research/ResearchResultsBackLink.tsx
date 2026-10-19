import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '../shared/icons';
import {
  readResearchResultsReturn,
  researchResultsHref,
  type ResearchResultsReturn,
} from '../../utils/researchResultsReturn';

const isPlainPrimaryClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const backLinkLabel = (resultsReturn: ResearchResultsReturn | null): string => {
  if (!resultsReturn) return 'Browse all research';
  return new URLSearchParams(resultsReturn.search).toString()
    ? 'Back to results'
    : 'Back to research';
};

const ResearchResultsBackLink = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const resultsReturn = readResearchResultsReturn(location.state);

  const returnThroughHistory = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!resultsReturn || !isPlainPrimaryClick(event)) return;
    event.preventDefault();
    void navigate(-resultsReturn.depth);
  };

  return (
    <Link
      to={researchResultsHref(resultsReturn)}
      onClick={returnThroughHistory}
      className="yr-link yr-focus-ring -ml-1 mb-1 flex min-h-11 w-fit items-center gap-1.5 rounded-control px-1 text-sm font-semibold sm:mb-2"
    >
      {resultsReturn && <ArrowLeftIcon className="shrink-0" />}
      {backLinkLabel(resultsReturn)}
    </Link>
  );
};

export default ResearchResultsBackLink;
