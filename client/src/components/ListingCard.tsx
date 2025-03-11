import React, { useState, useRef, useEffect } from 'react';
import { Listing } from '../types/types';

interface ListingCardProps {
    listing: Listing;
}

const ListingCard = ({ listing }: ListingCardProps) => {
    const departments = listing.departments.split('; ');
    const [visibleDepartments, setVisibleDepartments] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        
        const calculateVisibleDepartments = () => {
            const container = containerRef.current;
            if (!container) return;
            
            const containerWidth = container.clientWidth;
            let totalWidth = 0;
            const tempVisible: string[] = [];
            
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

            // Measure the "+x more" bubble
            tempSpan.textContent = `+${departments.length - tempVisible.length} more`;
            const moreWidth = tempSpan.getBoundingClientRect().width + 8; // 8px for margin

            // Check if the "+x more" bubble fits
            if (totalWidth + moreWidth > containerWidth) {
                // Remove the last department to make space for the "+x more" bubble
                tempVisible.pop();
                setMoreCount(departments.length - tempVisible.length);
            }
            
            document.body.removeChild(tempSpan);
            setVisibleDepartments(tempVisible);
        };
        
        calculateVisibleDepartments();
        // Re-calculate on window resize
        window.addEventListener('resize', calculateVisibleDepartments);
        return () => window.removeEventListener('resize', calculateVisibleDepartments);
    }, [departments]);

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
                <p className="text-sm text-gray-700 mb-2" style={{ lineHeight: '1.2rem', height: '2.4rem', overflow: 'hidden', textOverflow: 'ellipsis' }}><strong>Professors: </strong>{listing.name}</p>
                {/* list all departments in blue bubbles*/}
                <div ref={containerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
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
            <div className="p-1 flex flex-col flex-shrink-0 items-end" style={{ width: '15%'}}>
                <p className="text-sm text-gray-700 mb-2">
                    1
                </p>
                <div className="flex-grow" />
                <p className="text-sm text-gray-700">
                    {new Date(listing.lastUpdated).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
}

export default ListingCard;
