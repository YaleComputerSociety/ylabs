import { ReactNode } from 'react';

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'admin_grant.grant': 'Admin granted',
  'admin_grant.revoke': 'Admin revoked',
  'listing.update': 'Listing edited',
  'listing.delete': 'Listing deleted',
  'profile.update': 'Profile edited',
  'department.create': 'Department created',
  'department.update': 'Department edited',
  'department.delete': 'Department deleted',
  'research_area.update': 'Research area edited',
  'research_area.delete': 'Research area deleted',
  'fellowship.update': 'Fellowship edited',
  'fellowship.archive': 'Fellowship archived',
  'fellowship.unarchive': 'Fellowship unarchived',
  'fellowship.delete': 'Fellowship deleted',
  'access_review.manual_locks': 'Visibility locks changed',
  'access_review.record_review': 'Access review recorded',
  'listing_claim.review': 'Listing claim reviewed',
};

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] || action;

export const formatUserType = (type: string): string => {
  const typeMap: { [key: string]: string } = {
    undergraduate: 'Undergrads',
    graduate: 'Graduates',
    professor: 'Faculty & Professors',
    faculty: 'Faculty',
    admin: 'Admins',
    unknown: 'Unknown',
  };
  return typeMap[type] || type;
};

export const formatOutcome = (outcome?: string): string => {
  const outcomeMap: { [key: string]: string } = {
    emailed: 'Emailed',
    will_contact_later: 'Will contact later',
    not_a_fit: 'Not a fit',
  };
  return outcome ? outcomeMap[outcome] || outcome : 'Contact clicked';
};

export const formatDateTime = (value?: string | null): string => {
  if (!value) {
    return 'Never';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const formatEventType = (eventType: string): string => {
  const labelMap: Record<string, string> = {
    research_search: 'Research searches',
    listing_view: 'Opportunity View',
    listing_favorite: 'Opportunity Save',
    listing_unfavorite: 'Opportunity Unsave',
    listing_create: 'Opportunity Create',
    listing_update: 'Opportunity Update',
    listing_archive: 'Opportunity Archive',
    listing_unarchive: 'Opportunity Unarchive',
  };

  return (
    labelMap[eventType] ||
    eventType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
};

export const formatEntityType = (type?: string): string => {
  if (!type) {
    return 'Unknown';
  }
  return type
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
};

export const formatVisibilityTier = (tier?: string): string => {
  const tierMap: Record<string, string> = {
    student_ready: 'Student-ready',
    limited_but_safe: 'Limited but safe',
    operator_review: 'Operator review',
    suppressed: 'Suppressed',
  };
  return tier ? tierMap[tier] || tier : 'Unset';
};

export const formatOpenness = (status?: string): string => {
  const statusMap: Record<string, string> = {
    verified: 'Verified accepting',
    likely: 'Likely accepting',
    none: 'No access evidence',
  };
  return status ? statusMap[status] || status : 'Acceptance not computed';
};

export const formatNumber = (value?: number | null, digits = 0): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

export const formatPercent = (value?: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }

  return `${formatNumber(value > 1 ? value : value * 100, 1)}%`;
};

export const formatCompactMetric = (value?: number | string | null): string => {
  if (typeof value === 'number') {
    return formatNumber(value, value % 1 === 0 ? 0 : 1);
  }

  return value || '-';
};

export const formatFullName = (fname?: string, lname?: string): string =>
  [fname, lname].filter(Boolean).join(' ');

export const formatSearcherName = (searcher: {
  fname?: string;
  lname?: string;
  netid: string;
}): string => {
  const name = formatFullName(searcher.fname, searcher.lname);
  return name ? `${searcher.netid} (${name})` : searcher.netid;
};

export const actionPriorityClass = (priority?: string): string => {
  if (priority === 'high') {
    return 'border-red-200 bg-red-50 text-red-700';
  }

  if (priority === 'medium') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  return 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-700';
};

export const StatCard = ({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
}) => (
  <div className="overflow-hidden rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] shadow-sm">
    <div className="p-6">
      <h3 className="text-sm font-medium text-gray-600 mb-2">{title}</h3>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
  </div>
);

export const DashboardMetric = ({
  title,
  value,
  context,
  tone = 'blue',
}: {
  title: string;
  value: number | string;
  context: string;
  tone?: 'blue' | 'green' | 'amber' | 'red';
}) => {
  const toneClass = {
    blue: 'border-blue-200 bg-[var(--yr-blue-soft)] text-blue-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  }[tone];

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-3xl font-bold text-gray-950">{value}</p>
      <p className="mt-2 text-sm leading-5 opacity-85">{context}</p>
    </div>
  );
};

export const DetailSectionHeader = ({
  title,
  description,
}: {
  title: string;
  description?: string;
}) => (
  <div className="mb-4 flex flex-col gap-1 border-b border-[var(--yr-line)] pb-3">
    <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
    {description && <p className="text-sm text-gray-500">{description}</p>}
  </div>
);

export const ScopeBadge = ({ label }: { label: string }): ReactNode => (
  <span className="ml-3 inline-flex items-center rounded-full border border-[var(--yr-line-strong)] bg-[var(--yr-panel)] px-2.5 py-0.5 align-middle text-xs font-medium text-gray-500">
    {label}
  </span>
);
