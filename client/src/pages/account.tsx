import {useState, useEffect} from "react";
import {NewListing} from '../types/types'
import {createListing} from '../utils/apiCleaner';
import ListingCard from '../components/accounts/ListingCard'
import ListingModal from "../components/accounts/ListingModal";
import axios from '../utils/axios';
import swal from 'sweetalert';
import PulseLoader from "react-spinners/PulseLoader";

const Account = () => {
    const [ownListings, setOwnListings] = useState<NewListing[]>([]);
    const [favListings, setFavListings] = useState<NewListing[]>([]);
    const [favListingsIds, setFavListingsIds] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedListing, setSelectedListing] = useState<NewListing | null>(null);

    useEffect(() => {
        reloadListings();
    }, []);

    const reloadListings = async () => {
        setIsLoading(true);

        await axios.get('/users/listings', {withCredentials: true}).then((response) => {
            const responseOwnListings : NewListing[] = response.data.ownListings.map(function(elem: any){
                return createListing(elem);
            })
            const responseFavListings : NewListing[] = response.data.favListings.map(function(elem: any){
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

        await axios.get('/users/favListingsIds', {withCredentials: true}).then((response) => {
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
    const openModal = (listing: NewListing) => {
        setSelectedListing(listing);
        setIsModalOpen(true);
    };

    // Function to close modal
    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedListing(null);
    };

    const updateFavorite = (listing: NewListing, listingId: number, favorite: boolean) => {
        const prevFavListings = favListings;
        const prevFavListingsIds = favListingsIds;
        
        if(favorite) {
            setFavListings([...prevFavListings, listing]);
            setFavListingsIds([...prevFavListingsIds, listingId]);
    
            axios.put('/users/favListings', {withCredentials: true, data: {favListings: [listing.id]}}).catch((error) => {
                setFavListings(prevFavListings);
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({
                    text: "Unable to favorite listing",
                    icon: "warning",
                })
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
            });
        }
    };

    const updateListing = (newListing: NewListing) => {
        const prevOwnListings = ownListings;
        console.log(newListing);
        setOwnListings((prevOwnListings) => prevOwnListings.map((listing) => listing.id === newListing.id ? newListing : listing));
        //console.log(ownListings.map((listing) => listing.id === newListing.id))
        //console.log(ownListings.map((listing) => listing.id), newListing.id);
        const prevFavListings = favListings;
        setFavListings((prevFavListings) => prevFavListings.map((listing) => listing.id === newListing.id ? newListing : listing));
        //console.log(favListings.map((listing) => listing.id === newListing.id));
        //console.log(favListings.map((listing) => listing.id), newListing.id);
    };

    return (
        <div className="p-8 transition-all lg:mx-12 mt-[4rem]">
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
                </div>
            ) : (
                <div className="">
                    <p className="text-xl text-gray-700 mb-4">Your listings</p>
                    {ownListings.length > 0 ? (
                        <ul>
                            {ownListings.map((listing) => (
                                <li key={listing.id} className="mb-2">
                                    <ListingCard 
                                        listing={listing} 
                                        favListingsIds={favListingsIds} 
                                        updateFavorite={updateFavorite}
                                        updateListing={updateListing}
                                        openModal={openModal}
                                        editable={true}
                                    />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="mb-4">No listings found.</p>
                    )}
                    <p className="text-xl text-gray-700 mb-4">Favorite listings</p>
                    {favListings.length > 0 ? (
                        <ul>
                            {favListings.map((listing) => (
                                <li key={listing.id} className="mb-2">
                                    <ListingCard
                                        listing={listing}
                                        favListingsIds={favListingsIds}
                                        updateFavorite={updateFavorite}
                                        updateListing={updateListing}
                                        openModal={openModal}
                                        editable={false}
                                    />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>No listings found.</p>
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