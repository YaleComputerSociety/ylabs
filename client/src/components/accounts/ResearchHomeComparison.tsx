import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { isCancel } from 'axios';
import { Link } from 'react-router-dom';
import axios from '../../utils/axios';
import { normalizeResearchEntityDetailPayload } from '../../types/researchEntity';
import type { ResearchEntity } from '../../types/researchGroup';
import {
  entityKindLabel,
  researchEntityDisplayName,
  researchEntityTitle,
  sanitizeResearchEntityCopy,
} from '../../utils/researchEntityCopy';
import { getUniqueDepartmentLabels } from '../../utils/departmentNames';
import {
  isSuppressedResearchWebsiteCtaUrl,
  isUnavailableResearchWebsiteCtaUrl,
  normalizeSourceUrl,
  sourceLabelForUrl,
} from '../../utils/researchDetailSources';
import { EXTERNAL_LINK_REL, safeHttpUrl, safeRouteSegment } from '../../utils/url';
import {
  createResearchAnalyticsInteractionId,
  researchCountBucket,
  trackResearchEvent,
} from '../../utils/researchAnalytics';

export interface ComparableResearchHome {
  _id: string;
  slug: string;
  name: string;
  displayName?: string;
}

interface ResearchHomeComparisonProps {
  entities: ComparableResearchHome[];
  notesByEntityId: Record<string, string>;
  onClose: () => void;
}

type ComparisonColumn =
  | { status: 'loading'; base: ComparableResearchHome }
  | { status: 'error'; base: ComparableResearchHome }
  | { status: 'ready'; base: ComparableResearchHome; entity: ResearchEntity };

const MAX_RESEARCH_AREAS = 6;
const MAX_OFFICIAL_LINKS = 3;
const MAX_COMPARE_DESCRIPTION_LENGTH = 320;

const dedupeByEntityId = (entities: ComparableResearchHome[]): ComparableResearchHome[] => {
  const seen = new Set<string>();
  const unique: ComparableResearchHome[] = [];
  for (const entity of entities) {
    if (seen.has(entity._id)) continue;
    seen.add(entity._id);
    unique.push(entity);
  }
  return unique;
};

const boundedDescription = (entity: ResearchEntity): string => {
  const raw = (entity.shortDescription || entity.fullDescription || '').trim();
  const cleaned = sanitizeResearchEntityCopy(raw, entity).trim();
  if (cleaned.length <= MAX_COMPARE_DESCRIPTION_LENGTH) return cleaned;
  const bounded = cleaned.slice(0, MAX_COMPARE_DESCRIPTION_LENGTH);
  const lastWordBoundary = bounded.lastIndexOf(' ');
  const wordSafe = lastWordBoundary > 0 ? bounded.slice(0, lastWordBoundary) : bounded;
  return `${wordSafe.replace(/[\s,;:.-]+$/, '')}…`;
};

const officialLinks = (entity: ResearchEntity): Array<{ href: string; label: string }> => {
  const candidates = [entity.websiteUrl, ...(entity.sourceUrls || [])];
  const links: Array<{ href: string; label: string }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const href = safeHttpUrl(candidate);
    if (!href) continue;
    if (isSuppressedResearchWebsiteCtaUrl(href) || isUnavailableResearchWebsiteCtaUrl(href)) {
      continue;
    }
    const key = normalizeSourceUrl(href) || href;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ href, label: sourceLabelForUrl(href) });
    if (links.length >= MAX_OFFICIAL_LINKS) break;
  }
  return links;
};

const UnknownCell = () => <span className="text-xs italic text-gray-400">Unknown</span>;

