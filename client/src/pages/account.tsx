import {useState, useEffect} from "react";
import {NewListing} from '../types/types'
import OwnListingsCard from '../components/accounts/OwnListingsCard'
import FavListingsCard from "../components/accounts/FavListingsCard";
import axios from '../utils/axios';
import swal from 'sweetalert';

import PulseLoader from "react-spinners/PulseLoader";

const Account = () => {
    const [ownListings, setOwnListings] = useState<NewListing[]>([]);
    const [favListings, setFavListings] = useState<NewListing[]>([]);
    const [favListingsIds, setFavListingsIds] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);

    useEffect(() => {
        reloadListings();
    }, []);

    const reloadListings = () => {
        setIsLoading(true);

        axios.get('/users/listings', {withCredentials: true}).then((response) => {
            const responseOwnListings : NewListing[] = response.data.ownListings.map(function(elem: any){
                return {
                    id: elem._id,
                    professorIds: elem.professorIds,
                    professorNames: elem.professorNames,
                    title: elem.title,
                    departments: elem.departments,
                    emails: elem.emails,
                    websites: elem.websties,
                    description: elem.description,
                    keywords: elem.keywords,
                    established: elem.established,
                    views: elem.views,
                    favorites: elem.favorites,
                    hiringStatus: elem.hiringStatus,
                    archived: elem.archived,
                    updatedAt: elem.updatedAt,
                    createdAt: elem.createdAt
                }
            })
            const responseFavListings : NewListing[] = response.data.favListings.map(function(elem: any){
                return {
                    id: elem._id,
                    professorIds: elem.professorIds,
                    professorNames: elem.professorNames,
                    title: elem.title,
                    departments: elem.departments,
                    emails: elem.emails,
                    websites: elem.websties,
                    description: elem.description,
                    keywords: elem.keywords,
                    established: elem.established,
                    views: elem.views,
                    favorites: elem.favorites,
                    hiringStatus: elem.hiringStatus,
                    archived: elem.archived,
                    updatedAt: elem.updatedAt,
                    createdAt: elem.createdAt
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

    const handleFavorite = (listing: NewListing ,listingId: number) => {
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