import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fellowship } from '../../types/types';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';

interface FellowshipModalProps {
    fellowship: Fellowship;
    isOpen: boolean;
    onClose: () => void;
    isFavorite: boolean;
    toggleFavorite: () => void;
}

// Render text that may contain markdown-style links: [label](url)
const RichText = ({ text }: { text: string }) => {
    const linkRegex = /\[([^\]]+)\]\s*\(([^)]+)\)/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            elements.push(
                <React.Fragment key={`t${lastIndex}`}>
                    {text.slice(lastIndex, match.index)}
                </React.Fragment>
            );
        }
        elements.push(
            <a
                key={`l${match.index}`}
                href={match[2].trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
            >
                {match[1]}
            </a>
        );
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        elements.push(
            <React.Fragment key={`t${lastIndex}`}>
                {text.slice(lastIndex)}
            </React.Fragment>
        );
    }

    return <span>{elements}</span>;
};

// Render a text block with line breaks and inline links
const RichTextBlock = ({ text, className }: { text: string; className?: string }) => {
    const lines = text.split('\n');
    return (
        <div className={className}>
            {lines.map((line, i) => (
                <React.Fragment key={i}>
                    <RichText text={line} />
                    {i < lines.length - 1 && <br />}
                </React.Fragment>
            ))}
        </div>
    );
};

