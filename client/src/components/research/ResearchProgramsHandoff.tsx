import { Link } from 'react-router-dom';

import { programsSearchHref } from '../../utils/researchProgramsHandoff';

interface ResearchProgramsHandoffProps {
  query: string;
}

const ResearchProgramsHandoff = ({ query }: ResearchProgramsHandoffProps) => (
  <p className="text-sm leading-relaxed text-muted">
    Programs and fellowships cover getting started, summer research, and paid research.{' '}
    <Link
      to={programsSearchHref(query)}
      className="yr-focus-ring font-semibold text-brand underline underline-offset-2"
    >
      Search programs and fellowships for &lsquo;{query.trim()}&rsquo;
    </Link>
  </p>
);

export default ResearchProgramsHandoff;
