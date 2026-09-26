/**
 * Detail modal for viewing full fellowship information.
 */
import React, { useContext, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fellowship } from '../../types/types';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import { safeHttpUrl, safeMailtoHref } from '../../utils/url';
import { getFellowshipCycleStatus } from '../../utils/fellowshipCycle';
import {
  formatFellowshipDate,
  getFellowshipApplicationStatus,
  getStructuredEligibilityDetails,
} from '../../utils/fellowshipStatus';
import { entryModeLabel, programKindLabel } from '../../utils/programJourney';
import { buildSafeProgramLinks } from '../../utils/programLinks';
import {
  isLikelyUnavailableSourceLink,
  labelizeResearchDetailValue,
} from '../../utils/researchDetailSources';
import { trackResearchEvent } from '../../utils/researchAnalytics';
import FavoriteButton from '../shared/FavoriteButton';
import LongText from '../shared/LongText';
import { CloseIcon, ExternalLinkIcon, GlobeIcon, MailIcon } from '../shared/icons';

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
          className="text-brand hover:underline yr-focus-ring"
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
  void trackResearchEvent({
    eventType: 'source_link_click',
    entityType: 'fellowship',
    entityId: fellowshipId,
    payload: { sourceCategory: 'external', url: href },
  });
  void trackResearchEvent({
    eventType: 'ways_in_click',
    entityType: 'fellowship',
    entityId: fellowshipId,
    payload: { waysInKind: 'apply', label: 'Apply' },
  });
};

