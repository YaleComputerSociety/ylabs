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

    const formatDeadline = (deadline: string | null) => {
        if (!deadline) return null;
        const date = new Date(deadline);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const getDaysUntilDeadline = (deadline: string | null) => {
        if (!deadline) return null;
        const deadlineDate = new Date(deadline);
        const now = new Date();
        return Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    const isDeadlineSoon = (deadline: string | null) => {
        const days = getDaysUntilDeadline(deadline);
        return days !== null && days > 0 && days <= 14;
    };

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
    const isOpen = fellowship.isAcceptingApplications && !deadlinePassed;

    return (
        <div
            className="group relative bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden h-full flex flex-col"
            onClick={handleFellowshipClick}
        >
            {/* Urgent Banner */}
            {deadlineSoon && !deadlinePassed && (
                <div className="bg-amber-50 border-b border-amber-200 px-3 py-1">
                    <p className="text-xs font-medium text-amber-700">
                        {daysUntil === 1 ? 'Due tomorrow' : `${daysUntil} days left`}
                    </p>
                </div>
            )}

            {/* Main Content */}
            <div className="p-4 flex-1 flex flex-col">
                {/* Top Row: Status Badge + Favorite */}
                <div className="flex items-center justify-between mb-2">
                    <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            isOpen
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-600"
                        }`}
                    >
                        {isOpen ? "Open" : "Closed"}
                    </span>
                    <button
                        onClick={toggleFavorite}
                        className={`p-1 rounded-full transition-colors ${
                            isFavorite
                                ? 'text-blue-600'
                                : 'text-gray-300 hover:text-blue-600'
                        }`}
                        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
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

                {/* Title */}
                <h3 className="text-sm font-semibold text-gray-900 mb-1 line-clamp-2 leading-tight">
                    {fellowship.title}
                </h3>

                {/* Deadline */}
                <p className={`text-xs mb-3 ${
                    deadlinePassed
                        ? 'text-red-500'
                        : deadlineSoon
                            ? 'text-amber-600 font-medium'
                            : 'text-gray-500'
                }`}>
                    {deadlinePassed ? 'Deadline passed' : deadlineText ? `Due ${deadlineText}` : 'No deadline'}
                </p>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Tags - Show max 2 */}
                <div className="flex flex-wrap gap-1">
                    {fellowship.yearOfStudy.slice(0, 1).map((year) => (
                        <span
                            key={year}
                            className="bg-blue-50 text-blue-700 text-xs px-1.5 py-0.5 rounded"
                        >
                            {year}
                        </span>
                    ))}
                    {fellowship.purpose.slice(0, 1).map((p) => (
                        <span
                            key={p}
                            className="bg-purple-50 text-purple-700 text-xs px-1.5 py-0.5 rounded"
                        >
                            {p}
                        </span>
                    ))}
                    {(fellowship.yearOfStudy.length + fellowship.purpose.length > 2) && (
                        <span className="text-xs text-gray-400">
                            +{fellowship.yearOfStudy.length + fellowship.purpose.length - 2}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FellowshipCard;