const ResearchHomeComparison = ({
  entities,
  notesByEntityId,
  onClose,
}: ResearchHomeComparisonProps) => {
  const uniqueEntities = useMemo(() => dedupeByEntityId(entities), [entities]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [columns, setColumns] = useState<ComparisonColumn[]>(() =>
    uniqueEntities.map((base) => ({ status: 'loading', base })),
  );
  const [includedNoteIds, setIncludedNoteIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const bucket = researchCountBucket(uniqueEntities.length);
    void trackResearchEvent({
      eventType: 'research_compare',
      payload: { entityCountBucket: bucket },
      dedupeKey: createResearchAnalyticsInteractionId('compare'),
    });
  }, [uniqueEntities.length]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setColumns(uniqueEntities.map((base) => ({ status: 'loading', base })));

    uniqueEntities.forEach((base) => {
      axios
        .get(`/research/${safeRouteSegment(base.slug)}`, { signal: controller.signal })
        .then((response) => {
          if (!active) return;
          const { researchEntity } = normalizeResearchEntityDetailPayload(response.data);
          setColumns((current) =>
            current.map((column) =>
              column.base._id === base._id
                ? { status: 'ready', base, entity: researchEntity }
                : column,
            ),
          );
        })
        .catch((error) => {
          if (!active || isCancel(error)) return;
          setColumns((current) =>
            current.map((column) =>
              column.base._id === base._id ? { status: 'error', base } : column,
            ),
          );
        });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [uniqueEntities]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const inerted: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    let branch: HTMLElement | null = overlayRef.current;

    while (branch?.parentElement) {
      Array.from(branch.parentElement.children).forEach((sibling) => {
        if (sibling === branch || !(sibling instanceof HTMLElement)) return;
        inerted.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      });
      branch = branch.parentElement;
      if (branch === document.body) break;
    }

    titleRef.current?.focus();

    return () => {
      inerted.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      returnFocusRef.current?.focus();
    };
  }, []);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      titleRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === titleRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toggleIncludedNote = (entityId: string) => {
    setIncludedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const anyNoteIncluded = uniqueEntities.some(
    (entity) => includedNoteIds.has(entity._id) && (notesByEntityId[entity._id] || '').trim(),
  );

  const renderReadyCell = (entity: ResearchEntity, field: string): ReactNode => {
    if (field === 'type') {
      return <span className="text-sm text-gray-800">{entityKindLabel(entity)}</span>;
    }
    if (field === 'school') {
      return entity.school?.trim() ? (
        <span className="text-sm text-gray-800">{entity.school.trim()}</span>
      ) : (
        <UnknownCell />
      );
    }
    if (field === 'departments') {
      const labels = getUniqueDepartmentLabels(entity.departments);
      return labels.length > 0 ? (
        <span className="text-sm text-gray-800">{labels.join(', ')}</span>
      ) : (
        <UnknownCell />
      );
    }
    if (field === 'researchAreas') {
      const areas = (entity.researchAreas || []).filter(Boolean).slice(0, MAX_RESEARCH_AREAS);
      return areas.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {areas.map((area) => (
            <li
              key={area}
              className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] px-2 py-0.5 text-xs text-slate-700"
            >
              {area}
            </li>
          ))}
        </ul>
      ) : (
        <UnknownCell />
      );
    }
    if (field === 'description') {
      const description = boundedDescription(entity);
      return description ? (
        <p className="text-sm leading-relaxed text-gray-700">{description}</p>
      ) : (
        <UnknownCell />
      );
    }
    if (field === 'links') {
      const links = officialLinks(entity);
      return links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel={EXTERNAL_LINK_REL}
                className="yr-link yr-focus-ring rounded-sm text-xs"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <UnknownCell />
      );
    }
    return <UnknownCell />;
  };

  const renderCell = (column: ComparisonColumn, field: string): ReactNode => {
    if (column.status === 'loading') {
      return <span className="text-xs text-gray-400">Loading…</span>;
    }
    if (column.status === 'error') {
      return <span className="text-xs italic text-gray-400">Could not load</span>;
    }
    return renderReadyCell(column.entity, field);
  };

  const fieldRows: Array<{ key: string; label: string }> = [
    { key: 'type', label: 'Type' },
    { key: 'school', label: 'School' },
    { key: 'departments', label: 'Department' },
    { key: 'researchAreas', label: 'Research areas' },
    { key: 'description', label: 'What they study' },
    { key: 'links', label: 'Official links' },
  ];

  const columnHeaderTitle = (column: ComparisonColumn): string => {
    if (column.status === 'ready') return researchEntityTitle(column.entity);
    return researchEntityDisplayName(column.base) || column.base.name;
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-research-homes-title"
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-[var(--yr-panel)] shadow-2xl"
        onKeyDown={handleDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between border-b border-[var(--yr-line)] px-6 py-4">
          <div className="min-w-0">
            <h2
              ref={titleRef}
              id="compare-research-homes-title"
              tabIndex={-1}
              className="text-lg font-bold leading-tight text-gray-900 focus:outline-none"
            >
              Compare research homes
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Side-by-side facts pulled from each saved home. Blank facts show as unknown, never
              guessed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comparison"
            className="yr-focus-ring ml-4 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-gray-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-40 p-3 align-bottom text-xs font-semibold text-gray-500"
                >
                  <span className="sr-only">Field</span>
                </th>
                {columns.map((column) => (
                  <th
                    key={column.base._id}
                    scope="col"
                    className="border-b border-[var(--yr-line)] p-3 align-bottom"
                  >
                    <Link
                      to={`/research/${safeRouteSegment(column.base.slug)}`}
                      className="yr-link yr-focus-ring rounded-sm text-sm font-semibold"
                    >
                      {columnHeaderTitle(column)}
                    </Link>
                    {(notesByEntityId[column.base._id] || '').trim() && (
                      <label className="mt-2 flex items-center gap-1.5 text-xs font-normal text-gray-600">
                        <input
                          type="checkbox"
                          checked={includedNoteIds.has(column.base._id)}
                          onChange={() => toggleIncludedNote(column.base._id)}
                          className="yr-focus-ring h-4 w-4 rounded border-[var(--yr-line-strong)] text-[var(--yr-blue)]"
                        />
                        Include my private note
                      </label>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fieldRows.map((row) => (
                <tr key={row.key} className="align-top">
                  <th
                    scope="row"
                    className="p-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {row.label}
                  </th>
                  {columns.map((column) => (
                    <td key={column.base._id} className="border-b border-[var(--yr-line)] p-3">
                      {renderCell(column, row.key)}
                    </td>
                  ))}
                </tr>
              ))}
              {anyNoteIncluded && (
                <tr className="align-top">
                  <th
                    scope="row"
                    className="p-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    Your private note
                  </th>
                  {columns.map((column) => {
                    const note = (notesByEntityId[column.base._id] || '').trim();
                    const included = includedNoteIds.has(column.base._id) && note;
                    return (
                      <td key={column.base._id} className="border-b border-[var(--yr-line)] p-3">
                        {included ? (
                          <p className="text-xs italic text-gray-700">{note}</p>
                        ) : (
                          <span className="text-xs italic text-gray-400">Not shown</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ResearchHomeComparison;
