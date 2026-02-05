import { useState, useEffect, useContext } from "react";
import ListingsCardList from "../components/home/ListingsCardList";
import SearchContext from "../contexts/SearchContext";
import axios from "../utils/axios";

import styled from "styled-components";

import swal from "sweetalert";

const Home = () => {
    const {
        listings,
        isLoading,
        searchExhausted,
        setPage,
        sortableKeys,
        sortBy,
        setSortBy,
        setSortOrder,
        sortDirection,
        onToggleSortDirection,
        refreshListings,
        setQueryString,
    } = useContext(SearchContext);

    const [favListingsIds, setFavListingsIds] = useState<string[]>([]);

    // Scroll to top and clear search query on page load
    useEffect(() => {
        window.scrollTo(0, 0);
        setQueryString('');
    }, []);

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
        refreshListings();
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
        <div
            className="mx-auto max-w-[1300px] px-6 w-full min-h-[calc(100vh-12rem)]"
        >
            <div className='mt-4 md:mt-8'></div>
            {listings.length > 0 || isLoading ? (
                <ListingsCardList
                    loading={isLoading}
                    searchExhausted={searchExhausted}
                    setPage={setPage}
                    listings={listings}
                    sortableKeys={sortableKeys}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    setSortOrder={setSortOrder}
                    sortDirection={sortDirection}
                    onToggleSortDirection={onToggleSortDirection}
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
