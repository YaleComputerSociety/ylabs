import React, { useEffect, useState, useContext } from 'react';
import { Listing } from '../../types/types';
import UserContext from '../../contexts/UserContext';
import ConfigContext from '../../contexts/ConfigContext';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';
import { ensureHttpPrefix } from '../../utils/url';
import FavoriteButton from './FavoriteButton';

interface ListingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  // Optional: if provided, research areas/departments become clickable filters
  onNavigateToResearchArea?: (area: string) => void;
  onNavigateToDepartment?: (dept: string) => void;
}

const ListingDetailModal = ({
  isOpen, onClose, listing, isFavorite, onToggleFavorite,
  onNavigateToResearchArea, onNavigateToDepartment,
}: ListingDetailModalProps) => {
  const isCreated = listing.id === 'create';
  const [restrictedStats, setRestrictedStats] = useState(true);
  const { user } = useContext(UserContext);
  const { getColorForResearchArea, getDepartmentByAbbr } = useContext(ConfigContext);

  const researchAreas = listing.researchAreas?.length > 0 ? listing.researchAreas : (listing.keywords || []);
  const isLabOpen = listing.hiringStatus >= 0;

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
    return () => { document.body.style.overflow = 'auto'; };
  }, [isOpen]);

  if (!isOpen || !listing) return null;

  return (
    <div
      className="fixed inset-0 bg-black/65 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-24"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="h-1 w-full flex-shrink-0" style={{ background: 'linear-gradient(90deg, #0055A4 0%, #3b82f6 50%, #93c5fd 100%)', opacity: 0.85 }} />
        <div className="p-6 relative overflow-y-auto flex-1">

          {/* Utility buttons */}
          <div className="absolute top-4 right-4 flex items-center">
            {!isCreated && (
              <>
                {listing.websites && listing.websites.length > 0 && (
                  <a href={ensureHttpPrefix(listing.websites[0])} onClick={(e) => e.stopPropagation()} target="_blank" rel="noopener noreferrer">
                    <button className="p-1 rounded-full mr-1">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-colors" style={{ stroke: '#000000' }} onMouseEnter={(e) => e.currentTarget.style.stroke = '#0055A4'} onMouseLeave={(e) => e.currentTarget.style.stroke = '#000000'}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>
                  </a>
                )}
                <a href={`mailto:${listing.ownerEmail}`} onClick={(e) => e.stopPropagation()}>
                  <button className="p-1 rounded-full mr-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-colors" style={{ stroke: '#000000' }} onMouseEnter={(e) => e.currentTarget.style.stroke = '#0055A4'} onMouseLeave={(e) => e.currentTarget.style.stroke = '#000000'}>
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </button>
                </a>
                <span className="mr-2">
                  <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} size={24} />
                </span>
              </>
            )}
            <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Header */}
          <div className="mb-6 pr-20">
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <h2 className="text-2xl font-bold md:max-w-[400px] lg:max-w-[600px]">{listing.title}</h2>
              <span className={`mt-2 md:mt-0 md:ml-2 text-xs px-2 py-1 rounded-full inline-block w-fit ${
                isLabOpen ? 'bg-green-500/20 text-green-700' : 'bg-red-500/20 text-red-700'
              }`}>
                {isLabOpen ? 'Open' : 'Not Open'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left column */}
            <div className="col-span-1">
              {/* Professors */}
              <section className="mb-6">
                <h3 className="text-lg font-semibold mb-2">Professors</h3>
                <div className="space-y-2">
                  {[`${listing.ownerFirstName} ${listing.ownerLastName}`, ...listing.professorNames].map((name, i) => (
                    <div key={i} className="flex items-center">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center mr-2">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Research Areas */}
              {researchAreas.length > 0 && (
                <section className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">Research Areas</h3>
                  {onNavigateToResearchArea && (
                    <p className="text-xs text-gray-500 mb-2">Click to search for similar listings</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {researchAreas.map((area: string) => {
                      const colors = getColorForResearchArea(area);
                      if (onNavigateToResearchArea) {
                        return (
                          <button key={area} onClick={() => onNavigateToResearchArea(area)} className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all`}>
                            {area}
                          </button>
                        );
                      }
                      return (
                        <span key={area} className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1`}>
                          {area}
                        </span>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Departments */}
              {onNavigateToDepartment && listing.departments && listing.departments.length > 0 && (
                <section className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">Departments</h3>
                  <div className="flex flex-wrap gap-2">
                    {listing.departments.map((dept: string) => {
                      const abbr = getDepartmentAbbreviation(dept);
                      const deptConfig = getDepartmentByAbbr(abbr);
                      const fullName = deptConfig?.displayName || dept;
                      return (
                        <button key={dept} onClick={() => onNavigateToDepartment(fullName)} className="bg-gray-100 text-gray-700 text-xs rounded px-2 py-1 hover:bg-gray-200 hover:ring-2 hover:ring-gray-300 cursor-pointer transition-all">
                          {fullName}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Contact Information */}
              <section className="mb-6">
                <h3 className="text-lg font-semibold mb-2">Contact Information</h3>
                <div className="mb-4">
                  <h4 className="text-md font-medium">Emails</h4>
                  <ul className="mt-1 space-y-1">
                    {[listing.ownerEmail, ...listing.emails].map((email, i) => (
                      <li key={i}><a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a></li>
                    ))}
                  </ul>
                </div>
                {listing.websites && listing.websites.length > 0 && (
                  <div>
                    <h4 className="text-md font-medium">Websites</h4>
                    <ul className="mt-1 space-y-1">
                      {listing.websites.map((website, i) => (
                        <li key={i} className="truncate">
                          <a href={ensureHttpPrefix(website)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{website}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* Stats */}
              <section>
                <h3 className="text-lg font-semibold mb-2">Stats</h3>
                <div className="space-y-2 text-sm">
                  {!restrictedStats && (
                    <>
                      <div className="flex justify-between"><span>Views:</span><span className="font-medium">{listing.views}</span></div>
                      <div className="flex justify-between"><span>Favorites:</span><span className="font-medium">{listing.favorites}</span></div>
                    </>
                  )}
                  {listing.established && (
                    <div className="flex justify-between"><span>Lab Established:</span><span className="font-medium">{listing.established}</span></div>
                  )}
                  <div className="flex justify-between"><span>Listing Created:</span><span className="font-medium">{new Date(listing.createdAt).toLocaleDateString()}</span></div>
                  <div className="flex justify-between"><span>Listing Updated:</span><span className="font-medium">{new Date(listing.updatedAt).toLocaleDateString()}</span></div>
                </div>
              </section>
            </div>

            {/* Right column */}
            <div className="col-span-1 md:col-span-2">
              <section className="mb-6">
                <h3 className="text-lg font-semibold mb-2">Research Description</h3>
                <div className="whitespace-pre-wrap">{listing.description}</div>
              </section>
              {listing.applicantDescription && listing.applicantDescription.trim() !== '' && (
                <section className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">Applicant Prerequisites</h3>
                  <div className="whitespace-pre-wrap">{listing.applicantDescription}</div>
                </section>
              )}
              {listing.archived && (
                <div className="mt-6 p-3 bg-red-100 text-red-700 rounded-lg">
                  <div className="font-semibold">This listing is archived</div>
                  <div className="text-sm">Archived listings are not visible in search results or as favorites.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ListingDetailModal;
