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
            axios.put(`fellowships/${fellowship.id}/addView`, { withCredentials: true }).catch(() => {
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
        if (!deadline) return null;
        const date = new Date(deadline);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Calculate days until deadline
    const getDaysUntilDeadline = (deadline: string | null) => {
        if (!deadline) return null;
        const deadlineDate = new Date(deadline);
        const now = new Date();
        return Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    // Check if deadline is soon (within 14 days)
    const isDeadlineSoon = (deadline: string | null) => {
        const days = getDaysUntilDeadline(deadline);
        return days !== null && days > 0 && days <= 14;
    };

    // Check if deadline has passed
    const isDeadlinePassed = (deadline: string | null) => {
        if (!deadline) return false;
        return new Date(deadline) < new Date();
    };

    if (!fellowship) {
        return null;
    }

    const daysUntil = getDaysUntilDeadline(fellowship.deadline);
    const deadlineText = formatDeadline(fellowship.deadline);
    const deadlinePassed = isDeadlinePassed(fellowship.deadline);
    const deadlineSoon = isDeadlineSoon(fellowship.deadline);

    return (
        <div className="mb-3">
            <div
                className="group relative bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
                onClick={handleFellowshipClick}
            >
                {/* Urgent Banner for Soon Deadlines */}
                {deadlineSoon && !deadlinePassed && (
                    <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5">
                        <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                            </svg>
                            {daysUntil === 1 ? 'Deadline tomorrow' : `${daysUntil} days left to apply`}
                        </p>
                    </div>
                )}

                {/* Main Content */}
                <div className="p-4">
                    {/* Top Row: Status Badge + Actions */}
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span
                                className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                                    fellowship.isAcceptingApplications && !deadlinePassed
                                        ? "bg-green-100 text-green-700"
                                        : "bg-gray-100 text-gray-600"
                                }`}
                            >
                                {fellowship.isAcceptingApplications && !deadlinePassed ? "Open" : "Closed"}
                            </span>
                            {fellowship.competitionType && (
                                <span className="text-xs text-gray-500">
                                    {fellowship.competitionType}
                                </span>
                            )}
                        </div>

                        {/* Action Buttons - Always visible */}
                        <div className="flex items-center gap-1">
                            {fellowship.applicationLink && (
                                <a
                                    href={ensureHttpPrefix(fellowship.applicationLink)}
                                    onClick={(e) => e.stopPropagation()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                    title="Apply now"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                </a>
                            )}
                            {fellowship.contactEmail && (
                                <a
                                    href={`mailto:${fellowship.contactEmail}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                    title="Contact"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <rect x="2" y="4" width="20" height="16" rx="2" />
                                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                    </svg>
                                </a>
                            )}
                            <button
                                onClick={toggleFavorite}
                                className={`p-1.5 rounded-full transition-colors ${
                                    isFavorite
                                        ? 'text-blue-600 bg-blue-50'
                                        : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                                }`}
                                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                                title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill={isFavorite ? "currentColor" : "none"}
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Title */}
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                        {fellowship.title}
                    </h3>

                    {/* Description - 2 lines max */}
                    <p className="text-sm text-gray-600 line-clamp-2 mb-3">
                        {fellowship.summary || fellowship.description}
                    </p>

                    {/* Tags Row - Simplified */}
                    <div className="flex flex-wrap gap-1.5">
                        {fellowship.yearOfStudy.slice(0, 2).map((year) => (
                            <span
                                key={year}
                                className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full"
                            >
                                {year}
                            </span>
                        ))}
                        {fellowship.purpose.slice(0, 1).map((p) => (
                            <span
                                key={p}
                                className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded-full"
                            >
                                {p}
                            </span>
                        ))}
                        {(fellowship.yearOfStudy.length + fellowship.purpose.length > 3) && (
                            <span className="text-xs text-gray-500 px-2 py-0.5">
                                +{fellowship.yearOfStudy.length + fellowship.purpose.length - 3} more
                            </span>
                        )}
                    </div>
                </div>

                {/* Bottom Bar - Deadline */}
                <div className={`px-4 py-2 border-t ${
                    deadlinePassed
                        ? 'bg-red-50 border-red-100'
                        : deadlineSoon
                            ? 'bg-amber-50 border-amber-100'
                            : 'bg-gray-50 border-gray-100'
                }`}>
                    <div className="flex items-center justify-between">
                        <p className={`text-xs font-medium ${
                            deadlinePassed
                                ? 'text-red-600'
                                : deadlineSoon
                                    ? 'text-amber-700'
                                    : 'text-gray-600'
                        }`}>
                            {deadlinePassed ? 'Deadline passed' : deadlineText ? `Deadline: ${deadlineText}` : 'No deadline'}
                        </p>
                        {fellowship.globalRegions.length > 0 && (
                            <p className="text-xs text-gray-500">
                                {fellowship.globalRegions[0]}
                                {fellowship.globalRegions.length > 1 && ` +${fellowship.globalRegions.length - 1}`}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FellowshipCard;
