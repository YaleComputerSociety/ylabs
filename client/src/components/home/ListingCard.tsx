import React, { useState, useRef, useEffect } from 'react';
import { Listing } from '../../types/types';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';
import axios from "../../utils/axios";
import { useContext } from "react";
import UserContext from "../../contexts/UserContext";
import ConfigContext from "../../contexts/ConfigContext";

interface ListingCardProps {
    listing: Listing;
    favListingsIds: string[];
    updateFavorite: (listingId: string, favorite: boolean) => void;
    openModal: (listing: Listing) => void;
}

const ListingCard = ({ listing, favListingsIds, updateFavorite, openModal }: ListingCardProps) => {
    const [visibleResearchAreas, setVisibleResearchAreas] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const [viewed, setViewed] = useState(false);
    const researchAreasContainerRef = useRef<HTMLDivElement>(null);
    const {user} = useContext(UserContext);
    const { getColorForResearchArea } = useContext(ConfigContext);

    // Get research areas (fallback to keywords for backwards compatibility)
    const researchAreas = listing.researchAreas?.length > 0 ? listing.researchAreas : (listing.keywords || []);

    // Helper function to check if lab is open (hiringStatus >= 0 means open)
    const isOpen = listing.hiringStatus >= 0;

    useEffect(() => {
        // Set listing as favorite based on if listing.id is in favListingsIds
        if(favListingsIds) {
            setIsFavorite(favListingsIds.includes(listing.id));
        }
    }, [favListingsIds]);

    useEffect(() => {
        if (!researchAreasContainerRef.current) return;

        const calculateVisibleResearchAreas = () => {
            const container = researchAreasContainerRef.current;
            if (!container) return;

            const containerWidth = container.clientWidth;
            let totalWidth = 0;
            const tempVisible: string[] = [];

            setMoreCount(0);

            // Create a temporary span to measure each research area's width
            const tempSpan = document.createElement('span');
            tempSpan.className = "bg-blue-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-2 mr-2";
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            document.body.appendChild(tempSpan);

            for (let i = 0; i < researchAreas.length; i++) {
                tempSpan.textContent = researchAreas[i];
                const width = tempSpan.getBoundingClientRect().width + 8; // 8px for margin

                if (totalWidth + width <= containerWidth) {
                    tempVisible.push(researchAreas[i]);
                    totalWidth += width;
                } else {
                    setMoreCount(researchAreas.length - i);
                    break;
                }
            }

            if(tempVisible.length !== researchAreas.length) {
                // Measure the "+x more" bubble
                tempSpan.textContent = `+${researchAreas.length - tempVisible.length} more`;
                const moreWidth = tempSpan.getBoundingClientRect().width + 8; // 8px for margin

                // Check if the "+x more" bubble fits
                if (totalWidth + moreWidth > containerWidth) {
                    // Remove the last item to make space for the "+x more" bubble
                    tempVisible.pop();
                    setMoreCount(researchAreas.length - tempVisible.length);
                }
            }

            document.body.removeChild(tempSpan);
            setVisibleResearchAreas(tempVisible);
        };

        calculateVisibleResearchAreas();
        // Re-calculate on window resize
        window.addEventListener('resize', calculateVisibleResearchAreas);
        return () => window.removeEventListener('resize', calculateVisibleResearchAreas);
    }, [listing, researchAreas]);

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
            axios.put(`listings/${listing.id}/addView`, {withCredentials: true}).catch((error) => {
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

    return (
        <div className="mb-4 relative">
            <div
                key={listing.id}
                className="flex relative z-10 rounded-md shadow"
            >
                <div
                    className="group/card p-4 flex-grow grid grid-cols-3 md:grid-cols-12 cursor-pointer border border-gray-300 hover:border-[#257fce] rounded-md transition-all duration-200"
                    style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fefefe 100%)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, #f8fafe 0%, #f4f6fb 100%)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, #ffffff 0%, #fefefe 100%)'}
                    onClick={handleListingClick}
                >
                    {/* First Column */}
                    <div className="col-span-2 md:col-span-4">
                        <span
                            className="text-sm font-semibold block"
                            style={{ color: '#0056A4', fontFamily: 'Geist, sans-serif', height: '1.25rem', lineHeight: '1.25rem' }}
                        >
                            {listing.departments && listing.departments.length > 0
                                ? listing.departments.slice(0, 3).map(dept => getDepartmentAbbreviation(dept)).join(' | ')
                                : '\u00A0'}
                        </span>
                        <p className={`text-lg font-semibold mb-3`} style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</p>
                        <p className={`text-sm text-gray-700`} style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                            Professors: {[`${listing.ownerFirstName} ${listing.ownerLastName}`, ...listing.professorNames].join(', ')}
                        </p>
                        {/* list all research areas with colored bubbles */}
                        <div ref={researchAreasContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                            {visibleResearchAreas.length > 0 ? (
                                <>
                                    {visibleResearchAreas.map((area: string) => {
                                        const colors = getColorForResearchArea(area);
                                        return (
                                            <span
                                                key={area}
                                                className={`${colors.bg} ${colors.text} text-xs rounded px-1 py-0.5 mt-3 mr-2`}
                                                style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                                            >
                                                {area}
                                            </span>
                                        );
                                    })}
                                    {moreCount > 0 && (
                                        <span
                                            className={`bg-gray-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-3`}
                                            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                                        >
                                            +{moreCount} more
                                        </span>
                                    )}
                                </>
                            ) : (
                                <div className="mt-3 flex">
                                    <span
                                        className={`invisible bg-gray-200 text-gray-900 text-xs rounded px-1 py-0.5 mr-2`}
                                        style={{ display: 'inline-block' }}
                                    >
                                        placeholder
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Second Column */}
                    <div className="col-span-6 hidden md:flex align-middle">
                        {/* Vertical Line */}
                        <div className={`flex-shrink-0 border-l border-gray-300 mx-4`} />
                        <div className="flex-grow overflow-hidden">
                            <p className={`text-gray-800 text-sm`} style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {listing.description}
                            </p>
                        </div>
                    </div>

                    {/* Third Column */}
                    <div className="flex flex-col col-span-1 md:col-span-2 items-end">
                        <div className="flex items-start">
                            {listing.applicantDescription && listing.applicantDescription.trim() !== '' && (
                                <div className="relative group mr-1">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#6B7280"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="mt-0.5"
                                    >
                                        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                                        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                                        <path d="M9 17h6" />
                                        <path d="M9 13h6" />
                                    </svg>
                                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800/75 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                                        Has Applicant Prerequisites
                                    </span>
                                </div>
                            )}
                            <span
                                className={`text-xs px-2 py-1 rounded ${
                                    isOpen
                                        ? "bg-green-500/20 text-green-700"
                                        : "bg-red-500/20 text-red-700"
                                }`}
                            >
                                {isOpen ? "Open" : "Not Open"}
                            </span>
                            <div className="flex flex-col items-end -ml-2">
                                <a onClick={toggleFavorite} className="inline-block relative group">
                                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800/65 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                                    </span>
                                    <button
                                        className="p-1 rounded-full"
                                        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            className="transition-colors"
                                            fill="none"
                                            stroke="#5B646F"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            style={{ stroke: '#5B646F' }}
                                            onMouseEnter={(e) => e.currentTarget.style.stroke = '#0055A4'}
                                            onMouseLeave={(e) => e.currentTarget.style.stroke = '#5B646F'}
                                        >
                                            {isFavorite ? (
                                                <path d="M5 12h14" />
                                            ) : (
                                                <>
                                                    <path d="M12 5v14" />
                                                    <path d="M5 12h14" />
                                                </>
                                            )}
                                        </svg>
                                    </button>
                                </a>
                                <div className="flex items-center opacity-0 group-hover/card:opacity-100 transition-opacity">
                                    <a
                                        href={listing.websites && listing.websites.length > 0 ? ensureHttpPrefix(listing.websites[0]) : undefined}
                                        className={listing.websites && listing.websites.length > 0 ? "" : "pointer-events-none invisible"}
                                        onClick={(e) => e.stopPropagation()}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <button className="p-1 rounded-full">
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
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
                                    <a
                                        href={`mailto:${listing.ownerEmail}`}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button className="p-1 rounded-full">
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
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
                                </div>
                            </div>
                        </div>
                        <div className="flex-grow" />
                        <p className={`text-[8px] mb-0.5 text-gray-700`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            Date Added
                        </p>
                        <p className={`text-sm text-gray-700`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {new Date(listing.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ListingCard;