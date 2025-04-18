import React, { useState, useRef, useEffect } from 'react';
import { NewListing } from '../../types/types';
import ListingForm from './ListingForm';
import { departmentCategories } from '../../utils/departmentNames';
import { createListing } from '../../utils/apiCleaner';
import axios from "../../utils/axios";
import swal from "sweetalert";
import { useContext } from "react";
import UserContext from "../../contexts/UserContext";

interface ListingCardProps {
    listing: NewListing;
    favListingsIds: string[];
    updateFavorite: (listing: NewListing, listingId: string, favorite: boolean) => void;
    updateListing: (newListing: NewListing) => void;
    postListing: (newListing: NewListing) => void;
    postNewListing: (newListing: NewListing) => void;
    clearCreatedListing: () => void;
    deleteListing: (listing: NewListing) => void;
    openModal: (listing: NewListing) => void;
    globalEditing: boolean;
    setGlobalEditing: (editing: boolean) => void;
    editable: boolean;
    reloadListings: () => void;
}

const ListingCard = ({ 
  listing, 
  favListingsIds, 
  updateFavorite, 
  updateListing, 
  postListing, 
  postNewListing, 
  clearCreatedListing, 
  deleteListing, 
  openModal, 
  globalEditing, 
  setGlobalEditing, 
  editable, 
  reloadListings 
}: ListingCardProps) => {
    const [visibleDepartments, setVisibleDepartments] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [showTooltip, setShowTooltip] = useState(false);
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const [archived, setArchived] = useState(listing.archived);
    const departmentsContainerRef = useRef<HTMLDivElement>(null);
    const isCreated = listing.id === "create";
    const [editing, setEditing] = useState(isCreated);
    const { user } = useContext(UserContext);
    const canDelete = user && (user.netId === listing.ownerId);

    // Store the original listing before editing begins.
    const originalListingRef = useRef<NewListing | null>(null);

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
        if (favListingsIds) {
            setIsFavorite(favListingsIds.includes(listing.id));
        }
    }, [favListingsIds]);

    useEffect(() => {
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
            
            const tempSpan = document.createElement('span');
            tempSpan.className = "bg-blue-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-2 mr-2";
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            document.body.appendChild(tempSpan);
            
            for (let i = 0; i < listing.departments.length; i++) {
                tempSpan.textContent = listing.departments[i];
                const width = tempSpan.getBoundingClientRect().width + 8;
                if (totalWidth + width <= containerWidth) {
                    tempVisible.push(listing.departments[i]);
                    totalWidth += width;
                } else {
                    setMoreCount(listing.departments.length - i);
                    break;
                }
            }

            if (tempVisible.length !== listing.departments.length) {
                tempSpan.textContent = `+${listing.departments.length - tempVisible.length} more`;
                const moreWidth = tempSpan.getBoundingClientRect().width + 8;
                if (totalWidth + moreWidth > containerWidth) {
                    tempVisible.pop();
                    setMoreCount(listing.departments.length - tempVisible.length);
                }
            }
            
            document.body.removeChild(tempSpan);
            setVisibleDepartments(tempVisible);
        };
        
        calculateVisibleDepartments();
        window.addEventListener('resize', calculateVisibleDepartments);
        return () => window.removeEventListener('resize', calculateVisibleDepartments);
    }, [listing]);

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        listing.favorites = isFavorite ? listing.favorites - 1 : listing.favorites + 1;
        if (listing.favorites < 0) {
            listing.favorites = 0;
        }
        updateFavorite(listing, listing.id, !isFavorite);
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        swal({
            title: "Delete Listing",
            text: "Are you sure you want to delete this listing? This action cannot be undone",
            icon: "warning",
            buttons: ["Cancel", "Delete"],
            dangerMode: true,
        }).then((willDelete) => {
            if (willDelete) {
                deleteListing(listing);
            }
        });
    };

    const handleArchive = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (archived) {
            setArchived(false);
            axios.put(`/newListings/${listing.id}/unarchive`, { withCredentials: true })
                .then((response) => {
                    const responseListing = response.data.listing;
                    const newListing = createListing(responseListing);
                    updateListing(newListing);
                })
                .catch((error) => {
                    setArchived(true);
                    console.error('Error unarchiving listing:', error);
                    if (error.response.data.incorrectPermissions) {
                        swal({ text: "You no longer have permission to unarchive this listing", icon: "warning" });
                        reloadListings();
                    } else {
                        swal({ text: "Unable to unarchive listing", icon: "warning" });
                        reloadListings();
                    }
                });
        } else {
            setArchived(true);
            axios.put(`/newListings/${listing.id}/archive`, { withCredentials: true })
                .then((response) => {
                    const responseListing = response.data.listing;
                    const newListing = createListing(responseListing);
                    updateListing(newListing);
                })
                .catch((error) => {
                    setArchived(false);
                    console.error('Error archiving listing:', error);
                    if (error.response.data.incorrectPermissions) {
                        swal({ text: "You no longer have permission to archive this listing", icon: "warning" });
                        reloadListings();
                    } else {
                        swal({ text: "Unable to archive listing", icon: "warning" });
                        reloadListings();
                    }
                });
        }
    };

    // When Edit is clicked, store the original listing before changes.
    const handleEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        originalListingRef.current = listing;
        setEditing(true);
        setGlobalEditing(true);
    };

    const handleListingClick = () => {
        openModal(listing);
    };

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
            <div key={listing.id} className="flex relative z-10 rounded-md shadow">
                <div
                    className={`${getHiringStatusColor()} cursor-pointer rounded-l flex-shrink-0 relative ${archived ? "opacity-50" : ""}`}
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
                <div className="p-4 flex-grow grid grid-cols-3 md:grid-cols-12 cursor-pointer bg-white hover:bg-gray-100 border border-gray-300 rounded-r" onClick={handleListingClick}>
                    {/* First Column */}
                    <div className="col-span-2 md:col-span-4">
                        <p className={`text-lg font-semibold mb-3 ${archived ? "opacity-50" : ""}`}
                           style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {listing.title}
                        </p>
                        <p className={`text-sm text-gray-700 ${archived ? "opacity-50" : ""}`}
                           style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                            Professors: {[`${listing.ownerFirstName} ${listing.ownerLastName}`, ...listing.professorNames].join(', ')}
                        </p>
                        <div ref={departmentsContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                            {visibleDepartments.length > 0 ? (
                                <>
                                    {visibleDepartments.map((department) => (
                                        <span
                                            key={department}
                                            className={`${Object.keys(departmentCategories).includes(department)
                                                ? departmentColors[departmentCategories[department as keyof typeof departmentCategories]]
                                                : "bg-gray-200"} text-gray-900 text-xs rounded px-1 py-0.5 mt-3 mr-2 ${archived ? "opacity-50" : ""}`}
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
                                </>
                            ) : (
                                <div className="mt-3 flex">
                                    <span
                                        className={`invisible bg-gray-200 text-gray-900 text-xs rounded px-1 py-0.5 mr-2 ${archived ? "opacity-50" : ""}`}
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
                        <div className={`flex-shrink-0 border-l border-gray-300 mx-4 ${archived ? "opacity-50" : ""}`} />
                        <p className={`flex-grow text-gray-800 text-sm overflow-hidden overflow-ellipsis ${archived ? "opacity-50" : ""}`}
                           style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                            {listing.description}
                        </p>
                    </div>
                    {/* Third Column */}
                    <div className="flex flex-col col-span-1 md:col-span-2 items-end">
                        <div>
                            {listing.websites && listing.websites.length > 0 && (
                                <a
                                    href={ensureHttpPrefix(listing.websites[0])}
                                    className='mr-1'
                                    onClick={(e) => e.stopPropagation()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <button className="p-1 rounded-full hover:bg-gray-200">
                                        <img
                                            src="/assets/icons/new-link.png"
                                            alt="Lab Website"
                                            className={`w-5 h-5 ${archived ? "opacity-50" : ""}`}
                                        />
                                    </button>
                                </a>
                            )}
                            {!isCreated && (
                                <a onClick={toggleFavorite} className="inline-block">
                                    <button className="p-1 hover:bg-gray-200 rounded-full"
                                            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}>
                                        <svg xmlns="http://www.w3.org/2000/svg"
                                             width="20"
                                             height="20"
                                             viewBox="0 0 24 24"
                                             className={`transition-colors ${archived ? "opacity-50" : ""}`}
                                             fill={isFavorite ? "#FFDA7B" : "none"}
                                             stroke={isFavorite ? "#F0C04A" : "currentColor"}
                                             strokeWidth="1.5"
                                             strokeLinecap="round"
                                             strokeLinejoin="round">
                                            <path d="M12 17.75l-6.172 3.245l1.179-6.873l-5-4.867l6.9-1l3.086-6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
                                        </svg>
                                    </button>
                                </a>
                            )}
                        </div>
                        <div className="flex-grow" />
                        <p className={`text-[8px] mb-0.5 text-gray-700`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            Last Update
                        </p>
                        <p className={`text-sm text-gray-700 ${archived ? "opacity-50" : ""}`}
                           style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {new Date(listing.updatedAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            </div>
            <div className={`transform transition-all duration-700 overflow-hidden ${editable && editing ? "translate-y-0 max-h-[4000px]" : "-translate-y-5 max-h-0"} pl-2 pr-0.5 -mt-1`}>
                {editable && editing && (
                    <ListingForm 
                        listing={listing}
                        isCreated={isCreated} 
                        onLoad={(updatedListing, success) => {
                            if (!success) {
                                setEditing(false);
                                swal({
                                    text: "Unable to fetch most recent listing",
                                    icon: "warning",
                                });
                                reloadListings();
                                return;
                            }
                            updateListing(updatedListing);
                        }}
                        onCancel={() => {
                            // On cancel, reset the preview to the original listing.
                            if (isCreated) {
                                setEditing(false);
                                clearCreatedListing();
                            } else {
                                if (originalListingRef.current) {
                                    updateListing({ ...originalListingRef.current });
                                }
                                setEditing(false);
                                setGlobalEditing(false);
                            }
                        }}
                        onSave={(updatedListing) => {
                            postListing(updatedListing);
                            setEditing(false);
                            setGlobalEditing(false);
                        }} 
                        onCreate={(newListing) => {
                            postNewListing(newListing);
                            setEditing(false);
                            setGlobalEditing(false);
                        }}
                    />
                )}
            </div>
            {editable && !editing && (
                <div className="flex justify-center">
                    <div className="bg-white border border-gray-300 border-t-0 rounded-b-lg shadow px-3 pb-1 pt-3 -mt-1 inline-flex space-x-2">
                        <button 
                            className="p-1 rounded-full hover:bg-gray-100 text-gray-600 hover:text-green-600 transition-colors"
                            onClick={handleArchive}
                            title={archived ? "Unarchive listing" : "Archive listing"}
                            aria-label={archived ? "Unarchive listing" : "Archive listing"}
                        >
                            {archived ? (
                                <svg xmlns="http://www.w3.org/2000/svg"
                                     width="18"
                                     height="18"
                                     viewBox="0 0 24 24"
                                     fill="none"
                                     stroke="currentColor"
                                     strokeWidth="2"
                                     strokeLinecap="round"
                                     strokeLinejoin="round"
                                     className="opacity-50">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/>
                                    <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87"/>
                                    <path d="M3 3l18 18"/>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg"
                                     width="18"
                                     height="18"
                                     viewBox="0 0 24 24"
                                     fill="none"
                                     stroke="currentColor"
                                     strokeWidth="2"
                                     strokeLinecap="round"
                                     strokeLinejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/>
                                    <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>
                                </svg>
                            )}
                        </button>
                        
                        <button 
                            className={`p-1 rounded-full ${globalEditing 
                                ? "text-gray-400 cursor-not-allowed" 
                                : "hover:bg-gray-100 text-gray-600 hover:text-blue-600 transition-colors"}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!globalEditing) {
                                    handleEdit(e);
                                }
                            }}
                            title={globalEditing ? "Must close current editor" : "Edit listing"}
                            aria-label={globalEditing ? "Editing disabled" : "Edit listing"}
                            disabled={globalEditing}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg"
                                 width="18"
                                 height="18"
                                 viewBox="0 0 24 24"
                                 fill="none"
                                 stroke="currentColor"
                                 strokeWidth="2"
                                 strokeLinecap="round"
                                 strokeLinejoin="round"
                                 className={`${archived || globalEditing ? "opacity-50" : ""}`}>
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/>
                                <path d="M13.5 6.5l4 4"/>
                            </svg>
                        </button>
                        
                        <button 
                            className={`p-1 rounded-full ${canDelete && !globalEditing
                                ? "hover:bg-gray-100 text-gray-600 hover:text-red-600 transition-colors"
                                : "text-gray-400 cursor-not-allowed"}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (canDelete && !globalEditing) {
                                    handleDelete(e);
                                }
                            }}
                            title={canDelete ? globalEditing ? "Must close current editor" : "Delete listing" : "Only owner can delete"}
                            aria-label={canDelete ? globalEditing ? "Must close current editor" : "Delete listing" : "Only owner can delete"}
                            disabled={!canDelete}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg"
                                 width="18"
                                 height="18"
                                 viewBox="0 0 24 24"
                                 fill="none"
                                 stroke="currentColor"
                                 strokeWidth="2"
                                 strokeLinecap="round"
                                 strokeLinejoin="round"
                                 className={`${archived || globalEditing ? "opacity-50" : ""}`}>
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M4 7l16 0"/>
                                <path d="M10 11l0 6"/>
                                <path d="M14 11l0 6"/>
                                <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/>
                                <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ListingCard;
