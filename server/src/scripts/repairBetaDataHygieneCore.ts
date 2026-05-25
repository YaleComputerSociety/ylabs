export interface FieldRepairSpec {
  collection: string;
  field: string;
  kind: 'scalar' | 'array';
}

export interface ExactValueRepairRule {
  from: string;
  to?: string;
  action: 'replace' | 'unset';
  fields: FieldRepairSpec[];
}

export interface PlannedFieldRepair {
  collection: string;
  field: string;
  kind: 'scalar' | 'array';
  from: string;
  to?: string;
  action: 'replace' | 'unset';
}

export interface RepairBetaDataHygieneArgs {
  apply: boolean;
}

export const BARE_DOMAIN_URL_REPAIR_VALUES: Record<string, string> = {
  'boggonlab.org': 'https://boggonlab.org',
  'candlab.yale.edu': 'https://candlab.yale.edu',
  'tsanglab.org': 'https://tsanglab.org',
  'www.dietrich-lab.org': 'https://www.dietrich-lab.org',
  'www.fmri.org': 'https://www.fmri.org',
  'www.humannaturelab.net': 'https://www.humannaturelab.net',
  'www.jeanjuchunglab.org': 'https://www.jeanjuchunglab.org',
  'www.leschlab.org': 'https://www.leschlab.org',
  'www.rooneygroup.org': 'https://www.rooneygroup.org',
};

export const URL_REPAIR_FIELDS: FieldRepairSpec[] = [
  { collection: 'listings', field: 'websites', kind: 'array' },
  { collection: 'entry_pathways', field: 'sourceUrls', kind: 'array' },
  { collection: 'access_signals', field: 'sourceUrl', kind: 'scalar' },
  { collection: 'posted_opportunities', field: 'applicationUrl', kind: 'scalar' },
  { collection: 'posted_opportunities', field: 'sourceUrls', kind: 'array' },
];

export const EMAIL_PLACEHOLDER_REPAIR_FIELDS: FieldRepairSpec[] = [
  { collection: 'users', field: 'email', kind: 'scalar' },
  { collection: 'listings', field: 'ownerEmail', kind: 'scalar' },
];

export function parseRepairBetaDataHygieneArgs(argv: string[]): RepairBetaDataHygieneArgs {
  let apply = false;

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      apply = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply };
}

export function buildBetaDataHygieneRepairRules(): ExactValueRepairRule[] {
  const urlRules = Object.entries(BARE_DOMAIN_URL_REPAIR_VALUES).map(([from, to]) => ({
    from,
    to,
    action: 'replace' as const,
    fields: URL_REPAIR_FIELDS,
  }));

  return [
    ...urlRules,
    {
      from: 'Email',
      action: 'unset',
      fields: [{ collection: 'users', field: 'email', kind: 'scalar' }],
    },
    {
      from: 'NA',
      action: 'unset',
      fields: [{ collection: 'users', field: 'email', kind: 'scalar' }],
    },
    {
      from: 'No email',
      action: 'unset',
      fields: [{ collection: 'listings', field: 'ownerEmail', kind: 'scalar' }],
    },
  ];
}

export function expandBetaDataHygieneRepairPlan(
  rules: ExactValueRepairRule[] = buildBetaDataHygieneRepairRules(),
): PlannedFieldRepair[] {
  return rules.flatMap((rule) =>
    rule.fields.map((field) => ({
      ...field,
      from: rule.from,
      ...(rule.to ? { to: rule.to } : {}),
      action: rule.action,
    })),
  );
}
