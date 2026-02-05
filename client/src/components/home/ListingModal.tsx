import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Listing } from '../../types/types';
import UserContext from '../../contexts/UserContext';
import ConfigContext from '../../contexts/ConfigContext';
import SearchContext from '../../contexts/SearchContext';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';

interface ListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  favListingsIds: string[];
  updateFavorite: (listingId: string, favorite: boolean) => void;
}

const ListingModal = ({ isOpen, onClose, listing, favListingsIds, updateFavorite }: ListingModalProps) => {
    const navigate = useNavigate();
    const [isCreated] = useState(listing.id === "create");
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const [restrictedStats, setRestrictedStats] = useState(true);
    const {user} = useContext(UserContext);
    const { getDepartmentByAbbr, getColorForResearchArea } = useContext(ConfigContext);
    const {
        setSelectedDepartments,
        setSelectedResearchAreas,
        setSelectedListingResearchAreas,
        setQueryString,
    } = useContext(SearchContext);

    // Get research areas (fallback to keywords for backwards compatibility)
    const researchAreas = listing.researchAreas?.length > 0 ? listing.researchAreas : (listing.keywords || []);

    // Handle clicking on a research area filter
    const handleResearchAreaClick = (area: string) => {
        setQueryString('');
        setSelectedDepartments([]);
        setSelectedResearchAreas([]);
        setSelectedListingResearchAreas([area]);
        onClose();
        navigate('/');
    };

    // Handle clicking on a department filter
    const handleDepartmentClick = (dept: string) => {
        setQueryString('');
        setSelectedDepartments([dept]);
        setSelectedResearchAreas([]);
        setSelectedListingResearchAreas([]);
        onClose();
        navigate('/');
    };

    // Helper function to check if lab is open (hiringStatus >= 0 means open)
    const isLabOpen = listing.hiringStatus >= 0;

    // Helper function to get text based on hiring status
    const getHiringStatusText = () => {
        return isLabOpen ? "Open" : "Not Open";
    };

    // Close modal when clicking outside
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
        onClose();
        }
    };

    useEffect(() => {
        // Set listing as favorite based on if listing.id is in favListingsIds
        if(favListingsIds) {
            setIsFavorite(favListingsIds.includes(listing.id));
        }
    }, [favListingsIds]);

    useEffect(() => {
        //Check if the user type allows them to view the views/favorites
        if (user && user.userConfirmed && (["admin", "professor", "faculty"].includes(user.userType))) {
            setRestrictedStats(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            // Disable scrolling on body
            document.body.style.overflow = 'hidden';
        }
        
        // Cleanup function to re-enable scrolling when modal closes
        return () => {
            document.body.style.overflow = 'auto';
        };
    }, [isOpen]);

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        listing.favorites = isFavorite ? listing.favorites - 1 : listing.favorites + 1;
        if (listing.favorites < 0) {
            listing.favorites = 0;
        }
        updateFavorite(listing.id, !isFavorite);
    }

    const ensureHttpPrefix = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return url;
        }
        return `https://${url}`;
    };

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
                {/* Link, Mail, and Favorite buttons */}
                {!isCreated && (
                    <>
                        {listing.websites && listing.websites.length > 0 && (
                            <a
                                href={ensureHttpPrefix(listing.websites[0])}
                                onClick={(e) => e.stopPropagation()}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <button className="p-1 rounded-full mr-1">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#000000"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="transition-colors"
                                        style={{ stroke: '#000000' }}
                                        onMouseEnter={(e) => e.currentTarget.style.stroke = '#0055A4'}
                                        onMouseLeave={(e) => e.currentTarget.style.stroke = '#000000'}
                                    >
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                </button>
                            </a>
                        )}
                        <a
                            href={`mailto:${listing.ownerEmail}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button className="p-1 rounded-full mr-1">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#000000"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="transition-colors"
                                    style={{ stroke: '#000000' }}
                                    onMouseEnter={(e) => e.currentTarget.style.stroke = '#0055A4'}
                                    onMouseLeave={(e) => e.currentTarget.style.stroke = '#000000'}
                                >
                                    <rect x="2" y="4" width="20" height="16" rx="2" />
                                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                </svg>
                            </button>
                        </a>
                        <a onClick={toggleFavorite} className="inline-block relative group mr-2">
                            <button
                                className="p-1 rounded-full"
                                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    className="transition-colors h-6 w-6"
                                    fill={isFavorite ? "#0055A4" : "none"}
                                    stroke="#5B646F"
                                    strokeWidth="2"
                                    style={{ stroke: isFavorite ? '#0055A4' : '#5B646F' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.stroke = '#0055A4'; if (!isFavorite) e.currentTarget.style.fill = 'none'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.stroke = isFavorite ? '#0055A4' : '#5B646F'; e.currentTarget.style.fill = isFavorite ? '#0055A4' : 'none'; }}
                                >
                                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                </svg>
                            </button>
                            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 px-2 py-1 bg-gray-800/65 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                            </span>
                        </a>
                    </>
                )}
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="p-1 rounded-full hover:bg-gray-100"
                    aria-label="Close"
                >
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
                        isLabOpen ? "bg-green-500/20 text-green-700" : "bg-red-500/20 text-red-700"
                    }`}>
                        {getHiringStatusText()}
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
                    {[`${listing.ownerFirstName} ${listing.ownerLastName}`, ...listing.professorNames].map((name, index) => (
                        <div key={index} className="flex items-center">
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
                    <p className="text-xs text-gray-500 mb-2">Click to search for similar listings</p>
                    <div className="flex flex-wrap gap-2">
                    {researchAreas.map((area: string) => {
                        const colors = getColorForResearchArea(area);
                        return (
                            <button
                                key={area}
                                onClick={() => handleResearchAreaClick(area)}
                                className={`${colors.bg} ${colors.text} text-xs rounded px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all`}
                            >
                                {area}
                            </button>
                        );
                    })}
                    </div>
                </section>
                )}

                {/* Departments */}
                {listing.departments && listing.departments.length > 0 && (
                <section className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">Departments</h3>
                    <div className="flex flex-wrap gap-2">
                    {listing.departments.map((dept: string) => {
                        const abbr = getDepartmentAbbreviation(dept);
                        const deptConfig = getDepartmentByAbbr(abbr);
                        const fullName = deptConfig?.displayName || dept;
                        return (
                            <button
                                key={dept}
                                onClick={() => handleDepartmentClick(fullName)}
                                className="bg-gray-100 text-gray-700 text-xs rounded px-2 py-1 hover:bg-gray-200 hover:ring-2 hover:ring-gray-300 cursor-pointer transition-all"
                            >
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
                        {[listing.ownerEmail, ...listing.emails].map((email, index) => (
                        <li key={index}>
                            <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
                            {email}
                            </a>
                        </li>
                        ))}
                    </ul>
                    </div>
                    
                    {listing.websites && listing.websites.length > 0 && (
                    <div>
                        <h4 className="text-md font-medium">Websites</h4>
                        <ul className="mt-1 space-y-1">
                        {listing.websites.map((website, index) => (
                            <li key={index} className="truncate">
                            <a 
                                href={ensureHttpPrefix(website)} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-blue-600 hover:underline"
                            >
                                {website}
                            </a>
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
                            <div className="flex justify-between">
                                <span>Views:</span>
                                <span className="font-medium">{listing.views}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Favorites:</span>
                                <span className="font-medium">{listing.favorites}</span>
                            </div>
                        </>
                    )}
                    {listing.established && (
                        <div className="flex justify-between">
                        <span>Lab Established:</span>
                        <span className="font-medium">{listing.established}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span>Listing Created:</span>
                        <span className="font-medium">{new Date(listing.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Listing Updated:</span>
                        <span className="font-medium">{new Date(listing.updatedAt).toLocaleDateString()}</span>
                    </div>
                    </div>
                </section>
                </div>

                {/* Right column - Description and Keywords */}
                <div className="col-span-1 md:col-span-2">
                {/* Research Description */}
                <section className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">Research Description</h3>
                    <div className="whitespace-pre-wrap">
                    {listing.description}
                    </div>
                </section>

                {/* Applicant Description */}
                {listing.applicantDescription && listing.applicantDescription.trim() !== '' && (
                <section className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">Applicant Prerequisites</h3>
                    <div className="whitespace-pre-wrap">
                    {listing.applicantDescription}
                    </div>
                </section>
                )}
                
                {/* Archive status */}
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

export default ListingModal;