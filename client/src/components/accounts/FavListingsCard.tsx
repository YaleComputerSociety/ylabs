import React, { useState, useRef, useEffect } from 'react';
import { NewListing } from '../../types/types';
import { departmentCategories } from '../../utils/departmentNames';

interface FavListingsCardProps {
    listing: NewListing;
    unfavoriteListing: (listingId: number) => void;
}

const FavListingsCard = ({ listing, unfavoriteListing }: FavListingsCardProps) => {
    const departments = listing.departments;
    const [visibleDepartments, setVisibleDepartments] = useState<string[]>([]);
    const [moreCount, setMoreCount] = useState(0);
    const [showTooltip, setShowTooltip] = useState(false);
    const departmentsContainerRef = useRef<HTMLDivElement>(null);
    const professorsRef = useRef<HTMLParagraphElement>(null);

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
            return "bg-red-500 hover:bg-red-600";
        } else if (listing.hiringStatus === 0) {
            return "bg-yellow-500 hover:bg-yellow-600";
        } else {
            return "bg-green-500 hover:bg-green-600";
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

    const handleUnfavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        unfavoriteListing(listing.id);
    }

    if (!listing) {
        return null;
    }

    return (
        <div
            key={listing.id}
            className="mb-4 flex relative"
        >
            <div 
                className={`${getHiringStatusColor()} cursor-pointer rounded-l flex-shrink-0 my-2 relative`} 
                style={{ width: '6px' }}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
            >
                {showTooltip && (
                    <div className="absolute top-1/2 left-4 -translate-y-1/2 bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded py-1 px-2 z-10 whitespace-nowrap">
                        {getHiringStatusText()}
                    </div>
                )}
            </div>
            <div className="flex flex-grow p-3 cursor-pointer hover:bg-gray-100 border border-gray-300 rounded">
                {/* First Column */}
                <div className="p-1 mr-6 flex-shrink-0" style={{ width: '30%'}}>
                    <p className="text-lg font-semibold mb-2" style={{ lineHeight: '1.2rem', height: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</p>
                    <p ref={professorsRef} className="text-sm text-gray-700 mb-2" style={{ lineHeight: '1.2rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        <strong>Professors:</strong> {listing.professorNames.join(', ')}
                    </p>
                    {/* list all departments in blue bubbles*/}
                    <div ref={departmentsContainerRef} className="flex overflow-hidden" style={{ whiteSpace: 'nowrap' }}>
                        {visibleDepartments.map((department) => (
                            <span
                                key={department}
                                className={`${Object.keys(departmentCategories).includes(department) ? departmentColors[departmentCategories[department as keyof typeof departmentCategories]] : "bg-gray-200"} text-gray-900 text-xs rounded px-1 py-0.5 mt-2 mr-2`}
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
                        {listing.websites && listing.websites.length > 0 && (
                            <a
                                href={listing.websites[0]}
                                className = 'mr-1'
                                onClick={(e) => e.stopPropagation()}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <button className="p-1 rounded hover:bg-gray-200">
                                    <img
                                        src="/assets/icons/link.svg"
                                        alt="Lab Website"
                                        className="w-5 h-5"
                                    />
                                </button>
                            </a>
                        )}
                        <a onClick={handleUnfavorite} className="inline-block">
                            <button 
                                className="p-1 hover:bg-gray-200 rounded"
                                aria-label="Remove from favorites"
                            >
                                <svg 
                                    xmlns="http://www.w3.org/2000/svg" 
                                    width="20" 
                                    height="20" 
                                    viewBox="0 0 24 24" 
                                    className="transition-colors"
                                    fill="#FFDA7B" 
                                    stroke="#F0C04A" 
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
                    <p className="text-sm text-gray-700" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                        {new Date(listing.updatedAt).toLocaleDateString()}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default FavListingsCard;
