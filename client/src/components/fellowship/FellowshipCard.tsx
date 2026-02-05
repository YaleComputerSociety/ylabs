import React, { useState, useEffect } from 'react';
import { Fellowship } from '../../types/types';
import axios from "../../utils/axios";

interface FellowshipCardProps {
    fellowship: Fellowship;
    favFellowshipIds: string[];
    updateFavorite: (fellowshipId: string, favorite: boolean) => void;
    openModal: (fellowship: Fellowship) => void;
}

const FellowshipCard = ({ fellowship, favFellowshipIds, updateFavorite, openModal }: FellowshipCardProps) => {
    const [isFavorite, setIsFavorite] = useState(favFellowshipIds.includes(fellowship.id));
    const [viewed, setViewed] = useState(false);

    // Sync local state with prop when favFellowshipIds changes
    useEffect(() => {
        setIsFavorite(favFellowshipIds.includes(fellowship.id));
    }, [favFellowshipIds, fellowship.id]);

    const toggleFavorite = (e: React.MouseEvent) => {
        e.stopPropagation();
        fellowship.favorites = isFavorite ? fellowship.favorites - 1 : fellowship.favorites + 1;
        if (fellowship.favorites < 0) {
            fellowship.favorites = 0;
        }
        updateFavorite(fellowship.id, !isFavorite);
        setIsFavorite(!isFavorite);
    };

    const handleFellowshipClick = () => {
        if (!viewed) {
            axios.put(`fellowships/${fellowship.id}/addView`, { withCredentials: true }).catch((error) => {
                console.log('Could not add view for fellowship');
                fellowship.views = fellowship.views - 1;
            });
            fellowship.views = fellowship.views + 1;
            setViewed(true);
        }
        openModal(fellowship);
    };

    const ensureHttpPrefix = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `https://${url}`;
    };

    // Format deadline
    const formatDeadline = (deadline: string | null) => {
        if (!deadline) return 'No deadline';
        const date = new Date(deadline);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Check if deadline is soon (within 30 days)
    const isDeadlineSoon = (deadline: string | null) => {
        if (!deadline) return false;
        const deadlineDate = new Date(deadline);
        const now = new Date();
        const daysUntil = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntil > 0 && daysUntil <= 30;
    };

    // Check if deadline has passed
    const isDeadlinePassed = (deadline: string | null) => {
        if (!deadline) return false;
        return new Date(deadline) < new Date();
    };

    if (!fellowship) {
        return null;
    }

    return (
        <div className="mb-4 relative">
            <div
                key={fellowship.id}
                className="flex relative z-10 rounded-md shadow"
            >
                <div
                    className="group/card p-4 flex-grow grid grid-cols-3 md:grid-cols-12 cursor-pointer border border-gray-300 hover:border-[#257fce] rounded-md transition-all duration-200"
                    style={{ background: 'linear-gradient(135deg, #ffffff 0%, #fefefe 100%)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, #f8fafe 0%, #f4f6fb 100%)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, #ffffff 0%, #fefefe 100%)'}
                    onClick={handleFellowshipClick}
                >
                    {/* First Column */}
                    <div className="col-span-2 md:col-span-4">
                        {/* Competition Type & Year of Study Tags */}
                        <div className="flex flex-wrap gap-1 mb-1 h-5 overflow-hidden">
                            {fellowship.competitionType && (
                                <span className="bg-indigo-100 text-indigo-800 text-xs rounded px-1 py-0.5">
                                    {fellowship.competitionType}
                                </span>
                            )}
                            {fellowship.yearOfStudy.slice(0, fellowship.competitionType ? 2 : 3).map((year) => (
                                <span
                                    key={year}
                                    className="bg-blue-100 text-blue-800 text-xs rounded px-1 py-0.5"
                                >
                                    {year}
                                </span>
                            ))}
                            {fellowship.yearOfStudy.length > (fellowship.competitionType ? 2 : 3) && (
                                <span className="bg-gray-100 text-gray-600 text-xs rounded px-1 py-0.5">
                                    +{fellowship.yearOfStudy.length - (fellowship.competitionType ? 2 : 3)}
                                </span>
                            )}
                        </div>
                        <p className="text-lg font-semibold mb-2" style={{ lineHeight: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {fellowship.title}
                        </p>
                        {/* Purpose Tags */}
                        <div className="flex flex-wrap gap-1 h-5 overflow-hidden">
                            {fellowship.purpose.slice(0, 2).map((p) => (
                                <span
                                    key={p}
                                    className="bg-purple-100 text-purple-800 text-xs rounded px-1 py-0.5"
                                >
                                    {p}
                                </span>
                            ))}
                            {fellowship.purpose.length > 2 && (
                                <span className="bg-gray-100 text-gray-600 text-xs rounded px-1 py-0.5">
                                    +{fellowship.purpose.length - 2}
                                </span>
                            )}
                        </div>
                        {/* Region Tags */}
                        <div className="flex flex-wrap gap-1 mt-2 h-5 overflow-hidden">
                            {fellowship.globalRegions.slice(0, 2).map((region) => (
                                <span
                                    key={region}
                                    className="bg-green-100 text-green-800 text-xs rounded px-1 py-0.5"
                                >
                                    {region}
                                </span>
                            ))}
                            {fellowship.globalRegions.length > 2 && (
                                <span className="bg-gray-100 text-gray-600 text-xs rounded px-1 py-0.5">
                                    +{fellowship.globalRegions.length - 2}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Second Column - Summary/Description */}
                    <div className="col-span-6 hidden md:flex align-middle">
                        <div className="flex-shrink-0 border-l border-gray-300 mx-4" />
                        <div className="flex-grow overflow-hidden">
                            <p className="text-gray-800 text-sm" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {fellowship.summary || fellowship.description}
                            </p>
                        </div>
                    </div>

                    {/* Third Column - Status & Actions */}
                    <div className="flex flex-col col-span-1 md:col-span-2 items-end">
                        <div className="flex items-start">
                            <span
                                className={`text-xs px-2 py-1 rounded ${
                                    fellowship.isAcceptingApplications
                                        ? "bg-green-500/20 text-green-700"
                                        : "bg-red-500/20 text-red-700"
                                }`}
                            >
                                {fellowship.isAcceptingApplications ? "Open" : "Closed"}
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
                                            fill={isFavorite ? "#0055A4" : "none"}
                                            stroke="#5B646F"
                                            strokeWidth="2"
                                            style={{ stroke: isFavorite ? '#0055A4' : '#5B646F' }}
                                            onMouseEnter={(e) => { e.currentTarget.style.stroke = '#0055A4'; if (!isFavorite) e.currentTarget.style.fill = 'none'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.stroke = isFavorite ? '#0055A4' : '#5B646F'; e.currentTarget.style.fill = isFavorite ? '#0055A4' : 'none'; }}
                                        >
                                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                        </svg>
                                    </button>
                                </a>
                                <div className="flex items-center opacity-0 group-hover/card:opacity-100 transition-opacity">
                                    {fellowship.applicationLink && (
                                        <a
                                            href={ensureHttpPrefix(fellowship.applicationLink)}
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
                                    )}
                                    {fellowship.contactEmail && (
                                        <a
                                            href={`mailto:${fellowship.contactEmail}`}
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
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex-grow" />
                        <p className="text-[8px] mb-0.5 text-gray-700">
                            Deadline
                        </p>
                        <p className={`text-sm ${
                            isDeadlinePassed(fellowship.deadline)
                                ? 'text-red-600'
                                : isDeadlineSoon(fellowship.deadline)
                                    ? 'text-orange-600 font-semibold'
                                    : 'text-gray-700'
                        }`}>
                            {formatDeadline(fellowship.deadline)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FellowshipCard;
