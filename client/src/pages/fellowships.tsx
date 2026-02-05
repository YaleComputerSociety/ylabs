import { useState, useEffect, useContext, useRef, useCallback } from "react";
import FellowshipCard from "../components/fellowship/FellowshipCard";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import QuickFilters, { QuickFilterOption } from "../components/shared/QuickFilters";
import axios from "../utils/axios";
import { Fellowship } from "../types/types";

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
        setQueryString,
    } = useContext(FellowshipSearchContext);

    const [favFellowshipIds, setFavFellowshipIds] = useState<string[]>([]);
    const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [quickFilter, setQuickFilter] = useState<string | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        window.scrollTo(0, 0);
        setQueryString('');
    }, []);

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

    // Only show loader when loading more (not when list is empty)
    const showLoader = isLoading && filteredFellowships.length > 0;

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
            {quickFilter && filteredFellowships.length > 0 && (
                <div className="mb-3">
                    <p className="text-sm text-gray-600">
                        Showing {filteredFellowships.length} of {fellowships.length} fellowships
                    </p>
                </div>
            )}

            {/* Results */}
            <div>
                {filteredFellowships.length === 0 && !isLoading ? (
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
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredFellowships.map((fellowship) => (
                                <FellowshipCard
                                    key={fellowship.id}
                                    fellowship={fellowship}
                                    favFellowshipIds={favFellowshipIds}
                                    updateFavorite={updateFavorite}
                                    openModal={openModal}
                                />
                            ))}
                        </div>

                        {showLoader && (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            </div>
                        )}

                        {/* Infinite scroll trigger */}
                        {!searchExhausted && <div ref={loadMoreRef} className="h-10" />}

                        {searchExhausted && filteredFellowships.length > 0 && (
                            <p className="text-center text-gray-500 py-4">No more fellowships to load</p>
                        )}
                    </>
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
