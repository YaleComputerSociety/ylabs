import React, { useEffect, useState } from 'react';
import { NewListing } from '../../types/types';
import { departmentCategories } from '../../utils/departmentNames';

interface ListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: NewListing;
  favListingsIds: string[];
  updateFavorite: (listing: NewListing, listingId: string, favorite: boolean) => void;
}

const ListingModal = ({ isOpen, onClose, listing, favListingsIds, updateFavorite }: ListingModalProps) => {
    const [isCreated, setIsCreating] = useState(listing.id === "create");
    const [isFavorite, setIsFavorite] = useState(favListingsIds.includes(listing.id));

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
    
    // Helper function to get text based on hiring status
    const getHiringStatusText = () => {
        if (listing.hiringStatus < 0) {
        return "Lab not seeking applicants";
        } else if (listing.hiringStatus === 0) {
        return "Lab open to applicants";
        } else {
        return "Lab seeking applicants";
        }
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

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        updateFavorite(listing, listing.id, !isFavorite);
    }

    if (!isOpen || !listing) return null;

    return (
        <div 
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center overflow-y-auto p-4 pt-20" 
        onClick={handleBackdropClick}
        >
        <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Top status bar */}
            <div className={`${getHiringStatusColor()} h-2 w-full rounded-t-lg`}></div>
            
            <div className="p-6 relative">

            {/* Utility buttons */}
            <div className="absolute top-4 right-4">
                {/* Favorite button */}
                {!isCreated && (
                    <a onClick={toggleFavorite} className="inline-block">
                        <button 
                            className="p-1 hover:bg-gray-100 rounded-full mr-2"
                            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                        >
                            <svg 
                                xmlns="http://www.w3.org/2000/svg" 
                                viewBox="0 0 24 24" 
                                className="transition-colors h-6 w-6"
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
            <div className="mb-6">
                <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold">{listing.title}</h2>
                <span className={`${getHiringStatusColor()} text-white text-xs px-2 py-1 rounded-full`}>
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

                {/* Departments */}
                <section className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">Departments</h3>
                    <div className="flex flex-wrap gap-2">
                    {listing.departments.map((department) => (
                        <span
                        key={department}
                        className={`${Object.keys(departmentCategories).includes(department) ? 
                            departmentColors[departmentCategories[department as keyof typeof departmentCategories]] : 
                            "bg-gray-200"} text-gray-900 text-xs rounded px-2 py-1`}
                        >
                        {department}
                        </span>
                    ))}
                    </div>
                </section>

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
                                href={website} 
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
                    <div className="flex justify-between">
                        <span>Views:</span>
                        <span className="font-medium">{listing.views}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Favorites:</span>
                        <span className="font-medium">{listing.favorites}</span>
                    </div>
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
                {/* Description */}
                <section className="mb-6">
                    <h3 className="text-lg font-semibold mb-2">About</h3>
                    <div className="whitespace-pre-wrap">
                    {listing.description}
                    </div>
                </section>
                
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