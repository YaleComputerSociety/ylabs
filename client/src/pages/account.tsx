import { useState, useEffect, useContext } from "react";
import { Listing, Fellowship } from '../types/types';
import { createListing } from '../utils/apiCleaner';
import { createFellowship } from '../utils/createFellowship';
import ListingCard from '../components/accounts/ListingCard';
import ListingDetailModal from "../components/shared/ListingDetailModal";
import FellowshipModal from "../components/fellowship/FellowshipModal";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import axios from '../utils/axios';
import swal from 'sweetalert';
import UserContext from "../contexts/UserContext";
import CreateButton from "../components/accounts/CreateButton";
import YoutubeVideo from "../components/accounts/YoutubeVideo";

const Account = () => {
    const [ownListings, setOwnListings] = useState<Listing[]>([]);
    const [favListings, setFavListings] = useState<Listing[]>([]);
    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);
    const [favFellowships, setFavFellowships] = useState<Fellowship[]>([]);
    const [favFellowshipIds, setFavFellowshipIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFellowshipModalOpen, setIsFellowshipModalOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
    const [selectedFellowship, setSelectedFellowship] = useState<Fellowship | null>(null);
    const { user } = useContext(UserContext);

    useEffect(() => {
        reloadListings();
    }, []);

    // Warning before navigating away from Y/Labs
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isEditing) {
                const message = "You have unsaved changes that will be lost if you leave this page.";
                e.preventDefault();
                (e as any).returnValue = message;
                return message;
            }
        };

        if (isEditing) {
            window.addEventListener('beforeunload', handleBeforeUnload);
        }

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isEditing]);

    const reloadListings = async () => {
        setIsLoading(true);

        await axios.get('/users/listings', { withCredentials: true }).then((response) => {
            const responseOwnListings: Listing[] = response.data.ownListings.map(function(elem: any) {
                return createListing(elem);
            });
            const responseFavListings: Listing[] = response.data.favListings.map(function(elem: any) {
                return createListing(elem);
            });
            setOwnListings(responseOwnListings);
            setFavListings(responseFavListings);
        }).catch((error) => {
            console.error('Error fetching listings:', error);
            setOwnListings([]);
            setFavListings([]);
            setIsLoading(false);
            swal({ text: "Error fetching your listings", icon: "warning" });
        });

        axios.get('/users/favListingsIds', { withCredentials: true }).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
            setIsLoading(false);
        }).catch((error) => {
            console.error("Error fetching user's favorite listings:", error);
            setOwnListings([]);
            setFavListings([]);
            setFavListingsIds([]);
            setIsLoading(false);
            swal({ text: "Error fetching your listings", icon: "warning" });
        });

        // Fetch favorite fellowships
        axios.get('/users/favFellowships').then((response) => {
            const rawFellowships = response.data.favFellowships || [];
            const fellowships: Fellowship[] = rawFellowships.map((f: any) => createFellowship(f));
            setFavFellowships(fellowships);
            setFavFellowshipIds(fellowships.map((f) => f.id));
        }).catch((error) => {
            console.error("Error fetching user's favorite fellowships:", error);
            setFavFellowshipIds([]);
            setFavFellowships([]);
        });
    };

    const openModal = (listing: Listing) => {
        setSelectedListing(listing);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedListing(null);
    };

    const updateFavorite = (listing: Listing, listingId: string, favorite: boolean) => {
        const prevFavListings = favListings;
        const prevFavListingsIds = favListingsIds;

        if (favorite) {
            setFavListings([listing, ...prevFavListings]);
            setFavListingsIds([listingId, ...prevFavListingsIds]);
            axios.put('/users/favListings', { withCredentials: true, data: { favListings: [listing.id] } }).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({ text: "Unable to favorite listing", icon: "warning" });
                reloadListings();
            });
        } else {
            setFavListings(prevFavListings.filter((listing) => listing.id !== listingId));
            setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));
            axios.delete('/users/favListings', { withCredentials: true, data: { favListings: [listingId] } }).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error unfavoriting listing:', error);
                swal({ text: "Unable to unfavorite listing", icon: "warning" });
                reloadListings();
            });
        }
    };

    const updateFellowshipFavorite = (fellowshipId: string, favorite: boolean) => {
        const prevFavFellowships = favFellowships;
        const prevFavFellowshipIds = favFellowshipIds;

        if (favorite) {
            setFavFellowshipIds([fellowshipId, ...prevFavFellowshipIds]);
            axios.put('/users/favFellowships', { withCredentials: true, data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowships(prevFavFellowships);
                setFavFellowshipIds(prevFavFellowshipIds);
                console.error('Error favoriting fellowship:', error);
                swal({ text: "Unable to favorite fellowship", icon: "warning" });
                reloadListings();
            });
        } else {
            setFavFellowships(prevFavFellowships.filter((f) => (f.id || (f as any)._id) !== fellowshipId));
            setFavFellowshipIds(prevFavFellowshipIds.filter((id) => id !== fellowshipId));
            axios.delete('/users/favFellowships', { withCredentials: true, data: { favFellowships: [fellowshipId] } }).catch((error) => {
                setFavFellowships(prevFavFellowships);
                setFavFellowshipIds(prevFavFellowshipIds);
                console.error('Error unfavoriting fellowship:', error);
                swal({ text: "Unable to unfavorite fellowship", icon: "warning" });
                reloadListings();
            });
        }
    };

    const openFellowshipModal = (fellowship: Fellowship) => {
        setSelectedFellowship(fellowship);
        setIsFellowshipModalOpen(true);
    };

    const closeFellowshipModal = () => {
        setIsFellowshipModalOpen(false);
        setSelectedFellowship(null);
    };

    const updateListing = (listing: Listing) => {
        setOwnListings((prevOwnListings) => prevOwnListings.map((l) => l.id === listing.id ? listing : l));
        setFavListings((prevFavListings) => prevFavListings.map((l) => l.id === listing.id ? listing : l));
    };

    const filterHiddenListings = (listings: Listing[]) => {
        return listings.filter((listing) => listing.confirmed && !listing.archived);
    };

    const postListing = (listing: Listing) => {
        setIsLoading(true);
        const isNewListing = listing.id === "create";
        const request = isNewListing
            ? axios.post('/listings', { withCredentials: true, data: listing })
            : axios.put(`/listings/${listing.id}`, { withCredentials: true, data: listing });

        request.then(() => {
            reloadListings();
            setIsEditing(false);
            setIsLoading(false);
            setIsCreating(false);
        }).catch((error) => {
            console.error(isNewListing ? 'Error creating listing:' : 'Error updating listing:', error);
            swal({ text: isNewListing ? "Unable to create listing" : "Unable to update listing", icon: "warning" });
            reloadListings();
            setIsEditing(false);
            setIsLoading(false);
            setIsCreating(false);
        });
    };

    const clearCreatedListing = () => {
        setOwnListings((prevOwnListings) => prevOwnListings.filter((listing) => listing.id !== "create"));
        setIsEditing(false);
        setIsCreating(false);
    };

    const deleteListing = (listing: Listing) => {
        setIsLoading(true);
        axios.delete(`/listings/${listing.id}`, { withCredentials: true }).then(() => {
            reloadListings();
            setIsLoading(false);
        }).catch((error) => {
            console.error('Error deleting listing:', error);
            swal({ text: "Unable to delete listing", icon: "warning" });
            reloadListings();
            setIsLoading(false);
        });
    };

    const onCreate = () => {
        axios.get('/listings/skeleton', { withCredentials: true }).then((response) => {
            const skeletonListing = createListing(response.data.listing);
            setOwnListings((prevOwnListings) => [...prevOwnListings, skeletonListing]);
            setIsEditing(true);
            setIsCreating(true);
        }).catch((error) => {
            console.error("Error fetching skeleton listing:", error);
            swal({ text: "Unable to create listing", icon: "warning" });
        });
    };

    return (
        <div className="mx-auto max-w-[1300px] px-6 pt-6 w-full">
            {isLoading ? (
                <div className="flex justify-center pt-12">
                    <LoadingSpinner size="lg" />
                </div>
            ) : (
                <div>
                    {user && !user.userConfirmed && (
                        <div className="bg-amber-100 border-l-4 border-amber-500 text-amber-700 p-4 mb-6 rounded shadow-sm">
                            <div className="flex items-center">
                                <p className="font-medium">Your account is pending confirmation. Any listings that you create will not be publicly visible as favorites or in search results until your account is confirmed.</p>
                            </div>
                        </div>
                    )}
                    {user && (user.userType === "professor" || user.userType === "faculty" || user.userType === "admin") && (
                        <>
                            <h2 className="text-2xl font-bold text-gray-800 text-center mb-6 pb-2">Your Listings</h2>
                            {ownListings.length > 0 && (
                                <ul>
                                    {ownListings.map((listing) => (
                                        <li key={listing.id} className="mb-2">
                                            <ListingCard
                                                listing={listing}
                                                favListingsIds={favListingsIds}
                                                updateFavorite={updateFavorite}
                                                updateListing={updateListing}
                                                postListing={postListing}
                                                clearCreatedListing={clearCreatedListing}
                                                deleteListing={deleteListing}
                                                openModal={openModal}
                                                globalEditing={isEditing}
                                                setGlobalEditing={setIsEditing}
                                                editable={true}
                                                reloadListings={reloadListings}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {!isCreating && (
                                <div className={`flex justify-center align-center ${ownListings.length > 0 ? "mb-6 mt-4" : "my-10"}`}>
                                    <CreateButton globalEditing={isEditing} handleCreate={onCreate} />
                                </div>
                            )}
                        </>
                    )}
                    <h2 className="text-2xl font-bold text-gray-800 text-center mb-6 pb-2">Favorite Listings</h2>
                    {filterHiddenListings(favListings).length > 0 ? (
                        <ul>
                            {filterHiddenListings(favListings).map((listing) => (
                                <li key={listing.id} className="mb-2">
                                    <ListingCard
                                        listing={listing}
                                        favListingsIds={favListingsIds}
                                        updateFavorite={updateFavorite}
                                        updateListing={updateListing}
                                        postListing={postListing}
                                        clearCreatedListing={clearCreatedListing}
                                        deleteListing={deleteListing}
                                        openModal={openModal}
                                        globalEditing={isEditing}
                                        setGlobalEditing={setIsEditing}
                                        editable={false}
                                        reloadListings={reloadListings}
                                    />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="my-4 text-center">No listings found.</p>
                    )}

                    <h2 className="text-2xl font-bold text-gray-800 text-center mb-6 mt-10 pb-2">Favorite Fellowships</h2>
                    {favFellowships.length > 0 ? (
                        <ul>
                            {favFellowships.map((fellowship) => (
                                <li key={fellowship.id} className="mb-2 cursor-pointer" onClick={() => openFellowshipModal(fellowship)}>
                                    <div className="bg-white rounded-md border border-gray-200 hover:border-blue-400 hover:shadow-sm transition-all p-4">
                                        <h3 className="text-sm font-semibold text-gray-900">{fellowship.title}</h3>
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{fellowship.summary || fellowship.description}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="my-4 text-center">No fellowships found.</p>
                    )}

                    {user && (user.userType === "professor" || user.userType === "faculty" || user.userType === "admin") && (
                        <>
                            <h1 className="text-4xl mt-24 font-bold text-center mb-7">Learn y/labs!</h1>
                            <div className="mt-4 flex align-center justify-center mb-4">
                                <YoutubeVideo />
                            </div>
                        </>
                    )}

                    {/* Listing Modal */}
                    {selectedListing && (
                        <ListingDetailModal
                            isOpen={isModalOpen}
                            onClose={closeModal}
                            listing={selectedListing}
                            isFavorite={favListingsIds.includes(selectedListing.id)}
                            onToggleFavorite={(e) => {
                                e.stopPropagation();
                                updateFavorite(selectedListing, selectedListing.id, !favListingsIds.includes(selectedListing.id));
                            }}
                        />
                    )}

                    {/* Fellowship Modal */}
                    {selectedFellowship && (
                        <FellowshipModal
                            fellowship={selectedFellowship}
                            isOpen={isFellowshipModalOpen}
                            onClose={closeFellowshipModal}
                            isFavorite={favFellowshipIds.includes(selectedFellowship.id)}
                            toggleFavorite={() => {
                                updateFellowshipFavorite(
                                    selectedFellowship.id,
                                    !favFellowshipIds.includes(selectedFellowship.id)
                                );
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default Account;
