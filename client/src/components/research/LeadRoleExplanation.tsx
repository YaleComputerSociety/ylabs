const LeadRoleExplanation = ({ plural = false }: { plural?: boolean }) => (
  <p className="-mt-2 mb-3 text-xs leading-relaxed text-muted">
    {plural
      ? 'The faculty members who lead this research, each a principal investigator (PI).'
      : 'The faculty member who leads this research, also called the principal investigator (PI).'}
  </p>
);

export default LeadRoleExplanation;