const FellowshipModal = ({ fellowship, isOpen, onClose, isFavorite, toggleFavorite }: FellowshipModalProps) => {
    const navigate = useNavigate();
    const {
        setSelectedYearOfStudy,
        setSelectedTermOfAward,
        setSelectedPurpose,
        setSelectedRegions,
        setSelectedCitizenship,
        setQueryString,
    } = useContext(FellowshipSearchContext);

    if (!isOpen || !fellowship) return null;

    // Clear all filters and set the clicked one, then navigate to fellowships
    const handleFilterClick = (
        filterType: 'yearOfStudy' | 'termOfAward' | 'purpose' | 'globalRegions' | 'citizenshipStatus',
        value: string
    ) => {
        // Clear all filters first
        setQueryString('');
        setSelectedYearOfStudy([]);
        setSelectedTermOfAward([]);
        setSelectedPurpose([]);
        setSelectedRegions([]);
        setSelectedCitizenship([]);

        // Set the clicked filter
        switch (filterType) {
            case 'yearOfStudy':
                setSelectedYearOfStudy([value]);
                break;
            case 'termOfAward':
                setSelectedTermOfAward([value]);
                break;
            case 'purpose':
                setSelectedPurpose([value]);
                break;
            case 'globalRegions':
                setSelectedRegions([value]);
                break;
            case 'citizenshipStatus':
                setSelectedCitizenship([value]);
                break;
        }

        onClose();
        navigate('/fellowships');
    };

    const ensureHttpPrefix = (url: string): string => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        return `https://${url}`;
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Not specified';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const hasContactInfo = fellowship.contactName || fellowship.contactEmail || fellowship.contactPhone || fellowship.contactOffice;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-white border-b p-4 flex items-start justify-between z-10">
                    <div className="flex-grow pr-4">
                        <h2 className="text-xl font-bold text-gray-900">{fellowship.title}</h2>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {fellowship.competitionType && (
                                <span className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-800">
                                    {fellowship.competitionType}
                                </span>
                            )}
                            <span
                                className={`text-xs px-2 py-1 rounded ${
                                    fellowship.isAcceptingApplications
                                        ? "bg-green-500/20 text-green-700"
                                        : "bg-red-500/20 text-red-700"
                                }`}
                            >
                                {fellowship.isAcceptingApplications ? "Currently Accepting Applications" : "Not Currently Accepting"}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleFavorite}
                            className="p-2 rounded-full hover:bg-gray-100"
                            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill={isFavorite ? "#0055A4" : "none"}
                                stroke="#0055A4"
                                strokeWidth="2"
                            >
                                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                            </svg>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-gray-100"
                            aria-label="Close modal"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    {/* Key Dates */}
                    <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                        <h3 className="text-sm font-semibold text-blue-900 mb-2">Key Dates</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <span className="text-xs text-blue-700">Application Opens</span>
                                <p className="text-sm font-medium text-blue-900">
                                    {formatDate(fellowship.applicationOpenDate)}
                                </p>
                            </div>
                            <div>
                                <span className="text-xs text-blue-700">Deadline</span>
                                <p className="text-sm font-medium text-blue-900">
                                    {formatDate(fellowship.deadline)}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Brief Description / Summary */}
                    {fellowship.summary && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Brief Description</h3>
                            <RichTextBlock text={fellowship.summary} className="text-gray-700" />
                        </div>
                    )}

                    {/* Full Description */}
                    {fellowship.description && fellowship.description !== fellowship.summary && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Full Description</h3>
                            <RichTextBlock text={fellowship.description} className="text-gray-700" />
                        </div>
                    )}

                    {/* Application Information */}
                    {fellowship.applicationInformation && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Application Information</h3>
                            <RichTextBlock text={fellowship.applicationInformation} className="text-gray-700" />
                        </div>
                    )}

                    {/* Special Eligibility Requirements */}
                    {fellowship.eligibility && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Special Eligibility Requirements</h3>
                            <RichTextBlock text={fellowship.eligibility} className="text-gray-700" />
                        </div>
                    )}

                    {/* Restrictions to Use of Award */}
                    {fellowship.restrictionsToUseOfAward && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Restrictions to Use of Award</h3>
                            <RichTextBlock text={fellowship.restrictionsToUseOfAward} className="text-gray-700" />
                        </div>
                    )}

                    {/* Additional Information */}
                    {fellowship.additionalInformation && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Additional Information</h3>
                            <RichTextBlock text={fellowship.additionalInformation} className="text-gray-700" />
                        </div>
                    )}

                    {/* Links */}
                    {fellowship.links && fellowship.links.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Links to Additional Information</h3>
                            <ul className="space-y-1">
                                {fellowship.links.map((link, i) => (
                                    <li key={i}>
                                        <a
                                            href={ensureHttpPrefix(link.url)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline text-sm"
                                        >
                                            {link.label || link.url}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Filters / Tags */}
                    <div className="mb-6">
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Eligibility Filters</h3>
                        <p className="text-xs text-gray-500 mb-3">Click a filter to search for similar fellowships</p>
                        <div className="space-y-3">
                            {fellowship.yearOfStudy.length > 0 && (
                                <div>
                                    <span className="text-xs text-gray-500">Year of Study</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {fellowship.yearOfStudy.map((year) => (
                                            <button
                                                key={year}
                                                onClick={() => handleFilterClick('yearOfStudy', year)}
                                                className="bg-blue-100 text-blue-800 text-xs rounded px-2 py-1 hover:bg-blue-200 hover:ring-2 hover:ring-blue-300 cursor-pointer transition-all"
                                            >
                                                {year}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {fellowship.termOfAward.length > 0 && (
                                <div>
                                    <span className="text-xs text-gray-500">Term of Award</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {fellowship.termOfAward.map((term) => (
                                            <button
                                                key={term}
                                                onClick={() => handleFilterClick('termOfAward', term)}
                                                className="bg-yellow-100 text-yellow-800 text-xs rounded px-2 py-1 hover:bg-yellow-200 hover:ring-2 hover:ring-yellow-300 cursor-pointer transition-all"
                                            >
                                                {term}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {fellowship.purpose.length > 0 && (
                                <div>
                                    <span className="text-xs text-gray-500">Purpose</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {fellowship.purpose.map((p) => (
                                            <button
                                                key={p}
                                                onClick={() => handleFilterClick('purpose', p)}
                                                className="bg-purple-100 text-purple-800 text-xs rounded px-2 py-1 hover:bg-purple-200 hover:ring-2 hover:ring-purple-300 cursor-pointer transition-all"
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {fellowship.globalRegions.length > 0 && (
                                <div>
                                    <span className="text-xs text-gray-500">Global Regions</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {fellowship.globalRegions.map((region) => (
                                            <button
                                                key={region}
                                                onClick={() => handleFilterClick('globalRegions', region)}
                                                className="bg-green-100 text-green-800 text-xs rounded px-2 py-1 hover:bg-green-200 hover:ring-2 hover:ring-green-300 cursor-pointer transition-all"
                                            >
                                                {region}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {fellowship.citizenshipStatus.length > 0 && (
                                <div>
                                    <span className="text-xs text-gray-500">Citizenship Status</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {fellowship.citizenshipStatus.map((status) => (
                                            <button
                                                key={status}
                                                onClick={() => handleFilterClick('citizenshipStatus', status)}
                                                className="bg-orange-100 text-orange-800 text-xs rounded px-2 py-1 hover:bg-orange-200 hover:ring-2 hover:ring-orange-300 cursor-pointer transition-all"
                                            >
                                                {status}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Contact Information */}
                    {hasContactInfo && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-2">Contact Information</h3>
                            <div className="space-y-1 text-sm text-gray-700">
                                {fellowship.contactName && <p>{fellowship.contactName}</p>}
                                {fellowship.contactEmail && (
                                    <p>
                                        <a
                                            href={`mailto:${fellowship.contactEmail}`}
                                            className="text-blue-600 hover:underline"
                                        >
                                            {fellowship.contactEmail}
                                        </a>
                                    </p>
                                )}
                                {fellowship.contactPhone && <p>{fellowship.contactPhone}</p>}
                                {fellowship.contactOffice && <p>{fellowship.contactOffice}</p>}
                            </div>
                        </div>
                    )}

                    {/* Apply Button */}
                    {fellowship.applicationLink && (
                        <div className="mt-6 pt-4 border-t">
                            <a
                                href={ensureHttpPrefix(fellowship.applicationLink)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                Apply Now
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className="ml-2"
                                >
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FellowshipModal;
