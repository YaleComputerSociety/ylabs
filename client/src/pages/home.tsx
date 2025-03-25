import {useState} from "react";
import ListingsCardList from "../components/home/ListingsCardList";
import SearchHub from "../components/home/SearchHub";
import { departmentCategories } from "../utils/departmentNames";

import styled from "styled-components";
import {NewListing} from '../types/types';
import PulseLoader from "react-spinners/PulseLoader";

// Remove all archived from search results on backend

const Home = () => {
    const [listings, setListings] = useState<NewListing[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);

    const sortableKeys = ['default', 'updatedAt', 'ownerLastName', 'ownerFirstName', 'title']

    const [sortBy, setSortBy] = useState<string>(sortableKeys[0]);
    const [sortOrder, setSortOrder] = useState<number>(-1);

    const departmentKeys = Object.keys(departmentCategories).sort((a, b) => a.localeCompare(b));

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <div className='mt-12'>
                <SearchHub allDepartments={departmentKeys} setListings={setListings} setIsLoading={setIsLoading} sortBy={sortBy} sortOrder={sortOrder} page={1} pageSize={20}></SearchHub>
            </div>
            <div style={{marginTop: '2rem'}}></div>
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
                </div>
                ) : (listings.length > 0 ? (
                        <ListingsCardList listings={listings} sortableKeys={sortableKeys} setSortBy={setSortBy} setSortOrder={setSortOrder} ></ListingsCardList>
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