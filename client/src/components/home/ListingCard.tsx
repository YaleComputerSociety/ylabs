import React, { useState, useEffect, useContext } from 'react';
import { Listing } from '../../types/types';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';
import axios from "../../utils/axios";
import ConfigContext from "../../contexts/ConfigContext";
import UserContext from "../../contexts/UserContext";

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
    const { user } = useContext(UserContext);

    const isAdmin = user?.userType === 'admin';
    const researchAreas = listing.researchAreas?.length > 0 ? listing.researchAreas : (listing.keywords || []);
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
                listing.views = listing.views - 1;
            })
            listing.views = listing.views + 1;
            setViewed(true);
        }
        openModal(listing);
    }

    if (!listing) {
        return null;
    }

    const primaryDept = listing.departments && listing.departments.length > 0
        ? getDepartmentAbbreviation(listing.departments[0])
        : null;

    const professorName = `${listing.ownerFirstName} ${listing.ownerLastName}`;
    const hasPrerequisites = listing.applicantDescription && listing.applicantDescription.trim() !== '';

    return (
        <div
            className="group relative bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden h-full flex flex-col"
            onClick={handleListingClick}
        >
            {/* Main Content */}
            <div className="p-4 flex-1 flex flex-col">
                {/* Top Row: Status Badge + Actions */}
                <div className="flex items-center justify-between mb-2">
                    <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            isOpen
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-600"
                        }`}
                    >
                        {isOpen ? "Open" : "Closed"}
                    </span>
                    <div className="flex items-center gap-1">
                        {/* Admin edit button */}
                        {isAdmin && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    window.open(`/analytics?listing=${listing.id}`, '_self');
                                }}
                                className="p-1 rounded-full text-gray-300 hover:text-blue-600 transition-colors"
                                aria-label="Admin edit"
                                title="Edit listing (Admin)"
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
                                >
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={toggleFavorite}
                            className={`p-1 rounded-full transition-colors ${
                                isFavorite
                                    ? 'text-blue-600'
                                    : 'text-gray-300 hover:text-blue-600'
                            }`}
                            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
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
                <h3 className="text-sm font-semibold text-gray-900 mb-1 line-clamp-2 leading-tight">
                    {listing.title}
                </h3>

                {/* Professor + Department */}
                <p className="text-xs text-gray-500 mb-2">
                    {professorName}
                    {primaryDept && <span className="text-gray-400"> · {primaryDept}</span>}
                </p>

                {/* Fixed-height slot for application details tag — keeps card heights consistent */}
                <div className="min-h-[16px] mb-1">
                    {hasPrerequisites && (
                        <span className="text-[10px] leading-none text-amber-600/80 bg-amber-50/60 px-1.5 py-0.5 rounded border border-amber-100 inline-flex items-center gap-0.5 w-fit">
                            <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                            </svg>
                            See Application Details
                        </span>
                    )}
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Research Areas - Show max 2 */}
                {researchAreas.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {researchAreas.slice(0, 2).map((area: string) => {
                            const colors = getColorForResearchArea(area);
                            return (
                                <span
                                    key={area}
                                    className={`${colors.bg} ${colors.text} text-xs px-1.5 py-0.5 rounded`}
                                >
                                    {area}
                                </span>
                            );
                        })}
                        {researchAreas.length > 2 && (
                            <span className="text-xs text-gray-400">
                                +{researchAreas.length - 2}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default ListingCard;
