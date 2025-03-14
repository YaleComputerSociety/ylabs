import React, { useState, useRef, useEffect } from 'react';
import { NewListing } from '../../types/types';
import { departmentCategories } from '../../utils/departmentNames';
import { createListing } from '../../utils/apiCleaner';
import axios from "../../utils/axios";
import swal from "sweetalert";

interface ListingCardProps {
    listing: NewListing;
    favListingsIds: number[];
    updateFavorite: (listing: NewListing, listingId: number, favorite: boolean) => void;
    updateListing: (newListing: NewListing) => void;
    openModal: (listing: NewListing) => void;
    editable: boolean;
}

const ListingCard = ({ listing, favListingsIds, updateFavorite, updateListing, openModal, editable }: ListingCardProps) => {
    const [visibleDepartments, setVisibleDepartments] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [showTooltip, setShowTooltip] = useState(false);
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const [archived, setArchived] = useState(listing.archived);
    const departments = listing.departments;
    const departmentsContainerRef = useRef<HTMLDivElement>(null);

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
        // Set listing as archived based on listing.archived
        setArchived(listing.archived);
    }, [listing]);

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
            
            for (let i = 0; i < departments.length; i++) {
                tempSpan.textContent = departments[i];
                const width = tempSpan.getBoundingClientRect().width + 8; // 8px for margin
                
                if (totalWidth + width <= containerWidth) {
                    tempVisible.push(departments[i]);
                    totalWidth += width;
                } else {
                    setMoreCount(departments.length - i);
                    break;
                }
            }

            if(tempVisible.length !== departments.length) {
                // Measure the "+x more" bubble
                tempSpan.textContent = `+${departments.length - tempVisible.length} more`;
                const moreWidth = tempSpan.getBoundingClientRect().width + 8; // 8px for margin

                // Check if the "+x more" bubble fits
                if (totalWidth + moreWidth > containerWidth) {
                    // Remove the last department to make space for the "+x more" bubble
                    tempVisible.pop();
                    setMoreCount(departments.length - tempVisible.length);
                }
                }
            
            document.body.removeChild(tempSpan);
            setVisibleDepartments(tempVisible);
        };
        
        calculateVisibleDepartments();
        // Re-calculate on window resize
        window.addEventListener('resize', calculateVisibleDepartments);
        return () => window.removeEventListener('resize', calculateVisibleDepartments);
    }, []);

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        updateFavorite(listing, listing.id, !isFavorite);
    }

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        
        swal({
            title: "Delete Listing",
            text: "Are you sure you want to delete this listing? This action cannot be undone",
            icon: "warning",
            buttons: ["Cancel", "Delete"],
            dangerMode: true,
        })
        .then((willDelete) => {
            if (willDelete) {
                console.log("deleted");
                //Api call here later
            }
        });
    }

    const handleArchive = (e: React.MouseEvent) => {
        e.stopPropagation();
        
        if(archived) {
            setArchived(false);
            axios.put(`/newListings/${listing.id}/unarchive`, {withCredentials: true}).then((response) => {
                const responseListing = response.data.listing;
                const newListing = createListing(responseListing);
                updateListing(newListing);
            }).catch((error) => {
                setArchived(true);
                console.error('Error archiving listing:', error);
                swal({
                    text: "Unable to archive listing",
                    icon: "warning",
                })
            })
        } else {
            setArchived(true);
            axios.put(`/newListings/${listing.id}/archive`, {withCredentials: true}).then((response) => {
                const responseListing = response.data.listing;
                const newListing = createListing(responseListing)
                updateListing(newListing);
            }).catch((error) => {
                setArchived(false);
                console.error('Error archiving listing:', error);
                swal({
                    text: "Unable to unarchive listing",
                    icon: "warning",
                })
            })
        }
    }

    const handleEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
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
                className="flex relative"
            >
                <div 
                    className={`${getHiringStatusColor()} cursor-pointer rounded-l flex-shrink-0 my-2 relative ${archived ? "opacity-50" : ""}`} 
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
                        <p className={`text-lg font-semibold mb-3 ${archived ? "opacity-50" : ""}`} style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</p>
                        <p className={`text-sm text-gray-700 ${archived ? "opacity-50" : ""}`} style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                            <strong>Professors:</strong> {listing.professorNames.join(', ')}
                        </p>
                        {/* list all departments in blue bubbles*/}
                        <div ref={departmentsContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                            {visibleDepartments.map((department) => (
                                <span
                                    key={department}
                                    className={`${Object.keys(departmentCategories).includes(department) ? departmentColors[departmentCategories[department as keyof typeof departmentCategories]] : "bg-gray-200"} text-gray-900 text-xs rounded px-1 py-0.5 mt-3 mr-2 ${archived ? "opacity-50" : ""}`}
                                    style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                                >
                                    {department}
                                </span>
                            ))}
                            {moreCount > 0 && (
                                <span
                                    className={`bg-gray-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-3 ${archived ? "opacity-50" : ""}`}
                                    style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                                >
                                    +{moreCount} more
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Second Column */}
                    <div className="col-span-6 hidden md:flex align-middle">
                        {/* Vertical Line */}
                        <div className={`flex-shrink-0 border-l border-gray-300 mx-4 ${archived ? "opacity-50" : ""}`} />
                        <p className={`flex-grow text-gray-800 text-sm overflow-hidden overflow-ellipsis ${archived ? "opacity-50" : ""}`} style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
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
                                            className={`w-5 h-5 ${archived ? "opacity-50" : ""}`}
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
                                        className={`transition-colors ${archived ? "opacity-50" : ""}`}
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
                        <p className={`text-sm text-gray-700 ${archived ? "opacity-50" : ""}`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {new Date(listing.updatedAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            </div>
            
            {/* Action buttons tab */}
            {editable && (
                <div className="flex justify-center">
                <div className="bg-white border border-gray-300 border-t-0 rounded-b-lg shadow px-3 pb-1 pt-2 -mt-1 inline-flex space-x-2">
                    <button 
                        className="p-1 rounded-full hover:bg-gray-100 text-gray-600 hover:text-green-600 transition-colors"
                        onClick={handleArchive}
                        title={archived ? "Unarchive listing" : "Archive listing"}
                        aria-label={archived ? "Unarchive listing" : "Archive listing"}
                    >
                        {archived ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className = "opacity-50">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                                <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                                <path d="M3 3l18 18" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                                <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
                            </svg>
                        )}
                    </button>
                    
                    <button 
                        className="p-1 rounded-full hover:bg-gray-100 text-gray-600 hover:text-blue-600 transition-colors"
                        onClick={handleEdit}
                        title="Edit listing"
                        aria-label="Edit listing"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${archived ? "opacity-50" : ""}`}>
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
                            <path d="M13.5 6.5l4 4" />
                        </svg>
                    </button>
                    
                    <button 
                        className="p-1 rounded-full hover:bg-gray-100 text-gray-600 hover:text-red-600 transition-colors"
                        onClick={handleDelete}
                        title="Delete listing"
                        aria-label="Delete listing"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${archived ? "opacity-50" : ""}`}>
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M4 7l16 0" />
                            <path d="M10 11l0 6" />
                            <path d="M14 11l0 6" />
                            <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                            <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                        </svg>
                    </button>
                </div>
            </div>
            )}
        </div>
    );
}

export default ListingCard;