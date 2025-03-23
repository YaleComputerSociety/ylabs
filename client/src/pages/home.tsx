import {useState} from "react";
import ListingsTable from "../components/ListingsCardList";
import SearchHub from "../components/search/SearchHub";
import { departmentCategories } from "../utils/departmentNames";

import styled from "styled-components";
import {NewListing} from '../types/types';
import PulseLoader from "react-spinners/PulseLoader";

const Home = () => {
    const [listings, setListings] = useState<NewListing[]>([]);
    const [isLoading, setIsLoading] = useState<Boolean>(false);

    const departmentKeys = Object.keys(departmentCategories).sort((a, b) => a.localeCompare(b));

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <div className='mt-12'>
                <SearchHub allDepartments={departmentKeys} setListings={setListings} setIsLoading={setIsLoading} sortBy="updatedAt" sortOrder={-1} page={1} pageSize={20}></SearchHub>
            </div>
            <div style={{marginTop: '2rem'}}></div>
            {isLoading ? (
                <div style={{marginTop: '17%', textAlign: 'center'}}>
                    <PulseLoader color="#66CCFF" size={10} /> 
                </div>
                ) : (listings.length > 0 ? (
                        <ListingsTable listings={listings} sortableKeys={['updatedAt', 'ownerFirstName']}></ListingsTable>
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