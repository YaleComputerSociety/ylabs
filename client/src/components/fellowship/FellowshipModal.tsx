/**
 * Detail modal for viewing full fellowship information.
 */
import React, { useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fellowship } from '../../types/types';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import { safeHttpUrl, safeMailtoHref } from '../../utils/url';
import { getFellowshipCycleStatus } from '../../utils/fellowshipCycle';
import { formatFellowshipDate, getFellowshipApplicationStatus } from '../../utils/fellowshipStatus';
import { entryModeLabel, programKindLabel } from '../../utils/programJourney';
import { trackResearchEvent } from '../../utils/researchAnalytics';
import FavoriteButton from '../shared/FavoriteButton';
import LongText from '../shared/LongText';

interface FellowshipModalProps {
  fellowship: Fellowship;
  isOpen: boolean;
  onClose: () => void;
  isFavorite: boolean;
  toggleFavorite: () => void;
}

const RichText = ({ text }: { text: string }) => {
  const linkRegex = /\[([^\]]+)\]\s*\(([^)]+)\)/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(
        <React.Fragment key={`t${lastIndex}`}>{text.slice(lastIndex, match.index)}</React.Fragment>,
      );
    }
    const linkHref = safeHttpUrl(match[2]);
    if (linkHref) {
      elements.push(
        <a
          key={`l${match.index}`}
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          {match[1]}
        </a>,
      );
    } else {
      elements.push(<React.Fragment key={`l${match.index}`}>{match[1]}</React.Fragment>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push(<React.Fragment key={`t${lastIndex}`}>{text.slice(lastIndex)}</React.Fragment>);
  }

  return <span>{elements}</span>;
};

const RichTextBlock = ({ text, className }: { text: string; className?: string }) => {
  if (!/\[[^\]]+\]\s*\([^)]+\)/.test(text)) {
    return <LongText text={text} className={className} />;
  }

  const lines = text.split('\n');
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          <RichText text={line} />
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </div>
  );
};

const trackFellowshipApplyClick = (fellowshipId: string, href: string) => {
  trackResearchEvent({
    eventType: 'source_link_click',
    entityType: 'fellowship',
    entityId: fellowshipId,
    payload: { sourceCategory: 'external', url: href },
  });
  trackResearchEvent({
    eventType: 'ways_in_click',
    entityType: 'fellowship',
    entityId: fellowshipId,
    payload: { waysInKind: 'apply', label: 'Apply' },
  });
};

