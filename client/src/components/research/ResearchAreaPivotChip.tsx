import { Link, useLocation } from 'react-router-dom';
import type { MouseEvent } from 'react';

import useConfig from '../../hooks/useConfig';
import { formatTitleCaseLabel } from '../../utils/displayText';
import { buildResearchAreaFilterHref } from '../../utils/researchAreaPivot';

interface ResearchAreaPivotChipProps {
  label: string;
  staticClassName: string;
  interactiveClassName: string;
}

const ResearchAreaPivotChip = ({
  label,
  staticClassName,
  interactiveClassName,
}: ResearchAreaPivotChipProps) => {
  const { getResearchAreaByName } = useConfig();
  const location = useLocation();
  const displayLabel = formatTitleCaseLabel(label);
  const canonicalArea = getResearchAreaByName(label)?.name;

  if (!canonicalArea) {
    return <span className={staticClassName}>{displayLabel}</span>;
  }

  return (
    <Link
      to={buildResearchAreaFilterHref(canonicalArea, location.pathname, location.search)}
      aria-label={`Browse ${displayLabel} research homes`}
      className={interactiveClassName}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
    >
      {displayLabel}
    </Link>
  );
};

export default ResearchAreaPivotChip;
