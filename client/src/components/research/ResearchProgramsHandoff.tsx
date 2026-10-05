import { Link } from 'react-router-dom';

import { programsSearchHref } from '../../utils/researchProgramsHandoff';

interface ResearchProgramsHandoffProps {
  query: string;
}

const ResearchProgramsHandoff = ({ query }: ResearchProgramsHandoffProps) => (
  <div className="text-sm leading-relaxed">
    <p className="text-muted">
      Programs and fellowships cover getting started, summer research, and paid research.
    </p>
    <Link
      to={programsSearchHref(query)}
      className="yr-link yr-focus-ring -mb-3 mt-1 flex min-h-11 w-fit items-center rounded-control font-semibold underline"
    >
      Search programs and fellowships for &lsquo;{query.trim()}&rsquo;
    </Link>
  </div>
);

export default ResearchProgramsHandoff;
