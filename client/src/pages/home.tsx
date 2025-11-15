import { useContext, useState, useEffect } from "react";
import ListingsCardList from "../components/home/ListingsCardList";
import SearchHub from "../components/home/SearchHub";
import SearchContext from "../contexts/SearchContext";
import { departmentCategories } from "../utils/departmentNames";
import axios from "../utils/axios";

import styled from "styled-components";

import swal from "sweetalert";

// Remove all archived from search results on backend

const Home = () => {
    // Get search state from context
    const { state, nextPage } = useContext(SearchContext);
    const { listings, isLoading, searchExhausted, sortBy, sortOrder } = state;

    const sortDirection = sortOrder === 1 ? 'asc' : 'desc';
    const sortableKeys = ['default', 'updatedAt', 'ownerLastName', 'ownerFirstName', 'title'];

    // Keep favorites (will be refactored to FavoritesContext later)
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
        <div className="mx-auto max-w-[1300px] px-6 mt-24 w-full min-h-[calc(100vh-12rem)]">
            <div className='mt-12'>
                <SearchHub allDepartments={departmentKeys} />
            </div>
            <div className='mt-4 md:mt-10'></div>
            {listings.length > 0 ? (
                <ListingsCardList
                    loading={isLoading}
                    searchExhausted={searchExhausted}
                    setPage={nextPage}
                    listings={listings}
                    sortableKeys={sortableKeys}
                    sortBy={sortBy}
                    setSortBy={() => {}}
                    setSortOrder={() => {}}
                    sortDirection={sortDirection}
                    onToggleSortDirection={() => {}}
                    favListingsIds={favListingsIds}
                    updateFavorite={updateFavorite}
                />
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