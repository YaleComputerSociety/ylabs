import { useState, useEffect, useContext, useMemo } from "react";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import BrowseGrid from "../components/shared/BrowseGrid";
import { BrowsableItem } from "../types/browsable";
import { Fellowship } from "../types/types";
import axios from "../utils/axios";

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

    useEffect(() => {
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

    // Wrap as BrowsableItems
    const items: BrowsableItem[] = useMemo(() =>
        fellowships.map((f) => ({ type: 'fellowship' as const, data: f })),
        [fellowships]
    );

    // Infinite scroll (replaces manual IntersectionObserver that caused stutter)
    const sentinelRef = useInfiniteScroll({
        searchExhausted,
        isLoading,
        setPage,
    });

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

    const handleToggleFavorite = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        updateFavorite(id, !favFellowshipIds.includes(id));
    };

    const handleOpenModal = (item: BrowsableItem) => {
        if (item.type === 'fellowship') {
            setSelectedFellowship(item.data);
            setIsModalOpen(true);
        }
    };

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

            <BrowseGrid
                items={items}
                favIds={favFellowshipIds}
                onToggleFavorite={handleToggleFavorite}
                onOpenModal={handleOpenModal}
                sentinelRef={sentinelRef}
                isLoading={isLoading}
                searchExhausted={searchExhausted}
                emptyMessage="No fellowships match the search criteria"
            />

            {/* Fellowship detail modal */}
            {selectedFellowship && (
                <FellowshipModal
                    fellowship={selectedFellowship}
                    isOpen={isModalOpen}
                    onClose={() => { setIsModalOpen(false); setSelectedFellowship(null); }}
                    isFavorite={favFellowshipIds.includes(selectedFellowship.id)}
                    toggleFavorite={() => {
                        updateFavorite(selectedFellowship.id, !favFellowshipIds.includes(selectedFellowship.id));
                    }}
                />
            )}
        </div>
    );
};

export default Fellowships;
