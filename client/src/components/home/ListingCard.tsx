import React, { useState, useRef, useEffect } from 'react';
import { NewListing } from '../../types/types';
import { departmentCategories } from '../../utils/departmentNames';
import axios from "../../utils/axios";
import swal from "sweetalert";
import { useContext } from "react";
import UserContext from "../../contexts/UserContext";

interface ListingCardProps {
    listing: NewListing;
    favListingsIds: string[];
    updateFavorite: (listing: NewListing, listingId: string, favorite: boolean) => void;
    openModal: (listing: NewListing) => void;
}

const ListingCard = ({ listing, favListingsIds, updateFavorite, openModal }: ListingCardProps) => {
    const [visibleDepartments, setVisibleDepartments] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [showTooltip, setShowTooltip] = useState(false);
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const departmentsContainerRef = useRef<HTMLDivElement>(null);
    const {user} = useContext(UserContext);

    const departmentColors = [
        "bg-blue-200",
        "bg-green-200",
        "bg-yellow-200",
        "bg-red-200",
        "bg-purple-200",
        "bg-pink-200",
        "bg-teal-200",
        "bg-orange-200"
    ];

    // Helper function to determine bar color based on hiringStatus
    const getHiringStatusColor = () => {
        if (listing.hiringStatus < 0) {
            return "bg-red-500";
        } else if (listing.hiringStatus === 0) {
            return "bg-yellow-500";
        } else {
            return "bg-green-500";
        }
    };
    
    // Helper function to get tooltip text based on hiring status
    const getHiringStatusText = () => {
        if (listing.hiringStatus < 0) {
            return "Lab not seeking applicants";
        } else if (listing.hiringStatus === 0) {
            return "Lab open to applicants";
        } else {
            return "Lab seeking applicants";
        }
    };

    useEffect(() => {
        // Set listing as favorite based on if listing.id is in favListingsIds
        if(favListingsIds) {
            setIsFavorite(favListingsIds.includes(listing.id));
        }
    }, [favListingsIds]);

    useEffect(() => {
        if (!departmentsContainerRef.current) return;
        
        const calculateVisibleDepartments = () => {
            const container = departmentsContainerRef.current;
            if (!container) return;
            
            const containerWidth = container.clientWidth;
            let totalWidth = 0;
            const tempVisible: string[] = [];

            setMoreCount(0);
            
            // Create a temporary span to measure each department's width
            const tempSpan = document.createElement('span');
            tempSpan.className = "bg-blue-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-2 mr-2";
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            document.body.appendChild(tempSpan);
            
            for (let i = 0; i < listing.departments.length; i++) {
                tempSpan.textContent = listing.departments[i];
                const width = tempSpan.getBoundingClientRect().width + 8; // 8px for margin
                
                if (totalWidth + width <= containerWidth) {
                    tempVisible.push(listing.departments[i]);
                    totalWidth += width;
                } else {
                    setMoreCount(listing.departments.length - i);
                    break;
                }
            }

            if(tempVisible.length !== listing.departments.length) {
                // Measure the "+x more" bubble
                tempSpan.textContent = `+${listing.departments.length - tempVisible.length} more`;
                const moreWidth = tempSpan.getBoundingClientRect().width + 8; // 8px for margin

                // Check if the "+x more" bubble fits
                if (totalWidth + moreWidth > containerWidth) {
                    // Remove the last department to make space for the "+x more" bubble
                    tempVisible.pop();
                    setMoreCount(listing.departments.length - tempVisible.length);
                }
                }
            
            document.body.removeChild(tempSpan);
            setVisibleDepartments(tempVisible);
        };
        
        calculateVisibleDepartments();
        // Re-calculate on window resize
        window.addEventListener('resize', calculateVisibleDepartments);
        return () => window.removeEventListener('resize', calculateVisibleDepartments);
    }, [listing]);

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        updateFavorite(listing, listing.id, !isFavorite);
    }

    const handleListingClick = () => {
        openModal(listing);
    }

    if (!listing) {
        return null;
    }

    return (
        <div className="mb-4 relative">
            <div
                key={listing.id}
                className="flex relative z-10"
            >
                <div 
                    className={`${getHiringStatusColor()} cursor-pointer rounded-l flex-shrink-0 my-2 relative`} 
                    style={{ width: '6px' }}
                    onMouseEnter={() => setShowTooltip(true)}
                    onMouseLeave={() => setShowTooltip(false)}
                >
                    {showTooltip && (
                        <div className={`${getHiringStatusColor()} absolute top-1/2 left-4 -translate-y-1/2 text-white text-xs rounded-full py-1 px-2 z-10 whitespace-nowrap shadow`}>
                            {getHiringStatusText()}
                        </div>
                    )}
                </div>
                <div className="p-4 flex-grow grid grid-cols-3 md:grid-cols-12 cursor-pointer bg-white hover:bg-gray-100 border border-gray-300 rounded shadow" onClick={handleListingClick}>
                    {/* First Column */}
                    <div className="col-span-2 md:col-span-4">
                        <p className={`text-lg font-semibold mb-3`} style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</p>
                        <p className={`text-sm text-gray-700`} style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                            <strong>Professors:</strong> {[`${listing.ownerFirstName} ${listing.ownerLastName}`, ...listing.professorNames].join(', ')}
                        </p>
                        {/* list all departments in blue bubbles*/}
                        <div ref={departmentsContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                            {visibleDepartments.length > 0 ? (
                                <>
                                    {visibleDepartments.map((department) => (
                                        <span
                                            key={department}
                                            className={`${Object.keys(departmentCategories).includes(department) ? departmentColors[departmentCategories[department as keyof typeof departmentCategories]] : "bg-gray-200"} text-gray-900 text-xs rounded px-1 py-0.5 mt-3 mr-2`}
                                            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                                        >
                                            {department}
                                        </span>
                                    ))}
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
                        <p className={`flex-grow text-gray-800 text-sm overflow-hidden overflow-ellipsis`} style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                            {listing.description}
                        </p>
                    </div>

                    {/* Third Column */}
                    <div className="flex flex-col col-span-1 md:col-span-2 items-end">
                        <div>
                            {listing.websites && listing.websites.length > 0 && (
                                <a
                                    href={listing.websites[0]}
                                    className = 'mr-1'
                                    onClick={(e) => e.stopPropagation()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <button className="p-1 rounded-full hover:bg-gray-200">
                                        <img
                                            src="/assets/icons/link.svg"
                                            alt="Lab Website"
                                            className={`w-5 h-5`}
                                        />
                                    </button>
                                </a>
                            )}
                            <a onClick={toggleFavorite} className="inline-block">
                                <button 
                                    className="p-1 hover:bg-gray-200 rounded-full"
                                    aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                                >
                                    <svg 
                                        xmlns="http://www.w3.org/2000/svg" 
                                        width="20" 
                                        height="20" 
                                        viewBox="0 0 24 24" 
                                        className={`transition-colors`}
                                        fill={isFavorite ? "#FFDA7B" : "none"} 
                                        stroke={isFavorite ? "#F0C04A" : "currentColor"} 
                                        strokeWidth="1.5" 
                                        strokeLinecap="round" 
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
                                    </svg>
                                </button>
                            </a>
                        </div>
                        <div className="flex-grow" />
                        <p className={`text-sm text-gray-700`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {new Date(listing.updatedAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ListingCard;