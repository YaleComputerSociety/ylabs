import {useState, useEffect} from "react";
import {Listing} from '../types/types'
import OwnListingsCard from '../components/accounts/OwnListingsCard'
import FavListingsCard from "../components/accounts/FavListingsCard";
import axios from '../utils/axios';
import swal from 'sweetalert';

import PulseLoader from "react-spinners/PulseLoader";

const Account = () => {
    const [ownListings, setOwnListings] = useState<Listing[]>([]);
    const [favListings, setFavListings] = useState<Listing[]>([]);
    const [favListingsIds, setFavListingsIds] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);

    useEffect(() => {
        reloadListings();
    }, []);

    const reloadListings = () => {
        setIsLoading(true);

        axios.get('/users/listings', {withCredentials: true}).then((response) => {
            const responseOwnListings : Listing[] = response.data.ownListings.map(function(elem: any){
                return {
                    id: elem._id,
                    departments: elem.departments.join('; '),
                    email: elem.emails[0],
                    website: elem.websites[0],
                    description: elem.description,
                    keywords: elem.keywords,
                    lastUpdated: elem.updatedAt,
                    name: elem.professorNames[0]
                }
            })
            const responseFavListings : Listing[] = response.data.favListings.map(function(elem: any){
                return {
                    id: elem._id,
                    departments: elem.departments.join('; '),
                    email: elem.emails[0],
                    website: elem.websites[0],
                    description: elem.description,
                    keywords: elem.keywords,
                    lastUpdated: elem.updatedAt,
                    name: elem.professorNames[0]
                }
            })
            setOwnListings(responseOwnListings);
            setFavListings(responseFavListings);
        });

        axios.get('/users/favListingsIds', {withCredentials: true}).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
            setIsLoading(false);
        });
    };

    /*
    FOR TESTING
    REMOVE LATER
    */
    const timeout = (delay: number) => new Promise(res => setTimeout(res, delay));

    const handleUnfavorite = (listingId: number) => {
        const prevFavListings = favListings;
        const prevFavListingsIds = favListingsIds;

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
    };

    const handleFavorite = (listing: Listing ,listingId: number) => {
        const prevFavListings = favListings;
        const prevFavListingsIds = favListingsIds;


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
    };

    return (
        <div className="p-8 mt-[4rem]">
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
                </div>
            ) : (
                <div>
                    <p className="text-xl text-gray-700 mb-4">Your listings</p>
                    {ownListings.length > 0 ? (
                        <ul>
                            {ownListings.map((listing) => (
                                <li key={listing.id} className="mb-2">
                                    <OwnListingsCard listing={listing} favListingsIds={favListingsIds} unfavoriteListing={handleUnfavorite} favoriteListing={handleFavorite}/>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>No listings found.</p>
                    )}
                    <p className="text-xl text-gray-700 mb-4">Favorite listings</p>
                    {favListings.length > 0 ? (
                        <ul>
                            {favListings.map((listing) => (
                                <li key={listing.id} className="mb-2">
                                    <FavListingsCard listing={listing} unfavoriteListing={handleUnfavorite}/>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>No listings found.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default Account;