const GRANT_AGENCY_FULL_NAMES: Record<string, string> = {
  NSF: 'National Science Foundation',
  NIH: 'National Institutes of Health',
  NCI: 'National Cancer Institute',
  NIAID: 'National Institute of Allergy and Infectious Diseases',
  NHLBI: 'National Heart, Lung, and Blood Institute',
  NINDS: 'National Institute of Neurological Disorders and Stroke',
  NIGMS: 'National Institute of General Medical Sciences',
  NIMH: 'National Institute of Mental Health',
  NIDA: 'National Institute on Drug Abuse',
  NIDDK: 'National Institute of Diabetes and Digestive and Kidney Diseases',
  NIA: 'National Institute on Aging',
  NICHD: 'National Institute of Child Health and Human Development',
  NIAAA: 'National Institute on Alcohol Abuse and Alcoholism',
  NIAMS: 'National Institute of Arthritis and Musculoskeletal and Skin Diseases',
  NIBIB: 'National Institute of Biomedical Imaging and Bioengineering',
  NHGRI: 'National Human Genome Research Institute',
  NEI: 'National Eye Institute',
  FIC: 'Fogarty International Center',
  NIMHD: 'National Institute on Minority Health and Health Disparities',
  NIDCD: 'National Institute on Deafness and Other Communication Disorders',
  NCCIH: 'National Center for Complementary and Integrative Health',
  NIEHS: 'National Institute of Environmental Health Sciences',
  NCATS: 'National Center for Advancing Translational Sciences',
  OD: 'NIH Office of the Director',
  NLM: 'National Library of Medicine',
  NIDCR: 'National Institute of Dental and Craniofacial Research',
  NINR: 'National Institute of Nursing Research',
  NIOSH: 'National Institute for Occupational Safety and Health',
  AHRQ: 'Agency for Healthcare Research and Quality',
  NEH: 'National Endowment for the Humanities',
  NEA: 'National Endowment for the Arts',
  DOE: 'U.S. Department of Energy',
  DOD: 'U.S. Department of Defense',
  FDA: 'U.S. Food and Drug Administration',
  CDC: 'Centers for Disease Control and Prevention',
};

export const grantAgencyDisplayName = (agency: string): string => {
  const trimmed = agency.trim();
  const fullName = GRANT_AGENCY_FULL_NAMES[trimmed.toUpperCase()];
  if (!fullName) return trimmed;
  return `${fullName} (${trimmed})`;
};

export const formatGrantSummary = (
  grants: ReadonlyArray<{ agency?: string | null }> | null | undefined,
): string | null => {
  const counts = new Map<string, number>();
  for (const grant of grants || []) {
    const agency = (grant?.agency || '').trim();
    if (!agency) continue;
    counts.set(agency, (counts.get(agency) || 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([agency, count]) => `${count} from ${grantAgencyDisplayName(agency)}`);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return `${total === 1 ? 'Recent research grant' : 'Recent research grants'}: ${parts.join('; ')}`;
};
