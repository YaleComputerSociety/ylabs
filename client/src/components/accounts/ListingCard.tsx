import React, { useState, useRef, useEffect } from 'react';
import { Listing } from '../../types/types';
import ListingForm from './ListingForm';
import { getDepartmentAbbreviation } from '../../utils/departmentNames';
import { ensureHttpPrefix } from '../../utils/url';
import { createListing } from '../../utils/apiCleaner';
import axios from "../../utils/axios";
import swal from "sweetalert";
import { useContext } from "react";
import UserContext from "../../contexts/UserContext";
import ConfigContext from "../../contexts/ConfigContext";

interface ListingCardProps {
    listing: Listing;
    favListingsIds: string[];
    updateFavorite: (listing: Listing, listingId: string, favorite: boolean) => void;
    updateListing: (listing: Listing) => void;
    postListing: (listing: Listing) => void;
    clearCreatedListing: () => void;
    deleteListing: (listing: Listing) => void;
    openModal: (listing: Listing) => void;
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
  clearCreatedListing, 
  deleteListing, 
  openModal, 
  globalEditing, 
  setGlobalEditing, 
  editable, 
  reloadListings 
}: ListingCardProps) => {
    const [visibleResearchAreas, setVisibleResearchAreas] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));
    const [archived, setArchived] = useState(listing.archived);
    const researchAreasContainerRef = useRef<HTMLDivElement>(null);
    const isCreated = listing.id === "create";
    const [editing, setEditing] = useState(isCreated);
    const { user } = useContext(UserContext);
    const { getColorForResearchArea } = useContext(ConfigContext);
    const canDelete = user && (user.netId === listing.ownerId);

    // Store the original listing before editing begins.
    const originalListingRef = useRef<Listing | null>(null);

    // Get research areas (fallback to keywords for backwards compatibility)
    const researchAreas = listing.researchAreas?.length > 0 ? listing.researchAreas : (listing.keywords || []);

    // Helper function to check if lab is open (hiringStatus >= 0 means open)
    const isOpen = listing.hiringStatus >= 0;

    useEffect(() => {
        if (favListingsIds) {
            setIsFavorite(favListingsIds.includes(listing.id));
        }
    }, [favListingsIds]);

    useEffect(() => {
        setArchived(listing.archived);
    }, [listing]);

    useEffect(() => {
        if (!researchAreasContainerRef.current) return;
        const calculateVisibleResearchAreas = () => {
            const container = researchAreasContainerRef.current;
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

            for (let i = 0; i < researchAreas.length; i++) {
                tempSpan.textContent = researchAreas[i];
                const width = tempSpan.getBoundingClientRect().width + 8;
                if (totalWidth + width <= containerWidth) {
                    tempVisible.push(researchAreas[i]);
                    totalWidth += width;
                } else {
                    setMoreCount(researchAreas.length - i);
                    break;
                }
            }

            if (tempVisible.length !== researchAreas.length) {
                tempSpan.textContent = `+${researchAreas.length - tempVisible.length} more`;
                const moreWidth = tempSpan.getBoundingClientRect().width + 8;
                if (totalWidth + moreWidth > containerWidth) {
                    tempVisible.pop();
                    setMoreCount(researchAreas.length - tempVisible.length);
                }
            }

            document.body.removeChild(tempSpan);
            setVisibleResearchAreas(tempVisible);
        };

        calculateVisibleResearchAreas();
        window.addEventListener('resize', calculateVisibleResearchAreas);
        return () => window.removeEventListener('resize', calculateVisibleResearchAreas);
    }, [listing, researchAreas]);

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
            axios.put(`/listings/${listing.id}/unarchive`, { withCredentials: true })
                .then((response) => {
                    const responseListing = response.data.listing;
                    const listing = createListing(responseListing);
                    updateListing(listing);
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
            axios.put(`/listings/${listing.id}/archive`, { withCredentials: true })
                .then((response) => {
                    const responseListing = response.data.listing;
                    const listing = createListing(responseListing);
                    updateListing(listing);
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

    if (!listing) {
        return null;
    }

    return (
        <div className="mb-4 relative">
            <div key={listing.id} className="flex relative z-10 rounded-md shadow">
                <div className="group/card p-4 flex-grow grid grid-cols-3 md:grid-cols-12 cursor-pointer bg-white hover:bg-gray-50 border border-gray-300 hover:border-[#257fce] rounded-md transition-colors" onClick={handleListingClick}>
                    {/* First Column */}
                    <div className="col-span-2 md:col-span-4">
                        <span
                            className={`text-sm font-semibold block ${archived ? "opacity-50" : ""}`}
                            style={{ color: '#0056A4', fontFamily: 'Geist, sans-serif', height: '1.25rem', lineHeight: '1.25rem' }}
                        >
                            {listing.departments && listing.departments.length > 0
                                ? listing.departments.slice(0, 3).map(dept => getDepartmentAbbreviation(dept)).join(' | ')
                                : '\u00A0'}
                        </span>
                        <p className={`text-lg font-semibold mb-3 ${archived ? "opacity-50" : ""}`}
                           style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {listing.title}
                        </p>
                        <p className={`text-sm text-gray-700 ${archived ? "opacity-50" : ""}`}
                           style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                            Professors: {[`${listing.ownerFirstName} ${listing.ownerLastName}`, ...listing.professorNames].join(', ')}
                        </p>
                        <div ref={researchAreasContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                            {visibleResearchAreas.length > 0 ? (
                                <>
                                    {visibleResearchAreas.map((area: string) => {
                                        const colors = getColorForResearchArea(area);
                                        return (
                                            <span
                                                key={area}
                                                className={`${colors.bg} ${colors.text} text-xs rounded px-1 py-0.5 mt-3 mr-2 ${archived ? "opacity-50" : ""}`}
                                                style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                                            >
                                                {area}
                                            </span>
                                        );
                                    })}
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
                        <p className={`flex-grow text-gray-800 text-sm ${archived ? "opacity-50" : ""}`}
                           style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {listing.description}
                        </p>
                    </div>
                    {/* Third Column */}
                    <div className="flex flex-col col-span-1 md:col-span-2 items-end">
                        <div className="flex items-start">
                            {listing.applicantDescription && listing.applicantDescription.trim() !== '' && (
                                <div className={`relative group mr-1 ${archived ? "opacity-50" : ""}`}>
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
                                className={`text-xs px-2 py-1 rounded ${archived ? "opacity-50" : ""} ${
                                    isOpen
                                        ? "bg-green-500/20 text-green-700"
                                        : "bg-red-500/20 text-red-700"
                                }`}
                            >
                                {isOpen ? "Open" : "Not Open"}
                            </span>
                            <div className="flex flex-col items-end -ml-2">
                                {!isCreated && (
                                    <a onClick={toggleFavorite} className="inline-block relative group">
                                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800/65 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                            {isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                                        </span>
                                        <button className="p-1 rounded-full"
                                                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}>
                                            <svg xmlns="http://www.w3.org/2000/svg"
                                                 width="20"
                                                 height="20"
                                                 viewBox="0 0 24 24"
                                                 className={`transition-colors ${archived ? "opacity-50" : ""}`}
                                                 fill={isFavorite ? "#0055A4" : "none"}
                                                 stroke="#5B646F"
                                                 strokeWidth="2"
                                                 style={{ stroke: isFavorite ? '#0055A4' : '#5B646F' }}
                                                 onMouseEnter={(e) => { e.currentTarget.style.stroke = '#0055A4'; if (!isFavorite) e.currentTarget.style.fill = 'none'; }}
                                                 onMouseLeave={(e) => { e.currentTarget.style.stroke = isFavorite ? '#0055A4' : '#5B646F'; e.currentTarget.style.fill = isFavorite ? '#0055A4' : 'none'; }}>
                                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                            </svg>
                                        </button>
                                    </a>
                                )}
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
                                                className={`transition-colors ${archived ? "opacity-50" : ""}`}
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
                                                className={`transition-colors ${archived ? "opacity-50" : ""}`}
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
                        <p className={`text-sm text-gray-700 ${archived ? "opacity-50" : ""}`}
                           style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {new Date(listing.createdAt).toLocaleDateString()}
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
                        onCreate={(listing) => {
                            postListing(listing);
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