const FellowshipModal = ({
  fellowship,
  isOpen,
  onClose,
  isFavorite,
  toggleFavorite,
}: FellowshipModalProps) => {
  const navigate = useNavigate();
  const {
    setSelectedYearOfStudy,
    setSelectedTermOfAward,
    setSelectedPurpose,
    setSelectedRegions,
    setSelectedCitizenship,
    setQueryString,
  } = useContext(FellowshipSearchContext);

  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

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
  }, [isOpen]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  if (!isOpen || !fellowship) return null;
  const cycleStatus = getFellowshipCycleStatus(fellowship);
  const applicationStatus = getFellowshipApplicationStatus(fellowship);

  const handleFilterClick = (
    filterType: 'yearOfStudy' | 'termOfAward' | 'purpose' | 'globalRegions' | 'citizenshipStatus',
    value: string,
  ) => {
    setQueryString('');
    setSelectedYearOfStudy([]);
    setSelectedTermOfAward([]);
    setSelectedPurpose([]);
    setSelectedRegions([]);
    setSelectedCitizenship([]);

    switch (filterType) {
      case 'yearOfStudy':
        setSelectedYearOfStudy([value]);
        break;
      case 'termOfAward':
        setSelectedTermOfAward([value]);
        break;
      case 'purpose':
        setSelectedPurpose([value]);
        break;
      case 'globalRegions':
        setSelectedRegions([value]);
        break;
      case 'citizenshipStatus':
        setSelectedCitizenship([value]);
        break;
    }

    trackResearchEvent({
      eventType: 'ways_in_click',
      entityType: 'fellowship',
      entityId: fellowship.id,
      payload: { waysInKind: 'best_next_step', label: filterType },
    });
    onClose();
    navigate('/programs');
  };

  const hasContactInfo =
    fellowship.contactName ||
    fellowship.contactEmail ||
    fellowship.contactPhone ||
    fellowship.contactOffice;
  const iconActionClass =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';
  const filterChipClass =
    'inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-xs transition-all hover:ring-2 hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200';
  const applicationActionLabel = applicationStatus.isApplicationWindowOpen
    ? 'Apply'
    : 'Open source';
  const applicationHref = safeHttpUrl(fellowship.applicationLink);
  const contactEmailHref = safeMailtoHref(fellowship.contactEmail);
  const safeLinks = (fellowship.links || [])
    .map((link) => ({ ...link, href: safeHttpUrl(link.url) }))
    .filter((link) => link.href);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-[var(--yr-panel)] rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="program-detail-title"
        aria-describedby="program-detail-description"
        onKeyDown={handleDialogKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 border-b border-[var(--yr-line)]">
          <div
            className="h-1 w-full"
            style={{ background: 'linear-gradient(90deg, #0055A4 0%, #3b82f6 50%, #93c5fd 100%)' }}
          />
          <div className="px-6 py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {fellowship.competitionType && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                      {fellowship.competitionType}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${cycleStatus.className}`}
                  >
                    {cycleStatus.label}
                  </span>
                </div>

                <h2
                  ref={titleRef}
                  id="program-detail-title"
                  tabIndex={-1}
                  className="text-xl font-bold text-gray-900 leading-tight focus:outline-none"
                >
                  {fellowship.title}
                </h2>
                <p id="program-detail-description" className="sr-only">
                  Program details, eligibility, deadlines, and application actions.
                </p>
              </div>

              <div className="flex flex-shrink-0 flex-wrap items-center gap-1">
                {applicationHref && (
                  <a
                    href={applicationHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      trackFellowshipApplyClick(fellowship.id, applicationHref);
                    }}
                    className={iconActionClass}
                    aria-label={applicationActionLabel}
                    title={applicationActionLabel}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
                {contactEmailHref && (
                  <a
                    href={contactEmailHref}
                    onClick={(e) => {
                      e.stopPropagation();
                      trackResearchEvent({
                        eventType: 'contact_route_click',
                        entityType: 'fellowship',
                        entityId: fellowship.id,
                        payload: { contactMethod: 'email' },
                      });
                    }}
                    className={iconActionClass}
                    title="Email contact"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </a>
                )}
                <FavoriteButton
                  isFavorite={isFavorite}
                  onToggle={(e) => {
                    e.stopPropagation();
                    toggleFavorite();
                  }}
                  size={22}
                />
                <button
                  onClick={onClose}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  aria-label="Close"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
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
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="col-span-1 space-y-6">
                {fellowship.awardAmount && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Award Amount
                    </h3>
                    <div className="bg-emerald-50 rounded-lg p-3">
                      <p className="text-sm font-semibold text-emerald-800">
                        {fellowship.awardAmount}
                      </p>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Program Route
                  </h3>
                  <div className="space-y-2 rounded-lg border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3">
                    <div>
                      <span className="text-xs text-slate-500">What this is</span>
                      <p className="text-sm font-medium text-slate-900">
                        {fellowship.studentFacingCategory ||
                          programKindLabel(fellowship.programKind)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500">Entry mode</span>
                      <p className="text-sm font-medium text-slate-900">
                        {entryModeLabel(fellowship.entryMode)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500">Do you need a mentor first?</span>
                      <p className="text-sm font-medium text-slate-900">
                        {fellowship.requiresMentorBeforeApply ? 'Yes' : 'Not usually'}
                      </p>
                    </div>
                    {fellowship.mentorMatching && (
                      <p className="rounded-md bg-[var(--yr-panel)] px-2.5 py-2 text-xs font-medium text-slate-700">
                        This source suggests a mentor-matching or mentored program route.
                      </p>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Key Dates
                  </h3>
                  <div className="bg-[var(--yr-blue-soft)] rounded-lg p-3 space-y-3">
                    <div>
                      <span className="text-xs text-blue-600">Current Status</span>
                      <p className="text-sm font-semibold text-blue-900">
                        {applicationStatus.label}
                      </p>
                      <p className="text-xs text-blue-700">{applicationStatus.detail}</p>
                    </div>
                    {cycleStatus.category === 'nextCycle' && (
                      <div className="rounded-md bg-[var(--yr-panel)]/70 border border-sky-100 px-2.5 py-2">
                        <p className="text-xs font-medium text-sky-800">
                          Past cycle, useful for next-cycle planning.
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs text-blue-600">Application Opens</span>
                      <p className="text-sm font-medium text-blue-900">
                        {formatFellowshipDate(fellowship.applicationOpenDate)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-blue-600">Deadline</span>
                      <p className="text-sm font-medium text-blue-900">
                        {formatFellowshipDate(fellowship.deadline)}
                      </p>
                    </div>
                  </div>
                </section>

                {hasContactInfo && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Contact
                    </h3>
                    <div className="space-y-2">
                      {fellowship.contactName && (
                        <p className="text-sm text-gray-800 font-medium">
                          {fellowship.contactName}
                        </p>
                      )}
                      {contactEmailHref && (
                        <a
                          href={contactEmailHref}
                          onClick={() =>
                            trackResearchEvent({
                              eventType: 'contact_route_click',
                              entityType: 'fellowship',
                              entityId: fellowship.id,
                              payload: { contactMethod: 'email' },
                            })
                          }
                          className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-md px-2 text-sm text-blue-600 hover:text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="flex-shrink-0"
                          >
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                          </svg>
                          <span className="truncate">{fellowship.contactEmail}</span>
                        </a>
                      )}
                      {fellowship.contactPhone && (
                        <p className="text-sm text-gray-600">{fellowship.contactPhone}</p>
                      )}
                      {fellowship.contactOffice && (
                        <p className="text-sm text-gray-600">{fellowship.contactOffice}</p>
                      )}
                    </div>
                  </section>
                )}

                {(fellowship.compensationSummary ||
                  fellowship.hoursPerWeek ||
                  fellowship.programDates) && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Time & Funding
                    </h3>
                    <div className="space-y-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                      {fellowship.compensationSummary && <p>{fellowship.compensationSummary}</p>}
                      {fellowship.hoursPerWeek && <p>{fellowship.hoursPerWeek} hours/week</p>}
                      {fellowship.programDates && <p>{fellowship.programDates}</p>}
                    </div>
                  </section>
                )}

                {safeLinks.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Links
                    </h3>
                    <div className="space-y-1.5">
                      {safeLinks.map((link, i) => (
                        <a
                          key={i}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (link.href) {
                              trackResearchEvent({
                                eventType: 'source_link_click',
                                entityType: 'fellowship',
                                entityId: fellowship.id,
                                payload: { sourceCategory: 'external', url: link.href },
                              });
                            }
                          }}
                          className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-md px-2 text-sm text-blue-600 hover:text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="flex-shrink-0"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                          </svg>
                          <span className="truncate">{link.label || link.url}</span>
                        </a>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Eligibility Filters
                  </h3>
                  <p className="text-xs text-gray-400 mb-3">Click to find similar fellowships</p>
                  <div className="space-y-3">
                    {fellowship.yearOfStudy.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500">Year of Study</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {fellowship.yearOfStudy.map((year) => (
                            <button
                              key={year}
                              onClick={() => handleFilterClick('yearOfStudy', year)}
                              className={`${filterChipClass} bg-[var(--yr-blue-soft)] text-blue-800`}
                            >
                              {year}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {fellowship.termOfAward.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500">Term of Award</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {fellowship.termOfAward.map((term) => (
                            <button
                              key={term}
                              onClick={() => handleFilterClick('termOfAward', term)}
                              className={`${filterChipClass} bg-yellow-100 text-yellow-800`}
                            >
                              {term}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {fellowship.purpose.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500">Purpose</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {fellowship.purpose.map((p) => (
                            <button
                              key={p}
                              onClick={() => handleFilterClick('purpose', p)}
                              className={`${filterChipClass} bg-purple-100 text-purple-800`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {fellowship.globalRegions.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500">Global Regions</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {fellowship.globalRegions.map((region) => (
                            <button
                              key={region}
                              onClick={() => handleFilterClick('globalRegions', region)}
                              className={`${filterChipClass} bg-green-100 text-green-800`}
                            >
                              {region}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {fellowship.citizenshipStatus.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500">Citizenship Status</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {fellowship.citizenshipStatus.map((status) => (
                            <button
                              key={status}
                              onClick={() => handleFilterClick('citizenshipStatus', status)}
                              className={`${filterChipClass} bg-orange-100 text-orange-800`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="col-span-1 md:col-span-2 space-y-6">
                {fellowship.bestNextStep && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      What To Do Next
                    </h3>
                    <p className="rounded-lg border border-blue-100 bg-[var(--yr-blue-soft)]/70 p-4 text-sm leading-relaxed text-blue-950">
                      {fellowship.bestNextStep}
                    </p>
                  </section>
                )}

                {fellowship.prepSteps.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Prep Steps
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {fellowship.prepSteps.map((step) => (
                        <span
                          key={step}
                          className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] px-2.5 py-1 text-xs font-medium text-slate-700"
                        >
                          {step}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {fellowship.summary && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Brief Description
                    </h3>
                    <RichTextBlock
                      text={fellowship.summary}
                      className="text-sm text-gray-700 leading-relaxed"
                    />
                  </section>
                )}

                {fellowship.description && fellowship.description !== fellowship.summary && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Full Description
                    </h3>
                    <RichTextBlock
                      text={fellowship.description}
                      className="text-sm text-gray-700 leading-relaxed"
                    />
                  </section>
                )}

                {fellowship.applicationInformation && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Application Information
                    </h3>
                    <RichTextBlock
                      text={fellowship.applicationInformation}
                      className="text-sm text-gray-700 leading-relaxed bg-[var(--yr-blue-soft)]/50 border border-blue-100 rounded-lg p-4"
                    />
                  </section>
                )}

                {fellowship.eligibility && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Eligibility Requirements
                    </h3>
                    <RichTextBlock
                      text={fellowship.eligibility}
                      className="text-sm text-gray-700 leading-relaxed"
                    />
                  </section>
                )}

                {!fellowship.eligibility && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Eligibility Requirements
                    </h3>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {applicationStatus.needsEligibilityReview
                        ? 'Eligibility requirements have not been specified.'
                        : 'See the eligibility filters above for requirements.'}
                    </p>
                  </section>
                )}

                {fellowship.restrictionsToUseOfAward && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Restrictions to Use of Award
                    </h3>
                    <RichTextBlock
                      text={fellowship.restrictionsToUseOfAward}
                      className="text-sm text-gray-700 leading-relaxed"
                    />
                  </section>
                )}

                {fellowship.additionalInformation && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                      Additional Information
                    </h3>
                    <RichTextBlock
                      text={fellowship.additionalInformation}
                      className="text-sm text-gray-700 leading-relaxed"
                    />
                  </section>
                )}

                {applicationHref && (
                  <div className="pt-4 border-t border-[var(--yr-line)]">
                    {!applicationStatus.isApplicationWindowOpen && (
                      <p className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                        {applicationStatus.kind === 'notOpenYet'
                          ? `Applications are not open yet. They open ${formatFellowshipDate(fellowship.applicationOpenDate)}.`
                          : 'This application window is not currently open. Use the source to verify the next cycle.'}
                      </p>
                    )}
                    <a
                      href={applicationHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackFellowshipApplyClick(fellowship.id, applicationHref)}
                      className={`inline-flex min-h-[44px] items-center rounded-md px-6 py-2.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 ${
                        applicationStatus.isApplicationWindowOpen
                          ? 'bg-blue-600 hover:bg-blue-700'
                          : 'bg-gray-600 hover:bg-gray-700'
                      }`}
                    >
                      {applicationStatus.isApplicationWindowOpen
                        ? 'Apply Now'
                        : applicationStatus.kind === 'notOpenYet'
                          ? 'Track Opening Date'
                          : 'Open Fellowship Source'}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="ml-2"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FellowshipModal;
