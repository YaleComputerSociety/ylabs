import {useState, useEffect} from "react";
import ListingsTable from "../components/ListingsTable";
import Search from "../components/Search";
import styled from "styled-components";
import {Listing} from '../types/types';
import PulseLoader from "react-spinners/PulseLoader";
 
const Home = () => {
    const [listings, setListings] = useState<Listing[]>([]);
    const [numSearches, setNumSearches] = useState(-1);
    const [isLoading, setIsLoading] = useState<Boolean>(false);

    useEffect(() => {
        setNumSearches(numSearches + 1)
    }, [listings]);

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <Search setListings={setListings} setIsLoading={setIsLoading}></Search>
            <div style={{marginTop: '2rem'}}></div>
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
                </div>
                ) : (listings.length > 0 ? (
                        <ListingsTable listings={listings}></ListingsTable>
                    ) : (numSearches == 0 ? 
                            <NoResultsText>Start a search using the above menu </NoResultsText> 
                            : <NoResultsText>No results match the search criteria</NoResultsText>))
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