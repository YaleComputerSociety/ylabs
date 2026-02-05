import { useState, useEffect, useContext, useRef, useCallback } from "react";
import FellowshipCard from "../components/fellowship/FellowshipCard";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import axios from "../utils/axios";
import { Fellowship } from "../types/types";
import styled from "styled-components";
import swal from "sweetalert";

const Fellowships = () => {
    const {
        fellowships,
        isLoading,
        searchExhausted,
        setPage,
        total,
        setQueryString,
    } = useContext(FellowshipSearchContext);

    const [favFellowshipIds, setFavFellowshipIds] = useState<string[]>([]);
    const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Scroll to top and clear search query on page load
    useEffect(() => {
        window.scrollTo(0, 0);
        setQueryString('');
    }, []);

    // Load favorites (we'll use the same user favorites endpoint but for fellowships)
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
                swal({
                    text: "Unable to favorite fellowship",
                    icon: "warning",
                });
            });
        } else {
            setFavFellowshipIds(prevFavIds.filter((id) => id !== fellowshipId));
            axios.delete('/users/favFellowships', { data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowshipIds(prevFavIds);
                console.error('Error unfavoriting fellowship:', error);
                swal({
                    text: "Unable to unfavorite fellowship",
                    icon: "warning",
                });
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

    return (
        <div className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)]">
            {/* Header */}
            <div className="mb-6 mt-6 text-center">
                <p className="text-sm text-gray-600">Looking for non-research fellowships? <a href="https://yale.communityforce.com/Funds/Search.aspx#4371597136646D517975544F5976596D4E73384E69673D3D" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Search here</a>.</p>
            </div>

            {/* Results */}
            <div>
                {fellowships.length > 0 || isLoading ? (
                    <>
                        {fellowships.map((fellowship) => (
                            <FellowshipCard
                                key={fellowship.id}
                                fellowship={fellowship}
                                favFellowshipIds={favFellowshipIds}
                                updateFavorite={updateFavorite}
                                openModal={openModal}
                            />
                        ))}
                        {isLoading && (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            </div>
                        )}
                        {!searchExhausted && <div ref={loadMoreRef} className="h-10" />}
                        {searchExhausted && fellowships.length > 0 && (
                            <p className="text-center text-gray-500 py-4">No more fellowships to load</p>
                        )}
                    </>
                ) : (
                    <NoResultsText>No fellowships match the search criteria</NoResultsText>
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

const NoResultsText = styled.h4`
  color: #838383;
  text-align: center;
  padding-top: 15%;
`;
