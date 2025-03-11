import {useState, useEffect} from "react";
import {Listing} from '../types/types'
import ListingCard from '../components/ListingCard'
import axios from '../utils/axios';

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
                                    <ListingCard listing={listing} favListingsIds={favListingsIds} reloadListings={reloadListings}/>
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
                                    <ListingCard listing={listing} favListingsIds={favListingsIds} reloadListings={reloadListings}/>
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