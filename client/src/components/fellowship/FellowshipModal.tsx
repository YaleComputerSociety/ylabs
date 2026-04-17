/**
 * Detail modal for viewing full fellowship information.
 */
import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fellowship } from '../../types/types';
import FellowshipSearchContext from '../../contexts/FellowshipSearchContext';
import { ensureHttpPrefix, safeUrl } from '../../utils/url';
import FavoriteButton from '../shared/FavoriteButton';

interface FellowshipModalProps {
    fellowship: Fellowship;
    isOpen: boolean;
    onClose: () => void;
    isFavorite: boolean;
    toggleFavorite: () => void;
}

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
        const linkHref = safeUrl(match[2]);
        if (linkHref) {
            elements.push(
                <a
                    key={`l${match.index}`}
                    href={linkHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                >
                    {match[1]}
                </a>
            );
        } else {
            elements.push(
                <React.Fragment key={`l${match.index}`}>{match[1]}</React.Fragment>
            );
        }
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

    const handleFilterClick = (
        filterType: 'yearOfStudy' | 'termOfAward' | 'purpose' | 'globalRegions' | 'citizenshipStatus',
        value: string
    ) => {
        setQueryString('');
        setSelectedYearOfStudy([]);
        setSelectedTermOfAward([]);
        setSelectedPurpose([]);
        setSelectedRegions([]);
        setSelectedCitizenship([]);

        switch (filterType) {
            case 'yearOfStudy': setSelectedYearOfStudy([value]); break;
            case 'termOfAward': setSelectedTermOfAward([value]); break;
            case 'purpose': setSelectedPurpose([value]); break;
            case 'globalRegions': setSelectedRegions([value]); break;
            case 'citizenshipStatus': setSelectedCitizenship([value]); break;
        }

        onClose();
        navigate('/fellowships');
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Not specified';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
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
            className="fixed inset-0 bg-black/60 z-[1200] flex items-center justify-center overflow-y-auto p-4 pt-20"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex-shrink-0 border-b border-gray-100">
                    <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #0055A4 0%, #3b82f6 50%, #93c5fd 100%)' }} />
                    <div className="px-6 py-5">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    {fellowship.competitionType && (
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                                            {fellowship.competitionType}
                                        </span>
                                    )}
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        fellowship.isAcceptingApplications
                                            ? 'bg-green-50 text-green-700'
                                            : 'bg-red-50 text-red-600'
                                    }`}>
                                        {fellowship.isAcceptingApplications ? 'Accepting Applications' : 'Not Accepting'}
                                    </span>
                                </div>

                                <h2 className="text-xl font-bold text-gray-900 leading-tight">
                                    {fellowship.title}
                                </h2>
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                                {fellowship.applicationLink && (
                                    <a
                                        href={ensureHttpPrefix(fellowship.applicationLink)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-blue-600"
                                        title="Apply"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                                        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 hover:text-blue-600"
                                        title="Email contact"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="4" width="20" height="16" rx="2" />
                                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                        </svg>
                                    </a>
                                )}
                                <span className="px-1">
                                    <FavoriteButton isFavorite={isFavorite} onToggle={(e) => { e.stopPropagation(); toggleFavorite(); }} size={22} />
                                </span>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                                    aria-label="Close"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    <div className="p-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="col-span-1 space-y-6">
                                {fellowship.awardAmount && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Award Amount</h3>
                                        <div className="bg-emerald-50 rounded-lg p-3">
                                            <p className="text-sm font-semibold text-emerald-800">{fellowship.awardAmount}</p>
                                        </div>
                                    </section>
                                )}

                                <section>
                                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Key Dates</h3>
                                    <div className="bg-blue-50 rounded-lg p-3 space-y-3">
                                        <div>
                                            <span className="text-xs text-blue-600">Application Opens</span>
                                            <p className="text-sm font-medium text-blue-900">
                                                {formatDate(fellowship.applicationOpenDate)}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-xs text-blue-600">Deadline</span>
                                            <p className="text-sm font-medium text-blue-900">
                                                {formatDate(fellowship.deadline)}
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                {hasContactInfo && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact</h3>
                                        <div className="space-y-2">
                                            {fellowship.contactName && (
                                                <p className="text-sm text-gray-800 font-medium">{fellowship.contactName}</p>
                                            )}
                                            {fellowship.contactEmail && (
                                                <a href={`mailto:${fellowship.contactEmail}`} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                                                        <rect x="2" y="4" width="20" height="16" rx="2" />
                                                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                                    </svg>
                                                    <span className="truncate">{fellowship.contactEmail}</span>
                                                </a>
                                            )}
                                            {fellowship.contactPhone && (
                                                <p className="text-sm text-gray-600">{fellowship.contactPhone}</p>
                                            )}
                                            {fellowship.contactOffice && (
                                                <p className="text-sm text-gray-600">{fellowship.contactOffice}</p>
                                            )}
                                        </div>
                                    </section>
                                )}

                                {fellowship.links && fellowship.links.length > 0 && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Links</h3>
                                        <div className="space-y-1.5">
                                            {fellowship.links.map((link, i) => (
                                                <a
                                                    key={i}
                                                    href={ensureHttpPrefix(link.url)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                                                        <circle cx="12" cy="12" r="10" />
                                                        <line x1="2" y1="12" x2="22" y2="12" />
                                                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                                    </svg>
                                                    <span className="truncate">{link.label || link.url}</span>
                                                </a>
                                            ))}
                                        </div>
                                    </section>
                                )}

                                <section>
                                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Eligibility Filters</h3>
                                    <p className="text-xs text-gray-400 mb-3">Click to find similar fellowships</p>
                                    <div className="space-y-3">
                                        {fellowship.yearOfStudy.length > 0 && (
                                            <div>
                                                <span className="text-xs text-gray-500">Year of Study</span>
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {fellowship.yearOfStudy.map((year) => (
                                                        <button key={year} onClick={() => handleFilterClick('yearOfStudy', year)}
                                                            className="bg-blue-100 text-blue-800 text-xs rounded-md px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all">
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
                                                        <button key={term} onClick={() => handleFilterClick('termOfAward', term)}
                                                            className="bg-yellow-100 text-yellow-800 text-xs rounded-md px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all">
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
                                                        <button key={p} onClick={() => handleFilterClick('purpose', p)}
                                                            className="bg-purple-100 text-purple-800 text-xs rounded-md px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all">
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
                                                        <button key={region} onClick={() => handleFilterClick('globalRegions', region)}
                                                            className="bg-green-100 text-green-800 text-xs rounded-md px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all">
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
                                                        <button key={status} onClick={() => handleFilterClick('citizenshipStatus', status)}
                                                            className="bg-orange-100 text-orange-800 text-xs rounded-md px-2 py-1 hover:ring-2 hover:ring-offset-1 cursor-pointer transition-all">
                                                            {status}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>

                            <div className="col-span-1 md:col-span-2 space-y-6">
                                {fellowship.summary && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Brief Description</h3>
                                        <RichTextBlock text={fellowship.summary} className="text-sm text-gray-700 leading-relaxed" />
                                    </section>
                                )}

                                {fellowship.description && fellowship.description !== fellowship.summary && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Full Description</h3>
                                        <RichTextBlock text={fellowship.description} className="text-sm text-gray-700 leading-relaxed" />
                                    </section>
                                )}

                                {fellowship.applicationInformation && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Application Information</h3>
                                        <RichTextBlock text={fellowship.applicationInformation} className="text-sm text-gray-700 leading-relaxed bg-blue-50/50 border border-blue-100 rounded-lg p-4" />
                                    </section>
                                )}

                                {fellowship.eligibility && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Eligibility Requirements</h3>
                                        <RichTextBlock text={fellowship.eligibility} className="text-sm text-gray-700 leading-relaxed" />
                                    </section>
                                )}

                                {fellowship.restrictionsToUseOfAward && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Restrictions to Use of Award</h3>
                                        <RichTextBlock text={fellowship.restrictionsToUseOfAward} className="text-sm text-gray-700 leading-relaxed" />
                                    </section>
                                )}

                                {fellowship.additionalInformation && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Additional Information</h3>
                                        <RichTextBlock text={fellowship.additionalInformation} className="text-sm text-gray-700 leading-relaxed" />
                                    </section>
                                )}

                                {fellowship.applicationLink && (
                                    <div className="pt-4 border-t border-gray-100">
                                        <a
                                            href={ensureHttpPrefix(fellowship.applicationLink)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors text-sm"
                                        >
                                            Apply Now
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-2">
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
                </div>
            </div>
        </div>
    );
};

export default FellowshipModal;
