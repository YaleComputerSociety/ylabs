import React, { useState, useEffect, useContext } from 'react';
import { Listing } from '../../types/types';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';
import axios from "../../utils/axios";
import ConfigContext from "../../contexts/ConfigContext";

interface ListingCardProps {
    listing: Listing;
    favListingsIds: string[];
    updateFavorite: (listingId: string, favorite: boolean) => void;
    openModal: (listing: Listing) => void;
}

const ListingCard = ({ listing, favListingsIds, updateFavorite, openModal }: ListingCardProps) => {
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const [viewed, setViewed] = useState(false);
    const { getColorForResearchArea } = useContext(ConfigContext);

    // Get research areas (fallback to keywords for backwards compatibility)
    const researchAreas = listing.researchAreas?.length > 0 ? listing.researchAreas : (listing.keywords || []);

    // Helper function to check if lab is open (hiringStatus >= 0 means open)
    const isOpen = listing.hiringStatus >= 0;

    useEffect(() => {
        if (favListingsIds) {
            setIsFavorite(favListingsIds.includes(listing.id));
        }
    }, [favListingsIds]);

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        listing.favorites = isFavorite ? listing.favorites - 1 : listing.favorites + 1;
        if (listing.favorites < 0) {
            listing.favorites = 0;
        }
        updateFavorite(listing.id, !isFavorite);
    }

    const handleListingClick = () => {
        if (!viewed) {
            axios.put(`listings/${listing.id}/addView`, { withCredentials: true }).catch(() => {
                console.log('Could not add view for listing');
                listing.views = listing.views - 1;
            })
            listing.views = listing.views + 1;
            setViewed(true);
        }
        openModal(listing);
    }

    const ensureHttpPrefix = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `https://${url}`;
    };

    if (!listing) {
        return null;
    }

    // Get primary department abbreviation
    const primaryDept = listing.departments && listing.departments.length > 0
        ? getDepartmentAbbreviation(listing.departments[0])
        : null;

    // Get professor display name
    const professorName = `${listing.ownerFirstName} ${listing.ownerLastName}`;

    return (
        <div className="mb-3">
            <div
                className="group relative bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
                onClick={handleListingClick}
            >
                {/* Main Content */}
                <div className="p-4">
                    {/* Top Row: Status Badge + Actions */}
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span
                                className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                                    isOpen
                                        ? "bg-green-100 text-green-700"
                                        : "bg-gray-100 text-gray-600"
                                }`}
                            >
                                {isOpen ? "Accepting Applications" : "Not Hiring"}
                            </span>
                            {listing.applicantDescription && listing.applicantDescription.trim() !== '' && (
                                <span className="text-xs text-gray-500 flex items-center gap-1">
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
                                    >
                                        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                                        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                                    </svg>
                                    Prerequisites
                                </span>
                            )}
                        </div>

                        {/* Action Buttons - Always visible */}
                        <div className="flex items-center gap-1">
                            {listing.websites && listing.websites.length > 0 && (
                                <a
                                    href={ensureHttpPrefix(listing.websites[0])}
                                    onClick={(e) => e.stopPropagation()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                    title="Visit website"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
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
                            <a
                                href={`mailto:${listing.ownerEmail}`}
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                title="Send email"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
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
                            <button
                                onClick={toggleFavorite}
                                className={`p-1.5 rounded-full transition-colors ${
                                    isFavorite
                                        ? 'text-blue-600 bg-blue-50'
                                        : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                                }`}
                                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill={isFavorite ? "currentColor" : "none"}
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Title */}
                    <h3 className="text-lg font-semibold text-gray-900 mb-1 line-clamp-1">
                        {listing.title}
                    </h3>

                    {/* Professor + Department */}
                    <p className="text-sm text-gray-600 mb-3">
                        {professorName}
                        {primaryDept && (
                            <span className="text-gray-400"> · {primaryDept}</span>
                        )}
                    </p>

                    {/* Description - 2 lines max */}
                    <p className="text-sm text-gray-600 line-clamp-2 mb-3">
                        {listing.description}
                    </p>

                    {/* Research Areas - Show max 3 */}
                    {researchAreas.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {researchAreas.slice(0, 3).map((area: string) => {
                                const colors = getColorForResearchArea(area);
                                return (
                                    <span
                                        key={area}
                                        className={`${colors.bg} ${colors.text} text-xs px-2 py-0.5 rounded-full`}
                                    >
                                        {area}
                                    </span>
                                );
                            })}
                            {researchAreas.length > 3 && (
                                <span className="text-xs text-gray-500 px-2 py-0.5">
                                    +{researchAreas.length - 3} more
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Bottom Bar - Date Added */}
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                    <p className="text-xs text-gray-500">
                        Added {new Date(listing.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default ListingCard;
