import {useState, useEffect} from "react";
import ListingsTable from "../components/ListingsTable";
import Search from "../components/Search";
import styled from "styled-components";
import {Listing} from '../types/types';
 
const Home = () => {
    const [listings, setListings] = useState<Listing[]>([]);
    const [numSearches, setNumSearches] = useState(-1);

    useEffect(() => {
        setNumSearches(numSearches + 1)
    }, [listings]);

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <Search setListings={setListings}></Search>
            <div style={{marginTop: '2rem'}}></div>
            {listings.length > 0 ? (
                <ListingsTable listings={listings}></ListingsTable>
            ) : (numSearches == 0 ? 
                    <NoResultsText>Start a search using the above menu </NoResultsText> 
                    : <NoResultsText>No results match the search criteria</NoResultsText>)
            }
        </div>
    );
};

export default Home;

const NoResultsText = styled.h4`
  color: #838383;
  text-align: center;
  padding-top: 15%;
`;