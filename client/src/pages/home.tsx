import {useState, useEffect} from "react";
import ListingsCardList from "../components/home/ListingsCardList";
import SearchHub from "../components/home/SearchHub";
import { departmentCategories } from "../utils/departmentNames";
import axios from "../utils/axios";

import styled from "styled-components";
import {NewListing} from '../types/types';

import swal from "sweetalert";

// Remove all archived from search results on backend

const Home = () => {
    const [listings, setListings] = useState<NewListing[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);
    const [searchExhausted, setSearchExhausted] = useState<Boolean>(false);
    const [page, setPage] = useState<number>(1);
    const pageSize = 20;

    const sortableKeys = ['default', 'updatedAt', 'ownerLastName', 'ownerFirstName', 'title']

    const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
    const [sortOrder, setSortOrder] = useState<number>(-1);

    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);

    const departmentKeys = Object.keys(departmentCategories).sort((a, b) => a.localeCompare(b));

    const reloadFavorites = async () => {
        axios.get('/users/favListingsIds', {withCredentials: true}).then((response) => {
            setFavListingsIds(response.data.favListingsIds);
        }).catch((error => {
            console.error("Error fetching user's favorite listings:", error);
            setFavListingsIds([]);
            swal({
                text: "Could not load your favorite listings",
                icon: "warning",
            })
        }));
    }

    useEffect(() => {
        reloadFavorites();
    }, []);

    const addListings = (newListings: NewListing[]) => {
        setListings((oldListings) => [...oldListings, ...newListings]);
        setSearchExhausted(newListings.length < pageSize);
    };

    const resetListings = (newListings: NewListing[]) => {
        setListings(newListings);
        setSearchExhausted(newListings.length < pageSize);
    };

    const updateFavorite = (listingId: string, favorite: boolean) => {
        const prevFavListingsIds = favListingsIds;
        
        if(favorite) {
            setFavListingsIds([listingId, ...prevFavListingsIds]);
    
            axios.put('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListingsIds(prevFavListingsIds);
                console.error('Error favoriting listing:', error);
                swal({
                    text: "Unable to favorite listing",
                    icon: "warning",
                })
                reloadFavorites();
            });
        } else {
            setFavListingsIds(prevFavListingsIds.filter((id) => id !== listingId));
    
            axios.delete('/users/favListings', {withCredentials: true, data: {favListings: [listingId]}}).catch((error) => {
                setFavListingsIds(prevFavListingsIds);
                console.error('Error unfavoriting listing:', error);
                swal({
                    text: "Unable to unfavorite listing",
                    icon: "warning",
                })
                reloadFavorites();
            });
        }
    };

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <div className='mt-12'>
                <SearchHub allDepartments={departmentKeys} resetListings={resetListings} addListings={addListings} setIsLoading={setIsLoading} sortBy={sortBy} sortOrder={sortOrder} page={page} setPage={setPage} pageSize={pageSize}></SearchHub>
            </div>
            <div style={{marginTop: '2rem'}}></div>
            {listings.length > 0 ? (
                        <ListingsCardList loading={isLoading} searchExhausted={searchExhausted} setPage={setPage} listings={listings} sortableKeys={sortableKeys} setSortBy={setSortBy} setSortOrder={setSortOrder} favListingsIds={favListingsIds} updateFavorite={updateFavorite} ></ListingsCardList>
                    ) : (
                        <NoResultsText>No results match the search criteria</NoResultsText>
            )}
        </div>
    );
};

export default Home;

const NoResultsText = styled.h4`
  color: #838383;
  text-align: center;
  padding-top: 15%;
`;