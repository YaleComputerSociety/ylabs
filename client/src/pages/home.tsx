import {useState} from "react";
import ListingsTable from "../components/ListingsTable";
import SearchHub from "../components/search/SearchHub";
import { departmentNames } from "../utils/departmentNames";

import styled from "styled-components";
import {Listing} from '../types/types';
import PulseLoader from "react-spinners/PulseLoader";

const Home = () => {
    const [listings, setListings] = useState<Listing[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <div className='mt-12'>
                <SearchHub allDepartments={departmentNames} setListings={setListings} setIsLoading={setIsLoading}></SearchHub>
            </div>
            <div style={{marginTop: '2rem'}}></div>
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
                </div>
                ) : (listings.length > 0 ? (
                        <ListingsTable listings={listings} sortableKeys={['lastUpdated', 'name']}></ListingsTable>
                    ) : (
                        <NoResultsText>No results match the search criteria</NoResultsText>
                ))
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