const sectionHeadingClass = 'mb-3 text-xs font-semibold uppercase tracking-wider text-muted';

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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

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
  const structuredEligibilityDetails = getStructuredEligibilityDetails(fellowship);
  const mentorFirstAnswer = fellowship.requiresMentorBeforeApply
    ? 'Yes, secure a mentor before applying'
    : fellowship.mentorMatching
      ? 'Not first, the program helps match you with a mentor'
      : 'Not usually';

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

    void trackResearchEvent({
      eventType: 'ways_in_click',
      entityType: 'fellowship',
      entityId: fellowship.id,
      payload: { waysInKind: 'best_next_step', label: filterType },
    });
    onClose();
    void navigate('/programs');
  };

  const hasContactInfo =
    fellowship.contactName ||
    fellowship.contactEmail ||
    fellowship.contactPhone ||
    fellowship.contactOffice;
  const iconActionClass =
    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-card text-muted transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-brand yr-focus-ring';
  const filterChipClass =
    'inline-flex min-h-[44px] items-center rounded-control px-3 py-2 text-xs [transition-property:box-shadow] hover:ring-2 hover:ring-offset-1 yr-focus-ring';
  const applicationActionLabel = applicationStatus.isApplicationWindowOpen
    ? 'Apply'
    : 'Open source';
  const sourceLinkUnavailable = isLikelyUnavailableSourceLink(fellowship.sourceLinkHealth);
  const sourceHref = sourceLinkUnavailable ? undefined : safeHttpUrl(fellowship.sourceUrl);
  const applicationHref = safeHttpUrl(fellowship.applicationLink) || sourceHref;
  const sourceLabel =
    typeof fellowship.sourceName === 'string' && fellowship.sourceName.trim()
      ? labelizeResearchDetailValue(fellowship.sourceName)
      : '';
  const contactEmailHref = safeMailtoHref(fellowship.contactEmail);
  const safeLinks = buildSafeProgramLinks(fellowship.links, fellowship.sourceUrl);
  const applicationMaterials = fellowship.applicationMaterials || [];
  const summaryText = (fellowship.summary ?? '').trim();
  const descriptionText = (fellowship.description ?? '').trim();
  const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ');
  const hasDistinctSummaryAndDescription =
    !!summaryText &&
    !!descriptionText &&
    collapseWhitespace(summaryText) !== collapseWhitespace(descriptionText);
  const combinedDescriptionText = descriptionText || summaryText;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-[var(--yr-panel)] rounded-overlay shadow-yr-modal w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
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
            style={{
              background:
                'linear-gradient(90deg, var(--yr-navy) 0%, var(--yr-blue) 50%, var(--yr-blue-soft) 100%)',
            }}
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
                  {fellowship.researchFocused && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-medium">
                      Research-focused
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
                  className="text-xl font-semibold text-ink leading-tight focus:outline-none"
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
                    <ExternalLinkIcon size={18} />
                  </a>
                )}
                {contactEmailHref && (
                  <a
                    href={contactEmailHref}
                    onClick={(e) => {
                      e.stopPropagation();
                      void trackResearchEvent({
                        eventType: 'contact_route_click',
                        entityType: 'fellowship',
                        entityId: fellowship.id,
                        payload: { contactMethod: 'email' },
                      });
                    }}
                    className={iconActionClass}
                    title="Email contact"
                  >
                    <MailIcon size={18} />
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
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-card text-muted transition-colors hover:bg-[var(--yr-panel-muted)] hover:text-ink-soft yr-focus-ring"
                  aria-label="Close"
                >
                  <CloseIcon className="h-5 w-5" />
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
                    <h3 className={sectionHeadingClass}>Award Amount</h3>
                    <div className="bg-emerald-50 rounded-card p-3">
                      <p className="text-sm font-semibold text-emerald-800">
                        {fellowship.awardAmount}
                      </p>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className={sectionHeadingClass}>Program Route</h3>
                  <div className="space-y-2 rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel-muted)] p-3">
                    <div>
                      <span className="text-xs text-muted">What this is</span>
                      <p className="text-sm font-medium text-ink">
                        {fellowship.studentFacingCategory ||
                          programKindLabel(fellowship.programKind)}
                      </p>
                    </div>
                    {(fellowship.undergraduateOnly === false ||
                      fellowship.undergraduateOnly === true ||
                      fellowship.yaleCollegeOnly === true) && (
                      <div>
                        <span className="text-xs text-muted">Audience</span>
                        <p className="text-sm font-medium text-ink">
                          {fellowship.undergraduateOnly === false
                            ? 'Graduate students'
                            : 'Undergraduate students'}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs text-muted">Entry mode</span>
                      <p className="text-sm font-medium text-ink">
                        {entryModeLabel(fellowship.entryMode)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted">Do you need a mentor first?</span>
                      <p className="text-sm font-medium text-ink">{mentorFirstAnswer}</p>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className={sectionHeadingClass}>Key Dates</h3>
                  <div className="bg-[var(--yr-blue-soft)] rounded-card p-3 space-y-3">
                    <div>
                      <span className="text-xs text-brand">Current Status</span>
                      <p className="text-sm font-semibold text-brand-navy">
                        {applicationStatus.label}
                      </p>
                      <p className="text-xs text-brand">{applicationStatus.detail}</p>
                    </div>
                    {cycleStatus.category === 'nextCycle' && (
                      <div className="rounded-card bg-[var(--yr-panel)]/70 border border-sky-100 px-2.5 py-2">
                        <p className="text-xs font-medium text-sky-800">
                          Past cycle, useful for next-cycle planning.
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-xs text-brand">Application Opens</span>
                      <p className="text-sm font-medium text-brand-navy">
                        {formatFellowshipDate(fellowship.applicationOpenDate)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-brand">
                        {fellowship.deadlineProjectedNextCycle
                          ? 'Estimated Next Deadline'
                          : 'Deadline'}
                      </span>
                      <p className="text-sm font-medium text-brand-navy">
                        {formatFellowshipDate(fellowship.deadline)}
                      </p>
                      {fellowship.deadlineProjectedNextCycle && (
                        <p className="text-xs text-brand">
                          Projected from the last cycle - unconfirmed, verify at source.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                {hasContactInfo && (
                  <section>
                    <h3 className={sectionHeadingClass}>Contact</h3>
                    <div className="space-y-2">
                      {fellowship.contactName && (
                        <p className="text-sm text-ink font-medium">{fellowship.contactName}</p>
                      )}
                      {contactEmailHref && (
                        <a
                          href={contactEmailHref}
                          onClick={() =>
                            void trackResearchEvent({
                              eventType: 'contact_route_click',
                              entityType: 'fellowship',
                              entityId: fellowship.id,
                              payload: { contactMethod: 'email' },
                            })
                          }
                          className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-control px-2 text-sm text-brand hover:text-brand-navy hover:underline yr-focus-ring"
                        >
                          <MailIcon className="flex-shrink-0" size={14} />
                          <span className="truncate">{fellowship.contactEmail}</span>
                        </a>
                      )}
                      {fellowship.contactPhone && (
                        <p className="text-sm text-muted">{fellowship.contactPhone}</p>
                      )}
                      {fellowship.contactOffice && (
                        <p className="text-sm text-muted">{fellowship.contactOffice}</p>
                      )}
                    </div>
                  </section>
                )}

                {(fellowship.compensationSummary ||
                  fellowship.hoursPerWeek ||
                  fellowship.programDates) && (
                  <section>
                    <h3 className={sectionHeadingClass}>Time & Funding</h3>
                    <div className="space-y-2 rounded-card bg-emerald-50 p-3 text-sm text-emerald-900">
                      {fellowship.compensationSummary && <p>{fellowship.compensationSummary}</p>}
                      {fellowship.hoursPerWeek && <p>{fellowship.hoursPerWeek} hours/week</p>}
                      {fellowship.programDates && <p>{fellowship.programDates}</p>}
                    </div>
                  </section>
                )}

                {safeLinks.length > 0 && (
                  <section>
                    <h3 className={sectionHeadingClass}>Links</h3>
                    <div className="space-y-1.5">
                      {safeLinks.map((link, i) => (
                        <a
                          key={i}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (link.href) {
                              void trackResearchEvent({
                                eventType: 'source_link_click',
                                entityType: 'fellowship',
                                entityId: fellowship.id,
                                payload: { sourceCategory: 'external', url: link.href },
                              });
                            }
                          }}
                          className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-control px-2 text-sm text-brand hover:text-brand-navy hover:underline yr-focus-ring"
                        >
                          <GlobeIcon className="flex-shrink-0" size={14} />
                          <span className="truncate">{link.label || link.url}</span>
                        </a>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className={sectionHeadingClass}>Eligibility Filters</h3>
                  <p className="text-xs text-muted mb-3">Click to find similar fellowships</p>
                  <div className="space-y-3">
                    {fellowship.yearOfStudy.length > 0 && (
                      <div>
                        <span className="text-xs text-muted">Year of Study</span>
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
                        <span className="text-xs text-muted">Term of Award</span>
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
                        <span className="text-xs text-muted">Purpose</span>
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
                        <span className="text-xs text-muted">Global Regions</span>
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
                        <span className="text-xs text-muted">Citizenship Status</span>
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
                    <h3 className={sectionHeadingClass}>What To Do Next</h3>
                    <p className="rounded-card border border-line-brand bg-brand-soft/70 p-4 text-sm leading-relaxed text-brand-navy">
                      {fellowship.bestNextStep}
                    </p>
                  </section>
                )}

                {fellowship.prepSteps.length > 0 && (
                  <section>
                    <h3 className={sectionHeadingClass}>Prep Steps</h3>
                    <div className="flex flex-wrap gap-2">
                      {fellowship.prepSteps.map((step) => (
                        <span
                          key={step}
                          className="rounded-card border border-[var(--yr-line)] bg-[var(--yr-panel)] px-2.5 py-1 text-xs font-medium text-ink-soft"
                        >
                          {step}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {(fellowship.applicationInformation || applicationMaterials.length > 0) && (
                  <section>
                    <h3 className={sectionHeadingClass}>Application Process</h3>
                    <div className="space-y-3 rounded-card border border-line-brand bg-brand-soft/50 p-4">
                      {applicationMaterials.length > 0 && (
                        <div>
                          <p className="mb-2 text-xs font-semibold text-brand-navy">
                            Materials listed by the official source
                          </p>
                          <ul className="grid gap-2 sm:grid-cols-2">
                            {applicationMaterials.map((material) => (
                              <li
                                key={material}
                                className="flex items-start gap-2 text-sm text-ink-soft"
                              >
                                <span aria-hidden="true" className="mt-0.5 text-brand">
                                  ✓
                                </span>
                                <span>{material}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {fellowship.applicationInformation && (
                        <RichTextBlock
                          text={fellowship.applicationInformation}
                          className="text-sm leading-relaxed text-ink-soft"
                        />
                      )}
                      {applicationHref && (
                        <a
                          href={applicationHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackFellowshipApplyClick(fellowship.id, applicationHref)}
                          className="yr-pressable inline-flex min-h-[44px] items-center rounded-control bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy yr-focus-ring"
                        >
                          Open official application
                        </a>
                      )}
                    </div>
                  </section>
                )}

                {hasDistinctSummaryAndDescription ? (
                  <>
                    <section>
                      <h3 className={sectionHeadingClass}>Brief Description</h3>
                      <RichTextBlock
                        text={summaryText}
                        className="text-sm text-ink-soft leading-relaxed"
                      />
                    </section>

                    <section>
                      <h3 className={sectionHeadingClass}>Full Description</h3>
                      <RichTextBlock
                        text={descriptionText}
                        className="text-sm text-ink-soft leading-relaxed"
                      />
                    </section>
                  </>
                ) : (
                  combinedDescriptionText && (
                    <section>
                      <h3 className={sectionHeadingClass}>Description</h3>
                      <RichTextBlock
                        text={combinedDescriptionText}
                        className="text-sm text-ink-soft leading-relaxed"
                      />
                    </section>
                  )
                )}

                {fellowship.eligibility && (
                  <section>
                    <h3 className={sectionHeadingClass}>Eligibility Requirements</h3>
                    <RichTextBlock
                      text={fellowship.eligibility}
                      className="text-sm text-ink-soft leading-relaxed"
                    />
                  </section>
                )}

                {!fellowship.eligibility && (
                  <section>
                    <h3 className={sectionHeadingClass}>Eligibility Requirements</h3>
                    {structuredEligibilityDetails.length > 0 ? (
                      <dl className="space-y-1.5">
                        {structuredEligibilityDetails.map((detail) => (
                          <div key={detail.label} className="text-sm leading-relaxed">
                            <dt className="inline font-semibold text-muted">{detail.label}: </dt>
                            <dd className="inline text-ink-soft">{detail.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-ink-soft leading-relaxed">
                        Eligibility requirements have not been specified.
                      </p>
                    )}
                  </section>
                )}

                {fellowship.restrictionsToUseOfAward && (
                  <section>
                    <h3 className={sectionHeadingClass}>Restrictions to Use of Award</h3>
                    <RichTextBlock
                      text={fellowship.restrictionsToUseOfAward}
                      className="text-sm text-ink-soft leading-relaxed"
                    />
                  </section>
                )}

                {fellowship.additionalInformation && (
                  <section>
                    <h3 className={sectionHeadingClass}>Additional Information</h3>
                    <RichTextBlock
                      text={fellowship.additionalInformation}
                      className="text-sm text-ink-soft leading-relaxed"
                    />
                  </section>
                )}

                {applicationHref && (
                  <div className="pt-4 border-t border-[var(--yr-line)]">
                    {!applicationStatus.isApplicationWindowOpen && (
                      <p className="mb-3 rounded-card border border-line-brand bg-brand-soft p-3 text-sm text-brand">
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
                      className={`inline-flex min-h-[44px] items-center rounded-control px-6 py-2.5 text-sm font-medium text-white transition-colors yr-focus-ring ${
                        applicationStatus.isApplicationWindowOpen
                          ? 'bg-brand hover:bg-brand-navy'
                          : 'bg-muted hover:bg-ink-soft'
                      }`}
                    >
                      {applicationStatus.isApplicationWindowOpen
                        ? 'Apply Now'
                        : applicationStatus.kind === 'notOpenYet'
                          ? 'Track Opening Date'
                          : 'Open Fellowship Source'}
                      <ExternalLinkIcon className="ml-2" size={16} />
                    </a>
                  </div>
                )}

                {(sourceLabel || sourceHref) && (
                  <p className="mt-4 border-t border-[var(--yr-line)] pt-3 text-xs text-muted">
                    Source:{' '}
                    {sourceHref ? (
                      <a
                        href={sourceHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline yr-focus-ring"
                      >
                        {sourceLabel || 'Official source'}
                      </a>
                    ) : (
                      <span className="text-muted">{sourceLabel}</span>
                    )}
                  </p>
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
