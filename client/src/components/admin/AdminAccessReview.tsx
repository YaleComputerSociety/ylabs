/**
 * Admin review surface for derived research-access records.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from '../../utils/axios';
import swal from 'sweetalert';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeHttpUrlList, safeRouteSegment } from '../../utils/url';

interface AccessReviewCounts {
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  postedOpportunities: number;
}

interface AccessReviewEntitySummary {
  _id: string;
  name: string;
  slug: string;
  entityType?: string;
  kind?: string;
  departments?: string[];
  researchAreas?: string[];
  manuallyLockedFields?: string[];
  counts: AccessReviewCounts;
  unreviewedCounts: AccessReviewCounts;
  totalUnreviewed: number;
  hasOfficialApplication: boolean;
}

type ReviewStatus = 'unreviewed' | 'approved' | 'needs_source' | 'disputed' | 'archived_by_review';

interface RecordReview {
  status?: ReviewStatus;
  reviewedByUserId?: string;
  reviewedAt?: string;
  note?: string;
  lockedFields?: string[];
}

interface EvidenceItem {
  observationId: string;
  sourceName?: string;
  sourceUrl?: string;
  scrapeRunId?: string;
  confidence?: number;
  observedAt?: string;
  field?: string;
  excerpt?: string;
}

interface ReviewableRecord {
  _id: string;
  review?: RecordReview;
  evidenceItems?: EvidenceItem[];
}

interface EntryPathway {
  _id: string;
  pathwayType: string;
  status: string;
  evidenceStrength: string;
  studentFacingLabel: string;
  explanation?: string;
  bestNextStep?: string;
  compensation?: string;
  sourceEvidenceIds?: string[];
  sourceUrls?: string[];
  confidence?: number;
  archived?: boolean;
  review?: RecordReview;
  evidenceItems?: EvidenceItem[];
}

interface AccessSignal {
  _id: string;
  signalType: string;
  confidence: string;
  confidenceScore?: number;
  sourceName?: string;
  sourceUrl?: string;
  excerpt?: string;
  sourceEvidenceId?: string;
  observationId?: string;
  archived?: boolean;
  review?: RecordReview;
  evidenceItems?: EvidenceItem[];
}

interface ContactRoute {
  _id: string;
  routeType: string;
  label?: string;
  name?: string;
  personName?: string;
  role?: string;
  email?: string;
  url?: string;
  visibility?: string;
  contactPolicy?: string;
  rationale?: string;
  sourceUrl?: string;
  sourceEvidenceId?: string;
  sourceEvidenceIds?: string[];
  archived?: boolean;
  review?: RecordReview;
  evidenceItems?: EvidenceItem[];
}

interface PostedOpportunity {
  _id: string;
  title: string;
  status: string;
  term?: string;
  deadline?: string;
  applicationUrl?: string;
  compensationType?: string;
  hoursPerWeek?: number;
  payRate?: string;
  eligibility?: string;
  sourceEvidenceIds?: string[];
  sourceUrls?: string[];
  archived?: boolean;
  review?: RecordReview;
  evidenceItems?: EvidenceItem[];
}

interface AccessReviewDetail {
  group: AccessReviewEntitySummary & {
    displayName?: string;
    description?: string;
  };
  entryPathways: EntryPathway[];
  accessSignals: AccessSignal[];
  contactRoutes: ContactRoute[];
  postedOpportunities: PostedOpportunity[];
  reviewSummary?: {
    totalDerivedRecords: number;
    archivedRecords: number;
    recordsMissingEvidence: number;
    guardedContactRoutes: number;
    publicContactRoutes: number;
    manualLocks: string[];
    sourceNames: string[];
  };
}

const PAGE_SIZES = [10, 25, 50, 100];
export type RecordFilter =
  | 'all'
  | 'unreviewed'
  | 'missing-evidence'
  | 'guarded-contact'
  | 'official-application'
  | 'archived';

const RECORD_FILTERS: Array<{ value: RecordFilter; label: string }> = [
  { value: 'all', label: 'All records' },
  { value: 'unreviewed', label: 'Unreviewed' },
  { value: 'missing-evidence', label: 'Missing evidence' },
  { value: 'guarded-contact', label: 'Guarded routes' },
  { value: 'official-application', label: 'Official application routes' },
  { value: 'archived', label: 'Archived' },
];

const formatToken = (value?: string | null) =>
  value ? value.replace(/_/g, ' ').toLowerCase() : 'unknown';

const formatDate = (value?: string | null) => {
  if (!value) return 'No deadline';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

const evidenceIds = (...groups: Array<string[] | string | undefined>) =>
  groups.flatMap((group) => {
    if (!group) return [];
    return Array.isArray(group) ? group : [group];
  });

const hasSafeSourceUrl = (value: unknown): boolean => Boolean(safeHttpUrl(value));

export const hasRecordEvidence = (record: any) => {
  const sourceUrls = Array.isArray(record.sourceUrls) ? record.sourceUrls : [];
  return (
    (record.evidenceItems || []).length > 0 ||
    evidenceIds(record.sourceEvidenceIds, record.sourceEvidenceId, record.observationId).length >
      0 ||
    sourceUrls.some(hasSafeSourceUrl) ||
    hasSafeSourceUrl(record.sourceUrl)
  );
};

export const matchesRecordFilter = (
  record: any,
  recordType: 'entryPathway' | 'accessSignal' | 'contactRoute' | 'postedOpportunity',
  filter: RecordFilter,
) => {
  switch (filter) {
    case 'unreviewed':
      return !record.review?.status || record.review.status === 'unreviewed';
    case 'missing-evidence':
      return !hasRecordEvidence(record);
    case 'guarded-contact':
      return (
        recordType === 'contactRoute' &&
        (record.visibility !== 'PUBLIC' || record.contactPolicy === 'NO_DIRECT_CONTACT')
      );
    case 'official-application':
      return recordType === 'contactRoute' && isOfficialApplicationRoute(record);
    case 'archived':
      return record.archived === true || record.review?.status === 'archived_by_review';
    default:
      return true;
  }
};

export const isOfficialApplicationRoute = (record: Partial<ContactRoute>): boolean => {
  const routeType = record.routeType?.toLowerCase() || '';
  const label = `${record.label || ''} ${record.name || ''}`.toLowerCase();
  return routeType.includes('application') || label.includes('official application');
};

export const orderContactRoutesForReview = (routes: ContactRoute[]): ContactRoute[] =>
  [...routes].sort((left, right) => {
    const priority =
      Number(isOfficialApplicationRoute(right)) - Number(isOfficialApplicationRoute(left));
    if (priority !== 0) return priority;
    const leftUnreviewed = !left.review?.status || left.review.status === 'unreviewed';
    const rightUnreviewed = !right.review?.status || right.review.status === 'unreviewed';
    return Number(rightUnreviewed) - Number(leftUnreviewed);
  });

export const reviewProgress = (records: ReviewableRecord[]) => ({
  reviewed: records.filter(
    (record) => record.review?.status && record.review.status !== 'unreviewed',
  ).length,
  total: records.length,
});

const REVIEW_STATUSES: ReviewStatus[] = [
  'unreviewed',
  'approved',
  'needs_source',
  'disputed',
  'archived_by_review',
];

const SourceLinks = ({
  urls,
  ids,
  evidenceItems,
}: {
  urls?: string[];
  ids?: Array<string | undefined>;
  evidenceItems?: EvidenceItem[];
}) => {
  const sourceUrls = safeHttpUrlList(urls || []);
  const sourceIds = Array.from(new Set((ids || []).filter(Boolean))) as string[];
  const evidence = evidenceItems || [];

  if (sourceUrls.length === 0 && sourceIds.length === 0 && evidence.length === 0) {
    return <span className="text-xs text-gray-400">No source evidence attached</span>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {sourceUrls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel={EXTERNAL_LINK_REL}
            className="text-xs font-medium text-blue-700 hover:text-blue-900 underline underline-offset-2"
          >
            Source
          </a>
        ))}
        {sourceIds.map((id) => (
          <span
            key={id}
            className="text-xs text-gray-500 bg-[var(--yr-panel-muted)] border border-[var(--yr-line)] rounded px-2 py-0.5"
            title={id}
          >
            evidence {id.slice(-6)}
          </span>
        ))}
      </div>
      {evidence.length > 0 && (
        <details className="rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-2">
          <summary className="cursor-pointer text-xs font-semibold text-gray-700">
            Source evidence ({evidence.length})
          </summary>
          <div className="mt-2 space-y-2">
            {evidence.map((item) => {
              const sourceUrl = safeHttpUrl(item.sourceUrl);
              return (
                <div
                  key={item.observationId}
                  className="rounded border border-[var(--yr-line)] bg-[var(--yr-panel)] p-2 text-xs text-gray-600"
                >
                  <div className="flex flex-wrap gap-2">
                    <span className="font-semibold text-gray-800">
                      {item.sourceName || 'unknown source'}
                    </span>
                    <span>obs {item.observationId.slice(-6)}</span>
                    {item.scrapeRunId && <span>run {item.scrapeRunId.slice(-6)}</span>}
                    {typeof item.confidence === 'number' && (
                      <span>{item.confidence.toFixed(2)} confidence</span>
                    )}
                    {item.observedAt && <span>{formatDate(item.observedAt)}</span>}
                  </div>
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel={EXTERNAL_LINK_REL}
                      className="mt-1 inline-block text-blue-700 underline underline-offset-2"
                    >
                      Open source
                    </a>
                  )}
                  {item.excerpt && <p className="mt-1 text-gray-700">{item.excerpt}</p>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
};

const RecordReviewControls = ({
  recordType,
  record,
  onSaved,
}: {
  recordType: 'entryPathway' | 'accessSignal' | 'contactRoute' | 'postedOpportunity';
  record: ReviewableRecord;
  onSaved: (record: ReviewableRecord) => void;
}) => {
  const [status, setStatus] = useState<ReviewStatus>(record.review?.status || 'unreviewed');
  const [lockedFields, setLockedFields] = useState((record.review?.lockedFields || []).join(', '));
  const [note, setNote] = useState(record.review?.note || '');
  const [isSaving, setIsSaving] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  const save = async () => {
    if (status !== 'unreviewed' && !note.trim()) {
      swal({ text: 'Add a reviewer rationale before changing review status.', icon: 'warning' });
      return;
    }
    const confirmed = await swal({
      title: status === 'approved' ? 'Approve this record?' : 'Confirm review decision',
      text: 'This updates one record only. Verify its source evidence before continuing.',
      icon: 'warning',
      buttons: ['Cancel', status === 'approved' ? 'Approve' : 'Save decision'],
      dangerMode: status === 'approved',
    });
    if (!confirmed) return;
    setIsSaving(true);
    try {
      const response = await axios.put(
        `/admin/access-review/records/${recordType}/${record._id}/review`,
        {
          status,
          lockedFields: lockedFields
            .split(',')
            .map((field) => field.trim())
            .filter(Boolean),
          note,
        },
      );
      onSaved(response.data.record);
      const currentCard = saveButtonRef.current?.closest<HTMLElement>('[data-review-record]');
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-review-record]'));
      const nextCard = cards[cards.indexOf(currentCard as HTMLElement) + 1];
      nextCard?.focus();
      swal({ text: 'Review saved', icon: 'success', timer: 1200 });
    } catch {
      console.error('Error saving record review.');
      swal({ text: 'Failed to save review', icon: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3">
      <a
        href={`#${recordType}-${record._id}`}
        className="mb-2 inline-block text-xs font-medium text-blue-700 underline underline-offset-2"
      >
        Link to record
      </a>
      <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
        <select
          aria-label="Review status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ReviewStatus)}
          className="min-h-[44px] rounded border border-[var(--yr-line-strong)] px-2 py-1.5 text-xs"
        >
          {REVIEW_STATUSES.map((option) => (
            <option key={option} value={option}>
              {formatToken(option)}
            </option>
          ))}
        </select>
        <input
          aria-label="Locked fields"
          type="text"
          value={lockedFields}
          onChange={(event) => setLockedFields(event.target.value)}
          placeholder="locked fields"
          className="min-h-[44px] rounded border border-[var(--yr-line-strong)] px-2 py-1.5 text-xs"
        />
        <button
          ref={saveButtonRef}
          onClick={save}
          disabled={isSaving}
          className="min-h-[44px] rounded bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Review'}
        </button>
      </div>
      <textarea
        aria-label="Reviewer rationale"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder="Reviewer note"
        className="mt-2 min-h-[64px] w-full rounded border border-[var(--yr-line-strong)] px-2 py-1.5 text-xs"
      />
      {record.review?.reviewedAt && (
        <p className="mt-1 text-[11px] text-gray-500">
          Last reviewed {formatDate(record.review.reviewedAt)}
        </p>
      )}
    </div>
  );
};

const CountPill = ({ label, value }: { label: string; value: number }) => (
  <span className="inline-flex items-center gap-1 rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-gray-700">
    <span className="font-semibold text-gray-900">{value}</span>
    {label}
  </span>
);

const EmptyState = ({ label }: { label: string }) => (
  <div className="border border-dashed border-[var(--yr-line)] rounded p-4 text-sm text-gray-500">
    {label}
  </div>
);

const AdminAccessReview = () => {
  const [entities, setEntities] = useState<AccessReviewEntitySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccessReviewDetail | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [manualLocksText, setManualLocksText] = useState('');
  const [isSavingLocks, setIsSavingLocks] = useState(false);
  const [recordFilter, setRecordFilter] = useState<RecordFilter>('all');
  const [hasUnreviewed, setHasUnreviewed] = useState(true);
  const [queueSort, setQueueSort] = useState('unreviewed');
  const [queueProgress, setQueueProgress] = useState({ reviewedToday: 0, remaining: 0 });

  const fetchEntities = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const response = await axios.get('/admin/access-review', {
        params: {
          search: search.trim() || undefined,
          page,
          pageSize,
          hasUnreviewed,
          sort: queueSort,
        },
      });
      setEntities(response.data.entities || []);
      setTotal(response.data.total || 0);
      setTotalPages(response.data.totalPages || 1);
      setQueueProgress(response.data.progress || { reviewedToday: 0, remaining: 0 });
      if (!selectedId && response.data.entities?.[0]?._id) {
        setSelectedId(response.data.entities[0]._id);
      }
    } catch {
      console.error('Error fetching access review entities.');
      swal({ text: 'Failed to fetch access review entities', icon: 'error' });
    } finally {
      setIsLoadingList(false);
    }
  }, [hasUnreviewed, page, pageSize, queueSort, search, selectedId]);

  const fetchDetail = useCallback(async (id: string) => {
    setIsLoadingDetail(true);
    try {
      const response = await axios.get<AccessReviewDetail>(`/admin/access-review/${id}`);
      setDetail(response.data);
      setManualLocksText((response.data.group.manuallyLockedFields || []).join(', '));
    } catch {
      console.error('Error fetching access review detail.');
      setDetail(null);
      swal({ text: 'Failed to fetch access review detail', icon: 'error' });
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    const debounce = setTimeout(
      () => {
        fetchEntities();
      },
      search ? 350 : 0,
    );
    return () => clearTimeout(debounce);
  }, [fetchEntities, search]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [fetchDetail, selectedId]);

  const selectedEntity = useMemo(
    () => entities.find((entity) => entity._id === selectedId) || null,
    [entities, selectedId],
  );

  const filteredRecords = useMemo(() => {
    if (!detail) {
      return {
        entryPathways: [],
        accessSignals: [],
        contactRoutes: [],
        postedOpportunities: [],
        total: 0,
      };
    }
    const entryPathways = detail.entryPathways.filter((record) =>
      matchesRecordFilter(record, 'entryPathway', recordFilter),
    );
    const accessSignals = detail.accessSignals.filter((record) =>
      matchesRecordFilter(record, 'accessSignal', recordFilter),
    );
    const contactRoutes = orderContactRoutesForReview(
      detail.contactRoutes.filter((record) =>
        matchesRecordFilter(record, 'contactRoute', recordFilter),
      ),
    );
    const postedOpportunities = detail.postedOpportunities.filter((record) =>
      matchesRecordFilter(record, 'postedOpportunity', recordFilter),
    );

    return {
      entryPathways,
      accessSignals,
      contactRoutes,
      postedOpportunities,
      total:
        entryPathways.length +
        accessSignals.length +
        contactRoutes.length +
        postedOpportunities.length,
    };
  }, [detail, recordFilter]);

  const progress = useMemo(() => {
    if (!detail) return { reviewed: 0, total: 0 };
    return reviewProgress([
      ...detail.entryPathways,
      ...detail.accessSignals,
      ...detail.contactRoutes,
      ...detail.postedOpportunities,
    ]);
  }, [detail]);

  const selectAdjacentEntity = (offset: number) => {
    const currentIndex = entities.findIndex((entity) => entity._id === selectedId);
    const next = entities[currentIndex + offset];
    if (next) setSelectedId(next._id);
  };

  const saveManualLocks = async () => {
    if (!selectedId) return;
    const fields = manualLocksText
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);

    setIsSavingLocks(true);
    try {
      const response = await axios.put(`/admin/access-review/${selectedId}/manual-locks`, {
        fields,
      });
      const locked = response.data.group?.manuallyLockedFields || fields;
      setManualLocksText(locked.join(', '));
      setDetail((current) =>
        current
          ? { ...current, group: { ...current.group, manuallyLockedFields: locked } }
          : current,
      );
      setEntities((current) =>
        current.map((entity) =>
          entity._id === selectedId ? { ...entity, manuallyLockedFields: locked } : entity,
        ),
      );
      swal({ text: 'Manual locks saved', icon: 'success', timer: 1400 });
    } catch {
      console.error('Error saving manual locks.');
      swal({ text: 'Failed to save manual locks', icon: 'error' });
    } finally {
      setIsSavingLocks(false);
    }
  };

  const updateReviewedRecord = (
    recordType: 'entryPathway' | 'accessSignal' | 'contactRoute' | 'postedOpportunity',
    record: ReviewableRecord,
  ) => {
    setDetail((current) => {
      if (!current) return current;
      const replace = <T extends ReviewableRecord>(records: T[]): T[] =>
        records.map((item) => (item._id === record._id ? ({ ...item, ...record } as T) : item));

      switch (recordType) {
        case 'entryPathway':
          return { ...current, entryPathways: replace(current.entryPathways) };
        case 'accessSignal':
          return { ...current, accessSignals: replace(current.accessSignals) };
        case 'contactRoute':
          return { ...current, contactRoutes: replace(current.contactRoutes) };
        case 'postedOpportunity':
          return { ...current, postedOpportunities: replace(current.postedOpportunities) };
        default:
          return current;
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-[var(--yr-panel)] rounded-lg border border-[var(--yr-line)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search entity, slug, department, area..."
              className="min-h-[44px] w-full border border-[var(--yr-line-strong)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rows</label>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="min-h-[44px] border border-[var(--yr-line-strong)] rounded-md px-3 py-2 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={hasUnreviewed}
              onChange={(event) => {
                setHasUnreviewed(event.target.checked);
                setPage(1);
              }}
            />
            Has unreviewed
          </label>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Order</label>
            <select
              aria-label="Queue order"
              value={queueSort}
              onChange={(event) => {
                setQueueSort(event.target.value);
                setPage(1);
              }}
              className="min-h-[44px] border border-[var(--yr-line-strong)] rounded-md px-3 py-2 text-sm"
            >
              <option value="unreviewed">Most unreviewed</option>
              <option value="official_application">Official application first</option>
              <option value="updated">Recently updated</option>
            </select>
          </div>
          <button
            onClick={fetchEntities}
            className="min-h-[44px] px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
        <section className="bg-[var(--yr-panel)] border border-[var(--yr-line)] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--yr-line)] flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">
              {total} entit{total === 1 ? 'y' : 'ies'}
            </p>
            <p className="text-xs text-gray-500">
              Page {page} of {totalPages}
            </p>
          </div>
          <div
            className="px-4 py-2 border-b border-[var(--yr-line)] text-xs text-gray-600"
            role="status"
          >
            <strong>{queueProgress.reviewedToday}</strong> reviewed today ·{' '}
            <strong>{queueProgress.remaining}</strong> remaining
          </div>

          {isLoadingList && entities.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">Loading access review queue...</div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-[720px] overflow-y-auto">
              {entities.map((entity) => (
                <button
                  key={entity._id}
                  onClick={() => setSelectedId(entity._id)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      selectAdjacentEntity(1);
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      selectAdjacentEntity(-1);
                    }
                  }}
                  aria-pressed={selectedId === entity._id}
                  className={`w-full text-left p-4 transition-colors ${
                    selectedId === entity._id
                      ? 'bg-[var(--yr-blue-soft)]'
                      : 'hover:bg-[var(--yr-panel-muted)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-gray-900">{entity.name}</h3>
                      <p className="text-xs text-gray-500">{entity.slug}</p>
                    </div>
                    <span className="text-xs text-gray-600 bg-[var(--yr-panel)] border border-[var(--yr-line)] rounded px-2 py-1">
                      {formatToken(entity.entityType || entity.kind)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-3">
                    <CountPill
                      label={`pathways (${entity.unreviewedCounts.entryPathways} new)`}
                      value={entity.counts.entryPathways}
                    />
                    <CountPill
                      label={`signals (${entity.unreviewedCounts.accessSignals} new)`}
                      value={entity.counts.accessSignals}
                    />
                    <CountPill
                      label={`routes (${entity.unreviewedCounts.contactRoutes} new)`}
                      value={entity.counts.contactRoutes}
                    />
                    <CountPill
                      label={`posts (${entity.unreviewedCounts.postedOpportunities} new)`}
                      value={entity.counts.postedOpportunities}
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-gray-700">
                    {entity.totalUnreviewed} unreviewed
                    {entity.hasOfficialApplication ? ' · official application' : ''}
                  </p>
                  {(entity.manuallyLockedFields || []).length > 0 && (
                    <p className="text-xs text-amber-700 mt-2">
                      {entity.manuallyLockedFields?.length} manual lock
                      {entity.manuallyLockedFields?.length === 1 ? '' : 's'}
                    </p>
                  )}
                </button>
              ))}
              {entities.length === 0 && (
                <div className="p-4 text-sm text-gray-500">No entities found.</div>
              )}
            </div>
          )}

          <div className="px-4 py-3 border-t border-[var(--yr-line)] flex items-center justify-between">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="min-h-[44px] px-3 py-1.5 text-sm border border-[var(--yr-line-strong)] rounded disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="min-h-[44px] px-3 py-1.5 text-sm border border-[var(--yr-line-strong)] rounded disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </section>

        <section className="bg-[var(--yr-panel)] border border-[var(--yr-line)] rounded-lg p-5">
          {!selectedId || !selectedEntity ? (
            <EmptyState label="Select an entity to review derived access records." />
          ) : isLoadingDetail || !detail ? (
            <div className="text-sm text-gray-500">Loading access records...</div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">
                    {detail.group.displayName || detail.group.name}
                  </h3>
                  <p className="text-sm text-gray-500">{detail.group.slug}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(detail.group.departments || []).slice(0, 4).map((department) => (
                      <span
                        key={department}
                        className="text-xs bg-[var(--yr-panel-muted)] text-gray-700 rounded px-2 py-1"
                      >
                        {department}
                      </span>
                    ))}
                  </div>
                </div>
                <a
                  href={`/research/${safeRouteSegment(detail.group.slug)}`}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  className="inline-flex min-h-[44px] items-center px-3 py-2 text-sm font-semibold text-blue-700 border border-blue-200 rounded hover:bg-[var(--yr-blue-soft)]"
                >
                  Open Research Page
                </a>
              </div>

              <nav
                aria-label="Review queue navigation"
                className="flex flex-wrap items-center justify-between gap-2 border-y border-[var(--yr-line)] py-3"
              >
                <button
                  type="button"
                  onClick={() => selectAdjacentEntity(-1)}
                  disabled={entities.findIndex((entity) => entity._id === selectedId) <= 0}
                  className="min-h-[44px] rounded border border-[var(--yr-line-strong)] px-3 text-sm disabled:opacity-40"
                >
                  Previous entity
                </button>
                <p role="status" className="text-sm font-medium text-gray-700">
                  {progress.reviewed} of {progress.total} records reviewed
                </p>
                <button
                  type="button"
                  onClick={() => selectAdjacentEntity(1)}
                  disabled={
                    entities.findIndex((entity) => entity._id === selectedId) >= entities.length - 1
                  }
                  className="min-h-[44px] rounded border border-[var(--yr-line-strong)] px-3 text-sm disabled:opacity-40"
                >
                  Next entity
                </button>
              </nav>

              <div className="border border-[var(--yr-line)] rounded-lg p-4">
                <label className="block text-sm font-semibold text-gray-900 mb-1">
                  Manual Locks
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Comma-separated field names protected from scraper materialization.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={manualLocksText}
                    onChange={(event) => setManualLocksText(event.target.value)}
                    placeholder="acceptingUndergrads, contactRoutes..."
                    className="min-h-[44px] flex-1 border border-[var(--yr-line-strong)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={saveManualLocks}
                    disabled={isSavingLocks}
                    className="min-h-[44px] px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isSavingLocks ? 'Saving...' : 'Save Locks'}
                  </button>
                </div>
              </div>

              {detail.reviewSummary && (
                <div className="border border-[var(--yr-line)] rounded-lg p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-gray-900">Review Summary</h4>
                    <span className="text-xs text-gray-500">
                      {detail.reviewSummary.totalDerivedRecords} derived records
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <CountPill
                      label="missing evidence"
                      value={detail.reviewSummary.recordsMissingEvidence}
                    />
                    <CountPill label="archived" value={detail.reviewSummary.archivedRecords} />
                    <CountPill
                      label="guarded routes"
                      value={detail.reviewSummary.guardedContactRoutes}
                    />
                    <CountPill
                      label="public routes"
                      value={detail.reviewSummary.publicContactRoutes}
                    />
                    <CountPill label="locks" value={detail.reviewSummary.manualLocks.length} />
                  </div>
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Sources
                    </p>
                    {detail.reviewSummary.sourceNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.reviewSummary.sourceNames.map((sourceName) => (
                          <span
                            key={sourceName}
                            className="rounded border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-1 text-xs text-gray-700"
                          >
                            {sourceName}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No source names attached.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="border border-[var(--yr-line)] rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Record Filter</h4>
                    <p className="text-xs text-gray-500">
                      Showing {filteredRecords.total} derived record
                      {filteredRecords.total === 1 ? '' : 's'}.
                    </p>
                  </div>
                  <select
                    value={recordFilter}
                    onChange={(event) => setRecordFilter(event.target.value as RecordFilter)}
                    className="min-h-[44px] rounded border border-[var(--yr-line-strong)] px-3 py-2 text-sm"
                  >
                    {RECORD_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">Pathways</h4>
                <div className="space-y-3">
                  {filteredRecords.entryPathways.map((pathway) => (
                    <div
                      key={pathway._id}
                      id={`entryPathway-${pathway._id}`}
                      data-review-record
                      tabIndex={-1}
                      className="border border-[var(--yr-line)] rounded-lg p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          {pathway.studentFacingLabel}
                        </span>
                        <span className="text-xs bg-[var(--yr-blue-soft)] text-blue-700 rounded px-2 py-1">
                          {formatToken(pathway.pathwayType)}
                        </span>
                        <span className="text-xs bg-[var(--yr-panel-muted)] text-gray-700 rounded px-2 py-1">
                          {formatToken(pathway.status)}
                        </span>
                        {pathway.archived && (
                          <span className="text-xs bg-amber-50 text-amber-700 rounded px-2 py-1">
                            archived
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {pathway.explanation || 'No explanation recorded.'}
                      </p>
                      <p className="text-sm text-gray-800 mt-2">
                        <span className="font-semibold">Best next step:</span>{' '}
                        {pathway.bestNextStep || 'Not set'}
                      </p>
                      <p className="text-xs text-gray-500 mt-2">
                        Evidence: {formatToken(pathway.evidenceStrength)} · Confidence:{' '}
                        {typeof pathway.confidence === 'number'
                          ? pathway.confidence.toFixed(2)
                          : 'unknown'}{' '}
                        · Compensation: {formatToken(pathway.compensation)}
                      </p>
                      <div className="mt-3">
                        <SourceLinks
                          urls={pathway.sourceUrls}
                          ids={pathway.sourceEvidenceIds}
                          evidenceItems={pathway.evidenceItems}
                        />
                      </div>
                      <RecordReviewControls
                        recordType="entryPathway"
                        record={pathway}
                        onSaved={(record) => updateReviewedRecord('entryPathway', record)}
                      />
                    </div>
                  ))}
                  {filteredRecords.entryPathways.length === 0 && (
                    <EmptyState label="No derived pathways match this filter." />
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">Access Signals</h4>
                <div className="space-y-3">
                  {filteredRecords.accessSignals.map((signal) => (
                    <div
                      key={signal._id}
                      id={`accessSignal-${signal._id}`}
                      data-review-record
                      tabIndex={-1}
                      className="border border-[var(--yr-line)] rounded-lg p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          {formatToken(signal.signalType)}
                        </span>
                        <span className="text-xs bg-[var(--yr-panel-muted)] text-gray-700 rounded px-2 py-1">
                          {formatToken(signal.confidence)}
                        </span>
                        {signal.archived && (
                          <span className="text-xs bg-amber-50 text-amber-700 rounded px-2 py-1">
                            archived
                          </span>
                        )}
                      </div>
                      {signal.excerpt && (
                        <p className="text-sm text-gray-700">"{signal.excerpt}"</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        Score:{' '}
                        {typeof signal.confidenceScore === 'number'
                          ? signal.confidenceScore.toFixed(2)
                          : 'unknown'}{' '}
                        · Source: {signal.sourceName || 'unknown'}
                      </p>
                      <div className="mt-3">
                        <SourceLinks
                          urls={signal.sourceUrl ? [signal.sourceUrl] : []}
                          ids={evidenceIds(signal.sourceEvidenceId, signal.observationId)}
                          evidenceItems={signal.evidenceItems}
                        />
                      </div>
                      <RecordReviewControls
                        recordType="accessSignal"
                        record={signal}
                        onSaved={(record) => updateReviewedRecord('accessSignal', record)}
                      />
                    </div>
                  ))}
                  {filteredRecords.accessSignals.length === 0 && (
                    <EmptyState label="No derived access signals match this filter." />
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">Contact Routes</h4>
                <div className="space-y-3">
                  {filteredRecords.contactRoutes.map((route) => (
                    <div
                      key={route._id}
                      id={`contactRoute-${route._id}`}
                      data-review-record
                      tabIndex={-1}
                      className="border border-[var(--yr-line)] rounded-lg p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          {route.label ||
                            route.name ||
                            route.personName ||
                            formatToken(route.routeType)}
                        </span>
                        <span className="text-xs bg-[var(--yr-panel-muted)] text-gray-700 rounded px-2 py-1">
                          {formatToken(route.visibility)}
                        </span>
                        <span className="text-xs bg-[var(--yr-panel-muted)] text-gray-700 rounded px-2 py-1">
                          {formatToken(route.contactPolicy)}
                        </span>
                        {route.archived && (
                          <span className="text-xs bg-amber-50 text-amber-700 rounded px-2 py-1">
                            archived
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {route.role || formatToken(route.routeType)}
                        {route.email || route.url ? ' · destination withheld' : ''}
                      </p>
                      {route.rationale && (
                        <p className="text-sm text-gray-700 mt-2">{route.rationale}</p>
                      )}
                      <div className="mt-3">
                        <SourceLinks
                          urls={route.sourceUrl ? [route.sourceUrl] : []}
                          ids={evidenceIds(route.sourceEvidenceId, route.sourceEvidenceIds)}
                          evidenceItems={route.evidenceItems}
                        />
                      </div>
                      <RecordReviewControls
                        recordType="contactRoute"
                        record={route}
                        onSaved={(record) => updateReviewedRecord('contactRoute', record)}
                      />
                    </div>
                  ))}
                  {filteredRecords.contactRoutes.length === 0 && (
                    <EmptyState label="No derived contact routes match this filter." />
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">Posted Opportunities</h4>
                <div className="space-y-3">
                  {filteredRecords.postedOpportunities.map((opportunity) => {
                    const applicationUrl = safeHttpUrl(opportunity.applicationUrl);
                    return (
                      <div
                        key={opportunity._id}
                        id={`postedOpportunity-${opportunity._id}`}
                        data-review-record
                        tabIndex={-1}
                        className="border border-[var(--yr-line)] rounded-lg p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="font-semibold text-gray-900">{opportunity.title}</span>
                          <span className="text-xs bg-green-50 text-green-700 rounded px-2 py-1">
                            {formatToken(opportunity.status)}
                          </span>
                          {opportunity.archived && (
                            <span className="text-xs bg-amber-50 text-amber-700 rounded px-2 py-1">
                              archived
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">
                          {opportunity.term || 'No term'} · {formatDate(opportunity.deadline)} ·{' '}
                          {formatToken(opportunity.compensationType)}
                        </p>
                        {applicationUrl && (
                          <a
                            href={applicationUrl}
                            target="_blank"
                            rel={EXTERNAL_LINK_REL}
                            className="text-sm font-medium text-blue-700 hover:text-blue-900 underline underline-offset-2"
                          >
                            Application
                          </a>
                        )}
                        {opportunity.eligibility && (
                          <p className="text-sm text-gray-700 mt-2">{opportunity.eligibility}</p>
                        )}
                        <div className="mt-3">
                          <SourceLinks
                            urls={opportunity.sourceUrls}
                            ids={opportunity.sourceEvidenceIds}
                            evidenceItems={opportunity.evidenceItems}
                          />
                        </div>
                        <RecordReviewControls
                          recordType="postedOpportunity"
                          record={opportunity}
                          onSaved={(record) => updateReviewedRecord('postedOpportunity', record)}
                        />
                      </div>
                    );
                  })}
                  {filteredRecords.postedOpportunities.length === 0 && (
                    <EmptyState label="No posted opportunities match this filter." />
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminAccessReview;
