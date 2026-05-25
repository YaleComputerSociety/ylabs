import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from '../../utils/axios';

type Tier = 'student_ready' | 'limited_but_safe' | 'operator_review' | 'suppressed';
type Risk = 'ok' | 'warn' | 'error';
type QueueKind = 'blocking' | 'evidence' | 'review';

interface TierCount {
  tier: Tier;
  count: number;
}

interface QueueSample {
  id: string;
  label: string;
  tier: Tier;
  reasons: string[];
  sourceUrl?: string;
  category?: string;
  summary?: string;
}

interface ReasonCount {
  reason: string;
  count: number;
  kind?: QueueKind;
}

interface QueueSummary {
  collection: 'research' | 'programs';
  reason: string;
  kind?: QueueKind;
  count: number;
  nextAction: string;
  samples: QueueSample[];
}

interface SourceHealthRow {
  sourceName: string;
  displayName: string;
  risk: Risk;
  action: string;
  latestRun?: {
    status: string;
    startedAt?: string;
    materializationErrors: number;
    materializationConflicts: number;
  };
}

interface OperatorBoard {
  generatedAt: string;
  trustTiers: {
    research: TierCount[];
    programs: TierCount[];
  };
  reasonCounts: {
    research: ReasonCount[];
    programs: ReasonCount[];
  };
  queues: QueueSummary[];
  gates: {
    dataQuality: {
      status: string;
      command: string;
      note: string;
    };
    scraperIntegrity: {
      status: string;
      command: string;
      latestRuns: Array<{
        sourceName: string;
        status: string;
        integrityStatus?: string;
        startedAt?: string;
        failureNames?: string[];
      }>;
    };
  };
  sourceFreshness: {
    windowDays: number;
    riskCounts: Record<Risk, number>;
    rows: SourceHealthRow[];
  };
}

const tierLabel: Record<Tier, string> = {
  student_ready: 'Ready',
  limited_but_safe: 'Limited',
  operator_review: 'Review',
  suppressed: 'Suppressed',
};

const riskStyles: Record<Risk, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

const classifyReason = (reason: string): QueueKind => {
  if (evidenceReasons.has(reason)) return 'evidence';
  if (
    reason.startsWith('missing_') ||
    reason.endsWith('_only') ||
    [
      'application_source_only',
      'archive_review',
      'content_page_risk',
      'duplicate_name_risk',
      'duplicate_risk',
      'inactive_at_yale',
      'not_undergraduate_relevant',
      'thin_description',
    ].includes(reason)
  ) {
    return 'blocking';
  }
  return 'review';
};

const uniqueReasons = (reasons: string[]) => [
  ...new Set(reasons.map((reason) => reason.trim()).filter(Boolean)),
];

const splitReasons = (reasons: string[], primaryReason: string) => {
  const normalizedPrimaryReason = primaryReason.trim().toLowerCase();
  const sampleReasons = uniqueReasons(reasons).filter(
    (reason) => reason.toLowerCase() !== normalizedPrimaryReason,
  );

  return {
    blockers: sampleReasons.filter((reason) => classifyReason(reason) === 'blocking'),
    signals: sampleReasons.filter((reason) => classifyReason(reason) === 'evidence'),
  };
};

const formatDate = (value?: string) => {
  if (!value) return 'No run';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const total = (rows: TierCount[]) => rows.reduce((sum, row) => sum + row.count, 0);

const queueKindLabel: Record<QueueKind, string> = {
  blocking: 'Repair queue',
  evidence: 'Evidence signal',
  review: 'Review signal',
};

const queueKindStyles: Record<QueueKind, string> = {
  blocking: 'border-red-200 bg-red-50 text-red-700',
  evidence: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-700',
};

const queueKindRank: Record<QueueKind, number> = {
  blocking: 0,
  review: 1,
  evidence: 2,
};

const ReasonList = ({
  label,
  reasons,
  tone,
}: {
  label: string;
  reasons: string[];
  tone: 'blocker' | 'signal';
}) => {
  if (reasons.length === 0) return null;

  const toneClass =
    tone === 'blocker'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {reasons.map((reason) => (
          <span key={reason} className={`rounded-md border px-2 py-0.5 text-xs ${toneClass}`}>
            {reason}
          </span>
        ))}
      </div>
    </div>
  );
};

