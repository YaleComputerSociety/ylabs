import { useState, useEffect, useContext, useRef, useCallback } from "react";
import FellowshipCard from "../components/fellowship/FellowshipCard";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import QuickFilters, { QuickFilterOption } from "../components/shared/QuickFilters";
import axios from "../utils/axios";
import { Fellowship } from "../types/types";

// Section Header Component
const SectionHeader = ({ title, count, icon, variant = 'default' }: {
    title: string;
    count: number;
    icon: React.ReactNode;
    variant?: 'default' | 'urgent' | 'muted';
}) => {
    const bgColors = {
        default: 'bg-gray-100',
        urgent: 'bg-amber-100 text-amber-700',
        muted: 'bg-gray-100 text-gray-500'
    };

    return (
        <div className="flex items-center gap-2 mb-3 mt-6 first:mt-0">
            <div className="flex items-center gap-2 text-gray-700">
                {icon}
                <h2 className="text-sm font-semibold">{title}</h2>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${bgColors[variant]}`}>
                {count}
            </span>
        </div>
    );
};

// Quick filter options for fellowships
const fellowshipQuickFilters: QuickFilterOption[] = [
    {
        label: 'Open Only',
        value: 'open',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
        ),
    },
    {
        label: 'Closing Soon',
        value: 'closing-soon',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
            </svg>
        ),
    },
    {
        label: 'Undergrad',
        value: 'undergrad',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
        ),
    },
];

const Fellowships = () => {
    const {
        fellowships,
        isLoading,
        searchExhausted,
        setPage,
        sortBy,
        setQueryString,
    } = useContext(FellowshipSearchContext);

    const [favFellowshipIds, setFavFellowshipIds] = useState<string[]>([]);
    const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [quickFilter, setQuickFilter] = useState<string | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Scroll to top and clear search query on page load
    useEffect(() => {
        window.scrollTo(0, 0);
        setQueryString('');
    }, []);

    // Load favorites
    const reloadFavorites = async () => {
        axios.get('/users/favFellowshipIds').then((response) => {
            setFavFellowshipIds(response.data.favFellowshipIds || []);
        }).catch((error) => {
            console.error("Error fetching user's favorite fellowships:", error);
            setFavFellowshipIds([]);
        });
    };

    useEffect(() => {
        reloadFavorites();
    }, []);

    // Infinite scroll
    const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
        const [target] = entries;
        if (target.isIntersecting && !isLoading && !searchExhausted) {
            setPage((prev) => prev + 1);
        }
    }, [isLoading, searchExhausted, setPage]);

    useEffect(() => {
        if (observerRef.current) observerRef.current.disconnect();
        observerRef.current = new IntersectionObserver(handleObserver, {
            root: null,
            rootMargin: '100px',
            threshold: 0.1,
        });
        if (loadMoreRef.current) {
            observerRef.current.observe(loadMoreRef.current);
        }
        return () => {
            if (observerRef.current) observerRef.current.disconnect();
        };
    }, [handleObserver]);

    const updateFavorite = (fellowshipId: string, favorite: boolean) => {
        const prevFavIds = favFellowshipIds;

        if (favorite) {
            setFavFellowshipIds([fellowshipId, ...prevFavIds]);
            axios.put('/users/favFellowships', { data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowshipIds(prevFavIds);
                console.error('Error favoriting fellowship:', error);
            });
        } else {
            setFavFellowshipIds(prevFavIds.filter((id) => id !== fellowshipId));
            axios.delete('/users/favFellowships', { data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowshipIds(prevFavIds);
                console.error('Error unfavoriting fellowship:', error);
            });
        }
    };

    const openModal = (fellowship: Fellowship) => {
        setSelectedFellowship(fellowship);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedFellowship(null);
    };

    // Helper functions for categorizing fellowships
    const getDaysUntilDeadline = (deadline: string | null) => {
        if (!deadline) return null;
        const deadlineDate = new Date(deadline);
        const now = new Date();
        return Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    const isDeadlinePassed = (deadline: string | null) => {
        if (!deadline) return false;
        return new Date(deadline) < new Date();
    };

    // Apply quick filters
    const getFilteredFellowships = () => {
        let filtered = fellowships;

        if (quickFilter === 'open') {
            filtered = filtered.filter(f => f.isAcceptingApplications && !isDeadlinePassed(f.deadline));
        } else if (quickFilter === 'closing-soon') {
            filtered = filtered.filter(f => {
                const days = getDaysUntilDeadline(f.deadline);
                return days !== null && days > 0 && days <= 30 && f.isAcceptingApplications;
            });
        } else if (quickFilter === 'undergrad') {
            filtered = filtered.filter(f =>
                f.yearOfStudy.some(y =>
                    y.toLowerCase().includes('freshman') ||
                    y.toLowerCase().includes('sophomore') ||
                    y.toLowerCase().includes('junior') ||
                    y.toLowerCase().includes('senior') ||
                    y.toLowerCase().includes('undergraduate')
                )
            );
        }

        return filtered;
    };

    const filteredFellowships = getFilteredFellowships();

    // Categorize filtered fellowships for sections
    const closingSoon = filteredFellowships.filter(f => {
        const days = getDaysUntilDeadline(f.deadline);
        return days !== null && days > 0 && days <= 14 && f.isAcceptingApplications;
    });

    const openFellowships = filteredFellowships.filter(f => {
        const days = getDaysUntilDeadline(f.deadline);
        const isClosingSoon = days !== null && days > 0 && days <= 14;
        return f.isAcceptingApplications && !isDeadlinePassed(f.deadline) && !isClosingSoon;
    });

    const closedFellowships = filteredFellowships.filter(f =>
        !f.isAcceptingApplications || isDeadlinePassed(f.deadline)
    );

    // Check if we're using a custom sort
    const isCustomSort = sortBy !== 'default';

    // Don't show sections when quick filter is applied
    const showSections = !isCustomSort && !quickFilter;

    return (
        <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)]">
            {/* Header */}
            <div className="mb-4 mt-6 text-center">
                <p className="text-sm text-gray-600">
                    Looking for non-research fellowships?{' '}
                    <a
                        href="https://yale.communityforce.com/Funds/Search.aspx#4371597136646D517975544F5976596D4E73384E69673D3D"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                    >
                        Search here
                    </a>.
                </p>
            </div>

            {/* Quick Filters */}
            <QuickFilters
                options={fellowshipQuickFilters}
                activeFilter={quickFilter}
                onFilterChange={setQuickFilter}
            />

            {/* Results count when filtered */}
            {quickFilter && (
                <div className="mb-3">
                    <p className="text-sm text-gray-600">
                        Showing {filteredFellowships.length} of {fellowships.length} fellowships
                    </p>
                </div>
            )}

            {/* Results */}
            <div>
                {filteredFellowships.length > 0 || isLoading ? (
                    <>
                        {/* If using custom sort or quick filter, show all fellowships in order without sections */}
                        {!showSections ? (
                            filteredFellowships.map((fellowship) => (
                                <FellowshipCard
                                    key={fellowship.id}
                                    fellowship={fellowship}
                                    favFellowshipIds={favFellowshipIds}
                                    updateFavorite={updateFavorite}
                                    openModal={openModal}
                                />
                            ))
                        ) : (
                            <>
                                {/* Closing Soon Section */}
                                {closingSoon.length > 0 && (
                                    <>
                                        <SectionHeader
                                            title="Closing Soon"
                                            count={closingSoon.length}
                                            variant="urgent"
                                            icon={
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <polyline points="12 6 12 12 16 14" />
                                                </svg>
                                            }
                                        />
                                        {closingSoon.map((fellowship) => (
                                            <FellowshipCard
                                                key={fellowship.id}
                                                fellowship={fellowship}
                                                favFellowshipIds={favFellowshipIds}
                                                updateFavorite={updateFavorite}
                                                openModal={openModal}
                                            />
                                        ))}
                                    </>
                                )}

                                {/* Open Fellowships Section */}
                                {openFellowships.length > 0 && (
                                    <>
                                        <SectionHeader
                                            title="Open Fellowships"
                                            count={openFellowships.length}
                                            icon={
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                                    <polyline points="22 4 12 14.01 9 11.01" />
                                                </svg>
                                            }
                                        />
                                        {openFellowships.map((fellowship) => (
                                            <FellowshipCard
                                                key={fellowship.id}
                                                fellowship={fellowship}
                                                favFellowshipIds={favFellowshipIds}
                                                updateFavorite={updateFavorite}
                                                openModal={openModal}
                                            />
                                        ))}
                                    </>
                                )}

                                {/* Closed Fellowships Section */}
                                {closedFellowships.length > 0 && (
                                    <>
                                        <SectionHeader
                                            title="Closed"
                                            count={closedFellowships.length}
                                            variant="muted"
                                            icon={
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                                </svg>
                                            }
                                        />
                                        {closedFellowships.map((fellowship) => (
                                            <FellowshipCard
                                                key={fellowship.id}
                                                fellowship={fellowship}
                                                favFellowshipIds={favFellowshipIds}
                                                updateFavorite={updateFavorite}
                                                openModal={openModal}
                                            />
                                        ))}
                                    </>
                                )}
                            </>
                        )}

                        {isLoading && (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            </div>
                        )}
                        {!searchExhausted && <div ref={loadMoreRef} className="h-10" />}
                        {searchExhausted && filteredFellowships.length > 0 && (
                            <p className="text-center text-gray-500 py-4">No more fellowships to load</p>
                        )}
                    </>
                ) : (
                    <div className="text-center py-8 text-gray-500">
                        <p>No fellowships match the current filter</p>
                        {quickFilter && (
                            <button
                                onClick={() => setQuickFilter(null)}
                                className="mt-2 text-blue-600 hover:underline text-sm"
                            >
                                Clear filter
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Modal */}
            <FellowshipModal
                fellowship={selectedFellowship!}
                isOpen={isModalOpen}
                onClose={closeModal}
                isFavorite={selectedFellowship ? favFellowshipIds.includes(selectedFellowship.id) : false}
                toggleFavorite={() => {
                    if (selectedFellowship) {
                        updateFavorite(selectedFellowship.id, !favFellowshipIds.includes(selectedFellowship.id));
                    }
                }}
            />
        </div>
    );
};

export default Fellowships;
