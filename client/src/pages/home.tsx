import {useState} from "react";
import ListingsTable from "../components/ListingsTable";
import Search from "../components/Search";
import {Listing} from '../types/types';
 
const Home = () => {
    const [listings, setListings] = useState<Listing[]>([]);

    return (
        <div>
            <h5>Buffer</h5>
            <Search setListings={setListings}></Search>
            {listings.length > 0 && (
                <ListingsTable listings={listings}></ListingsTable>
            )}
        </div>
    );
};

export default Home;