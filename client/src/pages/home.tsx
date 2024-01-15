import {useState} from "react";
import ListingsTable from "../components/ListingsTable";
import Search from "../components/Search";
import {Listing} from '../types/types';
 
const Home = () => {
    const [listings, setListings] = useState<Listing[]>([]);

    return (
        <div style={{marginTop: '6rem', marginLeft: '3rem', marginRight: '3rem'}}>
            <Search setListings={setListings}></Search>
            <div style={{marginTop: '2rem'}}></div>
            {listings.length > 0 && (
                <ListingsTable listings={listings}></ListingsTable>
            )}
        </div>
    );
};

export default Home;