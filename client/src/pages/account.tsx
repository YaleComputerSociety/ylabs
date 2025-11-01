import {useState, useEffect} from "react";
import {Listing} from '../types/types'
import {createListing} from '../utils/apiCleaner';
import ListingCard from '../components/accounts/ListingCard'
import ListingModal from "../components/accounts/ListingModal";
import createButton from "../components/accounts/CreateButton";
import axios from '../utils/axios';
import swal from 'sweetalert';
import PulseLoader from "react-spinners/PulseLoader";
import { useContext } from "react";
import UserContext from "../contexts/UserContext";
import CreateButton from "../components/accounts/CreateButton";
import YoutubeVideo from "../components/accounts/YoutubeVideo";
import ResumeUpload from "../components/ResumeUpload";
import ProfessorDashboard from "../components/ProfessorDashboard";

const Account = () => {
    const [ownListings, setOwnListings] = useState<Listing[]>([]);
    const [favListings, setFavListings] = useState<Listing[]>([]);
    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
    const {user} = useContext(UserContext);

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

        await axios.get('/users/listings', {withCredentials: true}).then((response) => {
            const responseOwnListings : Listing[] = response.data.ownListings.map(function(elem: any){
                return createListing(elem);
            })
            const responseFavListings : Listing[] = response.data.favListings.map(function(elem: any){
                return createListing(elem);
            })
            setOwnListings(responseOwnListings);
            setFavListings(responseFavListings);
        }).catch((error => {
            console.error('Error fetching listings:', error);
            setOwnListings([]);
            setFavListings([]);
            setIsLoading(false);
            swal({
                text: "Error fetching your listings",
                icon: "warning",
            })
        }));

        axios.get('/users/favListingsIds', {withCredentials: true}).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
            setIsLoading(false);
        }).catch((error => {
            console.error("Error fetching user's favorite listings:", error);
            setOwnListings([]);
            setFavListings([]);
            setFavListingsIds([]);
            setIsLoading(false);
            swal({
                text: "Error fetching your listings",
                icon: "warning",
            })
        }));
    };

    // Function to open modal with a specific listing
    const openModal = (listing: Listing) => {
        setSelectedListing(listing);
        setIsModalOpen(true);
    };

    // Function to close modal
    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedListing(null);
    };

    const updateFavorite = (listing: Listing, listingId: string, favorite: boolean) => {
        const prevFavListings = favListings;
        const prevFavListingsIds = favListingsIds;
        
        if(favorite) {
            setFavListings([listing, ...prevFavListings]);
            setFavListingsIds([listingId, ...prevFavListingsIds]);
    
            axios.put('/users/favListings', {withCredentials: true, data: {favListings: [listing.id]}}).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({
                    text: "Unable to favorite listing",
                    icon: "warning",
                })
                reloadListings();
            });
        } else {
            setFavListings(prevFavListings.filter((listing) => listing.id !== listingId));
            setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));
    
            axios.delete('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error unfavoriting listing:', error);
                swal({
                    text: "Unable to unfavorite listing",
                    icon: "warning",
                })
                reloadListings();
            });
        }
    };

    const updateListing = (listing: Listing) => {
        setOwnListings((prevOwnListings) => prevOwnListings.map((listing) => listing.id === listing.id ? listing : listing));
        setFavListings((prevFavListings) => prevFavListings.map((listing) => listing.id === listing.id ? listing : listing));
    };

    const filterHiddenListings = (listings: Listing[]) => {
        return listings.filter((listing) => listing.confirmed && !listing.archived);
    }

    const postListing = (listing: Listing) => {
        setIsLoading(true);
        axios.put(`/listings/${newListing.id}`, { data: newListing }).then((response) => {
            reloadListings();
        }).catch((error) => {
            console.error('Error saving listing:', error);
            
            if(error.response.data.incorrectPermissions) {
                swal({
                    text: "You no longer have permission to edit this listing",
                    icon: "warning",
                })
                reloadListings();
            } else {
                swal({
                    text: "Unable to update listing",
                    icon: "warning",
                })
                reloadListings();
            }
        });
    }

    const postNewListing = (listing: NewListing) => {
        setIsLoading(true);
        axios.post('/listings', { data: listing }).then((response) => {
            reloadListings();
            setIsEditing(false);
            setIsLoading(false);
            setIsCreating(false);
        }).catch((error) => {
            console.error('Error posting new listing:', error);
            swal({
                text: "Unable to create listing",
                icon: "warning",
            })

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
        axios.delete(`/listings/${listing.id}`, {withCredentials: true}).then((response) => {
            reloadListings();
            setIsLoading(false);
        }).catch((error) => {
            console.error('Error deleting listing:', error);
            swal({
                text: "Unable to delete listing",
                icon: "warning",
            })

            reloadListings();
            setIsLoading(false);
        });
    };

    const onCreate = () => {
        axios.get('/listings/skeleton', {withCredentials: true}).then((response) => {
            const skeletonListing = createListing(response.data.listing);

            setOwnListings((prevOwnListings) => [...prevOwnListings, skeletonListing]);
            
            setIsEditing(true);
            setIsCreating(true);
        }).catch((error => {
            console.error("Error fetching skeleton listing:", error);
            swal({
                text: "Unable to create listing",
                icon: "warning",
            })
        }));
    };

    return (
        <div className="mx-auto max-w-[1300px] px-6 mt-24 w-full">
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
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
                    <p className="text-xl text-gray-700 mb-4">Your listings</p>
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
                    {user && (user.userType === "professor" || user.userType === "faculty" || user.userType === "admin") && !isCreating && (
                        <div className="my-8 flex justify-center align-center">
                            <CreateButton globalEditing={isEditing} handleCreate={onCreate}/>
                        </div>
                    )}
                    <p className="text-xl text-gray-700 mb-4">Favorite listings</p>
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
                        <p className="my-4 flex align-center">No listings found.</p>
                    )}

                    {user && (user.userType === "professor" || user.userType === "faculty" || user.userType === "admin") && (
                        <>
                            
                            <h1 className="text-4xl mt-24 font-bold text-center mb-7">Learn y/labs!</h1>
                            <div className="mt-4 flex align-center justify-center mb-4">
                                <YoutubeVideo />
                            </div>
                        </>
                    )}

                    {/* Student Resume Upload */}
                    {user && ['undergraduate', 'graduate'].includes(user.userType) && (
                        <>
                            <div className="mt-12 mb-8">
                                <h2 className="text-2xl font-bold text-gray-800 mb-6">Resume Management</h2>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <ResumeUpload />
                                </div>
                            </div>
                        </>
                    )}

                    {user && (user.userType === 'professor' || user.userType === 'faculty' || user.userType === 'admin') && (
                        <div className="mt-12 mb-8">
                            <h2 className="text-2xl font-bold text-gray-800 mb-6">Application Management</h2>
                            <ProfessorDashboard />
                        </div>
                    )}
                    
                    {/* Modal */}
                    {selectedListing && (
                        <ListingModal 
                            isOpen={isModalOpen} 
                            onClose={closeModal} 
                            listing={selectedListing}
                            favListingsIds={favListingsIds}
                            updateFavorite={updateFavorite}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default Account;