const AdminOperatorBoard = () => {
  const [board, setBoard] = useState<OperatorBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get<OperatorBoard>('/admin/operator-board', {
        withCredentials: true,
      });
      setBoard(response.data);
    } catch (err) {
      console.error('Error fetching operator board:', err);
      setError(err instanceof Error ? err.message : 'Failed to load operator board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const topQueues = useMemo(
    () =>
      [...(board?.queues || [])]
        .sort((a, b) => {
          const aKind = a.kind || classifyReason(a.reason);
          const bKind = b.kind || classifyReason(b.reason);
          return queueKindRank[aKind] - queueKindRank[bKind] || b.count - a.count;
        })
        .slice(0, 10),
    [board],
  );

  if (loading) {
    return <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-6">Loading board...</div>;
  }

  if (error || !board) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || 'Failed to load operator board.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Data Quality Operator Board</h3>
          <p className="mt-1 text-sm text-gray-600">Updated {formatDate(board.generatedAt)}</p>
        </div>
        <button
          type="button"
          onClick={fetchBoard}
          className="min-h-10 rounded-md border border-[var(--yr-line-strong)] px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-[var(--yr-panel-muted)]"
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          ['Research', board.trustTiers.research],
          ['Programs', board.trustTiers.programs],
        ].map(([label, rows]) => (
          <section key={label as string} className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-semibold text-gray-900">{label as string}</h4>
              <span className="text-sm text-gray-500">{total(rows as TierCount[])} records</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(rows as TierCount[]).map((row) => (
                <div key={row.tier} className="rounded-md border border-[var(--yr-line)] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tierLabel[row.tier]}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{row.count}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
        <h4 className="mb-3 font-semibold text-gray-900">Gate Status</h4>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-[var(--yr-line)] p-3">
            <div className="text-sm font-semibold text-gray-900">Data quality</div>
            <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
              {board.gates.dataQuality.command}
            </code>
            <p className="mt-2 text-sm text-gray-600">{board.gates.dataQuality.note}</p>
          </div>
          <div className="rounded-md border border-[var(--yr-line)] p-3">
            <div className="text-sm font-semibold text-gray-900">Scraper integrity</div>
            <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
              {board.gates.scraperIntegrity.command}
            </code>
            <p className="mt-2 text-sm text-gray-600">
              Latest persisted integrity status: {board.gates.scraperIntegrity.status}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
        <h4 className="mb-3 font-semibold text-gray-900">Review Queues</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--yr-line)] text-sm">
            <thead className="bg-[var(--yr-panel-muted)] text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Queue</th>
                <th className="px-3 py-2 text-right">Count</th>
                <th className="px-3 py-2">Next action</th>
                <th className="px-3 py-2">Examples</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topQueues.map((queue) => (
                <tr key={`${queue.collection}-${queue.reason}`}>
                  <td className="px-3 py-3 align-top">
                    <span
                      className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                        queueKindStyles[queue.kind || classifyReason(queue.reason)]
                      }`}
                    >
                      {queueKindLabel[queue.kind || classifyReason(queue.reason)]}
                    </span>
                    <div className="font-semibold text-gray-900">{queue.reason}</div>
                    <div className="text-xs capitalize text-gray-500">{queue.collection}</div>
                  </td>
                  <td className="px-3 py-3 text-right align-top font-semibold text-gray-900">
                    {queue.count}
                  </td>
                  <td className="max-w-sm px-3 py-3 align-top text-gray-700">{queue.nextAction}</td>
                  <td className="min-w-80 px-3 py-3 align-top text-gray-600">
                    {queue.samples.length === 0
                      ? 'No samples'
                      : queue.samples.slice(0, 3).map((sample) => {
                          const { blockers, signals } = splitReasons(sample.reasons, queue.reason);

                          return (
                            <div key={sample.id} className="mb-3 last:mb-0">
                              <div className="font-medium text-gray-900">{sample.label}</div>
                              <ReasonList
                                label="Likely blockers"
                                reasons={blockers}
                                tone="blocker"
                              />
                              <ReasonList
                                label="Evidence signals"
                                reasons={signals}
                                tone="signal"
                              />
                            </div>
                          );
                        })}
                    {queue.samples.length > 3 && (
                      <div className="mt-2 text-xs text-gray-500">
                        +{queue.samples.length - 3} more samples
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold text-gray-900">Source Freshness</h4>
          <span className="text-sm text-gray-500">
            {board.sourceFreshness.windowDays} days · {board.sourceFreshness.riskCounts.ok} ok ·{' '}
            {board.sourceFreshness.riskCounts.warn} warn · {board.sourceFreshness.riskCounts.error}{' '}
            error
          </span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {board.sourceFreshness.rows.slice(0, 8).map((row) => (
            <div key={row.sourceName} className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900">{row.displayName}</div>
                  <div className="text-xs text-gray-500">{row.sourceName}</div>
                </div>
                <span
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${riskStyles[row.risk]}`}
                >
                  {row.risk}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">{row.action}</p>
              <p className="mt-2 text-xs text-gray-500">
                Latest run: {formatDate(row.latestRun?.startedAt)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default AdminOperatorBoard;
