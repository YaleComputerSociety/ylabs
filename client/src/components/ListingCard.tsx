import React, { useState, useRef, useEffect } from 'react';
import { Listing } from '../types/types';
import axios from '../utils/axios';

interface ListingCardProps {
    listing: Listing;
    favListingsIds: number[];
    reloadListings: () => void;
}

const ListingCard = ({ listing, favListingsIds, reloadListings }: ListingCardProps) => {
    const departments = listing.departments.split('; ');
    const [visibleDepartments, setVisibleDepartments] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [isFavorite, setIsFavorite] = useState(false);
    const departmentsContainerRef = useRef<HTMLDivElement>(null);
    const professorsRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        // Set listing as favorite based on if listing.id is in favListingsIds
        if(favListingsIds) {
            console.log(String(listing.id), favListingsIds.map(elem => String(elem)));
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

    useEffect(() => {
        if (!professorsRef.current) return;

        const checkIfOneLine = () => {
            const element = professorsRef.current;
            if (!element) return;

            element.style.height = '';
            element.style.paddingTop = '0';

            const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
            const height = element.scrollHeight;

            if (height <= lineHeight) {
                element.style.paddingTop = '0.6rem';
            }

            element.style.height = '2.4rem';
        };

        checkIfOneLine();
        // Re-check on window resize
        window.addEventListener('resize', checkIfOneLine);
        return () => window.removeEventListener('resize', checkIfOneLine);
    }, [listing]);

    const toggleFavorite = () => {
        if(isFavorite) {
            axios.delete('/users/favListings', {withCredentials: true, data: {favListings: [listing.id]}}).then(() => {
                reloadListings();
            });
        } else {
            axios.put('/users/favListings', {withCredentials: true, data: {favListings: [listing.id]}}).then(() => {
                reloadListings();
            });
        }
    }

    if (!listing) {
        return null;
    }

    return (
        <div
            key={listing.id}
            className="p-3 mb-4 cursor-pointer hover:bg-gray-100 border border-gray-300 rounded flex"
        >
            {/* First Column */}
            <div className="p-1 mr-6 flex-shrink-0" style={{ width: '30%'}}>
                <p className="text-lg font-semibold mb-2" style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.name}</p>
                <p ref={professorsRef} className="text-sm text-gray-700 mb-2" style={{ lineHeight: '1.2rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    <strong>Professors:</strong> {listing.name}
                </p>
                {/* list all departments in blue bubbles*/}
                <div ref={departmentsContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                    {visibleDepartments.map((department) => (
                        <span
                            key={department}
                            className="bg-blue-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-2 mr-2"
                            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                        >
                            {department}
                        </span>
                    ))}
                    {moreCount > 0 && (
                        <span
                            className="bg-gray-200 text-gray-900 text-xs rounded px-1 py-0.5 mt-2"
                            style={{ display: 'inline-block', whiteSpace: 'nowrap' }}
                        >
                            +{moreCount} more
                        </span>
                    )}
                </div>
            </div>

            {/* Vertical Line */}
            <div className="border-l border-gray-300 mx-4" />

            {/* Second Column */}
            <div className="flex-grow p-1">
                <p className="text-gray-800 text-sm overflow-hidden overflow-ellipsis" style={{ display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' }}>
                    {listing.description}
                </p>
            </div>

            {/* Third Column justify right with set width and a number in top right and date in bottom right */}
            <div className="p-1 flex flex-col flex-shrink-0 items-end" style={{ width: '9rem'}}>
                <div>
                    {listing.website && (
                        <a
                            href={listing.website}
                            className = 'mr-1'
                            onClick={(e) => e.stopPropagation()}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <button className="p-1 rounded hover:bg-gray-200">
                                <img
                                    src="/assets/icons/link-icon.png"
                                    alt="Lab Website"
                                    className="w-5 h-5"
                                />
                            </button>
                        </a>
                    )}
                    <a onClick={toggleFavorite}>
                        <button className="p-1 rounded hover:bg-gray-200">
                            <img
                                src={isFavorite ? "/assets/icons/star-full.png" : "/assets/icons/star-empty.png"}
                                alt="Lab Website"
                                className="w-5 h-5"
                            />
                        </button>
                    </a>
                </div>
                <div className="flex-grow" />
                <p className="text-sm text-gray-700" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                    {new Date(listing.lastUpdated).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
}

export default ListingCard;
