/**
 * Detail modal for viewing full listing information.
 */
import React, { useEffect, useState, useContext, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Listing } from '../../types/types';
import UserContext from '../../contexts/UserContext';
import ConfigContext from '../../contexts/ConfigContext';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';
import { ensureHttpPrefix } from '../../utils/url';
import { getInstitutionAffiliation, getInstitutionLabel } from '../../utils/institutionAffiliation';
import FavoriteButton from './FavoriteButton';

interface ListingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onRequireAuth?: () => void;
  onNavigateToResearchArea?: (area: string) => void;
  onNavigateToDepartment?: (dept: string) => void;
}

const ListingDetailModal = ({
  isOpen,
  onClose,
  listing,
  isFavorite,
  onToggleFavorite,
  onRequireAuth,
  onNavigateToResearchArea,
  onNavigateToDepartment,
}: ListingDetailModalProps) => {
  const isCreated = listing.id === 'create';
  const [restrictedStats, setRestrictedStats] = useState(true);
  const { user, isAuthenticated } = useContext(UserContext);
  const { getColorForResearchArea, getDepartmentByAbbr } = useContext(ConfigContext);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  const researchAreas =
    listing.researchAreas?.length > 0 ? listing.researchAreas : listing.keywords || [];
  const isLabOpen = listing.hiringStatus >= 0;
  const institutionCode = getInstitutionAffiliation(listing.departments);
  const institutionLabel = getInstitutionLabel(institutionCode);
  const professorName = `${listing.ownerFirstName} ${listing.ownerLastName}`;
  const contactEmails = [listing.ownerEmail, ...(listing.emails || [])].filter(Boolean);
  const canEmailContact = isAuthenticated && contactEmails.length > 0;
  const titleId = `listing-detail-title-${listing.id}`;
  const descriptionId = `listing-detail-description-${listing.id}`;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  useEffect(() => {
    if (user && user.userConfirmed && ['admin', 'professor', 'faculty'].includes(user.userType)) {
      setRestrictedStats(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    return () => {
      previouslyFocusedElement.current?.focus?.();
    };
  }, [isOpen]);

  const getFocusableElements = () => {
    if (!dialogRef.current) return [];
    return Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true' &&
        element.tabIndex !== -1,
    );
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) {
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (e.shiftKey && (activeElement === firstElement || activeElement === dialogRef.current)) {
      e.preventDefault();
      lastElement.focus();
    } else if (
      !e.shiftKey &&
      (activeElement === lastElement || activeElement === dialogRef.current)
    ) {
      e.preventDefault();
      firstElement.focus();
    }
  };

  if (!isOpen || !listing) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="flex-shrink-0 border-b border-gray-100">
          <div
            className="h-1 w-full"
            style={{ background: 'linear-gradient(90deg, #0055A4 0%, #3b82f6 50%, #93c5fd 100%)' }}
          />
          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {listing.departments && listing.departments.length > 0 && (
                    <span className="text-sm font-semibold text-blue-700">
                      {(() => {
                        const deps = [...listing.departments];
                        const primary = listing.ownerPrimaryDepartment;
                        if (primary && deps.length > 1) {
                          const idx = deps.findIndex(
                            (d) =>
                              d === primary ||
                              getDepartmentAbbreviation(d) === getDepartmentAbbreviation(primary),
                          );
                          if (idx > 0) {
                            deps.splice(idx, 1);
                            deps.unshift(primary);
                          } else if (idx === -1) {
                            deps.unshift(primary);
                          }
                        }
                        return deps.map((d) => getDepartmentAbbreviation(d)).join(' | ');
                      })()}
                    </span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                    {institutionCode} — {institutionLabel}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      isLabOpen ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                    }`}
                  >
                    {isLabOpen ? 'Accepting Applications' : 'Not Accepting'}
                  </span>
                </div>

                <h2 id={titleId} className="text-xl font-bold text-gray-900 leading-tight">
                  {professorName}
                </h2>
                {listing.ownerTitle && (
                  <p className="text-sm text-gray-500 mt-0.5">{listing.ownerTitle}</p>
                )}
                <p className="text-base text-gray-600 mt-0.5">{listing.title}</p>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {!isCreated && (
                  <>
                    {listing.websites && listing.websites.length > 0 && (
                      <a
                        href={ensureHttpPrefix(listing.websites[0])}
                        onClick={(e) => e.stopPropagation()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-blue-600"
                        aria-label={`Visit ${professorName}'s website`}
                        title="Visit website"
                      >
                        <svg
                          aria-hidden="true"
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
                    {canEmailContact ? (
                      <a
                        href={`mailto:${contactEmails[0]}`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-blue-600"
                        aria-label={`Email ${professorName}`}
                        title="Send email"
                      >
                        <svg
                          aria-hidden="true"
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
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isAuthenticated) {
                            onRequireAuth?.();
                          }
                        }}
                        disabled={isAuthenticated}
                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-blue-600 disabled:text-gray-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        aria-label={
                          isAuthenticated ? 'Contact details unavailable' : 'Sign in to inquire'
                        }
                        title={
                          isAuthenticated ? 'Contact details unavailable' : 'Sign in to inquire'
                        }
                      >
                        <svg
                          aria-hidden="true"
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
                      </button>
                    )}
                    <span className="px-1">
                      <FavoriteButton
                        isFavorite={isFavorite}
                        onToggle={onToggleFavorite}
                        size={22}
                      />
                    </span>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
                  aria-label="Close listing details"
                >
                  <svg
                    aria-hidden="true"
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
                <section>
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                    Investigators
                  </h3>
                  <div className="space-y-2.5">
                    {[
                      { name: professorName, netid: listing.ownerId },
                      ...(listing.professorNames || []).map((name, i) => ({
                        name,
                        netid: listing.professorIds?.[i] || null,
                      })),
                    ].map(({ name, netid }, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
                          {name.charAt(0).toUpperCase()}
                        </div>
                        {netid ? (
                          <Link
                            to={`/profile/${netid}`}
                            onClick={onClose}
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="text-sm text-gray-800 font-medium">{name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {researchAreas.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                      Research Areas
                    </h3>
                    {onNavigateToResearchArea && (
                      <p className="text-xs text-gray-600 mb-2">Find similar labs</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {researchAreas.map((area: string) => {
                        const colors = getColorForResearchArea(area);
                        if (onNavigateToResearchArea) {
                          return (
                            <button
                              key={area}
                              onClick={() => onNavigateToResearchArea(area)}
                              className={`${colors.bg} ${colors.text} text-xs rounded-md px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all`}
                            >
                              {area}
                            </button>
                          );
                        }
                        return (
                          <span
                            key={area}
                            className={`${colors.bg} ${colors.text} text-xs rounded-md px-2 py-1`}
                          >
                            {area}
                          </span>
                        );
                      })}
                    </div>
                  </section>
                )}

                {listing.departments && listing.departments.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                      Departments
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        const deps = [...listing.departments];
                        const primary = listing.ownerPrimaryDepartment;
                        if (primary && deps.length > 1) {
                          const idx = deps.findIndex(
                            (d) =>
                              d === primary ||
                              getDepartmentAbbreviation(d) === getDepartmentAbbreviation(primary),
                          );
                          if (idx > 0) {
                            deps.splice(idx, 1);
                            deps.unshift(primary);
                          } else if (idx === -1) {
                            deps.unshift(primary);
                          }
                        }
                        return deps;
                      })().map((dept: string) => {
                        const abbr = getDepartmentAbbreviation(dept);
                        const deptConfig = getDepartmentByAbbr(abbr);
                        const fullName = deptConfig?.displayName || dept;
                        if (onNavigateToDepartment) {
                          return (
                            <button
                              key={dept}
                              onClick={() => onNavigateToDepartment(fullName)}
                              className="bg-gray-100 text-gray-700 text-xs rounded-md px-2 py-1 hover:bg-gray-200 hover:ring-2 hover:ring-gray-300 cursor-pointer transition-all"
                            >
                              {fullName}
                            </button>
                          );
                        }
                        return (
                          <span
                            key={dept}
                            className="bg-gray-100 text-gray-700 text-xs rounded-md px-2 py-1"
                          >
                            {fullName}
                          </span>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                    Contact
                  </h3>
                  <div className="space-y-2">
                    {canEmailContact ? (
                      contactEmails.map((email, i) => (
                        <a
                          key={i}
                          href={`mailto:${email}`}
                          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          <svg
                            aria-hidden="true"
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
                          <span className="truncate">{email}</span>
                        </a>
                      ))
                    ) : !isAuthenticated ? (
                      <button
                        type="button"
                        onClick={onRequireAuth}
                        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        <svg
                          aria-hidden="true"
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
                        <span>Sign in to inquire</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <svg
                          aria-hidden="true"
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
                        <span>Contact details unavailable</span>
                      </div>
                    )}
                    {listing.websites &&
                      listing.websites.length > 0 &&
                      listing.websites.map((website, i) => (
                        <a
                          key={i}
                          href={ensureHttpPrefix(website)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          <svg
                            aria-hidden="true"
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
                          <span className="truncate">{website}</span>
                        </a>
                      ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                    Details
                  </h3>
                  <div className="space-y-1.5 text-sm">
                    {!restrictedStats && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Views</span>
                          <span className="font-medium text-gray-800">{listing.views}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Favorites</span>
                          <span className="font-medium text-gray-800">{listing.favorites}</span>
                        </div>
                      </>
                    )}
                    {listing.established && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Established</span>
                        <span className="font-medium text-gray-800">{listing.established}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Added</span>
                      <span className="font-medium text-gray-800">
                        {new Date(listing.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </section>
              </div>

              <div className="col-span-1 md:col-span-2 space-y-6">
                <section>
                  <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                    Research Description
                  </h3>
                  <div
                    id={descriptionId}
                    className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap"
                  >
                    {listing.description}
                  </div>
                </section>
                {listing.applicantDescription && listing.applicantDescription.trim() !== '' && (
                  <section>
                    <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
                      Applicant Prerequisites
                    </h3>
                    <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-amber-50/50 border border-amber-100 rounded-lg p-4">
                      {listing.applicantDescription}
                    </div>
                  </section>
                )}
                {listing.archived && (
                  <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                    <div className="font-semibold text-sm">This listing is archived</div>
                    <div className="text-sm mt-1">
                      Archived listings are not visible in search results or as favorites.
                    </div>
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

export default ListingDetailModal;
