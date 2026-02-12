import { useState, useEffect, useContext, useMemo } from "react";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import AdminFellowshipEditModal from "../components/admin/AdminFellowshipEditModal";
import FellowshipSearchContext from "../contexts/FellowshipSearchContext";
import UserContext from "../contexts/UserContext";
import BrowseGrid from "../components/shared/BrowseGrid";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { BrowsableItem } from "../types/browsable";
import { Fellowship } from "../types/types";
import axios from "../utils/axios";

const CLOSING_SOON_DAYS = 30;

function categorizeFellowship(f: Fellowship, now: Date): 'closingSoon' | 'open' | 'closed' {
    const deadlinePassed = f.deadline ? new Date(f.deadline) < now : false;
    const isOpen = f.isAcceptingApplications && !deadlinePassed;

    if (!isOpen) return 'closed';

    if (f.deadline) {
        const daysUntil = Math.ceil((new Date(f.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil <= CLOSING_SOON_DAYS && daysUntil > 0) return 'closingSoon';
    }

    return 'open';
}

const SectionHeader = ({ title, count, color }: { title: string; count: number; color: string }) => (
    <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
        <div className={`w-1 h-6 rounded-full ${color}`} />
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <span className="text-sm text-gray-500">({count})</span>
    </div>
);

const Fellowships = () => {
    const {
        fellowships,
        isLoading,
        setQueryString,
        quickFilter,
        refreshFellowships,
    } = useContext(FellowshipSearchContext);

    const { user } = useContext(UserContext);
    const isAdmin = user?.userType === 'admin';

    const [favFellowshipIds, setFavFellowshipIds] = useState<string[]>([]);
    const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [adminEditFellowship, setAdminEditFellowship] = useState<Fellowship | null>(null);

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

    // Categorize fellowships into 3 groups
    const { closingSoon, open, closed } = useMemo(() => {
        const now = new Date();
        const groups = { closingSoon: [] as Fellowship[], open: [] as Fellowship[], closed: [] as Fellowship[] };
        for (const f of fellowships) {
            const cat = categorizeFellowship(f, now);
            groups[cat].push(f);
        }
        // Sort closing soon by deadline (nearest first)
        groups.closingSoon.sort((a, b) => {
            const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
            const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
            return da - db;
        });
        return groups;
    }, [fellowships]);

    const toBrowsable = (fs: Fellowship[]): BrowsableItem[] =>
        fs.map((f) => ({ type: 'fellowship' as const, data: f }));

    // Apply "recently added" filter if active
    const recentFilter = (fs: Fellowship[]) => {
        if (quickFilter !== 'recent') return fs;
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return fs.filter(f => new Date(f.createdAt) >= thirtyDaysAgo);
    };

    const closingSoonItems = useMemo(() => toBrowsable(recentFilter(closingSoon)), [closingSoon, quickFilter]);
    const openItems = useMemo(() => toBrowsable(recentFilter(open)), [open, quickFilter]);
    const closedItems = useMemo(() => toBrowsable(recentFilter(closed)), [closed, quickFilter]);

    // Determine which sections are visible based on quick filter
    const showSection = (section: 'closingSoon' | 'open' | 'closed') => {
        if (quickFilter === null || quickFilter === 'recent') return true;
        if (quickFilter === 'open') return section !== 'closed'; // "Open Only" shows closingSoon + open
        if (quickFilter === 'closingSoon') return section === 'closingSoon';
        return false;
    };

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

    const handleAdminEdit = (item: BrowsableItem) => {
        if (item.type === 'fellowship') {
            setAdminEditFellowship(item.data);
        }
    };

    const noResults = fellowships.length === 0 && !isLoading;

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

            {isLoading && fellowships.length === 0 ? (
                <LoadingSpinner size="lg" />
            ) : noResults ? (
                <div className="text-center py-8 text-gray-500">
                    <p>No fellowships match the search criteria</p>
                </div>
            ) : (
                <>
                    {/* Closing Soon */}
                    {showSection('closingSoon') && closingSoonItems.length > 0 && (
                        <>
                            <SectionHeader title="Closing Soon" count={closingSoonItems.length} color="bg-amber-500" />
                            <BrowseGrid
                                items={closingSoonItems}
                                favIds={favFellowshipIds}
                                onToggleFavorite={handleToggleFavorite}
                                onOpenModal={handleOpenModal}
                                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                                isLoading={false}
                                emptyMessage="No closing-soon fellowships"
                            />
                        </>
                    )}

                    {/* Open */}
                    {showSection('open') && openItems.length > 0 && (
                        <>
                            <SectionHeader title="Open" count={openItems.length} color="bg-green-500" />
                            <BrowseGrid
                                items={openItems}
                                favIds={favFellowshipIds}
                                onToggleFavorite={handleToggleFavorite}
                                onOpenModal={handleOpenModal}
                                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                                isLoading={false}
                                emptyMessage="No open fellowships"
                            />
                        </>
                    )}

                    {/* Closed */}
                    {showSection('closed') && closedItems.length > 0 && (
                        <>
                            <SectionHeader title="Closed" count={closedItems.length} color="bg-gray-400" />
                            <BrowseGrid
                                items={closedItems}
                                favIds={favFellowshipIds}
                                onToggleFavorite={handleToggleFavorite}
                                onOpenModal={handleOpenModal}
                                onAdminEdit={isAdmin ? handleAdminEdit : undefined}
                                isLoading={false}
                                emptyMessage="No closed fellowships"
                            />
                        </>
                    )}
                </>
            )}

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

            {/* Admin edit modal */}
            {adminEditFellowship && (
                <AdminFellowshipEditModal
                    fellowship={adminEditFellowship}
                    onClose={() => setAdminEditFellowship(null)}
                    onSave={() => {
                        setAdminEditFellowship(null);
                        refreshFellowships();
                    }}
                />
            )}
        </div>
    );
};

export default Fellowships;
